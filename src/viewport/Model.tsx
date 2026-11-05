import { useGLTF } from '@react-three/drei'
import { invalidate, type ThreeEvent } from '@react-three/fiber'
import { Component, memo, Suspense, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { Box3, Box3Helper, BufferGeometry, Color, Group, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Vector3, type BufferAttribute, type Light, type Material, type MeshPhysicalMaterial, type Object3D } from 'three'
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh'
import { objectTransformAt } from '@/lib/anim'
import { activeProject, ancestorIds, subtreeIds, useWorkspace, type SceneObject, type ShadingMode, type Vec3 } from '@/store/workspace'
import { viewport } from './bridge'
import { primitiveGroup } from '@/generation/parts/build'
import { buildFurniture } from '@/furniture/build'
import { reshade, surfaceFor } from './shading'
import { lightOf, lumensToIntensity } from '@/furniture/lights'
import { catalogItemOf } from '@/plan/footprint'

// BVH-accelerated raycasting: picking a 1M-triangle mesh stays sub-millisecond.
BufferGeometry.prototype.computeBoundsTree = computeBoundsTree
BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree
Mesh.prototype.raycast = acceleratedRaycast

const SOLID = new MeshStandardMaterial({ color: '#bcbcbc', roughness: 0.62, metalness: 0 })
const WIRE = new MeshBasicMaterial({ color: '#9a9a9a', wireframe: true })
const SELECT_COLOR = new Color('#4c8dff')
const FIT_SIZE = 2

const idle = (fn: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 200))

function materialFor(mode: ShadingMode, original: Material | Material[]) {
  if (mode === 'wireframe') return WIRE
  if (mode === 'solid') return SOLID
  return original
}

/** Children of each object (key null = top level), so models render their parts inside them. */
export type Tree = Map<string | null, SceneObject[]>

interface Props {
  obj: SceneObject
  selected: boolean
  shading: ShadingMode
}

interface TreeProps {
  obj: SceneObject
  selectedId: string | null
  shading: ShadingMode
  tree: Tree
}

/** Loaded/generated meshes: a GLB, fitted to FIT_SIZE unless built at real size, resting on the grid. */
function GltfModel(props: Props) {
  const gltf = useGLTF(props.obj.url!, true, true)
  // SAM 3D parts keep their GLB coordinates: their transforms were computed for exactly those.
  return <ObjectView {...props} source={gltf.scene} clone fit={!props.obj.exact} recenter={!props.obj.keepOrigin} />
}

/** Objects you model yourself: geometry straight from parameters, origin at the shape's centre. */
function PrimitiveModel(props: Props) {
  const p = props.obj.primitive!
  const source = useMemo(() => primitiveGroup(p), [p])
  useEffect(
    () => () =>
      source.traverse((o) => {
        const m = o as Mesh
        if (m.isMesh) {
          m.geometry.dispose()
          ;(m.userData.original as Material | undefined)?.dispose()
        }
      }),
    [source],
  )
  return <ObjectView {...props} source={source} clone={false} fit={false} recenter={false} />
}

/** Catalog furniture: rebuilt from its parameters whenever its size or options change. */
function FurnitureModel(props: Props) {
  const f = props.obj.furniture!
  const key = `${f.item}|${f.size.join(',')}|${JSON.stringify(f.options ?? {})}`
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const source = useMemo(() => buildFurniture(f.item, f.size), [key])
  useEffect(
    () => () =>
      source.traverse((o) => {
        const m = o as Mesh
        if (m.isMesh) {
          m.geometry.dispose()
          ;(Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose())
        }
      }),
    [source],
  )
  return <ObjectView {...props} source={source} clone={false} fit={false} recenter={false} />
}

function ObjectView({ obj, selected, shading, source, clone, fit, recenter }: Props & { source: Object3D; clone: boolean; fit: boolean; recenter: boolean }) {
  const group = useRef<Group>(null)

  // Normalise once per load: fit into FIT_SIZE units, centre on XZ, rest on the grid.
  // Exact models and primitives keep their metres (metric UVs, real-size textures).
  const exact = !!obj.exact || !!obj.primitive || !!obj.furniture
  const { root, box, bulb } = useMemo(() => {
    const root = clone ? source.clone(true) : source
    const v = new Vector3()
    const box = new Box3().setFromObject(root)
    if (fit) {
      const max = Math.max(...box.getSize(v).toArray()) || 1
      root.scale.multiplyScalar(FIT_SIZE / max)
      root.updateMatrixWorld(true)
      box.setFromObject(root)
    }
    if (recenter) {
      const c = box.getCenter(v)
      root.position.set(-c.x, -box.min.y, -c.z)
      root.updateMatrixWorld(true)
      box.setFromObject(root)
    }
    // Lights that came with a GLB are dropped: lamps get one real light of their own (below).
    const bundled: Object3D[] = []
    root.traverse((o) => (o as Light).isLight && bundled.push(o))
    bundled.forEach((l) => l.removeFromParent())
    // Material slots: one per distinct generated material, named after it (Blender-style).
    const slotOf = new Map<string, string>()
    const used = new Set<string>()
    root.traverse((o) => {
      const m = o as Mesh
      if (!m.isMesh) return
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as Material
      let key = slotOf.get(mat.uuid)
      if (!key) {
        const baseName = mat.name || 'Surface'
        key = baseName
        for (let i = 2; used.has(key); i++) key = `${baseName} ${i}`
        used.add(key)
        slotOf.set(mat.uuid, key)
      }
      m.userData.slot = key
      m.userData.original = m.material
      m.userData.surface = m.material
      m.userData.geos = { original: m.geometry }
      m.castShadow = m.receiveShadow = true
      // Glass and glowing bulbs don't block light.
      const phys = mat as MeshPhysicalMaterial
      if (phys.transmission > 0 || (mat.transparent && mat.opacity < 0.6)) m.castShadow = false
      if (isGlowing(mat)) {
        m.userData.bulb = true
        m.castShadow = false
      }
    })
    // Where a lamp's light sits: on its glowing parts (bulb, filament), in this group's space.
    const bulbBox = new Box3()
    root.updateMatrixWorld(true)
    root.traverse((o) => o.userData.bulb && bulbBox.expandByObject(o))
    const bulb = bulbBox.isEmpty() ? null : bulbBox.getCenter(new Vector3())
    return { root, box, bulb }
  }, [source, clone, fit, recenter])

  // Build BVHs when the main thread is idle, so loading never hitches.
  useEffect(() => {
    const handle = idle(() =>
      root.traverse((o) => {
        const m = o as Mesh
        if (m.isMesh && !m.geometry.boundsTree) m.geometry.computeBoundsTree()
      }),
    )
    return () => ('cancelIdleCallback' in window ? cancelIdleCallback(handle as number) : clearTimeout(handle as number))
  }, [root])

  const helper = useMemo(() => {
    const h = new Box3Helper(box, SELECT_COLOR)
    h.name = '__selection'
    const mat = h.material as Material
    mat.depthTest = false
    mat.transparent = true
    mat.opacity = 0.45
    h.renderOrder = 999
    return h
  }, [box])

  useEffect(() => {
    let vertices = 0
    let triangles = 0
    let meshes = 0
    root.traverse((o) => {
      const m = o as Mesh
      if (!m.isMesh) return
      meshes++
      const pos = m.geometry.attributes.position
      vertices += pos.count
      triangles += (m.geometry.index ? m.geometry.index.count : pos.count) / 3
    })
    const size = box.getSize(new Vector3()).toArray() as Vec3
    const surfaces = new Map<string, string>()
    root.traverse((o) => {
      const m = o as Mesh
      if (m.isMesh && !surfaces.has(m.userData.slot)) {
        const c = (m.userData.original as MeshStandardMaterial).color
        surfaces.set(m.userData.slot, c ? `#${c.getHexString()}` : '#bcbcbc')
      }
    })
    const st = useWorkspace.getState()
    st.updateObject(obj.id, { stats: { vertices, triangles: Math.round(triangles), meshes, size, surfaces: [...surfaces].map(([key, color]) => ({ key, color })) } })
  }, [root, box, obj.id])

  // Surface per slot = generated material, or the user's override (per surface, else whole-object).
  // Built once per slot and shared by its meshes; viewport shading picks what's displayed.
  const whole = obj.material
  const surfaceOverrides = obj.surfaces
  useLayoutEffect(() => {
    const built = new Map<string, Material>()
    root.traverse((o) => {
      const m = o as Mesh
      if (!m.isMesh) return
      const slot = m.userData.slot as string
      let s = built.get(slot)
      if (!s) {
        s = surfaceFor(m.userData.original, surfaceOverrides?.[slot] ?? whole, { metric: exact, onUpgrade: () => invalidate() })
        built.set(slot, s)
      }
      m.userData.surface = s
      m.material = materialFor(shading, s)
    })
    invalidate()
    return () => built.forEach((s) => s.userData.override && s.dispose())
  }, [root, shading, whole, surfaceOverrides, exact])

  // Lamps: a real light on the bulb, in the colour and brightness you set; the bulb glows to match.
  const light = lightOf(obj)
  const shadows = useWorkspace((s) => s.shading === 'rendered' && s.settings.engine === 'raster')
  const lightPos = useMemo(() => {
    if (!light) return null
    if (bulb) return bulb
    const at = catalogItemOf(obj)?.light?.at ?? [0, 0.8, 0]
    const size = box.getSize(new Vector3())
    return new Vector3(box.min.x + size.x * (0.5 + at[0]), box.min.y + size.y * at[1], box.min.z + size.z * (0.5 + at[2]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!light, bulb, box])
  const lightColor = light?.color
  const lightOn = !!light?.on
  useLayoutEffect(() => {
    if (!lightColor || shading === 'wireframe' || shading === 'solid') return
    const made: Material[] = []
    root.traverse((o) => {
      const m = o as Mesh
      if (!m.isMesh || !m.userData.bulb) return
      const base = (Array.isArray(m.material) ? m.material[0] : m.material) as MeshStandardMaterial
      if (!base.isMeshStandardMaterial) return
      const glow = base.clone()
      glow.emissive.set(lightColor)
      glow.emissiveIntensity = lightOn ? Math.max(4, base.emissiveIntensity) : 0
      if (!lightOn) glow.color.multiplyScalar(0.8)
      // The path tracer reads this: the bulb glows but doesn't shadow its own light.
      ;(glow as unknown as { castShadow: boolean }).castShadow = false
      made.push(glow)
      m.material = glow
    })
    invalidate()
    return () => made.forEach((x) => x.dispose())
  }, [root, lightColor, lightOn, shading, whole, surfaceOverrides])

  // Shade Smooth / Auto Smooth: normals rebuilt in a worker, cached per mode.
  const shade = obj.shade
  useEffect(() => {
    let cancelled = false
    const meshes: Mesh[] = []
    root.traverse((o) => (o as Mesh).isMesh && meshes.push(o as Mesh))
    const apply = (m: Mesh, g: BufferGeometry) => {
      m.geometry = g
      if (!g.boundsTree) idle(() => !cancelled && !g.boundsTree && g.computeBoundsTree())
    }
    for (const m of meshes) {
      const geos = m.userData.geos as Record<string, BufferGeometry | Promise<BufferGeometry>>
      const cached = geos[shade]
      if (cached instanceof BufferGeometry) apply(m, cached)
      else {
        const job = (cached as Promise<BufferGeometry> | undefined) ?? reshade(geos.original as BufferGeometry, shade as 'smooth' | 'auto')
        geos[shade] = job
        job.then((g) => {
          geos[shade] = g
          if (!cancelled) {
            apply(m, g)
            invalidate()
          }
        })
      }
    }
    invalidate()
    return () => void (cancelled = true)
  }, [root, shade])

  // Store → Object3D. The gizmo writes the Object3D directly while dragging and commits on release.
  // Keyed objects follow the timeline; only they subscribe to the frame.
  const keyed = !!obj.keys?.length
  const frame = useWorkspace((s) => (keyed ? s.frame : 0))
  useLayoutEffect(() => {
    const g = group.current
    if (!g) return
    const t = objectTransformAt(obj, frame)
    g.position.fromArray(t.position)
    g.rotation.set(...t.rotation)
    g.scale.fromArray(t.scale)
    invalidate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obj.transform, obj.keys, obj.interpolation, frame])

  useLayoutEffect(() => {
    const g = group.current
    if (!g) return
    viewport.objects.set(obj.id, g)
    return () => void viewport.objects.delete(obj.id)
  }, [obj.id])

  return (
    <group
      ref={group}
      name={obj.name}
      visible={obj.visible}
      userData={{ id: obj.id, renderable: obj.renderable, parentId: obj.parentId ?? null }}
      onClick={(e) => pick(e, obj.id)}
      onDoubleClick={(e) => pickExact(e, obj.id)}
    >
      <primitive object={root} />
      {light && lightPos && (
        <pointLight
          position={lightPos}
          color={light.color}
          intensity={light.on ? lumensToIntensity(light.lumens) : 0}
          visible={light.on}
          decay={2}
          distance={0}
          castShadow={shadows && light.on}
          shadow-mapSize={[512, 512]}
          shadow-bias={-0.002}
          shadow-normalBias={0.02}
          shadow-camera-near={0.05}
        />
      )}
      <primitive object={helper} visible={selected} />
    </group>
  )
}

/** A material that gives off light (a bulb, a filament). */
function isGlowing(mat: Material) {
  const m = mat as MeshStandardMaterial
  if (!m.emissive) return false
  return m.emissiveIntensity > 0 && (m.emissive.r + m.emissive.g + m.emissive.b > 0.3 || (!!m.emissiveMap && m.emissive.r + m.emissive.g + m.emissive.b > 0))
}

/**
 * Clicking in the viewport, Figma-style: the first click on a model selects the whole model;
 * clicking again goes one level deeper (folder, then part). Double-click goes straight to the part.
 */
function pick(e: ThreeEvent<MouseEvent>, id: string) {
  if (e.delta > 4) return // was an orbit drag, not a click
  e.stopPropagation()
  const s = useWorkspace.getState()
  const objects = activeProject(s).objects
  const chain = [id, ...ancestorIds(objects, id)] // part → … → model
  // Shift/Ctrl-click: add the whole model to (or take it out of) the selection.
  if (e.shiftKey || e.ctrlKey || e.metaKey) return s.select(chain.at(-1)!, 'toggle')
  const at = s.selectedId ? chain.indexOf(s.selectedId) : -1
  if (at > 0) return s.select(chain[at - 1])
  if (at === 0) return
  // Something else in the same model is selected: switch straight to the clicked part.
  const inSameModel = !!s.selectedId && subtreeIds(objects, chain.at(-1)!).includes(s.selectedId)
  s.select(inSameModel ? id : chain.at(-1)!)
}

function pickExact(e: ThreeEvent<MouseEvent>, id: string) {
  e.stopPropagation()
  useWorkspace.getState().select(id)
}

/** Exact bounds of everything visible under `root`, in `root`'s own coordinates. */
function localBounds(root: Object3D, box = new Box3()) {
  root.updateWorldMatrix(true, true)
  const inv = new Matrix4().copy(root.matrixWorld).invert()
  const m = new Matrix4()
  const v = new Vector3()
  const walk = (o: Object3D) => {
    if (!o.visible || o.name === '__selection') return
    const mesh = o as Mesh
    if (mesh.isMesh) {
      m.multiplyMatrices(inv, mesh.matrixWorld)
      const pos = mesh.geometry.attributes.position as BufferAttribute
      for (let i = 0; i < pos.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(m))
    }
    o.children.forEach(walk)
  }
  root.children.forEach(walk)
  return box
}

/** A model or folder: no geometry of its own, its parts render inside it and move with it. */
function GroupView({ obj, selectedId, shading, tree }: TreeProps) {
  const group = useRef<Group>(null)
  const kids = tree.get(obj.id) ?? []
  const inSelection = useWorkspace((s) => s.selection.length > 1 && s.selection.includes(obj.id))
  const selected = obj.id === selectedId || inSelection
  const box = useMemo(() => new Box3(), [])
  const helper = useMemo(() => {
    const h = new Box3Helper(box, SELECT_COLOR)
    h.name = '__selection'
    const mat = h.material as Material
    mat.depthTest = false
    mat.transparent = true
    mat.opacity = 0.45
    h.renderOrder = 999
    return h
  }, [box])

  const keyed = !!obj.keys?.length
  const frame = useWorkspace((s) => (keyed ? s.frame : 0))
  useLayoutEffect(() => {
    const g = group.current
    if (!g) return
    const t = objectTransformAt(obj, frame)
    g.position.fromArray(t.position)
    g.rotation.set(...t.rotation)
    g.scale.fromArray(t.scale)
    invalidate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obj.transform, obj.keys, obj.interpolation, frame])

  useLayoutEffect(() => {
    const g = group.current
    if (!g) return
    viewport.objects.set(obj.id, g)
    return () => void viewport.objects.delete(obj.id)
  }, [obj.id])

  // The group's size (for the Size field and the selection box) follows its parts:
  // recomputed when a part loads, moves, appears or disappears.
  const objects = useWorkspace((s) => activeProject(s).objects)
  const signature = useMemo(() => {
    const ids = subtreeIds(objects, obj.id).slice(1)
    const byId = new Map(objects.map((o) => [o.id, o]))
    return ids.map((id) => {
      const o = byId.get(id)!
      return `${id}:${o.visible}:${o.isGroup ? '' : o.stats ? 1 : 0}:${o.transform.position}:${o.transform.rotation}:${o.transform.scale}`
    }).join('|')
  }, [objects, obj.id])
  useEffect(() => {
    const g = group.current
    if (!g) return
    box.makeEmpty()
    localBounds(g, box)
    if (box.isEmpty()) return
    const size = box.getSize(new Vector3()).toArray() as Vec3
    const st = useWorkspace.getState()
    const current = activeProject(st).objects.find((o) => o.id === obj.id)
    const old = current?.stats?.size
    if (!old || old.some((v, i) => Math.abs(v - size[i]) > 1e-6)) st.updateObject(obj.id, { stats: { vertices: 0, triangles: 0, meshes: 0, size } })
    invalidate()
  }, [signature, obj.id, box])

  return (
    <group
      ref={group}
      name={obj.name}
      visible={obj.visible}
      userData={{ id: obj.id, renderable: obj.renderable, parentId: obj.parentId ?? null, isGroup: true }}
      onDoubleClick={(e) => pickExact(e, obj.id)}
    >
      {kids.map((k) => (
        <Model key={k.id} obj={k} selectedId={selectedId} shading={shading} tree={tree} />
      ))}
      <primitive object={helper} visible={selected} />
    </group>
  )
}

/** A broken GLB marks its own row in the outliner instead of taking down the viewport. */
class ModelBoundary extends Component<{ id: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: Error) {
    console.warn('[model] load failed', error)
    useWorkspace.getState().updateObject(this.props.id, { error: 'Not a valid .glb file' })
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

/** Each model suspends on its own, so loading one never blanks the others. */
export const Model = memo(function Model({ obj, selectedId, shading, tree }: TreeProps) {
  // Part of a multi-selection: boxed like the primary.
  const inSelection = useWorkspace((s) => s.selection.length > 1 && s.selection.includes(obj.id))
  if (obj.isGroup) return <GroupView obj={obj} selectedId={selectedId} shading={shading} tree={tree} />
  const props = { obj, selected: obj.id === selectedId || inSelection, shading }
  return (
    <ModelBoundary id={obj.id}>
      <Suspense fallback={null}>{obj.furniture ? <FurnitureModel {...props} /> : obj.primitive ? <PrimitiveModel {...props} /> : obj.url ? <GltfModel {...props} /> : null}</Suspense>
    </ModelBoundary>
  )
})

/** Put surface materials (generated or overridden) back for export; returns an undo function. */
export function withOriginalMaterials(target: Object3D) {
  const swapped: [Mesh, Material | Material[]][] = []
  target.traverse((o) => {
    const m = o as Mesh
    if (m.isMesh && m.userData.surface) {
      swapped.push([m, m.material])
      m.material = m.userData.surface
    }
  })
  return () => swapped.forEach(([m, mat]) => (m.material = mat))
}

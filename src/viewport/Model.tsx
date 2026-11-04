import { useGLTF } from '@react-three/drei'
import { invalidate, type ThreeEvent } from '@react-three/fiber'
import { Component, memo, Suspense, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { Box3, Box3Helper, BufferGeometry, Color, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Vector3, type Material, type Object3D } from 'three'
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh'
import { objectTransformAt } from '@/lib/anim'
import { scaleForSize, useWorkspace, type SceneObject, type ShadingMode, type Vec3 } from '@/store/workspace'
import { viewport } from './bridge'
import { primitiveGroup } from '@/generation/parts/build'
import { reshade, surfaceFor } from './shading'

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

interface Props {
  obj: SceneObject
  selected: boolean
  shading: ShadingMode
}

/** Loaded/generated meshes: a GLB, fitted to FIT_SIZE unless built at real size, resting on the grid. */
function GltfModel(props: Props) {
  const gltf = useGLTF(props.obj.url!, true, true)
  return <ObjectView {...props} source={gltf.scene} clone fit={!props.obj.exact} recenter />
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

function ObjectView({ obj, selected, shading, source, clone, fit, recenter }: Props & { source: Object3D; clone: boolean; fit: boolean; recenter: boolean }) {
  const group = useRef<Group>(null)

  // Normalise once per load: fit into FIT_SIZE units, centre on XZ, rest on the grid.
  // Exact models and primitives keep their metres (metric UVs, real-size textures).
  const exact = !!obj.exact || !!obj.primitive
  const { root, box } = useMemo(() => {
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
    })
    return { root, box }
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
    // Spec dimensions requested at generation time: apply once, now that the real bounds are known.
    const current = st.projects.flatMap((p) => p.objects).find((o) => o.id === obj.id)
    if (current?.fitSize) {
      st.updateObject(obj.id, { fitSize: null, transform: { ...current.transform, scale: scaleForSize(size, current.fitSize, current.transform.scale) } })
    }
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

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return // was an orbit drag, not a click
    e.stopPropagation()
    useWorkspace.getState().select(obj.id)
  }

  return (
    <group ref={group} name={obj.name} visible={obj.visible} userData={{ id: obj.id, renderable: obj.renderable }} onClick={onClick}>
      <primitive object={root} />
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
export const Model = memo(function Model(props: Props) {
  return (
    <ModelBoundary id={props.obj.id}>
      <Suspense fallback={null}>{props.obj.primitive ? <PrimitiveModel {...props} /> : <GltfModel {...props} />}</Suspense>
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

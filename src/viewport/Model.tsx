import { useGLTF } from '@react-three/drei'
import { invalidate, type ThreeEvent } from '@react-three/fiber'
import { Component, memo, Suspense, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { Box3, Box3Helper, BufferGeometry, Color, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Vector3, type Material, type Object3D } from 'three'
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh'
import { useWorkspace, type SceneObject, type ShadingMode } from '@/store/workspace'
import { viewport } from './bridge'

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

function ModelInner({ obj, selected, shading }: Props) {
  const gltf = useGLTF(obj.url, true, true)
  const group = useRef<Group>(null)

  // Normalise once per load: fit into FIT_SIZE units, centre on XZ, rest on the grid.
  const { root, box } = useMemo(() => {
    const root = gltf.scene.clone(true)
    const v = new Vector3()
    const box = new Box3().setFromObject(root)
    const max = Math.max(...box.getSize(v).toArray()) || 1
    root.scale.multiplyScalar(FIT_SIZE / max)
    root.updateMatrixWorld(true)
    box.setFromObject(root)
    const c = box.getCenter(v)
    root.position.set(-c.x, -box.min.y, -c.z)
    root.updateMatrixWorld(true)
    box.setFromObject(root)
    root.traverse((o) => {
      const m = o as Mesh
      if (!m.isMesh) return
      m.userData.original = m.material
      m.castShadow = m.receiveShadow = true
    })
    return { root, box }
  }, [gltf])

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
    useWorkspace.getState().updateObject(obj.id, { stats: { vertices, triangles: Math.round(triangles), meshes } })
  }, [root, obj.id])

  useLayoutEffect(() => {
    root.traverse((o) => {
      const m = o as Mesh
      if (m.isMesh) m.material = materialFor(shading, m.userData.original)
    })
    invalidate()
  }, [root, shading])

  // Store → Object3D. The gizmo writes the Object3D directly while dragging and commits on release.
  const { position, rotation, scale } = obj.transform
  useLayoutEffect(() => {
    const g = group.current
    if (!g) return
    g.position.fromArray(position)
    g.rotation.set(...rotation)
    g.scale.fromArray(scale)
    invalidate()
  }, [position, rotation, scale])

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
      <Suspense fallback={null}>
        <ModelInner {...props} />
      </Suspense>
    </ModelBoundary>
  )
})

/** Restore original materials (for export) and return a function that undoes it. */
export function withOriginalMaterials(target: Object3D) {
  const swapped: [Mesh, Material | Material[]][] = []
  target.traverse((o) => {
    const m = o as Mesh
    if (m.isMesh && m.userData.original) {
      swapped.push([m, m.material])
      m.material = m.userData.original
    }
  })
  return () => swapped.forEach(([m, mat]) => (m.material = mat))
}

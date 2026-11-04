import { useGLTF } from '@react-three/drei'
import { invalidate, type ThreeEvent } from '@react-three/fiber'
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Box3, Box3Helper, Color, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Vector3, type Material } from 'three'
import { useWorkspace, type SceneObject, type ShadingMode } from '@/store/workspace'
import { viewport } from './bridge'

const SOLID = new MeshStandardMaterial({ color: '#bcbcbc', roughness: 0.62, metalness: 0 })
const WIRE = new MeshBasicMaterial({ color: '#9a9a9a', wireframe: true })
const SELECT_COLOR = new Color('#4c8dff')
const FIT_SIZE = 2

function materialFor(mode: ShadingMode, original: Material | Material[]) {
  if (mode === 'wireframe') return WIRE
  if (mode === 'solid') return SOLID
  return original
}

export const Model = memo(function Model({ obj, selected, shading }: { obj: SceneObject; selected: boolean; shading: ShadingMode }) {
  const gltf = useGLTF(obj.url, true, true)
  const group = useRef<Group>(null)

  // Normalise once per load: fit into FIT_SIZE units, centre on XZ, rest on the grid.
  const { root, box } = useMemo(() => {
    const root = gltf.scene.clone(true)
    const v = new Vector3()
    const box = new Box3().setFromObject(root)
    const max = Math.max(...box.getSize(v).toArray()) || 1
    root.scale.setScalar(FIT_SIZE / max)
    root.updateMatrixWorld(true)
    box.setFromObject(root)
    const c = box.getCenter(v)
    root.position.set(-c.x, -box.min.y, -c.z)
    root.updateMatrixWorld(true)
    box.setFromObject(root)
    root.traverse((o) => {
      if ((o as Mesh).isMesh) {
        const m = o as Mesh
        m.userData.original = m.material
        m.castShadow = m.receiveShadow = true
        m.geometry.computeBoundingSphere()
      }
    })
    return { root, box }
  }, [gltf])

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
})

/** Restore original materials (for export) and return a function that undoes it. */
export function withOriginalMaterials(target: Group | import('three').Object3D) {
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

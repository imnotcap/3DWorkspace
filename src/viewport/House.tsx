import { invalidate, type ThreeEvent } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { Box3, Box3Helper, Color, type Material, type Mesh } from 'three'
import { buildLevel, type PickInfo } from '@/plan/build'
import { pointInPolygon } from '@/plan/geometry'
import { footprint } from '@/plan/footprint'
import type { Level } from '@/plan/types'
import { useWorkspace, type Project } from '@/store/workspace'
import { viewport } from './bridge'

const HIGHLIGHT = new Color('#4c8dff')

/** One floor of the house, built from the plan (walls, openings, floors, ceilings). */
export function HouseLevel({ project, level, index, ceilings }: { project: Project; level: Level; index: number; ceilings: boolean }) {
  const walls = useMemo(() => project.walls.filter((w) => w.levelId === level.id), [project.walls, level.id])
  const wallIds = useMemo(() => new Set(walls.map((w) => w.id)), [walls])
  const openings = useMemo(() => project.openings.filter((o) => wallIds.has(o.wallId)), [project.openings, wallIds])

  // Stairs cut the floor of the level above them (and the ceiling they rise through).
  const below = index > 0 ? project.levels[index - 1].id : null
  const stairKey = project.objects
    .filter((o) => o.furniture?.item === 'stairs')
    .map((o) => `${o.levelId}:${o.transform.position}:${o.transform.rotation}:${o.transform.scale}:${o.furniture!.size}`)
    .join('|')
  const holes = useMemo(() => {
    const stairs = project.objects.filter((o) => o.furniture?.item === 'stairs')
    const first = project.levels[0].id
    const on = (id: string | null) => stairs.filter((o) => (o.levelId ?? first) === id).map((o) => footprint(o).corners)
    return { floor: below ? on(below) : [], ceiling: on(level.id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stairKey, below, level.id])

  const built = useMemo(
    () => buildLevel({ level, levelIndex: index, walls, openings, rooms: project.rooms, floorHoles: holes.floor, ceilingHoles: holes.ceiling, onUpgrade: () => invalidate() }),
    [level, index, walls, openings, project.rooms, holes],
  )
  useEffect(
    () => () =>
      built.group.traverse((o) => {
        const m = o as Mesh
        if (m.isMesh) m.geometry.dispose()
      }),
    [built],
  )

  useEffect(() => {
    viewport.houses.set(level.id, built.group)
    return () => void (viewport.houses.get(level.id) === built.group && viewport.houses.delete(level.id))
  }, [built, level.id])

  useEffect(() => {
    built.group.traverse((o) => o.userData.ceiling && (o.visible = ceilings))
    invalidate()
  }, [built, ceilings])

  // Selected wall / room / opening: a box around it.
  const sel = useWorkspace((s) => s.planSel)
  const helper = useMemo(() => {
    if (!sel || (sel.kind !== 'wall' && sel.kind !== 'opening' && sel.kind !== 'room')) return null
    const box = new Box3()
    built.group.updateMatrixWorld(true)
    built.group.traverse((o) => {
      const p = o.userData.pick as PickInfo | undefined
      if (!p || o.userData.ceiling) return
      const face = p.face != null ? built.geom.faces[p.face] : undefined
      const hit = sel.kind === 'room' ? p.kind === 'room' && sel.id === level.id && !!face && !!sel.at && pointInPolygon(sel.at, face.polygon) : p.kind === sel.kind && p.id === sel.id
      if (hit) box.expandByObject(o)
    })
    if (box.isEmpty()) return null
    const h = new Box3Helper(box, HIGHLIGHT)
    h.name = '__selection'
    const m = h.material as Material
    m.depthTest = false
    m.transparent = true
    m.opacity = 0.7
    h.renderOrder = 999
    return h
  }, [sel, built, level.id])
  useEffect(() => void invalidate(), [helper])

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 4) return
    const p = e.object.userData.pick as PickInfo | undefined
    if (!p) return
    e.stopPropagation()
    const s = useWorkspace.getState()
    if (p.kind === 'room') {
      const f = built.geom.faces[p.face!]
      if (f) s.selectPlan({ kind: 'room', id: level.id, at: f.center })
    } else s.selectPlan({ kind: p.kind, id: p.id, side: p.side })
    if (level.id !== projectActiveLevel()) s.setActiveLevel(level.id)
  }

  return (
    <group onClick={onClick}>
      <primitive object={built.group} />
      {helper && <primitive object={helper} />}
    </group>
  )
}

function projectActiveLevel() {
  const s = useWorkspace.getState()
  return s.projects.find((p) => p.id === s.activeProjectId)?.activeLevelId
}


// Copy and paste of objects (Ctrl+C / Ctrl+X / Ctrl+V, Ctrl+D): the selection with everything in
// it, pasted as a group that keeps its layout — at the mouse when it is over the plan, otherwise
// a little to the side so the copy is easy to see and grab.
import { activeProject, subtreeIds, uid, useWorkspace, type SceneObject, type Vec3 } from '@/store/workspace'
import { viewport } from '@/viewport/bridge'
import type { Vec2 } from '@/plan/types'

let clip: { objects: SceneObject[]; roots: string[]; center: Vec2 } | null = null
let pastes = 0

import { planPointer } from './pointer'

/** The selected objects whose parent is not selected too: what gets copied (with what is in them). */
function roots() {
  const s = useWorkspace.getState()
  const objects = activeProject(s).objects
  const sel = new Set(s.selection.filter((id) => objects.some((o) => o.id === id)))
  return [...sel].filter((id) => {
    let p = objects.find((o) => o.id === id)?.parentId
    while (p) {
      if (sel.has(p)) return false
      p = objects.find((o) => o.id === p)?.parentId
    }
    return true
  })
}

/** A part copied out of a model becomes a piece of its own: its transform in the world. */
function worldTransform(o: SceneObject): SceneObject['transform'] {
  if (!o.parentId) return o.transform
  const three = viewport.objects.get(o.id)
  if (!three) return o.transform
  three.updateWorldMatrix(true, false)
  // (three.js classes borrowed from the object itself, so this module stays free of three.js.)
  const p = three.position.clone()
  const q = three.quaternion.clone()
  const k = three.scale.clone()
  three.matrixWorld.decompose(p, q, k)
  const e = three.rotation.clone().setFromQuaternion(q)
  return { position: p.toArray() as Vec3, rotation: [e.x, e.y, e.z], scale: k.toArray() as Vec3 }
}

function snapshot() {
  const objects = activeProject(useWorkspace.getState()).objects
  const top = roots()
  if (!top.length) return null
  const ids = new Set(top.flatMap((id) => subtreeIds(objects, id)))
  const copied = objects.filter((o) => ids.has(o.id)).map((o) => (top.includes(o.id) ? { ...o, parentId: null, transform: worldTransform(o) } : { ...o }))
  const rs = copied.filter((o) => top.includes(o.id))
  const center: Vec2 = [rs.reduce((a, o) => a + o.transform.position[0], 0) / rs.length, rs.reduce((a, o) => a + o.transform.position[2], 0) / rs.length]
  return { objects: copied, roots: top, center }
}

/** New copies of a snapshot, moved so its middle lands at `at`. */
function instantiate(c: NonNullable<typeof clip>, at: Vec2) {
  const s = useWorkspace.getState()
  const p = activeProject(s)
  const map = new Map(c.objects.map((o) => [o.id, uid()]))
  const dx = at[0] - c.center[0]
  const dz = at[1] - c.center[1]
  return c.objects.map((o) => {
    const root = c.roots.includes(o.id)
    const t = o.transform
    return {
      ...o,
      id: map.get(o.id)!,
      parentId: o.parentId ? (map.get(o.parentId) ?? null) : null,
      levelId: root ? p.activeLevelId : o.levelId,
      keys: undefined,
      transform: root ? { ...t, position: [t.position[0] + dx, t.position[1], t.position[2] + dz] as Vec3 } : t,
    } as SceneObject
  })
}

export function copySelection() {
  const c = snapshot()
  if (!c) return false
  clip = c
  pastes = 0
  return true
}

export function cutSelection() {
  if (!copySelection()) return
  useWorkspace.getState().removeObjects(clip!.roots)
}

export function pasteClipboard() {
  if (!clip) return
  pastes++
  const at: Vec2 = planPointer.p ?? [clip.center[0] + 0.5 * pastes, clip.center[1] + 0.5 * pastes]
  useWorkspace.getState().insertObjects(clip.roots.length > 1 ? `Paste ${clip.roots.length} objects` : 'Paste', instantiate(clip, at))
}

/** Duplicate the selection next to itself (the clipboard stays as it was). */
export function duplicateSelection() {
  const c = snapshot()
  if (!c) return
  useWorkspace.getState().insertObjects(c.roots.length > 1 ? `Duplicate ${c.roots.length} objects` : 'Duplicate', instantiate(c, [c.center[0] + 0.5, c.center[1] + 0.5]))
}

/** Select every piece on the active floor. */
export function selectAll() {
  const s = useWorkspace.getState()
  const p = activeProject(s)
  const first = p.levels[0].id
  s.selectMany(p.objects.filter((o) => !o.parentId && (o.levelId ?? first) === p.activeLevelId && o.visible).map((o) => o.id))
}

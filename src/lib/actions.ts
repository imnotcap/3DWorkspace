import { importModelFiles } from './importFiles'
import { activeProject, useWorkspace, type ShadingMode, type Transform, type Vec3 } from '@/store/workspace'
import { download, viewport } from '@/viewport/bridge'
import { newPrimitive, restingHeight } from './primitives'
import { autoTour } from '@/plan/tour'
import { analyse, pointInPolygon } from '@/plan/geometry'
import { levelElevations } from '@/plan/levels'
import type { Vec2 } from '@/plan/types'
import { uid } from '@/store/workspace'
import { copySelection, cutSelection, duplicateSelection, pasteClipboard, selectAll } from './clipboard'

let renderAbort: AbortController | null = null

/** The selected object's transform as shown right now (gizmo edits included). */
function selectedTransform(): { id: string; transform: Transform } | null {
  const s = useWorkspace.getState()
  const o = s.selectedId ? viewport.objects.get(s.selectedId) : undefined
  if (!o || !s.selectedId) return null
  return {
    id: s.selectedId,
    transform: { position: o.position.toArray() as Vec3, rotation: [o.rotation.x, o.rotation.y, o.rotation.z], scale: o.scale.toArray() as Vec3 },
  }
}
const ws = () => useWorkspace.getState()
const project = () => activeProject(ws())
const fileBase = () => project().name.replace(/[^\w.-]+/g, '_') || 'render'

function fail(e: unknown) {
  if ((e as Error).name === 'AbortError') return ws().setJob({ status: 'idle' })
  ws().setJob({ status: 'error', message: (e as Error).message || 'Render failed.' })
}

/** Shared commands for menus, toolbar, timeline and hotkeys. */
export const actions = {
  frameSelected: () => viewport.frameSelected(),
  frameAll: () => viewport.frameAll(),

  /** Delete the selected object, or the selected wall / door / window / tour point. */
  deleteSelected() {
    const { selectedId, selection, removeObject, removeObjects, planSel, editPlan, selectPlan } = ws()
    if (selection.length > 1) return removeObjects(selection)
    if (selectedId) return removeObject(selectedId)
    if (!planSel) return
    if (planSel.kind === 'wall')
      editPlan('Delete wall', (p) => ({ ...p, walls: p.walls.filter((w) => w.id !== planSel.id), openings: p.openings.filter((o) => o.wallId !== planSel.id) }))
    else if (planSel.kind === 'opening') editPlan('Delete opening', (p) => ({ ...p, openings: p.openings.filter((o) => o.id !== planSel.id) }))
    else if (planSel.kind === 'tour') editPlan('Delete tour point', (p) => ({ ...p, tour: { ...p.tour, points: p.tour.points.filter((t) => t.id !== planSel.id) } }))
    else return
    selectPlan(null)
  },

  /** Delete the active floor with everything on it. */
  deleteLevel() {
    const s = ws()
    const p = project()
    if (p.levels.length < 2) return
    const id = p.activeLevelId
    const wallIds = new Set(p.walls.filter((w) => w.levelId === id).map((w) => w.id))
    s.editPlan('Delete floor', (pl) => ({
      ...pl,
      levels: pl.levels.filter((l) => l.id !== id),
      walls: pl.walls.filter((w) => w.levelId !== id),
      openings: pl.openings.filter((o) => !wallIds.has(o.wallId)),
      rooms: pl.rooms.filter((r) => r.levelId !== id),
      tour: { ...pl.tour, points: pl.tour.points.filter((t) => t.levelId !== id) },
    }))
    const doomed = p.objects.filter((o) => o.levelId === id && !o.parentId)
    doomed.forEach((o) => s.removeObject(o.id))
    s.setActiveLevel(p.levels.find((l) => l.id !== id)!.id)
  },

  /* ───── Tour ───── */

  /** Walk through every room of the active floor, through the doors. */
  autoTour() {
    const s = ws()
    const p = project()
    const { points, doors } = autoTour(p, p.activeLevelId, uid)
    if (points.length < 2) return s.setJob({ status: 'error', message: 'No rooms to tour yet.', hint: 'Close some rooms with walls and connect them with doors first.' })
    // The doors on the way open by themselves as the camera comes up to them (see tourDoorsAt).
    void doors
    s.editPlan('Auto tour', (pl) => ({ ...pl, tour: { ...pl.tour, points } }))
    s.setUseTour(true)
    s.setFrame(0)
  },

  clearTour() {
    ws().editPlan('Clear tour', (pl) => ({ ...pl, tour: { ...pl.tour, points: [] } }))
    ws().setUseTour(false)
  },

  async exportPdf() {
    const { exportPdf } = await import('@/export/pdf')
    await exportPdf()
  },

  cycleShading() {
    const order: ShadingMode[] = ['wireframe', 'solid', 'material', 'rendered']
    const s = ws()
    s.setShading(order[(order.indexOf(s.shading) + 1) % order.length])
  },

  /* ───── Camera ───── */

  toggleCameraView: () => ws().setCameraView(!ws().cameraView),

  /** Blender's Align Active Camera to View (Ctrl+Alt+Numpad0). */
  cameraFromView() {
    const pose = viewport.viewPose()
    if (!pose) return
    const s = ws()
    if (project().animation.keys.length) s.setKey(s.frame, pose)
    else s.setCamera(pose)
    s.setCameraView(true)
  },

  resetCamera() {
    ws().setCamera(null)
  },

  setFocal(focal: number) {
    const s = ws()
    const pose = project().camera ?? viewport.renderPose(s.frame)
    if (pose) s.setCamera({ ...pose, focal })
  },

  /* ───── Animation ───── */

  /** Blender's I: keys the selected object's transform, or the camera when nothing is selected. */
  insertKey() {
    const s = ws()
    const t = selectedTransform()
    if (t) return s.setObjectKey(t.id, s.frame, t.transform)
    const pose = viewport.viewPose()
    if (pose) s.setKey(s.frame, { ...pose, focal: viewport.renderPose(s.frame)?.focal ?? pose.focal })
  },

  deleteKey() {
    const s = ws()
    const obj = project().objects.find((o) => o.id === s.selectedId)
    if (obj) return s.removeObjectKey(obj.id, s.frame)
    s.removeKey(s.frame)
  },

  /** Seamless 360° loop: spins the selected object, or orbits the camera when nothing is selected. */
  turntable() {
    const s = ws()
    const anim = project().animation
    const span = anim.end - anim.start
    // Last frame stops one step short of 360° so the loop doesn't repeat a frame.
    const turn = (Math.PI * 2 * span) / (span + 1)
    const sel = selectedTransform()
    if (sel) {
      const r = sel.transform.rotation
      s.setObjectKeys(sel.id, [
        { frame: anim.start, transform: sel.transform },
        { frame: anim.end, transform: { ...sel.transform, rotation: [r[0], r[1] + turn, r[2]] } },
      ])
      s.updateObject(sel.id, { interpolation: 'linear' }) // constant speed, so the loop is seamless
      s.setFrame(anim.start)
      return s.setCameraView(true)
    }
    const shot = viewport.renderPose(anim.start)
    if (!shot) return
    // Auto-framed shots are fitted for one angle; widen so no angle of the orbit clips.
    const base = project().camera ? shot : { ...shot, radius: viewport.orbitRadius(shot) ?? shot.radius }
    const end = { ...base, azimuth: base.azimuth + turn }
    s.updateAnimation({ interpolation: 'linear', keys: [{ frame: anim.start, pose: base }, { frame: anim.end, pose: end }] })
    s.setFrame(anim.start)
    s.setCameraView(true)
  },

  togglePlay() {
    const s = ws()
    if (!s.playing) s.setCameraView(true)
    s.setPlaying(!s.playing)
  },

  stepFrame(delta: number) {
    const s = ws()
    const { start, end } = project().animation
    s.setFrame(Math.min(end, Math.max(start, s.frame + delta)))
  },

  jump(to: 'start' | 'end') {
    const { start, end } = project().animation
    ws().setFrame(to === 'start' ? start : end)
  },

  /* ───── Render ───── */

  async renderImage() {
    const s = ws()
    if (s.renderJob) return
    const { renderWidth: w, renderHeight: h } = s.settings
    s.setRenderJob({ kind: 'image', done: 0, total: 1, message: `Rendering ${w}×${h}` })
    try {
      const blob = await viewport.renderStill()
      if (blob) download(blob, `${fileBase()}_${w}x${h}.png`)
    } catch (e) {
      fail(e)
    } finally {
      ws().setRenderJob(null)
    }
  },

  async renderAnimation() {
    const s = ws()
    if (s.renderJob) return
    s.setPlaying(false)
    const { renderWidth: w, renderHeight: h } = s.settings
    renderAbort = new AbortController()
    s.setRenderJob({ kind: 'video', done: 0, total: 1, message: `Rendering ${w}×${h}` })
    try {
      const out = await viewport.renderVideo((done, total) => ws().setRenderJob({ kind: 'video', done, total, message: `Frame ${done} / ${total}` }), renderAbort.signal)
      if (out) download(out.blob, `${fileBase()}_${w}x${h}${out.extension}`)
    } catch (e) {
      fail(e)
    } finally {
      renderAbort = null
      ws().setRenderJob(null)
    }
  },

  /**
   * A 360° panorama (equirectangular JPEG, tagged for 360° viewers). From the middle of `room` (a
   * point inside it) or of the room selected on the plan, at eye height; otherwise from where the
   * render camera (or the walkthrough) stands.
   */
  async renderPanorama(room?: { at: Vec2; levelId: string }) {
    const s = ws()
    if (s.renderJob) return
    s.setPlaying(false)
    const p = project()
    const sel = room ?? (s.planSel?.kind === 'room' && s.planSel.at ? { at: s.planSel.at, levelId: p.activeLevelId } : null)
    const pose = viewport.renderPose()
    // Camera position from the orbit pose (three's spherical: polar from +y, azimuth from +z).
    const cam = pose && [pose.target[0] + pose.radius * Math.sin(pose.polar) * Math.sin(pose.azimuth), pose.target[1] + pose.radius * Math.cos(pose.polar), pose.target[2] + pose.radius * Math.sin(pose.polar) * Math.cos(pose.azimuth)]
    const heading = pose ? Math.atan2(-Math.sin(pose.azimuth), -Math.cos(pose.azimuth)) : 0
    let eye: [number, number, number] | null = cam ? [cam[0], cam[1], cam[2]] : null
    if (sel) {
      const face = analyse(p.walls.filter((w) => w.levelId === sel.levelId)).faces.find((f) => pointInPolygon(sel.at, f.polygon))
      let c = face?.center ?? sel.at
      // Stand clear of the furniture (and from under a lamp): the free spot nearest the middle.
      if (face) {
        const { footprint } = await import('@/plan/footprint')
        const first = p.levels[0].id
        const fps = p.objects.filter((o) => !o.parentId && o.visible !== false && (o.levelId ?? first) === sel.levelId && !/rug|paving|decking|socket|switch/.test(o.furniture?.item ?? '')).map((o) => footprint(o))
        const clear = (q: Vec2) => {
          if (!pointInPolygon(q, face.inner)) return false
          for (const f of fps) {
            const dx = q[0] - f.c[0]
            const dz = q[1] - f.c[1]
            const lx = Math.abs(dx * Math.cos(f.yaw) - dz * Math.sin(f.yaw)) - f.w / 2
            const lz = Math.abs(dx * Math.sin(f.yaw) + dz * Math.cos(f.yaw)) - f.d / 2
            if (Math.hypot(Math.max(0, lx), Math.max(0, lz)) < 0.45) return false
          }
          return true
        }
        const spots: Vec2[] = []
        for (let r = 0; r <= 3; r += 0.15) for (let a = 0; a < 16; a++) spots.push([c[0] + r * Math.cos((a * Math.PI) / 8), c[1] + r * Math.sin((a * Math.PI) / 8)])
        c = spots.find(clear) ?? c
      }
      eye = [c[0], (levelElevations(p.levels).get(sel.levelId) ?? 0) + 1.6, c[1]]
    }
    if (!eye) return
    const width = 4096
    const size = 1536
    renderAbort = new AbortController()
    s.setRenderJob({ kind: 'image', done: 0, total: 6, message: '360° panorama' })
    try {
      const blob = await viewport.renderPanorama({ eye, heading, size, width, signal: renderAbort.signal, onFace: (done, total) => ws().setRenderJob({ kind: 'image', done, total, message: `360° panorama · view ${Math.min(total, Math.floor(done) + 1)} / ${total}` }) })
      if (blob) {
        download(blob, `${fileBase()}_360.jpg`)
        ws().setJob({ status: 'done', message: '360° panorama saved: upload it to Facebook, Google Photos, Kuula or Momento360 to look around in it.' })
      }
    } catch (e) {
      fail(e)
    } finally {
      renderAbort = null
      ws().setRenderJob(null)
    }
  },

  cancelRender: () => {
    renderAbort?.abort()
    void import('@/export/pdf').then((m) => m.cancelPdf())
  },

  async exportSelected() {
    const s = ws()
    const obj = project().objects.find((o) => o.id === s.selectedId)
    if (!obj) return
    const blob = await viewport.exportGlb(obj.id)
    if (blob) download(blob, `${obj.name}.glb`)
  },

  /* ───── Modelling ───── */

  /** Add → Box, Cylinder, … : a primitive at the origin, resting on the grid, selected. */
  addPrimitive(label: string) {
    const primitive = newPrimitive(label)
    ws().addObject({
      name: label,
      primitive,
      source: 'Modelled',
      exact: true,
      transform: { position: [0, restingHeight(primitive), 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    })
  },

  /** A part leaves its model and becomes a standalone object, staying exactly where it is. */
  unparentSelected() {
    const s = ws()
    const obj = project().objects.find((o) => o.id === s.selectedId)
    if (!obj?.parentId) return
    const transform = viewport.relativeTransform(obj.id, null)
    if (transform) s.reparent(obj.id, null, transform)
  },

  duplicateSelected() {
    const s = ws()
    if (s.selection.length > 1) return duplicateSelection()
    if (s.selectedId) s.duplicateObject(s.selectedId)
  },
  copy: () => void copySelection(),
  cut: () => cutSelection(),
  paste: () => pasteClipboard(),
  selectAll: () => selectAll(),

  /** Claude parts → separate primitive objects you can edit one by one. */
  separateSelected() {
    const s = ws()
    if (!s.selectedId) return
    const parts = viewport.separate(s.selectedId)
    if (parts) s.replaceObject(s.selectedId, parts)
  },

  async exportScene() {
    const blob = await viewport.exportScene()
    if (blob) download(blob, `${fileBase()}.glb`)
  },

  /* ───── Files ───── */

  pickFiles(accept: string, onFiles: (files: File[]) => void) {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = true
    input.onchange = () => onFiles([...(input.files ?? [])])
    input.click()
  },

  importGlb: () => actions.pickFiles('.glb', importModelFiles),

  /** Dropped .glb files go into the scene. */
  handleDrop(files: File[]) {
    importModelFiles(files)
  },
}

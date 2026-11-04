import { importModelFiles, startGeneration } from '@/generation/run'
import { activeProject, useWorkspace, type ShadingMode, type Transform, type Vec3 } from '@/store/workspace'
import { download, viewport } from '@/viewport/bridge'
import { newPrimitive, restingHeight } from './primitives'

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

  deleteSelected() {
    const { selectedId, removeObject } = ws()
    if (selectedId) removeObject(selectedId)
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

  cancelRender: () => renderAbort?.abort(),

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

  duplicateSelected() {
    const s = ws()
    if (s.selectedId) s.duplicateObject(s.selectedId)
  },

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
  addImages: () => actions.pickFiles('image/*', (f) => ws().addImages(f)),
  generate: () => startGeneration(),

  /** Route dropped files: images → inputs, .glb → scene. */
  handleDrop(files: File[]) {
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (images.length) ws().addImages(images)
    importModelFiles(files)
  },
}

import { importModelFiles, startGeneration } from '@/generation/run'
import { activeProject, useWorkspace, type ShadingMode } from '@/store/workspace'
import { download, viewport } from '@/viewport/bridge'

let renderAbort: AbortController | null = null
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

  insertKey() {
    const s = ws()
    // In camera view the camera may already be the evaluated pose; outside it, the free view is captured.
    const pose = viewport.viewPose()
    if (pose) s.setKey(s.frame, { ...pose, focal: viewport.renderPose(s.frame)?.focal ?? pose.focal })
  },

  deleteKey() {
    const s = ws()
    s.removeKey(s.frame)
  },

  /** 360° orbit around the current shot, constant speed, seamless loop. */
  turntable() {
    const s = ws()
    const anim = project().animation
    const shot = viewport.renderPose(anim.start)
    if (!shot) return
    // Auto-framed shots are fitted for one angle; widen so no angle of the orbit clips.
    const base = project().camera ? shot : { ...shot, radius: viewport.orbitRadius(shot) ?? shot.radius }
    const span = anim.end - anim.start
    // Last frame stops one step short of 360° so the loop doesn't repeat a frame.
    const end = { ...base, azimuth: base.azimuth + (Math.PI * 2 * span) / (span + 1) }
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

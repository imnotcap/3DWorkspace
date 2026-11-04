import { importModelFiles, startGeneration } from '@/generation/run'
import { activeProject, useWorkspace, type ShadingMode } from '@/store/workspace'
import { download, viewport } from '@/viewport/bridge'

/** Shared commands for menus, toolbar and hotkeys. */
export const actions = {
  frameSelected: () => viewport.frameSelected(),
  frameAll: () => viewport.frameAll(),

  deleteSelected() {
    const { selectedId, removeObject } = useWorkspace.getState()
    if (selectedId) removeObject(selectedId)
  },

  cycleShading() {
    const order: ShadingMode[] = ['wireframe', 'solid', 'material', 'rendered']
    const s = useWorkspace.getState()
    s.setShading(order[(order.indexOf(s.shading) + 1) % order.length])
  },

  async renderImage() {
    const blob = await viewport.capture(2)
    if (blob) download(blob, `${activeProject(useWorkspace.getState()).name}.png`)
  },

  async exportSelected() {
    const s = useWorkspace.getState()
    const obj = activeProject(s).objects.find((o) => o.id === s.selectedId)
    if (!obj) return
    const blob = await viewport.exportGlb(obj.id)
    if (blob) download(blob, `${obj.name}.glb`)
  },

  pickFiles(accept: string, onFiles: (files: File[]) => void) {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = true
    input.onchange = () => onFiles([...(input.files ?? [])])
    input.click()
  },

  importGlb: () => actions.pickFiles('.glb', importModelFiles),
  addImages: () => actions.pickFiles('image/*', (f) => useWorkspace.getState().addImages(f)),
  generate: () => startGeneration(),

  /** Route dropped files: images → inputs, .glb → scene. */
  handleDrop(files: File[]) {
    const images = files.filter((f) => f.type.startsWith('image/'))
    if (images.length) useWorkspace.getState().addImages(images)
    importModelFiles(files)
  },
}

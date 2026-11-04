import type { Object3D } from 'three'

/**
 * Imperative handles registered by components inside the Canvas so DOM UI
 * (menus, hotkeys) can drive the viewport without React re-renders.
 */
export const viewport = {
  objects: new Map<string, Object3D>(),
  frameSelected: () => {},
  frameAll: () => {},
  capture: async (_scale?: number): Promise<Blob | null> => null,
  exportGlb: async (_id: string): Promise<Blob | null> => null,
  invalidate: () => {},
}

export function download(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

import type { Object3D } from 'three'
import type { CameraPose } from '@/store/workspace'

export interface VideoResult {
  blob: Blob
  extension: string
}

/**
 * Imperative handles registered by components inside the Canvas so DOM UI
 * (menus, hotkeys, timeline) can drive the viewport without React re-renders.
 */
export const viewport = {
  objects: new Map<string, Object3D>(),
  frameSelected: () => {},
  frameAll: () => {},
  invalidate: () => {},
  exportGlb: async (_id: string): Promise<Blob | null> => null,
  /** Pose of the current viewport view (what you see). */
  viewPose: (): CameraPose | null => null,
  /** Render camera pose at the current frame (keys → static camera → auto framing). */
  renderPose: (_frame?: number): CameraPose | null => null,
  /** Distance that keeps the scene in frame for a full orbit around `pose`. */
  orbitRadius: (_pose: CameraPose): number | null => null,
  renderStill: async (): Promise<Blob | null> => null,
  renderVideo: async (_onFrame: (done: number, total: number) => void, _signal: AbortSignal): Promise<VideoResult | null> => null,
}

export function download(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

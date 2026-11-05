import type { Object3D } from 'three'
import type { CameraPose, SceneObject, Transform } from '@/store/workspace'

/** Path tracer state in the Rendered view, for the sample counter. */
export interface TraceProgress {
  state: 'off' | 'building' | 'sampling' | 'done'
  samples: number
  max: number
}

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
  /** Built house levels (walls, floors…) by level id. */
  houses: new Map<string, Object3D>(),
  frameSelected: () => {},
  frameAll: () => {},
  /** Fit the 2D plan to the view. */
  fitPlan: () => {},
  invalidate: () => {},
  traceProgress: { state: 'off', samples: 0, max: 0 } as TraceProgress,
  onTraceProgress: null as ((p: TraceProgress) => void) | null,
  exportGlb: async (_id: string): Promise<Blob | null> => null,
  exportScene: async (): Promise<Blob | null> => null,
  /** The object's current placement expressed relative to `parentId` (null = the scene). */
  relativeTransform: (_id: string, _parentId: string | null): Transform | null => null,
  /** Claude parts object → editable primitive objects (positions in world space). */
  separate: (_id: string): Omit<SceneObject, 'id'>[] | null => null,
  /** Pose of the current viewport view (what you see). */
  viewPose: (): CameraPose | null => null,
  /** Render camera pose at the current frame (keys → static camera → auto framing). */
  renderPose: (_frame?: number): CameraPose | null => null,
  /** Distance that keeps the scene in frame for a full orbit around `pose`. */
  orbitRadius: (_pose: CameraPose): number | null => null,
  renderStill: async (): Promise<Blob | null> => null,
  /** Render one shot at its own size, with ceilings/levels as asked (PDF pages). */
  renderShot: async (_pose: CameraPose, _opts: { width: number; height: number; transparent?: boolean; ceilings: boolean; maxLevel: number | null; background?: string; samples?: number }): Promise<Blob | null> => null,
  /** A 360° panorama from `eye` (world, m), the middle looking along `heading` (plan yaw): an equirectangular JPEG. */
  renderPanorama: async (_o: { eye: [number, number, number]; heading: number; size: number; width: number; onFace: (done: number, total: number) => void; signal?: AbortSignal }): Promise<Blob | null> => null,
  renderVideo: async (_onFrame: (done: number, total: number) => void, _signal: AbortSignal): Promise<VideoResult | null> => null,
}

export function download(blob: Blob, filename: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

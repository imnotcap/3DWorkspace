import type { Quality } from './types'

/**
 * Hugging Face Space presets. Spaces change their APIs without notice, so the
 * adapter never relies on positional args: it reads `view_api()` at runtime and
 * maps inputs by parameter *name*. `endpoint` / `preprocess` are hints; if the
 * named endpoint disappears, the adapter auto-detects one that takes an image
 * and returns a 3D file.
 *
 * Duplicating a Space into your own HF account and pasting its id avoids the
 * public queue entirely.
 */
export interface SpacePreset {
  id: string
  label: string
  note: string
  multiView: boolean
  textured: boolean
  endpoint?: string
  /** Optional step whose first image output feeds the main endpoint. */
  preprocess?: string
}

export const SPACE_PRESETS: SpacePreset[] = [
  {
    id: 'tencent/Hunyuan3D-2.1',
    label: 'Hunyuan3D-2.1 · PBR',
    note: 'Front image → geometry + PBR textures (color, roughness, metal). Best for materials.',
    multiView: false,
    textured: true,
    endpoint: '/generation_all',
  },
  {
    id: 'tencent/Hunyuan3D-2mv',
    label: 'Hunyuan3D-2mv · shape',
    note: 'Front/back/left/right → untextured geometry. Use when you have full side views.',
    multiView: true,
    textured: false,
    endpoint: '/shape_generation',
  },
  {
    id: 'tencent/Hunyuan3D-2',
    label: 'Hunyuan3D-2 · textured',
    note: 'Front image → geometry + color texture.',
    multiView: false,
    textured: true,
    endpoint: '/generation_all',
  },
  {
    id: 'stabilityai/TripoSR',
    label: 'TripoSR',
    note: 'Single image, fast draft quality.',
    multiView: false,
    textured: true,
    preprocess: '/preprocess',
    endpoint: '/generate',
  },
]

export const QUALITY_PARAMS: Record<Quality, { steps: number; octree: number; mc: number }> = {
  draft: { steps: 20, octree: 192, mc: 192 },
  standard: { steps: 30, octree: 256, mc: 256 },
  high: { steps: 50, octree: 384, mc: 320 },
  ultra: { steps: 50, octree: 512, mc: 512 },
}

export function findPreset(id: string): SpacePreset | undefined {
  return SPACE_PRESETS.find((p) => p.id === id)
}

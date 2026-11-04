import type { Quality } from './types'

/**
 * Hugging Face Space presets.
 *
 * Inputs are mapped by parameter *name* from the Space's live `view_api()`, never
 * by position, so reordered arguments don't break anything. `pipeline` lists the
 * endpoints to call, in order, inside one session (so server-side gr.State carries
 * over); an image returned by one step feeds the next step's image input.
 *
 * Endpoint names come from each Space's app.py (Gradio names unnamed events after
 * the handler function). Duplicating a Space into your own HF account and pasting
 * its id avoids the public queue.
 */
export interface SpacePreset {
  id: string
  label: string
  note: string
  multiView: boolean
  textured: boolean
  pipeline: string[]
  /** Per-quality values for Space-specific parameters, by parameter name. */
  params?: Record<Quality, Record<string, unknown>>
}

export const SPACE_PRESETS: SpacePreset[] = [
  {
    // github.com/microsoft/TRELLIS.2 app.py: preprocess_image → image_to_3d (state) → extract_glb
    id: 'microsoft/TRELLIS.2',
    label: 'TRELLIS.2 · PBR',
    note: 'Front image → geometry up to 1536³ + PBR textures up to 4K. MIT licensed. Best overall.',
    multiView: false,
    textured: true,
    pipeline: ['/preprocess_image', '/image_to_3d', '/extract_glb'],
    params: {
      draft: { resolution: '512', decimation_target: 200000, texture_size: 1024 },
      standard: { resolution: '1024', decimation_target: 500000, texture_size: 2048 },
      high: { resolution: '1536', decimation_target: 800000, texture_size: 4096 },
      ultra: {
        resolution: '1536',
        decimation_target: 1000000,
        texture_size: 4096,
        ss_sampling_steps: 24,
        shape_slat_sampling_steps: 24,
        tex_slat_sampling_steps: 24,
      },
    },
  },
  {
    id: 'tencent/Hunyuan3D-2.1',
    label: 'Hunyuan3D-2.1 · PBR',
    note: 'Front image → geometry + PBR textures. Good alternative to compare against.',
    multiView: false,
    textured: true,
    pipeline: ['/generation_all'],
  },
  {
    id: 'tencent/Hunyuan3D-2mv',
    label: 'Hunyuan3D-2mv · shape',
    note: 'Front/back/left/right → untextured geometry. Use when you have full side views.',
    multiView: true,
    textured: false,
    pipeline: ['/shape_generation'],
  },
  {
    id: 'tencent/Hunyuan3D-2',
    label: 'Hunyuan3D-2 · textured',
    note: 'Front image → geometry + color texture.',
    multiView: false,
    textured: true,
    pipeline: ['/generation_all'],
  },
  {
    id: 'stabilityai/TripoSR',
    label: 'TripoSR',
    note: 'Single image, fast draft quality.',
    multiView: false,
    textured: true,
    pipeline: ['/preprocess', '/generate'],
  },
]

export const DEFAULT_SPACE = SPACE_PRESETS[0].id

export const QUALITY_PARAMS: Record<Quality, { steps: number; octree: number; mc: number }> = {
  draft: { steps: 20, octree: 192, mc: 192 },
  standard: { steps: 30, octree: 256, mc: 256 },
  high: { steps: 50, octree: 384, mc: 320 },
  ultra: { steps: 50, octree: 512, mc: 512 },
}

export function findPreset(id: string): SpacePreset | undefined {
  return SPACE_PRESETS.find((p) => p.id === id)
}

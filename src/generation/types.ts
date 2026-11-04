export type ViewTag = 'auto' | 'front' | 'back' | 'left' | 'right'
export type Quality = 'draft' | 'standard' | 'high'

export interface GenerateInput {
  images: { blob: Blob; view: ViewTag }[]
  quality: Quality
  removeBackground: boolean
  /** undefined = random */
  seed?: number
}

export interface GenerateProgress {
  stage: 'connecting' | 'uploading' | 'queued' | 'processing' | 'downloading'
  message: string
  /** 0..1 when the backend reports it */
  progress?: number
  queuePosition?: number
  etaSeconds?: number
}

export interface GenerateOptions {
  signal: AbortSignal
  onProgress: (p: GenerateProgress) => void
}

export interface GenerateResult {
  glb: Blob
  /** Human-readable source, e.g. "tencent/Hunyuan3D-2mv" */
  source: string
}

/** Every backend (HF Space, local worker, paid API) implements this. */
export interface Provider {
  id: ProviderId
  label: string
  generate(input: GenerateInput, opts: GenerateOptions): Promise<GenerateResult>
}

export type ProviderId = 'hf-space' | 'local-worker'

export class GenerationError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message)
    this.name = 'GenerationError'
  }
}

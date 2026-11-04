/**
 * front: the photo SAM 3D builds from (a full view of the whole object).
 * back/left/right/detail: kept as reference for you; SAM 3D works from one photo.
 */
export type ViewTag = 'front' | 'back' | 'left' | 'right' | 'detail'
export type Quality = 'draft' | 'standard' | 'high' | 'ultra'

export interface GenerateProgress {
  stage: 'connecting' | 'uploading' | 'queued' | 'processing' | 'downloading'
  message: string
  /** 0..1 when known */
  progress?: number
  queuePosition?: number
  etaSeconds?: number
}

export class GenerationError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message)
    this.name = 'GenerationError'
  }
}

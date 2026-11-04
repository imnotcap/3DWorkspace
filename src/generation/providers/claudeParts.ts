import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import type { RealSize } from '@/store/workspace'
import { buildGroup, renderPreview, toGlb } from '../parts/build'
import { CHECK_PROMPT, PartsSpec, SYSTEM_PROMPT } from '../parts/spec'
import { GenerationError, type GenerateInput, type GenerateOptions, type GenerateResult, type Provider, type Quality, type ViewTag } from '../types'

export const CLAUDE_MODELS = {
  'claude-opus-5-5': { label: 'Claude Opus 5.5', input: 4, output: 20 },
  'claude-sonnet-5-5': { label: 'Claude Sonnet 5.5', input: 2, output: 10 },
} as const
export type ClaudeModel = keyof typeof CLAUDE_MODELS

export interface ClaudePartsSettings {
  apiKey: string
  model: ClaudeModel
  selfCheck: boolean
}

const EFFORT: Record<Quality, 'medium' | 'high' | 'xhigh'> = { draft: 'medium', standard: 'high', high: 'high', ultra: 'xhigh' }
const VIEW_LABEL: Record<ViewTag, string> = { front: 'Front (full view)', back: 'Back (full view)', left: 'Left side (full view)', right: 'Right side (full view)', detail: 'Detail close-up' }
const MAX_EDGE = 2048

type ImageBlock = Anthropic.Beta.BetaImageBlockParam
type Content = Anthropic.Beta.BetaContentBlockParam[]

async function toBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** Downscale to MAX_EDGE (fewer image tokens, same detail Claude can use) and send as JPEG/PNG. */
async function imageBlock(blob: Blob, png = false): Promise<ImageBlock> {
  const bmp = await createImageBitmap(blob)
  const k = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height))
  const canvas = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k))
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff' // flatten transparency onto white
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  const type = png ? 'image/png' : 'image/jpeg'
  const out = await canvas.convertToBlob({ type, quality: 0.9 })
  return { type: 'image', source: { type: 'base64', media_type: type, data: await toBase64(out) } }
}

function sizeText(rs: RealSize | null | undefined) {
  if (!rs) return 'No real dimensions were given: estimate them from standard sizes for this kind of product, and list them in assumptions.'
  const cm = (v?: number) => (v ? `${+(v * 100).toFixed(1)} cm` : 'not given (follow the photos\' proportions)')
  return `Real dimensions (exact, must match the bounding box): width X = ${cm(rs.x)}, height Y = ${cm(rs.y)}, depth Z = ${cm(rs.z)}.`
}

/** Reference photos first, front first, and the last one marked for prompt caching (reused by the self-check). */
async function referenceContent(images: GenerateInput['images']): Promise<Content> {
  const ordered = [...images].sort((a, b) => (a.view === 'front' ? -1 : b.view === 'front' ? 1 : 0))
  const content: Content = []
  for (const [i, img] of ordered.entries()) {
    content.push({ type: 'text', text: `Image ${i + 1}: ${VIEW_LABEL[img.view]}` })
    content.push(await imageBlock(img.blob))
  }
  const last = content[content.length - 1] as ImageBlock
  last.cache_control = { type: 'ephemeral' }
  return content
}

function friendly(e: unknown): never {
  if (e instanceof Anthropic.APIUserAbortError) throw new DOMException('Cancelled', 'AbortError')
  if (e instanceof Anthropic.AuthenticationError) throw new GenerationError('Claude rejected the API key.', 'Paste a valid key from console.anthropic.com in Generate settings.')
  if (e instanceof Anthropic.PermissionDeniedError) throw new GenerationError('This API key may not use that model.', 'Ask your Console admin to enable it for the key\'s workspace.')
  if (e instanceof Anthropic.RateLimitError) throw new GenerationError('Claude rate limit or spend limit reached.', 'Wait a minute, or check the workspace limits in the Console.')
  if (e instanceof Anthropic.BadRequestError) throw new GenerationError(`Claude refused the request: ${e.message}`)
  if (e instanceof Anthropic.APIError) throw new GenerationError(`Claude API error ${e.status ?? ''}: ${e.message}`, 'Try again in a moment.')
  throw e
}

interface Usage {
  costUsd: number
}

/** One structured-output call: streams progress, returns a validated spec. */
async function design(client: Anthropic, s: ClaudePartsSettings, quality: Quality, content: Content, opts: GenerateOptions, phase: string, usage: Usage): Promise<PartsSpec> {
  let stream
  try {
    stream = client.beta.messages.stream(
      {
        model: s.model,
        max_tokens: 64000,
        // On a policy decline the API re-runs the request on a fallback model instead of failing.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive', display: 'summarized' },
        output_config: { effort: EFFORT[quality], format: betaZodOutputFormat(PartsSpec) },
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
      },
      { signal: opts.signal },
    )
    stream.on('thinking', (_d, snap) => {
      const line = snap.trim().split('\n').filter(Boolean).at(-1) ?? ''
      opts.onProgress({ stage: 'processing', message: `${phase} · ${line.replace(/\*\*/g, '').slice(0, 90)}` })
    })
    stream.on('text', (_d, snap) => opts.onProgress({ stage: 'processing', message: `${phase} · writing parts (${(snap.length / 1000).toFixed(1)}k chars)` }))
    const msg = await stream.finalMessage()
    const price = CLAUDE_MODELS[s.model]
    const u = msg.usage
    usage.costUsd +=
      (((u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) * 1.25 + (u.cache_read_input_tokens ?? 0) * 0.1) * price.input + (u.output_tokens ?? 0) * price.output) / 1e6

    if (msg.stop_reason === 'refusal') throw new GenerationError('Claude declined to model this.', msg.stop_details?.explanation ?? undefined)
    if (msg.stop_reason === 'max_tokens') throw new GenerationError('The model description was too long to finish.', 'Try Draft quality, or a simpler object.')
    const text = msg.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      throw new GenerationError('Claude returned malformed parts data.', 'Try again.')
    }
    const parsed = PartsSpec.safeParse(json)
    if (!parsed.success) throw new GenerationError('Claude returned parts data in an unexpected shape.', 'Try again.')
    return parsed.data
  } catch (e) {
    if (e instanceof GenerationError) throw e
    friendly(e)
  }
}

function client(s: ClaudePartsSettings) {
  if (!s.apiKey.trim()) throw new GenerationError('Add your Anthropic API key in Generate settings.', 'Create one at console.anthropic.com. It is stored only in this browser.')
  // The user's own key, used from their own browser; never bundled or sent anywhere but api.anthropic.com.
  return new Anthropic({ apiKey: s.apiKey.trim(), dangerouslyAllowBrowser: true, maxRetries: 2 })
}

async function finish(spec: PartsSpec, model: ClaudeModel, usage: Usage, opts: GenerateOptions): Promise<GenerateResult> {
  opts.onProgress({ stage: 'downloading', message: 'Building parts' })
  const { group, warnings } = buildGroup(spec)
  return {
    glb: await toGlb(group),
    source: CLAUDE_MODELS[model].label,
    exact: true,
    spec,
    costUsd: usage.costUsd,
    warnings,
    photoView: spec.photo_view,
  }
}

/** Draw the current spec from its photo angle and let Claude correct it against the photos. */
async function selfCheck(c: Anthropic, s: ClaudePartsSettings, quality: Quality, refs: Content, spec: PartsSpec, extra: string, opts: GenerateOptions, usage: Usage) {
  opts.onProgress({ stage: 'processing', message: 'Rendering a check view' })
  const preview = await renderPreview(buildGroup(spec).group, spec, 1024, 1024)
  return design(
    c,
    s,
    quality,
    [
      ...refs,
      { type: 'text', text: `${extra}\n\nYour current spec:\n${JSON.stringify(spec)}` },
      { type: 'text', text: 'Render of the current spec:' },
      await imageBlock(preview, true),
      { type: 'text', text: CHECK_PROMPT },
    ],
    opts,
    'Self-check',
    usage,
  )
}

export function createClaudePartsProvider(s: ClaudePartsSettings): Provider {
  return {
    id: 'claude-parts',
    label: 'Claude parts',
    async generate(input, opts): Promise<GenerateResult> {
      if (!input.images.some((i) => i.view === 'front')) throw new GenerationError('Tag one image as Front.', 'Detail photos are used too, for small parts.')
      const c = client(s)
      const usage: Usage = { costUsd: 0 }
      opts.onProgress({ stage: 'uploading', message: `Sending ${input.images.length} photo${input.images.length > 1 ? 's' : ''} to ${CLAUDE_MODELS[s.model].label}` })
      const refs = await referenceContent(input.images)
      const size = sizeText(input.realSize)
      let spec = await design(c, s, input.quality, [...refs, { type: 'text', text: `${size}\n\nModel this product as exact parts.` }], opts, 'Designing', usage)
      if (s.selfCheck) spec = await selfCheck(c, s, input.quality, refs, spec, size, opts, usage)
      return finish(spec, s.model, usage, opts)
    },
  }
}

/** "Make the top thinner", etc.: edits an existing spec, then (optionally) self-checks it. */
export async function refineParts(s: ClaudePartsSettings, input: GenerateInput, spec: PartsSpec, feedback: string, opts: GenerateOptions): Promise<GenerateResult> {
  const c = client(s)
  const usage: Usage = { costUsd: 0 }
  opts.onProgress({ stage: 'uploading', message: 'Sending change request' })
  const refs = input.images.length ? await referenceContent(input.images) : []
  const size = sizeText(input.realSize)
  let next = await design(
    c,
    s,
    input.quality,
    [
      ...refs,
      { type: 'text', text: `${size}\n\nCurrent spec:\n${JSON.stringify(spec)}\n\nChange request from the user: ${feedback}\n\nApply the change and keep everything else as it is. Return the complete spec.` },
    ],
    opts,
    'Refining',
    usage,
  )
  if (s.selfCheck && refs.length) next = await selfCheck(c, s, input.quality, refs, next, `${size}\nThe user asked: ${feedback}`, opts, usage)
  return finish(next, s.model, usage, opts)
}

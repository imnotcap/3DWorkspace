import { Client, handle_file, type Status } from '@gradio/client'
import { QUALITY_PARAMS, findPreset, type SpacePreset } from '../spaces'
import {
  GenerationError,
  type GenerateInput,
  type GenerateOptions,
  type GenerateResult,
  type Provider,
  GEOMETRY_VIEWS,
} from '../types'

export interface HfSpaceSettings {
  spaceId: string
  token: string
}

type ApiInfo = Awaited<ReturnType<Client['view_api']>>
type Params = ApiInfo['named_endpoints'][string]['parameters']
type JsApiData = Params[number]

const MODEL_EXT = /\.(glb|gltf)(\?|$)/i

type Views = Partial<Record<(typeof GEOMETRY_VIEWS)[number], Blob>>

/** First image per geometry view. Detail shots are never sent. */
function assignViews(images: GenerateInput['images']): Views {
  const out: Views = {}
  for (const img of images) if (img.view !== 'detail' && !out[img.view]) out[img.view] = img.blob
  return out
}

type Primary = Blob | Record<string, unknown>

/**
 * Map a parameter name to a value. `undefined` = keep the Space's default.
 * Presets with their own parameter table get only that table plus the core inputs;
 * generic quality rules are for Spaces we have no table for.
 */
function resolveParam(name: string, input: GenerateInput, views: Views, primary: Primary, preset?: SpacePreset): unknown {
  const n = name.toLowerCase()
  const q = QUALITY_PARAMS[input.quality]
  const file = (b: Blob | undefined) => (b ? handle_file(b) : null)
  const table = preset?.params?.[input.quality]
  if (table && name in table) return table[name]

  if (/front/.test(n)) return file(views.front)
  if (/back/.test(n) && !/background/.test(n)) return file(views.back)
  if (/left/.test(n)) return file(views.left)
  if (/right/.test(n)) return file(views.right)
  // A Blob is a local photo to upload; an object is a file already on the Space (previous step's output).
  if (/^(image|input_image|img|input|processed_image)$/.test(n)) return primary instanceof Blob ? handle_file(primary) : primary
  if (/caption|prompt|text/.test(n)) return null
  if (/rembg|remove_background|do_remove_background/.test(n)) return input.removeBackground
  if (/randomize/.test(n)) return input.seed === undefined
  if (n === 'seed') return input.seed ?? Math.floor(Math.random() * 2 ** 31)
  if (table) return undefined
  if (/steps/.test(n)) return q.steps
  if (/octree/.test(n)) return q.octree
  if (/mc_resolution|resolution/.test(n)) return q.mc
  return undefined
}

function isImageParam(p: JsApiData) {
  return /image|img|front/i.test(p.parameter_name ?? p.label) || p.component === 'Image'
}
function returnsModel(ep: { returns: Params }) {
  return ep.returns.some((r) => /^(model3d|file|downloadbutton)$/i.test(r.component))
}

function pickEndpoint(api: ApiInfo, hint?: string): string {
  if (hint && api.named_endpoints[hint]) return hint
  const found = Object.entries(api.named_endpoints).find(([, ep]) => ep.parameters.some(isImageParam) && returnsModel(ep))
  if (!found) throw new GenerationError('This Space has no endpoint that turns an image into a 3D file.', 'Pick a different Space in Generate settings.')
  return found[0]
}

function buildPayload(params: Params, input: GenerateInput, views: Views, primary: Primary, preset?: SpacePreset) {
  const payload: Record<string, unknown> = {}
  for (const p of params) {
    // gr.State inputs are held per session on the server (TRELLIS keeps its latents there); never send them.
    if (p.component?.toLowerCase() === 'state') continue
    const name = p.parameter_name ?? p.label
    if (!name) continue
    const v = resolveParam(name, input, views, primary, preset)
    if (v !== undefined) payload[name] = v
    else if (p.parameter_has_default) payload[name] = p.parameter_default
  }
  return payload
}

/** First image-like file in a step's output, to feed the next step. */
function findImage(data: unknown): Record<string, unknown> | undefined {
  const list = Array.isArray(data) ? data : [data]
  return list.find((v): v is Record<string, unknown> => {
    if (!v || typeof v !== 'object') return false
    const o = v as Record<string, unknown>
    const url = String(o.url ?? o.path ?? '')
    return !!url && !MODEL_EXT.test(url)
  })
}

function stepLabel(endpoint: string) {
  if (/pre/i.test(endpoint)) return 'Preparing image'
  if (/extract|export|glb/i.test(endpoint)) return 'Baking textures and exporting'
  return 'Generating 3D'
}

/** Collect every file-like output; prefer textured GLBs. */
function findModelUrl(data: unknown): string | undefined {
  const urls: string[] = []
  const walk = (v: unknown) => {
    if (!v) return
    if (Array.isArray(v)) return v.forEach(walk)
    if (typeof v === 'object') {
      const o = v as Record<string, unknown>
      const url = (o.url ?? o.path) as string | undefined
      const name = (o.orig_name ?? url ?? '') as string
      if (typeof url === 'string' && MODEL_EXT.test(name + ' ' + url)) urls.push(url)
      else Object.values(o).forEach(walk)
    }
  }
  walk(data)
  return urls.find((u) => /textured|texture/i.test(u)) ?? urls[0]
}

const QUOTA_HINT = 'Free GPU quota reached. Add a free Hugging Face token in Generate settings, lower Quality, or try again later.'

async function run(client: Client, endpoint: string, payload: Record<string, unknown>, opts: GenerateOptions, label: string) {
  const job = client.submit(endpoint, payload)
  let lastLog = ''
  const abort = () => void job.cancel()
  opts.signal.addEventListener('abort', abort, { once: true })
  try {
    for await (const msg of job) {
      if (opts.signal.aborted) throw new DOMException('Cancelled', 'AbortError')
      if (msg.type === 'status') {
        const s = msg as unknown as Status
        if (s.stage === 'error') {
          const m = (typeof s.message === 'string' && s.message) || lastLog || 'The Space returned an error.'
          throw new GenerationError(m, /quota|gpu|zerogpu/i.test(m) ? QUOTA_HINT : s.broken ? 'Lost the connection to the Space. Try again.' : undefined)
        }
        if (s.stage === 'pending') {
          opts.onProgress({ stage: 'queued', message: s.position != null ? `Queued · position ${s.position + 1}` : 'Queued', queuePosition: s.position, etaSeconds: s.eta })
        } else if (s.stage === 'generating') {
          const pd = s.progress_data?.[0]
          const progress = pd?.index != null && pd.length ? pd.index / pd.length : undefined
          opts.onProgress({ stage: 'processing', message: pd?.desc ?? label, progress, etaSeconds: s.eta })
        }
      } else if (msg.type === 'log') {
        const l = msg as unknown as { log: string; level: string }
        if (l.level === 'warning' || l.level === 'error') lastLog = l.log
      } else if (msg.type === 'data') {
        return (msg as { data: unknown }).data
      }
    }
  } finally {
    opts.signal.removeEventListener('abort', abort)
  }
  // A job that ends with success=false and no error text closes the stream silently (ZeroGPU aborts do this).
  throw new GenerationError(lastLog || 'The Space stopped without returning a result.', /quota|gpu/i.test(lastLog) || !lastLog ? QUOTA_HINT : undefined)
}

export function createHfSpaceProvider(settings: HfSpaceSettings): Provider {
  return {
    id: 'hf-space',
    label: 'Hugging Face Space',
    async generate(input, opts): Promise<GenerateResult> {
      if (!input.images.some((i) => i.view === 'front'))
        throw new GenerationError('Tag one image as Front.', 'Front must show the whole object. Close-ups should be tagged Detail.')
      const preset = findPreset(settings.spaceId)
      const token = settings.token.trim() as `hf_${string}` | ''

      opts.onProgress({ stage: 'connecting', message: `Connecting to ${settings.spaceId}` })
      let client: Client
      try {
        // The client publishes only 'data' events by default; without 'status' every Space error,
        // queue position and progress update is silently dropped.
        client = await Client.connect(settings.spaceId, { events: ['data', 'status', 'log'], ...(token ? { token } : {}) })
      } catch (e) {
        throw new GenerationError(`Could not reach ${settings.spaceId}.`, 'The Space may be sleeping, renamed, or private. Check the id or try again in a minute.')
      }

      try {
        const api = await client.view_api()
        const views = assignViews(input.images)
        let primary: Primary = views.front!
        const steps = preset?.pipeline ?? [pickEndpoint(api)]
        let data: unknown

        // All steps share one client session, so Spaces that keep results in gr.State (TRELLIS) work.
        for (const [i, wanted] of steps.entries()) {
          const name = api.named_endpoints[wanted] ? wanted : steps.length === 1 ? pickEndpoint(api) : null
          if (!name)
            throw new GenerationError(`${settings.spaceId} no longer has the ${wanted} step.`, 'The Space changed its API. Pick another model in Generate settings.')
          const label = `${stepLabel(name)}${steps.length > 1 ? ` · ${i + 1}/${steps.length}` : ''}`
          opts.onProgress({ stage: i === 0 ? 'uploading' : 'processing', message: label })
          data = await run(client, name, buildPayload(api.named_endpoints[name].parameters, input, views, primary, preset), opts, label)
          if (i < steps.length - 1) primary = findImage(data) ?? primary
        }

        const url = findModelUrl(data)
        if (!url) throw new GenerationError('The Space finished but returned no .glb file.')

        opts.onProgress({ stage: 'downloading', message: 'Downloading mesh' })
        const res = await fetch(url, { signal: opts.signal, headers: token ? { Authorization: `Bearer ${token}` } : undefined })
        if (!res.ok) throw new GenerationError(`Download failed (${res.status}).`)
        return { glb: await res.blob(), source: settings.spaceId }
      } finally {
        client.close()
      }
    },
  }
}

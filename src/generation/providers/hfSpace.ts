import { Client, handle_file, type Status } from '@gradio/client'
import { QUALITY_PARAMS, findPreset } from '../spaces'
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

/** Map a parameter name to a value from our generic input. `undefined` = keep Space default. */
function resolveParam(name: string, input: GenerateInput, views: Views, primary: Blob | string): unknown {
  const n = name.toLowerCase()
  const q = QUALITY_PARAMS[input.quality]
  const file = (b: Blob | undefined) => (b ? handle_file(b) : null)

  if (/front/.test(n)) return file(views.front)
  if (/back/.test(n) && !/background/.test(n)) return file(views.back)
  if (/left/.test(n)) return file(views.left)
  if (/right/.test(n)) return file(views.right)
  if (/^(image|input_image|img|input|processed_image)$/.test(n)) return typeof primary === 'string' ? primary : handle_file(primary)
  if (/caption|prompt|text/.test(n)) return null
  if (/rembg|remove_background|do_remove_background/.test(n)) return input.removeBackground
  if (/randomize/.test(n)) return input.seed === undefined
  if (n === 'seed') return input.seed ?? Math.floor(Math.random() * 2 ** 31)
  if (/steps/.test(n)) return q.steps
  if (/octree/.test(n)) return q.octree
  if (/mc_resolution|resolution/.test(n)) return q.mc
  return undefined
}

function isImageParam(p: JsApiData) {
  return /image|img|front/i.test(p.parameter_name ?? p.label) || p.component === 'Image'
}
function returnsModel(ep: { returns: Params }) {
  return ep.returns.some((r) => r.component === 'Model3D' || r.component === 'File')
}

function pickEndpoint(api: ApiInfo, hint?: string): string {
  if (hint && api.named_endpoints[hint]) return hint
  const found = Object.entries(api.named_endpoints).find(([, ep]) => ep.parameters.some(isImageParam) && returnsModel(ep))
  if (!found) throw new GenerationError('This Space has no endpoint that turns an image into a 3D file.', 'Pick a different Space in Generate settings.')
  return found[0]
}

function buildPayload(params: Params, input: GenerateInput, views: Views, primary: Blob | string) {
  const payload: Record<string, unknown> = {}
  for (const p of params) {
    const name = p.parameter_name ?? p.label
    const v = resolveParam(name, input, views, primary)
    if (v !== undefined) payload[name] = v
    else if (p.parameter_has_default) payload[name] = p.parameter_default
  }
  return payload
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

async function run(client: Client, endpoint: string, payload: Record<string, unknown>, opts: GenerateOptions, label: string) {
  const job = client.submit(endpoint, payload)
  const abort = () => void job.cancel()
  opts.signal.addEventListener('abort', abort, { once: true })
  try {
    for await (const msg of job) {
      if (opts.signal.aborted) throw new DOMException('Cancelled', 'AbortError')
      if (msg.type === 'status') {
        const s = msg as unknown as Status
        if (s.stage === 'error') {
          const m = typeof s.message === 'string' ? s.message : 'The Space returned an error.'
          throw new GenerationError(m, /quota|GPU/i.test(m) ? 'Free GPU quota reached. Add a Hugging Face token, or duplicate the Space.' : undefined)
        }
        if (s.stage === 'pending') {
          opts.onProgress({ stage: 'queued', message: s.position != null ? `Queued · position ${s.position + 1}` : 'Queued', queuePosition: s.position, etaSeconds: s.eta })
        } else if (s.stage === 'generating') {
          const pd = s.progress_data?.[0]
          const progress = pd?.index != null && pd.length ? pd.index / pd.length : undefined
          opts.onProgress({ stage: 'processing', message: pd?.desc ?? label, progress, etaSeconds: s.eta })
        }
      } else if (msg.type === 'data') {
        return (msg as { data: unknown }).data
      }
    }
  } finally {
    opts.signal.removeEventListener('abort', abort)
  }
  throw new GenerationError('The Space closed the connection without a result.')
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
        client = await Client.connect(settings.spaceId, token ? { token } : {})
      } catch (e) {
        throw new GenerationError(`Could not reach ${settings.spaceId}.`, 'The Space may be sleeping, renamed, or private. Check the id or try again in a minute.')
      }

      try {
        const api = await client.view_api()
        const views = assignViews(input.images)
        let primary: Blob | string = views.front!

        if (preset?.preprocess && api.named_endpoints[preset.preprocess]) {
          opts.onProgress({ stage: 'uploading', message: 'Preprocessing image' })
          const pre = api.named_endpoints[preset.preprocess]
          const out = await run(client, preset.preprocess, buildPayload(pre.parameters, input, views, primary), opts, 'Preprocessing')
          const first = Array.isArray(out) ? out[0] : out
          if (first && typeof first === 'object') primary = first as unknown as string
        }

        const endpoint = pickEndpoint(api, preset?.endpoint)
        const ep = api.named_endpoints[endpoint]
        opts.onProgress({ stage: 'uploading', message: 'Uploading images' })
        const data = await run(client, endpoint, buildPayload(ep.parameters, input, views, primary), opts, 'Generating mesh')

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

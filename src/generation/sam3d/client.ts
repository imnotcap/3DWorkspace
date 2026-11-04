import { Client, FileData, type Status } from '@gradio/client'
import { GenerationError, type GenerateProgress } from '../types'

/**
 * Connection to the SAM 3D server (worker/sam3d/app.py): a Gradio app, local or on a
 * Hugging Face Space. One connection is reused for clicks and parts, and the photo is
 * uploaded once per run, not once per part.
 */

export interface ServerSettings {
  /** http(s)://host:port, or a Hugging Face Space id (user/space) */
  server: string
  token: string
}

export interface CallOptions {
  signal?: AbortSignal
  onProgress?: (p: GenerateProgress) => void
  label?: string
}

const SETUP_HINT = 'Start the SAM 3D server (worker/sam3d, see its README), or check the server address in Generate settings.'
const QUOTA_HINT = 'The Space ran out of GPU time or hit its limit. Try again later, use a token with more quota, or run the server on your own GPU.'

let cached: { key: string; conn: Promise<Sam3dConnection> } | null = null

export function connectSam3d(settings: ServerSettings): Promise<Sam3dConnection> {
  const server = settings.server.trim()
  const token = settings.token.trim()
  const key = `${server}\n${token}`
  if (cached?.key === key) return cached.conn
  const conn = Sam3dConnection.open(server, token)
  cached = { key, conn }
  conn.catch(() => cached?.conn === conn && (cached = null))
  return conn
}

/** Drop the cached connection (after a broken stream); the next call reconnects. */
export function resetSam3d() {
  void cached?.conn.then((c) => c.close()).catch(() => {})
  cached = null
}

export class Sam3dConnection {
  private constructor(
    readonly server: string,
    private readonly client: Client,
    private readonly token: string,
    readonly backend: string,
  ) {}

  static async open(server: string, token: string): Promise<Sam3dConnection> {
    if (!server) throw new GenerationError('No SAM 3D server set.', SETUP_HINT)
    let client: Client
    try {
      // Gradio publishes only 'data' by default; without 'status' every error, queue position and progress would be dropped.
      client = await Client.connect(server, { events: ['data', 'status', 'log'], ...(token ? { token: token as `hf_${string}` } : {}) })
    } catch {
      throw new GenerationError(`Could not reach the SAM 3D server at ${server}.`, SETUP_HINT)
    }
    let backend = 'sam3d'
    try {
      const api = await client.view_api()
      for (const ep of ['/segment', '/segment_points', '/reconstruct'])
        if (!api.named_endpoints[ep]) throw new GenerationError(`${server} is not a SAM 3D server (no ${ep}).`, SETUP_HINT)
      const res = await client.predict<unknown[]>('/info', {})
      const info = JSON.parse(String(res.data?.[0] ?? '{}')) as { backend?: string }
      backend = info.backend ?? backend
    } catch (e) {
      client.close()
      if (e instanceof GenerationError) throw e
      throw new GenerationError(`${server} did not answer like a SAM 3D server.`, SETUP_HINT)
    }
    return new Sam3dConnection(server, client, token, backend)
  }

  close() {
    this.client.close()
  }

  /** Upload once; the result can be passed to every later call in this session. */
  async upload(file: File): Promise<FileData> {
    const root = this.client.config?.root
    if (!root) throw new GenerationError('The SAM 3D server sent no address for uploads.')
    const res = await this.client.upload_files(root, [file])
    const path = res.files?.[0]
    if (res.error || !path) throw new GenerationError(`Uploading the photo failed. ${res.error ?? ''}`.trim())
    return new FileData({ path, orig_name: file.name, size: file.size, mime_type: file.type })
  }

  /** Run one endpoint and return its outputs (stream of status events → progress). */
  async call(endpoint: string, payload: Record<string, unknown>, opts: CallOptions = {}): Promise<unknown[]> {
    const { signal, onProgress, label = 'Working' } = opts
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    const job = this.client.submit(endpoint, payload)
    let lastLog = ''
    const abort = () => void job.cancel()
    signal?.addEventListener('abort', abort, { once: true })
    try {
      for await (const msg of job) {
        if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
        if (msg.type === 'status') {
          const s = msg as unknown as Status
          if (s.stage === 'error') {
            const m = (typeof s.message === 'string' && s.message) || lastLog || 'The SAM 3D server returned an error.'
            if (s.broken) resetSam3d()
            throw new GenerationError(m, /quota|zerogpu|gpu task aborted/i.test(m) ? QUOTA_HINT : s.broken ? 'Lost the connection to the SAM 3D server. Try again.' : undefined)
          }
          if (s.stage === 'pending')
            onProgress?.({ stage: 'queued', message: s.position != null ? `${label} · queued, position ${s.position + 1}` : `${label} · queued`, queuePosition: s.position, etaSeconds: s.eta })
          else if (s.stage === 'generating') onProgress?.({ stage: 'processing', message: label, etaSeconds: s.eta })
        } else if (msg.type === 'log') {
          const l = msg as unknown as { log: string; level: string }
          if (l.level === 'warning' || l.level === 'error') lastLog = l.log
        } else if (msg.type === 'data') {
          return (msg as { data: unknown[] }).data
        }
      }
    } finally {
      signal?.removeEventListener('abort', abort)
    }
    resetSam3d()
    throw new GenerationError(lastLog || 'The SAM 3D server stopped without returning a result.', SETUP_HINT)
  }

  /** Call an endpoint whose first output is JSON text. */
  async json<T>(endpoint: string, payload: Record<string, unknown>, opts?: CallOptions): Promise<{ value: T; outputs: unknown[] }> {
    const outputs = await this.call(endpoint, payload, opts)
    try {
      return { value: JSON.parse(String(outputs[0])) as T, outputs }
    } catch {
      throw new GenerationError(`The SAM 3D server sent an unreadable answer from ${endpoint}.`)
    }
  }

  async download(file: unknown, signal?: AbortSignal): Promise<Blob> {
    const f = file as { url?: string; path?: string } | null
    const url = f?.url
    if (!url) throw new GenerationError('The SAM 3D server returned no mesh file.')
    const res = await fetch(url, { signal, headers: this.token ? { Authorization: `Bearer ${this.token}` } : undefined })
    if (!res.ok) throw new GenerationError(`Downloading a part failed (${res.status}).`)
    return res.blob()
  }
}

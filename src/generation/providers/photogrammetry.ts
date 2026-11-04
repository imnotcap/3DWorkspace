import { GenerationError, type GenerateResult, type Provider } from '../types'

export interface PhotogrammetrySettings {
  url: string
}

const POLL_MS = 2000
const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(t), reject(new DOMException('Cancelled', 'AbortError'))), { once: true })
  })

/**
 * Talks to worker/photogrammetry (COLMAP + OpenMVS). Every photo is used; view tags don't apply.
 * Jobs take minutes to an hour, so this submits, then polls progress.
 */
export function createPhotogrammetryProvider(settings: PhotogrammetrySettings): Provider {
  const base = settings.url.replace(/\/+$/, '')
  return {
    id: 'photogrammetry',
    label: 'Photogrammetry',
    async generate(input, opts): Promise<GenerateResult> {
      if (input.images.length < 3) throw new GenerationError('Photogrammetry needs at least 3 photos.', 'Shoot 30–80 overlapping photos all the way around the object.')

      opts.onProgress({ stage: 'connecting', message: `Connecting to ${base}` })
      let health: { ok: boolean; missing?: string[] }
      try {
        const res = await fetch(`${base}/health`, { signal: opts.signal })
        health = await res.json()
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e
        throw new GenerationError(`No photogrammetry worker at ${base}.`, 'Start it with: cd worker/photogrammetry && docker compose up (see its README).')
      }
      if (!health.ok) throw new GenerationError(`The worker is missing ${health.missing?.join(', ') || 'its tools'}.`, 'Run it with Docker so COLMAP and OpenMVS are installed.')

      const form = new FormData()
      input.images.forEach((img, i) => form.append('images', img.blob, (img.blob as File).name || `photo_${i}.jpg`))
      form.append('quality', input.quality)
      opts.onProgress({ stage: 'uploading', message: `Uploading ${input.images.length} photos` })
      const created = await fetch(`${base}/jobs`, { method: 'POST', body: form, signal: opts.signal })
      if (!created.ok) throw new GenerationError(`Worker refused the job (${created.status}). ${(await created.text()).slice(0, 200)}`)
      const { id } = (await created.json()) as { id: string }

      const cancel = () => void fetch(`${base}/jobs/${id}`, { method: 'DELETE' }).catch(() => {})
      opts.signal.addEventListener('abort', cancel, { once: true })
      try {
        for (;;) {
          await sleep(POLL_MS, opts.signal)
          const res = await fetch(`${base}/jobs/${id}`, { signal: opts.signal })
          if (!res.ok) throw new GenerationError(`Lost the job (${res.status}).`, 'The worker may have restarted.')
          const st = (await res.json()) as { status: string; stage: string; progress: number; message: string; position: number | null }
          if (st.status === 'error') throw new GenerationError(st.message || 'Reconstruction failed.', 'Most failures mean too little overlap between photos. Shoot more, closer together.')
          if (st.status === 'cancelled') throw new DOMException('Cancelled', 'AbortError')
          if (st.status === 'done') break
          if (st.status === 'queued') opts.onProgress({ stage: 'queued', message: st.position != null ? `Queued · ${st.position + 1} ahead` : 'Queued', queuePosition: st.position ?? undefined })
          else opts.onProgress({ stage: 'processing', message: st.stage, progress: st.progress })
        }
        opts.onProgress({ stage: 'downloading', message: 'Downloading scan' })
        const out = await fetch(`${base}/jobs/${id}/result`, { signal: opts.signal })
        if (!out.ok) throw new GenerationError(`Download failed (${out.status}).`)
        return { glb: await out.blob(), source: 'Photogrammetry' }
      } finally {
        opts.signal.removeEventListener('abort', cancel)
      }
    },
  }
}

import { GenerationError, type GenerateResult, type Provider } from '../types'

export interface LocalWorkerSettings {
  url: string
}

/** Talks to `worker/` (FastAPI). Contract: POST /generate multipart → model/gltf-binary. */
export function createLocalWorkerProvider(settings: LocalWorkerSettings): Provider {
  const base = settings.url.replace(/\/+$/, '')
  return {
    id: 'local-worker',
    label: 'Local worker',
    async generate(input, opts): Promise<GenerateResult> {
      opts.onProgress({ stage: 'connecting', message: `Connecting to ${base}` })
      try {
        const health = await fetch(`${base}/health`, { signal: opts.signal })
        if (!health.ok) throw new Error()
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e
        throw new GenerationError(`No worker at ${base}.`, 'Start it with: docker compose up (see worker/README.md).')
      }

      const form = new FormData()
      input.images.forEach((img, i) => {
        form.append('images', img.blob, `image_${i}.png`)
        form.append('views', img.view)
      })
      form.append('quality', input.quality)
      form.append('remove_background', String(input.removeBackground))
      if (input.seed !== undefined) form.append('seed', String(input.seed))

      opts.onProgress({ stage: 'processing', message: 'Generating on local GPU' })
      const res = await fetch(`${base}/generate`, { method: 'POST', body: form, signal: opts.signal })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new GenerationError(`Worker error (${res.status}). ${detail.slice(0, 200)}`)
      }
      opts.onProgress({ stage: 'downloading', message: 'Receiving mesh' })
      return { glb: await res.blob(), source: 'Local worker' }
    },
  }
}

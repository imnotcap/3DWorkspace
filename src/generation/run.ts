import type { FileData } from '@gradio/client'
import { activeProject, useWorkspace, type InputImage, type Segmentation } from '@/store/workspace'
import { GenerationError, type GenerateProgress } from './types'
import { connectSam3d, type Sam3dConnection } from './sam3d/client'
import { preparePhoto, type PreparedPhoto } from './sam3d/image'
import { blobToBase64, type MaskData } from './sam3d/masks'
import { fromResponse, samePrompt, type PointsResponse, type SegmentResponse } from './sam3d/segments'

/**
 * SAM 3D pipeline: the Front photo → SAM 3 splits the object into parts → SAM 3D Objects
 * builds each part with its pose in the photo → the parts are assembled into one model
 * (model → folders → parts) that you can take apart and edit piece by piece.
 */

let controller: AbortController | null = null

const ws = () => useWorkspace.getState()

function serverSettings() {
  const { settings } = ws()
  return { server: settings.sam3dServer, token: settings.hfToken }
}

function frontImage(): InputImage {
  const img = activeProject(ws()).images.find((i) => i.view === 'front')
  if (!img) throw new GenerationError('Add a photo of the object and tag it Front.', 'SAM 3D builds the model from that one photo.')
  return img
}

/** The photo is uploaded to a server once and reused by every call in the run (and later clicks). */
const uploads = new WeakMap<Sam3dConnection, Map<string, { at: number; file: Promise<FileData> }>>()
function uploaded(conn: Sam3dConnection, imageId: string, photo: PreparedPhoto): Promise<FileData> {
  let byImage = uploads.get(conn)
  if (!byImage) uploads.set(conn, (byImage = new Map()))
  const hit = byImage.get(imageId)
  // The server keeps uploads for 6 hours.
  if (hit && Date.now() - hit.at < 5 * 3600_000) return hit.file
  const file = conn.upload(photo.file)
  byImage.set(imageId, { at: Date.now(), file })
  file.catch(() => byImage.get(imageId)?.file === file && byImage.delete(imageId))
  return file
}

async function session(img: InputImage) {
  const [photo, conn] = await Promise.all([preparePhoto(img), connectSam3d(serverSettings())])
  return { photo, conn, file: await uploaded(conn, img.id, photo) }
}

function currentPrompt() {
  const { prompt } = activeProject(ws())
  return { object: prompt.object.trim(), parts: prompt.parts.trim(), auto: ws().settings.autoParts }
}

async function segmentWith(conn: Sam3dConnection, file: FileData, photo: PreparedPhoto, img: InputImage, opts: { signal?: AbortSignal; onProgress?: (p: GenerateProgress) => void }): Promise<Segmentation> {
  const prompt = currentPrompt()
  const { value } = await conn.json<SegmentResponse>('/segment', { image: file, object_name: prompt.object, parts: prompt.parts, auto: prompt.auto }, { ...opts, label: 'SAM 3 · finding the parts' })
  return fromResponse(value, img.id, photo, prompt)
}

function fail(e: unknown, fallback: string) {
  const s = ws()
  if ((e as Error).name === 'AbortError') s.setJob({ status: 'idle' })
  else if (e instanceof GenerationError) s.setJob({ status: 'error', message: e.message, hint: e.hint })
  else s.setJob({ status: 'error', message: (e as Error).message || fallback })
}

export function cancelGeneration() {
  controller?.abort()
}

/** SAM 3 only: split the Front photo into parts (shown in the part editor), without building anything. */
export async function findParts() {
  if (ws().job.status === 'running') return
  controller = new AbortController()
  const startedAt = performance.now()
  const projectId = ws().activeProjectId
  const onProgress = (p: GenerateProgress) => ws().setJob({ status: 'running', startedAt, ...p })
  onProgress({ stage: 'connecting', message: 'Connecting to SAM 3D server' })
  try {
    const img = frontImage()
    const { photo, conn, file } = await session(img)
    const seg = await segmentWith(conn, file, photo, img, { signal: controller.signal, onProgress })
    ws().setSegmentation(seg, projectId)
    ws().setJob({ status: 'done', message: `SAM 3 found ${seg.segments.length} part${seg.segments.length === 1 ? '' : 's'}` })
  } catch (e) {
    fail(e, 'Finding parts failed.')
  } finally {
    controller = null
  }
}

/** One part from clicks on the Front photo ([x, y, 1 = include | 0 = exclude], photo pixels). */
export async function maskFromClicks(points: [number, number, 0 | 1][], signal?: AbortSignal): Promise<{ mask: MaskData; score: number }> {
  const img = frontImage()
  const { photo, conn, file } = await session(img)
  const { value } = await conn.json<PointsResponse>('/segment_points', { image: file, points: JSON.stringify(points) }, { signal, label: 'SAM 3' })
  if (value.width !== photo.width || value.height !== photo.height) throw new GenerationError('The server read the photo at a different size.')
  const { base64ToBlob, decodeMask } = await import('./sam3d/masks')
  return { mask: await decodeMask(base64ToBlob(value.mask)), score: value.score }
}

interface ReconstructResponse {
  matrix: number[][]
  seconds: number
  textured: boolean
}

/** Generate: parts (found now if you haven't reviewed them) → one SAM 3D reconstruction per part → assembled model. */
export async function startGeneration() {
  const state = ws()
  if (state.job.status === 'running') return
  controller = new AbortController()
  const signal = controller.signal
  const startedAt = performance.now()
  const projectId = state.activeProjectId
  const onProgress = (p: GenerateProgress) => ws().setJob({ status: 'running', startedAt, ...p })
  onProgress({ stage: 'connecting', message: 'Connecting to SAM 3D server' })

  try {
    const img = frontImage()
    const { photo, conn, file } = await session(img)
    const project = () => ws().projects.find((p) => p.id === projectId)
    let seg = project()?.segmentation
    // Found again if the photo or the request changed, unless you edited the parts by hand.
    if (!seg || seg.imageId !== img.id || (!seg.edited && !samePrompt(seg.prompt, currentPrompt()))) {
      seg = await segmentWith(conn, file, photo, img, { signal, onProgress })
      ws().setSegmentation(seg, projectId)
    }
    // Biggest parts first: if you stop early, you already have the bulk of the object.
    const chosen = seg.segments.filter((s) => s.enabled).sort((a, b) => b.area - a.area)
    if (!chosen.length) throw new GenerationError('Every part is switched off.', 'Turn at least one part on in Parts.')

    const { quality, seed, level } = ws().settings
    const results: import('./sam3d/assemble').PartResult[] = []
    const failed: string[] = []
    let lastError: unknown = null
    for (const [i, part] of chosen.entries()) {
      const label = `SAM 3D · ${part.name} · part ${i + 1} of ${chosen.length}`
      onProgress({ stage: 'processing', message: label, progress: i / chosen.length })
      try {
        const { value, outputs } = await conn.json<ReconstructResponse>(
          '/reconstruct',
          { image: file, mask: await blobToBase64(part.mask), seed: seed ?? -1, quality },
          { signal, label, onProgress: (p) => onProgress({ ...p, progress: i / chosen.length }) },
        )
        const glb = await conn.download(outputs[1], signal)
        results.push({ segment: part, glb, matrix: value.matrix })
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e
        lastError = e
        failed.push(`${part.name}: ${(e as Error).message}`)
      }
    }
    if (!results.length) throw lastError ?? new GenerationError('No part could be built.')

    onProgress({ stage: 'downloading', message: 'Assembling the parts', progress: 1 })
    const { assemble } = await import('./sam3d/assemble')
    const target = project()
    const asm = await assemble(results, {
      name: seg.objectLabel || 'Model',
      level,
      realSize: target?.realSize ?? null,
      source: conn.backend === 'mock' ? 'SAM 3D · mock server' : 'SAM 3D Objects',
    })
    failed.push(...asm.warnings)
    const s = ws()
    s.addTree(asm.nodes, projectId)
    // The photo's own camera becomes the default render angle (unless you set a camera).
    if (asm.cameraAngles && !target?.camera) s.setAutoAngles(asm.cameraAngles, projectId)
    const secs = ((performance.now() - startedAt) / 1000).toFixed(0)
    const built = results.length - asm.warnings.length
    const message = `Built ${built} part${built === 1 ? '' : 's'} in ${secs}s with SAM 3D`
    // Partial results stay on screen (as an error card) so a missing part is never silent.
    if (failed.length) s.setJob({ status: 'error', message: `${message} · ${failed.length} failed`, hint: failed.join('\n') })
    else s.setJob({ status: 'done', message })
  } catch (e) {
    fail(e, 'Generation failed.')
  } finally {
    controller = null
  }
}

/** Import .glb files from disk straight into the scene. */
export function importModelFiles(files: File[]) {
  const s = ws()
  for (const f of files) {
    if (!/\.glb$/i.test(f.name)) continue
    s.addObject({ name: f.name.replace(/\.glb$/i, ''), blob: f, source: 'Imported' })
  }
}

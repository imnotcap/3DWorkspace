import { activeProject, useWorkspace } from '@/store/workspace'
import { GenerationError, type GenerateResult, type Provider } from './types'

let controller: AbortController | null = null

// Providers load on first use so @gradio/client stays out of the initial bundle.
async function makeProvider(): Promise<Provider> {
  const { settings } = useWorkspace.getState()
  if (settings.providerId === 'claude-parts') {
    const { createClaudePartsProvider } = await import('./providers/claudeParts')
    return createClaudePartsProvider(claudeSettings())
  }
  if (settings.providerId === 'photogrammetry') {
    const { createPhotogrammetryProvider } = await import('./providers/photogrammetry')
    return createPhotogrammetryProvider({ url: settings.photogrammetryUrl })
  }
  if (settings.providerId === 'local-worker') {
    const { createLocalWorkerProvider } = await import('./providers/localWorker')
    return createLocalWorkerProvider({ url: settings.workerUrl })
  }
  const { createHfSpaceProvider } = await import('./providers/hfSpace')
  return createHfSpaceProvider({ spaceId: settings.spaceId, token: settings.hfToken })
}

export function cancelGeneration() {
  controller?.abort()
}

export async function startGeneration() {
  const state = useWorkspace.getState()
  if (state.job.status === 'running') return
  const project = activeProject(state)
  if (!project.images.length) {
    state.setJob({ status: 'error', message: 'Add at least one image first.' })
    return
  }

  controller = new AbortController()
  const startedAt = performance.now()
  const projectId = project.id
  state.setJob({ status: 'running', startedAt, stage: 'connecting', message: 'Starting' })

  try {
    const provider = await makeProvider()
    const result = await provider.generate(
      {
        images: project.images.map((i) => ({ blob: i.file, view: i.view })),
        quality: state.settings.quality,
        removeBackground: state.settings.removeBackground,
        seed: state.settings.seed ?? undefined,
        realSize: project.realSize,
      },
      {
        signal: controller.signal,
        onProgress: (p) => useWorkspace.getState().setJob({ status: 'running', startedAt, ...p }),
      },
    )
    const s = useWorkspace.getState()
    // The user may have switched tabs while waiting; the mesh goes where it was requested.
    const target = s.projects.find((p) => p.id === projectId)
    const name = (result.spec as { name?: string } | undefined)?.name ?? (result.source === 'Photogrammetry' ? 'Scan' : 'Mesh')
    s.addObject({ name, blob: result.glb, source: result.source, fitSize: target?.realSize, exact: result.exact, spec: result.spec }, projectId)
    // The Front photo's estimated angle becomes the default render camera (unless one is set).
    if (result.photoView && !target?.camera) s.setAutoAngles(photoAngles(result.photoView), projectId)
    s.setJob({ status: 'done', message: doneMessage(result, startedAt) })
  } catch (e) {
    const s = useWorkspace.getState()
    if ((e as Error).name === 'AbortError') s.setJob({ status: 'idle' })
    else if (e instanceof GenerationError) s.setJob({ status: 'error', message: e.message, hint: e.hint })
    else s.setJob({ status: 'error', message: (e as Error).message || 'Generation failed.' })
  } finally {
    controller = null
  }
}

function claudeSettings() {
  const { settings } = useWorkspace.getState()
  return { apiKey: settings.anthropicKey, model: settings.claudeModel, selfCheck: settings.claudeSelfCheck }
}

const photoAngles = (v: { azimuth_deg: number; elevation_deg: number }) => ({
  azimuth: (v.azimuth_deg * Math.PI) / 180,
  polar: Math.PI / 2 - (Math.max(-30, Math.min(80, v.elevation_deg)) * Math.PI) / 180,
})

function doneMessage(r: GenerateResult, startedAt: number) {
  const secs = ((performance.now() - startedAt) / 1000).toFixed(0)
  const cost = r.costUsd != null ? ` · ≈$${r.costUsd.toFixed(2)}` : ''
  const warn = r.warnings?.length ? ` · ${r.warnings.length} part(s) skipped` : ''
  return `Generated in ${secs}s · ${r.source}${cost}${warn}`
}

/** Claude parts: apply a written change ("legs are square, 6 cm") to an existing object. */
export async function refineObject(objectId: string, feedback: string) {
  const state = useWorkspace.getState()
  if (state.job.status === 'running') return
  const project = activeProject(state)
  const obj = project.objects.find((o) => o.id === objectId)
  if (!obj?.spec || !feedback.trim()) return
  controller = new AbortController()
  const startedAt = performance.now()
  state.setJob({ status: 'running', startedAt, stage: 'connecting', message: 'Starting' })
  try {
    const { refineParts } = await import('./providers/claudeParts')
    const { PartsSpec } = await import('./parts/spec')
    const result = await refineParts(
      claudeSettings(),
      { images: project.images.map((i) => ({ blob: i.file, view: i.view })), quality: state.settings.quality, removeBackground: false, realSize: project.realSize },
      PartsSpec.parse(obj.spec),
      feedback,
      { signal: controller.signal, onProgress: (p) => useWorkspace.getState().setJob({ status: 'running', startedAt, ...p }) },
    )
    const s = useWorkspace.getState()
    s.commit('Refine', objectId, { blob: result.glb, url: URL.createObjectURL(result.glb), spec: result.spec, stats: undefined, fitSize: project.realSize, error: undefined })
    s.setJob({ status: 'done', message: doneMessage(result, startedAt) })
  } catch (e) {
    const s = useWorkspace.getState()
    if ((e as Error).name === 'AbortError') s.setJob({ status: 'idle' })
    else if (e instanceof GenerationError) s.setJob({ status: 'error', message: e.message, hint: e.hint })
    else s.setJob({ status: 'error', message: (e as Error).message || 'Refine failed.' })
  } finally {
    controller = null
  }
}

/** Import .glb files from disk straight into the scene. */
export function importModelFiles(files: File[]) {
  const s = useWorkspace.getState()
  for (const f of files) {
    if (!/\.glb$/i.test(f.name)) continue
    s.addObject({ name: f.name.replace(/\.glb$/i, ''), blob: f, source: 'Imported' })
  }
}

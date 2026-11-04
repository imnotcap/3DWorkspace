import { activeProject, useWorkspace } from '@/store/workspace'
import { GenerationError, type Provider } from './types'

let controller: AbortController | null = null

// Providers load on first use so @gradio/client stays out of the initial bundle.
async function makeProvider(): Promise<Provider> {
  const { settings } = useWorkspace.getState()
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
      },
      {
        signal: controller.signal,
        onProgress: (p) => useWorkspace.getState().setJob({ status: 'running', startedAt, ...p }),
      },
    )
    const s = useWorkspace.getState()
    // The user may have switched tabs while waiting; the mesh goes where it was requested.
    const realSize = s.projects.find((p) => p.id === projectId)?.realSize
    s.addObject({ name: result.source === 'Photogrammetry' ? 'Scan' : 'Mesh', blob: result.glb, source: result.source, fitSize: realSize }, projectId)
    const secs = ((performance.now() - startedAt) / 1000).toFixed(1)
    s.setJob({ status: 'done', message: `Generated in ${secs}s · ${result.source}` })
  } catch (e) {
    const s = useWorkspace.getState()
    if ((e as Error).name === 'AbortError') s.setJob({ status: 'idle' })
    else if (e instanceof GenerationError) s.setJob({ status: 'error', message: e.message, hint: e.hint })
    else s.setJob({ status: 'error', message: (e as Error).message || 'Generation failed.' })
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

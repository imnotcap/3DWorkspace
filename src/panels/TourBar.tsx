import { Clapperboard, Footprints, Pause, Play, SkipBack, SquareStack } from 'lucide-react'
import { useEffect } from 'react'
import { actions } from '@/lib/actions'
import { tourFrames } from '@/plan/tour'
import { useActiveProject, useWorkspace } from '@/store/workspace'
import { Button, IconButton, Select, Tooltip } from '@/ui/primitives'

/** Walking speeds offered for the tour (m/s). */
export const TOUR_SPEEDS = [0.3, 0.45, 0.6, 0.7, 0.85, 1.0, 1.2, 1.5, 2.0]
export const speedLabel = (v: number) => `${v} m/s${v === 0.7 ? ' · walk' : v <= 0.45 ? ' · slow' : v >= 1.5 ? ' · fast' : ''}`

/** Playback clock: real time, sub-frame, so the walk is smooth at any display refresh rate. */
function usePlayback() {
  const playing = useWorkspace((s) => s.playing)
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const s = useWorkspace.getState()
    const p = s.projects.find((x) => x.id === s.activeProjectId)!
    const total = Math.max(2, tourFrames(p, p.animation.fps))
    const startFrame = s.frame >= total - 1 ? 0 : s.frame
    const t0 = performance.now()
    const tick = (now: number) => {
      const st = useWorkspace.getState()
      const fps = st.projects.find((x) => x.id === st.activeProjectId)!.animation.fps
      const f = startFrame + ((now - t0) / 1000) * fps
      if (f >= total - 1) {
        st.setFrame(total - 1)
        st.setPlaying(false)
        return
      }
      st.setFrame(f)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])
}

const time = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** The walkthrough: play it, scrub it, and render it as a path-traced video. */
export function TourBar() {
  usePlayback()
  const project = useActiveProject()
  const frame = useWorkspace((s) => s.frame)
  const playing = useWorkspace((s) => s.playing)
  const { setFrame, setPlaying, updateAnimation, setCameraView, editPlan } = useWorkspace.getState()
  const setTour = (label: string, patch: Partial<typeof project.tour>) => {
    // Keep the same moment of the walk on screen when its timing changes.
    const k = total > 1 ? frame / (total - 1) : 0
    editPlan(label, (p) => ({ ...p, tour: { ...p.tour, ...patch } }))
    const st = useWorkspace.getState()
    const p = st.projects.find((x) => x.id === st.activeProjectId)!
    setFrame(k * (tourFrames(p, fps) - 1))
  }
  const fps = project.animation.fps
  const hasTour = project.tour.points.length > 1
  const total = hasTour ? tourFrames(project, fps) : 0
  const engine = useWorkspace((s) => s.settings.engine)
  const { renderWidth: w, renderHeight: h } = useWorkspace((s) => s.settings)

  if (!hasTour)
    return (
      <div className="flex h-full items-center gap-3 px-3 text-xs text-dim">
        <Footprints className="size-3.5" />
        No walkthrough yet. Draw one with the Tour tool (T), or
        <Button className="h-6 px-2" onClick={actions.autoTour}>
          Auto tour
        </Button>
      </div>
    )

  return (
    <div className="flex h-full items-center gap-2 px-2">
      <Tooltip label="Back to start" shortcut="⇧←">
        <IconButton aria-label="Back to start" onClick={() => (setPlaying(false), setFrame(0))}>
          <SkipBack className="size-3.5" />
        </IconButton>
      </Tooltip>
      <Tooltip label={playing ? 'Pause' : 'Play the tour'} shortcut="Space">
        <IconButton aria-label={playing ? 'Pause' : 'Play'} active={playing} onClick={actions.togglePlay}>
          {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </IconButton>
      </Tooltip>
      <span className="w-20 shrink-0 text-center font-mono text-2xs tabular text-dim">
        {time(frame / fps)} / {time((total - 1) / fps)}
      </span>
      <input
        type="range"
        aria-label="Tour position"
        min={0}
        max={total - 1}
        step={0.01}
        value={Math.min(frame, total - 1)}
        onPointerDown={() => (setPlaying(false), setCameraView(true))}
        onChange={(e) => setFrame(Number(e.target.value))}
        className="min-w-0 flex-1 accent-[#4c8dff]"
      />
      <Tooltip label="Walking speed of the tour (and the video)" side="top">
        <div className="w-32 shrink-0">
          <Select size="sm" aria-label="Tour speed" className="w-full" value={String(project.tour.speed)} onChange={(v) => setTour('Tour speed', { speed: Number(v) })} options={[...new Set([...TOUR_SPEEDS, project.tour.speed])].sort((a, b) => a - b).map((v) => ({ value: String(v), label: speedLabel(v) }))} />
        </div>
      </Tooltip>
      <Tooltip label={project.tour.ceilings !== false ? 'Ceilings shown in the tour and video' : 'Ceilings hidden in the tour and video'} side="top">
        <button
          type="button"
          aria-label="Ceilings in the tour"
          aria-pressed={project.tour.ceilings !== false}
          onClick={() => setTour(project.tour.ceilings !== false ? 'Hide ceilings in tour' : 'Show ceilings in tour', { ceilings: project.tour.ceilings === false })}
          className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-2xs transition-colors ${project.tour.ceilings !== false ? 'border-accent/60 bg-accent-soft text-fg' : 'border-line-strong text-dim hover:text-fg'}`}
        >
          <SquareStack className="size-3.5" />
          {project.tour.ceilings !== false ? 'Ceilings on' : 'Ceilings off'}
        </button>
      </Tooltip>
      <div className="flex shrink-0 rounded-md border border-line-strong p-0.5">
        {[30, 60].map((v) => (
          <button key={v} type="button" onClick={() => updateAnimation({ fps: v })} className={`h-5.5 rounded px-1.5 font-mono text-2xs ${fps === v ? 'bg-active text-fg' : 'text-dim hover:text-fg'}`}>
            {v} fps
          </button>
        ))}
      </div>
      <Button variant="primary" className="h-7 shrink-0 gap-1.5 px-2.5" onClick={() => void actions.renderAnimation()}>
        <Clapperboard className="size-3.5" />
        Render tour · {w}×{h}
        {engine === 'pathtrace' ? ' · path traced' : ''}
      </Button>
    </div>
  )
}

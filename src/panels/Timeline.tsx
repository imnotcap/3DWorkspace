import { Camera, Clapperboard, Diamond, Pause, Play, RotateCw, SkipBack, SkipForward, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import ScrubField from '@/components/reactbits/ScrubField'
import { actions } from '@/lib/actions'
import { cn } from '@/lib/cn'
import { useActiveProject, useWorkspace } from '@/store/workspace'
import { Button, IconButton, Tooltip } from '@/ui/primitives'

const scrubCls = '!h-6 !w-24 !text-2xs font-mono'

/** Playback clock: real-time, frame-accurate, loops inside the range. */
function usePlayback() {
  const playing = useWorkspace((s) => s.playing)
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const s = useWorkspace.getState()
    const startFrame = s.frame
    const t0 = performance.now()
    const tick = (now: number) => {
      const st = useWorkspace.getState()
      const p = st.projects.find((x) => x.id === st.activeProjectId)!
      const { start, end, fps } = p.animation
      const total = end - start + 1
      const f = start + ((Math.floor(((now - t0) / 1000) * fps) + (startFrame - start)) % total + total) % total
      if (f !== st.frame) st.setFrame(f)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])
}

function tickStep(span: number, px: number) {
  const target = span / Math.max(1, px / 70)
  for (const s of [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]) if (s >= target) return s
  return 1000
}

export function Timeline() {
  usePlayback()
  const project = useActiveProject()
  const { start, end, fps, interpolation, keys } = project.animation
  const frame = useWorkspace((s) => s.frame)
  const playing = useWorkspace((s) => s.playing)
  const cameraView = useWorkspace((s) => s.cameraView)
  const rendering = useWorkspace((s) => !!s.renderJob)
  const { updateAnimation, setFrame } = useWorkspace.getState()
  const track = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)

  useEffect(() => {
    const el = track.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const span = Math.max(1, end - start)
  const PAD = 12
  const x = (f: number) => PAD + ((f - start) / span) * (width - PAD * 2)
  const step = tickStep(span, width)
  const ticks: number[] = []
  for (let f = Math.ceil(start / step) * step; f <= end; f += step) ticks.push(f)
  const onKey = keys.some((k) => k.frame === frame)

  const scrub = (e: RPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const f = Math.round(start + ((e.clientX - rect.left - PAD) / (rect.width - PAD * 2)) * span)
    setFrame(Math.min(end, Math.max(start, f)))
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-line px-1.5">
        <IconButton aria-label="Jump to start" onClick={() => actions.jump('start')}>
          <SkipBack className="size-3.5" />
        </IconButton>
        <Tooltip label={playing ? 'Pause' : 'Play'} shortcut="Space" side="top">
          <IconButton aria-label={playing ? 'Pause' : 'Play'} active={playing} onClick={actions.togglePlay}>
            {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          </IconButton>
        </Tooltip>
        <IconButton aria-label="Jump to end" onClick={() => actions.jump('end')}>
          <SkipForward className="size-3.5" />
        </IconButton>
        <span className="mx-1 w-12 rounded-md bg-app/60 py-1 text-center font-mono text-2xs tabular text-accent">{frame}</span>

        <ScrubField label="Start" suffix="" value={start} min={0} max={Math.max(0, end - 1)} step={1} size="sm" showDelta={false} rubberReach={0} chipColor="#0d0d0d" accent="#4c8dff" className={scrubCls} onChange={(v) => updateAnimation({ start: v })} />
        <ScrubField label="End" suffix="" value={end} min={start + 1} max={10000} step={1} size="sm" showDelta={false} rubberReach={0} chipColor="#0d0d0d" accent="#4c8dff" className={scrubCls} onChange={(v) => updateAnimation({ end: v })} />
        <select
          value={fps}
          onChange={(e) => updateAnimation({ fps: Number(e.target.value) })}
          aria-label="Frame rate"
          className="h-6 appearance-none rounded-md bg-app/60 px-2 font-mono text-2xs text-fg outline-none"
        >
          {[24, 25, 30, 50, 60].map((f) => (
            <option key={f} value={f} className="bg-panel-2">
              {f} fps
            </option>
          ))}
        </select>
        <select
          value={interpolation}
          onChange={(e) => updateAnimation({ interpolation: e.target.value as 'ease' | 'linear' })}
          aria-label="Interpolation"
          className="h-6 appearance-none rounded-md bg-app/60 px-2 text-2xs text-fg outline-none"
        >
          <option value="ease" className="bg-panel-2">Ease</option>
          <option value="linear" className="bg-panel-2">Linear</option>
        </select>
        <span className="ml-1 font-mono text-2xs text-faint">{((end - start + 1) / fps).toFixed(1)}s</span>

        <div className="flex-1" />
        <Tooltip label={onKey ? 'Replace Keyframe' : 'Insert Keyframe'} shortcut="I" side="top">
          <IconButton aria-label="Insert keyframe" onClick={actions.insertKey}>
            <Diamond className={cn('size-3.5', onKey && 'fill-warn text-warn')} />
          </IconButton>
        </Tooltip>
        <Tooltip label="Delete Keyframe" shortcut="Alt I" side="top">
          <IconButton aria-label="Delete keyframe" disabled={!onKey} onClick={actions.deleteKey}>
            <Trash2 className="size-3.5" />
          </IconButton>
        </Tooltip>
        <Tooltip label="Turntable (360° orbit)" side="top">
          <IconButton aria-label="Turntable" onClick={actions.turntable}>
            <RotateCw className="size-3.5" />
          </IconButton>
        </Tooltip>
        <Tooltip label="Camera View" shortcut="0" side="top">
          <IconButton aria-label="Camera view" active={cameraView} onClick={actions.toggleCameraView}>
            <Camera className="size-3.5" />
          </IconButton>
        </Tooltip>
        <div className="mx-1 h-4 w-px bg-line-strong" />
        <Button variant="primary" className="h-6.5 gap-1.5 px-2.5" disabled={rendering} onClick={actions.renderAnimation}>
          <Clapperboard className="size-3.5" /> Render Animation
        </Button>
      </div>

      <div
        ref={track}
        className="relative min-h-0 flex-1 cursor-ew-resize overflow-hidden"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          useWorkspace.getState().setPlaying(false)
          scrub(e)
        }}
        onPointerMove={(e) => e.buttons === 1 && scrub(e)}
      >
        {/* ruler */}
        <div className="absolute inset-x-0 top-0 h-5 border-b border-line">
          {ticks.map((f) => (
            <span key={f} className="absolute top-1 -translate-x-1/2 font-mono text-[9.5px] tabular text-faint" style={{ left: x(f) }}>
              {f}
            </span>
          ))}
        </div>
        {ticks.map((f) => (
          <div key={f} className="pointer-events-none absolute bottom-0 top-5 w-px bg-line/70" style={{ left: x(f) }} />
        ))}
        {/* camera track */}
        <div className="absolute inset-x-0 top-8 flex h-5 items-center">
          <span className="pointer-events-none absolute left-2 z-10 text-2xs text-faint">Camera</span>
          {keys.map((k) => (
            <button
              key={k.frame}
              type="button"
              aria-label={`Keyframe ${k.frame}`}
              onPointerDown={(e) => (e.stopPropagation(), setFrame(k.frame))}
              className="absolute size-2.5 -translate-x-1/2 rotate-45 rounded-[2px] border border-black/60 transition-transform hover:scale-125"
              style={{ left: x(k.frame), background: k.frame === frame ? '#f5a524' : '#d6d6d6' }}
            />
          ))}
        </div>
        {keys.length === 0 && (
          <p className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-2xs text-faint">
            No keyframes. Frame a shot and press I, or use Turntable.
          </p>
        )}
        {/* playhead */}
        <div className="pointer-events-none absolute bottom-0 top-0 w-px bg-accent" style={{ left: x(frame) }}>
          <div className="absolute -left-[5px] top-0 h-2.5 w-[11px] rounded-b-sm bg-accent" />
        </div>
      </div>
    </div>
  )
}

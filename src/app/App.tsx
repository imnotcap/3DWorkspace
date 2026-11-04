import { lazy, Suspense, useEffect, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { actions } from '@/lib/actions'
import { cn } from '@/lib/cn'
import { Inspector } from '@/panels/Inspector'
import { PlanToolbar } from '@/panels/PlanToolbar'
import { Sidebar } from '@/panels/Sidebar'
import { StatusBar } from '@/panels/StatusBar'
import { TabBar } from '@/panels/TabBar'
import { ToolStrip } from '@/panels/ToolStrip'
import { TourBar } from '@/panels/TourBar'
import { CameraFrame, JobCard, RenderProgress, StatsOverlay, TraceStatus, ViewportHeader, ViewportSideStrip } from '@/panels/ViewportOverlays'
import { PlanEditor } from '@/plan/PlanEditor'
import { tourFrames } from '@/plan/tour'
import { activeProject, useWorkspace } from '@/store/workspace'
import { useHotkeys } from './useHotkeys'
import { Home } from './Home'

// three.js is the heaviest chunk; split it so the shell paints first.
const Viewport = lazy(() => import('@/viewport/Viewport').then((m) => ({ default: m.Viewport })))

const Handle = ({ vertical }: { vertical?: boolean }) => (
  <Separator className={vertical ? 'group h-1 shrink-0' : 'group w-1 shrink-0'}>
    <div className="size-full rounded-full transition-colors duration-150 group-hover:bg-accent/50 group-data-[separator=active]:bg-accent" />
  </Separator>
)

/** The timeline covers the whole walkthrough while the camera follows the tour. */
function useTourLength() {
  useEffect(
    () =>
      useWorkspace.subscribe((s, prev) => {
        const p = activeProject(s)
        const q = activeProject(prev)
        if (p.tour === q.tour && p.levels === q.levels && p.useTour === q.useTour && p.animation.fps === q.animation.fps) return
        if (p.tour.points.length < 2) return
        const end = tourFrames(p, p.animation.fps) - 1
        if (p.animation.start !== 0 || p.animation.end !== end) s.updateAnimation({ start: 0, end })
      }),
    [],
  )
}

export function App() {
  useHotkeys()
  useTourLength()
  const [dragging, setDragging] = useState(false)
  const showTimeline = useWorkspace((s) => s.settings.showTimeline)
  const view = useWorkspace((s) => s.view)
  const screen = useWorkspace((s) => s.screen)
  if (screen === 'home') return <Home />

  return (
    <div className="flex h-full flex-col bg-app">
      <TabBar />
      <div className="flex min-h-0 flex-1 gap-1 px-1">
        <ToolStrip />
        <Group orientation="horizontal" className="min-w-0 flex-1">
          <Panel minSize="40" defaultSize="76">
            <Group orientation="vertical">
              <Panel minSize="30">
                <div className="relative flex size-full flex-col overflow-hidden rounded-lg bg-panel">
                  <PlanToolbar />
                  <div className="flex min-h-0 flex-1 gap-1">
                    {/* Both stay mounted: renders and the PDF need the 3D view even when only the plan shows. */}
                    <div className={cn('relative min-w-0 overflow-hidden rounded-lg', view === '3d' ? 'invisible absolute size-0' : 'flex-1')}>
                      <PlanEditor />
                    </div>
                    <div
                      className={cn('relative min-w-0 overflow-hidden rounded-lg bg-viewport', view === 'plan' ? 'pointer-events-none invisible absolute size-px' : 'flex-1')}
                      onDragEnter={(e) => (e.preventDefault(), setDragging(true))}
                      onDragOver={(e) => e.preventDefault()}
                      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
                      onDrop={(e) => {
                        e.preventDefault()
                        setDragging(false)
                        actions.handleDrop([...e.dataTransfer.files])
                      }}
                    >
                      <Suspense fallback={null}>
                        <Viewport />
                      </Suspense>
                      <ViewportHeader />
                      <ViewportSideStrip />
                      <StatsOverlay />
                      <TraceStatus />
                      <CameraFrame />
                      {dragging && <div className="pointer-events-none absolute inset-2 rounded-lg border-2 border-dashed border-accent/70" />}
                    </div>
                  </div>
                  <JobCard />
                  <RenderProgress />
                </div>
              </Panel>
              {showTimeline && (
                <>
                  <Handle vertical />
                  <Panel defaultSize="44px" minSize="40px" maxSize="64px" className="rounded-lg bg-panel">
                    <TourBar />
                  </Panel>
                </>
              )}
            </Group>
          </Panel>
          <Handle />
          <Panel minSize="260px" defaultSize="24" maxSize="40">
            <Group orientation="vertical">
              <Panel defaultSize="52" minSize="20" className="rounded-lg bg-panel">
                <Sidebar />
              </Panel>
              <Handle vertical />
              <Panel defaultSize="48" minSize="20" className="overflow-y-auto rounded-lg bg-panel">
                <Inspector />
              </Panel>
            </Group>
          </Panel>
        </Group>
      </div>
      <StatusBar />
    </div>
  )
}

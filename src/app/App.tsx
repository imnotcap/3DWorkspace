import { lazy, Suspense, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { actions } from '@/lib/actions'
import { InputsPanel } from '@/panels/InputsPanel'
import { Outliner } from '@/panels/Outliner'
import { StatusBar } from '@/panels/StatusBar'
import { TabBar } from '@/panels/TabBar'
import { ToolStrip } from '@/panels/ToolStrip'
import { EmptyState, JobCard, StatsOverlay, ViewportHeader, ViewportSideStrip } from '@/panels/ViewportOverlays'
import { useHotkeys } from './useHotkeys'

// three.js is the heaviest chunk; split it so the shell paints first.
const Viewport = lazy(() => import('@/viewport/Viewport').then((m) => ({ default: m.Viewport })))

const Handle = ({ vertical }: { vertical?: boolean }) => (
  <Separator className={vertical ? 'group h-1 shrink-0' : 'group w-1 shrink-0'}>
    <div className="size-full rounded-full transition-colors duration-150 group-hover:bg-accent/50 group-data-[separator=active]:bg-accent" />
  </Separator>
)

export function App() {
  useHotkeys()
  const [dragging, setDragging] = useState(false)

  return (
    <div className="flex h-full flex-col bg-app">
      <TabBar />
      <div className="flex min-h-0 flex-1 gap-1 px-1">
        <ToolStrip />
        <Group orientation="horizontal" className="min-w-0 flex-1">
          <Panel minSize="40" defaultSize="78">
            <div
              className="relative size-full overflow-hidden rounded-lg bg-viewport"
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
              <EmptyState dragging={dragging} />
              <JobCard />
            </div>
          </Panel>
          <Handle />
          <Panel minSize="240px" defaultSize="22" maxSize="40">
            <Group orientation="vertical">
              <Panel defaultSize="58" minSize="20" className="rounded-lg bg-panel">
                <Outliner />
              </Panel>
              <Handle vertical />
              <Panel defaultSize="42" minSize="25" className="rounded-lg bg-panel">
                <InputsPanel />
              </Panel>
            </Group>
          </Panel>
        </Group>
      </div>
      <StatusBar />
    </div>
  )
}

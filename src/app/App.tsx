import { lazy, Suspense, useEffect } from 'react'
import { useWorkspace } from '@/store/workspace'
import { Home } from './Home'

// The editor (and three.js under it) loads on its own: the home screen paints from a small bundle,
// and both are fetched in the background while you look at it, so opening a project is instant.
const loadEditor = () => import('./Editor')
const Editor = lazy(() => loadEditor().then((m) => ({ default: m.Editor })))
const preload = () => {
  void loadEditor()
  void import('@/viewport/Viewport')
}

export function App() {
  const screen = useWorkspace((s) => s.screen)
  useEffect(() => {
    const idle = (cb: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(cb, { timeout: 2500 }) : setTimeout(cb, 600))
    idle(preload)
  }, [])
  if (screen === 'home') return <Home />
  return (
    <Suspense fallback={<div className="grid h-full place-items-center bg-app text-xs text-faint">Opening…</div>}>
      <Editor />
    </Suspense>
  )
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { initPersistence } from './lib/persistence'
import { useWorkspace } from './store/workspace'
import './index.css'

void initPersistence()

// Dev builds only: the store on window, for debugging and browser tests.
if (import.meta.env.DEV) {
  ;(window as unknown as { __ws: typeof useWorkspace }).__ws = useWorkspace
  void import('./viewport/bridge').then((m) => ((window as unknown as { __viewport: unknown }).__viewport = m.viewport))
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

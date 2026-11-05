import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { initPersistence } from './lib/persistence'
import { useWorkspace } from './store/workspace'
// Fonts served with the site (no round trip to a font CDN before the first paint).
import '@fontsource-variable/inter'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './index.css'

// A shared plan in the address opens once your own projects have loaded (so it can't replace them).
const openShared = () => location.hash.startsWith('#plan=') && void import('./lib/share').then((m) => m.openSharedLink())
void initPersistence().then(openShared)
window.addEventListener('hashchange', openShared)

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

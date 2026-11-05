// Lets `node --test` load the app's TypeScript modules as Vite does: `@/…` paths and imports
// without file extensions.
import { register } from 'node:module'

register('./resolve-hooks.mjs', import.meta.url)

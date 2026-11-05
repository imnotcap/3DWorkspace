import { existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const src = fileURLToPath(new URL('../src/', import.meta.url))

/** `@/x` → src/x; a path without extension → .ts, .tsx or index.ts. */
export async function resolve(specifier, context, next) {
  let spec = specifier
  if (spec.startsWith('@/')) spec = pathToFileURL(src + spec.slice(2)).href
  const local = spec.startsWith('file:') || ((spec.startsWith('./') || spec.startsWith('../')) && context.parentURL?.startsWith('file:'))
  if (local && !/\.[cm]?[jt]sx?$|\.json$/.test(spec)) {
    const base = spec.startsWith('file:') ? fileURLToPath(spec) : fileURLToPath(new URL(spec, context.parentURL))
    for (const ext of ['.ts', '.tsx', '/index.ts']) if (existsSync(base + ext)) return next(pathToFileURL(base + ext).href, context)
  }
  return next(spec, context)
}

#!/usr/bin/env node
/**
 * The model library: furniture, lamps, plants and decor from Poly Haven (https://polyhaven.com,
 * every asset CC0), as glTF with 1K textures, into public/models/ph/<id>/, plus
 * public/models/library.json (name, catalog category, real size, file, thumbnail, credit).
 * Runs in CI before the build (`npm run library`); a failed download only leaves the catalog smaller.
 *
 * LIBRARY_BUDGET_MB (default 350) caps the total size; the most downloaded models come first.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { categoryOf, gltfSize } from './lib/gltf-bounds.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = process.env.LIBRARY_OUT ?? join(ROOT, 'public', 'models')
const API = process.env.POLYHAVEN_API ?? 'https://api.polyhaven.com'
const THUMBS = process.env.POLYHAVEN_THUMBS ?? 'https://cdn.polyhaven.com/asset_img/thumbs'
const BUDGET = Number(process.env.LIBRARY_BUDGET_MB ?? 350) * 1e6
const RES = process.env.LIBRARY_RES ?? '1k'
const HEADERS = { 'User-Agent': '3dworkspace-home-planner/1.0 (build script; github.com/imnotcap/3dworkspace)' }
const WANT = ['furniture', 'seating', 'table', 'tables', 'lighting', 'decorative', 'plants', 'appliances', 'electronics', 'containers', 'shelves', 'bathroom', 'kitchen', 'office']

const get = async (url, as = 'json') => {
  const r = await fetch(url, { headers: HEADERS })
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  return as === 'json' ? r.json() : Buffer.from(await r.arrayBuffer())
}

const assets = await get(`${API}/assets?t=models`)
const picked = Object.entries(assets)
  .filter(([, a]) => (a.categories ?? []).some((c) => WANT.includes(String(c).toLowerCase())))
  .sort((a, b) => (b[1].download_count ?? 0) - (a[1].download_count ?? 0))
console.log(`${picked.length} candidate models`)

const library = []
let total = 0
for (const [id, a] of picked) {
  try {
    const files = await get(`${API}/files/${id}`)
    const entry = files.gltf?.[RES]?.gltf ?? files.gltf?.['1k']?.gltf
    if (!entry) continue
    const size = (entry.size ?? 0) + Object.values(entry.include ?? {}).reduce((s, f) => s + (f.size ?? 0), 0)
    if (total + size > BUDGET) continue
    const dir = join(OUT, 'ph', id)
    await mkdir(dir, { recursive: true })
    const main = entry.url.split('/').pop()
    const json = await get(entry.url)
    await writeFile(join(dir, main), JSON.stringify(json))
    for (const [rel, f] of Object.entries(entry.include ?? {})) {
      await mkdir(dirname(join(dir, rel)), { recursive: true })
      await writeFile(join(dir, rel), await get(f.url, 'bin'))
    }
    try {
      await writeFile(join(dir, 'thumb.png'), await get(`${THUMBS}/${id}.png?width=256&height=256`, 'bin'))
    } catch {}
    const dims = gltfSize(json)
    if (!dims || dims.some((v) => !(v > 0.005))) continue
    total += size
    library.push({
      id: `ph-${id}`,
      name: a.name ?? id,
      category: categoryOf(a.categories ?? [], a.tags ?? [], a.name ?? id),
      size: dims,
      file: `ph/${id}/${main}`,
      thumb: `ph/${id}/thumb.png`,
      credit: `${Object.keys(a.authors ?? {}).join(', ') || 'Poly Haven'} · Poly Haven`,
      license: 'CC0',
      tags: (a.tags ?? []).slice(0, 8),
    })
    console.log(`✓ ${id} (${(size / 1e6).toFixed(1)} MB, ${dims.join(' × ')} m)`)
  } catch (e) {
    console.warn(`✗ ${id}: ${e.message}`)
  }
}
await mkdir(OUT, { recursive: true })
await writeFile(join(OUT, 'library.json'), JSON.stringify(library))
console.log(`${library.length} models, ${(total / 1e6).toFixed(0)} MB`)

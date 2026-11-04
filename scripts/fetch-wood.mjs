#!/usr/bin/env node
/**
 * Photographed wood for the wood floors: a few CC0 2K wood-grain textures (oak, dark oak, pine,
 * ash) from Poly Haven (https://polyhaven.com), falling back to ambientCG. The app draws every
 * board of a floor pattern (planks, herringbone, chevron…) with a piece of these photos, so all 20
 * floors look real. Runs in CI before the build; without it the floors use drawn grain.
 *
 * Output: public/textures/wood/<species>/color.jpg (+ roughness.jpg) and manifest.json.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'textures', 'wood')
const UA = { 'User-Agent': '3d-workspace-texture-fetch' }

/** What each species should look like: words its name or tags should have, and words to avoid. */
const SPECIES = {
  oak: { want: ['oak'], like: ['veneer', 'grain', 'fine', 'table', 'smooth', 'natural', 'light'], ambient: 'oak wood' },
  dark: { want: ['dark', 'walnut', 'smoked'], like: ['veneer', 'grain', 'fine', 'table', 'smooth'], ambient: 'dark wood' },
  pine: { want: ['pine', 'spruce', 'fir'], like: ['grain', 'plank', 'board', 'natural'], ambient: 'pine wood' },
  ash: { want: ['ash', 'birch', 'beech', 'maple', 'light'], like: ['veneer', 'grain', 'fine', 'smooth'], ambient: 'light wood' },
}
// Grain photos, not finished floors, logs or painted/rotten wood.
const AVOID = ['bark', 'log', 'stump', 'floor', 'parquet', 'tiles', 'fence', 'door', 'shutter', 'crate', 'pallet', 'painted', 'paint', 'rotten', 'moss', 'burnt', 'charred', 'rough', 'weathered', 'dirty', 'branch', 'root', 'leaves', 'mulch', 'chips', 'shingle', 'roof', 'wall', 'brick', 'cork']

const words = (id, a) => [id, a.name ?? '', ...(a.tags ?? []), ...(a.categories ?? [])].join(' ').toLowerCase()

async function json(url) {
  const r = await fetch(url, { headers: UA })
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`)
  return r.json()
}
async function bytes(url) {
  const r = await fetch(url, { headers: UA })
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`)
  return new Uint8Array(await r.arrayBuffer())
}

async function fromPolyHaven(list, species, spec, taken) {
  const scored = Object.entries(list)
    .filter(([id, a]) => (a.categories ?? []).some((c) => /wood/i.test(c)) && !taken.has(id))
    .map(([id, a]) => {
      const w = words(id, a)
      if (!spec.want.some((x) => w.includes(x))) return null
      if (AVOID.some((x) => w.includes(x))) return null
      const score = spec.like.filter((x) => w.includes(x)).length * 2 + (a.download_count ?? 0) / 1e6
      return { id, a, score }
    })
    .filter(Boolean)
    .sort((x, y) => y.score - x.score)
  if (!scored.length) throw new Error('no match on Poly Haven')
  const { id, a } = scored[0]
  const files = await json(`https://api.polyhaven.com/files/${id}`)
  const pick = (k) => files[k]?.['2k']?.jpg?.url ?? files[k]?.['2k']?.png?.url
  const color = pick('Diffuse')
  if (!color) throw new Error(`${id}: no 2K diffuse`)
  const out = { color: await bytes(color) }
  const rough = pick('Rough')
  if (rough) out.roughness = await bytes(rough)
  // Poly Haven gives the real size of a texture in mm.
  const dims = Array.isArray(a.dimensions) ? a.dimensions.map((v) => v / 1000) : [1, 1]
  return { source: 'Poly Haven', id, url: `https://polyhaven.com/a/${id}`, size_m: dims, maps: out }
}

async function fromAmbientCG(species, spec) {
  const res = await json(`https://ambientcg.com/api/v2/full_json?type=Material&q=${encodeURIComponent(spec.ambient)}&sort=Popular&limit=8&include=downloadData,tagData`)
  const asset = (res.foundAssets ?? []).find((x) => /^Wood\d/.test(x.assetId)) ?? res.foundAssets?.[0]
  if (!asset) throw new Error('no match on ambientCG')
  const id = asset.assetId
  const cats = asset?.downloadFolders?.default?.downloadFiletypeCategories ?? {}
  const link = Object.values(cats).flatMap((c) => c.downloads ?? []).find((d) => d.attribute === '2K-JPG')?.downloadLink ?? `https://ambientcg.com/get?file=${id}_2K-JPG.zip`
  const files = unzipSync(await bytes(link))
  const find = (s) => Object.entries(files).find(([n]) => new RegExp(`_${s}\\.(jpg|jpeg|png)$`, 'i').test(n))?.[1]
  const color = find('Color')
  if (!color) throw new Error(`${id}: no colour map`)
  const out = { color }
  const rough = find('Roughness')
  if (rough) out.roughness = rough
  return { source: 'ambientCG', id, url: `https://ambientcg.com/view?id=${id}`, size_m: [1, 1], maps: out }
}

await mkdir(OUT, { recursive: true })
let list = {}
try {
  list = await json('https://api.polyhaven.com/assets?t=textures')
  console.log(`Poly Haven: ${Object.keys(list).length} textures listed`)
} catch (e) {
  console.warn(`Poly Haven list failed: ${e.message}`)
}
const manifest = {}
const taken = new Set()
for (const [species, spec] of Object.entries(SPECIES)) {
  let got = null
  for (const src of [() => fromPolyHaven(list, species, spec, taken), () => fromAmbientCG(species, spec)]) {
    try {
      got = await src()
      break
    } catch (e) {
      console.warn(`  ${species}: ${e.message}`)
    }
  }
  if (!got) {
    console.warn(`✗ ${species}: no photo (floors of this wood use drawn grain)`)
    continue
  }
  taken.add(got.id)
  await mkdir(join(OUT, species), { recursive: true })
  const maps = {}
  for (const [name, data] of Object.entries(got.maps)) {
    await writeFile(join(OUT, species, `${name}.jpg`), data)
    maps[name] = `${species}/${name}.jpg`
  }
  manifest[species] = { source: got.source, id: got.id, url: got.url, license: 'CC0-1.0', size_m: got.size_m, maps }
  console.log(`✓ ${species.padEnd(5)} ${got.source} · ${got.id} · ${got.size_m.map((v) => v.toFixed(2)).join(' × ')} m`)
}
await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`${Object.keys(manifest).length}/${Object.keys(SPECIES).length} wood photos → public/textures/wood/manifest.json`)

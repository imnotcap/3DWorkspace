#!/usr/bin/env node
/**
 * Downloads CC0 PBR textures from ambientCG (https://ambientcg.com) into public/textures/,
 * plus manifest.json that the app reads. Runs in CI before the build; run it locally once
 * (`npm run textures`) to get the same textures in dev. Without it, the app falls back to
 * procedural textures, so a failed download never breaks the site.
 *
 * ambientCG assets are CC0 1.0 (public domain); the manifest records each asset id anyway.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'textures')
const SITE = process.env.AMBIENTCG_BASE ?? 'https://ambientcg.com' // override for testing
const API = `${SITE}/api/v2/full_json`
const RES = '1K-JPG'
// File suffixes inside ambientCG zips → our map names. NormalGL is the OpenGL convention three.js uses.
const MAPS = { Color: 'color', NormalGL: 'normal', Roughness: 'roughness', Metalness: 'metalness', AmbientOcclusion: 'ao' }

const config = JSON.parse(await readFile(join(ROOT, 'scripts', 'ambientcg.config.json'), 'utf8'))
await mkdir(OUT, { recursive: true })

async function findAsset(query) {
  const url = `${API}?type=Material&q=${encodeURIComponent(query)}&sort=Popular&limit=5&include=downloadData`
  const res = await fetch(url, { headers: { 'User-Agent': '3d-workspace-texture-fetch' } })
  if (!res.ok) throw new Error(`search "${query}" → HTTP ${res.status}`)
  const json = await res.json()
  const asset = json.foundAssets?.[0]
  if (!asset) throw new Error(`no asset for "${query}"`)
  return asset
}

function zipLink(asset, id) {
  const cats = asset?.downloadFolders?.default?.downloadFiletypeCategories ?? {}
  const downloads = Object.values(cats).flatMap((c) => c.downloads ?? [])
  return downloads.find((d) => d.attribute === RES)?.downloadLink ?? `${SITE}/get?file=${id}_${RES}.zip`
}

const manifest = {}
const zips = new Map() // several presets may share an asset
let ok = 0
for (const [preset, cfg] of Object.entries(config)) {
  if (preset.startsWith('_')) continue
  try {
    const asset = cfg.id ? { assetId: cfg.id } : await findAsset(cfg.query)
    const id = asset.assetId
    if (!zips.has(id)) {
      const link = zipLink(asset, id)
      const res = await fetch(link, { headers: { 'User-Agent': '3d-workspace-texture-fetch' } })
      if (!res.ok) throw new Error(`${link} → HTTP ${res.status}`)
      zips.set(id, unzipSync(new Uint8Array(await res.arrayBuffer())))
    }
    const files = zips.get(id)
    const maps = {}
    await mkdir(join(OUT, id), { recursive: true })
    for (const [name, data] of Object.entries(files)) {
      const m = Object.entries(MAPS).find(([suffix]) => new RegExp(`_${suffix}\\.(jpg|jpeg|png)$`, 'i').test(name))
      if (!m) continue
      const file = `${id}/${m[1]}.jpg`
      await writeFile(join(OUT, file), data)
      maps[m[1]] = file
    }
    if (!maps.color) throw new Error(`${id}: no colour map in the zip`)
    manifest[preset] = { assetId: id, url: `https://ambientcg.com/view?id=${id}`, license: 'CC0-1.0', tile_m: cfg.tile_m ?? 1, maps }
    ok++
    console.log(`✓ ${preset.padEnd(18)} ${id}  (${Object.keys(maps).join(', ')})`)
  } catch (e) {
    console.warn(`✗ ${preset.padEnd(18)} ${e.message} (falls back to a procedural texture)`)
  }
}
await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`\n${ok}/${Object.keys(config).filter((k) => !k.startsWith('_')).length} presets downloaded → public/textures/manifest.json`)

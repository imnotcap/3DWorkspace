#!/usr/bin/env node
/**
 * Downloads the photoreal furniture models (Khronos glTF Sample Assets, CC0 / CC BY 4.0) into
 * public/models/, plus manifest.json with each model's licence and credit. Runs in CI before the
 * build; run it once locally (`npm run models`). Missing models are simply hidden in the catalog.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'models')
const BASE = process.env.MODELS_BASE ?? 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models'
const MODELS = [
  'GlamVelvetSofa',
  'SheenWoodLeatherSofa',
  'SheenChair',
  'ChairDamaskPurplegold',
  'SpecularSilkPouf',
  'AnisotropyBarnLamp',
  'LightsPunctualLamp',
  'IridescenceLamp',
  'DiffuseTransmissionPlant',
  'GlassVaseFlowers',
]

await mkdir(OUT, { recursive: true })
const manifest = {}
for (const name of MODELS) {
  try {
    const res = await fetch(`${BASE}/${name}/glTF-Binary/${name}.glb`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < 1000 || buf.toString('ascii', 0, 4) !== 'glTF') throw new Error('not a GLB')
    await writeFile(join(OUT, `${name}.glb`), buf)
    let legal = []
    try {
      const meta = await (await fetch(`${BASE}/${name}/metadata.json`)).json()
      legal = (meta.legal ?? []).map((l) => ({ license: l.license, artist: l.artist ?? l.owner ?? '' }))
    } catch {}
    manifest[`${name}.glb`] = { bytes: buf.length, legal }
    console.log(`✓ ${name} (${(buf.length / 1e6).toFixed(1)} MB)`)
  } catch (e) {
    console.warn(`✗ ${name}: ${e.message}`)
  }
}
await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`${Object.keys(manifest).length}/${MODELS.length} models`)

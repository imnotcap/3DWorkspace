import { RepeatWrapping, SRGBColorSpace, TextureLoader, type Texture } from 'three'

/** public/textures/manifest.json, written by scripts/fetch-textures.mjs (ambientCG, CC0). */
interface Entry {
  assetId: string
  tile_m: number
  maps: Partial<Record<'color' | 'normal' | 'roughness' | 'metalness' | 'ao', string>>
}
export interface PbrSet {
  tile: number
  map?: Texture
  normalMap?: Texture
  roughnessMap?: Texture
  metalnessMap?: Texture
  aoMap?: Texture
}

const base = import.meta.env.BASE_URL
let manifest: Promise<Record<string, Entry>> | null = null
const sets = new Map<string, Promise<PbrSet | null>>()
const loader = new TextureLoader()

function getManifest() {
  manifest ??= fetch(`${base}textures/manifest.json`)
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}))
  return manifest
}

async function load(file: string, color: boolean) {
  const t = await loader.loadAsync(`${base}textures/${file}`)
  t.wrapS = t.wrapT = RepeatWrapping
  t.anisotropy = 8
  if (color) t.colorSpace = SRGBColorSpace
  return t
}

/** Real PBR maps for a library preset, or null when they weren't downloaded (procedural fallback). */
export function pbrSet(presetId: string): Promise<PbrSet | null> {
  let p = sets.get(presetId)
  if (!p) {
    p = getManifest().then(async (m) => {
      const e = m[presetId]
      if (!e?.maps.color) return null
      const [map, normalMap, roughnessMap, metalnessMap, aoMap] = await Promise.all([
        load(e.maps.color, true),
        e.maps.normal ? load(e.maps.normal, false) : undefined,
        e.maps.roughness ? load(e.maps.roughness, false) : undefined,
        e.maps.metalness ? load(e.maps.metalness, false) : undefined,
        e.maps.ao ? load(e.maps.ao, false) : undefined,
      ])
      return { tile: e.tile_m || 1, map, normalMap, roughnessMap, metalnessMap, aoMap }
    })
    p.catch(() => sets.delete(presetId))
    sets.set(presetId, p)
  }
  return p
}

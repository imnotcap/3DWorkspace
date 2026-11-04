import { Color, DataTexture, EquirectangularReflectionMapping, FloatType, LinearFilter, LinearSRGBColorSpace, RGBAFormat, Vector3 } from 'three'
import type { Ambience } from '@/store/workspace'

/**
 * Daylight for the rendered look: a procedural HDR sky (equirectangular, linear radiance) and the
 * sun that goes with it. The same sky lights the real-time view (through PMREM) and the path
 * tracer (which importance-samples it), so both engines agree.
 */
export interface Daylight {
  sky: DataTexture
  /** Direction towards the sun (world space, y up). */
  sunDir: Vector3
  sunColor: Color
  /** Directional light intensity for the sun (0 = none). */
  sunIntensity: number
  /** Background seen through windows in interior shots. */
  background: Color
}

interface Preset {
  zenith: [number, number, number]
  horizon: [number, number, number]
  ground: [number, number, number]
  /** Glow around the sun on the sky dome. */
  glow: [number, number, number]
  sunElevation: number
  sunAzimuth: number
  sunColor: string
  sunIntensity: number
  background: string
}

const PRESETS: Record<Ambience, Preset> = {
  day: {
    zenith: [0.32, 0.52, 1.0],
    horizon: [1.15, 1.22, 1.3],
    ground: [0.28, 0.26, 0.23],
    glow: [1.4, 1.25, 1.0],
    sunElevation: 48,
    sunAzimuth: 35,
    sunColor: '#fff4e5',
    sunIntensity: 3.2,
    background: '#dfe6ec',
  },
  evening: {
    zenith: [0.12, 0.16, 0.34],
    horizon: [0.95, 0.52, 0.3],
    ground: [0.1, 0.08, 0.07],
    glow: [1.6, 0.7, 0.3],
    sunElevation: 9,
    sunAzimuth: 70,
    sunColor: '#ffa15c',
    sunIntensity: 1.6,
    background: '#d9a27c',
  },
  night: {
    zenith: [0.004, 0.006, 0.014],
    horizon: [0.012, 0.016, 0.03],
    ground: [0.003, 0.003, 0.004],
    glow: [0, 0, 0],
    sunElevation: 40,
    sunAzimuth: 200,
    sunColor: '#9fb4ff',
    sunIntensity: 0.04,
    background: '#0a0e18',
  },
}

const cache = new Map<Ambience, Daylight>()
const W = 512
const H = 256

const mix = (a: number, b: number, t: number) => a + (b - a) * t

/** The sky, sun and background for a time of day (built once, cached). */
export function daylight(ambience: Ambience): Daylight {
  const hit = cache.get(ambience)
  if (hit) return hit
  const p = PRESETS[ambience]
  const el = (p.sunElevation * Math.PI) / 180
  const az = (p.sunAzimuth * Math.PI) / 180
  const sunDir = new Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize()

  const data = new Float32Array(W * H * 4)
  const d = new Vector3()
  for (let y = 0; y < H; y++) {
    // Row 0 is the bottom of the image (flipY is off for data textures): straight down.
    const lat = ((y + 0.5) / H - 0.5) * Math.PI
    for (let x = 0; x < W; x++) {
      // three.js equirect: u = atan(dir.z, dir.x) / 2π + 0.5
      const lon = ((x + 0.5) / W - 0.5) * Math.PI * 2
      d.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon))
      const up = d.y
      let r: number
      let g: number
      let b: number
      if (up >= 0) {
        // Bright, slightly hazy horizon fading to a deep zenith.
        const t = Math.pow(1 - up, 3.2)
        r = mix(p.zenith[0], p.horizon[0], t)
        g = mix(p.zenith[1], p.horizon[1], t)
        b = mix(p.zenith[2], p.horizon[2], t)
        const cos = Math.max(0, d.dot(sunDir))
        const glow = Math.pow(cos, 24) * 1.2 + Math.pow(cos, 4) * 0.25
        r += p.glow[0] * glow
        g += p.glow[1] * glow
        b += p.glow[2] * glow
      } else {
        // Ground: dim, with a soft transition below the horizon.
        const t = Math.min(1, -up * 6)
        r = mix(p.horizon[0] * 0.5, p.ground[0], t)
        g = mix(p.horizon[1] * 0.5, p.ground[1], t)
        b = mix(p.horizon[2] * 0.5, p.ground[2], t)
      }
      const i = (y * W + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 1
    }
  }
  const sky = new DataTexture(data, W, H, RGBAFormat, FloatType)
  sky.mapping = EquirectangularReflectionMapping
  sky.colorSpace = LinearSRGBColorSpace
  sky.magFilter = sky.minFilter = LinearFilter
  sky.generateMipmaps = false
  sky.needsUpdate = true
  sky.name = `sky:${ambience}`

  const out: Daylight = { sky, sunDir, sunColor: new Color(p.sunColor), sunIntensity: p.sunIntensity, background: new Color(p.background) }
  cache.set(ambience, out)
  return out
}

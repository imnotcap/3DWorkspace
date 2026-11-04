// Lamp light settings (three.js-free, shared by the viewport and the panels).
import type { LightSettings, SceneObject } from '@/store/workspace'
import { catalogItemOf } from '@/plan/footprint'

/** Colour of a black body at `kelvin` (Tanner Helland's fit), as #rrggbb. */
export function kelvinToHex(kelvin: number) {
  const t = Math.max(1000, Math.min(40000, kelvin)) / 100
  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592)
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492)
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307
  const hex = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/** Bulb colours people know. */
export const TEMPERATURES: { kelvin: number; label: string }[] = [
  { kelvin: 2200, label: 'Candle' },
  { kelvin: 2700, label: 'Warm white' },
  { kelvin: 3000, label: 'Soft white' },
  { kelvin: 4000, label: 'Neutral' },
  { kelvin: 5000, label: 'Cool white' },
  { kelvin: 6500, label: 'Daylight' },
]

/** Accent colours for coloured bulbs. */
export const LIGHT_COLORS = ['#ff4d4d', '#ff9a3c', '#ffd54a', '#6ee06e', '#46c8ff', '#4d6bff', '#b45cff', '#ff5cc8']

export const newLight = (lumens: number, kelvin = 2700): LightSettings => ({ on: true, kelvin, color: kelvinToHex(kelvin), lumens })

/** The lamp's light: its own settings, or its catalog default (older projects, templates). Null for non-lamps. */
export function lightOf(o: Pick<SceneObject, 'light' | 'furniture' | 'modelFile'>): LightSettings | null {
  if (o.light) return o.light
  const item = catalogItemOf(o)
  return item?.light ? newLight(item.light.lumens, item.light.kelvin) : null
}

/**
 * Lumens → point light intensity in scene units. The scene isn't in absolute photometric units
 * (the sun is ~3), so this is tuned for a 800 lm bulb to light a room at night the way a camera
 * set for interiors would see it.
 */
export const lumensToIntensity = (lm: number) => (lm / (4 * Math.PI)) * 0.09

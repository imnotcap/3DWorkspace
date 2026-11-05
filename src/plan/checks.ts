// Building-regulation checks (Danish BR18), as guidance while planning: daylight, ceiling height,
// door widths, escape windows in bedrooms, and ventilation in wet rooms and kitchens. They read the
// plan as drawn; they are not an approval and don't replace the rules or a professional.
import type { RoomQty } from './quantities'

export type CheckLevel = 'ok' | 'warn' | 'info'

export interface Check {
  room: string
  level: CheckLevel
  title: string
  detail: string
}

/** Rooms people live in (daylight and height rules apply). */
const HABITABLE = new Set(['living', 'bedroom', 'kids', 'office', 'dining', 'kitchen'])
const SLEEPING = new Set(['bedroom', 'kids'])
/** Glass is about 80 % of a window's hole (frame and sash take the rest). */
const GLASS = 0.8
/** A door leaf's frame takes about 13 cm off the opening: a 90 cm door gives 77 cm clear. */
const FRAME = 0.13
const pct = (n: number) => `${Math.round(n * 100)} %`
const m = (n: number) => `${n.toFixed(2).replace(/\.?0+$/, '')} m`

export function buildingChecks(rooms: RoomQty[]): Check[] {
  const out: Check[] = []
  for (const r of rooms) {
    const name = r.name
    // Daylight: glass at least 10 % of the floor in rooms people live in.
    if (HABITABLE.has(r.kind) && r.area > 2) {
      const glass = r.windows.reduce((s, w) => s + w.width * w.height * GLASS, 0)
      const share = glass / r.area
      if (!r.windows.length) out.push({ room: name, level: 'warn', title: 'No window', detail: `${name} has no window to the outside. Rooms people live in need daylight: glass of at least 10 % of the floor.` })
      else
        out.push({
          room: name,
          level: share >= 0.1 ? 'ok' : 'warn',
          title: `Daylight: glass ${pct(share)} of the floor`,
          detail: `About ${glass.toFixed(1)} m² of glass for ${r.area.toFixed(1)} m² of floor (rule of thumb: at least 10 %${share < 0.1 ? `, about ${(r.area * 0.1 - glass).toFixed(1)} m² more` : ''}).`,
        })
    }
    // Ceiling height: 2.5 m in rooms people live in.
    if (HABITABLE.has(r.kind) && r.area > 2) {
      if (r.minHeight >= 2.5 - 1e-6) out.push({ room: name, level: 'ok', title: `Ceiling height ${m(r.minHeight)}`, detail: 'At least 2.5 m, as for new homes.' })
      else if (r.maxHeight - r.minHeight < 0.05) out.push({ room: name, level: 'warn', title: `Ceiling height ${m(r.minHeight)}`, detail: 'Below 2.5 m: lower than BR18 asks of rooms people live in in new homes (existing homes and conversions can differ).' })
      else
        out.push({
          room: name,
          level: r.fullHeightShare >= 0.5 ? 'ok' : 'warn',
          title: `Sloped ceiling ${m(r.minHeight)}–${m(r.maxHeight)}`,
          detail: `${pct(r.fullHeightShare)} of the floor has at least 2.5 m to the ceiling. Under a sloped ceiling, check how much of the room counts as full height.`,
        })
    }
    // Bedrooms: a window to escape through.
    if (SLEEPING.has(r.kind)) {
      const escape = r.windows.some((w) => w.width >= 0.5 && w.height >= 0.6 && w.width + w.height >= 1.5 && w.sill <= 1.2)
      if (r.windows.length && !escape) out.push({ room: name, level: 'warn', title: 'No escape window', detail: 'A room to sleep in needs a window to escape through: at least 50 cm wide and 60 cm high (width + height 1.5 m or more), sill no higher than 1.2 m.' })
      else if (escape) out.push({ room: name, level: 'ok', title: 'Escape window', detail: 'A window large and low enough to escape through.' })
    }
    // Wet rooms and kitchens: extract ventilation.
    if (r.kind === 'bathroom' || r.kind === 'wc')
      out.push({ room: name, level: 'info', title: 'Extract ventilation', detail: `${r.kind === 'bathroom' ? 'A bathroom' : 'A WC'} needs mechanical extract (about ${r.kind === 'bathroom' ? '15' : '10'} l/s)${r.windows.length ? '' : ', as it has no window'}${r.kind === 'bathroom' ? ', and a waterproof floor and walls by the shower' : ''}.` })
    if (r.kind === 'kitchen') out.push({ room: name, level: 'info', title: 'Cooker hood', detail: 'A kitchen needs extract over the hob (about 20 l/s), ducted outside.' })
  }
  // Door widths: 77 cm clear passage. Each door once (it opens into two rooms), alike ones together.
  const doors = new Map<string, { width: number; kind: string; rooms: Set<string> }>()
  for (const r of rooms)
    for (const d of r.doors) {
      if (d.kind === 'floor-window' || d.kind === 'french-window') continue
      const e = doors.get(d.id) ?? { width: d.width, kind: d.kind, rooms: new Set<string>() }
      e.rooms.add(r.name)
      doors.set(d.id, e)
    }
  const narrow = new Map<number, { n: number; clear: number; rooms: Set<string> }>()
  for (const d of doors.values()) {
    const clear = d.kind === 'archway' ? d.width : d.width - FRAME * (d.kind === 'double-door' ? 0.5 : 1)
    if (clear >= 0.77 - 1e-6) continue
    const k = Math.round(d.width * 100)
    const e = narrow.get(k) ?? { n: 0, clear, rooms: new Set<string>() }
    e.n++
    d.rooms.forEach((x) => e.rooms.add(x))
    narrow.set(k, e)
  }
  for (const [w, e] of narrow)
    out.push({ room: [...e.rooms].join(', '), level: 'warn', title: `${e.n > 1 ? `${e.n} doors` : 'Door'} ${w} cm: narrow`, detail: `About ${Math.round(e.clear * 100)} cm clear. New homes need 77 cm clear passage (a 90 cm door) for wheelchair access.` })
  if (doors.size && !narrow.size) out.push({ room: 'All doors', level: 'ok', title: 'Door widths', detail: 'Every door gives at least 77 cm clear passage.' })
  // Things to look at first.
  const order: CheckLevel[] = ['warn', 'info', 'ok']
  return out.map((c, i) => [c, i] as const).sort((a, b) => order.indexOf(a[0].level) - order.indexOf(b[0].level) || a[1] - b[1]).map(([c]) => c)
}

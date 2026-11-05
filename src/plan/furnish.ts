// Furnish a room in one go, from what it is called: a bedroom gets a bed against its longest free
// wall with nightstands, a wardrobe and a rug; a living room a sofa facing a TV unit across the
// room, a coffee table, a rug, an armchair and a lamp; a kitchen a run of units with a range hood
// and a dining table with chairs and a pendant… Pieces go against free walls (clear of doors,
// their swing and windows down to the floor), never on each other, and the smart placement rules
// (arrange.ts) put the companions where they belong.
import { itemById, type CatalogItem } from '@/furniture/catalog'
import type { SceneObject, Vec3 } from '@/store/workspace'
import { arrange } from './arrange'
import { roomFaces } from './electrical'
import { footprint } from './footprint'
import { pointInPolygon, type Face, type PlanGeom, type WallGeom } from './geometry'
import { slotOverrides } from './place'
import { OPENING_DEFAULTS, type Level, type Opening, type RoomInfo, type Vec2 } from './types'

export type RoomKind = 'bedroom' | 'kids' | 'living' | 'kitchen' | 'dining' | 'bathroom' | 'wc' | 'office' | 'hall'

/** What a room is, from its name (Danish or English). */
export function roomKind(name: string): RoomKind {
  const n = name.toLowerCase()
  if (/\bwc\b|toilet|gæstetoilet/.test(n)) return 'wc'
  if (/bad|bath/.test(n)) return 'bathroom'
  if (/sove|bedroom|master/.test(n)) return 'bedroom'
  if (/køkken|kitchen|alrum/.test(n)) return 'kitchen'
  if (/spise|dining/.test(n)) return 'dining'
  if (/stue|living|opholds|lounge/.test(n)) return 'living'
  if (/kontor|office|study|arbejds/.test(n)) return 'office'
  if (/børne|barne|kids|child|værelse|room \d/.test(n)) return 'kids'
  return 'hall'
}

type Quad = Vec2[]

/** Convex quads overlap (separating axis test), with a small allowance. */
function overlaps(a: Quad, b: Quad, slack = 0.02) {
  for (const poly of [a, b])
    for (let i = 0; i < 4; i++) {
      const p = poly[i]
      const q = poly[(i + 1) % 4]
      const n: Vec2 = [q[1] - p[1], p[0] - q[0]]
      const proj = (P: Quad) => P.map((v) => v[0] * n[0] + v[1] * n[1])
      const A = proj(a)
      const B = proj(b)
      const l = Math.hypot(n[0], n[1]) || 1
      if (Math.max(...A) <= Math.min(...B) + slack * l || Math.max(...B) <= Math.min(...A) + slack * l) return false
    }
  return true
}

interface Ctx {
  face: Face
  geom: PlanGeom
  level: Level
  openings: Opening[]
  taken: { q: Quad; o: SceneObject; soft: boolean }[]
  out: SceneObject[]
}

const quadOf = (o: SceneObject) => footprint(o).corners
/** The furniture taken into account so far (not the door swings). */
const pieces = (ctx: Ctx) => ctx.taken.filter((t) => t.o.transform).map((t) => t.o)

function make(item: CatalogItem, c: Vec2, yaw: number, level: Level, size?: Vec3): SceneObject {
  const s = size ?? item.size
  const y = item.mount === 'ceiling' ? level.height - s[1] : (item.y ?? 0)
  return {
    id: Math.random().toString(36).slice(2, 10),
    name: item.name,
    source: item.kind === 'model' ? `Catalog · ${item.model!.credit}` : 'Catalog',
    furniture: item.kind === 'parametric' ? { item: item.id, size: s } : undefined,
    modelFile: item.kind === 'model' ? item.model!.file : undefined,
    surfaces: slotOverrides(item),
    levelId: level.id,
    exact: true,
    visible: true,
    renderable: true,
    shade: 'original',
    material: null,
    transform: { position: [c[0], y, c[1]], rotation: [0, yaw, 0], scale: [1, 1, 1] },
  }
}

const TABLES = new Set(['dining-table', 'round-table', 'desk', 'sit-stand-desk', 'kitchen-island', 'coffee-table'])
const SEATS = new Set(['dining-chair', 'office-chair', 'bar-stool', 'damask-chair'])

/** Fits: inside the room and clear of the other pieces (rugs and ceiling lamps may overlap; chairs tuck under tables). */
function fits(ctx: Ctx, o: SceneObject, soft: boolean) {
  const q = quadOf(o)
  const inner = ctx.face.inner.length >= 3 ? ctx.face.inner : ctx.face.polygon
  if (!soft && !q.every((p) => pointInPolygon(p, inner))) return false
  const seat = SEATS.has(o.furniture?.item ?? '')
  return soft || ctx.taken.every((t) => t.soft || (seat && TABLES.has(t.o.furniture?.item ?? '')) || !overlaps(q, t.q))
}

function add(ctx: Ctx, o: SceneObject, soft = false) {
  ctx.taken.push({ q: quadOf(o), o, soft })
  ctx.out.push(o)
  return o
}

/** The room's walls: free stretches along each, with the inward normal. */
function wallSpots(ctx: Ctx) {
  const spots: { g: WallGeom; n: Vec2; a: number; b: number }[] = []
  for (const f of roomFaces(ctx.geom, ctx.face.index)) {
    const sgn = f.side === 'left' ? 1 : -1
    const n: Vec2 = [f.g.n[0] * sgn, f.g.n[1] * sgn]
    // Doors (and their swing) and openings that reach down to furniture height are not free.
    const blocked = ctx.openings
      .filter((o) => o.wallId === f.g.wall.id && o.sill < 0.9)
      .map((o) => {
        const sw = OPENING_DEFAULTS[o.kind].door ? 0.12 : 0.08
        return [o.t - o.width / 2 - sw, o.t + o.width / 2 + sw] as [number, number]
      })
    let spans: [number, number][] = [[f.u0 + 0.02, f.u1 - 0.02]]
    for (const [a, b] of blocked) spans = spans.flatMap(([p, q]) => (b <= p || a >= q ? [[p, q] as [number, number]] : ([[p, a], [b, q]] as [number, number][]).filter(([x, z]) => z - x > 0.3)))
    for (const [a, b] of spans) spots.push({ g: f.g, n, a, b })
  }
  return spots.sort((p, q) => q.b - q.a - (p.b - p.a))
}

/** Stand `item` with its back to a free wall stretch: the longest that takes it, or the one `pick` prefers. */
function againstWall(ctx: Ctx, item: CatalogItem | undefined, opts: { size?: Vec3; prefer?: (s: ReturnType<typeof wallSpots>[number]) => number; at?: 'middle' | 'end' } = {}) {
  if (!item) return null
  const size = opts.size ?? item.size
  const [w, , d] = size
  const spots = wallSpots(ctx).filter((s) => s.b - s.a >= w + 0.05)
  if (opts.prefer) spots.sort((p, q) => opts.prefer!(q) - opts.prefer!(p))
  for (const s of spots) {
    const tries = opts.at === 'end' ? [s.a + w / 2 + 0.02, s.b - w / 2 - 0.02, (s.a + s.b) / 2] : [(s.a + s.b) / 2, s.a + w / 2 + 0.02, s.b - w / 2 - 0.02]
    for (const u of tries) {
      const p: Vec2 = [s.g.wall.a[0] + s.g.d[0] * u + s.n[0] * (s.g.h + d / 2 + 0.01), s.g.wall.a[1] + s.g.d[1] * u + s.n[1] * (s.g.h + d / 2 + 0.01)]
      const o = make(item, p, Math.atan2(s.n[0], s.n[1]), ctx.level, size)
      if (fits(ctx, o, false)) return add(ctx, o)
    }
  }
  return null
}

/** Put `item` where the arrange rules would, near `p`. */
function companion(ctx: Ctx, id: string, near: Vec2, soft = false) {
  const item = itemById(id)
  if (!item) return null
  const r = arrange(item, item.size, near, pieces(ctx))
  if (!r) return null
  const o = make(item, r.c, r.yaw, ctx.level)
  if (!fits(ctx, o, soft)) return null
  return add(ctx, o, soft)
}

/** The most open spot in the room for a piece standing free (a dining table). */
function freeSpot(ctx: Ctx, item: CatalogItem | undefined, clearance: number) {
  if (!item) return null
  const inner = ctx.face.inner
  const xs = inner.map((p) => p[0])
  const ys = inner.map((p) => p[1])
  let best: { o: SceneObject; score: number } | null = null
  const longX = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys)
  for (let x = Math.min(...xs) + 0.5; x < Math.max(...xs) - 0.5; x += 0.25)
    for (let y = Math.min(...ys) + 0.5; y < Math.max(...ys) - 0.5; y += 0.25) {
      const o = make(item, [x, y], longX ? Math.PI / 2 : 0, ctx.level)
      // Room to pull the chairs out all round.
      const big = make(item, [x, y], longX ? Math.PI / 2 : 0, ctx.level, [item.size[0] + clearance * 2, item.size[1], item.size[2] + clearance * 2])
      if (!fits(ctx, o, false) || !fits(ctx, big, false)) continue
      const q = quadOf(o)
      const score = -Math.hypot(x - ctx.face.center[0], y - ctx.face.center[1]) + Math.min(...q.map((p) => Math.min(...inner.map((v) => Math.hypot(p[0] - v[0], p[1] - v[1]))))) * 0.2
      if (!best || score > best.score) best = { o, score }
    }
  return best ? add(ctx, best.o) : null
}

/** Furniture for one room (face), around what is already there. */
export function furnishRoom(input: { geom: PlanGeom; face: number; info?: RoomInfo; level: Level; openings: Opening[]; objects: SceneObject[] }): { kind: RoomKind; objects: SceneObject[] } {
  const face = input.geom.faces[input.face]
  const name = input.info?.name ?? ''
  const kind = roomKind(name)
  // A kitchen that is also the living room (alrum, "living & kitchen"): both sets, if they fit.
  const alsoLiving = kind === 'kitchen' && /stue|living|alrum|family|lounge/i.test(name)
  const ctx: Ctx = {
    face,
    geom: input.geom,
    level: input.level,
    openings: input.openings,
    taken: input.objects.filter((o) => !o.parentId && pointInPolygon([o.transform.position[0], o.transform.position[2]], face.polygon)).map((o) => ({ q: quadOf(o), o, soft: o.furniture?.item === 'rug' })),
    out: [],
  }
  // Doors swing through a square as wide as the door: kept clear (on both sides; a door may open either way).
  for (const op of input.openings) {
    if (!OPENING_DEFAULTS[op.kind].door || op.kind === 'archway') continue
    const g = [...input.geom.walls.values()].find((x) => x.wall.id === op.wallId && !x.wall.parentId)
    if (!g) continue
    for (const sgn of [1, -1]) {
      const at = (u: number, v: number): Vec2 => [g.wall.a[0] + g.d[0] * u + g.n[0] * v * sgn, g.wall.a[1] + g.d[1] * u + g.n[1] * v * sgn]
      const a = op.t - op.width / 2
      const b = op.t + op.width / 2
      const reach = g.h + (op.kind === 'sliding-door' ? 0.6 : Math.max(0.6, op.kind === 'door' ? op.width : op.width / 2) + 0.1)
      const q: Quad = [at(a, g.h), at(b, g.h), at(b, reach), at(a, reach)]
      ctx.taken.push({ q, o: { furniture: { item: '__door' } } as SceneObject, soft: false })
    }
  }
  const I = itemById
  const at = (o: SceneObject | null) => (o ? ([o.transform.position[0], o.transform.position[2]] as Vec2) : face.center)
  const front = (o: SceneObject, k: number): Vec2 => {
    const y = o.transform.rotation[1]
    return [o.transform.position[0] + Math.sin(y) * k, o.transform.position[2] + Math.cos(y) * k]
  }
  const side = (o: SceneObject, k: number): Vec2 => {
    const y = o.transform.rotation[1]
    return [o.transform.position[0] + Math.cos(y) * k, o.transform.position[2] - Math.sin(y) * k]
  }

  /** A dining table with chairs round it and a pendant over it, in the most open spot left. */
  const dining = () => {
    if (kind === 'dining' || face.area > 14 || /dining|spise/i.test(name)) {
      // Room to pull the chairs out, a little less if that's all there is.
      const table = freeSpot(ctx, I('dining-table'), 0.75) ?? freeSpot(ctx, I('dining-table'), 0.55) ?? freeSpot(ctx, I('round-table'), 0.55)
      if (table) {
        const ch = I('dining-chair')!
        const tw = table.furniture!.size[0]
        for (const [x, z] of [[-tw / 4, 0.9], [tw / 4, 0.9], [-tw / 4, -0.9], [tw / 4, -0.9], [tw / 2 + 0.5, 0], [-tw / 2 - 0.5, 0]] as const) {
          const y = table.transform.rotation[1]
          const p: Vec2 = [table.transform.position[0] + x * Math.cos(y) + z * Math.sin(y), table.transform.position[2] - x * Math.sin(y) + z * Math.cos(y)]
          const r = arrange(ch, ch.size, p, pieces(ctx))
          if (!r) continue
          const o = make(ch, r.c, r.yaw, ctx.level)
          if (fits(ctx, o, false)) add(ctx, o)
        }
        companion(ctx, 'pendant', at(table), true)
      }
    }
  }
  if (kind === 'bedroom' || kind === 'kids') {
    const bed = againstWall(ctx, I(kind === 'bedroom' && face.area > 9 ? 'bed-double' : 'bed-single'))
    if (bed) {
      companion(ctx, 'nightstand', side(bed, 1.2))
      if (kind === 'bedroom') companion(ctx, 'nightstand', side(bed, -1.2))
      companion(ctx, 'rug', front(bed, 0.2), true)
    }
    againstWall(ctx, I('wardrobe'), { at: 'end' })
    if (kind === 'kids') {
      const desk = againstWall(ctx, I('desk'), { at: 'end' })
      if (desk) companion(ctx, 'office-chair', front(desk, 0.6))
    } else if (face.area > 12) againstWall(ctx, I('dresser'))
  }
  if (kind === 'kitchen' || kind === 'dining') {
    if (kind === 'kitchen') {
      // A run of units along the longest free wall: fridge, base, sink, base, hob, base…
      const spot = wallSpots(ctx)[0]
      if (spot) {
        const run = ['fridge', 'drawer-cabinet', 'sink-cabinet', 'base-cabinet', 'hob-cabinet', 'base-cabinet', 'drawer-cabinet', 'base-cabinet']
        let u = spot.a + 0.02
        for (const id of run) {
          const it = I(id)!
          if (u + it.size[0] > spot.b - 0.02) break
          const c = u + it.size[0] / 2
          const d = it.size[2]
          const p: Vec2 = [spot.g.wall.a[0] + spot.g.d[0] * c + spot.n[0] * (spot.g.h + d / 2 + 0.01), spot.g.wall.a[1] + spot.g.d[1] * c + spot.n[1] * (spot.g.h + d / 2 + 0.01)]
          const o = make(it, p, Math.atan2(spot.n[0], spot.n[1]), ctx.level)
          if (!fits(ctx, o, false)) break
          add(ctx, o)
          if (id === 'hob-cabinet') companion(ctx, 'range-hood', p, true)
          u += it.size[0]
        }
      }
    }
  }
  if ((kind === 'kitchen' || kind === 'dining') && !alsoLiving) dining()
  if (kind === 'living' || alsoLiving) {
    const sofa = againstWall(ctx, I('sofa'))
    if (sofa) {
      // The TV across the room, on the wall facing the sofa.
      const sy = sofa.transform.rotation[1]
      const sf: Vec2 = [Math.sin(sy), Math.cos(sy)]
      const unit = againstWall(ctx, I('tv-unit'), { prefer: (s) => -(s.n[0] * sf[0] + s.n[1] * sf[1]) })
      if (unit) companion(ctx, 'tv', at(unit), true)
      companion(ctx, 'rug', front(sofa, 0.9), true)
      const table = companion(ctx, 'coffee-table', front(sofa, 0.9))
      companion(ctx, 'floor-lamp', side(sofa, 1.3))
      if (table) {
        const ac = I('armchair')!
        for (const k of [1.25, -1.25]) {
          const p = side(table, k)
          const r = arrange(ac, ac.size, p, pieces(ctx))
          const o = make(ac, p, r?.yaw ?? 0, ctx.level)
          if (fits(ctx, o, false)) {
            add(ctx, o)
            break
          }
        }
      }
    }
    againstWall(ctx, I('bookshelf'), { at: 'end' })
    againstWall(ctx, I('plant'), { at: 'end' })
    if (alsoLiving) dining()
  }
  if (kind === 'bathroom' || kind === 'wc') {
    againstWall(ctx, I('toilet'), { at: 'end' })
    const vanity = againstWall(ctx, I('vanity'), { size: kind === 'wc' ? [0.5, 0.86, 0.36] : undefined })
    if (vanity) companion(ctx, 'mirror', at(vanity), true)
    if (kind === 'bathroom') {
      if (!againstWall(ctx, I('bathtub'), { at: 'end' })) againstWall(ctx, I('shower'), { at: 'end' })
    }
  } else if (kind === 'office') {
    const desk = againstWall(ctx, I('desk'))
    if (desk) companion(ctx, 'office-chair', front(desk, 0.6))
    againstWall(ctx, I('bookshelf'), { at: 'end' })
    againstWall(ctx, I('plant'), { at: 'end' })
  }
  return { kind, objects: ctx.out }
}

// Starter homes: complete plans with finishes and furniture, built fresh (new ids) each time.
import { itemById } from '@/furniture/catalog'
import { DEFAULT_ANIMATION, DEFAULT_TOUR, newLevel, uid, type Project, type SceneObject, type Vec3 } from '@/store/workspace'
import { slotOverrides } from './place'
import { autoTour } from './tour'
import { OPENING_DEFAULTS, type Finish, type Level, type Opening, type OpeningKind, type RoomInfo, type Vec2, type Wall } from './types'

export interface Template {
  id: string
  name: string
  description: string
  build: () => Pick<Project, 'name' | 'levels' | 'walls' | 'openings' | 'rooms' | 'tour'> & { objects: Omit<SceneObject, 'id'>[] }
}

const PI = Math.PI
const F = (color: string, preset?: string): Finish => ({ color, preset })
const OAK_FLOOR = F('#c8a27a', 'oak-floor')
const TILE = F('#b9b7b2', 'grey-tile')
const TERRAZZO = F('#e7e3dc', 'terrazzo')
const WHITE = F('#f2efe9')

class Plan {
  levels: Level[] = []
  walls: Wall[] = []
  openings: Opening[] = []
  rooms: RoomInfo[] = []
  objects: Omit<SceneObject, 'id'>[] = []

  level(name: string, height: number) {
    const l = newLevel(name)
    l.height = height
    this.levels.push(l)
    return l
  }
  wall(level: Level, a: Vec2, b: Vec2, thickness: number) {
    const w: Wall = { id: uid(), levelId: level.id, a, b, thickness }
    this.walls.push(w)
    return w
  }
  /** `t`: centre in metres from the wall's start; `side`: which side a door opens to. */
  open(w: Wall, kind: OpeningKind, t: number, side: 'left' | 'right' = 'left', o: Partial<Opening> = {}) {
    const d = OPENING_DEFAULTS[kind]
    this.openings.push({ id: uid(), wallId: w.id, kind, t, width: d.width, height: d.height, sill: d.sill, hinge: 'a', side, open: 0, frame: F('#f4f2ee'), ...o })
  }
  room(level: Level, anchor: Vec2, name: string, floor: Finish, walls: Finish, ceiling: Finish = F('#fbfaf8')) {
    this.rooms.push({ id: uid(), levelId: level.id, anchor, name, floor, walls, ceiling })
  }
  /** A catalog piece at plan (x, z), facing `yaw` (0 = front towards +z). */
  put(level: Level, item: string, x: number, z: number, yaw = 0, o: { size?: Vec3; y?: number; name?: string; colors?: Record<string, Finish> } = {}) {
    const it = itemById(item)
    if (!it) throw new Error(`unknown item ${item}`)
    const size = o.size ?? it.size
    const y = o.y ?? (it.mount === 'ceiling' ? level.height - size[1] : (it.y ?? 0))
    const surfaces = slotOverrides(it)
    if (surfaces && o.colors)
      for (const [slot, f] of Object.entries(o.colors)) surfaces[slot] = { ...surfaces[slot], color: f.color, preset: f.preset ?? surfaces[slot]?.preset }
    this.objects.push({
      name: o.name ?? it.name,
      levelId: level.id,
      source: it.kind === 'model' ? `Catalog · ${it.model!.credit}` : 'Catalog',
      furniture: it.kind === 'parametric' ? { item, size } : undefined,
      modelFile: it.kind === 'model' ? it.model!.file : undefined,
      surfaces,
      visible: true,
      renderable: true,
      exact: true,
      shade: 'original',
      material: null,
      transform: { position: [x, y, z], rotation: [0, yaw, 0], scale: [1, 1, 1] },
    })
  }
  done(name: string) {
    const project = { name, levels: this.levels, walls: this.walls, openings: this.openings, rooms: this.rooms, objects: this.objects, tour: DEFAULT_TOUR, animation: DEFAULT_ANIMATION } as unknown as Project
    const { points, doors } = autoTour(project, this.levels[0].id, uid)
    // Doors the tour walks through stand open.
    for (const o of this.openings) if (doors.includes(o.id)) o.open = 1
    return { name, levels: this.levels, walls: this.walls, openings: this.openings, rooms: this.rooms, objects: this.objects, tour: { ...DEFAULT_TOUR, points } }
  }
}

function apartment() {
  const P = new Plan()
  const L = P.level('Apartment', 2.6)
  const ext = 0.25
  const int = 0.12
  const N = P.wall(L, [0, 0], [10.4, 0], ext)
  const E = P.wall(L, [10.4, 0], [10.4, 7.6], ext)
  const S = P.wall(L, [10.4, 7.6], [0, 7.6], ext)
  const W = P.wall(L, [0, 7.6], [0, 0], ext)
  const I1 = P.wall(L, [0, 3.4], [10.4, 3.4], int)
  P.wall(L, [6.2, 3.4], [6.2, 7.6], int)
  const I3 = P.wall(L, [3.4, 0], [3.4, 3.4], int)
  const I4 = P.wall(L, [7.4, 0], [7.4, 3.4], int)
  P.wall(L, [7.4, 2.0], [10.4, 2.0], int)

  P.open(N, 'door', 5.4, 'left', { width: 1.0, frame: F('#2a2a2c', 'powder-anthracite') })
  P.open(I3, 'door', 2.7, 'left', { width: 0.8 })
  P.open(I1, 'double-door', 4.6, 'left', { width: 1.4 })
  P.open(I1, 'door', 6.8, 'left', { width: 0.8, hinge: 'b' })
  P.open(I4, 'door', 1.0, 'right', { width: 0.8 })
  P.open(I4, 'door', 2.7, 'right', { width: 0.7 })
  P.open(S, 'wide-window', 8.6, 'left', { width: 2.2 })
  P.open(S, 'french-window', 5.8, 'left', { width: 1.4 })
  P.open(S, 'wide-window', 2.1, 'left', { width: 1.8 })
  P.open(W, 'window', 2.1, 'left', { width: 1.2 })
  P.open(N, 'window', 1.7, 'left', { width: 1.2 })
  P.open(N, 'window', 8.9, 'left', { width: 0.8, sill: 1.3, height: 0.8 })
  void E

  P.room(L, [3.1, 5.5], 'Living & kitchen', OAK_FLOOR, F('#e8dfd0'))
  P.room(L, [8.3, 5.5], 'Bedroom', OAK_FLOOR, F('#b5bfa6'))
  P.room(L, [1.7, 1.7], 'Kids room', OAK_FLOOR, F('#b7c7d6'))
  P.room(L, [5.4, 1.7], 'Hallway', TERRAZZO, WHITE)
  P.room(L, [8.9, 1.0], 'Bathroom', TILE, F('#f1f1ef', 'white-tile'))
  P.room(L, [8.9, 2.7], 'WC', TILE, F('#d9dad7'))

  // Kitchen along the hall wall
  const kz = 3.46 + 0.31
  P.put(L, 'fridge', 0.45, 3.46 + 0.33)
  P.put(L, 'oven-tower', 1.05, kz)
  P.put(L, 'base-cabinet', 1.65, kz)
  P.put(L, 'sink-cabinet', 2.35, kz)
  P.put(L, 'hob-cabinet', 3.05, kz)
  P.put(L, 'wall-cabinet', 1.65, 3.46 + 0.175)
  P.put(L, 'wall-cabinet', 2.35, 3.46 + 0.175, 0, { size: [0.8, 0.7, 0.35] })
  P.put(L, 'range-hood', 3.05, 3.46 + 0.25)
  // Dining
  P.put(L, 'dining-table', 1.7, 5.3)
  for (const x of [1.15, 2.25]) {
    P.put(L, 'dining-chair', x, 5.3 - 0.62, 0)
    P.put(L, 'dining-chair', x, 5.3 + 0.62, PI)
  }
  P.put(L, 'pendant', 1.7, 5.3)
  // Living
  P.put(L, 'rug', 4.75, 5.6, PI / 2, { size: [2.4, 0.012, 1.7] })
  P.put(L, 'sofa', 3.75, 5.6, PI / 2)
  P.put(L, 'coffee-table', 4.85, 5.6, PI / 2)
  P.put(L, 'tv-unit', 6.14 - 0.21, 5.6, -PI / 2)
  P.put(L, 'tv', 6.14 - 0.15, 5.6, -PI / 2, { y: 0.5 })
  P.put(L, 'sheen-chair', 5.1, 7.0, PI + 0.5)
  P.put(L, 'floor-lamp', 3.55, 6.95)
  P.put(L, 'plant', 5.85, 7.15)
  P.put(L, 'bookshelf', 0.125 + 0.175, 6.6, PI / 2, { size: [1.2, 1.9, 0.35] })
  P.put(L, 'wall-art', 3.75, 3.46 + 0.015, 0, { y: 1.25 })
  // Bedroom
  P.put(L, 'bed-double', 10.275 - 1.05, 5.5, -PI / 2)
  P.put(L, 'nightstand', 10.275 - 0.2, 4.35, -PI / 2)
  P.put(L, 'nightstand', 10.275 - 0.2, 6.65, -PI / 2)
  P.put(L, 'wardrobe', 9.0, 3.46 + 0.3, 0, { size: [1.8, 2.2, 0.6] })
  P.put(L, 'dresser', 6.26 + 0.225, 5.8, PI / 2)
  P.put(L, 'rug', 8.6, 5.5, PI / 2, { size: [2.0, 0.012, 1.4], colors: { Rug: F('#8c7a68', 'wool') } })
  P.put(L, 'curtains', 8.3, 7.475 - 0.08, PI, { size: [2.6, 2.5, 0.12] })
  // Kids room
  P.put(L, 'bed-single', 0.125 + 1.025, 1.0, PI / 2)
  P.put(L, 'desk', 3.34 - 0.35, 0.95, -PI / 2, { size: [1.2, 0.75, 0.7] })
  P.put(L, 'office-chair', 2.45, 0.95, PI / 2)
  P.put(L, 'wardrobe', 1.0, 3.34 - 0.3, PI, { size: [1.2, 2.2, 0.6] })
  P.put(L, 'rug', 1.9, 2.0, 0, { size: [1.6, 0.012, 1.1], colors: { Rug: F('#9db0c4', 'wool') } })
  // Hallway
  P.put(L, 'wall-art', 3.4 + 0.075, 1.6, PI / 2, { y: 1.3, size: [0.6, 0.8, 0.03] })
  P.put(L, 'vase', 6.8, 0.4)
  // Bathroom
  P.put(L, 'bathtub', 9.4, 0.125 + 0.375)
  P.put(L, 'toilet', 10.275 - 0.33, 1.45, -PI / 2)
  P.put(L, 'vanity', 8.5, 1.94 - 0.24, PI)
  P.put(L, 'mirror', 8.5, 1.94 - 0.015, PI)
  // WC
  P.put(L, 'toilet', 10.275 - 0.33, 2.7, -PI / 2)
  return P.done('Two-bedroom apartment')
}

function house() {
  const P = new Plan()
  const G = P.level('Ground floor', 2.7)
  const U = P.level('First floor', 2.6)
  const ext = 0.3
  const int = 0.12
  for (const L of [G, U]) {
    P.wall(L, [0, 0], [9, 0], ext)
    P.wall(L, [9, 0], [9, 8], ext)
    P.wall(L, [9, 8], [0, 8], ext)
    P.wall(L, [0, 8], [0, 0], ext)
  }
  const [gN, gE, gS, gW, uN, uE, uS, uW] = P.walls
  void gE

  // Ground floor
  const G1 = P.wall(G, [0, 4.2], [5.4, 4.2], int)
  const G2 = P.wall(G, [5.4, 0], [5.4, 8], int)
  const G3 = P.wall(G, [5.4, 3.2], [9, 3.2], int)
  P.wall(G, [7.2, 0], [7.2, 3.2], int)
  P.open(gS, 'door', 2.6, 'left', { width: 1.0, frame: F('#2a2a2c', 'powder-anthracite') })
  P.open(G2, 'door', 6.6, 'left', { width: 0.9 })
  P.open(G2, 'door', 3.7, 'left', { width: 0.8 })
  P.open(G1, 'archway', 4.4, 'left', { width: 1.4 })
  P.open(G3, 'door', 2.6, 'right', { width: 0.7 })
  P.open(G3, 'door', 0.9, 'right', { width: 0.7 })
  P.open(gS, 'wide-window', 6.3, 'left', { width: 2.4 })
  P.open(gW, 'french-window', 2.0, 'left', { width: 1.4 })
  P.open(gW, 'window', 6.0, 'left', { width: 1.2 })
  P.open(gN, 'wide-window', 2.7, 'left', { width: 1.8, sill: 1.05, height: 1.1 })
  P.open(gN, 'window', 8.1, 'left', { width: 0.6, sill: 1.4, height: 0.7 })
  P.room(G, [2.7, 6.1], 'Living room', OAK_FLOOR, F('#cfc7bb'))
  P.room(G, [2.7, 2.1], 'Kitchen & dining', TILE, F('#f2efe9'))
  P.room(G, [7.2, 5.6], 'Hall', TERRAZZO, F('#e8dfd0'))
  P.room(G, [6.3, 1.6], 'Pantry', TILE, WHITE)
  P.room(G, [8.1, 1.6], 'WC', TILE, F('#3b4f45'))

  // Kitchen run under the north window, island in front.
  const kz = 0.15 + 0.31
  P.put(G, 'fridge', 0.5, 0.15 + 0.33, 0)
  P.put(G, 'oven-tower', 1.1, kz)
  P.put(G, 'base-cabinet', 1.7, kz)
  P.put(G, 'sink-cabinet', 2.5, kz)
  P.put(G, 'base-cabinet', 3.3, kz, 0, { size: [0.8, 0.9, 0.62] })
  P.put(G, 'hob-cabinet', 4.0, kz)
  P.put(G, 'drawer-cabinet', 4.6, kz)
  P.put(G, 'range-hood', 4.0, 0.15 + 0.25)
  P.put(G, 'kitchen-island', 2.6, 2.3, PI)
  for (const x of [2.0, 2.6, 3.2]) P.put(G, 'bar-stool', x, 3.25)
  P.put(G, 'barn-lamp', 2.3, 2.3)
  P.put(G, 'barn-lamp', 2.9, 2.3)
  // Living room
  P.put(G, 'rug', 2.0, 6.0, 0, { size: [2.6, 0.012, 1.8], colors: { Rug: F('#d6cbbd', 'wool') } })
  P.put(G, 'glam-sofa', 2.0, 7.2, PI)
  P.put(G, 'coffee-table', 2.0, 6.0)
  P.put(G, 'tv-unit', 2.0, 4.26 + 0.21, 0, { size: [2.0, 0.5, 0.42] })
  P.put(G, 'tv', 2.0, 4.26 + 0.15, 0, { y: 0.5 })
  P.put(G, 'damask-chair', 4.3, 6.3, -PI / 2 - 0.4)
  P.put(G, 'silk-pouf', 3.6, 7.2)
  P.put(G, 'arc-lamp', 0.75, 7.3, PI * 0.75)
  P.put(G, 'plant', 4.9, 7.4)
  // Hall: the stairs up, along the east wall.
  P.put(G, 'stairs', 8.35, 5.7, 0, { size: [1.0, 2.7 + 0.25, 3.6] })
  P.put(G, 'wall-art', 5.46 + 0.015, 5.2, PI / 2, { y: 1.3, size: [0.7, 0.9, 0.03] })
  // WC
  P.put(G, 'toilet', 8.1, 0.15 + 0.33)
  P.put(G, 'vanity', 8.85 - 0.24, 2.3, -PI / 2, { size: [0.6, 0.86, 0.45] })
  P.put(G, 'mirror', 8.85 - 0.015, 2.3, -PI / 2, { size: [0.5, 0.7, 0.03] })

  // First floor
  const F1 = P.wall(U, [0, 4.2], [5.4, 4.2], int)
  const F2 = P.wall(U, [5.4, 4.2], [5.4, 8], int)
  const F3 = P.wall(U, [3.2, 0], [3.2, 4.2], int)
  const F5 = P.wall(U, [3.2, 2.6], [9, 2.6], int)
  P.wall(U, [5.4, 0], [5.4, 2.6], int)
  void F1
  P.open(F2, 'door', 0.8, 'left', { width: 0.8 })
  P.open(F3, 'door', 3.4, 'left', { width: 0.8, hinge: 'b' })
  P.open(F5, 'door', 1.1, 'right', { width: 0.8 })
  P.open(F5, 'door', 3.8, 'right', { width: 0.8 })
  P.open(uS, 'window', 4.7, 'left', { width: 1.4 })
  P.open(uW, 'window', 6.0, 'left', { width: 1.2 })
  P.open(uN, 'window', 4.3, 'left', { width: 0.7, sill: 1.3, height: 0.8 })
  P.open(uN, 'wide-window', 7.2, 'left', { width: 1.6 })
  P.open(uE, 'window', 5.8, 'left', { width: 1.0 })
  P.room(U, [2.7, 6.1], 'Main bedroom', OAK_FLOOR, F('#b9cfcc'))
  P.room(U, [1.6, 2.1], 'Bedroom', OAK_FLOOR, F('#e3c4b9'))
  P.room(U, [4.3, 1.3], 'Bathroom', TILE, F('#f1f1ef', 'white-tile'))
  P.room(U, [7.2, 1.3], 'Study', OAK_FLOOR, F('#7d8261'))
  P.room(U, [7.0, 5.6], 'Landing', OAK_FLOOR, F('#f2efe9'))

  P.put(U, 'bed-double', 2.6, 8 - 0.15 - 1.05, PI, { size: [1.8, 1.05, 2.1] })
  P.put(U, 'nightstand', 2.6 - 1.25, 8 - 0.15 - 0.2, PI)
  P.put(U, 'nightstand', 2.6 + 1.25, 8 - 0.15 - 0.2, PI)
  P.put(U, 'wardrobe', 2.6, 4.26 + 0.3, 0, { size: [2.4, 2.3, 0.6] })
  P.put(U, 'rug', 2.6, 6.2, 0, { size: [2.4, 0.012, 1.6], colors: { Rug: F('#a59784', 'wool') } })
  P.put(U, 'bed-single', 0.15 + 1.025, 1.0, PI / 2)
  P.put(U, 'dresser', 0.15 + 0.225, 3.2, PI / 2, { size: [1.0, 0.8, 0.45] })
  P.put(U, 'bathtub', 4.3, 0.15 + 0.375, 0, { size: [1.9, 0.58, 0.75] })
  P.put(U, 'vanity', 3.26 + 0.24, 1.7, PI / 2)
  P.put(U, 'mirror', 3.26 + 0.015, 1.7, PI / 2)
  P.put(U, 'toilet', 5.34 - 0.33, 1.8, -PI / 2)
  P.put(U, 'desk', 7.2, 0.15 + 0.35, 0, { size: [1.6, 0.75, 0.7] })
  P.put(U, 'office-chair', 7.2, 1.1, PI)
  P.put(U, 'bookshelf', 8.85 - 0.175, 1.3, -PI / 2, { size: [1.0, 1.9, 0.35] })
  P.put(U, 'leather-sofa', 6.6, 6.9, PI / 2 + PI)
  P.put(U, 'plant', 6.0, 7.5)
  return P.done('Two-storey house')
}

function empty() {
  const P = new Plan()
  P.level('Ground floor', 2.6)
  return P.done('New home')
}

export const TEMPLATES: Template[] = [
  { id: 'apartment', name: 'Two-bedroom apartment', description: '78 m² on one floor: open kitchen and living, two bedrooms, bathroom and WC, furnished.', build: apartment },
  { id: 'house', name: 'Two-storey house', description: '2 × 72 m² with stairs: living, kitchen with island, three rooms upstairs, furnished.', build: house },
  { id: 'empty', name: 'Empty plan', description: 'Start from scratch: draw rooms with the Room tool, walls with the Wall tool.', build: empty },
]

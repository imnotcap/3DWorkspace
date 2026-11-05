// Run with: npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { billOfMaterials, bomCsv, measureRooms } from '../src/plan/quantities.ts'
import { buildingChecks } from '../src/plan/checks.ts'
import { TEMPLATES } from '../src/plan/templates.ts'
import type { Opening, RoomInfo, Wall } from '../src/plan/types.ts'

const close = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`)
const wall = (id: string, a: [number, number], b: [number, number]): Wall => ({ id, levelId: 'L', a, b, thickness: 0.2 })
// 5 × 4 m on the centreline → 4.8 × 3.8 inside.
const walls = [wall('s', [0, 0], [5, 0]), wall('e', [5, 0], [5, 4]), wall('n', [5, 4], [0, 4]), wall('w', [0, 4], [0, 0])]
const level = { id: 'L', name: 'Ground floor', elevation: 0, height: 2.5, slab: 0.2 }
const opening = (id: string, wallId: string, kind: Opening['kind'], width: number, height: number, sill: number): Opening => ({ id, wallId, kind, t: 2.5, width, height, sill, hinge: 'a', side: 'left', open: 0, frame: { color: '#fff' } })
const room = (name: string, extra: Partial<RoomInfo> = {}): RoomInfo => ({ id: 'r', levelId: 'L', anchor: [2.5, 2], name, floor: { color: '#c8a27a', preset: 'oak-floor' }, walls: { color: '#ffffff' }, ceiling: { color: '#ffffff' }, ...extra })

test('a room: floor, walls less openings, skirting less doors', () => {
  const openings = [opening('d', 's', 'door', 0.9, 2.1, 0), opening('w', 'n', 'window', 1.2, 1.2, 0.9)]
  const [r] = measureRooms({ levels: [level], walls, openings, rooms: [room('Living room')] })
  close(r.area, 4.8 * 3.8)
  close(r.perimeter, 2 * (4.8 + 3.8))
  close(r.wallArea, 2 * (4.8 + 3.8) * 2.5 - 0.9 * 2.1 - 1.2 * 1.2)
  assert.equal(r.windows.length, 1)
  assert.equal(r.doors.length, 1)
  const rows = billOfMaterials({ levels: [level], walls, openings, rooms: [room('Living room')], objects: [] }, [r])
  const floor = rows.find((x) => x.key === 'floor:oak-floor')!
  close(floor.qty, Math.round(4.8 * 3.8 * 1.07 * 100) / 100, 0.01)
  const skirting = rows.find((x) => x.key === 'skirting')!
  assert.equal(skirting.qty, Math.ceil((2 * (4.8 + 3.8) - 0.9) * 1.1))
  assert.equal(rows.filter((x) => x.group === 'Doors & windows').length, 2)
  assert.ok(bomCsv(rows).includes('Oak planks'))
})

test('a sloped ceiling: more ceiling than floor, part of the room below 2.5 m', () => {
  const rooms = [room('Bedroom', { roof: { shape: 'gable', height: 1.5, ridge: 3.5, ridgeLong: true } })]
  const [r] = measureRooms({ levels: [level], walls, openings: [], rooms })
  close(r.minHeight, 1.5)
  close(r.maxHeight, 3.5, 0.06)
  assert.ok(r.ceilingArea > r.area * 1.2)
  assert.ok(r.fullHeightShare > 0.4 && r.fullHeightShare < 0.6, String(r.fullHeightShare))
})

test('BR18 checks: too little glass, low ceiling, narrow door, no escape window', () => {
  const openings = [opening('d', 's', 'door', 0.7, 2.0, 0), opening('w', 'n', 'window', 0.5, 0.5, 1.4)]
  const rooms = measureRooms({ levels: [{ ...level, height: 2.3 }], walls, openings, rooms: [room('Soveværelse')] })
  const titles = buildingChecks(rooms).filter((c) => c.level === 'warn').map((c) => c.title)
  assert.ok(titles.some((t) => t.startsWith('Daylight')), titles.join())
  assert.ok(titles.some((t) => t.startsWith('Ceiling height')), titles.join())
  assert.ok(titles.some((t) => t.endsWith('narrow')), titles.join())
  assert.ok(titles.includes('No escape window'), titles.join())
})

test('templates: every room measured, a bill and checks for each', () => {
  for (const t of TEMPLATES.filter((x) => x.id !== 'empty')) {
    const p = t.build() as never as Parameters<typeof billOfMaterials>[0]
    const rooms = measureRooms(p)
    assert.ok(rooms.length > 0)
    rooms.forEach((r) => assert.ok(r.area > 0 && r.wallArea > 0 && Number.isFinite(r.ceilingArea), `${t.id} · ${r.name}`))
    const rows = billOfMaterials(p, rooms)
    assert.ok(rows.some((r) => r.group === 'Furniture'), t.id)
    assert.ok(rows.every((r) => Number.isFinite(r.qty) && r.qty > 0), t.id)
    buildingChecks(rooms)
  }
})

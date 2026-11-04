// Run with: npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { boardFit, ceilingAt, ceilingGeometry, roofFrame } from '../src/plan/roof.ts'
import type { RoomRoof, Vec2 } from '../src/plan/types.ts'

const room: Vec2[] = [[0, 0], [5, 0], [5, 3.6], [0, 3.6]]
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`)

test('pitched ceiling: eaves at the long walls, ridge down the middle', () => {
  const roof: RoomRoof = { shape: 'gable', height: 2.5, ridge: 4.3, ridgeLong: true }
  const f = roofFrame(room, roof)
  close(ceilingAt(roof, f, [2, 0]), 2.5)
  close(ceilingAt(roof, f, [2, 3.6]), 2.5)
  close(ceilingAt(roof, f, [4, 1.8]), 4.3)
  close(ceilingAt(roof, f, [1, 0.9]), 3.4)
  // The surface has its fold exactly on the ridge.
  const g = ceilingGeometry(room, roof, f, [], (a, c) => [a, c])
  const ys = Array.from(g.attributes.position.array).filter((_, i) => i % 3 === 1)
  close(Math.max(...ys), 4.3)
  assert.ok(Array.from(g.attributes.normal.array).filter((_, i) => i % 3 === 1).every((ny) => ny < 0), 'faces down')
})

test('lean-to: low on one side, high on the other, and flipped', () => {
  const roof: RoomRoof = { shape: 'shed', height: 2.4, ridge: 3.6, ridgeLong: true }
  const f = roofFrame(room, roof)
  close(ceilingAt(roof, f, [1, 0]), 2.4)
  close(ceilingAt(roof, f, [1, 3.6]), 3.6)
  close(ceilingAt({ ...roof, flip: true }, f, [1, 0]), 3.6)
})

test('ceiling boards: whole boards from wall to wall when they nearly fit', () => {
  const roof: RoomRoof = { shape: 'flat', height: 2.6, ridge: 3.8, ridgeLong: true }
  const f = roofFrame([[0, 0], [4.7, 0], [4.7, 3.5], [0, 3.5]], roof)
  const uv = boardFit(roof, f, [1.2, 1.2])
  // 4.7 m → 4 boards (1.175 m): the far wall is exactly 4 board lengths.
  close(uv(4.7, 0)[0] / 1.2, 4)
  close(uv(0, 3.5)[1] / 1.2, 3)
})

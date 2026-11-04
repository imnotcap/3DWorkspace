import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyse } from '../src/plan/geometry.ts'
import { clearOfWalls, corners, pushOut, WALL_GAP, type Body } from '../src/plan/collide.ts'

type V = [number, number]
let n = 0
const wall = (a: V, b: V, thickness = 0.2) => ({ id: `w${n++}`, levelId: 'L', a, b, thickness })
const rect = (x0: number, y0: number, x1: number, y1: number) => [wall([x0, y0], [x1, y0]), wall([x1, y0], [x1, y1]), wall([x1, y1], [x0, y1]), wall([x0, y1], [x0, y0])]
const room = analyse(rect(0, 0, 4, 3)) // inside faces at x = 0.1 … 3.9, y = 0.1 … 2.9
const H = () => 2.6
const body = (c: V, w = 1, d = 0.6, yaw = 0): Body => ({ c, w, d, yaw, y0: 0, y1: 2 })

test('a piece clear of the walls stays put', () => {
  assert.deepEqual(clearOfWalls(body([2, 1.5]), room.walls.values(), H), [2, 1.5])
})

test('a piece pushed into a wall comes back out, touching it', () => {
  // Back half inside the top wall (inside face at y = 0.1), depth 0.6.
  const c = clearOfWalls(body([2, 0.2]), room.walls.values(), H)
  assert.ok(Math.abs(c[0] - 2) < 1e-9)
  assert.ok(Math.abs(c[1] - (0.1 + 0.3 + WALL_GAP)) < 1e-6, String(c))
})

test('a piece in a corner is pushed out of both walls', () => {
  const c = clearOfWalls(body([0.2, 0.2]), room.walls.values(), H)
  const pts = corners(body(c))
  for (const p of pts) assert.ok(p[0] >= 0.1 + WALL_GAP - 1e-6 && p[1] >= 0.1 + WALL_GAP - 1e-6, String(p))
})

test('rotated pieces are tested by their real footprint', () => {
  const c = clearOfWalls(body([3.7, 1.5], 1, 0.6, Math.PI / 4), room.walls.values(), H)
  for (const p of corners(body(c, 1, 0.6, Math.PI / 4))) assert.ok(p[0] <= 3.9 - WALL_GAP + 1e-6, String(p))
})

test('a wall lower than the piece’s bottom does not block it', () => {
  const c = clearOfWalls({ ...body([2, 0.2]), y0: 1.5, y1: 2 }, room.walls.values(), () => 1.0)
  assert.deepEqual(c, [2, 0.2])
})

test('pushOut returns null for separated polygons', () => {
  const a: V[] = [[0, 0], [1, 0], [1, 1], [0, 1]]
  const b: V[] = [[2, 0], [3, 0], [3, 1], [2, 1]]
  assert.equal(pushOut(a, b), null)
})

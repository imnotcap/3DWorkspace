// Run with: npm test  (Node's built-in runner, TypeScript types stripped)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyse, clampOpening, dist, signedArea } from '../src/plan/geometry.ts'

type V = [number, number]
let n = 0
const wall = (a: V, b: V, thickness = 0.2) => ({ id: `w${n++}`, levelId: 'L', a, b, thickness })
const rect = (x0: number, y0: number, x1: number, y1: number, t = 0.2) => [wall([x0, y0], [x1, y0], t), wall([x1, y0], [x1, y1], t), wall([x1, y1], [x0, y1], t), wall([x0, y1], [x0, y0], t)]
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`)
const near = (p: V, q: V, eps = 1e-6) => assert.ok(dist(p, q) < eps, `${p} ≠ ${q}`)

test('a closed rectangle is one room with its net area', () => {
  const g = analyse(rect(0, 0, 4, 3))
  assert.equal(g.faces.length, 1)
  // Centreline 4 × 3, walls 20 cm thick → inside 3.8 × 2.8
  close(g.faces[0].area, 3.8 * 2.8)
  close(signedArea(g.faces[0].polygon), 12)
})

test('corners are mitred: outer and inner corners meet exactly', () => {
  const ws = rect(0, 0, 4, 3)
  const g = analyse(ws)
  const w0 = g.walls.get(ws[0].id)! // (0,0) → (4,0); left normal points +y (into the room)
  near(w0.la, [0.1, 0.1])
  near(w0.ra, [-0.1, -0.1])
  near(w0.lb, [3.9, 0.1])
  near(w0.rb, [4.1, -0.1])
  const w3 = g.walls.get(ws[3].id)! // (0,3) → (0,0) ends at the same corner
  near(w3.lb, [0.1, 0.1])
  near(w3.rb, [-0.1, -0.1])
  assert.equal(w0.freeA || w0.freeB, false)
})

test('a dividing wall splits the room in two, T-joints trimmed to the wall face', () => {
  const ws = [...rect(0, 0, 6, 4), wall([3, 0], [3, 4], 0.1)]
  const g = analyse(ws)
  assert.equal(g.faces.length, 2)
  const areas = g.faces.map((f) => f.area).sort((a, b) => a - b)
  // Each side: x from 0.1 to 2.95 (or 3.05 to 5.9) → 2.85 wide, y 0.1..3.9 → 3.8 deep
  close(areas[0], 2.85 * 3.8)
  close(areas[1], 2.85 * 3.8)
  const mid = g.walls.get(ws[4].id)!
  // Its ends stop at the inner faces of the outer walls (y = 0.1 and y = 3.9).
  near(mid.ra, [3.05, 0.1])
  near(mid.la, [2.95, 0.1])
  near(mid.lb, [2.95, 3.9])
  near(mid.rb, [3.05, 3.9])
  // The bottom outer wall now has two stretches, a room above each.
  const bottom = g.walls.get(ws[0].id)!
  assert.equal(bottom.segments.length, 2)
  assert.ok(bottom.segments.every((s) => s.left !== null && s.right === null))
})

test('a wall sticking into a room does not create a room', () => {
  const ws = [...rect(0, 0, 5, 4), wall([2, 0], [2, 2], 0.1)]
  const g = analyse(ws)
  assert.equal(g.faces.length, 1)
  assert.ok(g.faces[0].polygon.length >= 4)
})

test('crossing walls are split at the crossing', () => {
  const ws = [...rect(0, 0, 4, 4), wall([2, 0], [2, 4], 0.1), wall([0, 2], [4, 2], 0.1)]
  const g = analyse(ws)
  assert.equal(g.faces.length, 4)
  for (const f of g.faces) close(f.area, (2 - 0.1 - 0.05) ** 2)
})

test('an open polyline is walls without rooms; free ends get end faces', () => {
  const ws = [wall([0, 0], [3, 0]), wall([3, 0], [3, 2])]
  const g = analyse(ws)
  assert.equal(g.faces.length, 0)
  assert.equal(g.walls.get(ws[0].id)!.freeA, true)
  assert.equal(g.walls.get(ws[1].id)!.freeB, true)
})

test('three walls meeting at one point get a cap on top', () => {
  const ws = [wall([0, 0], [2, 0]), wall([0, 0], [-1, 1.5]), wall([0, 0], [-1, -1.5])]
  const g = analyse(ws)
  assert.equal(g.caps.length, 1)
  assert.equal(g.caps[0].length, 3)
})

test('openings stay clear of the wall ends', () => {
  close(clampOpening(0.1, 0.9, 4), 0.5)
  close(clampOpening(3.9, 0.9, 4), 3.5)
  close(clampOpening(2, 0.9, 4), 2)
})

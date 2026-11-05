// Run with: npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { arrange } from '../src/plan/arrange.ts'
import { itemById } from '../src/furniture/catalog.ts'
import type { SceneObject, Vec3 } from '../src/store/workspace.ts'

const piece = (item: string, x: number, z: number, yaw = 0, size?: Vec3): SceneObject =>
  ({ id: `${item}${x}${z}`, name: item, furniture: { item, size: size ?? itemById(item)!.size }, visible: true, renderable: true, source: 'test', shade: 'original', material: null, transform: { position: [x, 0, z], rotation: [0, yaw, 0], scale: [1, 1, 1] } }) as SceneObject
const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`)
const facing = (yaw: number): [number, number] => [Math.sin(yaw), Math.cos(yaw)]

test('a chair put down by a table is pulled up to its nearest side, facing it', () => {
  const table = piece('dining-table', 0, 0) // 1.8 wide (x), 0.9 deep (z)
  const chair = itemById('dining-chair')!
  const r = arrange(chair, chair.size, [0.3, 1.0], [table])!
  assert.ok(r, 'arranged')
  const f = facing(r.yaw)
  close(f[0], 0)
  close(f[1], -1) // faces −z, towards the table
  close(r.c[1], 0.45 + chair.size[2] / 2 - 0.1)
  close(r.c[0], 0.3)
  // A second chair at the same spot slides along, clear of the first.
  const first = piece('dining-chair', r.c[0], r.c[1], r.yaw)
  const r2 = arrange(chair, chair.size, [0.3, 1.0], [table, first])!
  assert.ok(Math.abs(r2.c[0] - r.c[0]) >= chair.size[0] * 0.95)
  // At the end of the table: facing +x towards it.
  const r3 = arrange(chair, chair.size, [-1.3, 0.1], [table])!
  close(facing(r3.yaw)[0], 1)
})

test('a nightstand goes beside the head of the bed; a coffee table in front of the sofa', () => {
  const bed = piece('bed-double', 0, 0) // head at −z
  const ns = itemById('nightstand')!
  const r = arrange(ns, ns.size, [1.2, -0.6], [bed])!
  close(r.c[0], 0.8 + 0.25 + 0.04)
  close(r.c[1], -1.05 + 0.2 + 0.02)
  close(r.yaw, 0)
  const sofa = piece('sofa', 0, 0, Math.PI / 2) // facing +x
  const ct = itemById('coffee-table')!
  const r2 = arrange(ct, ct.size, [1.2, 0.2], [sofa])!
  close(r2.c[0], 0.475 + 0.42 + 0.3)
  close(r2.c[1], 0, 1e-9)
  // Nothing related nearby: left as it is.
  assert.equal(arrange(ct, ct.size, [9, 9], [sofa]), null)
})

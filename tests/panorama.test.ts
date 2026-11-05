// Run with: npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CUBE_FACES, equirect, tagPanorama, viewRotation } from '../src/viewport/panorama.ts'

const N = 32
/** Each face a flat colour (its index × 40 in red), with a left→right ramp in green. */
const views = CUBE_FACES.map((f, k) => {
  const data = new Uint8ClampedArray(N * N * 4)
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) data.set([k * 40, Math.round((x / (N - 1)) * 255), 0, 255], (y * N + x) * 4)
  return { data, rot: viewRotation(f.dir, f.up) }
})
const W = 256
const pano = equirect(views, N, W, 0)
const at = (x: number, y: number) => [...pano.subarray((y * W + x) * 4, (y * W + x) * 4 + 3)]
const face = (x: number, y: number) => Math.round(at(x, y)[0] / 40)

test('panorama: the middle looks ahead, the sides and poles come from the right views', () => {
  assert.equal(face(W / 2, W / 4), 2) // +z ahead (heading 0)
  assert.equal(face(0, W / 4), 3) // behind
  assert.equal(face((W * 3) / 4, W / 4), 1) // right of the middle: the viewer's right, −x
  assert.equal(face(W / 4, W / 4), 0) // left: +x
  assert.equal(face(W / 2, 0), 4) // up
  assert.equal(face(W / 2, W / 2 - 1), 5) // down
})

test('panorama: not mirrored (the view ahead brightens to the right)', () => {
  assert.ok(at(W / 2 + 10, W / 4)[1] > at(W / 2 - 10, W / 4)[1])
})

test('panorama: turned by the heading', () => {
  const p = equirect(views, N, W, Math.PI / 2)
  assert.equal(Math.round(p[((W / 4) * W + W / 2) * 4] / 40), 0) // heading +x
})

test('panorama tags go in right after the JPEG start', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3])
  const t = tagPanorama(jpeg, 4096, 2048)
  assert.deepEqual([...t.subarray(0, 4)], [0xff, 0xd8, 0xff, 0xe1])
  const len = (t[4] << 8) | t[5]
  assert.deepEqual([...t.subarray(4 + len, 4 + len + 2)], [0xff, 0xdb])
  assert.ok(new TextDecoder().decode(t).includes('equirectangular'))
})

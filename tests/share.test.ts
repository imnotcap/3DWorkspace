// Run with: npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decodeShare, encodeShare } from '../src/lib/share.ts'
import { TEMPLATES } from '../src/plan/templates.ts'

test('share link: a whole furnished home goes into a link and comes back the same', async () => {
  const t = TEMPLATES.find((x) => x.id === 'house')!.build()
  const objects = t.objects.map((o, i) => ({ ...o, id: `o${i}` }))
  const p = { ...t, id: 'p', objects, prices: { 'item:sofa': 12345 } } as never
  const { fragment, left } = await encodeShare(p)
  assert.equal(left, 0)
  assert.ok(fragment.length < 60000, `link is ${fragment.length} characters`)
  assert.match(fragment, /^plan=[A-Za-z0-9_-]+$/)
  const d = await decodeShare('#' + fragment)
  assert.equal(d.name, t.name)
  assert.equal(d.walls.length, t.walls.length)
  assert.equal(d.openings.length, t.openings.length)
  assert.equal(d.rooms.length, t.rooms.length)
  assert.equal(d.objects.length, objects.length)
  assert.equal(d.prices?.['item:sofa'], 12345)
  const w0 = t.walls[0]
  assert.ok(Math.abs(d.walls[0].a[0] - w0.a[0]) < 0.001)
  assert.ok(!('id' in d.objects[0]))
})

test('share link: a damaged link is refused', async () => {
  await assert.rejects(decodeShare('#plan=AAAA'))
  await assert.rejects(decodeShare('#other=1'))
})

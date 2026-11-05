// Run with: npm test
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { TEMPLATES } from '../src/plan/templates.ts'
import { analyse, pointInPolygon } from '../src/plan/geometry.ts'
import { roomFor } from '../src/plan/levels.ts'
import { furnishRoom, roomKind } from '../src/plan/furnish.ts'
import { footprint } from '../src/plan/footprint.ts'

// Pieces that may hang over a wall line (on it, above it, or flat under others).
const LOOSE = ['rug', 'pendant', 'tv', 'range-hood', 'mirror', 'wall-art', 'curtains']

test('room names: Danish and English', () => {
  assert.equal(roomKind('Soveværelse'), 'bedroom')
  assert.equal(roomKind('Børneværelse'), 'kids')
  assert.equal(roomKind('Stue'), 'living')
  assert.equal(roomKind('Køkken'), 'kitchen')
  assert.equal(roomKind('Badeværelse'), 'bathroom')
  assert.equal(roomKind('Living & kitchen'), 'kitchen')
})

test('furnish every template room: something in each, nothing through the walls', () => {
  for (const t of TEMPLATES) {
    const p = t.build() as never as { walls: { levelId: string }[]; levels: { id: string }[]; rooms: never[]; openings: never[] }
    for (const level of p.levels) {
      const geom = analyse(p.walls.filter((w) => w.levelId === level.id) as never)
      for (const f of geom.faces) {
        const info = roomFor(f, p.rooms, level.id)
        const r = furnishRoom({ geom, face: f.index, info, level: level as never, openings: p.openings, objects: [] })
        const where = `${t.id} · ${info?.name ?? '?'}`
        if (r.kind !== 'hall') assert.ok(r.objects.length > 0, `${where}: furnished`)
        r.objects.forEach((o) => {
          if (LOOSE.includes(o.furniture?.item ?? '')) return
          assert.ok(footprint(o).corners.every((c) => pointInPolygon(c, f.polygon)), `${where}: ${o.name} inside`)
        })
      }
    }
  }
})

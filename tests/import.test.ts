// Run with: npm test. The pixel side of the import is tested in Chromium (npm run test:import).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { areaLabels, correctName, pdfLines } from '../src/plan/importText.ts'
import { frameLayout } from '../src/plan/trim.ts'

const line = (str: string, x0: number, y0: number, w = 80, h = 16) => ({ str, x0, y0, x1: x0 + w, y1: y0 + h })

test('room labels: name over area, OCR misreadings of m², names on one line', () => {
  const labels = areaLabels([line('Værelse 1', 100, 100), line('12,3 m?', 105, 120, 60), line('Bad 4.6 m2', 400, 100, 90), line('Sanma', 600, 300, 60), line('2.8 n?', 600, 320, 50), line('Køkken-alrum', 800, 100, 110), line('32.5', 820, 120, 40)])
  const by = (n: string) => labels.find((l) => l.name === n)
  assert.equal(by('Værelse 1')?.area, 12.3)
  assert.equal(by('Bad')?.area, 4.6)
  assert.equal(by('Sauna')?.area, 2.8)
  assert.equal(by('Køkken-alrum')?.area, 32.5)
  assert.equal(labels.length, 4)
})

test('room names: near misses are corrected, other names kept', () => {
  assert.equal(correctName('Vaerelse 2'), 'Værelse 2')
  assert.equal(correctName('Soveværelse'), 'Soveværelse')
  assert.equal(correctName('Saveværelse'), 'Soveværelse')
  assert.equal(correctName('Musikrum'), 'Musikrum')
  assert.equal(correctName('WC'), 'WC')
})

test('PDF text pieces on one baseline join into lines', () => {
  const vt = [1, 0, 0, -1, 0, 800] // PDF y up → canvas y down
  const it = (str: string, x: number, y: number, w: number) => ({ str, transform: [12, 0, 0, 12, x, y], width: w, height: 12 })
  const lines = pdfLines([it('12,3', 100, 500, 24), it('m²', 127, 500, 14), it('Stue', 100, 515, 26)], vt)
  assert.deepEqual(lines.map((l) => l.str).sort(), ['12,3 m²', 'Stue'])
})

test('wall panel frames line up with a window above them and skip a radiator', () => {
  const window = { a: 1.0, b: 2.2, sill: 1.0, top: 2.3 }
  const spans = frameLayout([0, 4], [window], [], 0.15, 0.85, 0.6, 0.1)
  assert.ok(spans.some(([a, b]) => Math.abs(a - 1.0) < 1e-9 && Math.abs(b - 2.2) < 1e-9), JSON.stringify(spans))
  const withRad = frameLayout([0, 4], [window], [{ a: 1.05, b: 2.15, sill: 0.1, top: 0.8 }], 0.15, 0.85, 0.6, 0.1)
  assert.ok(withRad.every(([a, b]) => b <= 1.05 + 1e-9 || a >= 2.15 - 1e-9), JSON.stringify(withRad))
})

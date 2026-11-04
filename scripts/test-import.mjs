// Plan import end to end: fixture drawings rendered in Chromium, imported, checked against the truth.
// Run with: npm run test:import
import { createServer } from 'vite'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')

const cases = [
  { name: 'estate-agent drawing (grey floors), PNG, OCR', style: 'agent', pxPerM: 100, ocr: true },
  { name: 'architect drawing (white floors), PNG, OCR', style: 'architect', pxPerM: 80, ocr: true },
  { name: 'estate-agent drawing, PDF with text', style: 'agent', pxPerM: 60, pdf: true },
  { name: 'low resolution, no text (scale from walls)', style: 'agent', pxPerM: 55, ocr: false },
]
const only = process.argv[2]

const server = await createServer({ logLevel: 'error', server: { port: 5199, strictPort: false } })
await server.listen()
const base = server.resolvedUrls.local[0]
const browser = await chromium.launch()
let failed = 0
try {
  const page = await browser.newPage()
  page.on('console', (m) => m.type() === 'error' && console.log('  [browser]', m.text()))
  await page.goto(base + 'tests/fixtures/import.html')
  if (process.env.CAB_DEBUG) await page.evaluate(() => (globalThis.__cabDebug = (x) => console.error(x)))
  for (const c of cases) {
    if (only && !c.name.includes(only)) continue
    let pdf
    if (c.pdf) {
      const svg = await page.evaluate(async ({ style, pxPerM }) => {
        const m = await import('/tests/fixtures/importCheck.ts')
        const d = m.drawFixture(m.villa(), pxPerM, style)
        return { svg: d.svg, w: d.width, h: d.height }
      }, c)
      const p2 = await browser.newPage()
      await p2.setContent(`<html><body style="margin:0">${svg.svg}</body></html>`)
      const buf = await p2.pdf({ width: `${svg.w}px`, height: `${svg.h}px`, printBackground: true, pageRanges: '1' })
      await p2.close()
      pdf = buf.toString('base64')
    }
    const r = await page.evaluate(async (opts) => (await import('/tests/fixtures/importCheck.ts')).run(opts), { ...c, pdf })
    const ok = !r.problems.length
    if (!ok) failed++
    console.log(`${ok ? '✓' : '✗'} ${c.name}: ${r.counts.walls} walls, ${r.counts.openings} openings, ${r.labels} labels, scale ${r.scaleErr >= 0 ? '+' : ''}${r.scaleErr.toFixed(2)} %, ${r.ms} ms`)
    const worst = r.rooms.filter((x) => x.err !== null).reduce((m, x) => Math.max(m, Math.abs(x.err)), 0)
    console.log(`    rooms: ${r.rooms.map((x) => `${x.name} ${x.area ?? '—'}/${x.label}`).join(', ')}  (worst ${worst.toFixed(2)} %)`)
    for (const p of r.problems) console.log('    - ' + p)
    if (process.env.SHOW_TEXT) console.log('    text: ' + JSON.stringify(r.text))
  }
} finally {
  await browser.close()
  await server.close()
}
process.exit(failed ? 1 : 0)

// Renders each ceiling finish (and beams) seen from below: node scripts/render-ceilings.mjs out.png
import { createServer } from 'vite'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
const out = process.argv[2] ?? 'ceilings.png'
const list = [
  { label: 'Perforated acoustic boards + white beams', ceiling: { color: '#f4f3f0', preset: 'ceil-perforated' }, beams: { spacing: 1.2, width: 0.1, depth: 0.16, color: '#f4f3f0', across: true } },
  { label: 'Perforated acoustic tiles', ceiling: { color: '#f6f6f4', preset: 'ceil-perforated-tiles' } },
  { label: 'Wood-wool panels, white', ceiling: { color: '#ebe9e4', preset: 'ceil-wood-wool' } },
  { label: 'Wood-wool panels, natural', ceiling: { color: '#c9c5bd', preset: 'ceil-wood-wool-grey' } },
  { label: 'Wood slats on felt', ceiling: { color: '#c9a274', preset: 'ceil-slats' } },
  { label: 'Plain + oak beams', ceiling: { color: '#fbfaf8' }, beams: { spacing: 0.9, width: 0.12, depth: 0.2, color: '#c9a274', across: true } },
]
const server = await createServer({ logLevel: 'error', server: { port: 5190 } })
await server.listen()
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await b.newPage({ viewport: { width: 1500, height: 1000 } })
page.on('pageerror', (e) => console.log('ERR', e.message))
await page.goto(server.resolvedUrls.local[0] + 'tests/fixtures/import.html')
const t0 = Date.now()
const shots = await page.evaluate(async (list) => (await import('/tests/fixtures/panelScene.ts')).renderCeilings(list), list)
console.log('rendered in', Date.now() - t0, 'ms')
const html = `<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(2,720px);gap:6px;padding:6px;font:13px sans-serif;color:#ddd">${shots.map((u, i) => `<figure style="margin:0"><img src="${u}" width="720"><figcaption>${list[i].label}</figcaption></figure>`).join('')}</body>`
await page.setContent(html)
await page.waitForTimeout(500)
await page.screenshot({ path: out, fullPage: true })
await b.close()
await server.close()

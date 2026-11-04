// Renders the panel test wall in every style into one contact sheet: node scripts/render-panels.mjs out.png
import { createServer } from 'vite'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
const out = process.argv[2] ?? 'panels.png'
const big = process.argv[3] === 'big'
const styles = [
  { panels: 'frames', skirting: 'classic', color: '#f4f2ee', wall: '#e8e4dc' },
  { panels: 'two-tier', skirting: 'tall', color: '#7d8a7a', wall: '#7d8a7a' },
  { panels: 'tall-frames', skirting: 'ogee', color: '#f4f2ee', wall: '#f2efe9' },
  { panels: 'full-height', skirting: 'tall', color: '#2c3a52', wall: '#2c3a52' },
  { panels: 'raised', skirting: 'ogee', color: '#cfc7bb', wall: '#e8dfd0' },
  { panels: 'shaker', skirting: 'flat', color: '#3b4f45', wall: '#e8e4dc' },
  { panels: 'board-batten', skirting: 'shadow', color: '#f8f8f6', wall: '#b9cfcc' },
  { panels: 'beadboard', skirting: 'classic', color: '#f8f8f6', wall: '#e8dfd0' },
  { panels: 'none', skirting: 'shadow', color: '#f4f2ee', wall: '#f2efe9' },
]
const server = await createServer({ logLevel: 'error', server: { port: 5194 } })
await server.listen()
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await b.newPage({ viewport: { width: 1500, height: 1000 } })
page.on('pageerror', (e) => console.log('ERR', e.message))
page.on('console', (m) => m.type() === 'error' && console.log('[browser]', m.text()))
await page.goto(server.resolvedUrls.local[0] + 'tests/fixtures/import.html')
const shots = await page.evaluate(async ({ styles, big }) => (await import('/tests/fixtures/panelScene.ts')).render(styles.slice(0, big ? 2 : 9), big ? 1440 : 960, big ? 840 : 560), { styles, big })
console.log('sockets:', shots[1])
const imgs = [shots[0], ...shots.slice(2)]
const html = `<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(${big ? 1 : 3},${big ? 1440 : 480}px);gap:6px;padding:6px;font:13px sans-serif;color:#ddd">${imgs.map((u, i) => `<figure style="margin:0"><img src="${u}" width="${big ? 1440 : 480}"><figcaption>${styles[i].panels} · skirting ${styles[i].skirting}</figcaption></figure>`).join('')}</body>`
await page.setContent(html)
await page.waitForTimeout(500)
await page.screenshot({ path: out, fullPage: true })
await b.close()
await server.close()

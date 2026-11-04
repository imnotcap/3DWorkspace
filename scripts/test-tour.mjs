// Walkthrough check: auto tours of the templates must never walk backwards or sideways and must
// turn smoothly. Run with: npm run test:tour
import { createServer } from 'vite'
import { createRequire } from 'node:module'
const { chromium } = createRequire(import.meta.url)('playwright')
const server = await createServer({ logLevel: 'error', server: { port: 5192, strictPort: false } })
await server.listen()
const b = await chromium.launch()
let failed = 0
try {
  const page = await b.newPage()
  if (process.env.DEBUG) page.on('console', (m) => console.log('  [browser]', m.text()))
  await page.goto(server.resolvedUrls.local[0] + 'tests/fixtures/import.html')
  const res = await page.evaluate(async () => (await import('/tests/fixtures/tourCheck.ts')).run())
  for (const r of res) {
    const ok = r.backward === 0 && r.sideways === 0 && r.maxYawRate <= 45 && r.maxYawAccel <= 250
    if (!ok) failed++
    console.log(`${ok ? '✓' : '✗'} ${r.id}: ${r.points} points, ${r.seconds} s, backward ${r.backward}, sideways ${r.sideways}, max turn ${r.maxYawRate}°/s, max turn change ${r.maxYawAccel}°/s²`)
  }
} finally {
  await b.close()
  await server.close()
}
process.exit(failed ? 1 : 0)

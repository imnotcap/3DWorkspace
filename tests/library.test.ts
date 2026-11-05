// The model library fetch (scripts/fetch-library.mjs) against a small stand-in for the Poly Haven API.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import { categoryOf, gltfSize } from '../scripts/lib/gltf-bounds.mjs'

// A 2 × 1 × 0.5 m box, its node scaled ×2 in y and moved: 2 × 2 × 0.5.
const gltf = {
  asset: { version: '2.0' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ children: [1], translation: [5, 0, 0] }, { mesh: 0, scale: [1, 2, 1] }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  accessors: [{ min: [-1, 0, -0.25], max: [1, 1, 0.25], count: 8, type: 'VEC3', componentType: 5126 }],
  buffers: [{ uri: 'chair.bin', byteLength: 4 }],
}

test('model size from the node hierarchy, and catalog categories', () => {
  assert.deepEqual(gltfSize(gltf), [2, 2, 0.5])
  assert.equal(categoryOf(['furniture', 'seating'], ['sofa'], 'Green sofa'), 'Living')
  assert.equal(categoryOf(['decorative'], ['potted', 'plant'], 'Fern'), 'Decor')
  assert.equal(categoryOf(['furniture'], ['bed'], 'Wooden bed'), 'Bedroom')
})

test('fetches the furniture into a library within the budget', async () => {
  const server = createServer((req, res) => {
    const u = new URL(req.url!, 'http://x')
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    const json = (o: unknown) => (res.setHeader('content-type', 'application/json'), res.end(JSON.stringify(o)))
    if (u.pathname === '/assets') return json({ chair: { name: 'Wooden chair', categories: ['furniture', 'seating'], tags: ['chair'], authors: { 'A. Artist': 'All' }, download_count: 9 }, rock: { name: 'Rock', categories: ['nature'], tags: [] } })
    if (u.pathname === '/files/chair') return json({ gltf: { '1k': { gltf: { url: `${base}/dl/chair.gltf`, size: 100, include: { 'chair.bin': { url: `${base}/dl/chair.bin`, size: 4 }, 'textures/wood_1k.jpg': { url: `${base}/dl/wood.jpg`, size: 3 } } } } } })
    if (u.pathname === '/dl/chair.gltf') return json(gltf)
    if (u.pathname.startsWith('/dl/') || u.pathname.startsWith('/thumbs/')) return res.end('abcd')
    res.statusCode = 404
    res.end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as { port: number }).port
  const out = mkdtempSync(join(tmpdir(), 'lib-'))
  try {
    await promisify(execFile)(process.execPath, ['scripts/fetch-library.mjs'], { env: { ...process.env, POLYHAVEN_API: `http://127.0.0.1:${port}`, POLYHAVEN_THUMBS: `http://127.0.0.1:${port}/thumbs`, LIBRARY_OUT: out } })
    const lib = JSON.parse(readFileSync(join(out, 'library.json'), 'utf8'))
    assert.equal(lib.length, 1)
    assert.deepEqual(lib[0].size, [2, 2, 0.5])
    assert.equal(lib[0].category, 'Dining')
    assert.equal(lib[0].file, 'ph/chair/chair.gltf')
    assert.ok(existsSync(join(out, 'ph/chair/textures/wood_1k.jpg')))
    assert.ok(existsSync(join(out, 'ph/chair/thumb.png')))
    assert.match(lib[0].credit, /A\. Artist/)
  } finally {
    server.close()
  }
})

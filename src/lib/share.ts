// Share a plan as a link: the whole plan (levels, walls, doors and windows, rooms and finishes, the
// tour, prices) and the furniture, compressed into the address after `#plan=`. Nothing goes to a
// server; whoever opens the link gets their own copy to change. Models imported from a file (GLB)
// are too big to travel in a link and stay behind.
import { activeProject, modelUrl, useWorkspace, type Project, type SceneObject } from '@/store/workspace'

const KEY = 'plan='
const VERSION = 1

interface Shared {
  v: number
  name: string
  levels: Project['levels']
  walls: Project['walls']
  openings: Project['openings']
  rooms: Project['rooms']
  tour: Project['tour']
  prices?: Project['prices']
  objects: Omit<SceneObject, 'id'>[]
}

/** Pieces that can travel in a link: catalog furniture, library models and primitives. */
const portable = (o: SceneObject) => !o.parentId && !o.isGroup && (!!o.furniture || !!o.primitive || !!o.modelFile)

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream) {
  const out = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

const toB64 = (b: Uint8Array) => {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const fromB64 = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(b, (c) => c.charCodeAt(0))
}

/** The project as a link fragment, and how many pieces couldn't come along. */
export async function encodeShare(p: Project): Promise<{ fragment: string; left: number }> {
  const objects = p.objects.filter(portable).map(({ id: _id, url: _url, blob: _blob, stats: _stats, error: _error, parentId: _parent, ...o }) => o)
  const data: Shared = { v: VERSION, name: p.name, levels: p.levels, walls: p.walls, openings: p.openings, rooms: p.rooms, tour: p.tour, prices: p.prices, objects }
  // Millimetres are plenty, and short numbers compress far better.
  const json = JSON.stringify(data, (_k, v) => (typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1000) / 1000 : v))
  const packed = await pipe(new TextEncoder().encode(json), new CompressionStream('deflate-raw'))
  return { fragment: KEY + toB64(packed), left: p.objects.filter((o) => !o.parentId && !portable(o)).length }
}

export async function decodeShare(fragment: string): Promise<Shared> {
  const raw = fragment.replace(/^#/, '')
  if (!raw.startsWith(KEY)) throw new Error('Not a plan link.')
  const json = new TextDecoder().decode(await pipe(fromB64(raw.slice(KEY.length)), new DecompressionStream('deflate-raw')))
  const data = JSON.parse(json) as Shared
  if (data.v !== VERSION || !Array.isArray(data.levels) || !data.levels.length) throw new Error('This plan link is from a newer version or damaged.')
  return data
}

/** Copy a link to the current project. */
export async function shareLink() {
  const st = useWorkspace.getState()
  const p = activeProject(st)
  if (!p.walls.length && !p.objects.length) return st.setJob({ status: 'error', message: 'Draw or import a plan first: there is nothing to share yet.' })
  const { fragment, left } = await encodeShare(p)
  const url = `${location.origin}${location.pathname}#${fragment}`
  let copied = true
  try {
    await navigator.clipboard.writeText(url)
  } catch {
    copied = false
    window.prompt('Copy this link to share the plan:', url)
  }
  const kb = Math.round(url.length / 1024)
  const note = left ? ` ${left} imported model${left === 1 ? '' : 's'} stay${left === 1 ? 's' : ''} behind (too big for a link).` : ''
  st.setJob({ status: 'done', message: `${copied ? 'Link copied' : 'Link ready'} (${kb} kB). Whoever opens it gets their own copy of “${p.name}”.${note}` })
}

/** Open the plan in the address (`#plan=…`) as a new project, then tidy the address. */
export async function openSharedLink() {
  if (!location.hash.startsWith('#' + KEY)) return
  const st = useWorkspace.getState()
  try {
    const d = await decodeShare(location.hash)
    const cur = activeProject(st)
    if (cur.walls.length || cur.objects.length) st.addProject()
    st.loadTemplate({
      name: d.name,
      levels: d.levels,
      walls: d.walls,
      openings: d.openings,
      rooms: d.rooms,
      tour: d.tour,
      objects: d.objects.map((o) => (o.modelFile ? { ...o, url: modelUrl(o.modelFile) } : o)),
    })
    const id = useWorkspace.getState().activeProjectId
    if (d.prices) for (const [k, v] of Object.entries(d.prices)) useWorkspace.getState().setPrice(k, v)
    useWorkspace.getState().openProject(id)
    useWorkspace.getState().setJob({ status: 'done', message: `Opened “${d.name}” from a shared link: this copy is yours to change.` })
  } catch (e) {
    st.setJob({ status: 'error', message: (e as Error).message || 'Could not open that plan link.' })
  } finally {
    history.replaceState(null, '', location.pathname + location.search)
  }
}

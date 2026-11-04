// Runs in the browser (scripts/test-import.mjs): draws a fixture plan, imports it the way the app
// does (pixels → walls, openings, labels, scale) and compares everything with the true answers.
import { analyseDrawing, planAt, rasterOf, readDrawing, type ImportedPlan } from '../../src/plan/importPlan.ts'
import { ocrLines } from '../../src/plan/importText.ts'
import { dist, pointInPolygon, analyse } from '../../src/plan/geometry.ts'
import type { Vec2 } from '../../src/plan/types.ts'
import { drawFixture, villa, type Fixture } from './planDrawing.ts'

const family = (k: string) => (k === 'window' || k === 'wide-window' || k === 'floor-window' ? 'window' : k)

async function svgCanvas(svg: string, w: number, h: number) {
  const img = new Image()
  img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  await img.decode()
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  c.getContext('2d')!.drawImage(img, 0, 0)
  return c
}

export async function run(opts: { style: 'agent' | 'architect'; pxPerM: number; ocr: boolean; pdf?: string }) {
  const f: Fixture = villa()
  const d = drawFixture(f, opts.pxPerM, opts.style)
  let canvas: HTMLCanvasElement
  let text = null
  let pxPerM = opts.pxPerM
  if (opts.pdf) {
    const bytes = Uint8Array.from(atob(opts.pdf), (c) => c.charCodeAt(0))
    const dr = await readDrawing(new File([bytes], 'plan.pdf', { type: 'application/pdf' }))
    canvas = dr.canvas
    text = dr.text
    pxPerM = (opts.pxPerM * canvas.width) / d.width
  } else canvas = await svgCanvas(d.svg, d.width, d.height)
  const t0 = performance.now()
  let lines: { str: string }[] = []
  const an = await analyseDrawing(rasterOf(canvas), { text, ocr: opts.ocr ? async (ink, w, h) => (lines = await ocrLines(ink, w, h)) as never : undefined })
  const t1 = performance.now()
  // Without labels the geometry is checked at the true scale (the guess is reported on its own).
  const k = an.labelScale ?? 1 / pxPerM
  const plan: ImportedPlan = planAt(an.ctx, k)
  // Plan metres → fixture metres.
  const x0 = Math.min(...f.walls.flatMap((w) => [w.a[0], w.b[0]])) - 1.2
  const y0 = Math.min(...f.walls.flatMap((w) => [w.a[1], w.b[1]])) - 1.2
  const toFix = (p: Vec2): Vec2 => [(p[0] - plan.offset[0]) / k / pxPerM + x0, (p[1] - plan.offset[1]) / k / pxPerM + y0]
  const walls = plan.walls.map((w) => ({ ...w, a: toFix(w.a), b: toFix(w.b) }))
  const problems: string[] = []

  // Scale.
  const scaleErr = ((an.labelScale ?? an.guessScale) * pxPerM - 1) * 100
  if (Math.abs(scaleErr) > (an.labelScale ? 1 : 20)) problems.push(`scale off by ${scaleErr.toFixed(2)} %`)

  // Every wall found (centre line within a few cm).
  f.walls.forEach((fw, i) => {
    const m: Vec2 = [(fw.a[0] + fw.b[0]) / 2, (fw.a[1] + fw.b[1]) / 2]
    const hit = walls.find((w) => {
      const along = Math.abs(w.a[1] - w.b[1]) < 1e-6
      const fAlong = Math.abs(fw.a[1] - fw.b[1]) < 1e-6
      if (along !== fAlong) return false
      const [lo, hi] = along ? [Math.min(w.a[0], w.b[0]), Math.max(w.a[0], w.b[0])] : [Math.min(w.a[1], w.b[1]), Math.max(w.a[1], w.b[1])]
      const u = along ? m[0] : m[1]
      const off = along ? Math.abs(w.a[1] - m[1]) : Math.abs(w.a[0] - m[0])
      return u > lo && u < hi && off < 0.05 && Math.abs(w.thickness - fw.t) < 0.04
    })
    if (!hit) problems.push(`wall ${i} (${fw.t} m) missing`)
  })
  // No walls where there are none (the TV, wardrobes, labels).
  for (const w of walls) {
    const m: Vec2 = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2]
    const ok = f.walls.some((fw) => {
      const L = dist(fw.a, fw.b)
      const t = ((m[0] - fw.a[0]) * (fw.b[0] - fw.a[0]) + (m[1] - fw.a[1]) * (fw.b[1] - fw.a[1])) / L
      const n = Math.abs((m[0] - fw.a[0]) * (fw.b[1] - fw.a[1]) - (m[1] - fw.a[1]) * (fw.b[0] - fw.a[0])) / L
      return t > -0.3 && t < L + 0.3 && n < 0.05
    })
    if (!ok) problems.push(`extra wall ${w.a.map((v) => v.toFixed(2))} → ${w.b.map((v) => v.toFixed(2))} t=${w.thickness}`)
  }

  // Openings: position, width, kind; doors: hinge corner and swing side.
  const found = plan.openings.map((o) => {
    const w = walls.find((x) => x.id === o.wallId)!
    const L = dist(w.a, w.b)
    const dir: Vec2 = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L]
    const c: Vec2 = [w.a[0] + dir[0] * o.t, w.a[1] + dir[1] * o.t]
    const hingeAt: Vec2 = o.hinge === 'a' ? [c[0] - (dir[0] * o.width) / 2, c[1] - (dir[1] * o.width) / 2] : [c[0] + (dir[0] * o.width) / 2, c[1] + (dir[1] * o.width) / 2]
    const n: Vec2 = o.side === 'left' ? [-dir[1], dir[0]] : [dir[1], -dir[0]]
    return { o, c, hingeAt, n, used: false }
  })
  for (const fo of f.openings) {
    const fw = f.walls[fo.wall]
    const L = dist(fw.a, fw.b)
    const dir: Vec2 = [(fw.b[0] - fw.a[0]) / L, (fw.b[1] - fw.a[1]) / L]
    const c: Vec2 = [fw.a[0] + dir[0] * fo.t, fw.a[1] + dir[1] * fo.t]
    const m = found.find((x) => !x.used && dist(x.c, c) < 0.12)
    const label = `${fo.kind} on wall ${fo.wall} at ${fo.t}`
    if (!m) {
      problems.push(`${label}: not found`)
      continue
    }
    m.used = true
    if (Math.abs(m.o.width - fo.width) > 0.06) problems.push(`${label}: width ${m.o.width}`)
    if (family(m.o.kind) !== family(fo.kind)) problems.push(`${label}: read as ${m.o.kind}`)
    if (fo.kind === 'door' && m.o.kind === 'door') {
      const hinge: Vec2 = fo.hinge === 'b' ? [c[0] + (dir[0] * fo.width) / 2, c[1] + (dir[1] * fo.width) / 2] : [c[0] - (dir[0] * fo.width) / 2, c[1] - (dir[1] * fo.width) / 2]
      const n: Vec2 = fo.side === 'left' ? [-dir[1], dir[0]] : [dir[1], -dir[0]]
      if (dist(hinge, m.hingeAt) > 0.1) problems.push(`${label}: hinge on the wrong end`)
      if (n[0] * m.n[0] + n[1] * m.n[1] < 0.5) problems.push(`${label}: swings to the wrong side`)
    }
  }
  for (const x of found) if (!x.used) problems.push(`extra ${x.o.kind} ${x.c.map((v) => v.toFixed(2))} w=${x.o.width}`)

  // Rooms: the label areas against the built rooms.
  const geom = analyse(walls)
  const rooms = d.rooms.map((r) => {
    const face = geom.faces.find((fc) => pointInPolygon(r.at, fc.polygon))
    const info = plan.rooms.find((x) => pointInPolygon(toFix(x.anchor), face?.polygon ?? []))
    const area = face ? Math.round(face.area * 100) / 100 : null
    const err = area === null ? null : ((area - r.exact) / r.exact) * 100
    if (err === null || Math.abs(err) > 1.5) problems.push(`room ${r.name}: ${area} m² (true ${r.exact.toFixed(2)})`)
    if (opts.ocr || opts.pdf) if (!info || info.name.toLowerCase() !== r.name.toLowerCase()) problems.push(`room ${r.name}: named "${info?.name ?? '—'}"`)
    return { name: r.name, label: Math.round(r.exact * 100) / 100, area, err }
  })

  // Wardrobes recognised (and not walls).
  const cab = an.ctx.cabinets.map(([a, b, c2, e]) => [toFix(planPx(plan, k, [a, b])), toFix(planPx(plan, k, [c2, e]))])
  for (const wd of f.wardrobes) {
    const m = cab.find(([p, q]) => Math.abs(p[0] - wd.r[0]) < 0.08 && Math.abs(p[1] - wd.r[1]) < 0.08 && Math.abs(q[0] - wd.r[2]) < 0.08 && Math.abs(q[1] - wd.r[3]) < 0.08)
    if (!m) problems.push(`wardrobe ${wd.r} not recognised`)
  }
  if (cab.length > f.wardrobes.length) problems.push(`${cab.length - f.wardrobes.length} extra wardrobes`)

  return { text: lines.map((l) => l.str), problems, rooms, scaleErr, labels: an.ctx.labels.length, ms: Math.round(t1 - t0), counts: { walls: plan.walls.length, openings: plan.openings.length } }
}

const planPx = (plan: ImportedPlan, k: number, p: Vec2): Vec2 => [p[0] * k + plan.offset[0], p[1] * k + plan.offset[1]]

export { drawFixture, villa }

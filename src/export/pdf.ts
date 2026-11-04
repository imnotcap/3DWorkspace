import { jsPDF } from 'jspdf'
import { svg2pdf } from 'svg2pdf.js'
import { Box3, MathUtils, Vector3 } from 'three'
import { CATALOG } from '@/furniture/catalog'
import { PAPER_THEME, drawPlan, svgString } from '@/plan/draw'
import { catalogItemOf, footprint, objectSize } from '@/plan/footprint'
import { add, analyse, dist, mul, norm, pointInPolygon, sub, type Face } from '@/plan/geometry'
import { levelElevations, roomFor } from '@/plan/levels'
import { DEFAULT_CEILING_FINISH, DEFAULT_FLOOR_FINISH, DEFAULT_WALL_FINISH, OPENING_DEFAULTS, type Finish, type Level, type Vec2 } from '@/plan/types'
import { activeProject, useWorkspace, type CameraPose, type Project, type SceneObject, type Vec3 } from '@/store/workspace'
import { download, viewport } from '@/viewport/bridge'
import { framePose, visibleBox } from '@/viewport/camera'
import { PAINT_COLORS, presetById } from '@/viewport/materialPresets'

/**
 * The house as a presentation document: cover, floor plans (vector), 3D views of every floor,
 * a page per room with a 4K interior render, and schedules. A4 landscape, millimetres.
 */

const PW = 297
const PH = 210
const M = 16 // page margin
const INK: [number, number, number] = [29, 29, 31]
const GREY: [number, number, number] = [110, 110, 115]
const LIGHT: [number, number, number] = [232, 230, 226]
const ACCENT: [number, number, number] = [184, 106, 75]

const RES = { w: 3840, h: 2160 }

let cancelled = false
export const cancelPdf = () => (cancelled = true)

interface Shot {
  pose: CameraPose
  ceilings: boolean
  maxLevel: number | null
  /** Backdrop for cutaway views (interiors get daylight in the windows). */
  background?: string
}

/** Dollhouse view of floors 0..maxLevel (null = whole house): three-quarter from above. */
function overviewShot(levelIdx: number | null, project: Project): Shot | null {
  const box = new Box3()
  project.levels.forEach((l, i) => {
    if (levelIdx !== null && i !== levelIdx) return
    const h = viewport.houses.get(l.id)
    if (h) visibleBox(h, box)
  })
  if (box.isEmpty()) return null
  const pose = framePose(box, { azimuth: MathUtils.degToRad(32), polar: MathUtils.degToRad(levelIdx === null ? 58 : 48), focal: 40 }, RES.w / RES.h)
  return { pose: { ...pose, radius: pose.radius * 0.94 }, ceilings: false, maxLevel: levelIdx, background: levelIdx === null ? '#efede9' : '#ffffff' }
}

/** Inside a room: from the corner that sees most of it, eye height, looking across. */
function roomShot(face: Face, elevation: number): Shot {
  const poly = face.inner.length >= 3 ? face.inner : face.polygon
  const target = face.center
  let best: { c: Vec2; d: number } | null = null
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const a = norm(sub(poly[(i - 1 + poly.length) % poly.length], p))
    const b = norm(sub(poly[(i + 1) % poly.length], p))
    const bis = norm(add(a, b))
    const c = add(p, mul(bis, 0.45))
    if (!pointInPolygon(c, poly)) continue
    const d = dist(c, target)
    if (!best || d > best.d) best = { c, d }
  }
  const c = best?.c ?? target
  const cam = new Vector3(c[0], elevation + 1.55, c[1])
  // Aim past the centre so the far walls fill the frame.
  const dir = norm(sub(target, c))
  const t = new Vector3(target[0] + dir[0] * 0.5, elevation + 1.05, target[1] + dir[1] * 0.5)
  const v = cam.clone().sub(t)
  const r = v.length()
  v.normalize()
  return { pose: { target: t.toArray() as Vec3, radius: r, polar: Math.acos(v.y), azimuth: Math.atan2(v.x, v.z), focal: face.area < 7 ? 14 : 18 }, ceilings: true, maxLevel: null }
}

async function render(shot: Shot) {
  const blob = await viewport.renderShot(shot.pose, { width: RES.w, height: RES.h, ceilings: shot.ceilings, maxLevel: shot.maxLevel, background: shot.background })
  if (!blob) throw new Error('Rendering failed.')
  return new Uint8Array(await blob.arrayBuffer())
}

// ───────── layout helpers ─────────

function header(doc: jsPDF, section: string, title: string, page: number) {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...GREY)
  doc.text(section.toUpperCase(), M, M - 4, { charSpace: 0.6 })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.setTextColor(...INK)
  doc.text(title, M, M + 5)
  doc.setDrawColor(...INK)
  doc.setLineWidth(0.2)
  doc.line(M, M + 9, PW - M, M + 9)
  footer(doc, page)
}

function footer(doc: jsPDF, page: number) {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...GREY)
  doc.text(projectName.toUpperCase(), M, PH - 8, { charSpace: 0.5 })
  doc.text(String(page).padStart(2, '0'), PW - M, PH - 8, { align: 'right' })
}

let projectName = ''

const hex = (c: string): [number, number, number] => {
  const n = parseInt(c.replace('#', '').slice(0, 6), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function finishName(f: Finish) {
  const preset = presetById(f.preset)
  const paint = PAINT_COLORS.find((p) => p.hex.toLowerCase() === f.color.toLowerCase())
  return preset ? `${preset.name}${paint && preset.category !== 'Floor' ? ` · ${paint.name}` : ''}` : paint ? `${paint.name} paint` : `Paint ${f.color.toUpperCase()}`
}

function swatch(doc: jsPDF, x: number, y: number, f: Finish, label: string, sub: string) {
  doc.setFillColor(...hex(f.color))
  doc.setDrawColor(...LIGHT)
  doc.setLineWidth(0.2)
  doc.roundedRect(x, y, 9, 9, 1, 1, 'FD')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(...GREY)
  doc.text(label.toUpperCase(), x + 12, y + 3, { charSpace: 0.4 })
  doc.setFontSize(8.5)
  doc.setTextColor(...INK)
  doc.text(sub, x + 12, y + 7.6)
}

function stat(doc: jsPDF, x: number, y: number, value: string, label: string) {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.setTextColor(...INK)
  doc.text(value, x, y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...GREY)
  doc.text(label.toUpperCase(), x, y + 5, { charSpace: 0.5 })
}

/** Simple table: header row, hairlines, alternating tint; returns the y after it (new pages as needed). */
function table(doc: jsPDF, y: number, cols: { label: string; w: number; align?: 'left' | 'right' }[], rows: string[][], onNewPage: () => number) {
  const rowH = 6.2
  const head = (yy: number) => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(...GREY)
    let x = M
    for (const c of cols) {
      doc.text(c.label.toUpperCase(), c.align === 'right' ? x + c.w - 1 : x + 1, yy, { charSpace: 0.4, align: c.align ?? 'left' })
      x += c.w
    }
    doc.setDrawColor(...INK)
    doc.setLineWidth(0.2)
    doc.line(M, yy + 2, PW - M, yy + 2)
    return yy + 2
  }
  y = head(y)
  doc.setFont('helvetica', 'normal')
  rows.forEach((r, i) => {
    if (y + rowH > PH - 16) {
      y = head(onNewPage())
      doc.setFont('helvetica', 'normal')
    }
    if (i % 2 === 1) {
      doc.setFillColor(247, 246, 244)
      doc.rect(M, y, PW - M * 2, rowH, 'F')
    }
    doc.setFontSize(8)
    doc.setTextColor(...INK)
    let x = M
    r.forEach((cell, k) => {
      const c = cols[k]
      const text = doc.splitTextToSize(cell, c.w - 2)[0] ?? ''
      doc.text(text, c.align === 'right' ? x + c.w - 1 : x + 1, y + 4.2, { align: c.align ?? 'left' })
      x += c.w
    })
    y += rowH
  })
  return y
}

/** The level's plan as vector graphics, fitted into a box (mm). */
async function plan(doc: jsPDF, project: Project, level: Level, box: { x: number; y: number; w: number; h: number }, highlight?: Face) {
  const walls = project.walls.filter((w) => w.levelId === level.id)
  const geom = analyse(walls)
  const objects = project.objects.filter((o) => !o.parentId && (o.levelId ?? project.levels[0].id) === level.id)
  const pts = walls.flatMap((w) => [w.a, w.b])
  if (!pts.length) return
  const pad = 0.9
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const vb: [number, number, number, number] = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + pad * 2, Math.max(...ys) - Math.min(...ys) + pad * 2]
  const k = Math.min(box.w / vb[2], box.h / vb[3]) // mm per metre
  const w = vb[2] * k
  const h = vb[3] * k
  const nodes = drawPlan({
    geom,
    levelId: level.id,
    walls,
    openings: project.openings.filter((o) => walls.some((x) => x.id === o.wallId)),
    rooms: project.rooms,
    objects,
    scale: highlight ? k * 9 : k * 4, // 10 "px" of text ≈ 2.5 mm on paper (smaller on key plans)
    theme: { ...PAPER_THEME, floorAlpha: highlight ? 0.08 : PAPER_THEME.floorAlpha },
    dimensions: !highlight,
    selection: highlight ? { kind: 'room', id: level.id, at: highlight.center } : null,
  })
  const el = new DOMParser().parseFromString(svgString(nodes, vb, w, h), 'image/svg+xml').documentElement
  const holder = document.createElement('div')
  holder.style.cssText = 'position:fixed;left:-99999px;top:0'
  holder.appendChild(el)
  document.body.appendChild(holder)
  try {
    await svg2pdf(el, doc, { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, width: w, height: h })
  } finally {
    holder.remove()
  }
  return { k, x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h }
}

function scaleBar(doc: jsPDF, x: number, y: number, mmPerM: number) {
  const m = [1, 2, 5].find((v) => v * mmPerM >= 20) ?? 5
  doc.setDrawColor(...INK)
  doc.setFillColor(...INK)
  doc.setLineWidth(0.25)
  for (let i = 0; i < m; i++) doc.rect(x + i * mmPerM, y, mmPerM, 1.5, i % 2 ? 'S' : 'F')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(...GREY)
  doc.text('0', x, y + 5)
  doc.text(`${m} m`, x + m * mmPerM, y + 5, { align: 'center' })
  // North arrow (plan up = north).
  const nx = x + m * mmPerM + 14
  doc.setFillColor(...INK)
  doc.triangle(nx, y - 4, nx - 2, y + 2, nx + 2, y + 2, 'F')
  doc.text('N', nx, y + 6, { align: 'center' })
}

function roomsOf(project: Project, level: Level) {
  const geom = analyse(project.walls.filter((w) => w.levelId === level.id))
  return geom.faces.map((f) => ({ face: f, info: roomFor(f, project.rooms, level.id) }))
}

function objectRoom(o: SceneObject, faces: Face[]) {
  const c = footprint(o).c
  return faces.find((f) => pointInPolygon(c, f.polygon))
}

const cm = (v: Vec3) => v.map((x) => Math.round(x * 100)).join(' × ')

export async function exportPdf() {
  const s = useWorkspace.getState()
  if (s.renderJob) return
  const project = activeProject(s)
  if (!project.walls.length) return s.setJob({ status: 'error', message: 'Draw a plan first.', hint: 'The PDF shows your floor plans, rooms and furniture. Start from a template or draw some rooms.' })
  cancelled = false
  projectName = project.name
  const prevSel = { sel: s.selectedId, plan: s.planSel }
  s.select(null)
  s.selectPlan(null)
  // Let the viewport drop selection boxes before rendering.
  await new Promise((r) => setTimeout(r, 60))

  const levels = project.levels
  const elev = levelElevations(levels)
  const rooms = levels.map((l) => ({ level: l, rooms: roomsOf(project, l) }))
  const roomShots = rooms.flatMap((r) => r.rooms.map((x) => ({ ...x, level: r.level })))
  const total = 1 + levels.length + roomShots.length
  let done = 0
  const progress = (message: string) => useWorkspace.getState().setRenderJob({ kind: 'image', done, total, message })
  const step = async (message: string, shot: Shot | null) => {
    if (cancelled) throw new DOMException('Cancelled', 'AbortError')
    progress(message)
    const img = shot ? await render(shot) : null
    done++
    return img
  }

  try {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true })
    doc.setProperties({ title: project.name, subject: 'Interior plan', creator: '3D Workspace' })
    let page = 1
    const totalArea = rooms.reduce((a, r) => a + r.rooms.reduce((b, x) => b + x.face.area, 0), 0)
    const furniture = project.objects.filter((o) => !o.parentId && (o.furniture || o.modelFile || o.blob))

    // ── Cover ──
    const hero = await step('Cover · whole home', overviewShot(null, project))
    if (hero) doc.addImage(hero, 'JPEG', 0, 0, PW, (PW * RES.h) / RES.w, undefined, 'FAST')
    const bandY = (PW * RES.h) / RES.w
    doc.setFillColor(255, 255, 255)
    doc.rect(0, bandY, PW, PH - bandY, 'F')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...ACCENT)
    doc.text('INTERIOR PLAN', M, bandY + 10, { charSpace: 0.8 })
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(24)
    doc.setTextColor(...INK)
    doc.text(project.name, M, bandY + 21)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...GREY)
    doc.text(new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), M, bandY + 28)
    const statsX = PW - M - 4 * 38
    stat(doc, statsX, bandY + 18, `${totalArea.toFixed(0)} m²`, 'Floor area')
    stat(doc, statsX + 38, bandY + 18, String(roomShots.length), 'Rooms')
    stat(doc, statsX + 76, bandY + 18, String(levels.length), levels.length === 1 ? 'Floor' : 'Floors')
    stat(doc, statsX + 114, bandY + 18, String(furniture.length), 'Pieces')

    // ── Floor plans + 3D per level ──
    for (const [i, { level, rooms: rs }] of rooms.entries()) {
      doc.addPage()
      page++
      header(doc, `Floor plan · ${i + 1} of ${levels.length}`, level.name, page)
      const area = { x: M, y: M + 14, w: PW - M * 2 - 70, h: PH - M * 2 - 24 }
      const placed = await plan(doc, project, level, area)
      if (placed) scaleBar(doc, M, PH - 18, placed.k)
      // Room schedule on the right.
      const cx = PW - M - 62
      let y = M + 18
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...GREY)
      doc.text('ROOMS', cx, y, { charSpace: 0.6 })
      y += 5
      for (const r of rs) {
        doc.setFillColor(...hex((r.info?.floor ?? DEFAULT_FLOOR_FINISH).color))
        doc.rect(cx, y - 2.6, 2.6, 2.6, 'F')
        doc.setFontSize(8.5)
        doc.setTextColor(...INK)
        doc.text(r.info?.name ?? 'Room', cx + 4.5, y)
        doc.setTextColor(...GREY)
        doc.text(`${r.face.area.toFixed(1)} m²`, PW - M, y, { align: 'right' })
        y += 5.6
      }
      doc.setDrawColor(...LIGHT)
      doc.line(cx, y - 2, PW - M, y - 2)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...INK)
      doc.text('Total', cx + 4.5, y + 3)
      doc.text(`${rs.reduce((a, r) => a + r.face.area, 0).toFixed(1)} m²`, PW - M, y + 3, { align: 'right' })
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...GREY)
      doc.text(`Ceiling height ${Math.round(level.height * 100)} cm`, cx, y + 11)
      doc.text(`Floor level +${(elev.get(level.id) ?? 0).toFixed(2)} m`, cx, y + 15)

      const img = await step(`3D view · ${level.name}`, overviewShot(i, project))
      if (img) {
        doc.addPage()
        page++
        header(doc, `3D view · ${i + 1} of ${levels.length}`, level.name, page)
        const w = PW - M * 2
        const h = (w * RES.h) / RES.w
        doc.addImage(img, 'JPEG', M, M + 14, w, Math.min(h, PH - M * 2 - 22), undefined, 'FAST')
      }
    }

    // ── Rooms ──
    for (const r of roomShots) {
      const name = r.info?.name ?? 'Room'
      const img = await step(`Room · ${name}`, roomShot(r.face, elev.get(r.level.id) ?? 0))
      doc.addPage()
      page++
      header(doc, `${r.level.name} · room`, name, page)
      const iw = 192
      const ih = (iw * RES.h) / RES.w
      if (img) doc.addImage(img, 'JPEG', M, M + 14, iw, ih, undefined, 'FAST')
      const cx = M + iw + 8
      const cw = PW - M - cx
      let y = M + 18
      stat(doc, cx, y + 4, `${r.face.area.toFixed(1)} m²`, 'Floor area')
      stat(doc, cx + cw / 2, y + 4, `${(r.level.height * 100).toFixed(0)}`, 'Ceiling, cm')
      y += 17
      swatch(doc, cx, y, r.info?.floor ?? DEFAULT_FLOOR_FINISH, 'Floor', finishName(r.info?.floor ?? DEFAULT_FLOOR_FINISH))
      y += 12
      swatch(doc, cx, y, r.info?.walls ?? DEFAULT_WALL_FINISH, 'Walls', finishName(r.info?.walls ?? DEFAULT_WALL_FINISH))
      y += 12
      swatch(doc, cx, y, r.info?.ceiling ?? DEFAULT_CEILING_FINISH, 'Ceiling', finishName(r.info?.ceiling ?? DEFAULT_CEILING_FINISH))
      y += 16
      // Key plan with this room highlighted.
      await plan(doc, project, r.level, { x: cx, y, w: cw, h: 46 }, r.face)
      // Furniture in the room, under the image.
      const faces = roomsOf(project, r.level).map((x) => x.face)
      const items = furniture.filter((o) => (o.levelId ?? levels[0].id) === r.level.id && objectRoom(o, faces)?.index === r.face.index)
      let fy = M + 14 + ih + 7
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...GREY)
      doc.text(`FURNISHED WITH · ${items.length}`, M, fy, { charSpace: 0.6 })
      fy += 4.5
      doc.setFontSize(8)
      doc.setTextColor(...INK)
      const names = items.map((o) => `${o.name.replace(/\.\d{3}$/, '')} (${cm(objectSize(o))} cm)`)
      const colW = iw / 2
      names.slice(0, 16).forEach((n, k) => doc.text(doc.splitTextToSize(n, colW - 4)[0], M + (k % 2) * colW, fy + Math.floor(k / 2) * 4.4))
    }

    // ── Schedules ──
    const newPage = (title: string) => {
      doc.addPage()
      page++
      header(doc, 'Schedule', title, page)
      return M + 18
    }
    let y = newPage('Finishes')
    y = table(
      doc,
      y,
      [
        { label: 'Room', w: 52 },
        { label: 'Floor', w: 30 },
        { label: 'Floor finish', w: 58 },
        { label: 'Walls', w: 64 },
        { label: 'Ceiling', w: 42 },
        { label: 'Area', w: 19, align: 'right' },
      ],
      roomShots.map((r) => [
        `${r.info?.name ?? 'Room'}`,
        r.level.name,
        finishName(r.info?.floor ?? DEFAULT_FLOOR_FINISH),
        `${finishName(r.info?.walls ?? DEFAULT_WALL_FINISH)} · ${(r.info?.walls ?? DEFAULT_WALL_FINISH).color.toUpperCase()}`,
        finishName(r.info?.ceiling ?? DEFAULT_CEILING_FINISH),
        `${r.face.area.toFixed(1)} m²`,
      ]),
      () => newPage('Finishes (continued)'),
    )

    // Doors and windows, grouped by type and size.
    const groups = new Map<string, { kind: string; size: string; sill: string; levels: Set<string>; count: number }>()
    for (const o of project.openings) {
      const w = project.walls.find((x) => x.id === o.wallId)
      const l = levels.find((x) => x.id === w?.levelId)
      if (!w || !l) continue
      const key = `${o.kind}|${o.width.toFixed(2)}|${o.height.toFixed(2)}|${o.sill.toFixed(2)}`
      const g = groups.get(key) ?? { kind: OPENING_DEFAULTS[o.kind].label, size: `${Math.round(o.width * 100)} × ${Math.round(o.height * 100)}`, sill: o.sill > 0 ? `${Math.round(o.sill * 100)}` : '—', levels: new Set(), count: 0 }
      g.levels.add(l.name)
      g.count++
      groups.set(key, g)
    }
    y = Math.max(y + 10, M + 18)
    if (y > PH - 50) y = newPage('Doors and windows')
    else {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.setTextColor(...INK)
      doc.text('Doors and windows', M, y)
      y += 6
    }
    y = table(
      doc,
      y,
      [
        { label: 'Type', w: 60 },
        { label: 'W × H (cm)', w: 40 },
        { label: 'Sill (cm)', w: 30 },
        { label: 'Floors', w: 105 },
        { label: 'Qty', w: 30, align: 'right' },
      ],
      [...groups.values()].sort((a, b) => a.kind.localeCompare(b.kind)).map((g) => [g.kind, g.size, g.sill, [...g.levels].join(', '), String(g.count)]),
      () => newPage('Doors and windows (continued)'),
    )

    y = newPage('Furniture')
    const allFaces = new Map(levels.map((l) => [l.id, roomsOf(project, l)]))
    table(
      doc,
      y,
      [
        { label: 'Piece', w: 58 },
        { label: 'Size W × H × D (cm)', w: 44 },
        { label: 'Room', w: 50 },
        { label: 'Floor', w: 34 },
        { label: 'Finishes', w: 79 },
      ],
      furniture.map((o) => {
        const lid = o.levelId ?? levels[0].id
        const rs = allFaces.get(lid) ?? []
        const face = objectRoom(o, rs.map((x) => x.face))
        const room = rs.find((x) => x.face === face)?.info?.name ?? (face ? 'Room' : '—')
        const fin = Object.entries(o.surfaces ?? {})
          .map(([slot, m]) => `${slot}: ${presetById(m.preset)?.name ?? m.color}`)
          .join(', ')
        return [o.name.replace(/\.\d{3}$/, ''), cm(objectSize(o)), room, levels.find((l) => l.id === lid)?.name ?? '', fin || (catalogItemOf(o)?.kind === 'model' ? 'As modelled' : '—')]
      }),
      () => newPage('Furniture (continued)'),
    )

    // ── Credits ──
    const used = new Set(project.objects.map((o) => o.modelFile).filter(Boolean))
    const credits = CATALOG.filter((c) => c.model && used.has(c.model.file))
    doc.addPage()
    page++
    header(doc, 'Notes', 'Credits', page)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...INK)
    let cy = M + 20
    const lines = [
      'Renders: 3D Workspace, 3840 × 2160. Plans are drawn to scale from the model; check dimensions on site before ordering.',
      'Material textures: ambientCG (CC0), or procedural.',
      ...credits.map((c) => `${c.name}: ${c.model!.credit} (${c.model!.license}).`),
    ]
    for (const l of lines) {
      for (const part of doc.splitTextToSize(l, PW - M * 2)) {
        doc.text(part, M, cy)
        cy += 5
      }
      cy += 1.5
    }

    progress('Writing PDF')
    download(doc.output('blob'), `${project.name.replace(/[^\w.-]+/g, '_') || 'home'}.pdf`)
    useWorkspace.getState().setJob({ status: 'done', message: `PDF ready · ${page} pages, ${done} renders at 4K` })
  } catch (e) {
    if ((e as Error).name !== 'AbortError') useWorkspace.getState().setJob({ status: 'error', message: (e as Error).message || 'PDF export failed.' })
  } finally {
    useWorkspace.getState().setRenderJob(null)
    const st = useWorkspace.getState()
    if (prevSel.sel) st.select(prevSel.sel)
    else if (prevSel.plan) st.selectPlan(prevSel.plan)
  }
}

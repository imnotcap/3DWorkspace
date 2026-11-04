import { createElement, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode, type WheelEvent as RWheelEvent } from 'react'
import { itemById } from '@/furniture/catalog'
import { cn } from '@/lib/cn'
import { activeProject, uid, useActiveProject, useWorkspace, type SceneObject, type Vec3 } from '@/store/workspace'
import { viewport } from '@/viewport/bridge'
import { DARK_THEME, drawPlan, formatLength, type SvgNode } from './draw'
import { moveEndpoints, moveWall, nearestWall, rectWalls, same, snapPoint, snapToWall } from './edit'
import { catalogItemOf, footprint, objectSize } from './footprint'
import { add, analyse, clampOpening, dist, mul, norm, sub } from './geometry'
import { tourPath, tourPose } from './tour'
import { OPENING_DEFAULTS, type Opening, type Vec2 } from './types'
import { placeItem } from './place'

interface ViewXf {
  scale: number
  ox: number
  oy: number
}

type Drag =
  | { kind: 'pan'; sx: number; sy: number; ox: number; oy: number }
  | { kind: 'endpoint'; from: Vec2; last: Vec2 }
  | { kind: 'wall'; id: string; start: Vec2; original: ReturnType<typeof activeProject>['walls'] }
  | { kind: 'opening'; id: string }
  | { kind: 'object'; id: string; offset: Vec2 }
  | { kind: 'rotate'; id: string }
  | { kind: 'tour'; id: string }
  | { kind: 'room-rect'; start: Vec2 }
  /** Resizing an opening by one end; the other end (`fixed`, metres along the wall) stays put. */
  | { kind: 'opening-end'; id: string; fixed: number }
  /** Resizing a piece by one side; the opposite side stays put. Size and placement at the start. */
  | { kind: 'resize'; id: string; axis: 0 | 2; sign: 1 | -1; c: Vec2; w: number; d: number; yaw: number }

// SVG attribute names → React prop names (stroke-width → strokeWidth); data-* stay as they are.
const reactProps = (a: SvgNode['attrs']) => Object.fromEntries(Object.entries(a).map(([k, v]) => [k.startsWith('data-') ? k : k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()), v]))
const render = (n: SvgNode, key: number | string): ReactNode => createElement(n.tag, { key, ...reactProps(n.attrs) }, n.text ?? n.children?.map((c, i) => render(c, i)))

export function PlanEditor() {
  const project = useActiveProject()
  const tool = useWorkspace((s) => s.planTool)
  const sel = useWorkspace((s) => s.planSel)
  const selectedId = useWorkspace((s) => s.selectedId)
  const placing = useWorkspace((s) => s.placing)
  const openingKind = useWorkspace((s) => s.openingKind)
  const grid = useWorkspace((s) => s.settings.grid)
  const thickness = useWorkspace((s) => s.settings.wallThickness)
  const frame = useWorkspace((s) => s.frame)
  const ws = useWorkspace.getState

  const level = project.levels.find((l) => l.id === project.activeLevelId) ?? project.levels[0]
  const levelIndex = project.levels.indexOf(level)
  const walls = useMemo(() => project.walls.filter((w) => w.levelId === level.id), [project.walls, level.id])
  const below = useMemo(() => (levelIndex > 0 ? project.walls.filter((w) => w.levelId === project.levels[levelIndex - 1].id) : []), [project.walls, project.levels, levelIndex])
  const geom = useMemo(() => analyse(walls), [walls])
  const wallIds = useMemo(() => new Set(walls.map((w) => w.id)), [walls])
  const openings = useMemo(() => project.openings.filter((o) => wallIds.has(o.wallId)), [project.openings, wallIds])
  const objects = useMemo(() => project.objects.filter((o) => !o.parentId && (o.levelId ?? project.levels[0].id) === level.id), [project.objects, project.levels, level.id])

  const svg = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [xf, setXf] = useState<ViewXf>({ scale: 50, ox: 400, oy: 300 })
  const [cursor, setCursor] = useState<{ p: Vec2; guideX?: number; guideY?: number } | null>(null)
  const [chain, setChain] = useState<Vec2[]>([])
  const [rectStart, setRectStart] = useState<Vec2 | null>(null)
  const [placeYaw, setPlaceYaw] = useState(0)
  /** Live size readout while a resize handle is dragged. */
  const [sizeLabel, setSizeLabel] = useState<{ at: Vec2; text: string } | null>(null)
  const drag = useRef<Drag | null>(null)
  const fitted = useRef<string | null>(null)

  useEffect(() => {
    const el = svg.current?.parentElement
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Fit the plan to the view when a project or level is opened.
  const fit = () => {
    const pts = [...walls.flatMap((w) => [w.a, w.b]), ...below.flatMap((w) => [w.a, w.b])]
    if (!pts.length) return setXf({ scale: 50, ox: size.w / 2, oy: size.h / 2 })
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    const scale = Math.min((size.w - 120) / Math.max(1, x1 - x0), (size.h - 140) / Math.max(1, y1 - y0), 160)
    setXf({ scale, ox: size.w / 2 - ((x0 + x1) / 2) * scale, oy: size.h / 2 + 10 - ((y0 + y1) / 2) * scale })
  }
  const view = useWorkspace((s) => s.view)
  useEffect(() => {
    const key = `${project.id}:${level.id}:${view}:${size.w > 100}`
    if (fitted.current === key || size.w < 100) return
    fitted.current = key
    fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, level.id, view, size.w, size.h])
  useEffect(() => {
    viewport.fitPlan = fit
  })

  const toPlan = (e: { clientX: number; clientY: number }): Vec2 => {
    const r = svg.current!.getBoundingClientRect()
    return [(e.clientX - r.left - xf.ox) / xf.scale, (e.clientY - r.top - xf.oy) / xf.scale]
  }
  const snapOpts = (from?: Vec2 | null, free?: boolean) => ({ walls, grid, pxPerM: xf.scale, from, free })

  // ───────── placing furniture from the catalog ─────────
  const placeItemDef = placing ? itemById(placing) : null
  const placingSize: Vec3 | null = placeItemDef ? placeItemDef.size : null
  const ghost = useMemo(() => {
    if (!placeItemDef || !cursor || !placingSize) return null
    const snapped = placeItemDef.mount !== 'ceiling' && placeItemDef.id !== 'rug' ? snapToWall(cursor.p, placingSize[2], geom.walls.values()) : null
    const c = snapped?.c ?? cursor.p
    const yaw = snapped?.yaw ?? placeYaw
    const fake = { transform: { position: [c[0], 0, c[1]], rotation: [0, yaw, 0], scale: [1, 1, 1] }, furniture: { item: placeItemDef.id, size: placingSize } } as unknown as SceneObject
    return { c, yaw, corners: footprint(fake).corners, snapped: !!snapped }
  }, [placeItemDef, cursor, placingSize, geom, placeYaw])

  // ───────── keyboard ─────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return
      if (e.key === 'Escape' && (chain.length || rectStart || placing)) {
        e.stopPropagation()
        setChain([])
        setRectStart(null)
        ws().setPlacing(null)
      }
      if (e.key === 'Enter' && chain.length) setChain([])
      if ((e.key === 'r' || e.key === 'R') && placing) {
        e.stopPropagation()
        e.preventDefault()
        setPlaceYaw((y) => y + Math.PI / 2)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [chain.length, rectStart, placing, ws])

  // ───────── pointer ─────────
  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    svg.current?.setPointerCapture(e.pointerId)
    const p = toPlan(e)
    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey && tool === 'select' && !placing)) {
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: xf.ox, oy: xf.oy }
      return
    }
    if (e.button !== 0) return
    const s = ws()
    const target = (e.target as Element).closest('[data-kind]') as HTMLElement | SVGElement | null
    const kind = target?.getAttribute('data-kind')
    const id = target?.getAttribute('data-id') ?? ''

    if (placing && ghost && placeItemDef) {
      placeItem(placeItemDef, ghost.c, ghost.yaw)
      if (!e.shiftKey) s.setPlacing(null)
      return
    }

    if (tool === 'wall') {
      const snapped = snapPoint(p, snapOpts(chain.at(-1), e.shiftKey)).p
      if (!chain.length) return setChain([snapped])
      const last = chain[chain.length - 1]
      if (dist(last, snapped) < 0.05) return
      s.editPlan('Draw wall', (pl) => ({ ...pl, walls: [...pl.walls, { id: uid(), levelId: level.id, a: last, b: snapped, thickness }] }))
      // Closing the loop, or ending on an existing wall, finishes the chain.
      const closes = same(snapped, chain[0]) || walls.some((w) => same(w.a, snapped) || same(w.b, snapped) || nearestWall(snapped, [w], 0.002))
      setChain(closes ? [] : [...chain, snapped])
      return
    }
    if (tool === 'room') {
      drag.current = { kind: 'room-rect', start: snapPoint(p, snapOpts()).p }
      setRectStart(snapPoint(p, snapOpts()).p)
      return
    }
    if (tool === 'door' || tool === 'window') {
      const hit = nearestWall(p, walls, 0.6)
      if (!hit) return
      const def = OPENING_DEFAULTS[openingKind]
      const width = Math.min(def.width, hit.len - 0.2)
      if (width < 0.3) return
      const o: Opening = { id: uid(), wallId: hit.wall.id, kind: openingKind, t: clampOpening(Math.round(hit.t / 0.05) * 0.05, width, hit.len), width, height: def.height, sill: def.sill, hinge: 'a', side: hit.side, open: 0, frame: { color: '#f4f2ee' } }
      s.editPlan(`Add ${def.label.toLowerCase()}`, (pl) => ({ ...pl, openings: [...pl.openings, o] }))
      s.selectPlan({ kind: 'opening', id: o.id })
      return
    }
    if (tool === 'tour') {
      if (kind === 'tour') {
        s.checkpoint('Move tour point')
        drag.current = { kind: 'tour', id }
        s.selectPlan({ kind: 'tour', id })
        return
      }
      const pt = { id: uid(), levelId: level.id, p }
      s.editPlan('Tour point', (pl) => ({ ...pl, tour: { ...pl.tour, points: [...pl.tour.points, pt] } }))
      s.setUseTour(true)
      s.selectPlan({ kind: 'tour', id: pt.id })
      return
    }

    // Select tool
    if (kind === 'opening-end') {
      const o = project.openings.find((x) => x.id === id)
      const w = o && project.walls.find((x) => x.id === o.wallId)
      if (!o || !w) return
      const L = dist(w.a, w.b)
      const t = clampOpening(o.t, o.width, L)
      s.checkpoint('Resize opening')
      drag.current = { kind: 'opening-end', id, fixed: target!.getAttribute('data-end') === 'a' ? t + o.width / 2 : t - o.width / 2 }
      return
    }
    if (kind === 'resize') {
      const o = project.objects.find((x) => x.id === id)
      if (!o) return
      const fp = footprint(o)
      s.checkpoint('Resize')
      drag.current = { kind: 'resize', id, axis: target!.getAttribute('data-axis') === 'x' ? 0 : 2, sign: target!.getAttribute('data-sign') === '1' ? 1 : -1, c: fp.c, w: fp.w, d: fp.d, yaw: fp.yaw }
      return
    }
    if (kind === 'endpoint') {
      const at: Vec2 = [Number(target!.getAttribute('data-x')), Number(target!.getAttribute('data-y'))]
      s.checkpoint('Move wall end')
      drag.current = { kind: 'endpoint', from: at, last: at }
      return
    }
    if (kind === 'rotate') {
      s.checkpoint('Rotate')
      drag.current = { kind: 'rotate', id }
      return
    }
    if (kind === 'object') {
      const o = project.objects.find((x) => x.id === id)
      s.select(id)
      if (o) {
        s.checkpoint('Move')
        drag.current = { kind: 'object', id, offset: sub([o.transform.position[0], o.transform.position[2]], p) }
      }
      return
    }
    if (kind === 'opening') {
      s.selectPlan({ kind: 'opening', id })
      s.checkpoint('Move opening')
      drag.current = { kind: 'opening', id }
      return
    }
    if (kind === 'wall') {
      s.selectPlan({ kind: 'wall', id })
      drag.current = { kind: 'wall', id, start: p, original: project.walls }
      return
    }
    if (kind === 'tour') {
      s.selectPlan({ kind: 'tour', id })
      s.checkpoint('Move tour point')
      drag.current = { kind: 'tour', id }
      return
    }
    if (kind === 'room') {
      s.selectPlan({ kind: 'room', id: level.id, at: [Number(target!.getAttribute('data-x')), Number(target!.getAttribute('data-y'))] })
      return
    }
    s.selectPlan(null)
    s.select(null)
    drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: xf.ox, oy: xf.oy }
  }

  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const p = toPlan(e)
    const d = drag.current
    const s = ws()
    if (!d) {
      if (tool === 'wall' || tool === 'room') {
        const r = snapPoint(p, snapOpts(tool === 'wall' ? chain.at(-1) : null, e.shiftKey))
        setCursor({ p: r.p, guideX: r.guideX, guideY: r.guideY })
      } else setCursor({ p })
      return
    }
    if (d.kind === 'pan') return setXf((v) => ({ ...v, ox: d.ox + e.clientX - d.sx, oy: d.oy + e.clientY - d.sy }))
    if (d.kind === 'room-rect') return setCursor({ p: snapPoint(p, snapOpts()).p })
    if (d.kind === 'endpoint') {
      const others = walls.filter((w) => !same(w.a, d.last) && !same(w.b, d.last))
      const to = snapPoint(p, { ...snapOpts(null, e.shiftKey), walls: others }).p
      s.editPlan(null, (pl) => ({ ...pl, walls: moveEndpoints(pl.walls, level.id, d.last, to) }))
      drag.current = { ...d, last: to }
      return
    }
    if (d.kind === 'wall') {
      let delta = sub(p, d.start)
      if (Math.hypot(delta[0], delta[1]) * xf.scale < 4) return
      if (d.original === project.walls) s.checkpoint('Move wall')
      const w = d.original.find((x) => x.id === d.id)!
      // Walls move square to themselves (keeps corners square), snapped to the grid.
      const n = norm([-(w.b[1] - w.a[1]), w.b[0] - w.a[0]])
      const k = Math.round((delta[0] * n[0] + delta[1] * n[1]) / grid) * grid
      delta = e.shiftKey ? delta : mul(n, k)
      s.editPlan(null, (pl) => ({ ...pl, walls: moveWall(d.original, d.id, delta) }))
      return
    }
    if (d.kind === 'opening') {
      const o = project.openings.find((x) => x.id === d.id)
      const w = o && project.walls.find((x) => x.id === o.wallId)
      if (!o || !w) return
      const L = dist(w.a, w.b)
      const dir = norm(sub(w.b, w.a))
      const t = clampOpening(Math.round(((p[0] - w.a[0]) * dir[0] + (p[1] - w.a[1]) * dir[1]) / grid) * grid, o.width, L)
      s.editPlan(null, (pl) => ({ ...pl, openings: pl.openings.map((x) => (x.id === o.id ? { ...x, t } : x)) }))
      return
    }
    if (d.kind === 'opening-end') {
      const o = project.openings.find((x) => x.id === d.id)
      const w = o && project.walls.find((x) => x.id === o.wallId)
      if (!o || !w) return
      const L = dist(w.a, w.b)
      const dir = norm(sub(w.b, w.a))
      let u = (p[0] - w.a[0]) * dir[0] + (p[1] - w.a[1]) * dir[1]
      if (!e.shiftKey) u = Math.round(u / grid) * grid
      // The moving end stays on the wall, at least 30 cm from the fixed one.
      u = Math.max(0.05, Math.min(L - 0.05, u))
      const width = Math.max(0.3, Math.min(L - 0.1, Math.abs(u - d.fixed)))
      const t = clampOpening(d.fixed + (Math.sign(u - d.fixed) || 1) * (width / 2), width, L)
      s.editPlan(null, (pl) => ({ ...pl, openings: pl.openings.map((x) => (x.id === o.id ? { ...x, width, t } : x)) }))
      setSizeLabel({ at: add(w.a, mul(dir, t)), text: formatLength(width) })
      return
    }
    if (d.kind === 'resize') {
      const o = project.objects.find((x) => x.id === d.id)
      if (!o) return
      const cos = Math.cos(d.yaw)
      const sin = Math.sin(d.yaw)
      const dx = p[0] - d.c[0]
      const dy = p[1] - d.c[1]
      // Pointer in the piece's own axes (inverse of footprint's local → plan).
      const local = d.axis === 0 ? dx * cos - dy * sin : dx * sin + dy * cos
      const start = d.axis === 0 ? d.w : d.d
      let size = d.sign * local + start / 2
      size = e.shiftKey ? Math.round(size * 100) / 100 : Math.round(size / grid) * grid
      size = Math.max(0.05, Math.min(30, size))
      const shift = (d.sign * (size - start)) / 2
      const off: Vec2 = d.axis === 0 ? [shift * cos, -shift * sin] : [shift * sin, shift * cos]
      const c = add(d.c, off)
      const t = o.transform
      const transform = { ...t, position: [c[0], t.position[1], c[1]] as Vec3 }
      if (o.furniture) {
        const next = [...o.furniture.size] as Vec3
        next[d.axis] = size / t.scale[d.axis]
        s.updateObject(o.id, { furniture: { ...o.furniture, size: next }, transform })
      } else {
        const base = o.stats?.size ?? catalogItemOf(o)?.size
        if (!base || base[d.axis] <= 0) return
        const scale = [...t.scale] as Vec3
        scale[d.axis] = size / base[d.axis]
        s.updateObject(o.id, { transform: { ...transform, scale } })
      }
      const fp = footprint(ws().projects.find((x) => x.id === project.id)!.objects.find((x) => x.id === o.id)!)
      setSizeLabel({ at: fp.c, text: `${formatLength(fp.w)} × ${formatLength(fp.d)}` })
      return
    }
    if (d.kind === 'object') {
      const o = project.objects.find((x) => x.id === d.id)
      if (!o) return
      let c = add(p, d.offset)
      let yaw = o.transform.rotation[1]
      const item = itemById(o.furniture?.item)
      if (!e.altKey) {
        const snapped = item?.mount !== 'ceiling' && item?.id !== 'rug' ? snapToWall(c, objectSize(o)[2], geom.walls.values(), 0.25) : null
        if (snapped) ({ c, yaw } = snapped)
        else c = [Math.round(c[0] / grid) * grid, Math.round(c[1] / grid) * grid]
      }
      s.updateObject(o.id, { transform: { ...o.transform, position: [c[0], o.transform.position[1], c[1]], rotation: [o.transform.rotation[0], yaw, o.transform.rotation[2]] } })
      return
    }
    if (d.kind === 'rotate') {
      const o = project.objects.find((x) => x.id === d.id)
      if (!o) return
      const c: Vec2 = [o.transform.position[0], o.transform.position[2]]
      let yaw = Math.atan2(p[0] - c[0], p[1] - c[1])
      if (!e.shiftKey) yaw = Math.round(yaw / (Math.PI / 12)) * (Math.PI / 12)
      s.updateObject(o.id, { transform: { ...o.transform, rotation: [o.transform.rotation[0], yaw, o.transform.rotation[2]] } })
      return
    }
    if (d.kind === 'tour') {
      s.editPlan(null, (pl) => ({ ...pl, tour: { ...pl.tour, points: pl.tour.points.map((t) => (t.id === d.id ? { ...t, p } : t)) } }))
    }
  }

  const onPointerUp = (e: RPointerEvent<SVGSVGElement>) => {
    const d = drag.current
    drag.current = null
    setSizeLabel(null)
    if (d?.kind === 'room-rect') {
      const end = snapPoint(toPlan(e), snapOpts()).p
      const made = rectWalls(d.start, end, thickness, level.id, project.walls, uid)
      if (made.length) ws().editPlan('Draw room', (pl) => ({ ...pl, walls: [...pl.walls, ...made] }))
      setRectStart(null)
    }
  }

  const onWheel = (e: RWheelEvent) => {
    const r = svg.current!.getBoundingClientRect()
    const mx = e.clientX - r.left
    const my = e.clientY - r.top
    const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))
    setXf((v) => {
      const scale = Math.min(600, Math.max(6, v.scale * k))
      const f = scale / v.scale
      return { scale, ox: mx - (mx - v.ox) * f, oy: my - (my - v.oy) * f }
    })
  }

  // ───────── drawing ─────────
  const nodes = useMemo(
    () =>
      drawPlan({
        geom,
        levelId: level.id,
        walls,
        openings,
        rooms: project.rooms,
        objects,
        below,
        scale: xf.scale,
        theme: DARK_THEME,
        selection: sel ? { kind: sel.kind, id: sel.id, at: sel.at } : null,
        selectedObject: selectedId,
        dimensions: xf.scale > 28,
        interactive: true,
      }),
    [geom, level.id, walls, openings, project.rooms, objects, below, xf.scale, sel, selectedId],
  )

  const px = (n: number) => n / xf.scale
  const selWall = sel?.kind === 'wall' ? walls.find((w) => w.id === sel.id) : null
  const selObj = selectedId ? objects.find((o) => o.id === selectedId) : null
  const selOpening = sel?.kind === 'opening' ? openings.find((o) => o.id === sel.id) : null
  const tourPts = project.tour.points.filter((t) => t.levelId === level.id)
  // The tour is drawn while editing it (and the camera marker while it plays).
  const showTour = tool === 'tour'
  const path = useMemo(() => (showTour ? tourPath(project) : null), [showTour, project])
  const cam = useMemo(() => (path && path.length > 0 && project.tour.points.length > 1 ? tourPose(project, frame - project.animation.start, project.animation.fps, path) : null), [path, project, frame])

  const doorPreview = (() => {
    if ((tool !== 'door' && tool !== 'window') || !cursor || drag.current) return null
    const hit = nearestWall(cursor.p, walls, 0.6)
    if (!hit) return null
    const def = OPENING_DEFAULTS[openingKind]
    const width = Math.min(def.width, hit.len - 0.2)
    const t = clampOpening(Math.round(hit.t / 0.05) * 0.05, width, hit.len)
    const dir = norm(sub(hit.wall.b, hit.wall.a))
    const a = add(hit.wall.a, mul(dir, t - width / 2))
    const b = add(hit.wall.a, mul(dir, t + width / 2))
    return { a, b, w: hit.wall.thickness + 0.04, label: formatLength(width) }
  })()

  const cursorStyle = placing || tool === 'wall' || tool === 'room' || tool === 'tour' ? 'crosshair' : tool === 'door' || tool === 'window' ? 'copy' : drag.current?.kind === 'pan' ? 'grabbing' : 'default'
  const minor = grid * Math.max(1, Math.round(10 / (grid * xf.scale)))

  return (
    <div className="relative size-full overflow-hidden bg-[#141414]">
      <svg
        ref={svg}
        width={size.w}
        height={size.h}
        className="absolute inset-0 touch-none select-none"
        style={{ cursor: cursorStyle }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setCursor(null)}
        onDoubleClick={() => setChain([])}
        onContextMenu={(e) => (e.preventDefault(), setChain([]))}
        onWheel={onWheel}
        data-testid="plan"
      >
        <defs>
          <pattern id="minor" width={minor * xf.scale} height={minor * xf.scale} patternUnits="userSpaceOnUse" x={xf.ox} y={xf.oy}>
            <path d={`M ${minor * xf.scale} 0 L 0 0 0 ${minor * xf.scale}`} fill="none" stroke="#1f1f1f" strokeWidth="1" />
          </pattern>
          <pattern id="major" width={xf.scale} height={xf.scale} patternUnits="userSpaceOnUse" x={xf.ox} y={xf.oy}>
            <rect width={xf.scale} height={xf.scale} fill="url(#minor)" />
            <path d={`M ${xf.scale} 0 L 0 0 0 ${xf.scale}`} fill="none" stroke="#292929" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#major)" />
        <g transform={`translate(${xf.ox} ${xf.oy}) scale(${xf.scale})`}>
          {nodes.map((n, i) => render(n, i))}

          {/* Selected wall: drag its ends. */}
          {tool === 'select' &&
            (selWall ? [selWall.a, selWall.b] : []).map((p, i) => (
              <circle key={i} cx={p[0]} cy={p[1]} r={px(6)} fill="#141414" stroke="#4c8dff" strokeWidth={px(2)} data-kind="endpoint" data-x={p[0]} data-y={p[1]} style={{ cursor: 'move' }} />
            ))}
          {/* Selected piece: rotate handle in front of it. */}
          {tool === 'select' &&
            selObj &&
            (() => {
              const fp = footprint(selObj)
              const h = fp.at(0, fp.d / 2 + px(22))
              const f = fp.at(0, fp.d / 2)
              return (
                <g>
                  <line x1={f[0]} y1={f[1]} x2={h[0]} y2={h[1]} stroke="#4c8dff" strokeWidth={px(1)} />
                  <circle cx={h[0]} cy={h[1]} r={px(6)} fill="#4c8dff" data-kind="rotate" data-id={selObj.id} style={{ cursor: 'grab' }} />
                </g>
              )
            })()}

          {/* Selected piece: a handle on each side to resize it (the opposite side stays put). */}
          {tool === 'select' &&
            selObj &&
            !selObj.keys?.length &&
            (() => {
              const fp = footprint(selObj)
              const handles = [
                { axis: 'x', sign: 1, at: fp.at(fp.w / 2, 0), along: fp.at(fp.w / 2 + 1, 0) },
                { axis: 'x', sign: -1, at: fp.at(-fp.w / 2, 0), along: fp.at(-fp.w / 2 - 1, 0) },
                { axis: 'z', sign: 1, at: fp.at(0, fp.d / 2), along: fp.at(0, fp.d / 2 + 1) },
                { axis: 'z', sign: -1, at: fp.at(0, -fp.d / 2), along: fp.at(0, -fp.d / 2 - 1) },
              ]
              const r = px(4.5)
              return handles.map((h) => {
                const horizontal = Math.abs(h.along[0] - h.at[0]) > Math.abs(h.along[1] - h.at[1])
                return (
                  <rect
                    key={`${h.axis}${h.sign}`}
                    x={h.at[0] - r}
                    y={h.at[1] - r}
                    width={r * 2}
                    height={r * 2}
                    rx={px(1.5)}
                    fill="#ffffff"
                    stroke="#4c8dff"
                    strokeWidth={px(1.5)}
                    data-kind="resize"
                    data-id={selObj.id}
                    data-axis={h.axis}
                    data-sign={h.sign}
                    style={{ cursor: horizontal ? 'ew-resize' : 'ns-resize' }}
                  />
                )
              })
            })()}
          {/* Selected door or window: drag either end to make it wider or narrower. */}
          {tool === 'select' &&
            selOpening &&
            (() => {
              const g = geom.walls.get(selOpening.wallId)
              if (!g) return null
              const t = clampOpening(selOpening.t, selOpening.width, g.len)
              const r = px(5)
              const horizontal = Math.abs(g.d[0]) > Math.abs(g.d[1])
              return (['a', 'b'] as const).map((end) => {
                const at = add(g.wall.a, mul(g.d, t + (end === 'a' ? -1 : 1) * (selOpening.width / 2)))
                return (
                  <rect
                    key={end}
                    x={at[0] - r}
                    y={at[1] - r}
                    width={r * 2}
                    height={r * 2}
                    rx={px(1.5)}
                    fill="#ffffff"
                    stroke="#4c8dff"
                    strokeWidth={px(1.5)}
                    data-kind="opening-end"
                    data-id={selOpening.id}
                    data-end={end}
                    style={{ cursor: horizontal ? 'ew-resize' : 'ns-resize' }}
                  />
                )
              })
            })()}
          {sizeLabel && (
            <text x={sizeLabel.at[0]} y={sizeLabel.at[1] - px(14)} fontSize={px(12)} fill="#ffffff" textAnchor="middle" stroke="#141414" strokeWidth={px(3)} paintOrder="stroke" pointerEvents="none">
              {sizeLabel.text}
            </text>
          )}

          {/* Tour path, points and where the camera is now. */}
          {showTour && path && path.line.length > 1 && <polyline points={path.line.map((q) => `${q[0]},${q[2]}`).join(' ')} fill="none" stroke="#f5a524" strokeWidth={px(2)} strokeDasharray={`${px(6)} ${px(4)}`} pointerEvents="none" />}
          {showTour &&
            tourPts.map((t, i) => (
              <g key={t.id}>
                <circle cx={t.p[0]} cy={t.p[1]} r={px(sel?.kind === 'tour' && sel.id === t.id ? 8 : 6)} fill="#f5a524" stroke="#141414" strokeWidth={px(2)} data-kind="tour" data-id={t.id} style={{ cursor: 'move' }} />
                <text x={t.p[0]} y={t.p[1] + px(3.5)} fontSize={px(9)} textAnchor="middle" fill="#141414" pointerEvents="none" fontWeight={700}>
                  {i + 1}
                </text>
              </g>
            ))}
          {showTour &&
            cam &&
            (() => {
              // Camera position and the direction it looks, drawn as a small view cone.
              const C: Vec2 = [cam.target[0] + Math.sin(cam.polar) * Math.sin(cam.azimuth), cam.target[2] + Math.sin(cam.polar) * Math.cos(cam.azimuth)]
              const f = norm(sub([cam.target[0], cam.target[2]], C))
              const rot = (v: Vec2, a: number): Vec2 => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)]
              const L = px(34)
              const l = add(C, mul(rot(f, 0.5), L))
              const r = add(C, mul(rot(f, -0.5), L))
              return (
                <g pointerEvents="none">
                  <polygon points={[C, l, r].map((q) => q.join(',')).join(' ')} fill="#f5a52440" stroke="#f5a524" strokeWidth={px(1.5)} />
                  <circle cx={C[0]} cy={C[1]} r={px(5)} fill="#f5a524" />
                </g>
              )
            })()}

          {/* Drawing previews. */}
          {tool === 'wall' && chain.length > 0 && cursor && (
            <g pointerEvents="none">
              <polyline points={[...chain, cursor.p].map((q) => q.join(',')).join(' ')} fill="none" stroke="#4c8dff" strokeWidth={thickness} strokeOpacity={0.5} />
              <polyline points={[...chain, cursor.p].map((q) => q.join(',')).join(' ')} fill="none" stroke="#4c8dff" strokeWidth={px(1.5)} />
              <text x={(chain[chain.length - 1][0] + cursor.p[0]) / 2} y={(chain[chain.length - 1][1] + cursor.p[1]) / 2 - px(10)} fontSize={px(12)} fill="#ffffff" textAnchor="middle" stroke="#141414" strokeWidth={px(3)} paintOrder="stroke">
                {formatLength(dist(chain[chain.length - 1], cursor.p))}
              </text>
            </g>
          )}
          {tool === 'room' && rectStart && cursor && (
            <g pointerEvents="none">
              <rect x={Math.min(rectStart[0], cursor.p[0])} y={Math.min(rectStart[1], cursor.p[1])} width={Math.abs(cursor.p[0] - rectStart[0])} height={Math.abs(cursor.p[1] - rectStart[1])} fill="#4c8dff22" stroke="#4c8dff" strokeWidth={thickness} strokeOpacity={0.6} />
              <text x={(rectStart[0] + cursor.p[0]) / 2} y={(rectStart[1] + cursor.p[1]) / 2} fontSize={px(12)} fill="#fff" textAnchor="middle">
                {`${formatLength(Math.abs(cursor.p[0] - rectStart[0]))} × ${formatLength(Math.abs(cursor.p[1] - rectStart[1]))}`}
              </text>
            </g>
          )}
          {doorPreview && (
            <g pointerEvents="none">
              <line x1={doorPreview.a[0]} y1={doorPreview.a[1]} x2={doorPreview.b[0]} y2={doorPreview.b[1]} stroke="#4c8dff" strokeWidth={doorPreview.w} strokeOpacity={0.7} />
            </g>
          )}
          {ghost && (
            <polygon points={ghost.corners.map((q) => q.join(',')).join(' ')} fill="#4c8dff33" stroke={ghost.snapped ? '#46a758' : '#4c8dff'} strokeWidth={px(1.5)} pointerEvents="none" />
          )}
          {(tool === 'wall' || tool === 'room') && cursor && (
            <g pointerEvents="none">
              {cursor.guideX !== undefined && <line x1={cursor.guideX} x2={cursor.guideX} y1={-1000} y2={1000} stroke="#4c8dff" strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(4)}`} />}
              {cursor.guideY !== undefined && <line y1={cursor.guideY} y2={cursor.guideY} x1={-1000} x2={1000} stroke="#4c8dff" strokeWidth={px(1)} strokeDasharray={`${px(4)} ${px(4)}`} />}
              <circle cx={cursor.p[0]} cy={cursor.p[1]} r={px(4)} fill="none" stroke="#4c8dff" strokeWidth={px(1.5)} />
            </g>
          )}
        </g>
      </svg>
      <ScaleBar scale={xf.scale} />
      {!walls.length && tool === 'select' && !placing && <EmptyPlanHint />}
    </div>
  )
}

function ScaleBar({ scale }: { scale: number }) {
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10]
  const m = steps.find((s) => s * scale >= 60) ?? 10
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 flex items-end gap-2 font-mono text-2xs text-dim">
      <div className="h-1.5 border-x border-b border-dim" style={{ width: m * scale }} />
      {m >= 1 ? `${m} m` : `${m * 100} cm`}
    </div>
  )
}

function EmptyPlanHint() {
  return (
    <div className={cn('pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center')}>
      <p className="text-sm text-fg">Draw your floor plan</p>
      <p className="mt-1 text-xs text-dim">Room tool (M): drag a rectangle. Wall tool (W): click corner to corner. Or start from a template.</p>
    </div>
  )
}

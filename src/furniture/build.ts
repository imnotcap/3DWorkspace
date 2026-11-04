import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Shape,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
  type Material,
} from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { metricUVs } from '@/generation/parts/build'
import type { Vec3 } from '@/store/workspace'
import { itemById } from './catalog'

/**
 * Parametric furniture: every piece is built from its size, so a 2.4 m sofa gets four seat
 * cushions and a 1.2 m wardrobe two doors. Origin at the bottom centre of the footprint, front
 * towards +z. Each material slot is one named material ("Fabric", "Legs"…), which the Object
 * panel lists so any surface can be given any finish.
 */

class Kit {
  readonly group = new Group()
  private mats = new Map<string, Material>()
  constructor(private defaults: Record<string, string>) {}

  mat(slot: string): Material {
    let m = this.mats.get(slot)
    if (!m) {
      m = special(slot) ?? new MeshStandardMaterial({ name: slot, color: this.defaults[slot] ?? '#bdbab4', roughness: 0.6, metalness: 0 })
      this.mats.set(slot, m)
    }
    return m
  }

  add(g: BufferGeometry, slot: string, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    metricUVs(g)
    const m = new Mesh(g, this.mat(slot))
    m.position.set(x, y, z)
    m.rotation.set(rx, ry, rz)
    m.castShadow = m.receiveShadow = true
    this.group.add(m)
    return m
  }

  /** Rounded box with its bottom at y0. */
  box(slot: string, w: number, h: number, d: number, x: number, y0: number, z: number, r = 0.003, rx = 0, ry = 0, rz = 0) {
    const rr = Math.max(0.0005, Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4))
    const g = rr > 0.001 ? new RoundedBoxGeometry(Math.max(w, 1e-3), Math.max(h, 1e-3), Math.max(d, 1e-3), rr > 0.02 ? 4 : 2, rr) : new BoxGeometry(w, h, d)
    return this.add(g, slot, x, y0 + h / 2, z, rx, ry, rz)
  }

  /** Cylinder with its bottom at y0. */
  cyl(slot: string, rTop: number, rBottom: number, h: number, x: number, y0: number, z: number, seg = 24) {
    return this.add(new CylinderGeometry(rTop, rBottom, h, seg), slot, x, y0 + h / 2, z)
  }

  /** A bar between two points (handles, rails, legs at an angle). */
  rod(slot: string, r: number, a: Vec3, b: Vec3, seg = 12) {
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const dz = b[2] - a[2]
    const L = Math.hypot(dx, dy, dz)
    const g = new CylinderGeometry(r, r, L, seg)
    const m = this.add(g, slot, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2)
    m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(dx / L, dy / L, dz / L))
    return m
  }
}

/** Fixed-look materials that aren't finishes you'd normally change. */
function special(slot: string): Material | null {
  switch (slot) {
    case 'Screen':
      return new MeshStandardMaterial({ name: slot, color: '#050607', roughness: 0.08, metalness: 0.2 })
    case 'Mirror':
      return new MeshStandardMaterial({ name: slot, color: '#ffffff', roughness: 0.02, metalness: 1 })
    case 'Glass':
      return new MeshPhysicalMaterial({ name: slot, color: '#eef5f7', roughness: 0.02, metalness: 0, transmission: 1, thickness: 0, ior: 1.5, side: DoubleSide })
    case 'Light':
      return new MeshStandardMaterial({ name: slot, color: '#fff3dc', emissive: '#ffe2b0', emissiveIntensity: 6, roughness: 0.4 })
    case 'Glass top':
      return new MeshStandardMaterial({ name: slot, color: '#0b0b0c', roughness: 0.06, metalness: 0.1 })
    case 'Dark':
      return new MeshStandardMaterial({ name: slot, color: '#262626', roughness: 0.5, metalness: 0.3 })
  }
  return null
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

/** Small deterministic random numbers (books, prints). */
function rng(seed: number) {
  let s = Math.floor(Math.abs(seed) * 1e6) % 2147483647 || 1
  return () => ((s = (s * 16807) % 2147483647) / 2147483647)
}

// ───────────── pieces ─────────────

type Builder = (k: Kit, w: number, h: number, d: number) => void

function sofa(k: Kit, w: number, h: number, d: number) {
  const legH = 0.1
  const baseH = 0.2
  const arm = clamp(w * 0.09, 0.13, 0.22)
  const back = 0.2
  const seatY = legH + baseH
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const leg = k.cyl('Legs', 0.02, 0.014, legH, sx * (w / 2 - 0.07), 0, sz * (d / 2 - 0.07))
      leg.castShadow = true
    }
  k.box('Fabric', w, baseH, d, 0, legH, 0, 0.03)
  for (const sx of [-1, 1]) k.box('Fabric', arm, 0.62 - legH, d, sx * (w / 2 - arm / 2), legH, 0, 0.06)
  k.box('Fabric', w - arm * 2 + 0.02, h - seatY, back, 0, seatY, -d / 2 + back / 2, 0.05)
  const inner = w - arm * 2
  const n = clamp(Math.round(inner / 0.68), 1, 4)
  const cw = inner / n - 0.008
  const cd = d - back - 0.03
  for (let i = 0; i < n; i++) {
    const x = -inner / 2 + (inner / n) * (i + 0.5)
    k.box('Fabric', cw, 0.15, cd, x, seatY - 0.01, -d / 2 + back + cd / 2 + 0.015, 0.06)
    k.box('Fabric', cw - 0.02, Math.max(0.2, h - seatY - 0.16), 0.17, x, seatY + 0.13, -d / 2 + back + 0.07, 0.07, -0.13)
  }
}

function armchair(k: Kit, w: number, h: number, d: number) {
  sofa(k, w, h, d)
}

function coffeeTable(k: Kit, w: number, h: number, d: number) {
  const t = 0.035
  k.box('Top', w, t, d, 0, h - t, 0, 0.006)
  k.box('Top', w - 0.12, 0.02, d - 0.12, 0, 0.12, 0, 0.004)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box('Frame', 0.025, h - t, 0.025, sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.05), 0.002)
}

function sideTable(k: Kit, w: number, h: number, d: number) {
  const r = Math.min(w, d) / 2
  k.cyl('Top', r, r, 0.025, 0, h - 0.025, 0, 48)
  k.cyl('Frame', 0.016, 0.016, h - 0.035, 0, 0.012, 0)
  k.cyl('Frame', r * 0.6, r * 0.62, 0.012, 0, 0, 0, 40)
}

function tvUnit(k: Kit, w: number, h: number, d: number) {
  const legH = 0.12
  k.box('Body', w, h - legH, d - 0.02, 0, legH, -0.01, 0.004)
  const n = clamp(Math.round(w / 0.6), 1, 4)
  const fw = w / n
  for (let i = 0; i < n; i++) k.box('Fronts', fw - 0.004, h - legH - 0.03, 0.018, -w / 2 + fw * (i + 0.5), legH + 0.015, d / 2 - 0.02, 0.002)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cyl('Legs', 0.015, 0.012, legH, sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.06))
}

function tv(k: Kit, w: number, h: number, d: number) {
  const ph = h - 0.06
  k.box('Body', w, ph, 0.03, 0, 0.06, 0, 0.004)
  k.box('Screen', w - 0.02, ph - 0.02, 0.002, 0, 0.07, 0.0155, 0)
  for (const sx of [-1, 1]) k.box('Body', 0.06, 0.06, Math.min(d, 0.25), sx * (w / 2 - 0.2), 0, 0, 0.004)
}

function bookshelf(k: Kit, w: number, h: number, d: number) {
  const t = 0.022
  for (const sx of [-1, 1]) k.box('Wood', t, h, d, sx * (w / 2 - t / 2), 0, 0, 0.002)
  k.box('Wood', w, t, d, 0, h - t, 0, 0.002)
  k.box('Wood', w - t * 2, 0.06, d - 0.02, 0, 0, 0.0, 0.002)
  k.box('Wood', w - t * 2, h - 0.06, 0.008, 0, 0.06, -d / 2 + 0.004, 0.001)
  const n = Math.max(2, Math.round((h - 0.08) / 0.36))
  const gap = (h - 0.06 - t) / n
  const rand = rng(w * 7 + h * 3)
  const books: BufferGeometry[] = []
  const palette = [[0.55, 0.22, 0.18], [0.16, 0.24, 0.32], [0.82, 0.78, 0.7], [0.3, 0.36, 0.26], [0.12, 0.12, 0.12], [0.75, 0.58, 0.32], [0.6, 0.6, 0.58]]
  for (let i = 0; i < n; i++) {
    const y = 0.06 + gap * i
    if (i > 0) k.box('Wood', w - t * 2, t, d - 0.01, 0, y - t / 2, 0.003, 0.002)
    if (rand() < 0.2) continue
    let x = -w / 2 + t + 0.01 + rand() * 0.08
    const end = w / 2 - t - 0.02 - rand() * (w * 0.35)
    while (x < end) {
      const bw = 0.018 + rand() * 0.03
      const bh = Math.min(gap - t - 0.02, 0.17 + rand() * 0.12)
      const bd = Math.min(d - 0.04, 0.15 + rand() * 0.08)
      const g = new BoxGeometry(bw, bh, bd)
      g.translate(x + bw / 2, y + t / 2 + bh / 2, -d / 2 + 0.02 + bd / 2)
      const c = palette[Math.floor(rand() * palette.length)]
      const col = new Float32Array(g.attributes.position.count * 3)
      const j = 0.85 + rand() * 0.3
      for (let v = 0; v < col.length; v += 3) {
        col[v] = c[0] * j
        col[v + 1] = c[1] * j
        col[v + 2] = c[2] * j
      }
      g.setAttribute('color', new Float32BufferAttribute(col, 3))
      books.push(g)
      x += bw + 0.002
    }
  }
  if (books.length) {
    const merged = mergeGeometries(books)
    const m = k.add(merged, 'Books')
    ;(m.material as MeshStandardMaterial).vertexColors = true
    ;(m.material as MeshStandardMaterial).color.set('#ffffff')
  }
}

function rug(k: Kit, w: number, h: number, d: number) {
  k.box('Rug', w, Math.max(0.006, h), d, 0, 0, 0, 0.004)
}

function diningTable(k: Kit, w: number, h: number, d: number) {
  const t = 0.04
  k.box('Top', w, t, d, 0, h - t, 0, 0.006)
  const lw = 0.07
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box('Legs', lw, h - t, lw, sx * (w / 2 - 0.09), 0, sz * (d / 2 - 0.09), 0.006)
  k.box('Legs', w - 0.3, 0.07, 0.02, 0, h - t - 0.07, d / 2 - 0.1, 0.002)
  k.box('Legs', w - 0.3, 0.07, 0.02, 0, h - t - 0.07, -d / 2 + 0.1, 0.002)
}

function roundTable(k: Kit, w: number, h: number, d: number) {
  const r = Math.min(w, d) / 2
  k.cyl('Top', r, r, 0.035, 0, h - 0.035, 0, 64)
  k.cyl('Legs', 0.05, 0.06, h - 0.06, 0, 0.02, 0, 24)
  for (let i = 0; i < 4; i++) k.box('Legs', r * 1.2, 0.03, 0.05, 0, 0, 0, 0.004, 0, (i * Math.PI) / 4, 0)
}

function diningChair(k: Kit, w: number, h: number, d: number) {
  const seatH = 0.45
  const l = 0.034
  for (const sx of [-1, 1]) {
    k.box('Frame', l, seatH - 0.04, l, sx * (w / 2 - l / 2 - 0.01), 0, d / 2 - l / 2 - 0.02, 0.003)
    k.box('Frame', l, h, l, sx * (w / 2 - l / 2 - 0.01), 0, -d / 2 + l / 2 + 0.02, 0.003, -0.06)
  }
  k.box('Frame', w - 0.04, 0.05, d - 0.04, 0, seatH - 0.07, 0, 0.004)
  k.box('Seat', w - 0.02, 0.05, d - 0.03, 0, seatH - 0.03, 0.005, 0.02)
  k.box('Seat', w - 0.07, 0.22, 0.035, 0, h - 0.3, -d / 2 + 0.035, 0.012, -0.08)
  for (const sx of [-1, 1]) k.box('Frame', 0.02, 0.025, d - 0.1, sx * (w / 2 - 0.03), 0.16, 0, 0.002)
}

function barStool(k: Kit, w: number, h: number, d: number) {
  const r = Math.min(w, d) / 2
  k.cyl('Seat', r, r * 0.95, 0.045, 0, h - 0.045, 0, 40)
  const rad = r * 0.82
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4
    k.rod('Frame', 0.012, [Math.cos(a) * rad * 0.6, h - 0.05, Math.sin(a) * rad * 0.6], [Math.cos(a) * rad, 0, Math.sin(a) * rad])
  }
  const ring = k.add(new TorusGeometry(rad * 0.82, 0.009, 8, 40), 'Frame', 0, 0.28, 0, Math.PI / 2)
  ring.castShadow = true
}

/** Kitchen carcass with plinth and worktop; fronts drawn by `fronts`. */
function cabinet(k: Kit, w: number, h: number, d: number, fronts: 'doors' | 'drawers' | 'sink' | 'hob' | 'none', worktop = true) {
  const plinth = 0.1
  const top = worktop ? 0.04 : 0
  const bodyH = h - plinth - top
  k.box('Body', w - 0.002, plinth, d - 0.08, 0, 0, -0.03, 0.001)
  k.box('Body', w - 0.002, bodyH, d - 0.04, 0, plinth, -0.02, 0.002)
  if (worktop) {
    if (fronts === 'sink') {
      const bw = Math.min(w - 0.16, 0.6)
      const bd = d - 0.2
      k.box('Worktop', (w - bw) / 2, top, d, -(w + bw) / 4, h - top, 0, 0.002)
      k.box('Worktop', (w - bw) / 2, top, d, (w + bw) / 4, h - top, 0, 0.002)
      k.box('Worktop', bw, top, 0.1, 0, h - top, d / 2 - 0.05, 0.002)
      k.box('Worktop', bw, top, 0.1, 0, h - top, -d / 2 + 0.05, 0.002)
      // Basin: walls and floor, 18 cm deep.
      const by = h - 0.2
      k.box('Sink', bw, 0.01, bd, 0, by, 0, 0.001)
      for (const sx of [-1, 1]) k.box('Sink', 0.008, 0.2, bd, sx * (bw / 2 - 0.004), by, 0, 0.001)
      for (const sz of [-1, 1]) k.box('Sink', bw, 0.2, 0.008, 0, by, sz * (bd / 2 - 0.004), 0.001)
      // Tap
      k.cyl('Sink', 0.022, 0.024, 0.25, 0, h, -d / 2 + 0.06)
      const spout = k.add(new TorusGeometry(0.11, 0.012, 10, 24, Math.PI), 'Sink', 0, h + 0.25, -d / 2 + 0.17, 0, Math.PI / 2, 0)
      spout.castShadow = true
    } else k.box('Worktop', w, top, d, 0, h - top, 0, 0.002)
  }
  const fz = d / 2 - 0.0095
  const front = (x: number, y0: number, fw: number, fh: number, handle: 'top' | 'side-l' | 'side-r') => {
    k.box('Fronts', fw - 0.004, fh - 0.004, 0.019, x, y0 + 0.002, fz, 0.0015)
    const hy = handle === 'top' ? y0 + fh - 0.06 : y0 + fh - 0.12
    if (handle === 'top') k.rod('Handles', 0.006, [x - Math.min(0.16, fw * 0.35), hy, fz + 0.035], [x + Math.min(0.16, fw * 0.35), hy, fz + 0.035])
    else {
      const hx = x + (handle === 'side-l' ? -1 : 1) * (fw / 2 - 0.05)
      k.rod('Handles', 0.006, [hx, hy - 0.16, fz + 0.035], [hx, hy, fz + 0.035])
    }
  }
  if (fronts === 'doors' || fronts === 'sink') {
    const n = w > 0.65 ? 2 : 1
    for (let i = 0; i < n; i++) front(-w / 2 + (w / n) * (i + 0.5), plinth, w / n, bodyH, n === 2 ? (i === 0 ? 'side-r' : 'side-l') : 'side-r')
  } else if (fronts === 'drawers' || fronts === 'hob') {
    const hs = [0.25, 0.32, 0.43].map((f) => f * bodyH)
    let y = plinth + bodyH
    for (const fh of hs) {
      y -= fh
      front(0, y, w, fh, 'top')
    }
    if (fronts === 'hob') {
      k.box('Glass top', Math.min(w - 0.04, 0.58), 0.006, Math.min(d - 0.08, 0.52), 0, h, 0, 0.002)
      for (const [x, z, r] of [
        [-0.13, 0.12, 0.09],
        [0.13, 0.12, 0.07],
        [-0.13, -0.12, 0.07],
        [0.13, -0.12, 0.09],
      ] as const)
        k.add(new TorusGeometry(r, 0.003, 6, 40), 'Dark', x * (w / 0.6), h + 0.007, z, Math.PI / 2)
    }
  }
}

function ovenTower(k: Kit, w: number, h: number, d: number) {
  const plinth = 0.1
  k.box('Body', w - 0.002, plinth, d - 0.08, 0, 0, -0.03, 0.001)
  k.box('Body', w - 0.002, h - plinth, d - 0.04, 0, plinth, -0.02, 0.002)
  const fz = d / 2 - 0.0095
  const ovenY = 0.85
  const ovenH = 0.6
  k.box('Fronts', w - 0.004, ovenY - plinth - 0.004, 0.019, 0, plinth + 0.002, fz, 0.0015)
  k.box('Glass top', w - 0.01, ovenH - 0.01, 0.022, 0, ovenY + 0.005, fz, 0.002)
  k.rod('Handles', 0.009, [-w / 2 + 0.08, ovenY + ovenH - 0.06, fz + 0.04], [w / 2 - 0.08, ovenY + ovenH - 0.06, fz + 0.04])
  k.box('Fronts', w - 0.004, h - ovenY - ovenH - 0.004, 0.019, 0, ovenY + ovenH + 0.002, fz, 0.0015)
  k.rod('Handles', 0.006, [w / 2 - 0.05, ovenY + ovenH + 0.06, fz + 0.035], [w / 2 - 0.05, ovenY + ovenH + 0.22, fz + 0.035])
}

function fridge(k: Kit, w: number, h: number, d: number) {
  k.box('Body', w, h, d - 0.02, 0, 0, -0.01, 0.012)
  const split = h * 0.36
  k.box('Dark', w + 0.002, 0.006, 0.01, 0, split, d / 2 - 0.016, 0.001)
  for (const [y0, y1] of [
    [split - 0.35, split - 0.05],
    [split + 0.08, split + 0.6],
  ])
    k.rod('Handles', 0.009, [w / 2 - 0.06, y0, d / 2 + 0.02], [w / 2 - 0.06, y1, d / 2 + 0.02])
}

function wallCabinet(k: Kit, w: number, h: number, d: number) {
  k.box('Body', w - 0.002, h, d - 0.02, 0, 0, -0.01, 0.002)
  const n = w > 0.65 ? 2 : 1
  const fz = d / 2 - 0.0095
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (w / n) * (i + 0.5)
    k.box('Fronts', w / n - 0.004, h - 0.004, 0.019, x, 0.002, fz, 0.0015)
    const hx = x + (n === 2 ? (i === 0 ? 1 : -1) : 1) * (w / n / 2 - 0.05)
    k.rod('Handles', 0.006, [hx, 0.04, fz + 0.035], [hx, 0.2, fz + 0.035])
  }
}

function island(k: Kit, w: number, h: number, d: number) {
  // Cabinets on the front, a 30 cm worktop overhang at the back for stools.
  const base = Math.max(0.5, d - 0.3)
  const before = k.group.children.length
  cabinet(k, w, h - 0.05, base, 'drawers', false)
  for (const c of k.group.children.slice(before)) c.position.z += d / 2 - base / 2
  k.box('Worktop', w + 0.02, 0.05, d, 0, h - 0.05, 0, 0.003)
}

function rangeHood(k: Kit, w: number, h: number, d: number) {
  k.box('Body', w, 0.1, d, 0, 0, 0, 0.004)
  k.box('Body', 0.3, h - 0.1, 0.25, 0, 0.1, -d / 2 + 0.125, 0.003)
  k.box('Dark', w - 0.04, 0.004, d - 0.04, 0, -0.002, 0, 0.001)
}

function bed(k: Kit, w: number, h: number, d: number) {
  const frameH = 0.32
  k.box('Frame', w, frameH - 0.06, d, 0, 0.06, 0, 0.03)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box('Dark', 0.05, 0.06, 0.05, sx * (w / 2 - 0.08), 0, sz * (d / 2 - 0.08), 0.004)
  // Upholstered headboard with vertical channels.
  const hb = 0.09
  const n = Math.max(3, Math.round(w / 0.22))
  for (let i = 0; i < n; i++) k.box('Frame', (w + 0.04) / n - 0.006, h - 0.06, hb, -(w + 0.04) / 2 + ((w + 0.04) / n) * (i + 0.5), 0.06, -d / 2 + hb / 2, 0.035)
  const mt = 0.22
  const mattTop = frameH + mt
  k.box('Bedding', w - 0.04, mt, d - hb - 0.04, 0, frameH, hb / 2 + 0.01, 0.05)
  // Duvet over the lower two thirds, falling over the sides.
  const dd = (d - hb) * 0.7
  const dz = d / 2 - dd / 2 + 0.01
  k.box('Bedding', w + 0.02, 0.07, dd, 0, mattTop - 0.02, dz, 0.035)
  for (const sx of [-1, 1]) k.box('Bedding', 0.03, 0.24, dd, sx * (w / 2 + 0.005), mattTop - 0.24, dz, 0.012)
  k.box('Bedding', w + 0.02, 0.24, 0.03, 0, mattTop - 0.24, d / 2 + 0.015, 0.012)
  // Throw across the foot.
  k.box('Throw', w + 0.06, 0.02, 0.45, 0, mattTop + 0.045, d / 2 - 0.25, 0.008)
  for (const sx of [-1, 1]) k.box('Throw', 0.02, 0.22, 0.45, sx * (w / 2 + 0.035), mattTop - 0.17, d / 2 - 0.25, 0.006)
  // Pillows
  const np = w > 1.2 ? 2 : 1
  const pw = Math.min(0.68, (w - 0.12) / np)
  for (let i = 0; i < np; i++) k.box('Bedding', pw, 0.15, 0.42, -w / 2 + (w / np) * (i + 0.5), mattTop - 0.01, -d / 2 + hb + 0.26, 0.07, -0.25)
}

function nightstand(k: Kit, w: number, h: number, d: number) {
  const legH = 0.14
  k.box('Body', w, h - legH, d, 0, legH, 0, 0.006)
  k.box('Body', w - 0.02, (h - legH) * 0.45, 0.012, 0, h - (h - legH) * 0.5, d / 2 + 0.003, 0.003)
  const knob = k.cyl('Handles', 0.012, 0.012, 0.025, 0, 0, 0)
  knob.position.set(0, h - (h - legH) * 0.28, d / 2 + 0.02)
  knob.rotation.x = Math.PI / 2
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cyl('Body', 0.014, 0.01, legH, sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.05))
}

function wardrobe(k: Kit, w: number, h: number, d: number) {
  const plinth = 0.08
  k.box('Body', w, plinth, d - 0.05, 0, 0, -0.02, 0.001)
  k.box('Body', w, h - plinth, d - 0.02, 0, plinth, -0.01, 0.003)
  const n = clamp(Math.round(w / 0.5), 1, 5)
  const fw = w / n
  const fz = d / 2 - 0.009
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + fw * (i + 0.5)
    k.box('Fronts', fw - 0.004, h - plinth - 0.006, 0.018, x, plinth + 0.003, fz, 0.0015)
    const side = i % 2 === 0 ? 1 : -1
    const hx = x + side * (fw / 2 - 0.05)
    k.rod('Handles', 0.007, [hx, 0.85, fz + 0.035], [hx, 1.3, fz + 0.035])
  }
}

function dresser(k: Kit, w: number, h: number, d: number) {
  const legH = 0.1
  k.box('Body', w, h - legH, d, 0, legH, 0, 0.005)
  const cols = w > 0.9 ? 2 : 1
  const rows = 3
  const fh = (h - legH - 0.02) / rows
  const fw = (w - 0.02) / cols
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x = -w / 2 + 0.01 + fw * (c + 0.5)
      const y = legH + 0.01 + fh * r
      k.box('Body', fw - 0.006, fh - 0.006, 0.014, x, y + 0.003, d / 2 + 0.004, 0.003)
      k.rod('Handles', 0.006, [x - 0.06, y + fh * 0.55, d / 2 + 0.03], [x + 0.06, y + fh * 0.55, d / 2 + 0.03])
    }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.cyl('Body', 0.016, 0.012, legH, sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.06))
}

function roundedRect(w: number, d: number, r: number) {
  const s = new Shape()
  const x = -w / 2
  const y = -d / 2
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + d - r)
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d)
  s.lineTo(x + r, y + d)
  s.quadraticCurveTo(x, y + d, x, y + d - r)
  s.lineTo(x, y + r)
  s.quadraticCurveTo(x, y, x + r, y)
  return s
}

/** A shape extruded upward from y0 (plan → world: shape y = world z). */
function upward(shape: Shape, h: number, bevel = 0) {
  const g = new ExtrudeGeometry(shape, { depth: h, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 16 })
  g.rotateX(-Math.PI / 2) // extrusion → up; the shapes used here are symmetric front to back
  return g
}

function bathtub(k: Kit, w: number, h: number, d: number) {
  const wall = 0.07
  const outer = roundedRect(w, d, 0.06)
  const inner = roundedRect(w - wall * 2, d - wall * 2, 0.22)
  outer.holes.push(inner)
  k.add(upward(outer, h - 0.01, 0.008), 'Ceramic', 0, 0.002, 0)
  k.add(upward(roundedRect(w - wall * 2 + 0.01, d - wall * 2 + 0.01, 0.22), 0.06), 'Ceramic', 0, 0, 0)
  k.cyl('Taps', 0.018, 0.02, 0.12, 0, h, -d / 2 + 0.035)
  k.rod('Taps', 0.012, [0, h + 0.11, -d / 2 + 0.035], [0, h + 0.11, -d / 2 + 0.15])
}

function toilet(k: Kit, w: number, h: number, d: number) {
  const bowl = new LatheGeometry(
    [
      [0.1, 0],
      [0.115, 0.02],
      [0.13, 0.15],
      [0.17, 0.3],
      [0.19, 0.38],
      [0.18, 0.395],
    ].map(([r, y]) => new Vector2(r, y)),
    40,
  )
  const m = k.add(bowl, 'Ceramic', 0, 0, d / 2 - 0.25)
  m.scale.set(w / 0.4, 1, 1.32)
  const seat = new Shape()
  seat.absellipse(0, 0, 0.19, 0.245, 0, Math.PI * 2, false, 0)
  const hole = new Shape()
  hole.absellipse(0, 0.02, 0.12, 0.165, 0, Math.PI * 2, false, 0)
  seat.holes.push(hole)
  const sm = k.add(upward(seat, 0.018, 0.004), 'Ceramic', 0, 0.4, d / 2 - 0.25)
  sm.scale.set(w / 0.4, 1, 1)
  k.box('Ceramic', w * 0.95, 0.38, 0.17, 0, h - 0.38, -d / 2 + 0.085, 0.03)
  k.cyl('Taps', 0.025, 0.025, 0.006, 0, h, -d / 2 + 0.085, 24)
}

function vanity(k: Kit, w: number, h: number, d: number) {
  const legH = 0.14
  const topY = h - 0.14
  k.box('Body', w, topY - legH, d, 0, legH, 0, 0.004)
  k.box('Body', w - 0.01, (topY - legH) * 0.48, 0.012, 0, topY - (topY - legH) * 0.5, d / 2 + 0.003, 0.003)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box('Body', 0.03, legH, 0.03, sx * (w / 2 - 0.03), 0, sz * (d / 2 - 0.03), 0.002)
  const bowl = new LatheGeometry(
    [
      [0, 0],
      [0.1, 0],
      [0.17, 0.04],
      [0.2, 0.12],
      [0.2, 0.14],
      [0.19, 0.14],
      [0.185, 0.125],
      [0.16, 0.06],
      [0.09, 0.03],
      [0, 0.03],
    ].map(([r, y]) => new Vector2(r, y)),
    48,
  )
  k.add(bowl, 'Ceramic', 0, topY, 0.02)
  k.cyl('Taps', 0.014, 0.016, 0.26, 0, topY, -d / 2 + 0.06)
  k.rod('Taps', 0.01, [0, topY + 0.25, -d / 2 + 0.06], [0, topY + 0.25, -d / 2 + 0.2])
}

function shower(k: Kit, w: number, h: number, d: number) {
  k.box('Tray', w, 0.04, d, 0, 0, 0, 0.01)
  k.cyl('Taps', 0.04, 0.04, 0.004, 0, 0.04, 0, 24)
  // Glass screen along the open front, half width (walk-in).
  const gw = w * 0.6
  k.box('Glass', gw, h - 0.05, 0.008, -w / 2 + gw / 2, 0.05, d / 2 - 0.02, 0)
  k.box('Taps', gw, 0.02, 0.02, -w / 2 + gw / 2, h - 0.02, d / 2 - 0.02, 0.002)
  k.rod('Taps', 0.008, [-w / 2 + gw, h - 0.01, d / 2 - 0.02], [-w / 2 + gw, h - 0.01, -d / 2])
  // Rain head on an arm from the back wall, mixer below it.
  k.rod('Taps', 0.01, [0, h - 0.1, -d / 2], [0, h - 0.1, -d / 2 + 0.35])
  k.cyl('Taps', 0.12, 0.12, 0.012, 0, h - 0.13, -d / 2 + 0.35, 40)
  k.box('Taps', 0.16, 0.08, 0.05, 0, 1.05, -d / 2 + 0.025, 0.01)
}

function mirror(k: Kit, w: number, h: number, d: number) {
  k.box('Frame', w, h, Math.max(0.015, d - 0.005), 0, 0, 0, Math.min(w, h) * 0.08)
  k.box('Mirror', w - 0.03, h - 0.03, 0.004, 0, 0.015, d / 2 - 0.002, Math.min(w, h) * 0.07)
}

function desk(k: Kit, w: number, h: number, d: number) {
  k.box('Top', w, 0.03, d, 0, h - 0.03, 0, 0.004)
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 - 0.06)
    k.box('Frame', 0.05, h - 0.03, 0.025, x, 0, 0, 0.003)
    k.box('Frame', 0.05, 0.025, d - 0.06, x, 0, 0, 0.003)
    k.box('Frame', 0.05, 0.025, d - 0.1, x, h - 0.055, 0, 0.003)
  }
  k.box('Frame', w - 0.17, 0.05, 0.02, 0, h - 0.11, -d / 2 + 0.06, 0.003)
}

function officeChair(k: Kit, w: number, h: number, d: number) {
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    const L = Math.min(w, d) / 2 - 0.03
    k.rod('Frame', 0.016, [0, 0.08, 0], [Math.cos(a) * L, 0.06, Math.sin(a) * L])
    k.add(new SphereGeometry(0.028, 16, 12), 'Dark', Math.cos(a) * L, 0.03, Math.sin(a) * L)
  }
  k.cyl('Frame', 0.03, 0.035, 0.08, 0, 0.04, 0)
  k.cyl('Dark', 0.022, 0.022, 0.3, 0, 0.12, 0)
  k.box('Frame', 0.3, 0.04, 0.3, 0, 0.41, 0, 0.01)
  k.box('Fabric', 0.5, 0.08, 0.48, 0, 0.44, 0.02, 0.035)
  k.rod('Frame', 0.015, [0, 0.45, -0.2], [0, 0.7, -0.27])
  k.box('Fabric', 0.47, h - 0.62, 0.06, 0, 0.62, -0.27, 0.03, -0.1)
  for (const sx of [-1, 1]) {
    k.rod('Frame', 0.012, [sx * 0.24, 0.47, 0], [sx * 0.26, 0.66, 0])
    k.box('Dark', 0.06, 0.025, 0.24, sx * 0.26, 0.66, 0, 0.01)
  }
}

function wallShelf(k: Kit, w: number, h: number, d: number) {
  k.box('Wood', w, Math.max(0.02, h), d, 0, 0, 0, 0.003)
}

function floorLamp(k: Kit, w: number, h: number) {
  k.cyl('Frame', 0.15, 0.16, 0.022, 0, 0, 0, 40)
  k.cyl('Frame', 0.011, 0.011, h - 0.3, 0, 0.02, 0, 12)
  const shade = k.add(new CylinderGeometry(w * 0.4, w / 2, 0.32, 48, 1, true), 'Shade', 0, h - 0.16, 0)
  ;(shade.material as MeshStandardMaterial).side = DoubleSide
  k.add(new SphereGeometry(0.04, 16, 12), 'Light', 0, h - 0.2, 0)
}

function pendant(k: Kit, w: number, h: number) {
  k.cyl('Shade', 0.06, 0.06, 0.02, 0, h - 0.02, 0, 24)
  k.cyl('Dark', 0.003, 0.003, h - 0.2, 0, 0.2, 0, 6)
  const dome = new LatheGeometry(
    Array.from({ length: 16 }, (_, i) => {
      const t = i / 15
      return new Vector2(0.025 + Math.sin(t * Math.PI * 0.5) * (w / 2 - 0.025), 0.2 - (1 - Math.cos(t * Math.PI * 0.5)) * 0.18)
    }),
    48,
  )
  const m = k.add(dome, 'Shade', 0, 0, 0)
  ;(m.material as MeshStandardMaterial).side = DoubleSide
  k.add(new SphereGeometry(0.045, 16, 12), 'Light', 0, 0.06, 0)
}

function wallArt(k: Kit, w: number, h: number, d: number) {
  k.box('Frame', w, h, d, 0, 0, 0, 0.002)
  const c = document.createElement('canvas')
  c.width = 512
  c.height = Math.round((512 * h) / w)
  const ctx = c.getContext('2d')!
  const rand = rng(w * 13 + h * 17)
  ctx.fillStyle = '#efe9df'
  ctx.fillRect(0, 0, c.width, c.height)
  const pal = ['#c86b4a', '#2f4a5c', '#d9b26a', '#7c8f78', '#1d1d1d', '#b9a59a']
  for (let i = 0; i < 5; i++) {
    ctx.fillStyle = pal[Math.floor(rand() * pal.length)]
    ctx.globalAlpha = 0.85
    ctx.beginPath()
    if (rand() < 0.5) ctx.arc(rand() * c.width, rand() * c.height, 40 + rand() * 140, 0, Math.PI * 2)
    else ctx.rect(rand() * c.width * 0.7, rand() * c.height * 0.7, 60 + rand() * 200, 60 + rand() * 200)
    ctx.fill()
  }
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  const print = new Mesh(new PlaneGeometry(w - 0.08, h - 0.08), new MeshStandardMaterial({ name: 'Print', map: tex, roughness: 0.85 }))
  print.position.set(0, h / 2, d / 2 + 0.001)
  k.group.add(print)
}

function curtains(k: Kit, w: number, h: number, d: number) {
  k.rod('Rod', 0.012, [-w / 2 - 0.08, h - 0.03, 0], [w / 2 + 0.08, h - 0.03, 0])
  for (const sx of [-1, 1]) {
    const pw = w * 0.32
    const g = new PlaneGeometry(pw, h - 0.06, 64, 1)
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin((p.getX(i) / 0.11) * Math.PI) * Math.min(0.04, d / 3))
    g.computeVertexNormals()
    const m = k.add(g, 'Fabric', sx * (w / 2 - pw / 2), (h - 0.06) / 2, 0)
    ;(m.material as MeshStandardMaterial).side = DoubleSide
  }
}

function stairs(k: Kit, w: number, h: number, d: number) {
  const n = Math.max(3, Math.round(h / 0.18))
  const rise = h / n
  const run = d / n
  for (let i = 0; i < n; i++) {
    const z = d / 2 - run * (i + 0.5)
    k.box('Treads', w - 0.1, 0.04, run + 0.03, 0, rise * (i + 1) - 0.04, z - 0.015, 0.004)
    k.box('Structure', w - 0.1, rise - 0.04, 0.02, 0, rise * i, z + run / 2 - 0.01, 0.001)
  }
  const ang = Math.atan2(h, d)
  const L = Math.hypot(h, d)
  for (const sx of [-1, 1]) {
    const s = k.box('Structure', 0.05, 0.28, L + 0.1, sx * (w / 2 - 0.025), 0, 0, 0.004)
    s.position.set(sx * (w / 2 - 0.025), h / 2 - 0.05, 0)
    s.rotation.x = ang
  }
  // Handrail on the open (+x) side, on posts.
  const x = w / 2 - 0.025
  const top = (z: number) => ((d / 2 - z) / d) * h + 0.9
  for (const z of [d / 2 - 0.15, 0, -d / 2 + 0.15]) k.rod('Rail', 0.012, [x, ((d / 2 - z) / d) * h, z], [x, top(z), z])
  k.rod('Rail', 0.022, [x, top(d / 2 - 0.1), d / 2 - 0.1], [x, top(-d / 2 + 0.1), -d / 2 + 0.1], 16)
}

const BUILDERS: Record<string, Builder> = {
  sofa,
  loveseat: sofa,
  armchair,
  'coffee-table': coffeeTable,
  'side-table': sideTable,
  'tv-unit': tvUnit,
  tv,
  bookshelf,
  rug,
  'dining-table': diningTable,
  'round-table': roundTable,
  'dining-chair': diningChair,
  'bar-stool': barStool,
  'base-cabinet': (k, w, h, d) => cabinet(k, w, h, d, 'doors'),
  'drawer-cabinet': (k, w, h, d) => cabinet(k, w, h, d, 'drawers'),
  'sink-cabinet': (k, w, h, d) => cabinet(k, w, h, d, 'sink'),
  'hob-cabinet': (k, w, h, d) => cabinet(k, w, h, d, 'hob'),
  'oven-tower': ovenTower,
  fridge,
  'wall-cabinet': wallCabinet,
  'kitchen-island': island,
  'range-hood': rangeHood,
  'bed-double': bed,
  'bed-single': bed,
  nightstand,
  wardrobe,
  dresser,
  bathtub,
  toilet,
  vanity,
  shower,
  mirror,
  desk,
  'office-chair': officeChair,
  'wall-shelf': wallShelf,
  'floor-lamp': floorLamp,
  pendant,
  'wall-art': wallArt,
  curtains,
  stairs,
}

/** Build a parametric piece at `size` (metres). Unknown ids give a labelled box. */
export function buildFurniture(itemId: string, size: Vec3): Group {
  const item = itemById(itemId)
  const defaults = Object.fromEntries(Object.entries(item?.slots ?? {}).map(([k, v]) => [k, v.color]))
  const k = new Kit(defaults)
  const [w, h, d] = size.map((v) => Math.max(0.01, v)) as Vec3
  const b = BUILDERS[itemId]
  if (b) b(k, w, h, d)
  else k.box('Body', w, h, d, 0, 0, 0, 0.01)
  k.group.name = item?.name ?? itemId
  return k.group
}

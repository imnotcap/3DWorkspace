// Text on a floor plan: room names and their areas ("Værelse 1 / 12,3 m²"). From a PDF's own text
// layer when it has one, otherwise read with OCR (tesseract, Danish + English, served from the site).

/** A line of text in drawing pixels. */
export interface TextLine {
  str: string
  x0: number
  y0: number
  x1: number
  y1: number
}

/** A room label: its name (if one stands with it), its area and where it sits (drawing pixels). */
export interface AreaLabel {
  name: string | null
  area: number
  at: [number, number]
  /** Boxes of the label's text lines (to keep them out of the wall search). */
  boxes: [number, number, number, number][]
}

// "12,3 m²", "12.3 m2", "12 kvm", and the ways OCR misreads the m² ("m?", "n?", "rn2", "m+").
const AREA = /(\d{1,4}(?:[.,]\d{1,2})?)\s*(?:(?:m|n|rn)\s*[²2?*'"º°+<>]?|kvm)(?![a-zæøå])/i

/** Common room names on Danish (and English) plans: OCR readings close to one are corrected to it. */
const ROOM_NAMES = [
  'Stue', 'Opholdsstue', 'Dagligstue', 'Spisestue', 'Alrum', 'Køkken', 'Køkken-alrum', 'Køkken/alrum', 'Køkkenalrum', 'Spisekøkken', 'Værelse', 'Soveværelse',
  'Børneværelse', 'Gæsteværelse', 'Bad', 'Badeværelse', 'Toilet', 'WC', 'Gæstetoilet', 'Bryggers', 'Vaskerum', 'Entré', 'Entre', 'Gang', 'Hall', 'Forstue', 'Kontor',
  'Arbejdsværelse', 'Hobbyrum', 'Teknik', 'Teknikrum', 'Fyrrum', 'Depot', 'Pulterrum', 'Viktualierum', 'Garderobe', 'Walk-in', 'Sauna', 'Udestue', 'Vinterhave',
  'Kælder', 'Loft', 'Repos', 'Trappe', 'Altan', 'Terrasse', 'Overdækket terrasse', 'Carport', 'Garage', 'Skur', 'Redskabsrum', 'Fitness', 'Bibliotek', 'Kontor/værelse',
  'Living', 'Living room', 'Kitchen', 'Bedroom', 'Bathroom', 'Hallway', 'Office', 'Utility', 'Storage', 'Dining',
]

function editDistance(a: string, b: string) {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]
    d[0] = i
    for (let j = 1; j <= b.length; j++) {
      const t = d[j]
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = t
    }
  }
  return d[b.length]
}

/** "Vaerelse 2" → "Værelse 2", "Sanma" → "Sauna": the nearest known room name, if it is near. */
export function correctName(raw: string) {
  const m = /^(.*?)(\s*\d+)?$/.exec(raw.trim())!
  const word = m[1]
  const num = m[2] ?? ''
  const w = word.toLowerCase().replace(/ae/g, 'æ').replace(/oe/g, 'ø').replace(/aa/g, 'å')
  let best = word
  let bestD = Infinity
  for (const n of ROOM_NAMES) {
    const d = Math.min(editDistance(w, n.toLowerCase()), editDistance(word.toLowerCase(), n.toLowerCase()))
    if (d < bestD) {
      bestD = d
      best = n
    }
  }
  return (bestD <= (word.length <= 3 ? 0 : Math.round(word.length / 3)) ? best : word) + num
}

/** Pick the room labels out of a page's text lines. */
export function areaLabels(lines: TextLine[]): AreaLabel[] {
  const out: AreaLabel[] = []
  const used = new Set<TextLine>()
  const clean = (s: string) => s.replace(/^[^\p{L}\d]+|[^\p{L}\d)]+$/gu, '').replace(/\s+/g, ' ').trim()
  // A bare decimal number right under a name is an area too (OCR sometimes loses the "m²").
  const BARE = /^\s*(\d{1,3}[.,]\d)\s*$/
  const hasNameAbove = (l: TextLine) =>
    lines.some((o) => o !== l && /\p{L}{3}/u.test(o.str) && !AREA.test(o.str) && o.y1 <= l.y0 + (l.y1 - l.y0) * 0.4 && l.y0 - o.y1 < (l.y1 - l.y0) * 1.6 && Math.abs((o.x0 + o.x1) / 2 - (l.x0 + l.x1) / 2) < Math.max(o.x1 - o.x0, l.x1 - l.x0) * 0.75)
  for (const l of lines) {
    const m = AREA.exec(l.str) ?? (hasNameAbove(l) ? BARE.exec(l.str) : null)
    if (!m) continue
    const area = Number(m[1].replace(',', '.'))
    if (!(area >= 0.5 && area <= 2000)) continue
    used.add(l)
    const h = l.y1 - l.y0
    const cx = (l.x0 + l.x1) / 2
    const boxes: AreaLabel['boxes'] = [[l.x0, l.y0, l.x1, l.y1]]
    // Name on the same line ("Bad 5,2 m²") or on the line just above.
    let name = clean(l.str.slice(0, m.index))
    if (!/\p{L}{2}/u.test(name)) {
      const above = lines
        .filter((o) => o !== l && !used.has(o) && !AREA.test(o.str) && o.y1 <= l.y0 + h * 0.4 && l.y0 - o.y1 < h * 1.6 && Math.abs((o.x0 + o.x1) / 2 - cx) < Math.max(o.x1 - o.x0, l.x1 - l.x0) * 0.75)
        .sort((p, q) => q.y1 - p.y1)[0]
      name = above && /\p{L}{2}/u.test(above.str) ? clean(above.str) : ''
      if (above && name) {
        used.add(above)
        boxes.push([above.x0, above.y0, above.x1, above.y1])
      }
    }
    // The label sits in its room: its centre is the anchor.
    const y0 = Math.min(...boxes.map((b) => b[1]))
    const y1 = Math.max(...boxes.map((b) => b[3]))
    out.push({ name: name ? correctName(name) : null, area, at: [cx, (y0 + y1) / 2], boxes })
  }
  return out
}

/** Text lines of a PDF page (pdfjs text items), in canvas pixels for `viewport`. */
export function pdfLines(items: { str: string; transform: number[]; width: number; height: number }[], vt: number[]): TextLine[] {
  const pieces = items
    .filter((it) => it.str.trim())
    .map((it) => {
      // Item → viewport: [a b c d e f] ∘ item transform.
      const t = it.transform
      const m = [vt[0] * t[0] + vt[2] * t[1], vt[1] * t[0] + vt[3] * t[1], vt[0] * t[2] + vt[2] * t[3], vt[1] * t[2] + vt[3] * t[3], vt[0] * t[4] + vt[2] * t[5] + vt[4], vt[1] * t[4] + vt[3] * t[5] + vt[5]]
      const fh = Math.hypot(m[2], m[3])
      const sx = Math.hypot(vt[0], vt[1])
      return { str: it.str, x0: m[4], x1: m[4] + it.width * sx, y0: m[5] - fh * 0.8, y1: m[5] + fh * 0.2, base: m[5], fh }
    })
    .sort((a, b) => a.base - b.base || a.x0 - b.x0)
  // Pieces on one baseline, close together, are one line.
  const lines: (TextLine & { base: number; fh: number })[] = []
  for (const p of pieces) {
    const l = lines.find((q) => Math.abs(q.base - p.base) < p.fh * 0.3 && p.x0 - q.x1 < p.fh * 1.2 && p.x0 > q.x0 - p.fh)
    if (l) {
      l.str += (p.x0 - l.x1 > p.fh * 0.15 && !/\s$/.test(l.str) ? ' ' : '') + p.str
      l.x1 = Math.max(l.x1, p.x1)
      l.y0 = Math.min(l.y0, p.y0)
      l.y1 = Math.max(l.y1, p.y1)
    } else lines.push({ ...p })
  }
  return lines.map(({ str, x0, y0, x1, y1 }) => ({ str: str.trim(), x0, y0, x1, y1 }))
}

/**
 * Read the text of a drawing with OCR. `ink` is the drawing's darkness (0..255) with the walls
 * and the grey floors taken out, which reads far better than the original with its grey floors and black walls.
 */
export async function ocrLines(ink: Uint8Array, width: number, height: number, onProgress?: (p: number) => void): Promise<TextLine[]> {
  // Small drawings are enlarged: tesseract wants letters at least ~20 px tall.
  const f = Math.max(1, Math.min(3, 3000 / Math.max(width, height)))
  const c = document.createElement('canvas')
  c.width = Math.round(width * f)
  c.height = Math.round(height * f)
  const ctx = c.getContext('2d')!
  const small = document.createElement('canvas')
  small.width = width
  small.height = height
  const sctx = small.getContext('2d')!
  const img = sctx.createImageData(width, height)
  for (let i = 0; i < width * height; i++) {
    const v = 255 - ink[i]
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v
    img.data[i * 4 + 3] = 255
  }
  sctx.putImageData(img, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(small, 0, 0, c.width, c.height)

  const { createWorker, PSM } = await import('tesseract.js')
  const base = `${import.meta.env.BASE_URL}ocr/`
  const abs = (p: string) => new URL(p, location.href).toString()
  const worker = await createWorker(['dan', 'eng'], 1, {
    workerPath: abs(`${base}worker.min.js`),
    corePath: abs(base),
    langPath: abs(base.replace(/\/$/, '')),
    gzip: true,
    cacheMethod: 'none',
    logger: (m) => m.status === 'recognizing text' && onProgress?.(m.progress),
  })
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      user_defined_dpi: '300',
      preserve_interword_spaces: '1',
    })
    const { data } = await worker.recognize(c, {}, { blocks: true, text: false })
    const lines: TextLine[] = []
    for (const b of data.blocks ?? [])
      for (const p of b.paragraphs)
        for (const l of p.lines) {
          const words = l.words.filter((w) => w.confidence > 30 && w.text.trim())
          if (!words.length) continue
          lines.push({
            str: words.map((w) => w.text).join(' '),
            x0: Math.min(...words.map((w) => w.bbox.x0)) / f,
            y0: Math.min(...words.map((w) => w.bbox.y0)) / f,
            x1: Math.max(...words.map((w) => w.bbox.x1)) / f,
            y1: Math.max(...words.map((w) => w.bbox.y1)) / f,
          })
        }
    return lines
  } finally {
    void worker.terminate()
  }
}

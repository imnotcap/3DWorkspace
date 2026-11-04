import { uid, type PartPrompt, type Segment, type Segmentation } from '@/store/workspace'
import { area, base64ToBlob, bounds, decodeMask, encodeMask, partColor, subtract, union, type MaskData } from './masks'

/** /segment and /segment_points answers (worker/sam3d/masks.py). */
export interface SegmentResponse {
  width: number
  height: number
  object: { label: string; score: number; mask: string; area: number; bbox: [number, number, number, number] }
  parts: { label: string; group: string | null; score: number; area: number; bbox: [number, number, number, number]; mask: string }[]
}
export interface PointsResponse {
  width: number
  height: number
  score: number
  area: number
  bbox: [number, number, number, number]
  mask: string
}

const MIN_AREA = 64

export function fromResponse(res: SegmentResponse, imageId: string, size: { width: number; height: number }, prompt: Segmentation['prompt']): Segmentation {
  if (res.width !== size.width || res.height !== size.height)
    throw new Error(`The server read the photo as ${res.width}×${res.height}, not ${size.width}×${size.height}.`)
  return {
    imageId,
    width: res.width,
    height: res.height,
    objectLabel: res.object.label,
    prompt,
    edited: false,
    segments: res.parts.map((p, i) => ({
      id: uid(),
      name: p.label,
      group: p.group,
      color: partColor(i),
      mask: base64ToBlob(p.mask),
      area: p.area,
      bbox: p.bbox,
      enabled: true,
    })),
  }
}

async function rebuild(seg: Segmentation, list: { s: Segment; m: MaskData; changed: boolean }[]): Promise<Segmentation> {
  const segments: Segment[] = []
  for (const { s, m, changed } of list) {
    const a = area(m)
    if (a < MIN_AREA) continue // swallowed by another part
    segments.push(changed ? { ...s, mask: await encodeMask(m), area: a, bbox: bounds(m) } : s)
  }
  return { ...seg, edited: true, segments }
}

/** A part you clicked: it takes its pixels from whichever parts had them, so parts never overlap. */
export async function addPart(seg: Segmentation, mask: MaskData, name: string): Promise<Segmentation> {
  if (mask.width !== seg.width || mask.height !== seg.height) throw new Error('The new part does not match the photo size.')
  const decoded = await Promise.all(seg.segments.map(async (s) => ({ s, m: subtract(await decodeMask(s.mask), mask), changed: true })))
  const used = new Set(seg.segments.map((s) => s.color))
  const color = Array.from({ length: 12 }, (_, i) => partColor(i)).find((c) => !used.has(c)) ?? partColor(seg.segments.length)
  const added: Segment = { id: uid(), name, group: null, color, mask: await encodeMask(mask), area: area(mask), bbox: bounds(mask), enabled: true }
  return rebuild(seg, [...decoded, { s: added, m: mask, changed: false }])
}

/** Several parts become one (the first keeps its name and colour). */
export async function mergeParts(seg: Segmentation, ids: string[]): Promise<Segmentation> {
  const picked = seg.segments.filter((s) => ids.includes(s.id))
  if (picked.length < 2) return seg
  let m = await decodeMask(picked[0].mask)
  for (const s of picked.slice(1)) m = union(m, await decodeMask(s.mask))
  const merged: Segment = { ...picked[0], group: null, mask: await encodeMask(m), area: area(m), bbox: bounds(m) }
  return { ...seg, edited: true, segments: seg.segments.filter((s) => s === picked[0] || !ids.includes(s.id)).map((s) => (s === picked[0] ? merged : s)) }
}

/** Same request as last time? (Otherwise unedited parts are found again before building.) */
export function samePrompt(a: Segmentation['prompt'], b: PartPrompt & { auto: boolean }) {
  const norm = (t: string) => t.trim().toLowerCase().replace(/\s*,\s*/g, ',')
  return norm(a.object) === norm(b.object) && norm(a.parts) === norm(b.parts) && a.auto === b.auto
}

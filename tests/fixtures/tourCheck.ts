// Runs in the browser (scripts/test-tour.mjs): auto tours of the templates, checked frame by frame.
// The camera must always move the way it looks (never backwards or sideways) and turn smoothly.
import { TEMPLATES } from '../../src/plan/templates.ts'
import { autoTour, tourDistance, tourDoorCrossings, tourDoorsAt, tourFrames, tourPath, tourPose } from '../../src/plan/tour.ts'
import { wallFrame } from '../../src/plan/geometry.ts'

export function run() {
  const out: { id: string; points: number; seconds: number; backward: number; sideways: number; maxYawRate: number; maxYawAccel: number; doors: number; doorClips: number; shutPasses: number }[] = []
  for (const t of TEMPLATES) {
    const b = t.build() as never as { walls: unknown[]; levels: { id: string }[]; tour: object }
    if (!b.walls.length) continue
    const p = { ...b, objects: [] } as never as Parameters<typeof autoTour>[0]
    let n = 0
    const tour = autoTour(p, p.levels[0].id, () => String(n++))
    p.tour = { ...p.tour, points: tour.points }
    const fps = 30
    const F = tourFrames(p, fps)
    const path = tourPath(p)
    let backward = 0
    let sideways = 0
    let maxYawRate = 0
    let maxYawAccel = 0
    let prevA: number | null = null
    let prevRate: number | null = null
    let prevPos: number[] | null = null
    // Doors: where each leaf hinges and how wide it is.
    const crossings = tourDoorCrossings(p, path)
    const leaves = p.openings.flatMap((o) => {
      if (!crossings.some((c) => c.id === o.id) || o.kind === 'sliding-door') return []
      const w = p.walls.find((x) => x.id === o.wallId)!
      const at = (t: number) => wallFrame(w, t).p
      const lw = o.kind === 'door' ? o.width : o.width / 2
      const ends = o.kind === 'door' ? [o.hinge === 'a' ? o.t - o.width / 2 : o.t + o.width / 2] : [o.t - o.width / 2, o.t + o.width / 2]
      return ends.map((t) => ({ id: o.id, hinge: at(t), r: lw }))
    })
    let doorClips = 0
    let shutPasses = 0
    for (let f = 0; f < F; f++) {
      const pose = tourPose(p, f, fps, path)
      {
        const sp = Math.sin(pose.polar)
        const eye = [pose.target[0] + sp * Math.sin(pose.azimuth), pose.target[2] + sp * Math.cos(pose.azimuth)]
        const open = tourDoorsAt(crossings, tourDistance(p, f, fps, path))
        for (const l of leaves) {
          const v = open.get(l.id) ?? 0
          // Inside the sweep of a leaf that is still moving: it would pass through the camera.
          if (Math.hypot(eye[0] - l.hinge[0], eye[1] - l.hinge[1]) < l.r + 0.15 && v > 0.001 && v < 0.999) doorClips++
        }
        for (const c of crossings) if (Math.abs(tourDistance(p, f, fps, path) - c.s) < 0.05 && (open.get(c.id) ?? 0) < 0.999) shutPasses++
      }
      const fwd = [-Math.sin(pose.azimuth), -Math.cos(pose.azimuth)]
      // The eye: the orbit target minus the view direction (radius 1).
      const sp = Math.sin(pose.polar)
      const pos = [pose.target[0] + sp * Math.sin(pose.azimuth), pose.target[1] + Math.cos(pose.polar), pose.target[2] + sp * Math.cos(pose.azimuth)]
      if (prevPos) {
        const v = [pos[0] - prevPos[0], pos[2] - prevPos[2]]
        const l = Math.hypot(v[0], v[1])
        if (l > 2e-3) {
          const c = (v[0] * fwd[0] + v[1] * fwd[1]) / l
          if (c < 0) backward++
          else if (c < Math.cos((75 * Math.PI) / 180)) {
            sideways++
          }
        }
      }
      if (prevA !== null) {
        let d = pose.azimuth - prevA
        while (d > Math.PI) d -= 2 * Math.PI
        while (d < -Math.PI) d += 2 * Math.PI
        const rate = (Math.abs(d) * fps * 180) / Math.PI
        maxYawRate = Math.max(maxYawRate, rate)
        if (prevRate !== null) maxYawAccel = Math.max(maxYawAccel, Math.abs(rate - prevRate) * fps)
        prevRate = rate
      }
      prevA = pose.azimuth
      prevPos = pos
    }
    out.push({ id: t.id, points: tour.points.length, seconds: Math.round(F / fps), backward, sideways, maxYawRate: Math.round(maxYawRate), maxYawAccel: Math.round(maxYawAccel), doors: crossings.length, doorClips, shutPasses })
  }
  return out
}

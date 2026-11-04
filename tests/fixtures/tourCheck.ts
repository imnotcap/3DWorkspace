// Runs in the browser (scripts/test-tour.mjs): auto tours of the templates, checked frame by frame.
// The camera must always move the way it looks (never backwards or sideways) and turn smoothly.
import { TEMPLATES } from '../../src/plan/templates.ts'
import { autoTour, tourFrames, tourPath, tourPose } from '../../src/plan/tour.ts'

export function run() {
  const out: { id: string; points: number; seconds: number; backward: number; sideways: number; maxYawRate: number; maxYawAccel: number }[] = []
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
    for (let f = 0; f < F; f++) {
      const pose = tourPose(p, f, fps, path)
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
    out.push({ id: t.id, points: tour.points.length, seconds: Math.round(F / fps), backward, sideways, maxYawRate: Math.round(maxYawRate), maxYawAccel: Math.round(maxYawAccel) })
  }
  return out
}

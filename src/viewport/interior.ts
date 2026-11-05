// Daylight inside a closed house (real-time view). The sky's image-based light reaches everywhere
// regardless of walls and ceilings, so with the ceilings on it is turned well down, and the daylight
// comes in through the windows instead: the sun through the glass (shadow-mapped, ceilings and walls
// block it) and the sky as a soft area light in each window opening, facing into the room.
// The path tracer needs none of this (it traces the real light), so these lights stay off there.
import { RectAreaLight } from 'three'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
import type { WindowPortal } from '@/plan/build'
import type { Ambience } from '@/store/workspace'

/** Share of the sky's ambient light left inside a closed house (a stand-in for light bouncing about). */
export const INTERIOR_ENV = 0.22

/** Sky seen through a window: colour and brightness (per m² of window). */
const SKY: Record<Ambience, { color: string; intensity: number }> = {
  day: { color: '#e4ecf6', intensity: 5 },
  evening: { color: '#ffc9a0', intensity: 2 },
  night: { color: '#4a5a80', intensity: 0.05 },
}

let ready = false

/** One area light per window opening, its light going into the room. */
export function portalLights(portals: WindowPortal[], ambience: Ambience): RectAreaLight[] {
  if (!ready) {
    RectAreaLightUniformsLib.init()
    ready = true
  }
  const sky = SKY[ambience]
  return portals.map((p) => {
    const l = new RectAreaLight(sky.color, sky.intensity, p.w, p.h)
    l.name = 'window daylight'
    l.userData.portal = true
    l.position.set(p.c[0], p.c[1], p.c[2])
    l.lookAt(p.c[0] + p.n[0], p.c[1], p.c[2] + p.n[1])
    l.visible = false
    return l
  })
}

/** Show or hide the window lights in a subtree. */
export function setPortals(root: { traverse: (f: (o: { userData: Record<string, unknown>; visible: boolean }) => void) => void }, on: boolean) {
  root.traverse((o) => {
    if (o.userData.portal) o.visible = on
  })
}

// House plan data. Plan coordinates are metres: x → world X, y → world Z (y grows towards the viewer / down on screen).

export type Vec2 = [number, number]

/** A surface finish: a colour, optionally on a material from the library (oak floor, tiles…). */
export interface Finish {
  color: string
  preset?: string
}

export interface Level {
  id: string
  name: string
  /** Height of this floor's top surface above ground (m). */
  elevation: number
  /** Floor-to-ceiling height (m). */
  height: number
  /** Floor slab thickness under this level (m). */
  slab: number
}

export interface Wall {
  id: string
  levelId: string
  a: Vec2
  b: Vec2
  thickness: number
  /** Overrides the level's ceiling height (half-height walls, railings). */
  height?: number
  /** Accent paint for one whole side (left = left of a → b), over the rooms' wall colour. */
  paint?: { left?: Finish; right?: Finish }
  /**
   * Curved wall: how far the middle of the wall bows out from the straight line a → b, in metres
   * (positive = towards its left side). 0 or missing = straight. Half the length = a semicircle.
   */
  curve?: number
  /** Set on the short straight pieces a curved wall is built from (analysis only, never saved). */
  parentId?: string
  /** Where this piece starts along its curved wall (arc length, m). */
  s0?: number
  /** Length of the curved wall this piece covers (arc length, m). */
  sLen?: number
  /** Centre of the curved wall's circle (for smooth shading). */
  centre?: Vec2
}

export type OpeningKind = 'door' | 'double-door' | 'sliding-door' | 'window' | 'wide-window' | 'floor-window' | 'french-window' | 'archway'

export interface Opening {
  id: string
  wallId: string
  kind: OpeningKind
  /** Centre, in metres from the wall's start (a). */
  t: number
  width: number
  height: number
  /** Bottom of the opening above the floor (0 for doors). */
  sill: number
  /** Door hinges at the start (a) side or the end (b) side of the opening. */
  hinge: 'a' | 'b'
  /** The door swings to the wall's left or right side. */
  side: 'left' | 'right'
  /** How far the door/window is open in 3D, 0..1. */
  open: number
  frame: Finish
}

/** Wall panelling (wainscoting) styles. */
export type PanelStyle = 'none' | 'frames' | 'two-tier' | 'raised' | 'shaker' | 'tall-frames' | 'full-height' | 'beadboard' | 'board-batten'
/** Skirting board profiles. */
export type SkirtStyle = 'none' | 'flat' | 'classic' | 'ogee' | 'tall' | 'shadow'

/** Joinery along a room's walls: panels up to a rail, and skirting boards. */
export interface RoomTrim {
  panels: PanelStyle
  /** Top of the panelling (the rail), m above the floor. */
  panelHeight: number
  skirting: SkirtStyle
  skirtHeight: number
  /** Paint of the panels, rails and skirting. */
  color: string
}

export const DEFAULT_TRIM: RoomTrim = { panels: 'none', panelHeight: 0.9, skirting: 'flat', skirtHeight: 0.08, color: '#f4f2ee' }

/** Settings for a room the plan found; matched to it by a point inside it. */
export interface RoomInfo {
  id: string
  levelId: string
  anchor: Vec2
  name: string
  floor: Finish
  walls: Finish
  ceiling: Finish
  trim?: RoomTrim
  /** Exposed ceiling beams (rafters) across the room. */
  beams?: CeilingBeams
  /** The ceiling's height and shape (missing: flat at the floor's ceiling height). */
  roof?: RoomRoof
}

export const flatRoof = (height: number): RoomRoof => ({ shape: 'flat', height, ridge: height + 1.2, ridgeLong: true })

/** A room's ceiling: flat, sloping one way (lean-to), or pitched from a ridge (vaulted). */
export interface RoomRoof {
  shape: 'flat' | 'shed' | 'gable'
  /** Flat: the ceiling height. Sloping: the height at the low side(s) (eaves), m above the floor. */
  height: number
  /** Sloping: the height at the ridge (pitched) or the high side (lean-to). */
  ridge: number
  /** The ridge (or the slope's level lines) runs along the room's long side. */
  ridgeLong: boolean
  /** Lean-to: high on the other side. */
  flip?: boolean
}

export interface CeilingBeams {
  /** Centre to centre, m. */
  spacing: number
  width: number
  /** How far they hang below the ceiling, m. */
  depth: number
  color: string
  /** Run across the room's short side (usual) or along its long side. */
  across: boolean
}

export const DEFAULT_BEAMS: CeilingBeams = { spacing: 1.2, width: 0.1, depth: 0.16, color: '#f4f3f0', across: true }

export interface TourPoint {
  id: string
  levelId: string
  p: Vec2
}

export interface Tour {
  points: TourPoint[]
  /** Walking speed, m/s. */
  speed: number
  eyeHeight: number
  /** Lens, mm (full frame). */
  focal: number
  /** Show the ceilings while walking and in the video (default on). */
  ceilings?: boolean
}

export const OPENING_DEFAULTS: Record<OpeningKind, { label: string; width: number; height: number; sill: number; door: boolean }> = {
  door: { label: 'Door', width: 0.9, height: 2.1, sill: 0, door: true },
  'double-door': { label: 'Double door', width: 1.5, height: 2.1, sill: 0, door: true },
  'sliding-door': { label: 'Sliding door', width: 2.0, height: 2.15, sill: 0, door: true },
  archway: { label: 'Opening', width: 1.0, height: 2.1, sill: 0, door: true },
  window: { label: 'Window', width: 1.0, height: 1.3, sill: 0.9, door: false },
  'wide-window': { label: 'Wide window', width: 2.0, height: 1.4, sill: 0.8, door: false },
  'floor-window': { label: 'Floor window', width: 1.6, height: 2.2, sill: 0, door: false },
  'french-window': { label: 'French window', width: 1.4, height: 2.2, sill: 0, door: false },
}

/** Openings you draw by dragging along a wall (their width is up to you); the rest are placed with one click. */
export const DRAWN_KINDS: OpeningKind[] = ['window', 'wide-window', 'floor-window', 'sliding-door', 'archway']

export const DEFAULT_WALL_FINISH: Finish = { color: '#f2efe9' }
export const DEFAULT_FLOOR_FINISH: Finish = { color: '#c8a27a', preset: 'oak-floor' }
export const DEFAULT_CEILING_FINISH: Finish = { color: '#fbfaf8' }
export const EXTERIOR_FINISH: Finish = { color: '#e9e6e0' }

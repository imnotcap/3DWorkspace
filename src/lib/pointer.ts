import type { Vec2 } from '@/plan/types'

/** Where the pointer is on the plan (set by the plan editor), or null when it is elsewhere: pastes land there. */
export const planPointer: { p: Vec2 | null } = { p: null }

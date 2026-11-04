import { itemById, type CatalogItem } from '@/furniture/catalog'
import { presetById } from '@/viewport/materialPresets'
import { activeProject, useWorkspace, type MaterialOverride, type Vec3 } from '@/store/workspace'
import type { Vec2 } from './types'

/** Catalog slot defaults → per-surface material overrides the Object panel can edit. */
export function slotOverrides(item: CatalogItem): Record<string, MaterialOverride> | undefined {
  if (!item.slots) return undefined
  return Object.fromEntries(
    Object.entries(item.slots).map(([slot, f]) => {
      const p = presetById(f.preset)
      return [slot, { color: f.color, roughness: p?.roughness ?? 0.6, metalness: p?.metalness ?? 0, keepTexture: false, preset: f.preset }]
    }),
  )
}

/** Add a catalog piece to the active level at plan point `c`, facing `yaw`. */
export function placeItem(item: CatalogItem, c: Vec2, yaw: number) {
  const s = useWorkspace.getState()
  const p = activeProject(s)
  const idx = p.levels.findIndex((l) => l.id === p.activeLevelId)
  const level = p.levels[idx]
  let size: Vec3 = [...item.size]
  // Stairs reach the floor above.
  if (item.id === 'stairs') size = [size[0], level.height + (p.levels[idx + 1]?.slab ?? 0.25), size[2]]
  const y = item.mount === 'ceiling' ? level.height - size[1] : (item.y ?? 0)
  s.addObject({
    name: item.name,
    source: item.kind === 'model' ? `Catalog · ${item.model!.credit}` : 'Catalog',
    furniture: item.kind === 'parametric' ? { item: item.id, size } : undefined,
    modelFile: item.kind === 'model' ? item.model!.file : undefined,
    surfaces: slotOverrides(item),
    exact: true,
    transform: { position: [c[0], y, c[1]], rotation: [0, yaw, 0], scale: [1, 1, 1] },
  })
}

export { itemById }

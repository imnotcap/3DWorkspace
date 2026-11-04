import type { MaterialOverride } from '@/store/workspace'

export const MATERIAL_PRESETS: { name: string; m: Omit<MaterialOverride, 'keepTexture'> }[] = [
  { name: 'Powder-coat black', m: { color: '#151515', roughness: 0.55, metalness: 0.2 } },
  { name: 'Matte grey', m: { color: '#5d5f62', roughness: 0.8, metalness: 0 } },
  { name: 'Brushed aluminium', m: { color: '#c4c6c8', roughness: 0.32, metalness: 1 } },
  { name: 'Chrome', m: { color: '#f2f2f2', roughness: 0.05, metalness: 1 } },
  { name: 'White plastic', m: { color: '#e9e9e6', roughness: 0.42, metalness: 0 } },
  { name: 'Oak', m: { color: '#a77b4f', roughness: 0.6, metalness: 0 } },
  { name: 'Clay', m: { color: '#c9bfb2', roughness: 0.9, metalness: 0 } },
]

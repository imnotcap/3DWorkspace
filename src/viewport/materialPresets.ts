// Material library. Kept free of three.js so the UI can list it without the 3D chunk.

export type DetailTexture = 'oak' | 'walnut' | 'birch' | 'marble' | 'concrete' | 'brushed' | 'leather' | 'fabric' | 'powder' | 'planks' | 'tiles' | 'small-tiles' | 'terrazzo' | 'weave'

export interface MaterialPreset {
  id: string
  name: string
  category: 'Metal' | 'Coating' | 'Plastic' | 'Wood' | 'Stone' | 'Glass' | 'Fabric' | 'Floor'
  color: string
  roughness: number
  metalness: number
  clearcoat?: number
  transmission?: number
  ior?: number
  sheen?: number
  /** Procedural greyscale detail; the colour tints it. */
  texture?: DetailTexture
}

export const MATERIAL_LIBRARY: MaterialPreset[] = [
  { id: 'chrome', name: 'Chrome', category: 'Metal', color: '#f2f2f2', roughness: 0.05, metalness: 1 },
  { id: 'polished-steel', name: 'Polished steel', category: 'Metal', color: '#d4d6d8', roughness: 0.15, metalness: 1 },
  { id: 'brushed-alu', name: 'Brushed aluminium', category: 'Metal', color: '#c4c6c8', roughness: 0.32, metalness: 1, texture: 'brushed' },
  { id: 'brushed-steel', name: 'Brushed steel', category: 'Metal', color: '#a8abae', roughness: 0.35, metalness: 1, texture: 'brushed' },
  { id: 'black-anodised', name: 'Black anodised', category: 'Metal', color: '#2a2a2c', roughness: 0.35, metalness: 1 },
  { id: 'gold', name: 'Gold', category: 'Metal', color: '#e8c06a', roughness: 0.2, metalness: 1 },
  { id: 'brass', name: 'Brass', category: 'Metal', color: '#c9a45c', roughness: 0.3, metalness: 1 },
  { id: 'copper', name: 'Copper', category: 'Metal', color: '#d08a5f', roughness: 0.25, metalness: 1 },

  { id: 'powder-black', name: 'Black powder coat', category: 'Coating', color: '#151515', roughness: 0.55, metalness: 0.2, texture: 'powder' },
  { id: 'powder-anthracite', name: 'Anthracite powder coat', category: 'Coating', color: '#383e42', roughness: 0.55, metalness: 0.2, texture: 'powder' },
  { id: 'powder-white', name: 'White powder coat', category: 'Coating', color: '#eeeeec', roughness: 0.55, metalness: 0.1, texture: 'powder' },
  { id: 'gloss-paint', name: 'Gloss paint', category: 'Coating', color: '#a52019', roughness: 0.15, metalness: 0, clearcoat: 1 },
  { id: 'matte-paint', name: 'Matte paint', category: 'Coating', color: '#7d8a96', roughness: 0.85, metalness: 0 },
  { id: 'laminate', name: 'Laminate', category: 'Coating', color: '#4b4c4e', roughness: 0.6, metalness: 0 },
  { id: 'matte-white', name: 'Matte lacquer', category: 'Coating', color: '#ecebe7', roughness: 0.7, metalness: 0 },

  { id: 'glossy-plastic', name: 'Glossy plastic', category: 'Plastic', color: '#f4f4f2', roughness: 0.2, metalness: 0 },
  { id: 'matte-plastic', name: 'Matte plastic', category: 'Plastic', color: '#1e1e1e', roughness: 0.6, metalness: 0 },
  { id: 'rubber', name: 'Soft-touch rubber', category: 'Plastic', color: '#202020', roughness: 0.92, metalness: 0 },
  { id: 'ceramic', name: 'Glazed ceramic', category: 'Plastic', color: '#f7f7f5', roughness: 0.12, metalness: 0, clearcoat: 1 },

  { id: 'oak', name: 'Oak', category: 'Wood', color: '#c89a66', roughness: 0.6, metalness: 0, texture: 'oak' },
  { id: 'walnut', name: 'Walnut', category: 'Wood', color: '#6b4a33', roughness: 0.55, metalness: 0, texture: 'walnut' },
  { id: 'birch', name: 'Birch plywood', category: 'Wood', color: '#e2c9a1', roughness: 0.65, metalness: 0, texture: 'birch' },

  { id: 'marble', name: 'Marble', category: 'Stone', color: '#efefed', roughness: 0.25, metalness: 0, clearcoat: 0.3, texture: 'marble' },
  { id: 'concrete', name: 'Concrete', category: 'Stone', color: '#9a9a97', roughness: 0.9, metalness: 0, texture: 'concrete' },
  { id: 'quartz', name: 'Quartz worktop', category: 'Stone', color: '#e7e5e1', roughness: 0.28, metalness: 0, clearcoat: 0.4, texture: 'terrazzo' },

  { id: 'clear-glass', name: 'Clear glass', category: 'Glass', color: '#ffffff', roughness: 0.03, metalness: 0, transmission: 1, ior: 1.5 },
  { id: 'frosted-glass', name: 'Frosted glass', category: 'Glass', color: '#f4f6f8', roughness: 0.45, metalness: 0, transmission: 1, ior: 1.5 },

  { id: 'felt', name: 'Felt', category: 'Fabric', color: '#5d6066', roughness: 1, metalness: 0, sheen: 1, texture: 'fabric' },
  { id: 'leather', name: 'Leather', category: 'Fabric', color: '#3b2a20', roughness: 0.55, metalness: 0, texture: 'leather' },
  { id: 'linen', name: 'Linen', category: 'Fabric', color: '#b9b2a7', roughness: 0.92, metalness: 0, sheen: 0.4, texture: 'weave' },
  { id: 'velvet', name: 'Velvet', category: 'Fabric', color: '#8a6a52', roughness: 0.75, metalness: 0, sheen: 1, texture: 'fabric' },
  { id: 'wool', name: 'Wool', category: 'Fabric', color: '#cfc6b8', roughness: 1, metalness: 0, sheen: 0.6, texture: 'fabric' },
  { id: 'cotton', name: 'Cotton', category: 'Fabric', color: '#f4f2ee', roughness: 0.95, metalness: 0, sheen: 0.3, texture: 'weave' },

  { id: 'oak-floor', name: 'Oak planks', category: 'Floor', color: '#c8a27a', roughness: 0.55, metalness: 0, texture: 'planks' },
  { id: 'walnut-floor', name: 'Walnut planks', category: 'Floor', color: '#7a5538', roughness: 0.5, metalness: 0, texture: 'planks' },
  { id: 'grey-tile', name: 'Stone tiles', category: 'Floor', color: '#b9b7b2', roughness: 0.4, metalness: 0, texture: 'tiles' },
  { id: 'white-tile', name: 'White tiles', category: 'Floor', color: '#f1f1ef', roughness: 0.18, metalness: 0, clearcoat: 0.5, texture: 'small-tiles' },
  { id: 'terrazzo', name: 'Terrazzo', category: 'Floor', color: '#e7e3dc', roughness: 0.35, metalness: 0, texture: 'terrazzo' },
  { id: 'carpet', name: 'Carpet', category: 'Floor', color: '#9d958a', roughness: 1, metalness: 0, sheen: 0.5, texture: 'fabric' },
  { id: 'polished-concrete', name: 'Polished concrete', category: 'Floor', color: '#a7a6a2', roughness: 0.4, metalness: 0, texture: 'concrete' },
]

/** Interior paint colours for walls and ceilings. */
export const PAINT_COLORS: { name: string; hex: string }[] = [
  { name: 'Chalk white', hex: '#f2efe9' },
  { name: 'Pure white', hex: '#f8f8f6' },
  { name: 'Warm linen', hex: '#e8dfd0' },
  { name: 'Greige', hex: '#cfc7bb' },
  { name: 'Mushroom', hex: '#b3a698' },
  { name: 'Pale grey', hex: '#d9dad7' },
  { name: 'Stone grey', hex: '#a3a39d' },
  { name: 'Charcoal', hex: '#3f4245' },
  { name: 'Sage', hex: '#b5bfa6' },
  { name: 'Olive', hex: '#7d8261' },
  { name: 'Forest', hex: '#3b4f45' },
  { name: 'Duck egg', hex: '#b9cfcc' },
  { name: 'Powder blue', hex: '#b7c7d6' },
  { name: 'Navy', hex: '#2c3a52' },
  { name: 'Blush', hex: '#e3c4b9' },
  { name: 'Terracotta', hex: '#b86a4b' },
  { name: 'Ochre', hex: '#c99a45' },
  { name: 'Aubergine', hex: '#4e3542' },
]

export const presetById = (id?: string) => MATERIAL_LIBRARY.find((p) => p.id === id)

/** Standard colours (RAL-style names) for quick picking. */
export const COLOR_PALETTE: { name: string; hex: string }[] = [
  { name: 'Jet black · RAL 9005', hex: '#0a0a0a' },
  { name: 'Graphite · RAL 7024', hex: '#45494e' },
  { name: 'Anthracite · RAL 7016', hex: '#383e42' },
  { name: 'Window grey · RAL 7040', hex: '#9da1aa' },
  { name: 'Light grey · RAL 7035', hex: '#cbd0cc' },
  { name: 'Signal white · RAL 9003', hex: '#f4f4f4' },
  { name: 'Cream · RAL 9001', hex: '#e9e0d2' },
  { name: 'Oak', hex: '#c89a66' },
  { name: 'Walnut', hex: '#6b4a33' },
  { name: 'Signal red · RAL 3001', hex: '#a52019' },
  { name: 'Traffic orange · RAL 2009', hex: '#e75b12' },
  { name: 'Signal yellow · RAL 1003', hex: '#f9a900' },
  { name: 'Moss green · RAL 6005', hex: '#114232' },
  { name: 'Sky blue · RAL 5015', hex: '#2271b3' },
  { name: 'Navy · RAL 5003', hex: '#1e2a4a' },
  { name: 'Antique pink · RAL 3014', hex: '#d36e70' },
]

/** Legacy quick presets (kept for objects saved before the library). */
export const MATERIAL_PRESETS = MATERIAL_LIBRARY.map((p) => ({ name: p.name, m: { color: p.color, roughness: p.roughness, metalness: p.metalness } }))

// Furniture catalog (three.js-free, so panels can list it without loading 3D code).
import type { Vec3 } from '@/store/workspace'

export type Category = 'Living' | 'Dining' | 'Kitchen' | 'Bedroom' | 'Bathroom' | 'Office' | 'Lighting' | 'Decor' | 'Electrical' | 'Structure'
export const CATEGORIES: Category[] = ['Living', 'Dining', 'Kitchen', 'Bedroom', 'Bathroom', 'Office', 'Lighting', 'Decor', 'Electrical', 'Structure']

/** Default finish per material slot of a piece: a library preset and/or a colour. */
export type SlotDefaults = Record<string, { color: string; preset?: string }>

export interface CatalogItem {
  id: string
  name: string
  category: Category
  /** Width (x), height (y), depth (z) in metres; front faces +z. */
  size: Vec3
  /** Built from parameters (resizable to any size) or a photoreal model. */
  kind: 'parametric' | 'model'
  /** Where it goes: on the floor, hung on a wall at `y`, or from the ceiling. */
  mount: 'floor' | 'wall' | 'ceiling'
  /** Height of its bottom above the floor (wall cabinets, mirrors, TVs on a unit). */
  y?: number
  slots?: SlotDefaults
  /** Model file in public/models/ (fetched at build time) and its credit line. */
  model?: { file: string; credit: string; license: string }
  /** Short note in the catalog. */
  note?: string
  /**
   * Lamps: the bulb's default output. The light sits on the piece's glowing (emissive) parts, or at
   * `at` (fractions of its size: x and z from the centre, y from the bottom) when it has none.
   */
  light?: { lumens: number; kelvin: number; at?: Vec3 }
}

const W = (color: string, preset?: string) => ({ color, preset })
const OAK = W('#c89a66', 'oak')
const WALNUT = W('#6b4a33', 'walnut')
const LINEN = W('#b9b2a7', 'linen')
const WHITE = W('#f1efeb', 'matte-white')
const BLACK_METAL = W('#1c1c1c', 'powder-black')
const BRUSHED = W('#a8abae', 'brushed-steel')
const CERAMIC = W('#f7f7f5', 'ceramic')
const CHROME = W('#f2f2f2', 'chrome')

export const CATALOG: CatalogItem[] = [
  // Living
  { id: 'sofa', name: 'Sofa', category: 'Living', size: [2.2, 0.82, 0.95], kind: 'parametric', mount: 'floor', slots: { Fabric: LINEN, Legs: WALNUT }, note: 'Seats follow the width' },
  { id: 'loveseat', name: 'Loveseat', category: 'Living', size: [1.6, 0.82, 0.92], kind: 'parametric', mount: 'floor', slots: { Fabric: W('#6f7b74', 'linen'), Legs: WALNUT } },
  { id: 'armchair', name: 'Armchair', category: 'Living', size: [0.86, 0.8, 0.88], kind: 'parametric', mount: 'floor', slots: { Fabric: W('#8a6a52', 'velvet'), Legs: WALNUT } },
  { id: 'coffee-table', name: 'Coffee table', category: 'Living', size: [1.1, 0.4, 0.6], kind: 'parametric', mount: 'floor', slots: { Top: OAK, Frame: BLACK_METAL } },
  { id: 'side-table', name: 'Side table', category: 'Living', size: [0.45, 0.55, 0.45], kind: 'parametric', mount: 'floor', slots: { Top: WALNUT, Frame: BLACK_METAL } },
  { id: 'tv-unit', name: 'TV unit', category: 'Living', size: [1.8, 0.5, 0.42], kind: 'parametric', mount: 'floor', slots: { Body: WALNUT, Fronts: W('#ece8e1', 'matte-white'), Legs: BLACK_METAL } },
  { id: 'tv', name: 'TV 65"', category: 'Living', size: [1.45, 0.88, 0.25], kind: 'parametric', mount: 'floor', y: 0.5, slots: { Body: W('#151515', 'matte-plastic') }, note: 'Stands on a TV unit' },
  { id: 'bookshelf', name: 'Bookshelf', category: 'Living', size: [0.9, 1.9, 0.35], kind: 'parametric', mount: 'floor', slots: { Wood: OAK, Books: W('#b8a48c') } },
  { id: 'rug', name: 'Rug', category: 'Living', size: [2.4, 0.012, 1.7], kind: 'parametric', mount: 'floor', slots: { Rug: W('#cfc6b8', 'wool') } },
  { id: 'glam-sofa', name: 'Velvet sofa', category: 'Living', size: [2.1, 0.8, 1.0], kind: 'model', mount: 'floor', model: { file: 'GlamVelvetSofa.glb', credit: 'Eric Chadwick · Khronos glTF Sample Assets', license: 'CC BY 4.0' } },
  { id: 'leather-sofa', name: 'Wood & leather sofa', category: 'Living', size: [2.0, 0.9, 0.9], kind: 'model', mount: 'floor', model: { file: 'SheenWoodLeatherSofa.glb', credit: 'Eric Chadwick, Fran Calvente · Khronos glTF Sample Assets', license: 'CC BY 4.0' } },
  { id: 'sheen-chair', name: 'Velvet armchair', category: 'Living', size: [0.8, 0.8, 0.8], kind: 'model', mount: 'floor', model: { file: 'SheenChair.glb', credit: 'Eric Chadwick · Khronos glTF Sample Assets', license: 'CC0' } },
  { id: 'damask-chair', name: 'Damask chair', category: 'Living', size: [0.7, 1.0, 0.7], kind: 'model', mount: 'floor', model: { file: 'ChairDamaskPurplegold.glb', credit: 'Eric Chadwick · Khronos glTF Sample Assets', license: 'CC BY 4.0' } },
  { id: 'silk-pouf', name: 'Silk pouf', category: 'Living', size: [0.61, 0.2, 0.61], kind: 'model', mount: 'floor', model: { file: 'SpecularSilkPouf.glb', credit: 'Eric Chadwick · Khronos glTF Sample Assets', license: 'CC BY 4.0' } },

  // Dining
  { id: 'dining-table', name: 'Dining table', category: 'Dining', size: [1.8, 0.75, 0.9], kind: 'parametric', mount: 'floor', slots: { Top: OAK, Legs: OAK } },
  { id: 'round-table', name: 'Round table', category: 'Dining', size: [1.1, 0.75, 1.1], kind: 'parametric', mount: 'floor', slots: { Top: WALNUT, Legs: BLACK_METAL } },
  { id: 'dining-chair', name: 'Dining chair', category: 'Dining', size: [0.46, 0.84, 0.52], kind: 'parametric', mount: 'floor', slots: { Frame: OAK, Seat: W('#4e5a52', 'linen') } },
  { id: 'bar-stool', name: 'Bar stool', category: 'Dining', size: [0.42, 0.75, 0.42], kind: 'parametric', mount: 'floor', slots: { Seat: OAK, Frame: BLACK_METAL } },

  // Kitchen
  { id: 'base-cabinet', name: 'Base cabinet', category: 'Kitchen', size: [0.6, 0.9, 0.62], kind: 'parametric', mount: 'floor', slots: { Fronts: W('#e9e6df', 'matte-white'), Worktop: W('#e7e5e1', 'quartz'), Handles: BRUSHED, Body: WHITE } },
  { id: 'drawer-cabinet', name: 'Drawer cabinet', category: 'Kitchen', size: [0.6, 0.9, 0.62], kind: 'parametric', mount: 'floor', slots: { Fronts: W('#e9e6df', 'matte-white'), Worktop: W('#e7e5e1', 'quartz'), Handles: BRUSHED, Body: WHITE } },
  { id: 'sink-cabinet', name: 'Sink cabinet', category: 'Kitchen', size: [0.8, 0.9, 0.62], kind: 'parametric', mount: 'floor', slots: { Fronts: W('#e9e6df', 'matte-white'), Worktop: W('#e7e5e1', 'quartz'), Handles: BRUSHED, Body: WHITE, Sink: BRUSHED } },
  { id: 'hob-cabinet', name: 'Hob cabinet', category: 'Kitchen', size: [0.6, 0.9, 0.62], kind: 'parametric', mount: 'floor', slots: { Fronts: W('#e9e6df', 'matte-white'), Worktop: W('#e7e5e1', 'quartz'), Handles: BRUSHED, Body: WHITE } },
  { id: 'oven-tower', name: 'Oven tower', category: 'Kitchen', size: [0.6, 2.2, 0.62], kind: 'parametric', mount: 'floor', slots: { Fronts: W('#e9e6df', 'matte-white'), Handles: BRUSHED, Body: WHITE } },
  { id: 'fridge', name: 'Fridge freezer', category: 'Kitchen', size: [0.6, 1.86, 0.66], kind: 'parametric', mount: 'floor', slots: { Body: BRUSHED, Handles: BRUSHED } },
  { id: 'wall-cabinet', name: 'Wall cabinet', category: 'Kitchen', size: [0.6, 0.7, 0.35], kind: 'parametric', mount: 'wall', y: 1.45, slots: { Fronts: W('#e9e6df', 'matte-white'), Handles: BRUSHED, Body: WHITE } },
  { id: 'kitchen-island', name: 'Kitchen island', category: 'Kitchen', size: [1.8, 0.92, 1.0], kind: 'parametric', mount: 'floor', slots: { Fronts: W('#3d4a45', 'matte-paint'), Worktop: W('#e7e5e1', 'quartz'), Handles: BRUSHED, Body: WHITE } },
  { id: 'range-hood', name: 'Range hood', category: 'Kitchen', size: [0.6, 0.8, 0.5], kind: 'parametric', mount: 'wall', y: 1.55, slots: { Body: BRUSHED } },

  // Bedroom
  { id: 'bed-double', name: 'Double bed', category: 'Bedroom', size: [1.6, 1.05, 2.1], kind: 'parametric', mount: 'floor', slots: { Frame: W('#8d8577', 'linen'), Bedding: W('#f4f2ee', 'cotton'), Throw: W('#b07a5a', 'wool') } },
  { id: 'bed-single', name: 'Single bed', category: 'Bedroom', size: [0.9, 0.95, 2.05], kind: 'parametric', mount: 'floor', slots: { Frame: OAK, Bedding: W('#f4f2ee', 'cotton'), Throw: W('#5b6f86', 'wool') } },
  { id: 'nightstand', name: 'Nightstand', category: 'Bedroom', size: [0.5, 0.5, 0.4], kind: 'parametric', mount: 'floor', slots: { Body: OAK, Handles: BRUSHED } },
  { id: 'wardrobe', name: 'Wardrobe', category: 'Bedroom', size: [1.5, 2.2, 0.6], kind: 'parametric', mount: 'floor', slots: { Fronts: W('#e9e6df', 'matte-white'), Body: WHITE, Handles: BRUSHED }, note: 'Doors follow the width' },
  { id: 'dresser', name: 'Chest of drawers', category: 'Bedroom', size: [1.2, 0.8, 0.45], kind: 'parametric', mount: 'floor', slots: { Body: WALNUT, Handles: W('#c9a45c', 'brass') } },

  // Bathroom
  { id: 'bathtub', name: 'Bathtub', category: 'Bathroom', size: [1.7, 0.58, 0.75], kind: 'parametric', mount: 'floor', slots: { Ceramic: CERAMIC, Taps: CHROME } },
  { id: 'toilet', name: 'Toilet', category: 'Bathroom', size: [0.38, 0.8, 0.66], kind: 'parametric', mount: 'floor', slots: { Ceramic: CERAMIC, Taps: CHROME } },
  { id: 'vanity', name: 'Vanity with basin', category: 'Bathroom', size: [0.8, 0.86, 0.48], kind: 'parametric', mount: 'floor', slots: { Body: OAK, Ceramic: CERAMIC, Taps: CHROME } },
  { id: 'shower', name: 'Walk-in shower', category: 'Bathroom', size: [1.0, 2.0, 0.9], kind: 'parametric', mount: 'floor', slots: { Tray: CERAMIC, Taps: CHROME } },
  { id: 'mirror', name: 'Mirror', category: 'Bathroom', size: [0.6, 0.8, 0.03], kind: 'parametric', mount: 'wall', y: 1.1, slots: { Frame: BLACK_METAL } },

  // Office
  { id: 'desk', name: 'Desk', category: 'Office', size: [1.4, 0.75, 0.7], kind: 'parametric', mount: 'floor', slots: { Top: OAK, Frame: BLACK_METAL } },
  { id: 'office-chair', name: 'Office chair', category: 'Office', size: [0.66, 1.1, 0.66], kind: 'parametric', mount: 'floor', slots: { Fabric: W('#2c2f33', 'wool'), Frame: BLACK_METAL } },
  { id: 'screen-wall', name: 'Skærmvæg', category: 'Office', size: [1.0, 1.7, 0.45], kind: 'model', mount: 'floor', model: { file: 'own/Skaermvaeg_Eco_Pure.glb', credit: 'Eco Pure 1:1 · own model', license: 'Own' }, note: 'Eco Pure, 100 × 170 cm. The fabric is its own surface: pick any colour or material.' },
  { id: 'sit-stand-desk', name: 'Hævesænke bord', category: 'Office', size: [1.6, 0.745, 0.8], kind: 'model', mount: 'floor', model: { file: 'own/Haevesaenkebord_160x80.glb', credit: 'Sit-stand desk 160 × 80 · own model', license: 'Own' }, note: '160 × 80 cm, top at 74.5 cm. Black frame; the tabletop is its own surface.' },
  { id: 'wall-shelf', name: 'Wall shelf', category: 'Office', size: [0.9, 0.03, 0.24], kind: 'parametric', mount: 'wall', y: 1.5, slots: { Wood: OAK } },

  // Lighting
  { id: 'floor-lamp', name: 'Floor lamp', category: 'Lighting', size: [0.42, 1.6, 0.42], kind: 'parametric', mount: 'floor', slots: { Shade: W('#efe9de', 'linen'), Frame: W('#c9a45c', 'brass') }, light: { lumens: 1000, kelvin: 2700 } },
  { id: 'pendant', name: 'Pendant light', category: 'Lighting', size: [0.42, 0.7, 0.42], kind: 'parametric', mount: 'ceiling', slots: { Shade: BLACK_METAL }, light: { lumens: 900, kelvin: 2700 } },
  { id: 'barn-lamp', name: 'Barn pendant', category: 'Lighting', size: [0.19, 0.26, 0.23], kind: 'model', mount: 'ceiling', model: { file: 'AnisotropyBarnLamp.glb', credit: 'Eric Chadwick · Khronos glTF Sample Assets', license: 'CC BY 4.0' }, light: { lumens: 600, kelvin: 2400, at: [0, 0.25, 0] } },
  { id: 'arc-lamp', name: 'Arc floor lamp', category: 'Lighting', size: [1.13, 1.86, 0.72], kind: 'model', mount: 'floor', model: { file: 'LightsPunctualLamp.glb', credit: 'DGG · Khronos glTF Sample Assets', license: 'CC BY 4.0' }, light: { lumens: 1200, kelvin: 2700, at: [0.4, 0.85, 0] } },
  { id: 'iridescent-lamp', name: 'Iridescent table lamp', category: 'Lighting', size: [0.3, 0.48, 0.3], kind: 'model', mount: 'floor', model: { file: 'IridescenceLamp.glb', credit: 'Eric Chadwick · Khronos glTF Sample Assets', license: 'CC BY 4.0' }, light: { lumens: 400, kelvin: 2700, at: [0, 0.62, 0] } },

  // Decor
  { id: 'plant', name: 'Potted plant', category: 'Decor', size: [0.7, 0.84, 0.66], kind: 'model', mount: 'floor', model: { file: 'DiffuseTransmissionPlant.glb', credit: 'Eric Chadwick, Rico Cilliers · Khronos glTF Sample Assets', license: 'CC BY 4.0' } },
  { id: 'vase', name: 'Vase with flowers', category: 'Decor', size: [0.22, 0.2, 0.14], kind: 'model', mount: 'floor', model: { file: 'GlassVaseFlowers.glb', credit: 'Eric Chadwick, Rico Cilliers · Khronos glTF Sample Assets', license: 'CC0' } },
  { id: 'wall-art', name: 'Framed print', category: 'Decor', size: [0.9, 0.6, 0.03], kind: 'parametric', mount: 'wall', y: 1.35, slots: { Frame: W('#1c1c1c', 'powder-black') } },
  { id: 'curtains', name: 'Curtains', category: 'Decor', size: [1.8, 2.5, 0.12], kind: 'parametric', mount: 'wall', y: 0, slots: { Fabric: W('#e8e2d6', 'linen'), Rod: BLACK_METAL } },

  // Electrical: wall plates (centre heights as usually fitted: sockets 30 cm, switches 105 cm), radiators.
  { id: 'socket', name: 'Socket', category: 'Electrical', size: [0.085, 0.085, 0.012], kind: 'parametric', mount: 'wall', y: 0.2575, slots: { Plate: W('#f6f5f2', 'matte-white') }, note: 'Centre 30 cm above the floor' },
  { id: 'double-socket', name: 'Double socket', category: 'Electrical', size: [0.155, 0.085, 0.012], kind: 'parametric', mount: 'wall', y: 0.2575, slots: { Plate: W('#f6f5f2', 'matte-white') }, note: 'Centre 30 cm above the floor' },
  { id: 'switch', name: 'Light switch', category: 'Electrical', size: [0.085, 0.085, 0.011], kind: 'parametric', mount: 'wall', y: 1.0075, slots: { Plate: W('#f6f5f2', 'matte-white') }, note: 'Centre 105 cm, by the door handle' },
  { id: 'double-switch', name: 'Double switch', category: 'Electrical', size: [0.085, 0.085, 0.011], kind: 'parametric', mount: 'wall', y: 1.0075, slots: { Plate: W('#f6f5f2', 'matte-white') } },
  { id: 'data-socket', name: 'TV / data socket', category: 'Electrical', size: [0.085, 0.085, 0.012], kind: 'parametric', mount: 'wall', y: 0.2575, slots: { Plate: W('#f6f5f2', 'matte-white') } },
  { id: 'radiator', name: 'Panel radiator', category: 'Electrical', size: [1.0, 0.6, 0.1], kind: 'parametric', mount: 'wall', y: 0.15, slots: { Body: W('#f4f3f0', 'matte-white'), Valve: CHROME }, note: 'Wall panels are built around it' },

  // Structure
  { id: 'stairs', name: 'Straight stairs', category: 'Structure', size: [1.0, 2.85, 3.6], kind: 'parametric', mount: 'floor', slots: { Treads: OAK, Structure: WHITE, Rail: BLACK_METAL }, note: 'Cuts the floor above' },
]

export const itemById = (id?: string) => CATALOG.find((c) => c.id === id)

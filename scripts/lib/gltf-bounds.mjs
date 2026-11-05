// The size of a glTF model (metres, +Y up): its meshes' bounding box through the node hierarchy.
// Plain math, no three.js, so the build scripts stay light.

const mul = (a, b) => {
  const o = new Array(16).fill(0)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
  return o
}
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

/** Column-major matrix of a node (matrix, or translation · rotation · scale). */
export function nodeMatrix(n) {
  if (n.matrix) return n.matrix
  const [tx, ty, tz] = n.translation ?? [0, 0, 0]
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1]
  const [sx, sy, sz] = n.scale ?? [1, 1, 1]
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ]
}

/** [width, height, depth] of everything in the default scene. */
export function gltfSize(json) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  const visit = (i, parent) => {
    const n = json.nodes[i]
    const m = mul(parent, nodeMatrix(n))
    if (n.mesh !== undefined)
      for (const p of json.meshes[n.mesh].primitives) {
        const a = json.accessors[p.attributes.POSITION]
        if (!a?.min || !a?.max) continue
        for (let c = 0; c < 8; c++) {
          const v = [c & 1 ? a.max[0] : a.min[0], c & 2 ? a.max[1] : a.min[1], c & 4 ? a.max[2] : a.min[2]]
          for (let k = 0; k < 3; k++) {
            const w = m[k] * v[0] + m[4 + k] * v[1] + m[8 + k] * v[2] + m[12 + k]
            min[k] = Math.min(min[k], w)
            max[k] = Math.max(max[k], w)
          }
        }
      }
    for (const c of n.children ?? []) visit(c, m)
  }
  const scene = json.scenes?.[json.scene ?? 0]
  for (const i of scene?.nodes ?? json.nodes.map((_, k) => k)) visit(i, I)
  if (!Number.isFinite(min[0])) return null
  return [max[0] - min[0], max[1] - min[1], max[2] - min[2]].map((v) => Math.round(v * 1000) / 1000)
}

/** The app's catalog category for a model, from its Poly Haven categories and tags. */
export function categoryOf(cats, tags, name) {
  const words = new Set([...cats, ...tags, ...name.toLowerCase().split(/[^a-z]+/)].map((s) => String(s).toLowerCase()))
  const has = (...w) => w.some((x) => words.has(x))
  if (has('plant', 'plants', 'tree', 'flower', 'flowers', 'potted')) return 'Decor'
  if (has('lamp', 'light', 'lighting', 'chandelier', 'lantern')) return 'Lighting'
  if (has('bed', 'wardrobe', 'nightstand', 'dresser', 'bedroom')) return 'Bedroom'
  if (has('bathroom', 'toilet', 'sink', 'bathtub', 'shower')) return 'Bathroom'
  if (has('kitchen', 'appliance', 'appliances', 'stove', 'fridge', 'kettle', 'pan', 'pot', 'cookware')) return 'Kitchen'
  if (has('desk', 'office', 'computer', 'monitor', 'keyboard')) return 'Office'
  if (has('dining', 'table', 'tables', 'chair', 'chairs', 'stool')) return 'Dining'
  if (has('sofa', 'couch', 'armchair', 'seating', 'ottoman', 'bench', 'shelf', 'shelves', 'cabinet', 'bookshelf', 'tv')) return 'Living'
  if (has('outdoor', 'garden', 'nature', 'rock', 'rocks')) return 'Outdoor'
  return 'Decor'
}

// Renders one test wall with every panel style: a window with a radiator under it, a door, and the
// sockets and switches the auto-placer puts there (scripts/render-panels.mjs).
import { AmbientLight, Color, DirectionalLight, HemisphereLight, PerspectiveCamera, PointLight, Scene, WebGLRenderer, ACESFilmicToneMapping, SRGBColorSpace } from 'three'
import { buildLevel } from '../../src/plan/build.ts'
import { electricalFor } from '../../src/plan/electrical.ts'
import { analyse } from '../../src/plan/geometry.ts'
import { buildFurniture } from '../../src/furniture/build.ts'
import { footprint } from '../../src/plan/footprint.ts'
import type { CeilingBeams, Finish, Level, RoomRoof, Opening, PanelStyle, RoomInfo, SkirtStyle, Wall } from '../../src/plan/types.ts'
import type { SceneObject } from '../../src/store/workspace.ts'

const level: Level = { id: 'L', name: 'Test', elevation: 0, height: 2.6, slab: 0.25 }
const wall = (id: string, a: [number, number], b: [number, number]): Wall => ({ id, levelId: 'L', a, b, thickness: 0.2 })
const walls = [wall('w0', [0, 0], [5, 0]), wall('w1', [5, 0], [5, 3.5]), wall('w2', [5, 3.5], [0, 3.5]), wall('w3', [0, 3.5], [0, 0])]
const openings: Opening[] = [
  { id: 'o1', wallId: 'w0', kind: 'window', t: 1.5, width: 1.2, height: 1.3, sill: 0.9, hinge: 'a', side: 'left', open: 0, frame: { color: '#f4f2ee' } },
  { id: 'o3', wallId: 'w3', kind: 'window', t: 1.4, width: 1.0, height: 1.3, sill: 0.9, hinge: 'a', side: 'left', open: 0, frame: { color: '#f4f2ee' } },
  { id: 'o2', wallId: 'w0', kind: 'door', t: 3.9, width: 0.9, height: 2.1, sill: 0, hinge: 'a', side: 'left', open: 0.35, frame: { color: '#f4f2ee' } },
]
const radiator: SceneObject = {
  id: 'r',
  name: 'Radiator',
  furniture: { item: 'radiator', size: [1.0, 0.6, 0.1] },
  levelId: 'L',
  visible: true,
  renderable: true,
  source: 'test',
  shade: 'original',
  material: null,
  exact: true,
  transform: { position: [1.5, 0.15, 0.1 + 0.05 + 0.03], rotation: [0, 0, 0], scale: [1, 1, 1] },
}

export async function render(styles: { panels: PanelStyle; skirting: SkirtStyle; color: string; wall: string }[], w = 960, h = 560) {
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setSize(w, h)
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = ACESFilmicToneMapping
  const out: string[] = []
  for (const st of styles) {
    const room: RoomInfo = { id: 'room', levelId: 'L', anchor: [2.5, 1.75], name: 'Living room', floor: { color: '#c8a27a', preset: 'wf-massiv-eg' }, walls: { color: st.wall }, ceiling: { color: '#fbfaf8' }, trim: { panels: st.panels, panelHeight: 0.95, skirting: st.skirting, skirtHeight: st.skirting === 'tall' || st.skirting === 'ogee' ? 0.14 : 0.09, color: st.color } }
    const geom = analyse(walls)
    const sockets = electricalFor({ geom, face: geom.faces[0].index, info: room, level, openings, objects: [radiator] })
    const scene = new Scene()
    scene.background = new Color('#d8dde3')
    const built = buildLevel({ level, levelIndex: 0, walls, openings, rooms: [room], obstacles: [radiator].map((o) => ({ ...footprint(o), y0: 0.15, y1: 0.75 })) })
    built.group.traverse((o) => o.userData.ceiling && (o.visible = false))
    scene.add(built.group)
    for (const o of [radiator, ...(sockets as SceneObject[])]) {
      const g = buildFurniture(o.furniture!.item, o.furniture!.size)
      g.position.set(...o.transform.position)
      g.rotation.set(...o.transform.rotation)
      scene.add(g)
    }
    scene.add(new HemisphereLight('#ffffff', '#b9a48c', 1.6))
    scene.add(new AmbientLight('#ffffff', 0.4))
    const sun = new DirectionalLight('#fff4e6', 2.2)
    sun.position.set(-2, 4, 6)
    scene.add(sun)
    const cam = new PerspectiveCamera(52, w / h, 0.05, 50)
    cam.position.set(4.5, 1.4, 3.2)
    cam.lookAt(1.2, 0.85, 1.0)
    renderer.render(scene, cam)
    out.push(renderer.domElement.toDataURL('image/jpeg', 0.9))
    if (st === styles[0]) out.push(JSON.stringify(sockets.map((s) => ({ item: s.furniture!.item, x: +s.transform.position[0].toFixed(3), y: +(s.transform.position[1] + s.furniture!.size[1] / 2).toFixed(3), z: +s.transform.position[2].toFixed(3) }))))
  }
  renderer.dispose()
  return out
}

/** The same room seen from below: one ceiling finish (and beams) per image. */
export async function renderCeilings(list: { ceiling: Finish; beams?: CeilingBeams; roof?: RoomRoof; cam?: [number, number, number, number, number, number] }[], w = 960, h = 560) {
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setSize(w, h)
  renderer.outputColorSpace = SRGBColorSpace
  renderer.toneMapping = ACESFilmicToneMapping
  const out: string[] = []
  for (const it of list) {
    const room: RoomInfo = { id: 'room', levelId: 'L', anchor: [2.5, 1.75], name: 'Living room', floor: { color: '#c8a27a', preset: 'wf-massiv-eg' }, walls: { color: '#f2efe9' }, ceiling: it.ceiling, beams: it.beams, roof: it.roof }
    const scene = new Scene()
    scene.background = new Color('#d8dde3')
    const built = buildLevel({ level, levelIndex: 0, walls, openings, rooms: [room] })
    scene.add(built.group)
    scene.add(new HemisphereLight('#ffffff', '#c8b8a0', 1.3))
    scene.add(new AmbientLight('#ffffff', 0.25))
    const lamp = new PointLight('#fff2e0', 6, 0, 1.6)
    lamp.position.set(2.5, 1.2, 1.2)
    scene.add(lamp)
    const sun = new DirectionalLight('#fff4e6', 1.4)
    sun.position.set(-3, -1, 4)
    scene.add(sun)
    const cam = new PerspectiveCamera(60, w / h, 0.05, 50)
    const c = it.cam ?? [2.5, 1.3, 3.25, 2.5, 2.6, 0.6]
    cam.position.set(c[0], c[1], c[2])
    cam.lookAt(c[3], c[4], c[5])
    renderer.render(scene, cam)
    out.push(renderer.domElement.toDataURL('image/jpeg', 0.9))
  }
  renderer.dispose()
  return out
}

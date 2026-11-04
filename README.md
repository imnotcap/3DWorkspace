# 3D Workspace

A browser-based 3D workspace that turns reference photos into meshes. It is laid out like a DCC app: project tabs, an outliner, a tool strip, shading modes and an orientation gizmo. It's a static site that deploys to GitHub Pages.

## Stack

Vite · React 19 · TypeScript · Tailwind v4 · Motion · React Three Fiber + drei (three.js) · Zustand · react-resizable-panels

## Generation backends (all free)

| Backend | Where it runs | Notes |
| --- | --- | --- |
| **Hugging Face Space** (default) | Public Gradio Spaces on HF GPUs | No key needed. An optional HF token raises your quota. Presets: **TRELLIS.2 (default, MIT, PBR, up to 1536³ / 4K textures)**, Hunyuan3D-2.1, Hunyuan3D-2mv (multi-view, shape only), Hunyuan3D-2, TripoSR. Any Space id works. |
| **Photogrammetry** (exact) | `worker/photogrammetry/` on any computer (CPU) | Measures a real object from 30–80 photos with COLMAP + OpenMVS, then stands it upright and removes the floor. See [its README](worker/photogrammetry/README.md). |
| **Local GPU worker** | `worker/` on your own NVIDIA GPU | Best quality: multi-view geometry, then a texture painted from the Front photo. No queue. See [worker/README.md](worker/README.md). |

### Accuracy: which backend to use

- **Exact model of something you own:** use Photogrammetry, plus one real measurement under *Real size*.
- **Model from product photos only:** use TRELLIS.2, plus the full spec-sheet size (W × H × D) under *Real size*. Overall proportions come out exact; part details are the model's best guess.

**Real size (cm)** in the Inputs panel scales every new mesh in the project to exactly that box. You can also edit any object later under **Size (cm)** in the Object panel (N), with proportions locked or free. The scene is metric: 1 unit = 1 m, the grid has 10 cm cells and 1 m sections.

### Input photos

Each photo has a role:

- **Front**: a full view of the whole object (required). Textured models use only this one.
- **Back / Left / Right**: full side views, used by multi-view models.
- **Detail**: close-ups. Kept as reference and **never sent as a view**, because a multi-view model would treat a close-up as an entire side of the object.

The first photo you add becomes Front and the rest become Detail, until you tag them otherwise.

The HF adapter reads each Space's API at runtime and maps inputs by parameter name, so it doesn't break when a Space reorders its arguments. To skip the public queue, duplicate a Space into your own HF account and paste its id.

## Develop

```bash
npm install
npm run dev
```

## Deploy

Push to `main`. `.github/workflows/deploy.yml` builds and publishes to Pages. Enable it once under **Settings → Pages → Source: GitHub Actions**.

## Controls

| Input | Action |
| --- | --- |
| LMB / MMB drag | Orbit |
| Shift + drag, RMB drag | Pan |
| Wheel | Zoom to cursor |
| Q / G / R / S | Select / Move / Rotate / Scale |
| F, Home | Frame selected, frame all |
| Z | Cycle shading (Wireframe → Solid → Material → Rendered) |
| N | Object properties |
| X / Delete | Delete |
| F12 | Render PNG (2×, no helpers) |
| ⌘/Ctrl + I, ⌘/Ctrl + E | Import GLB, export selected GLB |
| ⌘/Ctrl + Z, ⇧⌘/Ctrl + Z | Undo, redo (add, delete, transforms, shading, materials) |
| 0 / Ctrl + Alt + 0 | Camera view / align camera to view |
| Space, ← →, Shift + ← → | Play/pause, step frame, jump to start/end |
| I / Alt + I | Insert / delete keyframe (selected object, or the camera) |
| Ctrl + F12 | Render animation |
| Shift + N | New project tab |

Transform fields in the Object panel (N) are drag-to-scrub: drag to change, Shift for coarse, Alt for fine, click to type.

## Performance notes

- The canvas renders **on demand** (`frameloop="demand"`), so it uses no GPU while idle.
- The three.js and Gradio client chunks are lazy-loaded, so the shell paints first.
- Shading modes swap shared materials instead of cloning them. The environment is procedural (no HDRI download).
- The gizmo moves the three.js object directly. The store is only updated on release (one undo step).
- Raycasting uses `three-mesh-bvh`, built in idle time: picking a 1M-triangle mesh takes about 0.1 ms.
- Each model suspends and fails on its own. A broken file is flagged in the outliner without affecting the viewport.

## Rendering & animation

- **Render camera:** framed automatically (front three-quarter, slightly above, 50 mm), or set it from any view (Ctrl+Alt+0). Press **0** to look through it. Orbiting in camera view moves the camera itself.
- **Reference overlay:** fades the Front photo over the camera frame so you can match the photo's angle. *Match photo aspect* sets the output to the photo's proportions at 4K.
- **Resolution:** presets up to 4K UHD, square 4K and portrait 4K, or any custom size up to your GPU's limit. Optional transparent PNG.
- **Timeline:** keyframes for objects and the camera, Blender-style. Select an object and press **I** to key its location, rotation and scale at the current frame. With nothing selected, I keys the camera. Once an object has keys, moving, rotating or scaling it (gizmo or Object panel) updates the key at the current frame. Each animated object gets its own track. Per track (camera or each object), choose how keys blend: **Smooth** (ease in/out), **Linear** (constant speed) or **Hold** (no blending, jumps at each key; shown dashed). Playback (Space), and **Turntable**, which spins the selected object 360° (or orbits the camera) as a seamless loop.
- Automatic framing covers the objects across the whole animation, so the camera doesn't zoom as things move.
- **Render Animation (Ctrl+F12):** renders offline, frame by frame, at full output resolution, and encodes in the browser (WebCodecs: H.264 MP4, falling back to VP9/AV1/VP8). The output doesn't depend on viewport size or real-time FPS.
- Renders always use the final look (materials, shadows), whatever the viewport shading is.

## Mesh quality

- **Shading:** *Auto* (default) smooths surfaces but keeps hard edges above 30°, like Blender's Auto Smooth. It's computed in a Web Worker.
- **Materials:** override per object with presets (powder-coat black, aluminium, chrome, oak…) or custom colour, roughness and metallic. You can tint the generated texture instead.
- **Quality presets:** Draft → Ultra (octree 512). Higher means finer geometry, and slower generation that uses more GPU quota.

Generated meshes are as good as the open models behind them. Expect a convincing shape and texture from one good photo, not CAD-exact parts. Small features (buttons, engraved text) come from the texture, not the geometry.

## Persistence

Projects, meshes, transforms and input photos are saved to IndexedDB, so a reload restores your work. Settings (including the HF token) are kept in `localStorage`. Nothing leaves the browser except the images you send to the backend you picked.

## Credits

`src/components/reactbits/` contains ScrubField, CountUp and ShinyText from [React Bits](https://github.com/DavidHDev/react-bits) (MIT + Commons Clause, see the LICENSE in that folder).

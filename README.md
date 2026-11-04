# 3D Workspace · home planner

A browser app for planning interiors: draw the floor plan and the house builds itself in 3D (walls, doors, windows, floors, ceilings, several storeys). Paint walls, choose floors, furnish it from a catalog, walk through it on video, and export the whole design as a presentation PDF with 4K renders. It's a static site that deploys to GitHub Pages; projects are saved in your browser.

## Stack

Vite · React 19 · TypeScript · Tailwind v4 · Motion · React Three Fiber + drei (three.js) · Zustand · react-resizable-panels · jsPDF + svg2pdf.js

## Plan your home

The workspace shows the **plan** (2D), the **3D view**, or both side by side (**Split**). Everything you draw in the plan is built in 3D straight away.

| Tool | Key | What it does |
| --- | --- | --- |
| Select | V | Click walls, doors, windows, rooms and furniture. Drag a wall to move it (joined walls follow), drag its end points, drag doors and windows along their wall, drag furniture (it snaps back-first to walls; Alt moves freely) and rotate it with its handle. |
| Wall | W | Click corner to corner. Snaps to wall ends, onto walls (T-joints), to 15° angles, to the 5 cm grid and into line with other corners. Closing the loop or ending on a wall finishes; Esc or right-click stops. |
| Room | M | Drag a rectangle: four walls (sides that already have a wall are skipped). |
| Door | D | Door, double door, sliding door or plain opening, placed on the wall under the pointer and opening towards the side you click on. |
| Window | O | Window, wide window or French window. |
| Tour | T | Click to lay out a walkthrough path; **Auto tour** makes one through every room. |

- **Rooms are found automatically** from the walls: each enclosed space becomes a room with its floor area (inside the walls), name and finishes. Walls are mitred at corners and trimmed at T-joints; openings are cut exactly.
- **Floors:** add storeys with **+** next to the level tabs. Each floor has its own ceiling height; the floor above sits on its slab. The level below shows faintly in the plan for alignment, and **Straight stairs** from the catalog cut the opening in the floor above.
- **Inspector** (right): wall length, thickness and height (lower = half wall); door and window type, size, sill, hinge side, swing side and how far it stands open; room name; floor height.
- **Templates:** a furnished two-bedroom apartment, a two-storey house, or an empty plan.
- Undo/redo covers the plan, the furniture and the finishes.

## Paint and finishes

Select a room (click it in the plan or the 3D view) to set its **floor** (oak or walnut planks, stone or white tiles, terrazzo, carpet, polished concrete), **wall paint** (18 interior colours or any colour, or white tiles) and **ceiling**. Select a wall to give one side an accent colour, independent of the room. In 3D, every stretch of wall takes the paint of the room it faces.

## Furniture

The **Furniture** tab has about 50 pieces in 9 categories (living, dining, kitchen, bedroom, bathroom, office, lighting, decor, structure). Pick one and click in the plan: it lands against the nearest wall, facing into the room (R rotates, Shift keeps placing).

- **Parametric pieces** are built from their size, so you can type any width, height and depth in the Inspector and the piece is rebuilt to fit: a wider sofa gets more seat cushions, a wider wardrobe more doors, kitchen cabinets keep their plinth and worktop. Every material slot (fabric, legs, fronts, worktop, handles…) takes any finish from the library.
- **Photoreal pieces** (velvet and leather sofas, armchairs, a silk pouf, lamps, a plant, flowers) are production-quality models from the [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) (CC0 / CC BY 4.0, credited in the PDF). `npm run models` downloads them at build time.
- **Your own pieces:** import a .glb, or make one from a photo with SAM 3D (below).

## Walkthrough video

Make a tour in the **Tour** tool (or **Auto tour**: it walks from the front door through every room, opening the doors on its way). With *Camera: follows the tour* (Inspector), the render camera walks the path at eye height with a gentle start and stop; the timeline covers the whole walk. Press **0** and **Space** to watch it in the 3D view, **Ctrl+F12** to render it to MP4 at any resolution up to 4K. Speed, lens and eye height are in the Inspector.

## PDF export

**Export PDF** builds an A4 landscape presentation:

1. Cover: a 4K render of the whole home, its floor area, rooms, floors and number of pieces.
2. Per floor: the floor plan as vector graphics (walls, doors with swings, windows, furniture, room names and areas, dimensions, scale bar, north arrow) with a room schedule, then a 4K cutaway 3D view of that floor.
3. Per room: a 4K interior render from the corner that sees the most of it, its area and ceiling height, floor, wall and ceiling finishes as swatches, a key plan with the room highlighted, and the furniture in it.
4. Schedules: finishes, doors and windows (by type and size), and furniture (size, room, finishes); then credits.

## Furniture from a photo: Meta SAM 3D

In the **Photo → 3D** tab, a photo of a piece of furniture becomes an editable 3D model, built by Meta's **SAM 3** and **SAM 3D Objects** on your own SAM 3D server ([worker/sam3d](worker/sam3d/README.md): Docker on an NVIDIA GPU with 32 GB+, locally, on a rented GPU or as a Hugging Face Space).

1. **Front photo.** Add a photo of the object and tag it **Front** (the first photo is tagged Front automatically). Other photos stay as your reference; SAM 3D builds from one photo.
2. **What is it, and its parts.** Name the object ("office chair") and, optionally, its parts ("seat, backrest, armrest, wheel"). With no part names, SAM 3 finds the parts by itself (or, with *Find parts* off in Generate settings, the whole object is one part).
3. **Review parts** (optional). The part editor shows every part over the photo, with pixel-exact outlines. Click on the photo to add or correct a part (each click refines it; Shift/Alt-click excludes an area), merge parts, rename them, or leave some out. Parts never overlap and always cover the whole object, so nothing is built twice and nothing goes missing.
4. **Generate with SAM 3D.** Each part is built with its texture and its pose in the photo. All parts share the photo's camera and depth, so they come back already fitted together. The model is then stood upright (by its largest part's own up axis, or by the photo's horizon), set on the floor, and scaled to *Real size* if you entered it. The photo's camera becomes the default render angle.

If you change the object or part names before generating, the parts are found again, unless you edited them by hand (then your edits are kept).

### Editing a model part by part

A SAM 3D model is a tree: **model → groups → parts**. Repeated parts (four legs) are grouped in a folder.

- **Outliner:** open the model with its chevron to see its groups and parts. Click any row to select that piece, double-click to rename. Hiding a model or group hides everything in it.
- **Part dropdown** (Object panel, N): pick the whole model, a group or any single part.
- **Viewport:** the first click selects the whole model, each further click goes one level deeper (group, then part). Double-click goes straight to the part.
- Each part keeps its own location, rotation, scale, size, material, shading and keyframes, relative to its model, so moving the model moves all of its parts. Duplicating or deleting a model or group includes everything in it.
- **Take out of model** (Object panel, or the Object menu) makes a part a standalone object, exactly where it is.
- **Export Selected** exports a part where it sits in the scene; **Export Scene** keeps the model's part hierarchy.

### Accuracy

- SAM 3D estimates metric size from the photo's depth, so models come out roughly real size. For exact size, enter the spec-sheet dimensions under **Real size (cm)** before generating, or edit **Size (cm)** in the Object panel afterwards (whole model or any part).
- **Quality** (Generate settings): Draft, Standard (Meta's default steps), High and Ultra (more sampling steps and a baked texture). From Standard up, each part's pose is refined against the photo's depth so the parts line up.
- The same seed and photo give the same parts.

The scene is metric: 1 unit = 1 m, the grid has 10 cm cells and 1 m sections.

## Develop

```bash
npm install
npm run dev
```

Without a GPU, run the SAM 3D server in mock mode (stand-in models, same API) and leave **Server** at `http://localhost:7860`:

```bash
cd worker/sam3d && pip install -r requirements-dev.txt && MOCK=1 python app.py
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
| Shift + D | Duplicate selected object (a model or group with all its parts) |
| Click / double-click in the viewport | Select the model, then one level deeper per click / straight to the part |
| ⌘/Ctrl + Z, ⇧⌘/Ctrl + Z | Undo, redo (add, delete, transforms, shading, materials) |
| 0 / Ctrl + Alt + 0 | Camera view / align camera to view |
| Space, ← →, Shift + ← → | Play/pause, step frame, jump to start/end |
| I / Alt + I | Insert / delete keyframe (selected object, or the camera) |
| Ctrl + F12 | Render animation |
| Shift + N | New project tab |
| V / W / M / D / O / T | Plan tools: select, wall, room, door, window, tour |
| R (while placing furniture) | Rotate the piece 90° |
| Esc | Stop drawing or placing, then back to Select, then deselect |
| Wheel, middle/right drag (plan) | Zoom, pan |

Transform fields in the Object panel (N) are drag-to-scrub: drag to change, Shift for coarse, Alt for fine, click to type.

## Performance notes

- The canvas renders **on demand** (`frameloop="demand"`), so it uses no GPU while idle.
- The three.js, Gradio client and part editor chunks are lazy-loaded, so the shell paints first.
- Shading modes swap shared materials instead of cloning them. The environment is procedural (no HDRI download).
- The gizmo moves the three.js object directly. The store is only updated on release (one undo step).
- Raycasting uses `three-mesh-bvh`, built in idle time: picking a 1M-triangle mesh takes about 0.1 ms.
- Each model suspends and fails on its own. A broken file is flagged in the outliner without affecting the viewport.

## Modelling it yourself

No generator or quota needed:

- **Add → Box, Rounded box, Cylinder, Cone, Sphere, Capsule, Torus:** each is added at the origin, resting on the grid.
- **Shape (Object panel, N):** every parameter in cm (width, height, depth, radius, corner radius…). Drag to scrub, or click to type. Objects resting on the floor stay on it as they change height.
- **Transform:** G/R/S or the gizmo, or type Location, Rotation and Size. **Shift+D** duplicates.
- **Export Scene (.glb):** every visible object, with its materials, in one file.

Primitives get the same materials, keyframes, renders and undo as everything else. To fix one piece of a SAM 3D model by hand, take it out of the model and model a replacement next to it.

## Materials

The Object panel lists every surface of an object. With a SAM 3D model, select a part to give it its own material (the steel frame, the wooden top). Each surface gets a material from the library and a colour:

- **Library:** 26 presets in 7 categories (metals, powder coats and paints, plastics, wood, stone, glass, fabric), using physical properties: clearcoat, glass transmission, fabric sheen.
- **Textures:** CC0 PBR maps (colour, normal, roughness, metalness, AO) from [ambientCG](https://ambientcg.com), downloaded at build time by `npm run textures` (see `scripts/ambientcg.config.json`; pin an asset with `"id"`). Without them, each preset falls back to a procedural texture. Primitives get metric UVs, so a texture has the same real-world scale on every part.
- **Colour:** a palette of 16 standard colours (RAL-style) plus a custom picker. On textured materials, a colour you pick tints the texture.

## Tokens

This site has no keys of its own. A Hugging Face token is only needed if your SAM 3D server is a private Space:

- It is kept **in memory only** by default and is gone when you close the tab. *Remember on this device* stores it in the browser's localStorage. *Forget my keys* removes it.
- It is sent only to Hugging Face, never saved with projects or included in exports.
- The deploy workflow runs `npm run check:secrets`, which fails the build if anything resembling a key ends up in the published site.

## Rendering & animation

- **Render camera:** framed automatically (front three-quarter, slightly above, 50 mm), or set it from any view (Ctrl+Alt+0). Press **0** to look through it. Orbiting in camera view moves the camera itself.
- **Reference overlay:** fades the Front photo over the camera frame so you can match the photo's angle. *Match photo aspect* sets the output to the photo's proportions at 4K.
- **Resolution:** presets up to 4K UHD, square 4K and portrait 4K, or any custom size up to your GPU's limit. Optional transparent PNG.
- **Timeline:** keyframes for objects and the camera, Blender-style. Select an object and press **I** to key its location, rotation and scale at the current frame. With nothing selected, I keys the camera. Once an object has keys, moving, rotating or scaling it (gizmo or Object panel) updates the key at the current frame. Each animated object gets its own track. Per track (camera or each object), choose how keys blend: **Smooth** (ease in/out), **Linear** (constant speed) or **Hold** (no blending, jumps at each key; shown dashed). Playback (Space), and **Turntable**, which spins the selected object 360° (or orbits the camera) as a seamless loop.
- Automatic framing covers the objects across the whole animation, so the camera doesn't zoom as things move.
- **Render Animation (Ctrl+F12):** renders offline, frame by frame, at full output resolution, and encodes in the browser (WebCodecs: H.264 MP4, falling back to VP9/AV1/VP8). The output doesn't depend on viewport size or real-time FPS.
- Renders always use the final look (materials, shadows), whatever the viewport shading is.

## Mesh quality

- **Shading:** *Auto* (default) smooths surfaces but keeps hard edges above 30°, like Blender's Auto Smooth. It's computed in a Web Worker and keeps per-vertex colours.
- **Materials:** override per part with presets (powder-coat black, aluminium, chrome, oak…) or custom colour, roughness and metallic. You can tint the generated texture instead.

Generated meshes are as good as SAM 3D Objects makes them: a convincing shape and texture for each part, with occluded sides completed by the model. Small features (buttons, engraved text) come from the texture, not the geometry.

## Persistence

Projects, meshes, the part tree, transforms, input photos and part masks are saved to IndexedDB, so a reload restores your work. Settings are kept in `localStorage`. Nothing leaves the browser except the Front photo and part masks you send to your SAM 3D server.

## Credits

Photoreal furniture: [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) by Eric Chadwick, Fran Calvente, Rico Cilliers and DGG (CC0 / CC BY 4.0; each model's licence is listed in its catalog tooltip and in exported PDFs). Material textures: [ambientCG](https://ambientcg.com) (CC0).


`src/components/reactbits/` contains ScrubField, CountUp and ShinyText from [React Bits](https://github.com/DavidHDev/react-bits) (MIT + Commons Clause, see the LICENSE in that folder).

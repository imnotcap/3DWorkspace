# 3D Workspace · home planner

A browser app for planning interiors: draw the floor plan and the house builds itself in 3D (walls, doors, windows, floors, ceilings, several storeys). Paint walls, choose floors, furnish it from a catalog, light it with real lamps, walk through it on a path-traced 4K video, and export the whole design as a presentation PDF. It's a static site that deploys to GitHub Pages; projects are saved in your browser.

## Stack

Vite · React 19 · TypeScript · Tailwind v4 · Motion · React Three Fiber + drei (three.js) · three-gpu-pathtracer · Zustand · react-resizable-panels · jsPDF + svg2pdf.js

## Workspaces

The app opens on **Workspaces**: every project you have (with a plan preview, floor area and number of pieces), a blank plan, and the furnished templates. Open one to go to the planner; **Workspaces** at the top left goes back. Double-click a name to rename it.

## Plan your home

The workspace shows the **plan** (2D), the **3D view**, or both side by side (**Split**). Everything you draw in the plan is built in 3D straight away.

| Tool | Key | What it does |
| --- | --- | --- |
| Select | V | Click walls, doors, windows, rooms and furniture. Drag a wall to move it (joined walls follow), drag its end points, drag doors and windows along their wall, drag furniture (it snaps back-first to walls; Alt moves freely) and rotate it with its handle. |
| Wall | W | Click corner to corner. Snaps to wall ends, onto walls (T-joints), to 15° angles, to the 5 cm grid and into line with other corners. Closing the loop or ending on a wall finishes; Esc or right-click stops. |
| Room | M | Drag a rectangle: four walls (sides that already have a wall are skipped). |
| Curve | A | Click a corner, then another corner, pull the curve out and click: a curved wall. Between two corners of the same wall it bends that wall; across a corner (two walls) it replaces both with one smooth rounding. Snaps to a half circle; Shift is free. |
| Door | D | Door, double door, sliding door or plain opening, placed on the wall under the pointer and opening towards the side you click on. |
| Window | O | Window, wide window or French window. |
| Tour | T | Click to lay out a walkthrough path; **Auto tour** makes one through every room. |

- **Rooms are found automatically** from the walls: each enclosed space becomes a room with its floor area (inside the walls), name and finishes. Walls are mitred at corners and trimmed at T-joints; openings are cut exactly.
- **Floors:** add storeys with **+** next to the level tabs. Each floor has its own ceiling height; the floor above sits on its slab. The level below shows faintly in the plan for alignment, and **Straight stairs** from the catalog cut the opening in the floor above.
- **Curved walls:** select any wall and drag the round handle in its middle sideways to curve it (back to the line straightens it), or set **Curve** in the Inspector (Half circle, Straighten). Curved walls close rooms like straight ones and are smooth in 3D, with no facets. Windows placed on a curve follow it, as many as you like; doors sit flat across their opening.
- **Resize in the plan:** select a door or window and drag either end to make it wider or narrower; select a piece of furniture (or any model) and drag the handle on any side to change its width or depth, the opposite side stays put. The 3D view follows live.
- **Inspector** (right): wall length, thickness and height (lower = half wall); door and window type, size, sill, hinge side, swing side and how far it stands open; room name; floor height.
- **Templates:** a furnished two-bedroom apartment, a two-storey house, or an empty plan.
- Undo/redo covers the plan, the furniture and the finishes.

## Paint and finishes

Select a room (click it in the plan or the 3D view) to set its **floor** (oak or walnut planks, stone or white tiles, terrazzo, carpet, polished concrete), **wall paint** (18 interior colours or any colour, or white tiles) and **ceiling**. Select a wall to give one side an accent colour, independent of the room. In 3D, every stretch of wall takes the paint of the room it faces.

## Furniture

The **Furniture** tab has about 50 pieces in 9 categories (living, dining, kitchen, bedroom, bathroom, office, lighting, decor, structure). Pick one and click in the plan: it lands against the nearest wall, facing into the room (R rotates, Shift keeps placing).

- **Parametric pieces** are built from their size, so you can type any width, height and depth in the Inspector and the piece is rebuilt to fit: a wider sofa gets more seat cushions, a wider wardrobe more doors, kitchen cabinets keep their plinth and worktop. Every material slot (fabric, legs, fronts, worktop, handles…) takes any finish from the library.
- **Photoreal pieces** (velvet and leather sofas, armchairs, a silk pouf, lamps, a plant, flowers) are production-quality models from the [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) (CC0 / CC BY 4.0, credited in the PDF). `npm run models` downloads them at build time.
- **Previews:** every catalog card shows a rendered picture of the piece in its default finishes, so you see what you're placing.
- **Never inside a wall:** a piece can stand right against a wall or in a corner, but wherever it's moved, rotated, resized or loaded (and when a wall is moved into it) it is pushed the shortest way back out, so nothing flickers half inside a wall. Doorways and the space under a window sill let pieces through; rugs lie under everything.
- **Lamps give real light:** floor lamps, pendants and the lamp models light the room. Select one to switch it on or off, pick a bulb colour temperature (candle to daylight) or any colour, and set its brightness in lumens. Other pieces show their materials and colours per surface in the same panel.
- **Your own pieces:** import a .glb.

## Walkthrough video

Make a tour in the **Tour** tool (or **Auto tour**: it walks from the front door through every room, opening the doors on its way). The camera walks the path at eye height like a steadicam: a smooth curve through the points, a heading averaged over the next couple of metres so it turns into corners gently, and an eased start and stop. The **tour bar** under the view plays it (Space, sub-frame playback so it's smooth on any screen), scrubs it, sets 30 or 60 fps, and renders it: **Render tour** (Ctrl+F12) path traces every frame at the output resolution (4K by default) and encodes an MP4. Samples per frame, bounces and denoising are in the Render panel.

## PDF export

**Export PDF** builds an A4 landscape presentation:

1. Cover: a 4K render of the whole home, its floor area, rooms, floors and number of pieces.
2. Per floor: the floor plan as vector graphics (walls, doors with swings, windows, furniture, room names and areas, dimensions, scale bar, north arrow) with a room schedule, then a 4K cutaway 3D view of that floor.
3. Per room: a 4K interior render from the corner that sees the most of it, its area and ceiling height, floor, wall and ceiling finishes as swatches, a key plan with the room highlighted, and the furniture in it.
4. Schedules: finishes, doors and windows (by type and size), and furniture (size, room, finishes); then credits.

**Photos with ChatGPT (optional):** turn on *PDF photos* in the Render panel and paste an OpenAI API key. Each room's path-traced render is then sent to OpenAI's image model (`gpt-image-1` by default, the model behind ChatGPT's images) with a prompt describing the room, its finishes and its furniture, and comes back as a photograph of the same room. If a photo fails, that page keeps the render and the export says why. The key is kept in memory only (unless *Remember key*), goes only to api.openai.com, and is never saved with projects or exports; it uses your own OpenAI credits.

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
| Shift + D | Duplicate selected object (a model or group with all its parts) |
| Click / double-click in the viewport | Select the model, then one level deeper per click / straight to the part |
| ⌘/Ctrl + Z, ⇧⌘/Ctrl + Z | Undo, redo (add, delete, transforms, shading, materials) |
| 0 / Ctrl + Alt + 0 | Camera view / align camera to view |
| Space, Shift + ← → | Play/pause the tour, jump to its start/end |
| Ctrl + F12 | Render the tour video |
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
- The path tracer re-bakes the scene (BVH built in a Web Worker) only when something actually changed, and only after you stop dragging.
- Each model suspends and fails on its own. A broken file is flagged in the outliner without affecting the viewport.

## Modelling it yourself

No generator or quota needed:

- **Add → Box, Rounded box, Cylinder, Cone, Sphere, Capsule, Torus:** each is added at the origin, resting on the grid.
- **Shape (Object panel, N):** every parameter in cm (width, height, depth, radius, corner radius…). Drag to scrub, or click to type. Objects resting on the floor stay on it as they change height.
- **Transform:** G/R/S or the gizmo, or type Location, Rotation and Size. **Shift+D** duplicates.
- **Export Scene (.glb):** every visible object, with its materials, in one file.

Primitives get the same materials, renders and undo as everything else.

## Materials

The Object panel lists every surface of an object (a sofa's fabric and legs, a cabinet's fronts, worktop and handles). Each surface gets a material from the library and a colour:

- **Library:** 26 presets in 7 categories (metals, powder coats and paints, plastics, wood, stone, glass, fabric), using physical properties: clearcoat, glass transmission, fabric sheen.
- **Textures:** CC0 PBR maps (colour, normal, roughness, metalness, AO) from [ambientCG](https://ambientcg.com), downloaded at build time by `npm run textures` (see `scripts/ambientcg.config.json`; pin an asset with `"id"`). Without them, each preset falls back to a procedural texture. Primitives get metric UVs, so a texture has the same real-world scale on every part.
- **Colour:** a palette of 16 standard colours (RAL-style) plus a custom picker. On textured materials, a colour you pick tints the texture.

## Keys

This site has no keys of its own. The only key is yours, for the optional OpenAI PDF photos: it stays in memory unless you choose *Remember key*, and the deploy workflow runs `npm run check:secrets`, which fails the build if anything resembling a key ends up in the published site.

## Rendering: path tracing like Cycles

- **Rendered view (Z, last ball):** the viewport is path traced on the GPU (three-gpu-pathtracer), refining sample by sample like Cycles' viewport, with a sample counter at the top. Light bounces between surfaces, sun and sky come in through real glass, lamps cast soft pools of light, and bright bulbs and windows get a soft glare (bloom). While you orbit or edit, it shows the real-time render and picks up again as soon as you stop.
- **Engine** (Render panel): *Path tracing · Cycles* (default) or *Real-time · Eevee* for quick output. Samples for images, samples per video frame, viewport samples, bounces and denoise are all there.
- **Daylight:** Day, Evening (low warm sun) or Night (only your lamps): the sky, the sun and the view through the windows follow it, in the viewport and in every render.
- **Images (F12), tour videos (Ctrl+F12) and PDF pages** use the same engine at full output resolution, up to 4K and beyond, independent of the viewport's size. Big frames are traced in tiles. PDF pages are capped at 128 samples (denoised) so a whole presentation stays reasonable.
- **Render camera:** framed automatically or set from any view (Ctrl+Alt+0); **0** looks through it. With a tour, the camera walks the tour.
- Materials: physical (clearcoat, sheen, transmission). Glass in windows and showers is real refractive glass, so daylight passes through it in the path tracer.

## Persistence

Projects, meshes, transforms and lamp settings are saved to IndexedDB, so a reload restores your work. Settings are kept in `localStorage`. Nothing leaves the browser, except the room renders you choose to send to OpenAI for PDF photos.

## Credits

Photoreal furniture: [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets) by Eric Chadwick, Fran Calvente, Rico Cilliers and DGG (CC0 / CC BY 4.0; each model's licence is listed in its catalog tooltip and in exported PDFs). Material textures: [ambientCG](https://ambientcg.com) (CC0).


`src/components/reactbits/` contains ScrubField, CountUp and ShinyText from [React Bits](https://github.com/DavidHDev/react-bits) (MIT + Commons Clause, see the LICENSE in that folder).

# 3D Workspace

A browser-based 3D workspace that turns reference photos into meshes. It is laid out like a DCC app: project tabs, an outliner, a tool strip, shading modes and an orientation gizmo. It's a static site that deploys to GitHub Pages.

## Stack

Vite · React 19 · TypeScript · Tailwind v4 · Motion · React Three Fiber + drei (three.js) · Zustand · react-resizable-panels

## Generation backends (all free)

| Backend | Where it runs | Notes |
| --- | --- | --- |
| **Hugging Face Space** (default) | Public Gradio Spaces on HF GPUs | No key needed. An optional HF token raises your quota. Presets: Hunyuan3D-2mv (multi-view), Hunyuan3D-2, TripoSR. Any Space id works. |
| **Local GPU worker** | `worker/` on your own NVIDIA GPU | No queue. See [worker/README.md](worker/README.md). |

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
| Shift + N | New project tab |

## Performance notes

- The canvas renders **on demand** (`frameloop="demand"`), so it uses no GPU while idle.
- The three.js and Gradio client chunks are lazy-loaded, so the shell paints first.
- Shading modes swap shared materials instead of cloning them. The environment is procedural (no HDRI download).
- Viewport transforms are read imperatively, not through React state.

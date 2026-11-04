# Photogrammetry worker: exact models from real objects

Rebuilds an object from many photos using **COLMAP** and **OpenMVS** v2.4.0. Both are free and open source. The shape is *measured* from the photos, not guessed, so proportions, thicknesses and profiles come out as they really are.

It runs on CPU, so any computer with Docker works and no GPU is needed.

## Run

```bash
cd worker/photogrammetry
docker compose up --build
```

The first build compiles OpenMVS (about 10–20 min). After that, it starts instantly.

In the app, open **Generate settings → Backend → Photogrammetry · exact**. The default URL is `http://localhost:8001`.

## Shooting guide (this decides the quality)

1. **30–80 photos.** Walk all the way round at one height, then do a second, higher ring looking down. Overlap each shot with the previous one by about ⅔.
2. **Fill the frame.** The object should take up most of each photo. Keep the whole object in view, or overlap close-ups heavily.
3. **Light:** even and diffuse (overcast daylight or softboxes). Avoid hard shadows, flash, and moving lights.
4. **Keep it still and sharp.** Move the camera, not the object. No motion blur, and keep the focus fixed if you can.
5. **Background:** stand it on a plain floor or table with space around it. The worker detects that surface, stands the model upright on it, and cuts it away.
6. **Hard surfaces:** shiny, glass or plain black surfaces are hard for any photogrammetry. A light dusting of matte spray (or dry shampoo) works wonders.

## Exact size

Photos carry no units, so a scan has the right shape but an arbitrary scale. In the app, enter **one real measurement** (for example a width of 160 cm) under **Real size**, or later in the Object panel's **Size (cm)**. The other dimensions then follow exactly.

## Quality presets

| Preset | What changes | Rough time, estimated (40 photos, 8-core CPU) |
| --- | --- | --- |
| Draft | half-resolution dense cloud, no refinement | ~10 min |
| Standard | full dense cloud | ~20 min |
| High (default) | + surface refinement, full-resolution texture | ~35 min |
| Ultra | full-resolution dense cloud | 1 h+ |

## API

| Method | Path | Notes |
| --- | --- | --- |
| `POST` | `/jobs` | multipart `images[]` (at least 3), `quality` |
| `GET` | `/jobs/{id}` | `status`, `stage`, `progress` |
| `GET` | `/jobs/{id}/result` | `model/gltf-binary` |
| `DELETE` | `/jobs/{id}` | cancel |
| `GET` | `/health` | reports any missing tools |

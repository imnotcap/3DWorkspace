# SAM 3D server

Runs Meta's [SAM 3](https://github.com/facebookresearch/sam3) and [SAM 3D Objects](https://github.com/facebookresearch/sam-3d-objects) for 3D Workspace. The web app sends it the Front photo and gets back the object as separate parts, each already in its place.

1. **SAM 3** splits the photo into parts: from part names you give ("seat, backrest, wheel"), automatically, or from your clicks.
2. **SAM 3D Objects** builds every part (shape, texture, and its pose in the photo). All parts share the photo's camera and metric depth, so they fit together.
3. The app assembles them into one model with a part tree. You can open it, select any part or group, and move or edit it on its own.

## Requirements

- An NVIDIA GPU with **32 GB+ VRAM** (Meta's requirement for SAM 3D Objects), Linux, and a driver for CUDA 12.8.
- Docker with the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html).
- A Hugging Face token (`HF_TOKEN`) from an account that has been **granted access** to both gated repos: [facebook/sam-3d-objects](https://huggingface.co/facebook/sam-3d-objects) and [facebook/sam3](https://huggingface.co/facebook/sam3). Request access on each page first.

## Run

```bash
cd worker/sam3d
HF_TOKEN=hf_xxx docker compose up --build
```

The first build takes a while (it compiles PyTorch3D, gsplat and others). The first start downloads the weights into a Docker volume; later starts reuse them. The server is ready when http://localhost:7860 shows the API page.

In the app, open **Generate settings** and set **Server** to `http://localhost:7860` (the default).

To lock it to your deployed site, set `ALLOW_ORIGINS=https://<user>.github.io`. Chrome lets an https page call `http://localhost`; the server answers the Private Network Access preflight for it.

### On a rented GPU or a Hugging Face Space

The same image runs anywhere with a big enough NVIDIA GPU (RunPod, Lambda, a cloud VM). Expose port 7860 and put its URL in **Server**.

On Hugging Face, create a **Docker** Space on GPU hardware with 32 GB+ (for example L40S or A100), add this folder's files, set `HF_TOKEN` as a secret and `MODELS_DIR=/data` with persistent storage enabled, then put the Space id (`user/space`) in **Server**. For a private Space, also paste your token under **HF token**.

## Quality levels

| Level | SAM 3D sampling steps | Pose refinement | Surface |
| --- | --- | --- | --- |
| Draft | 12 / 12 | off | vertex colours |
| Standard | 25 / 25 (Meta's default) | on | vertex colours |
| High | 35 / 35 | on | baked 2K texture |
| Ultra | 50 / 50 | on | baked 4K texture, less simplification |

Pose refinement optimises each part's position against the photo's depth map, so parts line up with each other. If texture baking fails on your setup, the part falls back to vertex colours instead of failing.

## API

Gradio endpoints (use them with `@gradio/client` or `gradio_client`). Masks are base64 PNGs, white = part, the same size as the photo.

| Endpoint | Inputs | Output |
| --- | --- | --- |
| `/info` | | `{"backend": "sam3d" \| "mock"}` |
| `/segment` | `image`, `object_name`, `parts` (comma-separated), `auto` | The object split into parts. Parts never overlap and together cover the object exactly. Repeated parts (4 legs) come back as `Leg 1…4` in group `Leg`. |
| `/segment_points` | `image`, `points` (`[[x, y, 1\|0], …]`, 1 = include) | One mask from clicks. |
| `/reconstruct` | `image`, `mask`, `seed` (-1 = random), `quality` | Pose JSON and the part's GLB. `matrix` (row-major 4×4) takes GLB vertices into the photo's camera frame: OpenGL axes, metres, camera at the origin looking down −Z. |

`pose.py` documents and tests the conversion from SAM 3D's layout (PyTorch3D camera, row vectors, z-up local frame) to that matrix. GLBs are written with normals, non-metallic materials (glTF's default material is fully metallic) and linear vertex colours.

## Develop without a GPU

`MOCK=1` replaces both models with simple stand-ins (the object is whatever differs from the photo's corner colour). It goes through the same API, pose conversion and GLB export, so the whole app can be run and tested without a GPU.

```bash
pip install -r requirements-dev.txt
MOCK=1 python app.py          # http://localhost:7860
python -m pytest tests        # pose maths, part splitting, GLB export
```

# Local GPU worker

Runs open-weight [Hunyuan3D-2](https://github.com/Tencent/Hunyuan3D-2) on your own NVIDIA GPU, with no queues or quotas. The web app talks to it when **Generate settings → Backend** is set to **Local GPU worker**.

## Requirements

- NVIDIA GPU: about 16 GB VRAM for `mv` + texture, 10–12 GB for `mv` alone, 6 GB for `mini`
- Docker with the [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html)

## Run

```bash
cd worker
docker compose up --build          # multi-view model (default)
MODEL=mini docker compose up       # single-image, lighter
```

The first start downloads the weights into a Docker volume. Later starts are fast.

Check it's up at http://localhost:8000/health.

## Notes

- Best-quality path: multi-view geometry (front/back/left/right) from 2mv, then a color texture painted from the Front photo. The free Spaces can't combine those.
- Set `TEXTURE=0` to skip texturing (saves ~8 GB VRAM and about a minute).
- Images tagged **Detail** are never used, because a close-up isn't a view of the whole object.
- To lock CORS to your Pages site, set `ALLOW_ORIGINS=https://<user>.github.io`.
- `POST /generate` takes multipart `images[]`, `views[]`, `quality`, `remove_background` and `seed`, and returns `model/gltf-binary`.

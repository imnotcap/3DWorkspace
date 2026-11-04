"""
SAM 3D server for 3D Workspace: Meta's SAM 3 (segmentation) + SAM 3D Objects (3D), as a Gradio API.

The web app connects with @gradio/client, to http://localhost:7860 or to a Hugging Face
Space running this image. Endpoints (all JSON text in/out, masks as base64 PNG):

  /info            → {"backend", "quality_levels"}
  /segment         image, object, parts, auto → the object split into non-overlapping parts
  /segment_points  image, points             → one part from clicks
  /reconstruct     image, mask, seed, quality → (pose JSON, GLB file) for one part

Environment:
  MOCK=1           run without a GPU (stand-in models, for development and tests)
  SAM3D_ROOT       checkout of facebookresearch/sam-3d-objects (with checkpoints/hf)
  SEGMENTER_URL    the SAM 3 service (segmenter.py), default http://127.0.0.1:8001
  ALLOW_ORIGINS    comma-separated origins allowed to call this server, default *
  PORT             default 7860
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
import threading
import time
import urllib.error
import urllib.request

import gradio as gr
import numpy as np

import masks as M
import pose

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
log = logging.getLogger("app")

MOCK = os.getenv("MOCK", "0") == "1"
MAX_SIDE = 4096
SEGMENTER_URL = os.getenv("SEGMENTER_URL", "http://127.0.0.1:8001").rstrip("/")

if MOCK:
    from mock import MockReconstructor, MockSegmenter

    reconstructor = MockReconstructor()
    local_segmenter: M.Segmenter | None = MockSegmenter()
else:
    from reconstructor import SamReconstructor

    reconstructor = SamReconstructor(os.getenv("SAM3D_ROOT", "/opt/sam-3d-objects"))
    local_segmenter = None
gpu_lock = threading.Lock()


def _image(path: str | None) -> np.ndarray:
    if not path:
        raise gr.Error("No image was sent.")
    with open(path, "rb") as f:
        image = M.load_image(f.read())
    if max(image.shape[:2]) > MAX_SIDE:
        raise gr.Error(f"The photo is larger than {MAX_SIDE} px on its long side.")
    return image


def _segmenter_call(route: str, payload: dict) -> dict:
    """Forward to the SAM 3 process (separate Python environment)."""
    req = urllib.request.Request(f"{SEGMENTER_URL}{route}", data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=600) as res:
            return json.loads(res.read())
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read()).get("error", str(e))
        except Exception:  # noqa: BLE001
            msg = str(e)
        raise gr.Error(msg)
    except urllib.error.URLError as e:
        raise gr.Error(f"The SAM 3 segmenter isn't running ({e.reason}).")


def _parts_list(text: str) -> list[str]:
    return [p.strip() for p in text.replace("\n", ",").replace(";", ",").split(",") if p.strip()]


def info() -> str:
    return json.dumps({"backend": "mock" if MOCK else "sam3d", "models": ["SAM 3", "SAM 3D Objects"], "quality_levels": ["draft", "standard", "high", "ultra"]})


def segment(image: str, object_name: str, parts: str, auto: bool) -> str:
    """Split the object into non-overlapping parts that cover it completely."""
    img = _image(image)
    if local_segmenter is not None:
        try:
            out = M.segment_parts(local_segmenter, img, object_name or "", _parts_list(parts or ""), bool(auto))
        except (LookupError, ValueError) as e:
            raise gr.Error(str(e))
    else:
        out = _segmenter_call("/segment", {"image_path": image, "object": object_name or "", "parts": _parts_list(parts or ""), "auto": bool(auto)})
    return json.dumps(out)


def segment_points(image: str, points: str) -> str:
    """One part from clicks: [[x, y, 1|0], …] in image pixels (1 = include, 0 = exclude)."""
    img = _image(image)
    try:
        pts = [tuple(p) for p in json.loads(points or "[]")]
    except (ValueError, TypeError):
        raise gr.Error("Clicks must be a JSON list of [x, y, label].")
    if local_segmenter is not None:
        try:
            out = M.segment_points(local_segmenter, img, pts)
        except (LookupError, ValueError) as e:
            raise gr.Error(str(e))
    else:
        out = _segmenter_call("/points", {"image_path": image, "points": pts})
    return json.dumps(out)


def reconstruct(image: str, mask: str, seed: float, quality: str):
    """One part → (pose JSON, GLB). The pose matrix puts the GLB into the photo's camera frame."""
    img = _image(image)
    try:
        m = M.decode_mask(mask or "", img.shape[:2])
    except Exception as e:  # noqa: BLE001
        raise gr.Error(f"Bad mask: {e}")
    if m.sum() < 64:
        raise gr.Error("This part's mask is too small to reconstruct.")
    seed_i = int(seed) if seed is not None and seed >= 0 else int(np.random.randint(0, 2**31 - 1))
    out_path = os.path.join(tempfile.mkdtemp(prefix="sam3d_"), "part.glb")
    started = time.time()
    with gpu_lock:
        try:
            r = reconstructor.run(img, m, seed_i, quality or "standard", out_path)
        except gr.Error:
            raise
        except Exception as e:  # noqa: BLE001
            log.exception("reconstruct failed")
            raise gr.Error(f"SAM 3D failed on this part: {type(e).__name__}: {e}")
    rotation = np.asarray(pose.to_list(r["rotation"])).reshape(4)
    translation = np.asarray(pose.to_list(r["translation"])).reshape(3)
    scale = np.asarray(pose.to_list(r["scale"])).reshape(-1)
    matrix = pose.part_matrix(rotation, translation, scale)
    result = {
        # Row-major 4x4: GLB vertex (column vector) → OpenGL camera frame (metres, camera at origin looking down -Z).
        "matrix": matrix.tolist(),
        "rotation_wxyz": rotation.tolist(),
        "translation": translation.tolist(),
        "scale": scale.tolist(),
        "seed": seed_i,
        "quality": quality,
        "textured": bool(r.get("textured")),
        "layout_refined": bool(r.get("layout_refined")),
        "seconds": round(time.time() - started, 1),
    }
    return json.dumps(result), out_path


def build() -> gr.Blocks:
    with gr.Blocks(title="SAM 3D server", delete_cache=(6 * 3600, 3600)) as demo:
        gr.Markdown(f"## SAM 3D server for 3D Workspace\nBackend: **{'mock (no GPU)' if MOCK else 'SAM 3 + SAM 3D Objects'}**. This page is an API; use it from the 3D Workspace app.")
        image = gr.File(label="Photo", type="filepath")
        object_name = gr.Textbox(label="Object")
        parts = gr.Textbox(label="Parts (comma-separated)")
        auto = gr.Checkbox(label="Find parts automatically", value=True)
        points = gr.Textbox(label="Clicks JSON")
        mask = gr.Textbox(label="Mask (base64 PNG)")
        seed = gr.Number(label="Seed (-1 = random)", value=-1)
        quality = gr.Dropdown(["draft", "standard", "high", "ultra"], value="standard", label="Quality")
        out_json = gr.Textbox(label="Result")
        out_glb = gr.File(label="GLB")
        with gr.Row():
            b_info = gr.Button("Info")
            b_seg = gr.Button("Segment")
            b_pts = gr.Button("Segment clicks")
            b_rec = gr.Button("Reconstruct")
        b_info.click(info, [], out_json, api_name="info")
        b_seg.click(segment, [image, object_name, parts, auto], out_json, api_name="segment", concurrency_id="sam3", concurrency_limit=1)
        b_pts.click(segment_points, [image, points], out_json, api_name="segment_points", concurrency_id="sam3", concurrency_limit=1)
        b_rec.click(reconstruct, [image, mask, seed, quality], [out_json, out_glb], api_name="reconstruct", concurrency_id="sam3d", concurrency_limit=1)
    demo.queue(max_size=64)
    return demo


class OpenCORS:
    """Lets the hosted web app (another origin) call this server, including on localhost.

    Gradio only answers cross-origin requests to a localhost server from localhost pages.
    This wraps the whole app and allows the origins in ALLOW_ORIGINS, plus Chrome's
    Private Network Access preflight (an https page calling http://localhost)."""

    def __init__(self, app, origins: list[str]):
        self.app = app
        self.any = "*" in origins
        self.origins = set(origins)

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
        origin = headers.get("origin")
        if not origin or not (self.any or origin in self.origins):
            return await self.app(scope, receive, send)
        cors = [
            (b"access-control-allow-origin", origin.encode()),
            (b"access-control-allow-credentials", b"true"),
            (b"vary", b"Origin"),
        ]
        if scope["method"] == "OPTIONS" and "access-control-request-method" in headers:
            extra = [
                (b"access-control-allow-methods", b"GET, POST, PUT, DELETE, OPTIONS"),
                (b"access-control-allow-headers", headers.get("access-control-request-headers", "*").encode()),
                (b"access-control-max-age", b"600"),
            ]
            if headers.get("access-control-request-private-network") == "true":
                extra.append((b"access-control-allow-private-network", b"true"))
            await send({"type": "http.response.start", "status": 204, "headers": cors + extra})
            return await send({"type": "http.response.body", "body": b""})

        async def send_with_cors(message):
            if message["type"] == "http.response.start":
                drop = {k for k, _ in cors}
                message["headers"] = [(k, v) for k, v in message.get("headers", []) if k.lower() not in drop] + cors
            await send(message)

        return await self.app(scope, receive, send_with_cors)


def main():
    import uvicorn
    from fastapi import FastAPI

    demo = build()
    app = gr.mount_gradio_app(FastAPI(), demo, path="/")
    origins = [o.strip() for o in os.getenv("ALLOW_ORIGINS", "*").split(",") if o.strip()]
    uvicorn.run(OpenCORS(app, origins), host=os.getenv("HOST", "0.0.0.0"), port=int(os.getenv("PORT", "7860")))


if __name__ == "__main__":
    main()

"""
Local image-to-3D worker for 3D Workspace.

Contract (matches src/generation/providers/localWorker.ts):
  GET  /health   -> {"ok": true, "model": "..."}
  POST /generate -> multipart: images[] (files), views[] (auto|front|back|left|right),
                    quality (draft|standard|high), remove_background (bool), seed (int, optional)
                 <- model/gltf-binary

Runs Hunyuan3D-2 (open weights) through Tencent's `hy3dgen` package.
MODEL=mv   multi-view shape model (default, uses front/back/left/right)
MODEL=mini single-image, lighter (~6 GB VRAM)
TEXTURE=1  paint a color texture from the Front image (default; ~+8 GB VRAM, +1 min)

Images tagged "detail" are ignored: they are close-ups, not views of the whole object.
"""

from __future__ import annotations

import io
import os
import random
import tempfile
import threading

import torch
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from PIL import Image

from hy3dgen.rembg import BackgroundRemover
from hy3dgen.shapegen import (
    DegenerateFaceRemover,
    FaceReducer,
    FloaterRemover,
    Hunyuan3DDiTFlowMatchingPipeline,
)

MODEL = os.getenv("MODEL", "mv")
MODELS = {
    "mv": ("tencent/Hunyuan3D-2mv", "hunyuan3d-dit-v2-mv"),
    "mini": ("tencent/Hunyuan3D-2mini", "hunyuan3d-dit-v2-mini"),
}
QUALITY = {
    "draft": {"steps": 20, "octree": 192, "faces": 40_000},
    "standard": {"steps": 30, "octree": 256, "faces": 120_000},
    "high": {"steps": 50, "octree": 384, "faces": 300_000},
    "ultra": {"steps": 50, "octree": 512, "faces": 600_000},
}
TEXTURE = os.getenv("TEXTURE", "1") == "1"
VIEWS = ("front", "back", "left", "right")

repo, subfolder = MODELS[MODEL]
pipeline = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(repo, subfolder=subfolder, use_safetensors=True, device="cuda")
rembg = BackgroundRemover()
painter = None
if TEXTURE:
    from hy3dgen.texgen import Hunyuan3DPaintPipeline

    painter = Hunyuan3DPaintPipeline.from_pretrained("tencent/Hunyuan3D-2")
gpu_lock = threading.Lock()  # one job at a time on a single GPU

app = FastAPI(title="3D Workspace worker")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOW_ORIGINS", "*").split(","),
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.middleware("http")
async def private_network_access(request: Request, call_next):
    # Lets an https:// GitHub Pages site call http://localhost in Chromium.
    response = await call_next(request)
    if request.headers.get("access-control-request-private-network"):
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


@app.get("/health")
def health():
    return {"ok": True, "model": repo, "texture": TEXTURE}


def load(upload: UploadFile, remove_bg: bool) -> Image.Image:
    img = Image.open(io.BytesIO(upload.file.read())).convert("RGBA")
    return rembg(img.convert("RGB")) if remove_bg else img


@app.post("/generate")
def generate(
    images: list[UploadFile] = File(...),
    views: list[str] = Form(default=[]),
    quality: str = Form("standard"),
    remove_background: bool = Form(True),
    seed: int | None = Form(None),
):
    if not images:
        raise HTTPException(400, "No images")
    q = QUALITY.get(quality, QUALITY["standard"])
    tags = (views + ["detail"] * len(images))[: len(images)]
    slots: dict[str, Image.Image] = {}
    for upload, tag in zip(images, tags):
        if tag in VIEWS and tag not in slots:
            slots[tag] = load(upload, remove_background)
    if "front" not in slots:
        raise HTTPException(400, "Tag one image as Front")

    image_arg: object = slots if MODEL == "mv" else slots["front"]

    generator = torch.Generator("cuda").manual_seed(seed if seed is not None else random.randint(0, 2**31 - 1))
    with gpu_lock:
        mesh = pipeline(
            image=image_arg,
            num_inference_steps=q["steps"],
            octree_resolution=q["octree"],
            num_chunks=20000,
            generator=generator,
            output_type="trimesh",
        )[0]

    mesh = FloaterRemover()(mesh)
    mesh = DegenerateFaceRemover()(mesh)
    mesh = FaceReducer()(mesh, max_facenum=q["faces"])

    if painter is not None:
        with gpu_lock:
            mesh = painter(mesh, image=slots["front"])

    with tempfile.NamedTemporaryFile(suffix=".glb") as tmp:
        mesh.export(tmp.name)
        data = open(tmp.name, "rb").read()
    return Response(data, media_type="model/gltf-binary")

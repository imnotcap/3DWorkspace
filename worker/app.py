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
}

repo, subfolder = MODELS[MODEL]
pipeline = Hunyuan3DDiTFlowMatchingPipeline.from_pretrained(repo, subfolder=subfolder, use_safetensors=True, device="cuda")
rembg = BackgroundRemover()
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
    return {"ok": True, "model": repo}


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
    loaded = [load(f, remove_background) for f in images]
    tags = (views + ["auto"] * len(loaded))[: len(loaded)]

    if MODEL == "mv":
        slots: dict[str, Image.Image] = {}
        for img, tag in zip(loaded, tags):
            if tag in ("front", "back", "left", "right") and tag not in slots:
                slots[tag] = img
        for img, tag in zip(loaded, tags):
            if tag == "auto":
                free = next((v for v in ("front", "back", "left", "right") if v not in slots), None)
                if free:
                    slots[free] = img
        image_arg: object = slots
    else:
        image_arg = loaded[0]

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

    with tempfile.NamedTemporaryFile(suffix=".glb") as tmp:
        mesh.export(tmp.name)
        data = open(tmp.name, "rb").read()
    return Response(data, media_type="model/gltf-binary")

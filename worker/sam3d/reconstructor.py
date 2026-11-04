"""
SAM 3D Objects: one masked part of a photo → a textured mesh plus its pose in the photo's camera.

Wraps Meta's notebook/inference.py (the public inference API) and calls its pipeline with
explicit settings per quality level. Every part of one photo shares the same camera and the
same metric depth (MoGe), so the parts' poses fit together into the whole object.
"""

from __future__ import annotations

import logging
import os
import sys
from dataclasses import dataclass

import numpy as np

import glb

log = logging.getLogger("sam3d")


@dataclass(frozen=True)
class QualitySettings:
    stage1_steps: int  # sparse structure + layout (flow matching)
    stage2_steps: int  # structured latent (geometry detail + appearance)
    layout_refine: bool  # optimise the pose against the depth point map
    bake_texture: bool  # UV texture baked from the Gaussians (else per-vertex colour)
    texture_size: int
    simplify: float  # fraction of triangles removed when baking


QUALITY = {
    "draft": QualitySettings(12, 12, False, False, 1024, 0.95),
    "standard": QualitySettings(25, 25, True, False, 1024, 0.95),  # Meta's defaults + pose refinement
    "high": QualitySettings(35, 35, True, True, 2048, 0.9),
    "ultra": QualitySettings(50, 50, True, True, 4096, 0.75),
}


class SamReconstructor:
    def __init__(self, root: str, tag: str = "hf"):
        os.environ.setdefault("CONDA_PREFIX", sys.prefix)  # inference.py reads it for CUDA_HOME
        sys.path.insert(0, os.path.join(root, "notebook"))
        from inference import Inference  # type: ignore

        import torch

        self.torch = torch
        self.inference = Inference(os.path.join(root, "checkpoints", tag, "pipeline.yaml"), compile=False)
        self.pipeline = self.inference._pipeline
        from sam3d_objects.model.backbone.tdfy_dit.utils import postprocessing_utils  # type: ignore

        self.postprocessing = postprocessing_utils

    def run(self, image: np.ndarray, mask: np.ndarray, seed: int, quality: str, out_path: str) -> dict:
        q = QUALITY.get(quality, QUALITY["standard"])
        rgba = self.inference.merge_mask_to_rgba(image, mask)
        out = self.pipeline.run(
            rgba,
            None,
            seed,
            stage1_only=False,
            with_mesh_postprocess=False,
            with_texture_baking=False,
            with_layout_postprocess=q.layout_refine,
            use_vertex_color=True,
            stage1_inference_steps=q.stage1_steps,
            stage2_inference_steps=q.stage2_steps,
            pointmap=None,
        )
        mesh = out["glb"]  # dense mesh with per-vertex colour, y-up local frame
        textured = False
        if q.bake_texture:
            try:
                mesh = self.postprocessing.to_glb(
                    out["gaussian"][0],
                    out["mesh"][0],
                    simplify=q.simplify,
                    texture_size=q.texture_size,
                    verbose=False,
                    with_mesh_postprocess=True,
                    with_texture_baking=True,
                    use_vertex_color=False,
                    rendering_engine=self.pipeline.rendering_engine,
                )
                textured = True
            except Exception:  # noqa: BLE001 - fall back to the vertex-coloured mesh
                log.exception("Texture baking failed; using vertex colours")
        glb.export_part(mesh, out_path)
        result = {
            "rotation": out["rotation"],
            "translation": out["translation"],
            "scale": out["scale"],
            "textured": textured,
            "layout_refined": q.layout_refine,
        }
        del out
        if self.torch.cuda.is_available():
            self.torch.cuda.empty_cache()
        return result

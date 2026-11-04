"""
Stand-ins for SAM 3 and SAM 3D Objects, for running the app and its tests without a GPU
(MOCK=1). They implement the same interfaces as the real models, and the mock poses go
through the same conversion (pose.py) as real SAM 3D output.

Mock segmentation: the object is everything that differs from the photo's corner colour;
its connected pieces are its parts ("leg" → tall pieces, "top"/"seat" → wide pieces).
Mock reconstruction: a box the size of the part's mask, seen by a camera pitched down 20°.
"""

from __future__ import annotations

import math

import numpy as np
import trimesh
from scipy import ndimage

import glb
import pose

TALL = ("leg", "legs", "post", "stand")
WIDE = ("top", "tabletop", "seat", "shelf", "board")


class MockSegmenter:
    def prepare(self, image: np.ndarray):
        corners = np.stack([image[0, 0], image[0, -1], image[-1, 0], image[-1, -1]]).astype(np.int32)
        bg = np.median(corners, axis=0)
        fg = np.abs(image.astype(np.int32) - bg).sum(axis=-1) > 40
        labels, n = ndimage.label(fg)
        return {"fg": fg, "labels": labels, "n": n}

    def _pieces(self, h):
        out = []
        for i in range(1, h["n"] + 1):
            m = h["labels"] == i
            if m.sum() < 32:
                continue
            ys, xs = np.nonzero(m)
            out.append((m, xs.max() - xs.min() + 1, ys.max() - ys.min() + 1))
        return out

    def text(self, h, prompt: str):
        p = prompt.lower().strip()
        if any(w in p for w in TALL):
            return [(m, 0.9) for m, w, hh in self._pieces(h) if hh > w]
        if any(w in p for w in WIDE):
            return [(m, 0.92) for m, w, hh in self._pieces(h) if w >= hh]
        return [(h["fg"], 0.95)] if h["fg"].any() else []

    def points(self, h, points, multimask: bool):
        labels = h["labels"]
        hgt, wid = labels.shape
        sel = np.zeros_like(h["fg"])
        for x, y, l in points:
            k = labels[min(int(y), hgt - 1), min(int(x), wid - 1)]
            if k == 0:
                continue
            sel = (sel | (labels == k)) if l else (sel & ~(labels == k))
        if not sel.any():
            return []
        out = [(sel, 0.96)]
        if multimask:
            out.append((h["fg"], 0.8))  # the "whole object" level of a single click
        return out


class MockReconstructor:
    PITCH = math.radians(20)  # camera looks down at the object

    def run(self, image: np.ndarray, mask: np.ndarray, seed: int, quality: str, out_path: str) -> dict:
        h, w = mask.shape
        ys, xs = np.nonzero(mask)
        x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
        f = 1.1 * max(w, h)  # ≈ 50 mm lens
        depth = 1.5
        size = np.array([(x1 - x0) / f * depth, (y1 - y0) / f * depth, 0.0])
        size[2] = min(size[0], size[1])
        s = float(size.max())
        box = trimesh.creation.box(extents=size / s)  # SAM 3D meshes live in a unit cube
        colour = image[mask].mean(axis=0).astype(np.uint8)
        box.visual.vertex_colors = np.tile(np.append(colour, 255), (len(box.vertices), 1))
        glb.export_part(box, out_path)

        u, v = (x0 + x1) / 2, (y0 + y1) / 2
        t_gl = np.array([(u - w / 2) / f * depth, -(v - h / 2) / f * depth, -depth])
        c, sn = math.cos(self.PITCH), math.sin(self.PITCH)
        rot_gl = np.array([[1, 0, 0], [0, c, -sn], [0, sn, c]])  # Rx(pitch): object's up tilts toward the camera
        q, t, sc = pose.pose_from_gl(rot_gl, t_gl, s)
        return {"rotation": q, "translation": t, "scale": sc, "textured": False, "layout_refined": False}

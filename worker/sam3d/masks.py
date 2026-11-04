"""
Splitting one photographed object into parts, with SAM 3.

Pure NumPy/SciPy logic around a small segmenter interface, so the same code runs with
the real SAM 3 model (segmenter.py) and with the mock (mock.py) used for tests.

Guarantees for the returned parts:
  - every part lies inside the object's mask;
  - parts never overlap (each pixel belongs to at most one part), so SAM 3D never
    builds the same surface twice;
  - together they cover the whole object: a large leftover becomes its own "Body"
    part, and small slivers join the nearest part, so no geometry goes missing.
"""

from __future__ import annotations

import base64
import io
from dataclasses import dataclass, field
from typing import Protocol, Sequence

import numpy as np
from PIL import Image, ImageOps
from scipy import ndimage

Mask = np.ndarray  # bool, H x W


class Segmenter(Protocol):
    """What masks.py needs from a segmentation model."""

    def prepare(self, image: np.ndarray) -> object:
        """Encode the image once; the handle is passed to text()/points()."""

    def text(self, handle: object, prompt: str) -> list[tuple[Mask, float]]:
        """Every instance of a concept ("leg", "chair"), as (mask, confidence)."""

    def points(self, handle: object, points: Sequence[tuple[float, float, int]], multimask: bool) -> list[tuple[Mask, float]]:
        """Masks for clicks (x, y, 1 = include / 0 = exclude), as (mask, predicted IoU)."""


# ───────────── image / mask I/O ─────────────


def load_image(data: bytes) -> np.ndarray:
    """Bytes → H x W x 3 uint8, with EXIF rotation applied (as browsers display it)."""
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(data)))
    return np.asarray(img.convert("RGB"), dtype=np.uint8)


def encode_mask(mask: Mask) -> str:
    buf = io.BytesIO()
    Image.fromarray(mask.astype(np.uint8) * 255).save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def decode_mask(b64: str, shape: tuple[int, int]) -> Mask:
    if "," in b64[:64]:  # tolerate data: URLs
        b64 = b64.split(",", 1)[1]
    img = Image.open(io.BytesIO(base64.b64decode(b64)))
    # White = part. Masks drawn in a browser canvas also carry it in alpha (transparent = not part).
    lum = np.asarray(img.convert("L"))
    if lum.shape != tuple(shape):
        raise ValueError(f"mask is {lum.shape[1]}x{lum.shape[0]} but the image is {shape[1]}x{shape[0]}")
    if img.mode in ("RGBA", "LA", "PA") or "transparency" in img.info:
        return (lum > 127) & (np.asarray(img.convert("RGBA"))[..., 3] > 127)
    return lum > 127


def bbox(mask: Mask) -> list[int]:
    ys, xs = np.nonzero(mask)
    if not len(xs):
        return [0, 0, 0, 0]
    return [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1]


# ───────────── part splitting ─────────────


@dataclass
class Part:
    label: str
    mask: Mask
    score: float
    group: str | None = None
    meta: dict = field(default_factory=dict)


def _cap(s: str) -> str:
    s = s.strip()
    return s[:1].upper() + s[1:]


def _drop_small_components(mask: Mask, min_area: int) -> Mask:
    labels, n = ndimage.label(mask)
    if n <= 1:
        return mask
    sizes = ndimage.sum(mask, labels, index=np.arange(1, n + 1))
    keep = np.zeros(n + 1, dtype=bool)
    keep[1:] = sizes >= min_area
    keep[1 + int(np.argmax(sizes))] = True  # never empty a part entirely
    return keep[labels]


def _assign_to_nearest(parts: list[Part], pixels: Mask) -> None:
    """Give each pixel in `pixels` to the part whose mask is closest (in place)."""
    if not parts or not pixels.any():
        return
    label = np.zeros(pixels.shape, dtype=np.int32)
    for i, p in enumerate(parts, start=1):
        label[p.mask] = i
    # For every pixel, the coordinates of the nearest labelled pixel.
    _, (iy, ix) = ndimage.distance_transform_edt(label == 0, return_indices=True)
    nearest = label[iy, ix]
    for i, p in enumerate(parts, start=1):
        p.mask = p.mask | (pixels & (nearest == i))


def resolve(object_mask: Mask, candidates: list[Part], *, min_free: float, body_label: str, min_area: int) -> list[Part]:
    """Non-overlapping parts that exactly tile `object_mask`.

    Higher-scoring candidates claim pixels first. A candidate is kept only if at least
    `min_free` of it is still unclaimed (this also removes duplicates), and loses its
    tiny disconnected crumbs. What's left over becomes "Body" if it is substantial,
    otherwise it joins the nearest part.
    """
    obj_area = int(object_mask.sum())
    taken = np.zeros_like(object_mask)
    kept: list[Part] = []
    for c in sorted(candidates, key=lambda p: -p.score):
        m = c.mask & object_mask
        area = int(m.sum())
        if area < min_area:
            continue
        free = m & ~taken
        if free.sum() < max(min_area, min_free * area):
            continue
        free = _drop_small_components(free, min_area)
        taken |= free
        kept.append(Part(c.label, free, c.score, c.group, dict(c.meta)))

    rest = object_mask & ~taken
    if rest.any():
        labels, n = ndimage.label(rest)
        sizes = ndimage.sum(rest, labels, index=np.arange(1, n + 1)) if n else np.zeros(0)
        big = np.zeros(n + 1, dtype=bool)
        big[1:] = sizes >= max(min_area, 0.02 * obj_area)
        body = big[labels]
        if body.any() or not kept:
            body = body if body.any() else rest
            kept.append(Part(body_label, body, 1.0, None, {"body": True}))
            rest = rest & ~body
        _assign_to_nearest(kept, rest)
    return kept


def _object_mask(seg: Segmenter, handle: object, image: np.ndarray, object_prompt: str) -> tuple[Mask, float, str]:
    h, w = image.shape[:2]
    if object_prompt.strip():
        found = seg.text(handle, object_prompt.strip())
        if not found:
            raise LookupError(f'Could not find "{object_prompt.strip()}" in the photo. Try another word for it, or click on it.')
        mask, score = max(found, key=lambda ms: (ms[1], int(ms[0].sum())))
        return mask, score, _cap(object_prompt)
    # No name given: product photos are framed on the object, so click around the middle
    # (a single centre click can land between a table's legs). The largest confident mask
    # that isn't the background (it would fill the frame or run along its edges) wins.
    best: tuple[Mask, float] | None = None
    for fy in (0.2, 0.35, 0.5, 0.65, 0.8):
        for fx in (0.2, 0.35, 0.5, 0.65, 0.8):
            for mask, score in seg.points(handle, [(w * fx, h * fy, 1)], True):
                area = int(mask.sum())
                if score < 0.7 or area < 64 or area > 0.9 * h * w or _edge_fraction(mask) > 0.25:
                    continue
                if best is None or area > int(best[0].sum()):
                    best = (mask, score)
    if best is None:
        raise LookupError("Could not find an object in the middle of the photo. Name it, or click on it.")
    return best[0], best[1], "Object"


def _edge_fraction(mask: Mask) -> float:
    """Share of the image border covered by the mask (backgrounds run along the edges)."""
    edge = np.concatenate([mask[0], mask[-1], mask[:, 0], mask[:, -1]])
    return float(edge.mean())


def _auto_candidates(seg: Segmenter, handle: object, object_mask: Mask, grid: int, min_area: int) -> list[Part]:
    """Segment-everything inside the object: a grid of clicks, every confident mask kept."""
    x0, y0, x1, y1 = bbox(object_mask)
    inner = ndimage.binary_erosion(object_mask, iterations=2)
    if not inner.any():
        inner = object_mask
    obj_area = int(object_mask.sum())
    out: list[Part] = []
    for gy in range(grid):
        for gx in range(grid):
            x = x0 + (gx + 0.5) * (x1 - x0) / grid
            y = y0 + (gy + 0.5) * (y1 - y0) / grid
            xi, yi = min(int(x), object_mask.shape[1] - 1), min(int(y), object_mask.shape[0] - 1)
            if not inner[yi, xi]:
                continue
            for mask, score in seg.points(handle, [(x, y, 1)], True):
                if score < 0.75:
                    continue
                area = int(mask.sum())
                inside = int((mask & object_mask).sum())
                # Parts only: mostly inside the object, and not the whole object again.
                if area == 0 or inside < 0.85 * area or inside < min_area or inside > 0.6 * obj_area:
                    continue
                out.append(Part("Part", mask & object_mask, float(score)))
    return out


def segment_parts(
    seg: Segmenter,
    image: np.ndarray,
    object_prompt: str = "",
    part_prompts: Sequence[str] = (),
    auto: bool = True,
    grid: int = 16,
    max_parts: int = 32,
) -> dict:
    """The object as a set of non-overlapping part masks.

    part_prompts: names of parts ("seat", "leg", "armrest"). A name that matches several
    instances (four legs) gives one part per instance, grouped under that name.
    auto: with no part names, find the parts automatically.
    """
    h, w = image.shape[:2]
    handle = seg.prepare(image)
    obj, obj_score, obj_label = _object_mask(seg, handle, image, object_prompt)
    obj_area = int(obj.sum())
    if obj_area < 64:
        raise LookupError("The object is too small in the photo. Use a photo where it fills more of the frame.")
    min_area = max(64, int(0.002 * obj_area))

    prompts = [p.strip() for p in part_prompts if p.strip()]
    candidates: list[Part] = []
    for prompt in prompts:
        for mask, score in seg.text(handle, prompt):
            inside = mask & obj
            if inside.sum() < min_area or inside.sum() < 0.5 * mask.sum():
                continue  # another object in the scene, not a part of this one
            candidates.append(Part(_cap(prompt), inside, float(score), _cap(prompt)))
    if not prompts and auto:
        candidates = _auto_candidates(seg, handle, obj, grid, min_area)

    # Named parts may overlap a little (a cushion on a seat): the more confident one wins
    # those pixels. Automatic candidates repeat a lot, so they must be mostly new.
    parts = resolve(obj, candidates, min_free=0.3 if prompts else 0.7, body_label="Body" if (prompts or auto) else obj_label, min_area=min_area)
    if len(parts) > max_parts:
        parts.sort(key=lambda p: -int(p.mask.sum()))
        extra = parts[max_parts:]
        parts = parts[:max_parts]
        _assign_to_nearest(parts, np.logical_or.reduce([p.mask for p in extra]))

    # Stable, readable names: top-to-bottom, then left-to-right.
    def centre(p: Part):
        ys, xs = np.nonzero(p.mask)
        return (float(ys.mean()), float(xs.mean()))

    parts.sort(key=lambda p: (p.meta.get("body", False), centre(p)))
    by_label: dict[str, list[Part]] = {}
    for p in parts:
        by_label.setdefault(p.label, []).append(p)
    for label, group in by_label.items():
        if len(group) > 1:
            for i, p in enumerate(group, start=1):
                p.label = f"{label} {i}"  # Leg 1…4 go in a "Leg" folder; Part 1…n stay loose
        else:
            group[0].group = None  # a single instance needs no folder

    return {
        "width": w,
        "height": h,
        "object": {"label": obj_label, "score": float(obj_score), "mask": encode_mask(obj), "area": obj_area, "bbox": bbox(obj)},
        "parts": [
            {
                "label": p.label,
                "group": p.group,
                "score": round(float(p.score), 4),
                "area": int(p.mask.sum()),
                "bbox": bbox(p.mask),
                "mask": encode_mask(p.mask),
            }
            for p in parts
        ],
    }


def segment_points(seg: Segmenter, image: np.ndarray, points: Sequence[tuple[float, float, int]]) -> dict:
    """One mask from clicks. A single click is ambiguous (button, panel, whole device),
    so SAM proposes three and the most confident wins; more clicks pin it down."""
    h, w = image.shape[:2]
    pts = [(float(x), float(y), 1 if int(l) else 0) for x, y, l in points]
    if not any(l for _, _, l in pts):
        raise ValueError("Add at least one click on the part.")
    for x, y, _ in pts:
        if not (0 <= x < w and 0 <= y < h):
            raise ValueError("A click is outside the photo.")
    handle = seg.prepare(image)
    masks = seg.points(handle, pts, len(pts) == 1)
    if not masks:
        raise LookupError("SAM found nothing at those clicks.")
    mask, score = max(masks, key=lambda ms: ms[1])
    mask = _drop_small_components(mask, max(16, int(0.01 * mask.sum())))
    return {"width": w, "height": h, "score": round(float(score), 4), "area": int(mask.sum()), "bbox": bbox(mask), "mask": encode_mask(mask)}

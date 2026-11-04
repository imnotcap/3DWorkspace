"""
GLB export for SAM 3D parts, so they look in three.js the way they look in Meta's viewer.

glTF's default material is fully metallic (metallicFactor defaults to 1), and SAM 3D's
exports leave it unset: the vertex-coloured mesh has no material at all, and the baked one
only sets roughness. Rendered with PBR, both come out as dark metal. Every surface here is
marked non-metallic instead (pick a metal from the material library if a part is metal),
and normals are written so the mesh isn't flat-shaded.
"""

from __future__ import annotations

import json
import struct

import numpy as np

JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942


def fix_materials(glb: bytes, name: str = "Surface") -> bytes:
    magic, version, _ = struct.unpack_from("<III", glb, 0)
    if magic != 0x46546C67 or version != 2:
        raise ValueError("not a glTF 2.0 binary")
    json_len, json_type = struct.unpack_from("<II", glb, 12)
    if json_type != JSON_CHUNK:
        raise ValueError("first GLB chunk is not JSON")
    tree = json.loads(glb[20 : 20 + json_len].decode("utf-8"))
    rest = glb[20 + json_len :]

    materials = tree.setdefault("materials", [])
    for m in materials:
        pbr = m.setdefault("pbrMetallicRoughness", {})
        pbr.setdefault("metallicFactor", 0.0)
        if not m.get("name"):
            m["name"] = name
    default = None
    for mesh in tree.get("meshes", []):
        for prim in mesh.get("primitives", []):
            if "material" in prim:
                continue
            if default is None:
                materials.append({"name": name, "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0.0, "roughnessFactor": 0.85}})
                default = len(materials) - 1
            prim["material"] = default
    if not materials:
        del tree["materials"]

    body = json.dumps(tree, separators=(",", ":")).encode("utf-8")
    body += b" " * (-len(body) % 4)  # JSON chunk is padded with spaces
    out = struct.pack("<II", len(body), JSON_CHUNK) + body + rest
    return struct.pack("<III", 0x46546C67, 2, 12 + len(out)) + out


def srgb_to_linear_u8(rgb: np.ndarray) -> np.ndarray:
    c = rgb.astype(np.float64) / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return np.clip(np.round(lin * 255.0), 0, 255).astype(np.uint8)


def export_part(mesh, path: str) -> None:
    """trimesh.Trimesh → GLB at `path`, with normals, non-metal materials and linear vertex colours.

    SAM 3D's vertex colours are sRGB (they match the photo); glTF stores COLOR_0 as linear,
    so they are converted here, otherwise every viewer shows them washed out."""
    visual = getattr(mesh, "visual", None)
    if visual is not None and getattr(visual, "kind", None) == "vertex":
        mesh = mesh.copy()
        vc = np.array(mesh.visual.vertex_colors, dtype=np.uint8)
        vc[:, :3] = srgb_to_linear_u8(vc[:, :3])
        mesh.visual.vertex_colors = vc
    data = mesh.export(file_type="glb", include_normals=True)
    with open(path, "wb") as f:
        f.write(fix_materials(data))

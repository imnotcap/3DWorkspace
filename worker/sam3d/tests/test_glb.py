import json
import os
import struct
import sys

import numpy as np
import trimesh
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import glb  # noqa: E402


def tree_of(path):
    data = open(path, "rb").read()
    n = struct.unpack_from("<I", data, 12)[0]
    assert struct.unpack_from("<I", data, 8)[0] == len(data)
    return json.loads(data[20 : 20 + n])


def test_vertex_colour_mesh_gets_a_non_metal_material(tmp_path):
    box = trimesh.creation.box()
    box.visual.vertex_colors = np.tile([120, 80, 40, 255], (len(box.vertices), 1))
    p = str(tmp_path / "a.glb")
    glb.export_part(box, p)
    t = tree_of(p)
    prim = t["meshes"][0]["primitives"][0]
    assert "COLOR_0" in prim["attributes"] and "NORMAL" in prim["attributes"]
    assert t["materials"][prim["material"]]["pbrMetallicRoughness"]["metallicFactor"] == 0
    # sRGB (120, 80, 40) is stored as linear
    acc = t["accessors"][prim["attributes"]["COLOR_0"]]
    view = t["bufferViews"][acc["bufferView"]]
    data = open(p, "rb").read()
    json_len = struct.unpack_from("<I", data, 12)[0]
    start = 20 + json_len + 8 + view.get("byteOffset", 0) + acc.get("byteOffset", 0)
    assert acc["componentType"] == 5121 and acc["normalized"]
    assert tuple(data[start : start + 3]) == (48, 20, 5)


def test_srgb_to_linear():
    assert glb.srgb_to_linear_u8(np.array([0, 255, 188])).tolist() == [0, 255, 128]


def test_textured_material_keeps_texture_and_becomes_non_metal(tmp_path):
    box = trimesh.creation.box()
    uv = np.random.default_rng(0).random((len(box.vertices), 2))
    mat = trimesh.visual.material.PBRMaterial(roughnessFactor=1.0, baseColorTexture=Image.new("RGB", (8, 8), (200, 10, 10)))
    box.visual = trimesh.visual.TextureVisuals(uv=uv, material=mat)
    p = str(tmp_path / "b.glb")
    glb.export_part(box, p)
    t = tree_of(p)
    m = t["materials"][0]
    assert m["pbrMetallicRoughness"]["metallicFactor"] == 0
    assert "baseColorTexture" in m["pbrMetallicRoughness"]
    assert len(t["images"]) == 1

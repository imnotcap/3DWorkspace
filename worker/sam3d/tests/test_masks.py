"""Part splitting: parts never overlap, always cover the object, and come back pixel-exact."""

import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import masks as M  # noqa: E402
from mock import MockSegmenter  # noqa: E402


def table_image(gap=True):
    """White background, brown table top, two legs (separated by a gap, or touching)."""
    img = np.full((300, 400, 3), 255, np.uint8)
    img[60:100, 60:340] = (120, 80, 40)  # top
    g = 4 if gap else 0
    img[100 + g : 260, 80:110] = (90, 60, 30)  # left leg
    img[100 + g : 260, 290:320] = (90, 60, 30)  # right leg
    return img


def decode_all(out):
    shape = (out["height"], out["width"])
    return M.decode_mask(out["object"]["mask"], shape), [M.decode_mask(p["mask"], shape) for p in out["parts"]]


def assert_tiling(obj, parts):
    stack = np.stack(parts).astype(np.int32)
    assert stack.sum(axis=0).max() <= 1, "parts overlap"
    assert np.array_equal(stack.sum(axis=0) > 0, obj), "parts don't cover the object exactly"


def test_mask_round_trip():
    rng = np.random.default_rng(0)
    m = rng.random((123, 77)) > 0.5
    assert np.array_equal(M.decode_mask(M.encode_mask(m), m.shape), m)
    with pytest.raises(ValueError):
        M.decode_mask(M.encode_mask(m), (77, 123))


def test_browser_rgba_masks():
    """Canvas PNGs are RGBA: white opaque = part, transparent black = not part."""
    import base64
    import io

    from PIL import Image

    m = np.zeros((20, 30), bool)
    m[5:15, 3:9] = True
    rgba = np.zeros((20, 30, 4), np.uint8)
    rgba[m] = (255, 255, 255, 255)
    buf = io.BytesIO()
    Image.fromarray(rgba).save(buf, format="PNG")
    assert np.array_equal(M.decode_mask(base64.b64encode(buf.getvalue()).decode(), m.shape), m)


def test_named_parts_group_instances():
    out = M.segment_parts(MockSegmenter(), table_image(), "table", ["top", "leg"])
    obj, parts = decode_all(out)
    assert_tiling(obj, parts)
    labels = [p["label"] for p in out["parts"]]
    assert labels == ["Top", "Leg 1", "Leg 2"]
    assert [p["group"] for p in out["parts"]] == [None, "Leg", "Leg"]


def test_unnamed_leftover_becomes_body():
    out = M.segment_parts(MockSegmenter(), table_image(), "table", ["leg"])
    obj, parts = decode_all(out)
    assert_tiling(obj, parts)
    assert [p["label"] for p in out["parts"]] == ["Leg 1", "Leg 2", "Body"]


def test_auto_parts():
    out = M.segment_parts(MockSegmenter(), table_image(), "table", [], auto=True, grid=12)
    obj, parts = decode_all(out)
    assert_tiling(obj, parts)
    assert len(parts) == 3
    assert [p["label"] for p in out["parts"]] == ["Part 1", "Part 2", "Part 3"]


def test_no_auto_is_whole_object():
    out = M.segment_parts(MockSegmenter(), table_image(), "table", [], auto=False)
    obj, parts = decode_all(out)
    assert len(parts) == 1 and np.array_equal(parts[0], obj)
    assert out["parts"][0]["label"] == "Table"


def test_unnamed_object_uses_centre_click():
    out = M.segment_parts(MockSegmenter(), table_image(), "", ["leg"])
    obj, parts = decode_all(out)
    assert_tiling(obj, parts)


def test_missing_object_raises():
    blank = np.full((100, 100, 3), 255, np.uint8)
    with pytest.raises(LookupError):
        M.segment_parts(MockSegmenter(), blank, "table", [])


def test_resolve_small_slivers_join_nearest_part():
    obj = np.zeros((100, 100), bool)
    obj[10:90, 10:90] = True
    a = np.zeros_like(obj)
    a[10:90, 10:50] = True
    b = np.zeros_like(obj)
    b[10:90, 51:90] = True  # leaves a 1 px column unclaimed
    parts = M.resolve(obj, [M.Part("A", a, 0.9), M.Part("B", b, 0.8)], min_free=0.3, body_label="Body", min_area=64)
    assert [p.label for p in parts] == ["A", "B"]
    assert_tiling(obj, [p.mask for p in parts])


def test_resolve_drops_duplicates():
    obj = np.ones((50, 50), bool)
    a = np.zeros_like(obj)
    a[:, :25] = True
    parts = M.resolve(obj, [M.Part("A", a, 0.9), M.Part("A2", a.copy(), 0.85)], min_free=0.7, body_label="Body", min_area=16)
    assert [p.label for p in parts] == ["A", "Body"]


def test_points():
    img = table_image()
    out = M.segment_points(MockSegmenter(), img, [(95, 200, 1)])
    m = M.decode_mask(out["mask"], img.shape[:2])
    assert m[200, 95] and not m[80, 200]
    with pytest.raises(ValueError):
        M.segment_points(MockSegmenter(), img, [(95, 200, 0)])
    with pytest.raises(ValueError):
        M.segment_points(MockSegmenter(), img, [(1000, 200, 1)])


def test_exif_rotation_applied():
    import io

    from PIL import Image

    img = Image.fromarray(table_image())
    exif = Image.Exif()
    exif[0x0112] = 6  # rotate 90° CW on display
    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif)
    arr = M.load_image(buf.getvalue())
    assert arr.shape[:2] == (400, 300)

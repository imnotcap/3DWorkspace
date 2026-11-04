"""
SAM 3D Objects pose → one 4x4 matrix per part, in an OpenGL camera frame.

SAM 3D Objects returns, for every masked object:
  - a mesh in the object's own local frame, exported by `to_glb` after rotating it
    from z-up to y-up:   v_glb = v_local @ A            (row vectors)
  - a layout (pose) mapping that local frame into the PyTorch3D camera frame,
    applied with pytorch3d's Transform3d (row vectors):
        p_cam = ((v_local * scale) @ R) + translation
    where R = quaternion_to_matrix(rotation) and rotation is (w, x, y, z).
    (`make_scene` in notebook/inference.py does exactly this, and rotates the
    Gaussians by quaternion_invert(rotation), i.e. by R^T in column form.)

The PyTorch3D camera looks down +Z with +X to the left and +Y up. OpenGL / three.js
looks down -Z with +X to the right and +Y up, so  p_gl = F p_cam  with F = diag(-1, 1, -1)
(the same flip Meta's demo_3db_mesh_alignment notebook uses).

In column-vector form, for a vertex of the exported GLB:
    p_gl = F R^T diag(scale) A v_glb + F t
which is what `part_matrix` returns, as a row-major 4x4 matrix.
"""

from __future__ import annotations

import numpy as np

# to_glb: vertices = vertices @ A  (z-up → y-up)
A = np.array([[1.0, 0.0, 0.0], [0.0, 0.0, -1.0], [0.0, 1.0, 0.0]])
# PyTorch3D camera → OpenGL camera
F = np.diag([-1.0, 1.0, -1.0])


def quat_wxyz_to_matrix(q) -> np.ndarray:
    """Same formula as pytorch3d.transforms.quaternion_to_matrix (normalised first)."""
    w, x, y, z = (np.asarray(q, dtype=np.float64).reshape(4) / np.linalg.norm(q)).tolist()
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ]
    )


def matrix_to_quat_wxyz(R: np.ndarray) -> np.ndarray:
    """Inverse of quat_wxyz_to_matrix for a proper rotation (w >= 0)."""
    R = np.asarray(R, dtype=np.float64)
    tr = np.trace(R)
    if tr > 0:
        s = np.sqrt(tr + 1.0) * 2
        q = [0.25 * s, (R[2, 1] - R[1, 2]) / s, (R[0, 2] - R[2, 0]) / s, (R[1, 0] - R[0, 1]) / s]
    elif R[0, 0] > R[1, 1] and R[0, 0] > R[2, 2]:
        s = np.sqrt(1.0 + R[0, 0] - R[1, 1] - R[2, 2]) * 2
        q = [(R[2, 1] - R[1, 2]) / s, 0.25 * s, (R[0, 1] + R[1, 0]) / s, (R[0, 2] + R[2, 0]) / s]
    elif R[1, 1] > R[2, 2]:
        s = np.sqrt(1.0 + R[1, 1] - R[0, 0] - R[2, 2]) * 2
        q = [(R[0, 2] - R[2, 0]) / s, (R[0, 1] + R[1, 0]) / s, 0.25 * s, (R[1, 2] + R[2, 1]) / s]
    else:
        s = np.sqrt(1.0 + R[2, 2] - R[0, 0] - R[1, 1]) * 2
        q = [(R[1, 0] - R[0, 1]) / s, (R[0, 2] + R[2, 0]) / s, (R[1, 2] + R[2, 1]) / s, 0.25 * s]
    q = np.array(q)
    return q if q[0] >= 0 else -q


def _vec3(v) -> np.ndarray:
    a = np.asarray(v, dtype=np.float64).reshape(-1)
    if a.size == 1:
        return np.repeat(a, 3)
    if a.size != 3:
        raise ValueError(f"expected 3 values, got {a.size}")
    return a


def part_matrix(rotation_wxyz, translation, scale) -> np.ndarray:
    """Row-major 4x4 matrix taking GLB vertices (column vectors) to the OpenGL camera frame."""
    R = quat_wxyz_to_matrix(rotation_wxyz)
    S = np.diag(_vec3(scale))
    t = _vec3(translation)
    M = np.eye(4)
    M[:3, :3] = F @ R.T @ S @ A
    M[:3, 3] = F @ t
    return M


def pose_from_gl(rotation_gl: np.ndarray, translation_gl, scale) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Inverse of `part_matrix` for a uniform-scale pose: the SAM 3D (rotation, translation, scale)
    that places a GLB with rotation `rotation_gl` at `translation_gl` in the OpenGL camera frame.
    Used by the mock backend so it goes through exactly the same conversion as real results."""
    # rotation_gl = F R^T A  →  R^T = F rotation_gl A^T  →  R = A rotation_gl^T F
    R = A @ np.asarray(rotation_gl, dtype=np.float64).T @ F
    q = matrix_to_quat_wxyz(R)
    t = F @ _vec3(translation_gl)
    return q, t, _vec3(scale)


def to_list(a) -> list:
    """Tensor/array → plain nested Python floats (JSON-safe)."""
    if hasattr(a, "detach"):
        a = a.detach().float().cpu().numpy()
    return np.asarray(a, dtype=np.float64).tolist()

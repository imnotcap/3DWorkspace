"""The pose conversion against a step-by-step re-implementation of what SAM 3D / PyTorch3D do."""

import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import pose  # noqa: E402


def random_quat(rng):
    q = rng.normal(size=4)
    return q / np.linalg.norm(q)


def quaternion_apply_wxyz(q, v):
    """Rotate column vector v by unit quaternion q = (w, x, y, z): q v q*."""
    w, x, y, z = q
    u = np.array([x, y, z])
    return v + 2 * np.cross(u, np.cross(u, v) + w * v)


def reference_pipeline(v_glb, q, t, s):
    """Literal re-statement of the conventions documented in pose.py, applied to one vertex."""
    # GLB → local (undo to_glb's `vertices @ [[1,0,0],[0,0,-1],[0,1,0]]`)
    A = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], dtype=float)
    v_local = v_glb @ np.linalg.inv(A)
    # pytorch3d Transform3d().scale(s).rotate(R).translate(t), row vectors: p @ S @ R + t
    R = pose.quat_wxyz_to_matrix(q)
    p_cam = (v_local * s) @ R + t
    # PyTorch3D camera (x left, y up, z forward) → OpenGL (x right, y up, z backward)
    return p_cam * np.array([-1, 1, -1])


def test_quaternion_matrix_matches_quaternion_apply():
    rng = np.random.default_rng(0)
    for _ in range(100):
        q = random_quat(rng)
        v = rng.normal(size=3)
        assert np.allclose(pose.quat_wxyz_to_matrix(q) @ v, quaternion_apply_wxyz(q, v))


def test_make_scene_rotation_convention():
    """make_scene rotates the Gaussians by quaternion_invert(rotation): the column-vector rotation
    applied to local points is R^T, which is what row-vector `p @ R` does."""
    rng = np.random.default_rng(1)
    q = random_quat(rng)
    q_inv = q * np.array([1, -1, -1, -1])
    v = rng.normal(size=3)
    assert np.allclose(v @ pose.quat_wxyz_to_matrix(q), quaternion_apply_wxyz(q_inv, v))


def test_part_matrix_matches_reference():
    rng = np.random.default_rng(2)
    for _ in range(200):
        q = random_quat(rng)
        t = rng.normal(size=3) * 3
        s = abs(rng.normal()) + 0.05
        M = pose.part_matrix(q, t, [s, s, s])
        for _ in range(5):
            v = rng.uniform(-0.5, 0.5, size=3)
            got = (M @ np.append(v, 1))[:3]
            assert np.allclose(got, reference_pipeline(v, q, t, s), atol=1e-9)


def test_part_matrix_is_rigid_times_uniform_scale():
    rng = np.random.default_rng(3)
    q, t, s = random_quat(rng), rng.normal(size=3), 0.37
    L = pose.part_matrix(q, t, s)[:3, :3] / s
    assert np.allclose(L @ L.T, np.eye(3), atol=1e-12)
    assert math.isclose(np.linalg.det(L), 1.0, rel_tol=1e-12)  # proper rotation, no mirror


def test_pose_from_gl_round_trip():
    rng = np.random.default_rng(4)
    for _ in range(100):
        q = random_quat(rng)
        Rgl = pose.part_matrix(q, [0, 0, 0], 1)[:3, :3]
        t_gl = rng.normal(size=3)
        q2, t2, s2 = pose.pose_from_gl(Rgl, t_gl, 0.8)
        M = pose.part_matrix(q2, t2, s2)
        assert np.allclose(M[:3, :3], Rgl * 0.8, atol=1e-9)
        assert np.allclose(M[:3, 3], t_gl, atol=1e-12)


def test_upright_object_facing_the_camera_keeps_its_axes():
    """An object standing upright and facing the camera: its local up (+Z, z-up) points along
    PyTorch3D's +Y, its front (local -Y) towards the camera (PyTorch3D -Z), its right (+X)
    to the image's right (PyTorch3D -X). In row form p @ R, R's rows are the images of the axes.
    The GLB must then come out with the same axes as three.js: up +Y, front +Z, right +X."""
    R = np.array([[-1, 0, 0], [0, 0, 1], [0, 1, 0]], dtype=float)
    assert np.isclose(np.linalg.det(R), 1)
    q = pose.matrix_to_quat_wxyz(R)
    assert np.allclose(pose.quat_wxyz_to_matrix(q), R)
    M = pose.part_matrix(q, [0, 0, 2], 1)
    assert np.allclose(M[:3, :3], np.eye(3), atol=1e-12)
    assert np.allclose(M @ np.array([0, 0, 0, 1]), [0, 0, -2, 1])  # 2 m in front of the camera


def test_identity_layout_lays_the_glb_up_axis_along_the_view():
    M = pose.part_matrix([1, 0, 0, 0], [0, 0, 0], 1)
    assert np.allclose(M @ np.array([0, 1, 0, 0]), [0, 0, -1, 0])

"""
Photogrammetry worker for 3D Workspace: many photos of a real object → measured, textured mesh.

Pipeline (same commands as OpenMVS's MvgMvsPipeline.py, COLMAP_MVS preset):
  COLMAP   feature_extractor → matcher → mapper → image_undistorter
  OpenMVS  InterfaceCOLMAP → DensifyPointCloud → ReconstructMesh → RefineMesh → TextureMesh (GLB)
  cleanup  find the ground plane, stand the model upright on it, cut the floor away, keep the object

The result's *shape* is measured, not guessed. Its *scale* is arbitrary (photos carry no units),
so set one real dimension in the app (Real size) to make it exact.

API (matches src/generation/providers/photogrammetry.ts):
  GET    /health
  POST   /jobs              multipart images[] (≥3), quality (draft|standard|high|ultra) → {"id": ...}
  GET    /jobs/{id}         → {"status", "stage", "progress", "message"}
  GET    /jobs/{id}/result  → model/gltf-binary
  DELETE /jobs/{id}         cancel
"""

from __future__ import annotations

import os
import queue
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import trimesh
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

WORK = Path(os.getenv("WORK_DIR", tempfile.gettempdir())) / "pgm-jobs"
WORK.mkdir(parents=True, exist_ok=True)
THREADS = str(os.cpu_count() or 4)

QUALITY = {
    #           max image px for SfM, densify resolution-level, refine?, texture resolution-level
    "draft": {"sfm_px": 1600, "densify": 2, "refine": False, "texture": 2},
    "standard": {"sfm_px": 2400, "densify": 1, "refine": False, "texture": 1},
    "high": {"sfm_px": 3200, "densify": 1, "refine": True, "texture": 0},
    "ultra": {"sfm_px": 4000, "densify": 0, "refine": True, "texture": 0},
}


@dataclass
class Job:
    id: str
    dir: Path
    quality: str
    status: str = "queued"  # queued | running | done | error | cancelled
    stage: str = "Queued"
    progress: float = 0.0
    message: str = ""
    proc: subprocess.Popen | None = None
    created: float = field(default_factory=time.time)


jobs: dict[str, Job] = {}
pending: "queue.Queue[str]" = queue.Queue()


class Cancelled(Exception):
    pass


def run(job: Job, stage: str, progress: float, cmd: list[str], cwd: Path | None = None):
    if job.status == "cancelled":
        raise Cancelled()
    job.stage, job.progress = stage, progress
    log = open(job.dir / "log.txt", "a")
    log.write(f"\n$ {' '.join(cmd)}\n")
    log.flush()
    env = {**os.environ, "QT_QPA_PLATFORM": "offscreen"}
    job.proc = subprocess.Popen(cmd, cwd=cwd, stdout=log, stderr=subprocess.STDOUT, env=env)
    code = job.proc.wait()
    job.proc = None
    if job.status == "cancelled":
        raise Cancelled()
    if code != 0:
        tail = (job.dir / "log.txt").read_text(errors="ignore").splitlines()[-6:]
        raise RuntimeError(f"{stage} failed. " + " ".join(tail)[-400:])


def largest_model(sparse: Path) -> Path:
    models = [d for d in sparse.iterdir() if (d / "images.bin").exists()]
    if not models:
        raise RuntimeError("Could not solve camera positions. Take more overlapping photos (30+), all the way around.")
    return max(models, key=lambda d: (d / "images.bin").stat().st_size)


def reconstruct(job: Job):
    q = QUALITY[job.quality]
    images, db, sparse, dense, mvs = (job.dir / n for n in ("images", "database.db", "sparse", "dense", "mvs"))
    sparse.mkdir()
    mvs.mkdir()
    n_images = len(list(images.iterdir()))

    run(job, "Extracting features", 0.02, ["colmap", "feature_extractor", "--database_path", str(db), "--image_path", str(images),
        "--ImageReader.camera_model", "OPENCV", "--ImageReader.single_camera_per_folder", "1",
        "--SiftExtraction.use_gpu", "0", "--SiftExtraction.max_image_size", str(q["sfm_px"]), "--SiftExtraction.num_threads", THREADS])
    matcher = "exhaustive_matcher" if n_images <= 150 else "sequential_matcher"
    run(job, "Matching photos", 0.10, ["colmap", matcher, "--database_path", str(db), "--SiftMatching.use_gpu", "0", "--SiftMatching.num_threads", THREADS])
    run(job, "Solving camera positions", 0.22, ["colmap", "mapper", "--database_path", str(db), "--image_path", str(images), "--output_path", str(sparse),
        "--Mapper.num_threads", THREADS])
    model = largest_model(sparse)
    run(job, "Undistorting photos", 0.34, ["colmap", "image_undistorter", "--image_path", str(images), "--input_path", str(model),
        "--output_path", str(dense), "--output_type", "COLMAP", "--max_image_size", str(q["sfm_px"])])

    run(job, "Preparing dense reconstruction", 0.38, ["InterfaceCOLMAP", "-i", str(dense), "-o", "scene.mvs", "--image-folder", str(dense / "images"), "-w", str(mvs)])
    run(job, "Building dense point cloud", 0.42, ["DensifyPointCloud", "scene.mvs", "--resolution-level", str(q["densify"]), "--number-views", "8",
        "--max-threads", THREADS, "-w", str(mvs)])
    run(job, "Building mesh", 0.70, ["ReconstructMesh", "scene_dense.mvs", "-p", "scene_dense.ply", "--max-threads", THREADS, "-w", str(mvs)])
    mesh = "scene_dense_mesh.ply"
    if q["refine"]:
        run(job, "Refining surface detail", 0.78, ["RefineMesh", "scene_dense.mvs", "-m", mesh, "-o", "scene_dense_mesh_refined.mvs", "--scales", "1",
            "--max-threads", THREADS, "-w", str(mvs)])
        mesh = "scene_dense_mesh_refined.ply"
    run(job, "Texturing from photos", 0.88, ["TextureMesh", "scene_dense.mvs", "-m", mesh, "-o", "textured.mvs", "--export-type", "glb",
        "--resolution-level", str(q["texture"]), "--max-threads", THREADS, "-w", str(mvs)])

    glbs = sorted(mvs.glob("*.glb"), key=lambda p: p.stat().st_mtime)
    if not glbs:
        raise RuntimeError("Texturing produced no GLB.")
    job.stage, job.progress = "Isolating the object", 0.97
    cleanup(glbs[-1], job.dir / "result.glb")


# ───────── Post-processing: upright on the ground plane, floor removed, object only ─────────


def ground_plane(points: np.ndarray, threshold: float, iterations: int = 400, seed: int = 0):
    """RANSAC plane; returns (unit normal, offset, inlier mask) or None."""
    rng = np.random.default_rng(seed)
    sample = points if len(points) <= 200_000 else points[rng.choice(len(points), 200_000, replace=False)]
    best = None
    for _ in range(iterations):
        a, b, c = sample[rng.choice(len(sample), 3, replace=False)]
        n = np.cross(b - a, c - a)
        norm = np.linalg.norm(n)
        if norm < 1e-12:
            continue
        n /= norm
        d = -n @ a
        count = int((np.abs(sample @ n + d) < threshold).sum())
        if best is None or count > best[0]:
            best = (count, n, d)
    if best is None or best[0] < 0.12 * len(sample):
        return None  # no dominant floor (e.g. object shot hanging or on a busy background)
    _, n, d = best
    return n, d, np.abs(points @ n + d) < threshold


def rotation_to_y(n: np.ndarray) -> np.ndarray:
    y = np.array([0.0, 1.0, 0.0])
    v = np.cross(n, y)
    c = float(n @ y)
    if np.linalg.norm(v) < 1e-9:
        return np.eye(3) if c > 0 else np.diag([1.0, -1.0, -1.0])
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx * (1 / (1 + c))


def cleanup(src: Path, dst: Path):
    scene = trimesh.load(src, force="scene")
    meshes = [g for g in scene.dump() if isinstance(g, trimesh.Trimesh)]
    if not meshes:
        raise RuntimeError("Reconstruction is empty.")
    points = np.vstack([m.vertices for m in meshes])
    diag = float(np.linalg.norm(points.max(0) - points.min(0)))
    t = 0.006 * diag
    plane = ground_plane(points, t)

    if plane is not None:
        n, d, _ = plane
        above = points @ n + d
        if np.median(above[np.abs(above) > t]) < 0:  # object must be on the + side
            n, d = -n, -d
        R = rotation_to_y(n)
        T = np.eye(4)
        T[:3, :3] = R
        # Points on the plane satisfy n·p = -d, so after rotating n onto +Y they sit at y = -d: lift by d.
        T[:3, 3] = R @ (d * n)
        # Cut just above the floor's own noise (3σ of its inliers), not a fraction of the scene size,
        # so low parts like desk feet survive.
        floor_h = above[np.abs(above) < t]
        cut = max(3 * float(np.std(floor_h)), 1e-4 * diag)
        for m in meshes:
            m.apply_transform(T)
            h = m.vertices[:, 1]
            keep = ~((h[m.faces] < cut).all(axis=1))  # drop floor and anything under it
            m.update_faces(keep)
            m.remove_unreferenced_vertices()

    # Keep the object: grow from the biggest piece, adding every substantial piece that touches the group.
    # (Scans often split an object at thin joints, e.g. desk legs vs. top.)
    parts = [p for m in meshes for p in m.split(only_watertight=False) if len(p.faces)]
    if not parts:
        raise RuntimeError("Nothing left after removing the floor. Shoot the object on a plain surface with space around it.")
    main = max(parts, key=lambda p: p.area)
    main_diag = float(np.linalg.norm(main.extents))
    gap = 0.02 * main_diag
    candidates = [p for p in parts if p is not main and np.linalg.norm(p.extents) > 0.03 * main_diag]
    kept = [main]
    lo, hi = main.bounds.copy()
    grew = True
    while grew:
        grew = False
        for p in candidates[:]:
            plo, phi = p.bounds
            if np.all(plo <= hi + gap) and np.all(phi >= lo - gap):
                kept.append(p)
                candidates.remove(p)
                lo, hi = np.minimum(lo, plo), np.maximum(hi, phi)
                grew = True

    if plane is not None:
        # Yaw: put the longest horizontal side along X (width), centre on the origin.
        xz = np.vstack([k.vertices[:, [0, 2]] for k in kept])
        xz_c = xz - xz.mean(0)
        _, _, vt = np.linalg.svd(xz_c[:: max(1, len(xz_c) // 50000)], full_matrices=False)
        angle = np.arctan2(vt[0, 1], vt[0, 0])
        Y = trimesh.transformations.rotation_matrix(angle, [0, 1, 0])
        C = trimesh.transformations.translation_matrix([-xz.mean(0)[0], 0, -xz.mean(0)[1]])
        for k in kept:
            k.apply_transform(Y @ C)

    trimesh.Scene(kept).export(dst)


# ───────── Job runner (one reconstruction at a time; they are CPU-bound) ─────────


def worker_loop():
    while True:
        job = jobs.get(pending.get())
        if not job or job.status == "cancelled":
            continue
        job.status = "running"
        try:
            reconstruct(job)
            job.status, job.stage, job.progress = "done", "Done", 1.0
        except Cancelled:
            job.status = "cancelled"
        except Exception as e:  # noqa: BLE001 — surfaced to the UI
            job.status, job.message = "error", str(e)


threading.Thread(target=worker_loop, daemon=True).start()

app = FastAPI(title="3D Workspace photogrammetry")
app.add_middleware(CORSMiddleware, allow_origins=os.getenv("ALLOW_ORIGINS", "*").split(","), allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def private_network_access(request: Request, call_next):
    response = await call_next(request)
    if request.headers.get("access-control-request-private-network"):
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


@app.get("/health")
def health():
    missing = [b for b in ("colmap", "DensifyPointCloud", "ReconstructMesh", "TextureMesh") if not shutil.which(b)]
    return {"ok": not missing, "type": "photogrammetry", "missing": missing, "queued": pending.qsize()}


@app.post("/jobs")
def create_job(images: list[UploadFile] = File(...), quality: str = Form("high")):
    if len(images) < 3:
        raise HTTPException(400, "Photogrammetry needs at least 3 photos (30–80 recommended).")
    jid = uuid.uuid4().hex[:12]
    jdir = WORK / jid
    (jdir / "images").mkdir(parents=True)
    for i, f in enumerate(images):
        ext = Path(f.filename or "").suffix.lower() or ".jpg"
        with open(jdir / "images" / f"{i:04d}{ext}", "wb") as out:
            shutil.copyfileobj(f.file, out)
    jobs[jid] = Job(jid, jdir, quality if quality in QUALITY else "high")
    pending.put(jid)
    return {"id": jid}


def get_job(jid: str) -> Job:
    job = jobs.get(jid)
    if not job:
        raise HTTPException(404, "Unknown job")
    return job


@app.get("/jobs/{jid}")
def job_status(jid: str):
    j = get_job(jid)
    return {"status": j.status, "stage": j.stage, "progress": j.progress, "message": j.message, "position": list(pending.queue).index(jid) if jid in pending.queue else None}


@app.get("/jobs/{jid}/result")
def job_result(jid: str):
    j = get_job(jid)
    if j.status != "done":
        raise HTTPException(409, f"Job is {j.status}")
    return Response((j.dir / "result.glb").read_bytes(), media_type="model/gltf-binary")


@app.delete("/jobs/{jid}")
def cancel_job(jid: str):
    j = get_job(jid)
    if j.status in ("queued", "running"):
        j.status = "cancelled"
        if j.proc:
            j.proc.terminate()
    return {"status": j.status}

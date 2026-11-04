"""
SAM 3 segmentation service.

SAM 3 (Python >= 3.12, PyTorch >= 2.7) and SAM 3D Objects (Python 3.11, PyTorch 2.5.1)
need different environments, so SAM 3 runs as its own small process. app.py talks to it
over localhost only; the browser never sees this port.

  GET  /health
  POST /segment  {"image_path", "object", "parts": [..], "auto": bool, "grid": int}
  POST /points   {"image_path", "points": [[x, y, 1|0], ..]}

Responses are the dicts from masks.py (masks as base64 PNG). User errors → 422 {"error"}.
"""

from __future__ import annotations

import json
import os
import threading
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

import masks as M


class Sam3Segmenter:
    """masks.Segmenter backed by SAM 3: text prompts (concepts) and clicks (SAM 1/2 task)."""

    def __init__(self, threshold: float = 0.5):
        import torch
        from PIL import Image
        from sam3.model.sam3_image_processor import Sam3Processor
        from sam3.model_builder import build_sam3_image_model

        self.torch = torch
        self.Image = Image
        if torch.cuda.is_available() and torch.cuda.get_device_properties(0).major >= 8:
            torch.backends.cuda.matmul.allow_tf32 = True
            torch.backends.cudnn.allow_tf32 = True
        # enable_inst_interactivity: adds the SAM 2-style point decoder (model.predict_inst).
        self.model = build_sam3_image_model(enable_inst_interactivity=True)
        self.processor = Sam3Processor(self.model, confidence_threshold=threshold)

    def _ctx(self):
        return self.torch.autocast("cuda", dtype=self.torch.bfloat16)

    def prepare(self, image: np.ndarray):
        with self._ctx(), self.torch.inference_mode():
            return self.processor.set_image(self.Image.fromarray(image))

    def text(self, state, prompt: str):
        with self._ctx(), self.torch.inference_mode():
            self.processor.reset_all_prompts(state)
            out = self.processor.set_text_prompt(prompt=prompt, state=state)
            masks = out["masks"]  # N x 1 x H x W, bool
            scores = out["scores"]
            result = [(m.reshape(m.shape[-2], m.shape[-1]).cpu().numpy().astype(bool), float(s)) for m, s in zip(masks, scores)]
            self.processor.reset_all_prompts(state)
            return result

    def points(self, state, points, multimask: bool):
        coords = np.array([[x, y] for x, y, _ in points], dtype=np.float32)
        labels = np.array([l for _, _, l in points], dtype=np.int32)
        with self._ctx(), self.torch.inference_mode():
            masks, scores, _ = self.model.predict_inst(state, point_coords=coords, point_labels=labels, multimask_output=multimask)
        masks = np.asarray(masks)
        scores = np.asarray(scores, dtype=np.float64).reshape(-1)
        return [(masks[i] > 0, float(scores[i])) for i in range(len(scores))]


def serve(segmenter: M.Segmenter, host: str = "127.0.0.1", port: int = 8001) -> None:
    lock = threading.Lock()  # one GPU job at a time

    class Handler(BaseHTTPRequestHandler):
        def _send(self, code: int, body: dict):
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            self._send(200, {"ok": True}) if self.path == "/health" else self._send(404, {"error": "not found"})

        def do_POST(self):
            try:
                req = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
                with open(req["image_path"], "rb") as f:
                    image = M.load_image(f.read())
                with lock:
                    if self.path == "/segment":
                        out = M.segment_parts(segmenter, image, req.get("object", ""), req.get("parts", []), bool(req.get("auto", True)), int(req.get("grid", 16)))
                    elif self.path == "/points":
                        out = M.segment_points(segmenter, image, [tuple(p) for p in req["points"]])
                    else:
                        return self._send(404, {"error": "not found"})
                self._send(200, out)
            except (LookupError, ValueError) as e:
                self._send(422, {"error": str(e)})
            except Exception as e:  # noqa: BLE001
                traceback.print_exc()
                self._send(500, {"error": f"{type(e).__name__}: {e}"})

        def log_message(self, fmt, *args):
            pass

    print(f"[sam3] listening on {host}:{port}", flush=True)
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    serve(Sam3Segmenter(float(os.getenv("SAM3_THRESHOLD", "0.5"))), port=int(os.getenv("SAM3_PORT", "8001")))

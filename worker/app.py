"""
Fit Check ML worker on Modal.

Endpoints, called only from Supabase Edge Functions with a bearer token (WORKER_TOKEN):
  POST cutout  (jpeg/png body) -> {"cutout_png_b64", "thumb_png_b64", "width", "height", "gpu_seconds"}
  POST embed   (png body)      -> {"embedding": [512 floats], "model_version": "fashion-clip-2"}   (not wired yet)

Why Modal: Edge Functions cannot run these models; Modal gives a GPU container that scales to zero, billed per
second against the free $30/month Starter credit. A cutout is about a second of T4 time ($0.000164/s).

Deploy:  modal deploy worker/app.py
Secrets: modal secret create fit-check-worker WORKER_TOKEN=<random>   (the same value goes to Supabase as
         MODAL_WORKER_TOKEN, and the printed cutout URL as MODAL_CUTOUT_URL)
"""
from __future__ import annotations

import base64
import io
import os
import time

import modal

MODEL_CACHE = "/models"
# Longest edge the worker accepts; the app already sends 1600 px or less. Bigger only costs time, not quality.
MAX_EDGE = 2048

# don't touch / CUDA + cuDNN base image: onnxruntime-gpu needs both at runtime and debian_slim has neither, which
# makes rembg fall back to the CPU silently (about 20 s a photo instead of about 1 s).
cutout_image = (
    modal.Image.from_registry("nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04", add_python="3.11")
    .pip_install("rembg==2.0.61", "onnxruntime-gpu==1.20.1", "pillow==11.0.0", "fastapi[standard]==0.115.6")
    # BiRefNet weights are fetched on the first run and cached in the volume below.
    .env({"U2NET_HOME": MODEL_CACHE})
)
# Separate image so the cutout container does not pay torch's size on every cold start.
embed_image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "pillow==11.0.0", "transformers==4.44.2", "torch==2.4.1", "fastapi[standard]==0.115.6"
)

# don't touch / FastAPI injects the request only when the parameter is annotated with Request, and resolves the
# annotation from this module's globals inside the container. Both images have fastapi; the fallback only lets
# `modal deploy` import this file on a machine without it.
try:
    from fastapi import HTTPException, Request
except ImportError:  # pragma: no cover - local deploy machine only
    HTTPException = Exception  # type: ignore[assignment,misc]
    Request = object  # type: ignore[assignment,misc]

app = modal.App("fit-check-worker")
volume = modal.Volume.from_name("fit-check-models", create_if_missing=True)
secret = modal.Secret.from_name("fit-check-worker")

FASHION_CLIP = "patrickjohncyh/fashion-clip"
MODEL_VERSION = "fashion-clip-2"


def _check_token(authorization: str | None) -> None:
    """Rejects any caller without the shared worker token; the endpoints are public URLs otherwise."""
    expected = os.environ.get("WORKER_TOKEN")
    if not expected or authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="bad token")


def _png_b64(img) -> str:  # type: ignore[no-untyped-def]
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode("ascii")


# scaledown_window: a batch of photos arrives a few seconds apart, so one warm container serves the whole batch;
# two minutes idle then scales to zero (no cost while unused).
@app.cls(image=cutout_image, gpu="T4", volumes={MODEL_CACHE: volume}, secrets=[secret], scaledown_window=120, timeout=120)
class Cutter:
    @modal.enter()
    def load(self) -> None:
        from rembg import new_session

        # birefnet-general is the quality model; "u2net" is faster but leaves halos on knits and loses sleeves.
        self.session = new_session("birefnet-general", providers=["CUDAExecutionProvider", "CPUExecutionProvider"])
        volume.commit()

    @modal.fastapi_endpoint(method="POST")
    async def cutout(self, request: Request) -> dict:
        """Removes the background of one garment photo. 401 without the token, 400 for a non-image body."""
        from PIL import Image, UnidentifiedImageError
        from rembg import remove

        _check_token(request.headers.get("authorization"))
        raw = await request.body()
        if not raw or len(raw) > 12 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="empty or too large")
        try:
            src = Image.open(io.BytesIO(raw)).convert("RGB")
        except UnidentifiedImageError:
            raise HTTPException(status_code=400, detail="not an image")
        src.thumbnail((MAX_EDGE, MAX_EDGE))

        started = time.monotonic()
        out = remove(src, session=self.session, post_process_mask=True)
        elapsed = time.monotonic() - started
        # Trim transparent margins so every cutout sits on the same baseline in the UI.
        bbox = out.getbbox()
        if bbox:
            out = out.crop(bbox)
        thumb = out.copy()
        thumb.thumbnail((400, 400))
        return {
            "cutout_png_b64": _png_b64(out),
            "thumb_png_b64": _png_b64(thumb),
            "width": out.width,
            "height": out.height,
            "gpu_seconds": round(elapsed, 3),
        }


@app.cls(image=embed_image, gpu="T4", volumes={MODEL_CACHE: volume}, secrets=[secret], scaledown_window=120)
class Embedder:
    @modal.enter()
    def load(self) -> None:
        from transformers import CLIPModel, CLIPProcessor

        self.clip = CLIPModel.from_pretrained(FASHION_CLIP, cache_dir=MODEL_CACHE).eval().to("cuda")
        self.processor = CLIPProcessor.from_pretrained(FASHION_CLIP, cache_dir=MODEL_CACHE)
        volume.commit()

    @modal.fastapi_endpoint(method="POST")
    async def embed(self, request: Request) -> dict:
        """FashionCLIP image embedding, L2-normalised. Not called by any Edge Function yet."""
        import torch
        from PIL import Image

        _check_token(request.headers.get("authorization"))
        img = Image.open(io.BytesIO(await request.body())).convert("RGB")
        with torch.no_grad():
            inputs = self.processor(images=img, return_tensors="pt").to("cuda")
            feats = self.clip.get_image_features(**inputs)
            feats = feats / feats.norm(dim=-1, keepdim=True)
        return {"embedding": feats[0].tolist(), "model_version": MODEL_VERSION}

"""
Fit Check ML worker on Modal.

Two endpoints, both called only from Supabase Edge Functions with a bearer token:
  POST /cutout  (image/png or jpeg body) -> {"cutout_png_b64": ..., "thumb_png_b64": ...}
  POST /embed   (image/png body)         -> {"embedding": [512 floats], "model_version": "fashion-clip-2"}

Why Modal: Edge Functions cannot run torch; Modal gives a GPU container that scales to
zero and a free monthly credit, so idle cost is zero and a cutout costs fractions of a cent.

Deploy:  modal deploy worker/app.py
Secrets: modal secret create fit-check-worker WORKER_TOKEN=<random>
"""
from __future__ import annotations

import base64
import io
import os

import modal

MODEL_CACHE = "/models"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "rembg[gpu]==2.0.61",
        "onnxruntime-gpu",
        "pillow",
        "transformers==4.44.2",
        "torch==2.4.1",
        "fastapi[standard]",
    )
    # BiRefNet weights are fetched on first run and cached in the volume below.
    .env({"U2NET_HOME": MODEL_CACHE})
)

app = modal.App("fit-check-worker", image=image)
volume = modal.Volume.from_name("fit-check-models", create_if_missing=True)

FASHION_CLIP = "patrickjohncyh/fashion-clip"
MODEL_VERSION = "fashion-clip-2"


def _check_token(authorization: str | None) -> None:
    expected = os.environ.get("WORKER_TOKEN")
    if not expected or authorization != f"Bearer {expected}":
        from fastapi import HTTPException

        raise HTTPException(status_code=401, detail="bad token")


@app.cls(gpu="T4", volumes={MODEL_CACHE: volume}, secrets=[modal.Secret.from_name("fit-check-worker")], scaledown_window=120)
class Worker:
    @modal.enter()
    def load(self) -> None:
        from rembg import new_session
        from transformers import CLIPModel, CLIPProcessor

        # birefnet-general is the quality model; "u2net" would be faster but leaves halos on knits.
        self.session = new_session("birefnet-general")
        self.clip = CLIPModel.from_pretrained(FASHION_CLIP, cache_dir=MODEL_CACHE).eval()
        self.processor = CLIPProcessor.from_pretrained(FASHION_CLIP, cache_dir=MODEL_CACHE)
        volume.commit()

    @modal.fastapi_endpoint(method="POST")
    async def cutout(self, request) -> dict:  # type: ignore[no-untyped-def]
        from fastapi import Request
        from PIL import Image
        from rembg import remove

        req: Request = request
        _check_token(req.headers.get("authorization"))
        raw = await req.body()
        src = Image.open(io.BytesIO(raw)).convert("RGBA")
        out = remove(src, session=self.session, post_process_mask=True)
        # Trim transparent margins so every cutout sits on the same baseline in the UI.
        bbox = out.getbbox()
        if bbox:
            out = out.crop(bbox)
        thumb = out.copy()
        thumb.thumbnail((400, 400))
        return {"cutout_png_b64": _png_b64(out), "thumb_png_b64": _png_b64(thumb)}

    @modal.fastapi_endpoint(method="POST")
    async def embed(self, request) -> dict:  # type: ignore[no-untyped-def]
        import torch
        from fastapi import Request
        from PIL import Image

        req: Request = request
        _check_token(req.headers.get("authorization"))
        raw = await req.body()
        img = Image.open(io.BytesIO(raw)).convert("RGB")
        with torch.no_grad():
            inputs = self.processor(images=img, return_tensors="pt")
            feats = self.clip.get_image_features(**inputs)
            feats = feats / feats.norm(dim=-1, keepdim=True)
        return {"embedding": feats[0].tolist(), "model_version": MODEL_VERSION}


def _png_b64(img) -> str:  # type: ignore[no-untyped-def]
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode("ascii")

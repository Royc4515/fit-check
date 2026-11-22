"""
Fit Check ML worker on Modal.

Endpoints, called only from Supabase Edge Functions with a bearer token (WORKER_TOKEN):
  POST cutout?isolate=1  (jpeg/png body) -> {"cutout_png_b64", "thumb_png_b64", "cutout_webp_b64", "thumb_webp_b64", "width", "height", "gpu_seconds", "isolated"}
  POST embed   (png body)      -> {"embedding": [512 floats], "model_version": "fashion-clip-2"}   (not wired yet)

Why Modal: Edge Functions cannot run these models; Modal gives a GPU container that scales to zero, billed per
second against the free $30/month Starter credit. Runs on 8 CPU cores (no GPU: that needs a card on file), about
10-20 s a photo, a fraction of a cent.

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
# Inside the cutout image, not the volume: volumes are not mounted during image builds.
BAKED_MODELS = "/opt/u2net"
# Longest edge the worker accepts; the app already sends 1600 px or less. Bigger only costs time, not quality.
MAX_EDGE = 2048

# CPU, not GPU (Roy, 2026-11-10): Modal asks for a payment method before any GPU function runs, and Roy wants no
# card on file. BiRefNet on 8 CPU cores takes roughly 10-20 s a photo, which hides behind tagging in the app and stays
# well inside the free $30/month credit. To move to a T4 later: base image nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04
# (add_python="3.11"), onnxruntime-gpu instead of onnxruntime, gpu="T4" on the class, CUDAExecutionProvider first.
# SAM 2 (Roy, 2026-11-10): BiRefNet keeps every garment it sees, so a shirt hanging behind the photographed one stayed
# in the cutout. SAM 2.1 small, prompted with points on the centre of the crop, picks out the front garment; BiRefNet
# still draws the edges. CPU torch from its own index keeps the image ~700 MB smaller than the CUDA build.
SAM_MODEL = "facebook/sam2.1-hiera-small"

cutout_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("rembg==2.0.61", "onnxruntime==1.20.1", "pillow==11.0.0", "fastapi[standard]==0.115.6", "scipy==1.14.1")
    .pip_install("torch==2.5.1", index_url="https://download.pytorch.org/whl/cpu")
    .pip_install("transformers==4.57.1")
    # don't touch / the BiRefNet weights (973 MB) are downloaded once at image build and baked into the image.
    # Fetching them at container start (the first version) took ~3 min at ~5.5 MB/s, every new container repeated
    # it in parallel, and it ran into the container timeout, so the first deploy never answered (2026-11-10).
    .env({"U2NET_HOME": BAKED_MODELS})
    .run_commands("python -c \"from rembg import new_session; new_session('birefnet-general')\"")
    .env({"HF_HOME": "/opt/hf"})
    .run_commands(f"python -c \"from transformers import Sam2Model, Sam2Processor; Sam2Model.from_pretrained('{SAM_MODEL}'); Sam2Processor.from_pretrained('{SAM_MODEL}')\"")
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


# Where SAM is told the garment is: the crop is centred on it (detection box or a single-garment photo), and the
# off-centre points stop it from taking only one half of a shirt split by its placket.
SAM_POINTS = ((0.5, 0.5), (0.35, 0.45), (0.65, 0.45), (0.35, 0.7), (0.65, 0.7))
# SAM's mask is coarse (256 px internally); it only decides WHICH pixels may stay, so it is grown a little and
# BiRefNet's alpha keeps the fine edge.
SAM_GROW = 0.004
# If SAM's garment covers less than this share of BiRefNet's foreground, SAM grabbed a pocket or a collar, not the
# garment: keep BiRefNet's cutout untouched rather than return a fragment.
SAM_MIN_SHARE = 0.3
# Pieces of the cutout smaller than this share of the biggest piece are leftovers (a sleeve end from behind);
# bigger ones stay, so the second shoe of a pair survives.
KEEP_PIECE = 0.15


def isolate_alpha(alpha, sam_mask):  # type: ignore[no-untyped-def]
    """
    Keeps only the front garment in a BiRefNet alpha matte, using SAM's mask of it.

    alpha: uint8 HxW from BiRefNet. sam_mask: bool HxW (same size). Returns (alpha, isolated) where isolated is False
    when SAM's mask looked wrong and the matte came back unchanged. Pure numpy/scipy so it is testable off Modal.
    """
    import numpy as np
    from scipy import ndimage

    fg = alpha > 32
    fg_area = int(fg.sum())
    if fg_area == 0 or not sam_mask.any():
        return alpha, False
    mask = ndimage.binary_fill_holes(sam_mask)
    grow = max(2, round(SAM_GROW * max(alpha.shape)))
    mask = ndimage.binary_dilation(mask, iterations=grow)
    if int((fg & mask).sum()) < SAM_MIN_SHARE * fg_area:
        return alpha, False
    out = np.where(mask, alpha, 0).astype(np.uint8)
    labels, n = ndimage.label(out > 32)
    if n > 1:
        sizes = ndimage.sum(np.ones_like(labels), labels, index=range(1, n + 1))
        keep = {i + 1 for i, size in enumerate(sizes) if size >= KEEP_PIECE * sizes.max()}
        out = np.where(np.isin(labels, list(keep)) | (labels == 0), out, 0).astype(np.uint8)
    return out, True


def sam_points(width: int, height: int) -> list:
    return [[[[width * x, height * y] for x, y in SAM_POINTS]]]


def _png_b64(img) -> str:  # type: ignore[no-untyped-def]
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _webp_b64(img, quality: int = 85) -> str:  # type: ignore[no-untyped-def]
    buf = io.BytesIO()
    img.save(buf, format="WEBP", quality=quality, method=4)
    return base64.b64encode(buf.getvalue()).decode("ascii")


# scaledown_window: a batch of photos arrives a few seconds apart, so one warm container serves the whole batch;
# two minutes idle then scales to zero (no cost while unused).
# enable_memory_snapshot: Modal snapshots the container after load() and restores it on the next cold start, so a
# sleeping worker answers in seconds instead of re-reading 1 GB of weights (the first real call took 112 s).
@app.cls(image=cutout_image, cpu=8.0, memory=8192, secrets=[secret], scaledown_window=120, timeout=180, enable_memory_snapshot=True)
class Cutter:
    @modal.enter(snap=True)
    def load(self) -> None:
        from rembg import new_session

        # birefnet-general is the quality model; "u2net" is faster but leaves halos on knits and loses sleeves.
        self.session = new_session("birefnet-general", providers=["CPUExecutionProvider"])
        from transformers import Sam2Model, Sam2Processor

        self.sam_processor = Sam2Processor.from_pretrained(SAM_MODEL)
        self.sam = Sam2Model.from_pretrained(SAM_MODEL).eval()

    def front_garment(self, src):  # type: ignore[no-untyped-def]
        """SAM 2 mask (bool, src size) of the garment at the centre of the crop; the highest-scoring of its 3 masks."""
        import numpy as np
        import torch

        small = src.copy()
        small.thumbnail((1024, 1024))
        inputs = self.sam_processor(
            images=small,
            input_points=sam_points(small.width, small.height),
            input_labels=[[[1] * len(SAM_POINTS)]],
            return_tensors="pt",
        )
        with torch.no_grad():
            out = self.sam(**inputs, multimask_output=True)
        masks = self.sam_processor.post_process_masks(out.pred_masks, inputs["original_sizes"])[0][0]
        best = masks[int(out.iou_scores[0, 0].argmax())].numpy()
        from PIL import Image

        return np.array(Image.fromarray(best.astype(np.uint8) * 255).resize(src.size)) > 127

    @modal.fastapi_endpoint(method="POST")
    async def cutout(self, request: Request) -> dict:
        """
        Removes the background of one garment photo. With isolate=1 (the default) also removes other garments around
        the front one (SAM 2); the Edge Function sends isolate=0 for AI redraws, which only ever show one garment.
        401 without the token, 400 for a non-image body.
        """
        import numpy as np
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
        isolated = False
        if request.query_params.get("isolate", "1") != "0":
            try:
                alpha, isolated = isolate_alpha(np.array(out.getchannel("A")), self.front_garment(src))
                out.putalpha(Image.fromarray(alpha))
            except Exception as error:  # noqa: BLE001 - a SAM failure must not cost the cutout itself
                print(f"isolate failed: {error!r}")
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
            "cutout_webp_b64": _webp_b64(out, quality=85),
            "thumb_webp_b64": _webp_b64(thumb, quality=80),
            "width": out.width,
            "height": out.height,
            "gpu_seconds": round(elapsed, 3),
            "isolated": isolated,
        }


# CPU for the same reason as Cutter; not called yet, so speed does not matter.
@app.cls(image=embed_image, cpu=2.0, volumes={MODEL_CACHE: volume}, secrets=[secret], scaledown_window=120)
class Embedder:
    @modal.enter()
    def load(self) -> None:
        from transformers import CLIPModel, CLIPProcessor

        self.clip = CLIPModel.from_pretrained(FASHION_CLIP, cache_dir=MODEL_CACHE).eval()
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
            inputs = self.processor(images=img, return_tensors="pt")
            feats = self.clip.get_image_features(**inputs)
            feats = feats / feats.norm(dim=-1, keepdim=True)
        return {"embedding": feats[0].tolist(), "model_version": MODEL_VERSION}

# worker

Modal app with two endpoints: `/cutout` (BiRefNet via rembg) and `/embed` (FashionCLIP, 512-d, L2-normalized).

```
pip install modal
modal token new
modal secret create fit-check-worker WORKER_TOKEN=$(openssl rand -hex 24)
modal deploy worker/app.py
```

Copy the two endpoint URLs Modal prints into Supabase secrets as `MODAL_WORKER_URL` (base) and `MODAL_WORKER_TOKEN`.

Not tested yet: first deploy will download BiRefNet and FashionCLIP into the `fit-check-models` volume (about 1.5 GB, one time).

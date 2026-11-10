# worker

Modal app (worker/app.py):
- `Cutter.cutout`: background removal (BiRefNet `birefnet-general` via rembg, on 8 CPU cores). With `?isolate=1` (the default) SAM 2.1 small also keeps only the garment at the centre of the crop, so clothes hanging behind it drop out; `intake-cutout` sends `isolate=0` for AI redraws. Used by `intake-cutout`.
- `Embedder.embed`: FashionCLIP, 512-d, L2-normalised. Not wired yet.

Cost: per second against Modal's free $30/month Starter credit; about 10-20 s of 8 CPU cores per photo, a fraction
of a cent. No GPU on purpose: Modal requires a payment method for GPU functions. Containers scale to zero two
minutes after the last call.

## Deploy (from your own computer: Modal's CLI uses gRPC, which the cloud dev sandbox cannot reach)

```
pip install modal
modal setup                                   # opens the browser; approve once
python -c "import secrets; print(secrets.token_hex(24))"      # copy the output: this is WORKER_TOKEN
modal secret create fit-check-worker WORKER_TOKEN=<the value>
modal deploy worker/app.py
```

`modal deploy` prints the endpoint URLs. In Supabase (Edge Functions > Secrets) add:
- `MODAL_CUTOUT_URL` = the URL that ends in `cutter-cutout.modal.run`
- `MODAL_WORKER_TOKEN` = the same WORKER_TOKEN value

Until both are set, `intake-cutout` answers `not_configured` and the app keeps the plain crop.
The BiRefNet weights (973 MB) and SAM 2.1 small (~180 MB, plus CPU torch) are downloaded once while `modal deploy` builds the image, so a deploy that changes the image takes a few minutes and containers then start fast.

# worker

Modal app (worker/app.py):
- `Cutter.cutout`: background removal (BiRefNet `birefnet-general` via rembg, on a T4). Used by `intake-cutout`.
- `Embedder.embed`: FashionCLIP, 512-d, L2-normalised. Not wired yet.

Cost: per second of GPU against Modal's free $30/month Starter credit (T4 $0.000164/s, about a second per photo plus
cold starts). Containers scale to zero two minutes after the last call.

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
The first call after deploy downloads BiRefNet (about 900 MB) into the `fit-check-models` volume: allow a minute.

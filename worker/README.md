# worker

Modal app (worker/app.py):
- `Cutter.cutout`: background removal (BiRefNet `birefnet-general` via rembg, on 8 CPU cores). With `?isolate=1` (the default) SAM 2.1 small also keeps only the garment at the centre of the crop, so clothes hanging behind it drop out; `intake-cutout` sends `isolate=0` for AI redraws. Used by `intake-cutout`.

Cost: Modal bills every second a container is alive (start, work, and the idle tail before it stops), against a
credit of $1 a month without a card ($30 with one; Roy keeps no card on file). In November 2026 one cutout cost about
$0.007 inside a batch and up to $0.02 alone, and the first import of the wardrobe (124 cutouts in a day) plus two idle
minutes after every burst used the whole $1 by 2026-11-18. So: no GPU (it needs a card), the container scales to zero
20 s after the last call, and `intake-cutout` allows 40 cutouts a day. When the credit runs out Modal refuses the
calls and the app keeps the plain crop until the next month.

The FashionCLIP `/embed` endpoint was removed on 2026-11-25: nothing called it, and embeddings are planned on
`gemini-embedding-2` instead (`docs/TASKS.md` 5.5).

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

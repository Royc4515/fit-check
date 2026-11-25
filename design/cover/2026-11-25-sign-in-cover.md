# Sign-in cover photo (2026-11-25)

`apps/mobile/assets/cover/sign-in-cover.webp`, shown by `CoverPhoto` on the sign-in screen (DESIGN.md §3 "התחברות").

- Why: Roy wanted something "fake but good-looking" on the screen before signing in, instead of the drawn garments.
- Made in Google Flow, image mode, Nano Banana Pro, 3:4 portrait (Flow offers no 4:5), 4 variations, 0 credits.
  Variation 3 of 4, chosen for the most air around every garment. 896x1200, downloaded at original size.
- Then cut out of its background (Roy: "with an empty background, so it floats on the screen"): locally with rembg
  2.0.88 and the `birefnet-general-lite` model (free, nothing uploaded), alpha below 24 set to 0 to drop the faint
  vignette left at the corners, cropped to the garments plus 16px, saved as WebP quality 90: 786x970, 68 KB.

To make another one: the same prompt and settings, the same cut-out, then replace the file and `ASPECT` in
`CoverPhoto.tsx`.

## Prompt

```
Overhead flat-lay product photograph of a men's smart-casual outfit, shot from directly above, on a seamless matte paper background in one flat warm sand-beige color (#DDD4C3) filling the whole frame edge to edge, no gradient, no vignette. Four garments arranged loosely like a stylist's table in a minimalist editorial magazine (Kinfolk, SSENSE), with generous empty space between them and around the edges:
- upper left: a deep oxblood-burgundy merino quarter-zip sweater, laid flat, sleeves folded naturally;
- slightly overlapping it toward the center: a crisp off-white long-sleeve Oxford button-down shirt, laid flat, sleeves gently angled outward;
- right side, running top to bottom: full-length navy cotton chinos, laid straight, hems lightly rolled;
- lower left: a pair of dark brown leather penny loafers, side by side, seen from above.
Realistic fabric textures (oxford weave, fine knit, cotton twill, leather grain), true-to-life colors, soft even diffused daylight from above, only a very faint contact shadow under each garment. High-end e-commerce product photography, sharp focus, high detail, portrait orientation.
No people, no hands, no mannequin, no hangers, no text, no letters, no logos, no visible labels or brand tags, no belts, watches or accessories, no props, no plants, no extra objects, no frame or border, nothing cut off by the image edges.
```

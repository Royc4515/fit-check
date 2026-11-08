import { Image } from "imagescript";
import { cutOut } from "./cutout.ts";

async function maskPng(w: number, h: number, value: number): Promise<Uint8Array> {
  const m = new Image(w, h);
  m.fill(Image.rgbaToColor(value, value, value, 255));
  return await m.encode(1);
}

Deno.test("cuts the box out and uses the mask as alpha", async () => {
  const photo = new Image(1000, 1000);
  photo.fill(Image.rgbaToColor(200, 50, 50, 255));
  const png = await cutOut(photo, [100, 200, 500, 600], await maskPng(10, 10, 255));
  if (!png) throw new Error("expected a cutout");
  const out = (await Image.decode(png)) as Image;
  if (out.width !== 400 || out.height !== 400) throw new Error(`size ${out.width}x${out.height}`);
  if (out.bitmap[3] !== 255 || out.bitmap[0] !== 200) throw new Error("pixel lost");
});

Deno.test("an empty mask or a sliver of a box gives no cutout", async () => {
  const photo = new Image(1000, 1000);
  photo.fill(0xffffffff);
  if (await cutOut(photo, [100, 100, 500, 500], await maskPng(10, 10, 0))) throw new Error("empty mask kept");
  if (await cutOut(photo, [100, 100, 110, 500], await maskPng(10, 10, 255))) throw new Error("sliver kept");
});

Deno.test("a box outside the photo is clamped, not thrown", async () => {
  const photo = new Image(500, 500);
  photo.fill(0xffffffff);
  const png = await cutOut(photo, [-50, -50, 2000, 2000], await maskPng(4, 4, 255));
  const out = (await Image.decode(png!)) as Image;
  if (out.width !== 500 || out.height !== 500) throw new Error(`size ${out.width}x${out.height}`);
});

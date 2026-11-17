/**
 * The media type an image really is, read from its first bytes.
 *
 * don't touch / file extensions lie here (2026-11-17): some `-enhanced.png` and `-thumb.png` files hold JPEG bytes,
 * and Anthropic rejects an image whose declared type does not match its bytes ("specified using image/png ... appears
 * to be image/jpeg"). That failed 15 of 144 tag/duplicate calls silently. Always declare what the bytes say.
 * Returns `fallback` for anything unrecognised.
 */
export function sniffImageType(bytes: Uint8Array, fallback: string): string {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") {
    return "image/webp";
  }
  if (bytes.length >= 4 && String.fromCharCode(...bytes.subarray(0, 4)) === "GIF8") return "image/gif";
  return fallback;
}

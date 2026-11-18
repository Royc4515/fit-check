/**
 * Constant-time check of a design-preview code against the expected one.
 *
 * Both sides are hashed first, so the comparison always runs over 32 bytes: a plain `===` (or a byte loop over the raw
 * strings) returns sooner the earlier the first wrong character is, and that timing would let a caller guess the code
 * one character at a time. An empty expected code never matches: a missing secret must lock the door, not open it.
 */
export async function sameCode(given: string, expected: string): Promise<boolean> {
  if (expected.length === 0) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  // don't touch / no early exit: every byte is compared whatever the earlier ones were.
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

import { describe, expect, it, vi } from "vitest";
import { buildAuthUrl, directSignInAvailable, finishDirectSignIn, GOOGLE_CLIENT_ID, parseCallback, randomToken, sha256Hex, startDirectSignIn, type KeyValue } from "./googleDirect";

function memory(): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}
const PROD = "https://fit-check-app-xi.vercel.app";

describe("directSignInAvailable", () => {
  it("only on origins registered with Google", () => {
    expect(directSignInAvailable(PROD)).toBe(true);
    expect(directSignInAvailable(`${PROD}/`)).toBe(true);
    expect(directSignInAvailable("https://fit-check-app-git-other-royc4515s-projects.vercel.app")).toBe(false);
  });
});

describe("buildAuthUrl", () => {
  it("asks Google for an ID token back to /auth/google on this origin, with nonce and state", () => {
    const url = new URL(buildAuthUrl({ origin: PROD, nonceHash: "h", state: "s", locale: "he" }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: `${PROD}/auth/google`,
      response_type: "id_token",
      scope: "openid email profile",
      nonce: "h",
      state: "s",
      hl: "he",
    });
  });
});

describe("parseCallback", () => {
  it("reads a token, an error, or nothing", () => {
    expect(parseCallback("#id_token=abc&state=s1")).toEqual({ kind: "token", idToken: "abc", state: "s1" });
    expect(parseCallback("#error=access_denied&state=s1")).toEqual({ kind: "error", error: "access_denied" });
    expect(parseCallback("")).toEqual({ kind: "empty" });
  });
});

describe("randomToken and sha256Hex", () => {
  it("64 hex characters each; the hash is the standard SHA-256", async () => {
    expect(randomToken()).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("start and finish", () => {
  it("a round trip: Google gets the hashed nonce, Supabase the raw one, and the pending entry is used once", async () => {
    const store = memory();
    let sent = "";
    expect(await startDirectSignIn(PROD, "he", store, (u) => (sent = u), () => 1000)).toBe(true);
    const url = new URL(sent);
    const pending = JSON.parse(store.data.get("fitcheck:google-direct") ?? "{}");
    expect(url.searchParams.get("nonce")).toBe(await sha256Hex(pending.nonce));

    const signIn = vi.fn().mockResolvedValue({ error: null });
    const hash = `#id_token=tok&state=${url.searchParams.get("state")}`;
    expect(await finishDirectSignIn(hash, signIn, store, () => 2000)).toEqual({ ok: true });
    expect(signIn).toHaveBeenCalledWith({ provider: "google", token: "tok", nonce: pending.nonce });
    expect(await finishDirectSignIn(hash, signIn, store, () => 2000)).toEqual({ ok: false, reason: "no_pending" });
  });

  it("refuses a foreign state, an old start, a cancel and a token Supabase rejects", async () => {
    const start = async () => {
      const store = memory();
      let sent = "";
      await startDirectSignIn(PROD, "en", store, (u) => (sent = u), () => 0);
      return { store, state: new URL(sent).searchParams.get("state") };
    };
    const ok = vi.fn().mockResolvedValue({ error: null });
    let s = await start();
    expect(await finishDirectSignIn("#id_token=t&state=other", ok, s.store, () => 1)).toEqual({ ok: false, reason: "state_mismatch" });
    s = await start();
    expect(await finishDirectSignIn(`#id_token=t&state=${s.state}`, ok, s.store, () => 11 * 60 * 1000)).toEqual({ ok: false, reason: "expired" });
    s = await start();
    expect(await finishDirectSignIn("#error=access_denied", ok, s.store, () => 1)).toEqual({ ok: false, reason: "cancelled" });
    s = await start();
    const rejecting = vi.fn().mockResolvedValue({ error: new Error("bad nonce") });
    expect(await finishDirectSignIn(`#id_token=t&state=${s.state}`, rejecting, s.store, () => 1)).toEqual({ ok: false, reason: "rejected" });
    expect(ok).not.toHaveBeenCalled();
  });
});

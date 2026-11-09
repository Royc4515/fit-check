import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { authenticate } from "./auth.ts";

const URL = "https://example.supabase.co";

async function setup() {
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(publicKey)), alg: "ES256", kid: "k1", use: "sig" };
  Deno.env.set("SUPABASE_URL", URL);
  Deno.env.set("SUPABASE_JWKS", JSON.stringify({ keys: [jwk] }));
  const sign = (claims: { iss?: string; aud?: string; sub?: string }) =>
    new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: "k1" }).setIssuer(claims.iss ?? `${URL}/auth/v1`)
      .setAudience(claims.aud ?? "authenticated").setSubject(claims.sub ?? "user-1").setIssuedAt().setExpirationTime("1h").sign(privateKey);
  return sign;
}
const req = (token: string) => new Request("http://x", { headers: { authorization: `Bearer ${token}` } });

Deno.test("accepts a token signed by the project key, with Supabase's issuer and audience", async () => {
  const sign = await setup();
  const result = await authenticate(req(await sign({})));
  if (!result.ok || result.userId !== "user-1") throw new Error(JSON.stringify(result));
});

Deno.test("rejects a wrong issuer, a wrong audience, a foreign key and a missing token", async () => {
  const sign = await setup();
  for (const token of [await sign({ iss: "https://evil.example/auth/v1" }), await sign({ aud: "anon" })]) {
    if ((await authenticate(req(token))).ok) throw new Error("accepted a bad claim");
  }
  const foreign = await (async () => {
    const { privateKey } = await generateKeyPair("ES256");
    return new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: "k1" }).setIssuer(`${URL}/auth/v1`)
      .setAudience("authenticated").setSubject("x").setExpirationTime("1h").sign(privateKey);
  })();
  if ((await authenticate(req(foreign))).ok) throw new Error("accepted a foreign key");
  if ((await authenticate(new Request("http://x"))).ok) throw new Error("accepted no token");
});

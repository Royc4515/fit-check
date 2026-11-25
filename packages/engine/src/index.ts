/**
 * @fit-check/engine: the outfit engine, shared by the app and (as a bundle) the mcp Edge Function.
 *
 * Pure by contract: no I/O, no clock, no randomness of its own. Time, weather and wardrobe come in as arguments so
 * every test is deterministic and the same inputs give the same outfit on the phone and on the server.
 */
// don't touch / extensionless re-exports: the app's bundler resolves them; Deno cannot, which is why
// scripts/bundle-engine.sh builds supabase/functions/_shared/engine.js. Re-run it after changing the engine.
export * from "./config";
export * from "./filters";
export * from "./scoring";
export * from "./candidates";
export * from "./weather";
export * from "./feedback";
export * from "./adjust";
export * from "./swap";
export * from "./laundry";
export * from "./redraw";
export * from "./compatibility";
export * from "./saved";

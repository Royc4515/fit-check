/**
 * The only surface the rest of the backend sees for AI. One function per task, each
 * behind a provider it can swap without touching callers. Every implementation must
 * write a row to `ai_calls` (see `logAiCall`) whether it succeeded or not.
 */
import type { ItemTags } from "@fit-check/schema/item-tags.ts";
import type { StylistInput, StylistOutput } from "@fit-check/schema/stylist.ts";

export interface SeparateResult {
  /** One PNG (bytes) per garment found, flat-lay style. Empty array = nothing found. */
  garments: Uint8Array[];
}

export interface CutoutResult {
  /** Transparent PNG of the garment and a 400px thumbnail. */
  cutout: Uint8Array;
  thumb: Uint8Array;
}

export interface EmbedResult {
  embedding: number[]; // length 512
  model_version: string;
}

export interface AiLogEntry {
  provider: "anthropic" | "google" | "modal";
  model: string;
  task: "separate" | "cutout" | "embed" | "tag" | "style" | "receipt";
  input_tokens?: number;
  output_tokens?: number;
  images?: number;
  cost_usd?: number;
  latency_ms: number;
  ok: boolean;
  error?: string;
}

export interface AiClient {
  separateGarments(image: Uint8Array): Promise<SeparateResult>;
  cutout(garment: Uint8Array): Promise<CutoutResult>;
  embed(cutout: Uint8Array): Promise<EmbedResult>;
  tagItem(cutout: Uint8Array, hints: { name?: string; brand?: string }): Promise<ItemTags>;
  styleOutfit(input: StylistInput): Promise<StylistOutput>;
}

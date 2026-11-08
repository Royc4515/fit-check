import { styleOutfit } from "./anthropic.ts";
import type { StylistInput } from "@fit-check/schema/stylist.ts";

const input: StylistInput = {
  context_type: "weekday",
  date_label_he: "2026-11-08 יום חול",
  weather_summary: "16-21C",
  recent_outfits_summary: [],
  candidates: [
    {
      outfit_id: "a+b+c",
      score: 0.8,
      breakdown: { color_harmony: 1, formality_consistency: 1, context_fit: 1, recency_penalty: 0, pair_weight: 0 },
      items: [
        { id: "a", slot: "top", name: "Tee", subcategory: "tshirt", color_name: "grey", formality: 3 },
        { id: "b", slot: "bottom", name: "Jeans", subcategory: "jeans", color_name: "blue", formality: 4 },
        { id: "c", slot: "shoes", name: "Sneakers", subcategory: "sneakers", color_name: "white", formality: 3 },
      ],
    },
  ],
};

Deno.test("without a key, styleOutfit returns no output and a loggable failure instead of throwing", async () => {
  Deno.env.delete("ANTHROPIC_API_KEY");
  const result = await styleOutfit(input);
  if (result.output !== null) throw new Error("expected no output");
  if (result.log.ok !== false || result.log.task !== "style" || !result.log.error?.includes("ANTHROPIC_API_KEY")) {
    throw new Error(`unexpected log ${JSON.stringify(result.log)}`);
  }
});

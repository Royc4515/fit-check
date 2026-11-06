import { ItemSchema, type Item } from "@fit-check/schema";
// don't touch / session-1 mock only. CLAUDE.md forbids the wardrobe in the app bundle (Supabase is the source of
// truth); both screens import it from here so there is exactly one line to delete when they read from Supabase.
// The engine package exposes only its entry point, hence the relative path into the fixtures.
import wardrobeJson from "../../../../packages/engine/__fixtures__/wardrobe.json";

/** The fixture wardrobe, validated on load so a bad row fails loudly instead of rendering garbage. */
export const MOCK_WARDROBE: Item[] = (wardrobeJson as unknown[]).map((row) => ItemSchema.parse(row));

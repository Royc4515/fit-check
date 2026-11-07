/**
 * What is still mock on the Today screen. The wardrobe and pair weights come from Supabase now; these need
 * their own integrations (Hebcal for the Hebrew date and Shabbat/holidays, Open-Meteo for weather) and
 * `generate-daily` for the explanation text. Each line below is deleted when its integration lands.
 */

/** The mock "today". The engine is pure and takes the date as an argument, so the screen does too. */
export const MOCK_TODAY = "2026-11-06";

/**
 * Hardcoded until Hebcal is wired (CLAUDE.md: Hebrew dates come from Hebcal, never computed locally).
 * Value verified against Intl's Hebrew calendar for MOCK_TODAY.
 */
export const MOCK_HEBREW_DATE = { he: "כ״ו בחשוון ה׳תשפ״ז", en: "26 Cheshvan 5787" } as const;

export const MOCK_WEATHER = { temp_min_c: 16, temp_max_c: 24, rain_probability: 0.1 } as const;

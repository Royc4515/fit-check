/**
 * generate-daily: runs from pg_cron every morning (06:00 Asia/Jerusalem) and on demand.
 *
 * Steps (PRD 4.3): read today's context (contexts table, Hebcal for Shabbat/holiday),
 * fetch weather (Open-Meteo), load active items + recent wears + pair weights, run the
 * engine (packages/engine) to get candidates, call styleOutfit, persist the outfit,
 * and send the push at the user's push_hour.
 *
 * Status: STUB. Returns 501 until session 2 of Claude Code wires it. Keeping the file
 * here so `supabase functions serve` already lists every function in the architecture.
 */
Deno.serve(() =>
  new Response(JSON.stringify({ error: "not implemented", function: "generate-daily" }), {
    status: 501,
    headers: { "content-type": "application/json" },
  })
);

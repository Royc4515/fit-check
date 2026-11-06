/**
 * intake-cutout: STUB. Returns 501 until wired. See PRD section 4 for the flow this function owns.
 */
Deno.serve(() =>
  new Response(JSON.stringify({ error: "not implemented", function: "intake-cutout" }), {
    status: 501,
    headers: { "content-type": "application/json" },
  })
);

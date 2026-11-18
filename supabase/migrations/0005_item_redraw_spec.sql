-- The AI redraw composer (Roy, 2026-11-18): the chips of an item's last successful redraw.
-- Two uses: a second redraw of the same item opens on the first one's choices (a correction is one tap, not a
-- rebuild), and the composer ranks detail chips and offers back free notes by how often they were used per garment
-- type. Shape: RedrawSpecSchema in packages/schema/src/redraw-spec.ts, validated on every read and write in code.
-- Not part of `tags` on purpose: tags are frozen and drive the engine; this only steers a drawing.
-- Covered by the existing `items` RLS policy (own rows only).
alter table items add column redraw_spec jsonb;

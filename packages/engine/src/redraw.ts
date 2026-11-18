import {
  cleanFreeText,
  detailDef,
  detailsFor,
  garmentOf,
  MAX_REDRAW_DETAILS,
  MAX_REDRAW_FREE,
  REDRAW_FIX_FOR_ISSUE,
  REDRAW_FIX_IDS,
  type ItemTags,
  type RedrawDetailId,
  type RedrawFixId,
  type RedrawFree,
  type RedrawSpec,
} from "@fit-check/schema";

/**
 * The redraw composer's suggestions (Roy, 2026-11-18): which detail and fix chips to show, which start selected, and
 * which free notes to offer back. Free of charge by design: the name, detection's description and issues, and past
 * redraws already say most of what a model call would.
 */

/** A past redraw of some item: its garment type comes from the spec itself. */
export type RedrawHistoryEntry = { itemId: string | null; spec: RedrawSpec };

export type RedrawSuggestInput = {
  tags: ItemTags;
  name: string;
  brand?: string | null;
  /** Detection's short description (intake only). */
  description?: string | null;
  /** Detection's issues for this photo (intake only). */
  issues?: readonly string[];
  /** This item's last redraw spec: when present it wins over every guess, so a second try starts where the first ended. */
  previous?: RedrawSpec | null;
  /** Redraws of the whole wardrobe, for ranking. Entries of this item are ignored here (previous covers them). */
  history?: readonly RedrawHistoryEntry[];
  itemId?: string | null;
};

export type RedrawSuggestion = {
  /** The spec the composer opens on. */
  spec: RedrawSpec;
  /** Every detail offered for this garment type, selected ones first, then by past use, then vocabulary order. */
  details: RedrawDetailId[];
  fixes: RedrawFixId[];
  /** Free notes typed at least twice for this garment type before, not already in the spec: offered as chips. */
  freeSuggestions: RedrawFree[];
};

/** A free note typed this often for a garment type is offered back as a ready chip. */
export const FREE_REPEAT_THRESHOLD = 2;
const MAX_FREE_SUGGESTIONS = 3;

const normalize = (s: string) => cleanFreeText(s).toLowerCase();

/**
 * Details whose keywords appear in the text, at most one per group. Within a group the longest matching keyword
 * wins, so "two pocket shirt" picks pocket_two over pocket_one even though "pocket" matches both.
 */
export function detailsFromText(text: string, offered: readonly RedrawDetailId[]): RedrawDetailId[] {
  const hay = text.toLowerCase();
  const best = new Map<string, { id: RedrawDetailId; len: number }>();
  for (const id of offered) {
    const def = detailDef(id);
    const len = Math.max(0, ...def.keywords.filter((k) => hay.includes(k)).map((k) => k.length));
    if (len === 0) continue;
    const key = def.group ?? id;
    const cur = best.get(key);
    if (!cur || len > cur.len) best.set(key, { id, len });
  }
  // Back in vocabulary order, so the result does not depend on Map insertion quirks.
  const picked = new Set([...best.values()].map((b) => b.id));
  return offered.filter((id) => picked.has(id)).slice(0, MAX_REDRAW_DETAILS);
}

/** Opening spec, chip order and free-note offers for one garment. Pure; deterministic for the same input. */
export function suggestRedraw(input: RedrawSuggestInput): RedrawSuggestion {
  const garment = garmentOf(input.tags);
  const offered = detailsFor(garment.subcategory);
  const sameType = (input.history ?? []).filter(
    (h) => h.spec.garment.subcategory === garment.subcategory && (input.itemId == null || h.itemId !== input.itemId)
  );

  const uses = new Map<RedrawDetailId, number>();
  for (const h of sameType) for (const id of h.spec.details) uses.set(id, (uses.get(id) ?? 0) + 1);

  let details: RedrawDetailId[];
  let fixes: RedrawFixId[];
  let free: RedrawFree[];
  if (input.previous) {
    // A detail the old spec had but the (maybe changed) garment type no longer takes is dropped, not kept invalid.
    details = withGroupsUnique(input.previous.details.filter((id) => offered.includes(id)));
    fixes = [...input.previous.fixes];
    free = [...input.previous.free];
  } else {
    const text = [input.name, input.brand ?? "", input.description ?? ""].join(" ");
    details = detailsFromText(text, offered);
    fixes = REDRAW_FIX_IDS.filter((f) => (input.issues ?? []).some((i) => REDRAW_FIX_FOR_ISSUE[i] === f));
    free = [];
  }

  const rank = (id: RedrawDetailId) => (details.includes(id) ? Number.MAX_SAFE_INTEGER : (uses.get(id) ?? 0));
  const ordered = [...offered].sort((a, b) => rank(b) - rank(a) || offered.indexOf(a) - offered.indexOf(b));

  const counts = new Map<string, { note: RedrawFree; n: number }>();
  for (const h of sameType) {
    for (const note of h.spec.free) {
      const key = `${note.kind}:${normalize(note.text)}`;
      const cur = counts.get(key);
      // The first spelling typed is the one offered back; later variants only add to its count.
      counts.set(key, { note: cur?.note ?? note, n: (cur?.n ?? 0) + 1 });
    }
  }
  const have = new Set(free.map((n) => `${n.kind}:${normalize(n.text)}`));
  const freeSuggestions = [...counts.entries()]
    .filter(([key, c]) => c.n >= FREE_REPEAT_THRESHOLD && !have.has(key))
    .sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
    .slice(0, MAX_FREE_SUGGESTIONS)
    .map(([, c]) => c.note);

  return {
    spec: { v: 1, name: input.name.trim() || null, garment, details, fixes, free },
    details: ordered,
    fixes: [...REDRAW_FIX_IDS],
    freeSuggestions,
  };
}

/** Keeps the first detail of each group. */
function withGroupsUnique(ids: readonly RedrawDetailId[]): RedrawDetailId[] {
  const seen = new Set<string>();
  return ids.filter((id) => {
    const g = detailDef(id).group;
    if (!g) return true;
    if (seen.has(g)) return false;
    seen.add(g);
    return true;
  });
}

/**
 * Taps a detail chip. Selecting a detail replaces any other of its group (a second collar is a swap, not an error);
 * past the cap the tap is ignored and the spec comes back unchanged, so the caller can say why.
 */
export function toggleDetail(spec: RedrawSpec, id: RedrawDetailId): RedrawSpec {
  if (spec.details.includes(id)) return { ...spec, details: spec.details.filter((d) => d !== id) };
  const group = detailDef(id).group;
  const kept = group ? spec.details.filter((d) => detailDef(d).group !== group) : spec.details;
  if (kept.length >= MAX_REDRAW_DETAILS) return spec;
  return { ...spec, details: [...kept, id] };
}

export function toggleFix(spec: RedrawSpec, id: RedrawFixId): RedrawSpec {
  return spec.fixes.includes(id)
    ? { ...spec, fixes: spec.fixes.filter((f) => f !== id) }
    : { ...spec, fixes: REDRAW_FIX_IDS.filter((f) => f === id || spec.fixes.includes(f)) };
}

/**
 * Adds or replaces an owner note. `replace` is the index of the note being edited. Text that is empty after
 * cleaning removes the note; past MAX_REDRAW_FREE, or a duplicate, leaves the spec unchanged.
 */
export function setFree(spec: RedrawSpec, note: RedrawFree, replace?: number): RedrawSpec {
  const text = cleanFreeText(note.text);
  const rest = spec.free.filter((_, i) => i !== replace);
  if (text.length < 2) return { ...spec, free: rest };
  const clean = { kind: note.kind, text };
  if (rest.some((n) => n.kind === clean.kind && normalize(n.text) === normalize(text))) return replace === undefined ? spec : { ...spec, free: rest };
  if (replace !== undefined && replace >= 0 && replace < spec.free.length) {
    return { ...spec, free: spec.free.map((n, i) => (i === replace ? clean : n)) };
  }
  if (spec.free.length >= MAX_REDRAW_FREE) return spec;
  return { ...spec, free: [...spec.free, clean] };
}

/** Turns a detail chip into an editable note (long press): the detail is removed, its words become the note's text. */
export function detailToFree(spec: RedrawSpec, id: RedrawDetailId, text: string): RedrawSpec {
  const without = { ...spec, details: spec.details.filter((d) => d !== id) };
  const next = setFree(without, { kind: "detail", text });
  // No room for a note: keep the detail rather than lose it.
  return next.free.length === without.free.length ? spec : next;
}

/** Keeps the spec's garment in step with edited tags; details the new garment type cannot take are dropped. */
export function withTags(spec: RedrawSpec, tags: ItemTags, name: string): RedrawSpec {
  const garment = garmentOf(tags);
  const offered = detailsFor(garment.subcategory);
  return { ...spec, name: name.trim() || null, garment, details: spec.details.filter((id) => offered.includes(id)) };
}

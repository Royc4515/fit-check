import type { Availability, ItemTags } from "@fit-check/schema";

/*
 * Optimistic edits of one item, as a pure queue (verification "race risks" 1-4, 2026-11-18).
 *
 * The item screen saves every change at once and shows it before the write returns. The old code kept, per write,
 * a copy of the item from the render closure and put it back on failure, which broke whenever two writes overlapped:
 * a late failure restored a value a newer write had replaced, a failed value rode along in the next write's full
 * payload, and two edits before a re-render shared one stale "before". Here instead:
 * - the item is `confirmed` (what the server last accepted) plus the `pending` edits in order; what the screen shows
 *   is always derived from those two, never stored separately;
 * - an edit carries only the fields it changes (tags key by key), so undoing it cannot touch anything else;
 * - edits to one item are written one at a time, in order; the write for an edit is `confirmed` + that edit, so a
 *   value whose write failed is never sent again;
 * - a failed edit simply leaves the queue: its fields fall back to `confirmed` unless a later pending edit sets them.
 */

/** The editable part of an item: identity, notes and availability. */
export type ItemFields = {
  name: string;
  brand: string | null;
  notes: string | null;
  availability: Availability;
  tags: ItemTags;
};

/** What one edit changes; tags are a partial object so an edit owns only the tag keys it changed. */
export type FieldPatch = {
  name?: string;
  brand?: string | null;
  notes?: string | null;
  availability?: Availability;
  tags?: Partial<ItemTags>;
};

export type QueuedEdit = { id: number; patch: FieldPatch };

export type EditQueue = {
  /** The state the server last confirmed (or the stored item when the queue started). */
  confirmed: ItemFields;
  /** Edits not yet confirmed, oldest first. The head is the one being written when `inFlight` is its id. */
  pending: readonly QueuedEdit[];
  inFlight: number | null;
};

/** One write to make: the confirmed state before it and the state it should leave on the server. */
export type WriteRequest = { id: number; before: ItemFields; after: ItemFields };

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** A new queue on the item as stored. */
export function startQueue(confirmed: ItemFields): EditQueue {
  return { confirmed, pending: [], inFlight: null };
}

/** `base` with `patch` laid over it; tag keys merge one by one. Pure. */
export function applyPatch(base: ItemFields, patch: FieldPatch): ItemFields {
  const { tags, ...rest } = patch;
  return { ...base, ...rest, tags: tags ? { ...base.tags, ...tags } : base.tags };
}

/**
 * What the screen shows: the confirmed state with every pending edit applied in order, so a newer edit of a field
 * always wins over an older one, whichever of them settles first.
 */
export function shown(q: EditQueue): ItemFields {
  return q.pending.reduce((acc, e) => applyPatch(acc, e.patch), q.confirmed);
}

/**
 * The fields that differ between `from` and `to`, tags compared key by key (arrays and objects by value).
 * @returns null when nothing differs: there is nothing to save.
 */
export function diffFields(from: ItemFields, to: ItemFields): FieldPatch | null {
  const patch: FieldPatch = {};
  if (from.name !== to.name) patch.name = to.name;
  if (from.brand !== to.brand) patch.brand = to.brand;
  if (from.notes !== to.notes) patch.notes = to.notes;
  if (from.availability !== to.availability) patch.availability = to.availability;
  const tags: Partial<ItemTags> = {};
  let tagChanged = false;
  for (const key of Object.keys(to.tags) as (keyof ItemTags)[]) {
    if (!same(from.tags[key], to.tags[key])) {
      Object.assign(tags, { [key]: to.tags[key] });
      tagChanged = true;
    }
  }
  if (tagChanged) patch.tags = tags;
  return Object.keys(patch).length > 0 ? patch : null;
}

/** Adds an edit at the end of the queue. The caller shows `shown(result)` at once. */
export function enqueue(q: EditQueue, edit: QueuedEdit): EditQueue {
  return { ...q, pending: [...q.pending, edit] };
}

/**
 * The next write, if none is in flight: the oldest pending edit, written over the confirmed state only (no other
 * pending edit, and never a failed one, is in its payload).
 * @returns the updated queue (head marked in flight) and the write to make; null when busy or empty.
 */
export function startNext(q: EditQueue): { queue: EditQueue; write: WriteRequest } | null {
  const head = q.pending[0];
  if (q.inFlight !== null || !head) return null;
  return {
    queue: { ...q, inFlight: head.id },
    write: { id: head.id, before: q.confirmed, after: applyPatch(q.confirmed, head.patch) },
  };
}

/**
 * The write of edit `id` settled. Success folds the edit into the confirmed state; failure drops it, which rolls back
 * exactly its fields unless a later pending edit sets them. Unknown ids leave the queue as it is.
 */
export function settle(q: EditQueue, id: number, ok: boolean): EditQueue {
  const edit = q.pending.find((e) => e.id === id);
  if (!edit) return q;
  return {
    confirmed: ok ? applyPatch(q.confirmed, edit.patch) : q.confirmed,
    pending: q.pending.filter((e) => e.id !== id),
    inFlight: q.inFlight === id ? null : q.inFlight,
  };
}

/** Nothing pending and nothing in flight: the queue can be dropped, the stored item is the truth again. */
export function isIdle(q: EditQueue): boolean {
  return q.pending.length === 0 && q.inFlight === null;
}

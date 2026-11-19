import { diffFields, enqueue, isIdle, settle, shown, startNext, startQueue, type EditQueue, type ItemFields } from "./editQueue";

/** Makes one write on the server: everything that differs between `before` (confirmed) and `after`. Rejects on failure. */
export type ItemWriter = (itemId: string, before: ItemFields, after: ItemFields) => Promise<void>;

/** Receives what the item should show now (the wardrobe store's copy is patched with it). */
export type Publish = (itemId: string, fields: ItemFields) => void;

type Entry = { queue: EditQueue; publish: Publish };

/**
 * Drives the pure edit queue (editQueue.ts) for every item: one queue per item while it has pending edits, writes one
 * at a time, and publishes the shown state after every change. Lives outside React on purpose: a write that settles
 * after the item screen unmounted still settles the wardrobe store, so the list is right when the user comes back
 * (verification race risk 4).
 */
export class ItemEditRunner {
  private readonly entries = new Map<string, Entry>();
  private readonly waiting = new Map<number, { resolve: () => void; reject: (e: unknown) => void }>();
  private nextId = 1;

  constructor(private readonly write: ItemWriter) {}

  /**
   * Queues one edit of an item.
   * @param stored the item as the store has it; used only when no edit of this item is pending (otherwise the queue's
   *   own state is newer than any render's copy).
   * @param change builds the item after this edit from what is shown now; null means no change.
   * @param publish shows the item's new state (called at once, and again when the write settles).
   * @returns resolves when this edit's write succeeded (at once when there was nothing to change); rejects with the
   *   write's error after the edit was rolled back.
   */
  submit(itemId: string, stored: ItemFields, change: (current: ItemFields) => ItemFields | null, publish: Publish): Promise<void> {
    const entry = this.entries.get(itemId) ?? { queue: startQueue(stored), publish };
    entry.publish = publish;
    const current = shown(entry.queue);
    const next = change(current);
    const patch = next ? diffFields(current, next) : null;
    if (!patch) return Promise.resolve();
    const id = this.nextId++;
    entry.queue = enqueue(entry.queue, { id, patch });
    this.entries.set(itemId, entry);
    const done = new Promise<void>((resolve, reject) => this.waiting.set(id, { resolve, reject }));
    publish(itemId, shown(entry.queue));
    this.pump(itemId);
    return done;
  }

  /** Whether an item has edits that are not confirmed yet (for tests and diagnostics). */
  pending(itemId: string): number {
    return this.entries.get(itemId)?.queue.pending.length ?? 0;
  }

  private pump(itemId: string): void {
    const entry = this.entries.get(itemId);
    if (!entry) return;
    const step = startNext(entry.queue);
    if (!step) {
      if (isIdle(entry.queue)) this.entries.delete(itemId);
      return;
    }
    entry.queue = step.queue;
    const { id, before, after } = step.write;
    this.write(itemId, before, after).then(
      () => this.finish(itemId, id, null),
      (error: unknown) => this.finish(itemId, id, { error })
    );
  }

  private finish(itemId: string, id: number, failure: { error: unknown } | null): void {
    const entry = this.entries.get(itemId);
    if (entry) {
      entry.queue = settle(entry.queue, id, failure === null);
      entry.publish(itemId, shown(entry.queue));
    }
    const w = this.waiting.get(id);
    this.waiting.delete(id);
    if (failure) w?.reject(failure.error);
    else w?.resolve();
    this.pump(itemId);
  }
}

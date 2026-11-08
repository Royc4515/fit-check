import type { ComponentRef } from "react";
import type { View } from "react-native";

/** Instance type of a View ref; RN 0.88 types `View` as a component, not a class. */
export type ViewNode = ComponentRef<typeof View>;

/** A rect in window coordinates, as measureInWindow reports it. */
export type Rect = { x: number; y: number; width: number; height: number };

// Route params must be serializable, a rect is transient UI state that belongs to one navigation, so it lives here.
// don't touch / keyed by item id and READ WITHOUT CONSUMING. The item route can mount more than once per push
// (the first instance was replaced and the survivor found a consume-once origin already taken, so it never
// flew). Freshness is what keeps a later deep link from replaying an old flight.
const ORIGIN_TTL_MS = 3000;
let pending: { id: string; rect: Rect; at: number } | null = null;

/** Cells register their image box so the item screen can fly back to where the item now sits. */
const cells = new Map<string, ViewNode>();

export function registerCell(id: string, node: ViewNode | null): void {
  if (node) cells.set(id, node);
  else cells.delete(id);
}

export function setOrigin(id: string, rect: Rect): void {
  pending = { id, rect, at: Date.now() };
}

/** The rect the tapped cell recorded for this item, if it is recent enough to belong to the current navigation. */
export function getOrigin(id: string): Rect | null {
  return pending && pending.id === id && Date.now() - pending.at < ORIGIN_TTL_MS ? pending.rect : null;
}

export function clearOrigin(): void {
  pending = null;
}

/** Fresh measurement of a registered cell, or null if it is not mounted (e.g. filtered out meanwhile). */
export function measureCell(id: string): Promise<Rect | null> {
  return new Promise((resolve) => {
    const node = cells.get(id);
    if (!node) return resolve(null);
    node.measureInWindow((x, y, width, height) => resolve(width > 0 && height > 0 ? { x, y, width, height } : null));
  });
}

/** Measure a node now; used by the cell that starts the transition. */
export function measureNode(node: ViewNode | null): Promise<Rect | null> {
  return new Promise((resolve) => {
    if (!node) return resolve(null);
    node.measureInWindow((x, y, width, height) => resolve(width > 0 && height > 0 ? { x, y, width, height } : null));
  });
}

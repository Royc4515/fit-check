import type { ComponentRef } from "react";
import type { View } from "react-native";
import type { TileTone } from "../../theme/tileTone";

// Hiding goes by the measured node, so every library picture that can be an origin (Tile via `imageRef`, FlatLay via
// `onPieceNode`) hides the same way, with no change in the screens that register them.
export { setOriginHidden } from "../../components/ui/originVisibility";

/** Instance type of a View ref; RN 0.88 types `View` as a component, not a class. */
export type ViewNode = ComponentRef<typeof View>;

/** A rect in window coordinates, as measureInWindow reports it. */
export type Rect = { x: number; y: number; width: number; height: number };

/**
 * Where the shared element starts (and, on the way back, ends). Everything but `rect` is optional so the original
 * `setOrigin(id, rect)` call is a complete origin: a tile whose ground is the item's own tone.
 */
export type FlightOrigin = {
  /** The origin's ground: the tile box, or for a garment lying on a shared surface, the garment itself. */
  rect: Rect;
  /** Colour of that ground; absent = the hero's own tone (a wardrobe tile already uses it). */
  tone?: TileTone;
  /**
   * Where the picture is drawn, when the origin knows it exactly (a flat-lay garment, aligned to a corner of its
   * box). Absent = the picture is `contain`ed and centred in `rect` minus `pad`.
   */
  image?: Rect;
  /** Inset of the picture inside `rect` when `image` is absent. Default: a grid tile's 12. */
  pad?: number;
  /**
   * The origin has no ground of its own (garments on Today's flat-lay, on a "goes with" surface): the hero ground
   * fades in during the flight instead of appearing at once over the neighbouring garments.
   */
  loose?: boolean;
};

/** Origin options a registered node carries; the rect comes from measuring the node. */
export type OriginStyle = Omit<FlightOrigin, "rect" | "image">;

/** A grid tile's picture inset (Tile `grid` padding), the default for origins that do not say. */
export const DEFAULT_ORIGIN_PAD = 12;

// Route params must be serializable, a rect is transient UI state that belongs to one navigation, so it lives here.
// don't touch / keyed by item id and READ WITHOUT CONSUMING. The item route can mount more than once per push
// (the first instance was replaced and the survivor found a consume-once origin already taken, so it never
// flew). Freshness is what keeps a later deep link from replaying an old flight.
const ORIGIN_TTL_MS = 3000;
/** `scope` = which registered origin started the flight; null for the wardrobe's direct `setOrigin`. */
let pending: { id: string; origin: FlightOrigin; node: ViewNode | null; scope: string | null; at: number } | null = null;

/** Cells register their image box so the item screen can fly back to where the item now sits. */
const cells = new Map<string, ViewNode>();

/**
 * Any other pressable picture (a flat-lay garment, a "goes with" garment), by scope and item id. Scoped because one
 * item can be on screen several times at once (the same shoes in three "goes with" outfits) and the flight back
 * must land on the copy that was pressed, not on whichever registered last.
 */
const origins = new Map<string, { node: ViewNode; style: OriginStyle }>();
const originKey = (scope: string, id: string) => `${scope}\u0000${id}`;

/** Wardrobe cells: register the image box (null on unmount). Unchanged since the grid first used it. */
export function registerCell(id: string, node: ViewNode | null): void {
  if (node) cells.set(id, node);
  else cells.delete(id);
}

/** Records the wardrobe cell's rect as the origin of the next flight to this item. */
export function setOrigin(id: string, rect: Rect): void {
  pending = { id, origin: { rect }, node: cells.get(id) ?? null, scope: null, at: Date.now() };
}

/** The rect the tapped cell recorded for this item, if it is recent enough to belong to the current navigation. */
export function getOrigin(id: string): Rect | null {
  return getFlightOrigin(id)?.rect ?? null;
}

export function clearOrigin(): void {
  pending = null;
}

/** Fresh measurement of a registered cell, or null if it is not mounted (e.g. filtered out meanwhile). */
export function measureCell(id: string): Promise<Rect | null> {
  return measureNode(cells.get(id) ?? null);
}

/** Measure a node now; used by the cell that starts the transition. */
export function measureNode(node: ViewNode | null): Promise<Rect | null> {
  return new Promise((resolve) => {
    if (!node) return resolve(null);
    node.measureInWindow((x, y, width, height) => resolve(width > 0 && height > 0 ? { x, y, width, height } : null));
  });
}

/**
 * Registers a pressable picture as a possible origin. The node must cover exactly the drawn picture (for `loose`
 * origins) or the tile ground (otherwise). Call with null on unmount; a node that unmounts is simply not flown back
 * to, the item screen then fades out instead.
 * @param scope - one per surface instance, e.g. `today` or `goes-with:<outfit id>`.
 */
export function registerOrigin(scope: string, id: string, node: ViewNode | null, style: OriginStyle = {}): void {
  const key = originKey(scope, id);
  // React detaches the old ref (null) before attaching a remounted node, so a delete never removes a newer node.
  if (node) origins.set(key, { node, style });
  else origins.delete(key);
}

/**
 * Measures a registered origin and records it as the start of the next flight to `id`. Resolves when the rect is
 * recorded (or known to be unavailable), so the caller pushes the route right after: the item screen needs the rect
 * on its very first frame. Never rejects; an unmeasurable origin just means the item screen fades in.
 */
export async function flyFrom(scope: string, id: string): Promise<void> {
  const entry = origins.get(originKey(scope, id));
  const rect = await measureNode(entry?.node ?? null);
  pending = rect && entry ? { id, origin: originFrom(rect, entry.style), node: entry.node, scope, at: Date.now() } : null;
}

/** The full origin (rect, tone, picture box) of a fresh flight to `id`, or null for a deep link or a stale one. */
export function getFlightOrigin(id: string): FlightOrigin | null {
  return fresh(id)?.origin ?? null;
}

/**
 * The node a fresh flight to `id` started from, so the item screen can hide its picture while the copy is in flight
 * (`setOriginHidden`). Null for a deep link or a stale origin.
 */
export function getFlightNode(id: string): ViewNode | null {
  return fresh(id)?.node ?? null;
}

/** A landing for the flight back: where to fly to, and which node's picture to hide meanwhile and show on landing. */
export type FlightReturn = { origin: FlightOrigin; node: ViewNode };

const fresh = (id: string) => (pending && pending.id === id && Date.now() - pending.at < ORIGIN_TTL_MS ? pending : null);

/**
 * Where the item screen should fly back to: the very origin it came from, measured again now (it may have scrolled
 * or re-laid out), keeping its tone. A wardrobe flight measures the item's cell (cells are recycled, so the node can
 * be a new one). Null when that origin is gone or off-layout: the caller falls back to an opacity-only exit.
 * Reads the origin recorded when the screen opened, so call `captureReturn` on mount and keep its result.
 */
export function captureReturn(id: string): () => Promise<FlightReturn | null> {
  const start = fresh(id);
  if (start?.scope) {
    const scope = start.scope;
    return async () => {
      const entry = origins.get(originKey(scope, id));
      const rect = await measureNode(entry?.node ?? null);
      return rect && entry ? { origin: originFrom(rect, entry.style), node: entry.node } : null;
    };
  }
  const style: OriginStyle = start ? { tone: start.origin.tone, pad: start.origin.pad } : {};
  // A deep link has no origin to return to, but a wardrobe cell for the item may be on screen beneath: that was the
  // behaviour before origins had scopes, and it is still the right landing.
  return async () => {
    const node = cells.get(id) ?? null;
    const rect = await measureNode(node);
    return rect && node ? { origin: { rect, ...style }, node } : null;
  };
}

/** A `loose` origin's node is the drawn picture itself, so the picture box is the rect. */
function originFrom(rect: Rect, style: OriginStyle): FlightOrigin {
  return style.loose ? { ...style, rect, image: rect } : { ...style, rect };
}

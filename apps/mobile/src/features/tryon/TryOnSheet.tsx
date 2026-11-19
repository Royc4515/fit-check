import type { Slot, TryonItem } from "@fit-check/schema";
import { Fragment, useCallback, useEffect, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Text, View, useWindowDimensions } from "react-native";
import { Button, Meta, PhotoTile, Sheet, StatusLine } from "../../components/ui";
import { clearTryOnPending, pendingTryOn, quoteTryOn, renderTryOn, runningTryOn, type RenderResult } from "../../data/tryon";
import {
  formatUsd,
  imageMaxWidth,
  imageOf,
  INITIAL,
  msUntilExpiry,
  pendingLeftMs,
  PENDING_POLL_MS,
  priceLine,
  quoteOf,
  reduceTryOn,
  showsPayAgain,
  type Failure,
  type PayMode,
  type Phase,
  type PriceLine,
  type TryOnAction,
  type TryOnState,
} from "./model";

/** A garment of the outfit as the sheet needs it: what to send, what to call it in a sentence, and its name alone. */
export type TryOnGarment = { id: string; slot: Slot; label: string; name: string };

type Props = {
  open: boolean;
  onClose: () => void;
  garments: readonly TryOnGarment[];
};

/**
 * One height for everything under the picture, in every state, so the bottom-anchored sheet's top edge and the
 * picture never move between states. Measured, not guessed: the tallest state (en, the first image with the figure's
 * line and the lost-answer warning) is 200 high at 360 wide and 160 at 390, plus 4 of slack (CHANGELOG 2026-11-19).
 */
const BELOW_H_NARROW = 204;
const BELOW_H_WIDE = 164;
/** Windows at least this wide (a 390 phone, the desktop dialog) wrap the lines less than a 360 phone does. */
const WIDE_FROM = 375;
/** Handle, title row and the scroll area's padding (measured 77) plus 15 of slack: at 360x640 the sheet still scrolled by 3 with 4. */
const CHROME_H = 92;
const PICTURE_ASPECT = 1.25;
const GAP = 12;

const ltr = (s: string) => `⁦${s}⁩`;
const MARK_OPEN = "";
const MARK_CLOSE = "";
/** The marker a value is carried by through the translation (see `Numbered`). */
const mark = (key: string) => `${MARK_OPEN}${key}${MARK_CLOSE}`;

/**
 * A translated line whose numbers are set in the numeral face and isolated left-to-right inside the running text.
 * The values go through the translation as private markers and are cut out again, so word order stays the
 * translation's own.
 */
function Numbered({ text, values }: { text: string; values: Record<string, string> }) {
  const parts = text.split(new RegExp(`${MARK_OPEN}(\\w+)${MARK_CLOSE}`));
  return (
    <Text className="font-body text-body-sm text-ink">
      {parts.map((part, i) =>
        i % 2 === 0 ? (
          <Fragment key={i}>{part}</Fragment>
        ) : (
          <Text key={i} className="font-mono text-num-sm text-ink">
            {ltr(values[part] ?? "")}
          </Text>
        )
      )}
    </Text>
  );
}

type Box = ComponentRef<typeof View>;

/** Web: focuses a view that was made focusable with tabIndex -1. Native has no such focus; nothing happens there. */
function focusView(node: Box | null): void {
  if (Platform.OS === "web" && node instanceof HTMLElement) node.focus();
}

/**
 * The "על דמות" sheet (DESIGN.md "שלב 5.3" item 2): one generated image of the outfit on the fixed figure.
 * Opening makes ONE `quote` call (free) and nothing else; every paying request starts from a press on a paying
 * button, and a second press cannot start while one is in flight (the pure reducer rejects it, and the request layer
 * shares one running request per outfit). Closing never cancels: the picture is stored by the server and the next
 * opening finds it through a fresh quote, or, in this tab, attaches to the request that is still running.
 * A paying request that ends without an answer opens a 120 s window (see `data/tryon.ts`) in which the sheet only
 * asks the free quote, every 15 s, and offers no paying button. When the garments change under the open sheet,
 * everything shown is dropped and the new outfit is quoted.
 * Failure modes: every error code and transport failure is a StatusLine with its own words; see `model.ts`.
 */
export function TryOnSheet({ open, onClose, garments }: Props) {
  const { t } = useTranslation();
  const { height, width } = useWindowDimensions();
  const belowH = width >= WIDE_FROM ? BELOW_H_WIDE : BELOW_H_NARROW;
  // A ref, not a dependency: the parent rebuilds `garments` on every render, and the sheet must not ask again for it.
  const itemsRef = useRef<TryonItem[]>([]);
  useEffect(() => {
    itemsRef.current = garments.map((g) => ({ item_id: g.id, slot: g.slot }));
  });
  // The outfit's identity: when it changes under an open sheet the sheet starts over (below).
  const itemsKey = garments
    .map((g) => g.id)
    .sort()
    .join(",");
  const [state, setState] = useState<TryOnState>(INITIAL);
  // The reducer is fed the latest state, not the rendered copy: two presses in one tick must still be one request.
  const latest = useRef<TryOnState>(INITIAL);
  // Bumped on every open and close: an answer that arrives for an earlier opening is dropped.
  const epoch = useRef(0);
  const lineRef = useRef<Box>(null);
  const pictureRef = useRef<Box>(null);
  const failureRef = useRef<Box>(null);
  const previousPhase = useRef<Phase>("quoting");

  const send = useCallback((action: TryOnAction): TryOnState => {
    const next = reduceTryOn(latest.current, action);
    if (next !== latest.current) {
      latest.current = next;
      setState(next);
    }
    return next;
  }, []);

  /**
   * Asks the free quote. `background`: the screen is already right (after a render, on expiry, while waiting for a lost
   * answer), so a failure shows nothing. `keepImage`: after a render the picture on screen is the right one, only the
   * numbers are taken. The answer carries the ticket it started with and is dropped if anything happened since.
   */
  const startQuote = useCallback(
    async (mine: number, opts: { background?: boolean; keepImage?: boolean } = {}) => {
      const ticket = send({ type: "quote_start" }).seq;
      const r = await quoteTryOn(itemsRef.current);
      if (epoch.current !== mine) return;
      if (!r.ok) {
        send({ type: "quote_failed", ticket, failure: r.failure, background: opts.background });
        return;
      }
      // The image exists: a lost answer's window is over (a repeat's old image does not count, it was always there).
      if (r.quote.cached && pendingTryOn(itemsRef.current, Date.now())?.mode !== "rerender") clearTryOnPending(itemsRef.current);
      send({ type: "quote_ok", ticket, quote: quoteOf(r.quote), image: opts.keepImage ? latest.current.image : imageOf(r.quote, Date.now()) });
    },
    [send]
  );

  const settle = useCallback(
    (mine: number, r: RenderResult) => {
      if (epoch.current !== mine) return;
      if (r.ok) {
        send({ type: "render_ok", image: { url: r.render.image_url, expiresInS: r.render.expires_in_s, at: Date.now() }, monthSpendUsd: r.render.month_spend_usd, budgetUsd: r.render.budget_usd });
        // The price of "generate again" (the figure is now made) and the balance, free. Its failure shows nothing.
        void startQuote(mine, { background: true, keepImage: true });
      } else {
        send({ type: "render_failed", failure: r.failure });
      }
    },
    [startQuote, send]
  );

  // Opening, and the outfit changing while open: start over for the garments now on screen.
  useEffect(() => {
    if (!open) return;
    epoch.current += 1;
    const mine = epoch.current;
    send({ type: "open" });
    const running = runningTryOn(itemsRef.current);
    const waiting = running ? null : pendingTryOn(itemsRef.current, Date.now());
    if (running) {
      send({ type: "open_in_flight", mode: "render" });
      void running.then((r) => settle(mine, r));
    } else if (waiting) {
      send({ type: "open_pending", mode: waiting.mode, sentAt: waiting.sentAt });
      void startQuote(mine, { background: true });
    } else {
      void startQuote(mine);
    }
    return () => {
      epoch.current += 1;
    };
    // itemsKey: a changed outfit restarts the sheet; the items themselves are read from the ref.
  }, [open, itemsKey, startQuote, settle, send]);

  // A lost answer's window: ask the free quote every 15 s, and when the window ends say so and offer the button again.
  const pendingSince = state.pendingSince;
  useEffect(() => {
    if (!open || state.phase !== "pending" || pendingSince === null) return;
    const mine = epoch.current;
    const poll = setInterval(() => void startQuote(mine, { background: true }), PENDING_POLL_MS);
    const over = setTimeout(() => {
      clearTryOnPending(itemsRef.current);
      const next = send({ type: "pending_over" });
      if (next.phase === "quoting") void startQuote(mine);
    }, pendingLeftMs(pendingSince, Date.now()));
    return () => {
      clearInterval(poll);
      clearTimeout(over);
    };
  }, [open, state.phase, pendingSince, startQuote, send]);

  // The signed address lasts ten minutes: shortly before it dies, ask `quote` for a fresh one (free, never render).
  const image = state.image;
  useEffect(() => {
    if (!open || !image || state.phase !== "result") return;
    const mine = epoch.current;
    const timer = setTimeout(() => void startQuote(mine, { background: true }), msUntilExpiry(image, Date.now()));
    return () => clearTimeout(timer);
  }, [open, image, state.phase, startQuote]);

  // Web focus: when the paying button leaves (press), focus must not fall to the page; it follows the state to the
  // generating line, then to the picture or the failure line, but never steals focus the user placed elsewhere.
  useEffect(() => {
    const from = previousPhase.current;
    previousPhase.current = state.phase;
    if (Platform.OS !== "web" || from === state.phase) return;
    const target = state.phase === "generating" || state.phase === "pending" ? lineRef : state.phase === "result" ? pictureRef : state.phase === "failed" ? failureRef : null;
    if (!target) return;
    const active = document.activeElement;
    const dialog = document.querySelector('[role="dialog"]');
    const stranded = !active || active === document.body || !(dialog?.contains(active) ?? false);
    const onLine = lineRef.current instanceof HTMLElement && active === lineRef.current;
    if (stranded || onLine) focusView(target.current);
  }, [state.phase]);

  const pay = (mode: PayMode) => {
    const before = latest.current;
    const next = send({ type: "press", mode });
    if (next === before) return;
    const mine = epoch.current;
    void renderTryOn(itemsRef.current, { again: mode === "rerender" }).then((r) => settle(mine, r));
  };

  const retry = () => {
    const before = latest.current;
    const next = send({ type: "retry" });
    if (next === before) return;
    const mine = epoch.current;
    if (next.phase === "quoting") void startQuote(mine);
    else if (next.phase === "generating" && next.paying) void renderTryOn(itemsRef.current, { again: next.paying === "rerender" }).then((r) => settle(mine, r));
  };

  const onImageError = () => {
    const before = latest.current;
    const next = send({ type: "image_stale" });
    if (next !== before && next.phase === "quoting") void startQuote(epoch.current);
  };

  const pieces = garments.map((g) => g.label).join(", ");
  const maxWidth = imageMaxWidth(height, CHROME_H + GAP + belowH, PICTURE_ASPECT);
  const picture = (props: { uri?: string; loading?: boolean }) => (
    <View ref={pictureRef} tabIndex={-1} style={{ width: "100%", maxWidth, alignSelf: "center" }}>
      <PhotoTile
        // A new instance per stored address: a tile that already failed on an address does not try (or report) it again.
        key={props.uri ? `${state.image?.at}` : "none"}
        aspect={PICTURE_ASPECT}
        fit="cover"
        uri={props.uri}
        loading={props.loading}
        emptyLabel={props.uri || props.loading ? undefined : t("tryon.empty")}
        onError={onImageError}
        accessibilityLabel={props.uri ? t("tryon.imageLabel", { pieces }) : props.loading ? t("tryon.generating") : t("tryon.empty")}
      />
    </View>
  );

  const money = (n: number) => formatUsd(n);
  const priceFull = (line: Extract<PriceLine, { kind: "known" }>) => (
    <Numbered
      text={t("tryon.price", { price: mark("price"), left: mark("left"), budget: mark("budget") })}
      values={{ price: money(line.price), left: money(line.left), budget: money(line.budget) }}
    />
  );
  /** Under 1 image left is "not enough", zero is "used up". */
  const budgetLine = (line: Extract<PriceLine, { kind: "budget_reached" }>) => (
    <StatusLine variant="error" message={t(line.left > 0 ? "tryon.error.budget_low" : "tryon.error.budget_reached")} />
  );
  const priceText = (line: PriceLine): ReactNode => {
    if (line.kind === "known") {
      return (
        <>
          {priceFull(line)}
          {line.includesFigure ? <Meta>{t("tryon.includesFigure")}</Meta> : null}
        </>
      );
    }
    if (line.kind === "unknown") {
      return (
        <>
          <Numbered text={t("tryon.priceUnknown", { price: mark("price") })} values={{ price: money(line.price) }} />
          {line.includesFigure ? <Meta>{t("tryon.includesFigure")}</Meta> : null}
        </>
      );
    }
    return budgetLine(line);
  };

  const failureMessage = (f: Failure): string => {
    if (f.reason === "item_has_no_image") {
      const name = garments.find((g) => g.id === f.itemId)?.name;
      return name ? t("tryon.error.item_has_no_image", { name }) : t("tryon.error.item_has_no_image_unnamed");
    }
    return t(`tryon.error.${f.reason}`);
  };

  const quote = state.quote;
  const line = quote ? priceLine(quote) : null;
  const lostWarning = state.warnLost ? <Meta>{t("tryon.lostWarning")}</Meta> : null;
  const waiting = (text: string) => (
    <View ref={lineRef} tabIndex={-1}>
      <Text accessibilityLiveRegion="polite" className="font-body text-body-sm text-ink-soft text-center">
        {text}
      </Text>
    </View>
  );

  let pic: ReactNode;
  let below: ReactNode = null;
  switch (state.phase) {
    case "preview":
      pic = picture({});
      below = <StatusLine variant="info" message={t("tryon.preview")} />;
      break;
    case "quoting":
      pic = picture({ loading: true });
      break;
    case "ready":
      pic = picture({});
      below = (
        <>
          {line ? priceText(line) : null}
          {line?.kind === "known" ? (
            <>
              {lostWarning}
              <Button variant="ink" fullWidth label={t("tryon.generate")} onPress={() => pay("render")} />
            </>
          ) : null}
        </>
      );
      break;
    case "generating":
      pic = picture({ loading: true });
      below = waiting(t("tryon.generating"));
      break;
    case "pending":
      // A lost repeat keeps showing the earlier image; a lost first image shows the reserved place.
      pic = state.image ? picture({ uri: state.image.url }) : picture({ loading: true });
      below = waiting(t("tryon.pending"));
      break;
    case "result":
      pic = picture({ uri: state.image?.url });
      below = (
        <>
          <Meta>{t("tryon.notice")}</Meta>
          {line?.kind === "known" ? (
            <>
              {lostWarning}
              <View className="items-start">
                <Button
                  variant="text"
                  label={t("tryon.againLabel", { price: ltr(money(line.price)) })}
                  accessibilityLabel={t("tryon.againA11y", { price: money(line.price) })}
                  onPress={() => pay("rerender")}
                />
              </View>
            </>
          ) : line?.kind === "unknown" ? (
            <Meta>{t("tryon.balanceUnknown")}</Meta>
          ) : line ? (
            budgetLine(line)
          ) : null}
        </>
      );
      break;
    case "failed": {
      const f = state.failure ?? { reason: "network" as const };
      const paid = showsPayAgain(state) && line?.kind === "known";
      pic = state.image ? picture({ uri: state.image.url }) : picture({});
      below = (
        <>
          {paid && line?.kind === "known" ? priceFull(line) : null}
          <View ref={failureRef} tabIndex={-1}>
            <StatusLine
              variant="error"
              message={failureMessage(f)}
              action={
                state.retry
                  ? paid && line?.kind === "known"
                    ? { label: t("tryon.retryPaid", { price: ltr(money(line.price)) }), accessibilityLabel: t("tryon.retryPaidA11y", { price: money(line.price) }), onPress: retry }
                    : { label: t("tryon.retry"), onPress: retry }
                  : undefined
              }
            />
          </View>
        </>
      );
      break;
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t("tryon.title")}>
      <View style={{ gap: GAP }}>
        {pic}
        <View style={{ minHeight: belowH, gap: GAP }}>{below}</View>
        {/* Announced once when an image arrives from a paying request; empty (but present) the rest of the time. */}
        <Text accessibilityLiveRegion="polite" style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}>
          {state.phase === "result" && state.fresh ? t("tryon.ready") : ""}
        </Text>
      </View>
    </Sheet>
  );
}

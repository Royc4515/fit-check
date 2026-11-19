import type { Slot, TryonItem } from "@fit-check/schema";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, useWindowDimensions } from "react-native";
import { Button, Meta, PhotoTile, Sheet, StatusLine } from "../../components/ui";
import { quoteTryOn, renderTryOn, runningTryOn, type RenderResult } from "../../data/tryon";
import {
  formatUsd,
  imageMaxWidth,
  imageOf,
  INITIAL,
  msUntilExpiry,
  priceLine,
  quoteOf,
  reduceTryOn,
  showsPayAgain,
  type Failure,
  type PayMode,
  type PriceLine,
  type TryOnAction,
  type TryOnState,
} from "./model";

/** A garment of the outfit as the sheet needs it: what to send, and what to call it for a reader. */
export type TryOnGarment = { id: string; slot: Slot; label: string };

type Props = {
  open: boolean;
  onClose: () => void;
  garments: readonly TryOnGarment[];
};

/** Height the sheet spends on everything but the picture (handle, title, price lines, button, gaps). */
const RESERVED = 260;
const PICTURE_ASPECT = 1.25;
const GAP = 12;

const ltr = (s: string) => `⁦${s}⁩`;
const MARK_OPEN = "";
const MARK_CLOSE = "";

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

/**
 * The "על דמות" sheet (DESIGN.md "שלב 5.3" item 2): one generated image of the outfit on the fixed figure.
 * Opening makes ONE `quote` call (free) and nothing else; every paying request starts from a press on a paying
 * button, and a second press cannot start while one is in flight (the pure reducer rejects it, and the request layer
 * shares one running request per outfit). Closing never cancels: the picture is stored by the server and the next
 * opening finds it through a fresh quote, or, in this tab, attaches to the request that is still running.
 * Failure modes: every error code and transport failure is a StatusLine with its own words; see `model.ts`.
 */
export function TryOnSheet({ open, onClose, garments }: Props) {
  const { t } = useTranslation();
  const { height } = useWindowDimensions();
  // A ref, not a dependency: the parent rebuilds `garments` on every render, and the sheet must not ask again for it.
  const itemsRef = useRef<TryonItem[]>([]);
  useEffect(() => {
    itemsRef.current = garments.map((g) => ({ item_id: g.id, slot: g.slot }));
  });
  const [state, setState] = useState<TryOnState>(INITIAL);
  // The reducer is fed the latest state, not the rendered copy: two presses in one tick must still be one request.
  const latest = useRef<TryOnState>(INITIAL);
  // Bumped on every open and close: an answer that arrives for an earlier opening is dropped.
  const epoch = useRef(0);

  const send = useCallback((action: TryOnAction): TryOnState => {
    const next = reduceTryOn(latest.current, action);
    if (next !== latest.current) {
      latest.current = next;
      setState(next);
    }
    return next;
  }, []);

  const runQuote = useCallback(
    async (mine: number, keepImage = false) => {
      const r = await quoteTryOn(itemsRef.current);
      if (epoch.current !== mine) return;
      if (!r.ok) {
        send({ type: "quote_failed", failure: r.failure });
        return;
      }
      // After a render the picture on screen is already the right one: only the numbers are taken from the quote.
      send({ type: "quote_ok", quote: quoteOf(r.quote), image: keepImage ? latest.current.image : imageOf(r.quote, Date.now()) });
    },
    [send]
  );

  const settle = useCallback(
    (mine: number, r: RenderResult) => {
      if (epoch.current !== mine) return;
      if (r.ok) {
        send({ type: "render_ok", image: { url: r.render.image_url, expiresInS: r.render.expires_in_s, at: Date.now() }, monthSpendUsd: r.render.month_spend_usd, budgetUsd: r.render.budget_usd });
        // The price of "generate again" (the figure is now made) and the balance, free.
        void runQuote(mine, true);
      } else {
        send({ type: "render_failed", failure: r.failure });
      }
    },
    [runQuote, send]
  );

  useEffect(() => {
    if (!open) return;
    epoch.current += 1;
    const mine = epoch.current;
    send({ type: "open" });
    const running = runningTryOn(itemsRef.current);
    if (running) {
      send({ type: "open_in_flight", mode: "render" });
      void running.then((r) => settle(mine, r));
    } else {
      void runQuote(mine);
    }
    return () => {
      epoch.current += 1;
    };
  }, [open, runQuote, settle, send]);

  // The signed address lasts ten minutes: shortly before it dies, ask `quote` for a fresh one (free, never render).
  const image = state.image;
  useEffect(() => {
    if (!open || !image || state.phase !== "result") return;
    const mine = epoch.current;
    const timer = setTimeout(() => void runQuote(mine), msUntilExpiry(image, Date.now()));
    return () => clearTimeout(timer);
  }, [open, image, state.phase, runQuote]);

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
    if (next.phase === "quoting") void runQuote(mine);
    else if (next.phase === "generating" && next.paying) void renderTryOn(itemsRef.current, { again: next.paying === "rerender" }).then((r) => settle(mine, r));
  };

  const onImageError = () => {
    const before = latest.current;
    const next = send({ type: "image_stale" });
    if (next !== before && next.phase === "quoting") void runQuote(epoch.current);
  };

  const pieces = garments.map((g) => g.label).join(", ");
  const maxWidth = imageMaxWidth(height, RESERVED, PICTURE_ASPECT);
  const picture = (props: { uri?: string; loading?: boolean; emptyLabel?: string }) => (
    <View style={{ width: "100%", maxWidth, alignSelf: "center" }}>
      <PhotoTile
        aspect={PICTURE_ASPECT}
        fit="cover"
        uri={props.uri}
        loading={props.loading}
        emptyLabel={props.emptyLabel}
        onError={onImageError}
        accessibilityLabel={props.uri ? t("tryon.imageLabel", { pieces }) : (props.emptyLabel ?? t("tryon.generating"))}
      />
    </View>
  );

  const money = (n: number) => formatUsd(n);
  const priceText = (line: PriceLine): ReactNode => {
    if (line.kind === "known") {
      const values = { price: money(line.price), left: money(line.left), budget: money(line.budget) };
      return (
        <>
          <Numbered text={t("tryon.price", { price: mark("price"), left: mark("left"), budget: mark("budget") })} values={values} />
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
    return <StatusLine variant="error" message={t("tryon.error.budget_reached")} />;
  };

  const failureMessage = (f: Failure): string => {
    if (f.reason === "item_has_no_image") {
      const name = garments.find((g) => g.id === f.itemId)?.label;
      return name ? t("tryon.error.item_has_no_image", { name }) : t("tryon.error.item_has_no_image_unnamed");
    }
    return t(`tryon.error.${f.reason}`);
  };

  const quote = state.quote;
  const line = quote ? priceLine(quote) : null;
  let body: ReactNode;
  switch (state.phase) {
    case "preview":
      body = <StatusLine variant="info" message={t("tryon.preview")} />;
      break;
    case "quoting":
      body = picture({ loading: true });
      break;
    case "ready":
      body = (
        <>
          {picture({ emptyLabel: t("tryon.empty") })}
          {line ? priceText(line) : null}
          {line?.kind === "known" ? <Button variant="ink" fullWidth label={t("tryon.generate")} onPress={() => pay("render")} /> : null}
        </>
      );
      break;
    case "generating":
      body = (
        <>
          {picture({ loading: true })}
          <Text accessibilityLiveRegion="polite" className="font-body text-body-sm text-ink-soft text-center">
            {t("tryon.generating")}
          </Text>
        </>
      );
      break;
    case "result":
      body = (
        <>
          {picture({ uri: state.image?.url })}
          <Meta>{t("tryon.notice")}</Meta>
          {line?.kind === "known" ? (
            <View className="items-start">
              <Button
                variant="text"
                label={t("tryon.againLabel", { price: ltr(money(line.price)) })}
                accessibilityLabel={t("tryon.againA11y", { price: money(line.price) })}
                onPress={() => pay("rerender")}
              />
            </View>
          ) : line?.kind === "unknown" ? (
            <Meta>{t("tryon.balanceUnknown")}</Meta>
          ) : line ? (
            <StatusLine variant="error" message={t("tryon.error.budget_reached")} />
          ) : null}
        </>
      );
      break;
    case "failed": {
      const f = state.failure ?? { reason: "network" as const };
      body = (
        <>
          {state.image ? picture({ uri: state.image.url }) : null}
          {showsPayAgain(state) && line?.kind === "known" ? <Numbered text={t("tryon.price", { price: mark("price"), left: mark("left"), budget: mark("budget") })} values={{ price: money(line.price), left: money(line.left), budget: money(line.budget) }} /> : null}
          <StatusLine variant="error" message={failureMessage(f)} action={state.retry ? { label: t("tryon.retry"), onPress: retry } : undefined} />
        </>
      );
      break;
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={t("tryon.title")}>
      <View style={{ gap: GAP }}>{body}</View>
    </Sheet>
  );
}

/** The marker a value is carried by through the translation (see `Numbered`). */
const mark = (key: string) => `${MARK_OPEN}${key}${MARK_CLOSE}`;

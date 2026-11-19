import type { IntakeQuoteResult, Item, ItemTags, RedrawSpec } from "@fit-check/schema";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { Button, ListRow, Sheet, StatusLine } from "../../components/ui";
import { enhanceCutout, preparePhoto, reasonOf, removeBackground, sourceCropPath, wholePhotoGarment } from "../../data/intake";
import { quoteRedraw, saveRedrawSpec } from "../../data/redraw";
import { failureMessage, isRetryable } from "../intake/failure";
import { normalizeTags } from "../intake/tagRules";
import { RedrawComposer } from "../redraw/RedrawComposer";
import { colorHexFor, type ItemEdits } from "./edit";
import { recutReplacesImproved } from "./recut";

/** What the picture is doing, for the status line under the hero. */
export type ImageStatus =
  | { kind: "replacing" }
  | { kind: "recutting" }
  | { kind: "kept-uncut" }
  | { kind: "failed"; message: string; retry?: () => void };

type Props = {
  item: Item;
  edits: ItemEdits;
  open: boolean;
  onClose: () => void;
  /** The item was archived: the screen closes. */
  onRemoved: () => void;
  onImageStatus: (status: ImageStatus | null) => void;
};

/** Reasons the data layer answers with (`intake.reason.*`); anything else reads as the generic failure. */
const KNOWN_REASONS = new Set([
  "billing_required",
  "rate_limited",
  "monthly_limit",
  "daily_limit",
  "network",
  "bad_response",
  "preview",
  "ai_failed",
  "not_found",
]);

class ReasonError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/** What the sheet shows: the rows, or the confirm step of removing the item or of a re-cut that replaces an improved picture. */
type Step = "rows" | "remove" | "recut";

/** Display price of one redraw, as the composer shows it. */
const priceOf = (q: IntakeQuoteResult | null) => (q?.ok ? `$${q.price_usd.toFixed(3)}` : null);

/**
 * The item's `more_horiz` sheet (DESIGN.md section 3 "פריט" item 6 and "שלב 2"): replace the photo, improve with AI
 * (only when the picture has a source crop to redraw from; the price is on the row), remove the background again
 * from that same crop (free; behind a confirm step when the current picture is an AI redraw or a hand-cleaned one,
 * which the cutout of the raw photo would replace), and remove from the wardrobe behind a confirm
 * step inside the sheet. No accent anywhere: removal is ink text and an ink confirm button, not a red one.
 * The AI composer opens in its own sheet; its submit button carries the price, and that is the only confirmation.
 */
export function ItemActions({ item, edits, open, onClose, onRemoved, onImageStatus }: Props) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>("rows");
  const [removing, setRemoving] = useState(false);
  const [removeFailed, setRemoveFailed] = useState(false);
  const [quote, setQuote] = useState<IntakeQuoteResult | null>(null);
  // Composer: `composing` holds it mounted through its sheet's closing animation; `opening` is a fresh key per open.
  const [composing, setComposing] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [opening, setOpening] = useState(0);
  // The composer's garment words are tag edits that stay a draft until a redraw succeeds (as in the old editor).
  const [draftTags, setDraftTags] = useState<ItemTags>(item.tags);
  const [drawing, setDrawing] = useState(false);
  const [drawError, setDrawError] = useState<string | null>(null);
  const canRedraw = sourceCropPath(item.cutout_path) !== null;
  const [recutting, setRecutting] = useState(false);
  // A ref, not the state: the retry on the failure line is a closure from an earlier render.
  const recutBusy = useRef(false);

  // The price is free to ask for; it is on the row before anything is spent. Asked once, on the first opening.
  const wantsQuote = open && canRedraw;
  useEffect(() => {
    if (!wantsQuote || quote) return;
    let live = true;
    void quoteRedraw().then((q) => live && setQuote(q));
    return () => {
      live = false;
    };
  }, [wantsQuote, quote]);

  const close = () => {
    setStep("rows");
    setRemoveFailed(false);
    onClose();
  };

  /** A new photo of the same garment: uploaded as a fresh crop, cut out when the worker can. */
  const replacePhoto = async () => {
    close();
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
    const asset = picked.canceled ? undefined : picked.assets[0];
    if (!asset) return;
    onImageStatus({ kind: "replacing" });
    try {
      const photo = await preparePhoto(asset.uri, asset.width, asset.height);
      const crop = await wholePhotoGarment(edits.userId, photo, `edit-${Date.now()}`);
      const cut = await removeBackground(crop.path);
      await edits.setImage(item.id, cut.ok ? cut.path : crop.path, cut.ok ? cut.thumb_path : null);
      // The photo is kept even without its background removed (better than nothing), but the user should know why
      // it looks different from the rest of the wardrobe.
      onImageStatus(cut.ok ? null : { kind: "kept-uncut" });
    } catch (error) {
      console.error("Item replacing failed", error);
      onImageStatus({ kind: "failed", message: t("item.edit.failed.replacing") });
    }
  };

  /**
   * Removes the background again from the item's own source crop, through the same worker call "replace photo" uses
   * (intake-cutout, free). Success points the item at the new cutout, so the hero shows it. A failure says why under
   * the hero, with a retry when trying again can help (never for the design preview, which blocks the call).
   */
  const recut = async () => {
    close();
    const source = sourceCropPath(item.cutout_path);
    if (!source || recutBusy.current) return;
    recutBusy.current = true;
    setRecutting(true);
    onImageStatus({ kind: "recutting" });
    try {
      const cut = await removeBackground(source);
      if (!cut.ok) throw new ReasonError(cut.reason);
      await edits.setImage(item.id, cut.path, cut.thumb_path);
      onImageStatus(null);
    } catch (error) {
      console.error("Item re-cut failed", error);
      const reason = error instanceof ReasonError ? error.reason : reasonOf(error);
      const message = reason === "not_configured" ? t("item.recut.notConfigured") : failureMessage(t, reason);
      onImageStatus({ kind: "failed", message, retry: isRetryable(reason) ? () => void recut() : undefined });
    } finally {
      recutBusy.current = false;
      setRecutting(false);
    }
  };

  const openComposer = () => {
    close();
    setDraftTags(item.tags);
    setDrawError(null);
    setOpening((n) => n + 1);
    setComposing(true);
    setComposerOpen(true);
  };

  /**
   * Redraws from the real crop (never from an earlier redraw), then removes the redraw's white background. Words
   * changed in the composer are tag edits, saved with the new image through the same payload builder as every other
   * edit: otherwise the wardrobe would show a navy shirt the engine still thinks is black. The spec is stored so the
   * next redraw starts from it.
   */
  const enhance = async (spec: RedrawSpec) => {
    setDrawing(true);
    setDrawError(null);
    try {
      const source = sourceCropPath(item.cutout_path);
      if (!source) throw new ReasonError("not_found");
      const drawn = await enhanceCutout(source, spec);
      if (!drawn.ok) throw new ReasonError(drawn.reason);
      await edits.save(item.id, { tags: draftTags });
      // The server usually clears the white itself; the worker is only asked when that check declined.
      if (drawn.transparent) await edits.setImage(item.id, drawn.path, null);
      else {
        const cut = await removeBackground(drawn.path);
        await edits.setImage(item.id, cut.ok ? cut.path : drawn.path, cut.ok ? cut.thumb_path : null);
        onImageStatus(cut.ok ? null : { kind: "kept-uncut" });
      }
      await saveRedrawSpec(item.id, spec);
      setComposerOpen(false);
    } catch (error) {
      console.error("Item enhancing failed", error);
      const reason = error instanceof ReasonError && KNOWN_REASONS.has(error.reason) ? error.reason : null;
      setDrawError(reason ? t(`intake.reason.${reason}`) : t("item.edit.failed.enhancing"));
    } finally {
      setDrawing(false);
    }
  };

  /** Not removing after all: the confirm step and its failure line go together (an error belongs to its action). */
  const keep = () => {
    setStep("rows");
    setRemoveFailed(false);
  };

  const remove = async () => {
    setRemoving(true);
    setRemoveFailed(false);
    try {
      await edits.archive(item.id);
      close();
      onRemoved();
    } catch (error) {
      console.error("Item removing failed", error);
      setRemoveFailed(true);
    } finally {
      setRemoving(false);
    }
  };

  const price = priceOf(quote);

  return (
    <>
      <Sheet open={open} onClose={close} title={item.name}>
        {step === "recut" ? (
          // An improved picture (AI redraw, hand-cleaned) would be replaced by a cutout of the raw photo: say so and
          // send nothing before the confirmation (verification D1: a silent re-cut replaced 82 of 82 such pictures).
          <View style={{ gap: 16 }}>
            <Text className="font-body text-body text-ink">{t("item.recut.confirmTitle")}</Text>
            <Text className="font-body text-body-sm text-ink-soft">{t("item.recut.confirmBody")}</Text>
            <View className="flex-row flex-wrap items-center" style={{ columnGap: 12, rowGap: 8 }}>
              <Button variant="ink" label={t("item.recut.confirm")} onPress={() => void recut()} />
              <Button variant="outline" label={t("item.recut.cancel")} onPress={() => setStep("rows")} />
            </View>
          </View>
        ) : step === "remove" ? (
          <View style={{ gap: 16 }}>
            <Text className="font-body text-body text-ink">{t("item.actions.removeTitle")}</Text>
            <Text className="font-body text-body-sm text-ink-soft">{t("item.actions.removeBody")}</Text>
            {removeFailed ? <StatusLine variant="error" message={t("item.edit.failed.removing")} /> : null}
            <View className="flex-row flex-wrap items-center" style={{ columnGap: 24, rowGap: 8 }}>
              <Button variant="ink" label={removing ? t("item.edit.removing") : t("item.actions.removeConfirm")} disabled={removing} onPress={() => void remove()} />
              <Button variant="text" label={t("item.actions.keep")} disabled={removing} onPress={keep} />
            </View>
          </View>
        ) : (
          <View className="border-t border-hairline">
            <ListRow label={t("item.edit.replacePhoto")} onPress={() => void replacePhoto()} />
            {canRedraw ? <ListRow label={t("intake.enhance")} value={price ?? undefined} onPress={openComposer} /> : null}
            {/* Free, so no price on the row; only when there is a source crop to cut from. */}
            {canRedraw ? (
              <ListRow
                label={t("item.recut.row")}
                onPress={() => (recutReplacesImproved(item.cutout_path) ? setStep("recut") : void recut())}
                disabled={recutting}
              />
            ) : null}
            <ListRow label={t("item.edit.remove")} onPress={() => setStep("remove")} />
          </View>
        )}
      </Sheet>
      {composing ? (
        <RedrawComposer
          key={opening}
          sheet={{ open: composerOpen, title: t("intake.enhance") }}
          tags={draftTags}
          name={item.name}
          brand={item.brand ?? ""}
          itemId={item.id}
          onTagsChange={(patch) => setDraftTags((cur) => normalizeTags({ ...cur, ...patch }))}
          colorHex={(c) => colorHexFor(item, c)}
          onSubmit={(spec) => void enhance(spec)}
          onCancel={() => {
            // Closing the composer's sheet takes its failure line with it.
            setDrawError(null);
            setComposerOpen(false);
          }}
          busy={drawing}
          error={drawError}
        />
      ) : null}
    </>
  );
}

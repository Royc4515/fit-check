import type { Availability, Item } from "@fit-check/schema";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { Button, Meta, Segmented, Sheet, StatusLine, type Segment } from "../../components/ui";

const AVAILABILITY: readonly Availability[] = ["home", "laundry", "away", "lent"];

type Props = {
  /** The item as it is now (re-read from the wardrobe on every render, so an optimistic move shows at once). */
  item: Item | null;
  open: boolean;
  onClose: () => void;
  /** Optimistic move; rejects when the write failed (the caller has already moved it back). */
  onAvailability?: (item: Item, next: Availability) => Promise<void>;
  /** Closes the sheet and opens the item screen. */
  onOpenItem: (item: Item) => void;
  /** Archives the item; rejects when the write failed. */
  onArchive?: (item: Item) => Promise<void>;
};

type Failure = "move" | "archive" | null;

/**
 * Long-press actions for one tile (DESIGN.md section 3 "ארון" item 8): where the item is (four states, applied the
 * moment it is tapped), a way into the item, and removal behind a second, explicit tap. Everything here also exists
 * on the item screen, so the long press is a shortcut, never the only way.
 */
export function ItemActionsSheet({ item, open, onClose, onAvailability, onOpenItem, onArchive }: Props) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<Failure>(null);
  // The sheet keeps the last item through its closing animation; the next item starts clean.
  // Reset during render (not in an effect) when the item or the open state changes, so no stale frame shows.
  const key = `${item?.id ?? ""}|${open}`;
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    setConfirming(false);
    setFailed(null);
  }

  if (!item) return null;

  const segments: Segment<Availability>[] = AVAILABILITY.map((a) => ({ key: a, label: t(`wardrobe.availability.${a}`) }));

  const move = (next: Availability) => {
    if (!onAvailability) return;
    setFailed(null);
    onAvailability(item, next).catch((error: unknown) => {
      console.error("Availability change failed", error);
      setFailed("move");
    });
  };

  const archive = () => {
    if (!onArchive) return;
    setBusy(true);
    setFailed(null);
    onArchive(item)
      .then(onClose)
      .catch((error: unknown) => {
        console.error("Archive failed", error);
        setFailed("archive");
        setConfirming(false);
      })
      .finally(() => setBusy(false));
  };

  return (
    <Sheet open={open} onClose={onClose} title={item.name}>
      {onAvailability ? (
        <View className="mt-2">
          <Meta tone="text-ink-soft">{t("wardrobe.actions.availability")}</Meta>
          <View className="mt-2">
            <Segmented segments={segments} value={item.availability} onChange={move} accessibilityLabel={t("wardrobe.actions.availability")} />
          </View>
        </View>
      ) : null}
      {failed ? (
        <View className="mt-4">
          <StatusLine variant="error" message={t(failed === "move" ? "wardrobe.actions.failed" : "wardrobe.actions.removeFailed")} />
        </View>
      ) : null}
      <View className="mt-6">
        <Button variant="outline" label={t("wardrobe.actions.open")} onPress={() => onOpenItem(item)} fullWidth />
      </View>
      {onArchive ? (
        <View className="mt-4">
          {confirming ? (
            <View>
              <Text className="font-body text-body-sm text-ink-soft">{t("wardrobe.actions.confirm")}</Text>
              <View className="mt-4 flex-row items-center" style={{ gap: 16 }}>
                <Button variant="ink" label={t("wardrobe.actions.confirmRemove")} onPress={archive} disabled={busy} />
                <Button variant="text" label={t("wardrobe.actions.keep")} onPress={() => setConfirming(false)} disabled={busy} />
              </View>
            </View>
          ) : (
            <Button variant="text" label={t("wardrobe.actions.remove")} onPress={() => setConfirming(true)} />
          )}
        </View>
      ) : null}
    </Sheet>
  );
}

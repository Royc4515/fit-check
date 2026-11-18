import { useTranslation } from "react-i18next";
import { Text, View, useWindowDimensions } from "react-native";
import { Display, Meta, PhotoTile, Skeleton, StatusLine } from "../../components/ui";
import type { PendingPhoto } from "../../data/intake";
import { isRtl } from "../../i18n";
import { layout } from "../../theme/tokens";
import { failureMessage, isRetryable } from "./failure";
import type { PendingQueueState } from "./usePendingQueue";
import { uploadedLabel } from "./uploadedLabel";

/** Thumbnails per row: 3 on a phone, 6 in the desktop column (DESIGN.md "תור ההזנה"). */
const PHONE_COLUMNS = 3;
const DESKTOP_COLUMNS = 6;
const GAP = 8;
const SKELETONS = 3;

/** Meta is uppercase and tracked in English; the explanation is a sentence. */
const SENTENCE = { textTransform: "none", letterSpacing: 0 } as const;

type Props = {
  state: PendingQueueState;
  onRetry: () => void;
  /** The clock for the captions; passed in so the gallery's fixtures do not drift. */
  now: number;
  /** On the screen the section starts 48 below the controls; the gallery stacks it under its own label. */
  spaced?: boolean;
};

/** Splits into rows of `n`, the last one padded with nulls so every cell keeps the same width. */
function rows<T>(list: readonly T[], n: number): (T | null)[][] {
  const out: (T | null)[][] = [];
  for (let i = 0; i < list.length; i += n) {
    const row: (T | null)[] = list.slice(i, i + n);
    while (row.length < n) row.push(null);
    out.push(row);
  }
  return out;
}

/**
 * "Waiting for Claude" (DESIGN.md section 3, stage 2 "תור ההזנה"): the photos sent with "send to Claude" that Claude
 * has not tagged yet, as square thumbnails with when each was uploaded. Not rendered when the queue is empty.
 * Read-only on purpose: the bucket has no delete policy, so dismissing a photo stays in the chat (MCP intake_dismiss),
 * and the thumbnails are images, not buttons. Presentational: the screen owns loading (usePendingQueue).
 */
export function PendingQueue({ state, onRetry, now, spaced = true }: Props) {
  const { t, i18n } = useTranslation();
  const columns = useWindowDimensions().width >= layout.desktopMin ? DESKTOP_COLUMNS : PHONE_COLUMNS;
  if (state.status === "ready" && state.photos.length === 0) return null;
  const locale = i18n.language === "en" ? "en" : "he";
  const count = state.status === "ready" ? state.photos.length : undefined;

  const cell = (photo: PendingPhoto) => {
    const when = uploadedLabel(photo.uploadedAt, now, locale);
    return (
      <>
        <PhotoTile
          uri={photo.url}
          size="mini"
          aspect={1}
          fit="cover"
          accessibilityLabel={when ? t("intake.queue.photo", { when }) : t("intake.queue.photoUndated")}
        />
        {/* The tile already says it to a screen reader; read once. */}
        {when ? (
          <Meta style={SENTENCE} className="mt-2" numberOfLines={1} importantForAccessibility="no" aria-hidden>
            {when}
          </Meta>
        ) : null}
      </>
    );
  };

  return (
    <View className={spaced ? "mt-12" : ""} testID="pending-queue">
      <View className="flex-row items-baseline" style={{ gap: 8 }}>
        <Display className="flex-shrink">{t("intake.queue.title")}</Display>
        {count !== undefined ? (
          // Isolated LTR run, like ScreenHeader's count.
          <Text className="font-mono text-num-sm text-ink-soft" accessibilityLabel={t("intake.queue.count", { count })}>
            {`⁦${count}⁩`}
          </Text>
        ) : null}
      </View>
      {/* don't touch / explicit direction: the Hebrew sentence starts with "Claude", a Latin word, so the browser's
          first-strong rule laid it out left-to-right with the full stop at the wrong end (same as oauth/consent). */}
      <Meta style={[SENTENCE, { writingDirection: isRtl() ? "rtl" : "ltr" }]} className="mt-2">
        {t("intake.queue.hint")}
      </Meta>

      {state.status === "failed" ? (
        <View className="mt-4">
          <StatusLine
            variant="error"
            message={`${t("intake.queue.failed")} ${failureMessage(t, state.reason)}`}
            action={isRetryable(state.reason) ? { label: t("intake.fail.retry"), onPress: onRetry } : undefined}
          />
        </View>
      ) : (
        <View className="mt-4" style={{ rowGap: 16 }}>
          {(state.status === "loading" ? rows(Array.from({ length: SKELETONS }, (_, i) => i), columns) : rows(state.photos, columns)).map((row, r) => (
            <View key={r} className="flex-row" style={{ gap: GAP }}>
              {row.map((entry, c) => (
                <View key={c} className="flex-1">
                  {entry === null ? null : typeof entry === "number" ? <Skeleton aspect={1} radius="sm" /> : cell(entry)}
                </View>
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

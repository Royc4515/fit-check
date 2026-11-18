import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { PhotoTile, StatusLine } from "../../components/ui";
import { failureMessage, isRetryable } from "./failure";

/** Where one picked photo is in the pipeline. */
export type JobStatus = "waiting" | "uploading" | "separating" | "cropping" | "done" | "failed";

type Props = {
  /** The picked photo (a local URI), shown small so the user knows which photo the line is about. */
  preview: string;
  status: JobStatus;
  /** Garments found; shown when done. */
  count: number;
  /** Why it failed; read when `status` is "failed". */
  reason?: string;
  lowRes: boolean;
  /** Crops that could not be made. */
  skipped: number;
  /** Runs the photo again. Offered only for a failure where trying again can change the answer. */
  onRetry?: () => void;
  /** The garments' review cards, under the status. */
  children?: ReactNode;
};

const ltr = (s: string | number) => `⁦${s}⁩`;

/**
 * One photo's row: a small thumbnail on a tile ground and one status line for the current step (info while it runs,
 * ok when done, error with the reason and a retry when it failed). The low-resolution warning and the skipped-crops
 * count sit under it as info lines. Presentational: the container owns the pipeline.
 */
export function JobCard({ preview, status, count, reason, lowRes, skipped, onRetry, children }: Props) {
  const { t } = useTranslation();
  const failed = status === "failed";
  const message = failed
    ? failureMessage(t, reason ?? "unknown", "upload")
    : status === "done"
      ? t("intake.status.done", { count, n: ltr(count) })
      : t(`intake.status.${status}`);
  return (
    <View className="border-t border-hairline pt-4">
      <View className="flex-row items-start" style={{ gap: 16 }}>
        <PhotoTile uri={preview} size="mini" width={64} aspect={1.25} fit="cover" accessibilityLabel={t("intake.photo")} />
        <View className="flex-1">
          <StatusLine
            variant={failed ? "error" : status === "done" ? "ok" : "info"}
            message={message}
            action={failed && onRetry && isRetryable(reason ?? "unknown") ? { label: t("intake.fail.retry"), onPress: onRetry } : undefined}
          />
          {lowRes ? <StatusLine variant="info" message={t("intake.lowRes")} /> : null}
          {skipped > 0 ? <StatusLine variant="info" message={t("intake.skipped", { n: ltr(skipped) })} /> : null}
        </View>
      </View>
      {children}
    </View>
  );
}

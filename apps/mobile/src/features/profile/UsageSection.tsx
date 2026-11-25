import type { UsageResponse } from "@fit-check/schema";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Button, Display, Meta, Meter, Skeleton, StatusLine } from "../../components/ui";
import { dollars, meterLevel } from "../../data/meter";
import { fetchUsage } from "../../data/usage";

type Usage = Extract<UsageResponse, { ok: true }>;
type State = { kind: "loading" } | { kind: "error" } | { kind: "hidden" } | { kind: "ready"; usage: Usage };

/** Numbers stay LTR inside Hebrew text (DESIGN.md section 2). */
const ltr = (s: string) => `⁦${s}⁩`;

/**
 * This month's usage on the Profile screen (Roy, 2026-11-25): every user sees their own allowance as one bar, with
 * a way to ask Roy for more when it runs low; Roy sees only the whole account's percentages, one bar per cap.
 * Reads the `usage` Edge Function each time Profile comes into view, so a raise or a new month shows without a reload.
 * Failure modes: a failed read is a StatusLine with retry; the design preview and a user with no personal limit
 * (limits not switched on) show nothing.
 */
export function UsageSection() {
  const { t } = useTranslation();
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(() => {
    let active = true;
    void fetchUsage().then((r) => {
      if (!active) return;
      if (!r.ok) setState(r.reason === "preview" ? { kind: "hidden" } : { kind: "error" });
      else if (!r.owner && r.me.ai_usd === null && r.me.cutouts === null) setState({ kind: "hidden" });
      else setState({ kind: "ready", usage: r });
    });
    return () => {
      active = false;
    };
  }, []);
  useFocusEffect(load);

  if (state.kind === "hidden") return null;
  const owner = state.kind === "ready" && state.usage.owner;
  return (
    <View className="mt-8" style={{ gap: 16 }}>
      <Display>{t(owner ? "profile.usage.accountTitle" : "profile.usage.title")}</Display>
      {state.kind === "loading" ? (
        <View style={{ gap: 8 }}>
          <Skeleton height={18} width={120} radius="sm" />
          <Skeleton height={8} radius="sm" />
        </View>
      ) : state.kind === "error" ? (
        <StatusLine
          variant="error"
          message={t("profile.usage.failed")}
          action={{
            label: t("common.retry"),
            onPress: () => {
              setState({ kind: "loading" });
              load();
            },
          }}
        />
      ) : owner && state.usage.account ? (
        <AccountMeters account={state.usage.account} />
      ) : (
        <MyMeter me={state.usage.me} onAsk={() => router.push({ pathname: "/contact", params: { kind: "more_quota" } })} />
      )}
      <Meta style={{ textTransform: "none" }}>{t("profile.usage.renews")}</Meta>
    </View>
  );
}

/** A user's own allowance: one bar for whichever runs out first, the two figures under it, and "ask for more". */
function MyMeter({ me, onAsk }: { me: Usage["me"]; onAsk: () => void }) {
  const { t } = useTranslation();
  const ai = me.ai_usd;
  const cutouts = me.cutouts;
  const lines = [
    ai ? t("profile.usage.ai", { used: ltr(ai.used === null ? "?" : dollars(ai.used)), limit: ltr(dollars(ai.limit)) }) : null,
    cutouts ? t("profile.usage.cutouts", { used: ltr(cutouts.used === null ? "?" : String(cutouts.used)), limit: ltr(String(cutouts.limit)) }) : null,
  ].filter((line): line is string => line !== null);
  const level = meterLevel({ percent: me.percent });
  return (
    <View style={{ gap: 8 }}>
      <Meter
        label={t("profile.usage.allowance")}
        percent={me.percent}
        detail={lines.join(" · ")}
        accessibilityLabel={t("profile.usage.allowanceSpoken", { percent: me.percent ?? 0 })}
      />
      {level !== "ok" ? (
        <StatusLine
          variant="error"
          message={t(level === "over" ? "profile.usage.over" : "profile.usage.near")}
          action={{ label: t("profile.usage.ask"), onPress: onAsk }}
        />
      ) : (
        <View className="items-start">
          <Button variant="text" label={t("profile.usage.ask")} onPress={onAsk} />
        </View>
      )}
    </View>
  );
}

/** Roy's view: the whole account against each cap, as percentages (no other user's details). */
function AccountMeters({ account }: { account: NonNullable<Usage["account"]> }) {
  const { t } = useTranslation();
  const rows = [
    { key: "google", meter: account.google_usd, money: true },
    { key: "anthropic", meter: account.anthropic_usd, money: true },
    { key: "cutouts", meter: account.cutouts, money: false },
  ] as const;
  return (
    <View style={{ gap: 20 }}>
      {rows.map(({ key, meter, money }) => {
        const used = meter.used === null ? "?" : money ? dollars(meter.used) : String(meter.used);
        const limit = money ? dollars(meter.limit) : String(meter.limit);
        const label = t(`profile.usage.account.${key}`);
        return (
          <View key={key} style={{ gap: 8 }}>
            <Meter
              label={label}
              percent={meter.percent}
              detail={t("profile.usage.ofLimit", { used: ltr(used), limit: ltr(limit) })}
              accessibilityLabel={t("profile.usage.accountSpoken", { label, percent: meter.percent ?? 0 })}
            />
            {meterLevel(meter) !== "ok" ? (
              <StatusLine variant="error" message={t(meterLevel(meter) === "over" ? "profile.usage.accountOver" : "profile.usage.accountNear")} />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

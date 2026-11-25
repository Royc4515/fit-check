import { REFERRAL_BONUS } from "@fit-check/schema";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Meta, ScreenHeader, Skeleton, StatusLine } from "../components/ui";
import { fetchReferralCode } from "../data/referral";
import { fetchUsage } from "../data/usage";
import { inviteLink, shareInvite } from "../features/referral/inviteLink";
import { layout } from "../theme/tokens";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; link: string; referred: number; max: number; owner: boolean };

/** Numbers stay LTR inside Hebrew text (DESIGN.md section 2). */
const ltr = (s: string | number) => `⁦${s}⁩`;

/**
 * "Invite a friend" (Roy, 2026-11-25): the user's personal /join link, how many joined through it, and one button
 * that hands the link to the phone's share sheet (or copies it on a desktop). Each friend who signs up through it
 * adds REFERRAL_BONUS to the user's monthly allowance, up to the cap; Roy has no allowance, so his page only invites.
 * Failure modes: a code that cannot be read is a StatusLine with retry; a share that fails leaves the link on
 * screen to copy by hand.
 */
export default function InviteScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [shared, setShared] = useState<"copied" | "failed" | null>(null);
  const leave = () => (router.canGoBack() ? router.back() : router.replace("/profile"));

  const load = useCallback(
    () =>
      Promise.all([fetchReferralCode(), fetchUsage()]).then(([code, usage]) => {
        if (!code.ok || code.action !== "code") return setState({ kind: "error" });
        setState({ kind: "ready", link: inviteLink(code.code), referred: code.referred, max: code.max, owner: usage.ok && usage.owner });
      }),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  const retry = () => {
    setState({ kind: "loading" });
    void load();
  };

  const share = async (link: string) => {
    const result = await shareInvite(link, t("invite.shareMessage"));
    setShared(result === "shared" ? null : result);
  };

  return (
    <View className="flex-1 bg-ivory">
      <ScrollView
        contentContainerStyle={{
          width: "100%",
          maxWidth: layout.maxContentWidth,
          alignSelf: "center",
          paddingTop: insets.top + 8,
          paddingHorizontal: layout.gutter,
          paddingBottom: insets.bottom + 48,
        }}
      >
        <View style={{ alignSelf: "flex-start", marginStart: -8 }}>
          <Button variant="icon" icon="arrow_back" accessibilityLabel={t("common.back")} onPress={leave} />
        </View>
        <ScreenHeader title={t("invite.title")} safeArea={false} />
        {state.kind === "loading" ? (
          <View className="mt-6" style={{ gap: 8 }}>
            <Skeleton height={18} radius="sm" />
            <Skeleton height={18} width={200} radius="sm" />
          </View>
        ) : state.kind === "error" ? (
          <View className="mt-6">
            <StatusLine variant="error" message={t("invite.failed")} action={{ label: t("common.retry"), onPress: retry }} />
          </View>
        ) : (
          <View>
            <Text className="mt-2 font-body text-body-sm text-ink-soft">
              {state.owner
                ? t("invite.introOwner")
                : t("invite.intro", { usd: ltr(REFERRAL_BONUS.usd.toFixed(2)), cutouts: ltr(REFERRAL_BONUS.cutouts), max: ltr(state.max) })}
            </Text>
            <View className="mt-8 border-t border-hairline pt-4" style={{ gap: 8 }}>
              <Meta tone="text-ink-soft">{t("invite.linkLabel")}</Meta>
              {/* Selectable, in LTR: a web address reads left to right even on a Hebrew screen. */}
              <Text selectable className="font-mono text-num-sm text-ink" style={{ writingDirection: "ltr", alignSelf: "flex-start" }}>
                {state.link}
              </Text>
            </View>
            {!state.owner ? (
              <Meta className="mt-4" style={{ textTransform: "none" }}>
                {t("invite.count", { n: ltr(state.referred), max: ltr(state.max) })}
              </Meta>
            ) : null}
            <View className="mt-6" style={{ gap: 8 }}>
              <Button variant="primary" fullWidth label={t("invite.share")} onPress={() => void share(state.link)} />
              {shared === "copied" ? <StatusLine variant="ok" message={t("invite.copied")} /> : null}
              {shared === "failed" ? <StatusLine variant="error" message={t("invite.shareFailed")} /> : null}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

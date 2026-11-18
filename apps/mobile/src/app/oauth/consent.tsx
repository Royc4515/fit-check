import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Monogram } from "../../components/brand/Monogram";
import { Button, Display, ListRow, Meta, StatusLine } from "../../components/ui";
import { savePendingConsent } from "../../features/auth/oauthPending";
import { useSession } from "../../features/auth/SessionProvider";
import { signInWithGoogle } from "../../features/auth/signIn";
import { isRtl } from "../../i18n";
import { supabase } from "../../lib/supabase";
import { layout } from "../../theme/tokens";

type Details = { client: string; scopes: string[] };
type State =
  | { kind: "loading" }
  | { kind: "signedOut" }
  | { kind: "ask"; details: Details }
  | { kind: "working" }
  | { kind: "error"; key: "missing" | "failed" };

/**
 * OAuth consent for Supabase Auth's OAuth 2.1 server (Roy, 2026-11-17: connect Claude to Fit Check through MCP).
 *
 * Supabase sends the browser here with `authorization_id` when a client such as a Claude connector asks for access.
 * Signed out: one Google button, and the request waits in session storage through the redirect (oauthPending.ts).
 * Signed in: the client's name and the requested scopes, then approve (Supabase redirects back to the client with a
 * code) or deny. A request the user already approved comes back as a bare redirect and is followed at once.
 *
 * Reachable signed in or out on purpose; the root layout lists it outside both route guards.
 */
export default function OAuthConsent() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const session = useSession();
  const params = useLocalSearchParams<{ authorization_id?: string }>();
  const authorizationId = typeof params.authorization_id === "string" ? params.authorization_id : null;
  const [state, setState] = useState<State>({ kind: "loading" });

  // don't touch / the two synchronous setState calls below are the state machine's entry points (no id, signed out);
  // the lint rule wants them derived, but the consent flow's logic is frozen and they behave as intended.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!authorizationId) return setState({ kind: "error", key: "missing" });
    if (session.status === "loading") return;
    if (session.status !== "signedIn") return setState({ kind: "signedOut" });
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
      if (cancelled) return;
      if (error || !data) {
        console.error("OAuth details failed", error);
        return setState({ kind: "error", key: "failed" });
      }
      if (!("authorization_id" in data)) {
        window.location.href = data.redirect_url;
        return setState({ kind: "working" });
      }
      setState({ kind: "ask", details: { client: data.client.name || data.client.id, scopes: data.scope.split(" ").filter(Boolean) } });
    })();
    return () => {
      cancelled = true;
    };
  }, [authorizationId, session.status]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const decide = async (approve: boolean) => {
    if (!authorizationId) return;
    setState({ kind: "working" });
    // Both calls redirect the browser back to the client by default; an error is the only result we handle.
    const { error } = approve
      ? await supabase.auth.oauth.approveAuthorization(authorizationId)
      : await supabase.auth.oauth.denyAuthorization(authorizationId);
    if (error) {
      console.error("OAuth decision failed", error);
      setState({ kind: "error", key: "failed" });
    }
  };

  const signIn = async () => {
    if (!authorizationId) return;
    savePendingConsent(authorizationId);
    setState({ kind: "working" });
    const result = await signInWithGoogle();
    if (!result.ok) setState({ kind: "signedOut" });
  };

  return (
    <ScrollView className="flex-1 bg-ivory" contentContainerStyle={{ flexGrow: 1 }}>
      <View
        style={{
          width: "100%",
          maxWidth: layout.maxContentWidth,
          alignSelf: "center",
          paddingHorizontal: layout.gutter,
          paddingTop: insets.top + 32,
          paddingBottom: insets.bottom + 48,
        }}
      >
        <Monogram />
        <View className="mt-12">
          <Display accessibilityRole="header">
            {t("oauth.title")}
          </Display>

          {state.kind === "loading" || state.kind === "working" ? (
            <Text accessibilityLiveRegion="polite" className="mt-4 font-body text-body text-ink-soft">
              {t("oauth.working")}
            </Text>
          ) : null}

          {state.kind === "error" ? (
            <View className="mt-4">
              <StatusLine variant="error" message={t(`oauth.${state.key}`)} />
            </View>
          ) : null}

          {state.kind === "signedOut" ? (
            <>
              <Text className="mt-4 font-body text-body text-ink-soft">{t("oauth.signInFirst")}</Text>
              <View className="mt-8">
                <Button variant="primary" fullWidth label={t("auth.google")} onPress={() => void signIn()} />
              </View>
            </>
          ) : null}

          {state.kind === "ask" ? (
            <>
              {/* don't touch / explicit direction: the sentence starts with the client's name, a Latin word, so
                  the browser's first-strong rule laid the whole Hebrew line out left-to-right and left-aligned it. */}
              <Text className="mt-4 font-body text-body text-ink" style={{ writingDirection: isRtl() ? "rtl" : "ltr" }}>
                {t("oauth.request", { client: state.details.client })}
              </Text>
              <Text className="mt-3 font-body text-body-sm text-ink-soft">{t("oauth.what")}</Text>
              {state.details.scopes.length > 0 ? (
                <View className="mt-8">
                  <Meta>{t("oauth.scopesTitle")}</Meta>
                  <View className="mt-2 border-t border-hairline">
                    {state.details.scopes.map((scope) => (
                      <ListRow key={scope} label={scope} />
                    ))}
                  </View>
                </View>
              ) : null}
              <View className="mt-8" style={{ gap: 12 }}>
                <Button variant="primary" fullWidth label={t("oauth.approve")} onPress={() => void decide(true)} />
                <Button variant="outline" fullWidth label={t("oauth.deny")} onPress={() => void decide(false)} />
              </View>
            </>
          ) : null}
        </View>
      </View>
    </ScrollView>
  );
}

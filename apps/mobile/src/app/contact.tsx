import { CONTACT_KINDS, CONTACT_MAX_CHARS, type ContactKind } from "@fit-check/schema";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Chip, Meta, ScreenHeader, StatusLine, TextField } from "../components/ui";
import { sendContact } from "../data/contact";
import { layout } from "../theme/tokens";

type Sending = { kind: "idle" } | { kind: "busy" } | { kind: "sent"; emailed: boolean } | { kind: "failed"; reason: string };

const isKind = (value: unknown): value is ContactKind => typeof value === "string" && (CONTACT_KINDS as readonly string[]).includes(value);

/**
 * "Contact Roy" (Roy, 2026-11-25): what the request is about (one choice), a message, send. The `contact` Edge
 * Function stores it and emails Roy, who answers by email. `?kind=more_quota` comes from the usage bar's "ask for
 * more". Failure modes: the daily limit and every other refusal are said under the button, with the text kept.
 */
export default function ContactScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ kind?: string }>();
  const [kind, setKind] = useState<ContactKind | null>(isKind(params.kind) ? params.kind : null);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState<Sending>({ kind: "idle" });
  const leave = () => (router.canGoBack() ? router.back() : router.replace("/profile"));

  const ready = kind !== null && message.trim().length > 0 && sending.kind !== "busy";
  const send = async () => {
    if (!ready || kind === null) return;
    setSending({ kind: "busy" });
    const result = await sendContact(kind, message);
    if (result.ok) {
      setMessage("");
      setSending({ kind: "sent", emailed: result.emailed });
    } else {
      setSending({ kind: "failed", reason: result.reason });
    }
  };

  return (
    <View className="flex-1 bg-ivory">
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          width: "100%",
          maxWidth: layout.maxContentWidth,
          alignSelf: "center",
          paddingTop: insets.top + 8,
          paddingHorizontal: layout.gutter,
          paddingBottom: insets.bottom + 48,
        }}
      >
        {/* The glyph sits 10px inside its 44 box; pulling the box out by 8 lines the arrow up with the title's edge. */}
        <View style={{ alignSelf: "flex-start", marginStart: -8 }}>
          <Button variant="icon" icon="arrow_back" accessibilityLabel={t("common.back")} onPress={leave} />
        </View>
        <ScreenHeader title={t("contact.title")} safeArea={false} />
        <Text className="mt-2 font-body text-body-sm text-ink-soft">{t("contact.intro")}</Text>

        <View className="mt-8" style={{ gap: 8 }}>
          <Meta tone="text-ink-soft">{t("contact.kindLabel")}</Meta>
          <View className="flex-row flex-wrap" style={{ gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel={t("contact.kindLabel")}>
            {CONTACT_KINDS.map((k) => (
              <Chip key={k} label={t(`contact.kind.${k}`)} selected={kind === k} onPress={() => setKind(k)} />
            ))}
          </View>
        </View>

        <View className="mt-6">
          <TextField
            label={t("contact.messageLabel")}
            value={message}
            onChangeText={setMessage}
            placeholder={t("contact.placeholder")}
            maxLength={CONTACT_MAX_CHARS}
            counterFrom={CONTACT_MAX_CHARS - 200}
            counterLabel={(n, max) => t("contact.counter", { n, max })}
            multiline
          />
        </View>

        <View className="mt-6" style={{ gap: 8 }}>
          <Button variant="primary" fullWidth label={t(sending.kind === "busy" ? "contact.sending" : "contact.send")} onPress={() => void send()} disabled={!ready} />
          {sending.kind === "sent" ? <StatusLine variant="ok" message={t(sending.emailed ? "contact.sent" : "contact.saved")} /> : null}
          {sending.kind === "failed" ? (
            <StatusLine
              variant="error"
              message={t(sending.reason === "daily_limit" ? "contact.failed.daily_limit" : "contact.failed.generic")}
              action={sending.reason === "daily_limit" ? undefined : { label: t("common.retry"), onPress: () => void send() }}
            />
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

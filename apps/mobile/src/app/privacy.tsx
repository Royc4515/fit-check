import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Monogram } from "../components/brand/Monogram";
import { Display, Meta, MetaLink, ScreenColumn } from "../components/ui";
import { isRtl } from "../i18n";

/** Shown on this page and given to Google as the app's contact (Roy, 2026-11-24: his Gmail, his name). */
const CONTACT_EMAIL = "roy.y.carmelli@gmail.com";

/** The day the policy text last changed. Bump it whenever a `privacy.*` string changes meaning. */
const UPDATED_ON = "2026-11-24";

const SECTIONS = ["collect", "google", "use", "providers", "location", "retention", "security", "children", "changes"] as const;

/**
 * The privacy policy, public at /privacy. Google's OAuth consent screen links to it, and the app cannot be published
 * there without a working policy address, so it sits outside both route guards: signed-out visitors and Google's
 * reviewers must reach it.
 * Plain text in the app's type: the policy is read, not browsed, so no tiles, no sheet, no motion.
 */
export default function Privacy() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const locale = i18n.language === "en" ? "en-GB" : "he-IL";
  // don't touch / noon UTC, not midnight: a date-only ISO string parses as midnight UTC, which is the previous day
  // anywhere west of Greenwich.
  const updated = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(new Date(`${UPDATED_ON}T12:00:00Z`));
  // don't touch / explicit direction on every paragraph: react-native-web gives text dir="auto", so a Hebrew paragraph
  // that opens with a Latin name ("Fit Check היא...") was laid out left to right, full stop on the wrong side.
  const paragraph = { writingDirection: isRtl() ? "rtl" : "ltr" } as const;

  return (
    <ScrollView className="flex-1 bg-ivory" contentContainerStyle={{ flexGrow: 1 }}>
      <ScreenColumn>
        <View style={{ paddingTop: insets.top + 32, paddingBottom: insets.bottom + 48 }}>
          <Monogram />
          <View className="mt-10" style={{ alignItems: "flex-start" }}>
            <Display size="display-xl" level={1}>
              {t("privacy.title")}
            </Display>
          </View>
          <Meta className="mt-2">{t("privacy.updated", { date: updated })}</Meta>
          <Text className="mt-6 font-body text-body text-ink" style={paragraph}>{t("privacy.intro")}</Text>
          {SECTIONS.map((key) => (
            <View key={key} className="mt-8">
              <Display>{t(`privacy.${key}Title`)}</Display>
              <Text className="mt-3 font-body text-body text-ink-soft" style={paragraph}>{t(`privacy.${key}Body`)}</Text>
            </View>
          ))}
          <View className="mt-8">
            <Display>{t("privacy.contactTitle")}</Display>
            <Text className="mt-3 font-body text-body text-ink-soft" style={paragraph}>{t("privacy.contactBody")}</Text>
            <MetaLink label={CONTACT_EMAIL} href={`mailto:${CONTACT_EMAIL}`} />
          </View>
        </View>
      </ScreenColumn>
    </ScrollView>
  );
}

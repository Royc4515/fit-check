import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Meta, MetaLink } from "../../components/ui";
import { AUTHOR_LINKS } from "./authorLinks";

/**
 * "Built by Roy Carmelli" with links to his portfolio, LinkedIn and GitHub (Roy, 2026-11-25: a recruiter who opens
 * the app can reach all three). Shown in full on the sign-in screen too, because that is the only screen a visitor
 * without an account ever sees. The row wraps, so on a narrow phone the links drop under the name.
 */
export function BuiltBy() {
  const { t } = useTranslation();
  return (
    <View className="flex-row flex-wrap items-center" style={{ columnGap: 12 }}>
      {/* A name and a sentence: no English uppercase from the Meta default. */}
      <Meta style={{ textTransform: "none" }}>{t("credits.builtBy")}</Meta>
      {AUTHOR_LINKS.map((link) => (
        <MetaLink key={link.key} label={t(`credits.${link.key}`)} href={link.href} />
      ))}
    </View>
  );
}

import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Meta, MetaLink } from "../../components/ui";

/** Roy's public pages (his portfolio site lists the same three). */
export const AUTHOR_LINKS = [
  { key: "portfolio", href: "https://roy-carmelli-portfolio.vercel.app" },
  { key: "github", href: "https://github.com/Royc4515" },
  { key: "linkedin", href: "https://linkedin.com/in/roy-carmelli" },
] as const;

/**
 * "Built by Roy Carmelli" with links to his portfolio, GitHub and LinkedIn (Roy, 2026-11-25: credit to him in the
 * app). `compact`: the portfolio link alone, for the sign-in screen, where one quiet line is enough.
 */
export function BuiltBy({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const links = compact ? AUTHOR_LINKS.slice(0, 1) : AUTHOR_LINKS;
  return (
    <View className="flex-row flex-wrap items-center" style={{ columnGap: 12 }}>
      {/* A name and a sentence: no English uppercase from the Meta default. */}
      <Meta style={{ textTransform: "none" }}>{t("credits.builtBy")}</Meta>
      {links.map((link) => (
        <MetaLink key={link.key} label={t(`credits.${link.key}`)} href={link.href} />
      ))}
    </View>
  );
}

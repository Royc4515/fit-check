import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { EmptyState } from "../components/ui";
import { layout } from "../theme/tokens";

/**
 * Any URL no route matches (a stale link, a mistyped address). Without it Expo Router shows its development-style
 * "Unmatched route" page. `replace`, not `push`: the dead address should not sit in the back stack. A signed-out
 * visitor is bounced from "/" to sign-in by the root layout's guards, so the one action is right either way.
 */
export default function NotFound() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <View className="flex-1 bg-ivory" style={{ paddingTop: insets.top + 32 }}>
      {/* Outside the tabs, so no TopNav to align with: the same centred 560 column as sign-in. */}
      <View style={{ width: "100%", maxWidth: layout.maxContentWidth, alignSelf: "center", paddingHorizontal: layout.gutter }}>
        <EmptyState title={t("notFound.title")} body={t("notFound.body")} action={{ label: t("notFound.action"), onPress: () => router.replace("/") }} />
      </View>
    </View>
  );
}

import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { currentPosition, getSavedLocation, saveLocation, searchCities, type SavedLocation } from "../data/location";
import { colors, layout } from "../theme/tokens";

type City = Extract<SavedLocation, { kind: "city" }>;

/** One choice as a hairline row: label, optional meta, and a quiet "selected" word instead of a coloured check. */
function Row({ label, meta, selected, onPress }: { label: string; meta?: string | null; selected: boolean; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }} className="border-b border-hairline py-4">
      <View className="flex-row items-baseline justify-between" style={{ gap: 12 }}>
        <View style={{ flexShrink: 1 }}>
          <Text className="font-body text-body text-ink">{label}</Text>
          {meta ? <Text className="font-body text-meta text-ink-faint">{meta}</Text> : null}
        </View>
        {selected ? <Text className="font-body-semibold text-body-sm text-ink">{t("location.selected")}</Text> : null}
      </View>
    </Pressable>
  );
}

/**
 * Where weather and Shabbat times come from: the default (Giv'at Shmuel), the phone's current location, or any
 * city. A device setting stored locally (see data/location.ts).
 */
export default function LocationScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [saved, setSaved] = useState<SavedLocation | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<City[]>([]);
  const [searched, setSearched] = useState(false);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    void getSavedLocation().then(setSaved);
  }, []);

  // Debounced: a request per keystroke would hit the free geocoder's limits for nothing.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    const timer = setTimeout(() => {
      void searchCities(q, i18n.language === "en" ? "en" : "he").then((r) => {
        setResults(r);
        setSearched(true);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [query, i18n.language]);

  const choose = async (loc: SavedLocation) => {
    await saveLocation(loc);
    router.back();
  };

  const chooseCurrent = async () => {
    // Ask now, while the user is looking at the button, rather than silently on the next app start.
    const fix = await currentPosition();
    if (!fix) {
      setDenied(true);
      return;
    }
    await choose({ kind: "current" });
  };

  const isCity = (c: City) => saved?.kind === "city" && saved.geonameid === c.geonameid;

  return (
    <View className="flex-1 bg-ivory">
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          width: "100%",
          maxWidth: layout.maxContentWidth,
          alignSelf: "center",
          paddingTop: insets.top + 32,
          paddingHorizontal: layout.gutter,
          paddingBottom: insets.bottom + 48,
        }}
      >
        <View className="flex-row items-baseline justify-between">
          <Text className="font-display text-display-xl text-ink">{t("location.title")}</Text>
          <Pressable onPress={() => router.back()} accessibilityRole="button" hitSlop={12}>
            <View className="border-b border-hairline pb-1">
              <Text className="font-body text-body-sm text-ink">{t("location.back")}</Text>
            </View>
          </Pressable>
        </View>
        <Text className="mt-2 font-body text-body-sm text-ink-soft">{t("location.hint")}</Text>

        <View className="mt-8 border-t border-hairline">
          <Row label={t("location.default")} meta={t("location.defaultMeta")} selected={saved?.kind === "default"} onPress={() => void choose({ kind: "default" })} />
          <Row
            label={t("location.current")}
            meta={denied ? t("location.denied") : t("location.genericCandles")}
            selected={saved?.kind === "current"}
            onPress={() => void chooseCurrent()}
          />
          {saved?.kind === "city" ? <Row label={saved.name} meta={saved.region} selected onPress={() => router.back()} /> : null}
        </View>

        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t("location.search")}
          placeholderTextColor={colors["ink-faint"]}
          autoCorrect={false}
          accessibilityLabel={t("location.search")}
          className="mt-12 border-b border-hairline pb-2 font-body text-body text-ink"
          style={{ textAlign: i18n.language === "en" ? "left" : "right" }}
        />
        <View>
          {results.map((c) => (
            <Row key={c.geonameid} label={c.name} meta={c.region} selected={isCity(c)} onPress={() => void choose(c)} />
          ))}
          {searched && results.length === 0 ? <Text className="mt-4 font-body text-body-sm text-ink-soft">{t("location.noResults")}</Text> : null}
        </View>
      </ScrollView>
    </View>
  );
}

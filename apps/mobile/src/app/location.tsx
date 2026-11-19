import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, ListRow, MetaLink, ScreenHeader, SearchField, StatusLine } from "../components/ui";
import { cachedPlaceName, currentPosition, getSavedLocation, onPlaceNameChange, saveLocation, searchCities, type SavedLocation } from "../data/location";
import { layout } from "../theme/tokens";

type City = Extract<SavedLocation, { kind: "city" }>;

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

  const lang = i18n.language === "en" ? "en" : "he";
  const [currentName, setCurrentName] = useState<string | null>(null);

  useEffect(() => {
    void getSavedLocation().then(setSaved);
  }, []);

  // Cache only: Today does the lookup, this row shows what is already known (and updates when Today stores a name).
  useEffect(() => {
    let active = true;
    const load = () => void cachedPlaceName(lang).then((n) => active && setCurrentName(n));
    load();
    const off = onPlaceNameChange(load);
    return () => {
      active = false;
      off();
    };
  }, [lang]);

  // Under two characters there is nothing to search or show; derived here so the effect never has to reset state.
  const searching = query.trim().length >= 2;

  // Debounced: a request per keystroke would hit the free geocoder's limits for nothing.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const timer = setTimeout(() => {
      void searchCities(q, i18n.language === "en" ? "en" : "he").then((r) => {
        setResults(r);
        setSearched(true);
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [query, i18n.language]);

  // A deep link to /location has no history, so back would do nothing; Profile is where the location row lives.
  const leave = () => (router.canGoBack() ? router.back() : router.replace("/profile"));

  const choose = async (loc: SavedLocation) => {
    await saveLocation(loc);
    leave();
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
          paddingTop: insets.top + 8,
          paddingHorizontal: layout.gutter,
          paddingBottom: insets.bottom + 48,
        }}
      >
        {/* The glyph sits 10px inside its 44 box; pulling the box out by 8 lines the arrow up with the title's edge. */}
        <View style={{ alignSelf: "flex-start", marginStart: -8 }}>
          <Button variant="icon" icon="arrow_back" accessibilityLabel={t("common.back")} onPress={leave} />
        </View>
        <ScreenHeader title={t("location.title")} safeArea={false} />
        <Text className="mt-2 font-body text-body-sm text-ink-soft">{t("location.hint")}</Text>

        <View className="mt-8 border-t border-hairline">
          <ListRow
            label={t("location.default")}
            meta={t("location.defaultMeta")}
            selected={saved?.kind === "default"}
            onPress={() => void choose({ kind: "default" })}
          />
          <ListRow
            label={t("location.current")}
            meta={currentName ?? t("location.currentMeta")}
            selected={saved?.kind === "current"}
            onPress={() => void chooseCurrent()}
          />
          {saved?.kind === "city" ? <ListRow label={saved.name} meta={saved.region ?? undefined} selected onPress={leave} /> : null}
        </View>
        {denied ? (
          <View className="mt-3">
            <StatusLine variant="error" message={t("location.denied")} />
          </View>
        ) : null}

        <View className="mt-12">
          <SearchField value={query} onChangeText={setQuery} placeholder={t("location.search")} />
        </View>
        <View>
          {(searching ? results : []).map((c) => (
            <ListRow key={c.geonameid} label={c.name} meta={c.region ?? undefined} selected={isCity(c)} onPress={() => void choose(c)} />
          ))}
          {searching && searched && results.length === 0 ? <Text className="mt-4 font-body text-body-sm text-ink-soft">{t("location.noResults")}</Text> : null}
        </View>
        {/* The names come from OpenStreetMap on web only (data/location.ts); its licence asks for this credit. */}
        {Platform.OS === "web" ? (
          <View className="mt-12">
            <MetaLink label={t("location.osmCredit")} href="https://www.openstreetmap.org/copyright" />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

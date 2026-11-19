import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppState, Platform, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, ListRow, MetaLink, ScreenHeader, SearchField, StatusLine } from "../components/ui";
import { cachedPlaceName, currentPosition, getSavedLocation, onPlaceNameChange, readLocationFacts, saveLocation, searchCities, type SavedLocation } from "../data/location";
import { locationNotice, type LocationFacts } from "../data/locationNotice";
import { useObservesShabbat } from "../data/useObservance";
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
  // A tap on "my current location" that came back with no position; cleared by the next tap.
  const [tapFailed, setTapFailed] = useState(false);
  const [facts, setFacts] = useState<Pick<LocationFacts, "permission" | "hasStoredFix"> | null>(null);

  const lang = i18n.language === "en" ? "en" : "he";
  // Without "keeps Shabbat and holidays" the location sets only the weather (DESIGN.md "שלב 4.1" item 10).
  const observes = useObservesShabbat();
  const [currentName, setCurrentName] = useState<string | null>(null);

  // Read without prompting (data/location.ts): only a tap on the row may ask. Read again when the app comes back to
  // the front, because the permission is changed in the browser's or the phone's settings, outside this screen.
  useEffect(() => {
    let active = true;
    const load = () =>
      void Promise.all([getSavedLocation(), readLocationFacts()]).then(([s, f]) => {
        if (!active) return;
        setSaved(s);
        setFacts(f);
      });
    load();
    const sub = AppState.addEventListener("change", (state) => state === "active" && load());
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  // "Current" was chosen but no position can be had: Today shows the default city without a word, so this says why,
  // for as long as it is true (not only right after a tap).
  const noPermission = saved !== null && facts !== null && locationNotice({ saved: saved.kind, tapFailed, ...facts }) === "noPermission";

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
      setTapFailed(true);
      // A refusal changes the permission and a fix would have changed the stored position: read both again.
      void readLocationFacts().then(setFacts);
      return;
    }
    setTapFailed(false);
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
        <Text className="mt-2 font-body text-body-sm text-ink-soft">{t(observes ? "location.hint" : "location.hintWeatherOnly")}</Text>

        <View className="mt-8 border-t border-hairline">
          <ListRow
            label={t("location.default")}
            meta={t("location.defaultMeta")}
            selected={saved?.kind === "default"}
            onPress={() => void choose({ kind: "default" })}
          />
          <ListRow
            label={t("location.current")}
            meta={currentName ?? t(observes ? "location.currentMeta" : "location.currentMetaWeatherOnly")}
            selected={saved?.kind === "current"}
            onPress={() => void chooseCurrent()}
          />
          {/* Directly under the row it is about. */}
          {noPermission ? (
            <View className="py-3">
              <StatusLine variant="error" message={t("location.denied")} />
            </View>
          ) : null}
          {saved?.kind === "city" ? <ListRow label={saved.name} meta={saved.region ?? undefined} selected onPress={leave} /> : null}
        </View>

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

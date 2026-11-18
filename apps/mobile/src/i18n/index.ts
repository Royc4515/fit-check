import { getLocales } from "expo-localization";
import i18n, { changeLanguage, use as registerPlugin } from "i18next";
import { initReactI18next } from "react-i18next";
import { I18nManager, Platform } from "react-native";
import he from "../../locales/he.json";
import en from "../../locales/en.json";
import { settingGet, settingGetNow, settingSet } from "../data/kv";

export const SUPPORTED = ["he", "en"] as const;
export type Locale = (typeof SUPPORTED)[number];

/** Device setting holding the language the user picked in Profile. Absent = follow the device. */
const LANGUAGE_KEY = "fitcheck:language";

const asLocale = (v: string | null | undefined): Locale | null => (v === "he" || v === "en" ? v : null);

const device = getLocales()[0]?.languageCode;
const deviceLocale: Locale = device === "en" ? "en" : "he";
// Web reads the stored choice synchronously, so the first render is already in it. Native storage is async only:
// it starts in the device language and switches once the read lands (below), normally while the fonts still load.
const initial: Locale = asLocale(settingGetNow(LANGUAGE_KEY)) ?? deviceLocale;

// i18next exports `use` bound to the default instance (aliased: a bare `use` call reads as the React hook); chaining on it registers the plugin on the default instance.
void registerPlugin(initReactI18next).init({
  resources: { he: { translation: he }, en: { translation: en } },
  lng: initial,
  fallbackLng: "he",
  interpolation: { escapeValue: false },
});

export function isRtl(locale: Locale = i18n.language as Locale): boolean {
  return locale === "he";
}

/**
 * The direction the layout is actually drawn in. Web: the active language's, since the root `dir` follows it live.
 * Native: I18nManager's process flag, which only changes on the next start; until then a language switched in
 * Profile shows its text in the old direction, and gestures and mirrored icons must follow the drawn layout.
 */
export function layoutRtl(): boolean {
  return Platform.OS === "web" ? isRtl() : I18nManager.isRTL;
}

/**
 * Web: sets the document direction and language at once. Native: RTL is a process-level flag; forceRTL is stored
 * and takes effect on the next start (never forced by a reload here).
 */
export function applyDirection(locale: Locale): void {
  const rtl = isRtl(locale);
  if (Platform.OS === "web" && typeof document !== "undefined") {
    document.documentElement.dir = rtl ? "rtl" : "ltr";
    document.documentElement.lang = locale;
  } else if (Platform.OS !== "web" && I18nManager.isRTL !== rtl) {
    I18nManager.allowRTL(rtl);
    I18nManager.forceRTL(rtl);
  }
}

applyDirection(initial);

if (Platform.OS !== "web") {
  void settingGet(LANGUAGE_KEY).then((stored) => {
    const chosen = asLocale(stored);
    if (!chosen || chosen === i18n.language) return;
    void changeLanguage(chosen);
    applyDirection(chosen);
  });
}

/**
 * Profile's language switch: the text changes at once everywhere (react-i18next re-renders its users, the root
 * layout's `dir` follows on web), and the choice is stored on the device so it wins over the device locale next time.
 * @returns true when the layout direction will only follow after an app restart (native, direction changed).
 */
export async function setLanguage(locale: Locale): Promise<boolean> {
  await changeLanguage(locale);
  applyDirection(locale);
  void settingSet(LANGUAGE_KEY, locale);
  return needsRestartForDirection(locale);
}

/** Native only: the drawn direction (fixed until restart) differs from the language's. Always false on web. */
export function needsRestartForDirection(locale: Locale = i18n.language as Locale): boolean {
  return Platform.OS !== "web" && I18nManager.isRTL !== isRtl(locale);
}

export default i18n;

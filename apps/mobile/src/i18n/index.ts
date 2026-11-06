import { getLocales } from "expo-localization";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { I18nManager, Platform } from "react-native";
import he from "../../locales/he.json";
import en from "../../locales/en.json";

export const SUPPORTED = ["he", "en"] as const;
export type Locale = (typeof SUPPORTED)[number];

const device = getLocales()[0]?.languageCode;
const initial: Locale = device === "en" ? "en" : "he";

void i18n.use(initReactI18next).init({
  resources: { he: { translation: he }, en: { translation: en } },
  lng: initial,
  fallbackLng: "he",
  interpolation: { escapeValue: false },
});

export function isRtl(locale: Locale = i18n.language as Locale): boolean {
  return locale === "he";
}

/** On native, RTL is a process-level flag; changing it needs a reload (done in settings, not here). */
export function applyDirection(locale: Locale): void {
  const rtl = isRtl(locale);
  if (Platform.OS === "web" && typeof document !== "undefined") {
    document.documentElement.dir = rtl ? "rtl" : "ltr";
    document.documentElement.lang = locale;
  } else if (I18nManager.isRTL !== rtl) {
    I18nManager.allowRTL(rtl);
    I18nManager.forceRTL(rtl);
  }
}

applyDirection(initial);

export default i18n;

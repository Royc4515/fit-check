import { FrankRuhlLibre_400Regular } from "@expo-google-fonts/frank-ruhl-libre";
import { IBMPlexSansHebrew_400Regular, IBMPlexSansHebrew_600SemiBold } from "@expo-google-fonts/ibm-plex-sans-hebrew";
import { IBMPlexMono_400Regular } from "@expo-google-fonts/ibm-plex-mono";
import { useFonts } from "expo-font";

/** Loads the three families from DESIGN.md. Keys must match tailwind.config fontFamily. */
export function useAppFonts(): boolean {
  const [loaded] = useFonts({
    FrankRuhlLibre_400Regular,
    IBMPlexSansHebrew_400Regular,
    IBMPlexSansHebrew_600SemiBold,
    IBMPlexMono_400Regular,
  });
  return loaded;
}

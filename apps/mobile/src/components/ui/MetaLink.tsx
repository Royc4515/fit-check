import { Linking, Platform, Pressable } from "react-native";
import { focusRingProps } from "./interaction";
import { layout } from "../../theme/tokens";
import { Meta } from "./Type";

/**
 * A `Meta` line that opens an address: attribution and credits (the OpenStreetMap line on the location screen).
 * Ink-faint like any meta, a 44 hit area, link semantics, and the keyboard focus ring on web.
 * On web it is a real anchor (new tab, noopener), so Enter, middle-click and "copy link" work; on native it opens
 * through Linking.
 * Failure modes: if the address cannot be opened the press does nothing (a credit is not worth an error state).
 */
export function MetaLink({ label, href }: { label: string; href: string }) {
  // react-native-web renders `href` as an <a>. A typed object spread because RN's types have no `href`, like
  // focusRingProps.
  const anchor: object = Platform.OS === "web" ? { href, hrefAttrs: { target: "_blank", rel: "noopener noreferrer" } } : {};
  return (
    <Pressable
      {...focusRingProps}
      {...anchor}
      accessibilityRole="link"
      accessibilityLabel={label}
      // don't touch / no onPress on web: the anchor already navigates, and a handler too would open the page twice.
      onPress={Platform.OS === "web" ? undefined : () => void Linking.openURL(href).catch(() => undefined)}
      className="justify-center self-start"
      style={{ minHeight: layout.hit }}
    >
      {/* Sentence with a proper name, so no English uppercase from the Meta default. */}
      <Meta style={{ textTransform: "none" }}>{label}</Meta>
    </Pressable>
  );
}

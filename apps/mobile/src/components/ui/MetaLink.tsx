import { Linking, Pressable } from "react-native";
import { focusRingProps } from "./interaction";
import { layout } from "../../theme/tokens";
import { Meta } from "./Type";

/**
 * A `Meta` line that opens an address: attribution and credits (the OpenStreetMap line on the location screen).
 * Ink-faint like any meta, a 44 hit area, link semantics, and the keyboard focus ring on web.
 * Failure modes: if the address cannot be opened the press does nothing (a credit is not worth an error state).
 */
export function MetaLink({ label, href }: { label: string; href: string }) {
  return (
    <Pressable
      {...focusRingProps}
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={() => void Linking.openURL(href).catch(() => undefined)}
      className="justify-center self-start"
      style={{ minHeight: layout.hit }}
    >
      {/* Sentence with a proper name, so no English uppercase from the Meta default. */}
      <Meta style={{ textTransform: "none" }}>{label}</Meta>
    </Pressable>
  );
}

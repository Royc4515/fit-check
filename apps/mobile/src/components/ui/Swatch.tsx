import { Pressable, View } from "react-native";
import { layout } from "../../theme/tokens";
import { focusRingProps, selectionHaptic, webStateProps } from "./interaction";

/** Visible swatch sizes: 24 in the wardrobe colour row, 12 inside a chip (DESIGN.md section 4). */
export type SwatchSize = 12 | 24;

const RING = 2;
const RING_GAP = 2;

type Props = {
  /**
   * The garment's colour. This is data (the item's `color_hex`), not a design colour, so it is the one hex a
   * component may receive.
   */
  color: string;
  size?: SwatchSize;
  /** The colour's name in the active language. Required: a swatch alone is colour-only meaning. */
  accessibilityLabel: string;
  selected?: boolean;
  /** Omit for a decorative swatch (inside a chip): it is then not pressable and hidden from screen readers. */
  onPress?: () => void;
  disabled?: boolean;
};

/**
 * Colour square, radius 2, hairline edge (so white reads on ivory). Selected = ink ring 2px at a 2px gap; the ring
 * space is always reserved so selecting never shifts the row. The caller must also show the colour's name next to
 * the row when one is selected (DESIGN.md section 3: never colour alone).
 */
export function Swatch({ color, size = 24, accessibilityLabel, selected = false, onPress, disabled = false }: Props) {
  const square = <View className="rounded-sm border border-hairline" style={{ width: size, height: size, backgroundColor: color }} />;
  if (!onPress) {
    return (
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {square}
      </View>
    );
  }
  const outer = size + 2 * (RING + RING_GAP);
  // The pressable is the 44 box (react-native-web has no hitSlop); the ring box is its centred child. Sideways the
  // box's extra width is cancelled by a negative margin, so the row keeps the pitch it was designed with (32 + the
  // caller's gap). Vertically it is not cancelled: the wardrobe row is 44 high anyway, and a swatch inside a
  // scrolling row would otherwise be clipped back to 32.
  const box = Math.max(layout.hit, outer);
  const side = (box - outer) / 2;
  return (
    <Pressable
      {...focusRingProps}
      onPress={() => {
        selectionHaptic();
        onPress();
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected, disabled }}
      {...webStateProps({ pressed: selected, disabled })}
      className="items-center justify-center"
      style={{ width: box, height: box, marginHorizontal: -side, opacity: disabled ? 0.4 : 1 }}
    >
      <View
        className={`items-center justify-center rounded ${selected ? "border-ink" : "border-transparent"}`}
        style={{ width: outer, height: outer, borderWidth: RING }}
      >
        {square}
      </View>
    </Pressable>
  );
}

import { useState } from "react";
import { TextInput, View } from "react-native";
import { colors, layout } from "../../theme/tokens";
import { Icon } from "./Icon";
import { useRtl } from "./interaction";

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  /** Doubles as the accessible label: the glyph alone does not say what the field searches. */
  placeholder: string;
  /** Take the focus on mount (a field opened by a search button: the next keystroke goes into it). */
  autoFocus?: boolean;
  /** Escape pressed inside the field (web keyboards); e.g. clear and close the search. */
  onEscape?: () => void;
};

/**
 * Search field (DESIGN.md section 2 "צורה"): a hairline underline with a `search` glyph at the start, no box. The
 * underline turns ink while focused, which is the focus indicator for a text input (a ring around a bare line would
 * float above it).
 */
export function SearchField({ value, onChangeText, placeholder, autoFocus = false, onEscape }: Props) {
  const rtl = useRtl();
  const [focused, setFocused] = useState(false);
  const onKeyPress = onEscape
    ? (e: { nativeEvent: { key: string } }) => {
        if (e.nativeEvent.key === "Escape") onEscape();
      }
    : undefined;
  return (
    <View
      className="flex-row items-center border-b"
      style={{ minHeight: layout.hit, gap: 12, borderBottomColor: focused ? colors.ink : colors.hairline }}
    >
      <Icon name="search" color="ink-soft" />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyPress={onKeyPress}
        autoFocus={autoFocus}
        placeholder={placeholder}
        placeholderTextColor={colors["ink-faint"]}
        autoCorrect={false}
        returnKeyType="search"
        accessibilityLabel={placeholder}
        className="flex-1 py-2 font-body text-body text-ink"
        // don't touch / explicit align: react-native-web does not derive text-align from `dir` for inputs, so a Hebrew
        // query would sit on the left edge. outline none because the underline is the focus state.
        style={{ textAlign: rtl ? "right" : "left", outlineStyle: "none" } as object}
      />
    </View>
  );
}

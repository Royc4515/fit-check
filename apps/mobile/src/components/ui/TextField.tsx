import { useState } from "react";
import { Text, TextInput, View } from "react-native";
import { colors, layout } from "../../theme/tokens";
import { useRtl } from "./interaction";
import { Meta } from "./Type";

type Props = {
  /** The visible label above the field, in `meta`; also the field's accessible name. */
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  /**
   * Most characters, counted in code points (an emoji is one, as the database counts). Longer input is cut to it, and
   * the counter makes the limit visible before it is reached.
   */
  maxLength?: number;
  /** From this many characters the `n/max` counter shows under the field's end (needs `maxLength`). */
  counterFrom?: number;
  /** Spoken counter, e.g. "32 of 40 characters". */
  counterLabel?: (n: number, max: number) => string;
  /** Enter / the keyboard's return key. */
  onSubmit?: () => void;
  placeholder?: string;
};

/** Numbers stay LTR inside Hebrew text (DESIGN.md section 2). */
const ltr = (s: string) => `⁦${s}⁩`;

/** Code points, not UTF-16 units: what the user and the database both call a character. */
const lengthOf = (s: string) => [...s].length;

/**
 * A plain one-line form field (a name in a form that has its own save button, unlike "כתיבה במקום", which saves
 * itself): label in `meta` above, a framed box (ivory, 1px hairline, ink while focused, radius 6, 12 in) with body
 * text, and, near the limit, a mono `n/max` counter at the end under it. The ink frame is the focus indicator, as a
 * ring around a framed box would double it.
 */
export function TextField({ label, value, onChangeText, maxLength, counterFrom, counterLabel, onSubmit, placeholder }: Props) {
  const rtl = useRtl();
  const [focused, setFocused] = useState(false);
  const n = lengthOf(value);
  const counter = maxLength !== undefined && counterFrom !== undefined && n >= counterFrom;
  const change = (text: string) => {
    // A pasted run past the limit is cut by code points (TextInput's maxLength counts UTF-16 units, so it is not used).
    onChangeText(maxLength !== undefined && lengthOf(text) > maxLength ? [...text].slice(0, maxLength).join("") : text);
  };
  return (
    <View style={{ gap: 8 }}>
      <Meta tone="text-ink-soft">{label}</Meta>
      <TextInput
        value={value}
        onChangeText={change}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={onSubmit}
        returnKeyType="done"
        placeholder={placeholder}
        placeholderTextColor={colors["ink-faint"]}
        accessibilityLabel={label}
        className="rounded bg-ivory p-3 font-body text-body text-ink"
        // don't touch / explicit align: react-native-web does not derive text-align from `dir` for inputs. outline none:
        // the ink frame is the focus state.
        style={{ minHeight: layout.control, borderWidth: 1, borderColor: focused ? colors.ink : colors.hairline, textAlign: rtl ? "right" : "left", outlineStyle: "none" } as object}
      />
      {counter && maxLength !== undefined ? (
        <View style={{ alignItems: "flex-end" }}>
          <Text className="font-mono text-num-sm text-ink-soft" accessibilityLabel={counterLabel?.(n, maxLength)} accessibilityLiveRegion="polite">
            {ltr(`${n}/${maxLength}`)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

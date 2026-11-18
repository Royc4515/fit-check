import {
  detailToFree,
  setFree,
  suggestRedraw,
  toggleDetail,
  toggleFix,
  withTags,
  type RedrawSuggestion,
} from "@fit-check/engine";
import {
  buildRedrawPrompt,
  COLOR_NAMES,
  detailsFor,
  MATERIALS,
  MAX_REDRAW_DETAILS,
  MAX_REDRAW_FREE,
  MAX_REDRAW_FREE_CHARS,
  PATTERNS,
  SUBCATEGORIES,
  type ColorName,
  type IntakeQuoteResult,
  type ItemTags,
  type RedrawDetailId,
  type RedrawFixId,
  type RedrawFree,
  type RedrawSpec,
} from "@fit-check/schema";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, TextInput, View } from "react-native";
import { TextAction } from "../../components/TextAction";
import { fetchRedrawHistory, previousSpec, quoteRedraw } from "../../data/redraw";
import { colors } from "../../theme/tokens";
import { Row } from "../intake/ChoiceRow";
import { hasSleeves, SLEEVE_CHOICES } from "../intake/tagRules";

/** The words of the garment sentence; each one is a tag and opens that tag's closed list. */
type Word = "subcategory" | "color_name" | "pattern" | "material" | "sleeve";
/** What the user changes; the garment and name always come from the parent's live tags. */
type Choices = Pick<RedrawSpec, "details" | "fixes" | "free">;
/** The note being typed: a new one of a kind, an existing one by index, or a detail chip turned into a note. */
type Editing = { kind: RedrawFree["kind"]; index?: number; fromDetail?: RedrawDetailId; text: string };

/** Details shown before "more": the ranked list puts the likely ones first, the rest is one tap away. */
const FIRST_DETAILS = 8;

type Props = {
  tags: ItemTags;
  name: string;
  brand?: string | null;
  /** Detection's description and issues, when the garment comes from intake. */
  description?: string | null;
  issues?: readonly string[];
  /** The saved item, when redrawing one from the wardrobe: its last spec reopens the composer. */
  itemId?: string | null;
  /** A tapped garment word changes the tags themselves (the parent normalizes), never the prompt alone. */
  onTagsChange: (patch: Partial<ItemTags>) => void;
  /** The swatch, and the hex a colour pick stores: the parent keeps the measured hex for the original colour. */
  colorHex: (c: ColorName) => string;
  onSubmit: (spec: RedrawSpec) => void;
  onCancel: () => void;
  busy: boolean;
};

/**
 * The AI redraw composer (Roy, 2026-11-18): the paid redraw's instructions as tappable words instead of a prompt.
 * The garment is running text, each word a tag (DESIGN.md: tags as dotted running text); details and fixes are chips
 * suggested for free from the name, detection and past redraws; at most two short free notes, for what the chips
 * cannot say. The English prompt is shown read-only, exactly as the server will build it. Cost on the button.
 */
export function RedrawComposer(props: Props) {
  const { t, i18n } = useTranslation();
  const [suggestion, setSuggestion] = useState<RedrawSuggestion | null>(null);
  const [choices, setChoices] = useState<Choices | null>(null);
  const [quote, setQuote] = useState<IntakeQuoteResult | null>(null);
  const [word, setWord] = useState<Word | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [allDetails, setAllDetails] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const align = { textAlign: i18n.language === "en" ? "left" : "right" } as const;

  // Suggestions are computed once, when the history arrives: re-ranking chips under the user's finger as they tap
  // would move the chip they were about to press.
  useEffect(() => {
    let live = true;
    void (async () => {
      const ctx = await fetchRedrawHistory();
      if (!live) return;
      const s = suggestRedraw({
        tags: props.tags,
        name: props.name,
        brand: props.brand,
        description: props.description,
        issues: props.issues,
        previous: previousSpec(ctx, props.itemId),
        history: ctx.history,
        itemId: props.itemId,
      });
      setSuggestion(s);
      setChoices({ details: s.spec.details, fixes: s.spec.fixes, free: s.spec.free });
    })();
    void quoteRedraw().then((q) => live && setQuote(q));
    return () => {
      live = false;
    };
    // Once per opening; later tag edits flow through withTags below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!suggestion || !choices) {
    return <Text className="mt-4 font-body text-body-sm text-ink-soft">{t("redraw.loading")}</Text>;
  }

  // don't touch / the garment is re-derived from the live tags on every render, so a word changed here or in the
  // rows above is what gets drawn; details the new garment type cannot take fall away instead of failing on the server.
  const spec = withTags({ v: 1, name: props.name, garment: suggestion.spec.garment, ...choices }, props.tags, props.name);
  // Ranked order from the opening suggestion; a changed garment type keeps what still applies and adds its own.
  const fits = detailsFor(spec.garment.subcategory);
  const offered = [...suggestion.details.filter((id) => fits.includes(id)), ...fits.filter((id) => !suggestion.details.includes(id))];
  const update = (next: RedrawSpec) => setChoices({ details: next.details, fixes: next.fixes, free: next.free });

  const tapDetail = (id: RedrawDetailId) => {
    const next = toggleDetail(spec, id);
    setNotice(next === spec ? t("redraw.limitDetails", { n: MAX_REDRAW_DETAILS }) : null);
    update(next);
  };
  const tapFix = (id: RedrawFixId) => update(toggleFix(spec, id));
  const startNote = (e: Editing) => {
    if (e.index === undefined && spec.free.length >= MAX_REDRAW_FREE) return setNotice(t("redraw.limitFree", { n: MAX_REDRAW_FREE }));
    setNotice(null);
    setEditing(e);
  };
  const commitNote = () => {
    if (!editing) return;
    const next = editing.fromDetail
      ? detailToFree(spec, editing.fromDetail, editing.text)
      : setFree(spec, { kind: editing.kind, text: editing.text }, editing.index);
    update(next);
    setEditing(null);
  };
  const removeNote = () => {
    if (editing?.index !== undefined) update(setFree(spec, { kind: editing.kind, text: "" }, editing.index));
    setEditing(null);
  };

  const price = quote?.ok ? `$${quote.price_usd.toFixed(3)}` : null;
  const outOfBudget = quote?.ok === true && quote.left_usd !== null && quote.left_usd < quote.price_usd;
  const words: { key: Word; label: string }[] = [
    { key: "subcategory", label: t(`item.subcategory.${spec.garment.subcategory}`) },
    { key: "color_name", label: t(`wardrobe.color.${spec.garment.color_name}`) },
    { key: "pattern", label: t(`item.pattern.${spec.garment.pattern}`) },
    { key: "material", label: t(`item.material.${spec.garment.material}`) },
    ...(hasSleeves(props.tags) ? [{ key: "sleeve" as const, label: t("redraw.sleeve", { value: t(`item.sleeve.${spec.garment.sleeve === "na" ? "short" : spec.garment.sleeve}`) }) }] : []),
  ];
  const shownDetails = allDetails ? offered : offered.slice(0, Math.max(FIRST_DETAILS, spec.details.length));
  const notesOf = (kind: RedrawFree["kind"]) => spec.free.map((n, index) => ({ ...n, index })).filter((n) => n.kind === kind);
  const offers = suggestion.freeSuggestions.filter((o) => !spec.free.some((n) => n.kind === o.kind && n.text.toLowerCase() === o.text.toLowerCase()));

  const noteChips = (kind: RedrawFree["kind"]) => (
    <>
      {notesOf(kind).map((n) => (
        <ComposerChip key={`note-${n.index}`} label={n.text} selected free onPress={() => startNote({ kind, index: n.index, text: n.text })} />
      ))}
      {offers
        .filter((o) => o.kind === kind)
        .map((o) => (
          <ComposerChip key={`offer-${o.text}`} label={o.text} selected={false} free onPress={() => (spec.free.length >= MAX_REDRAW_FREE ? setNotice(t("redraw.limitFree", { n: MAX_REDRAW_FREE })) : update(setFree(spec, o)))} />
        ))}
      <ComposerChip label={t("redraw.other")} selected={false} onPress={() => startNote({ kind, text: "" })} />
    </>
  );

  return (
    <View className="mt-5 border-s-2 border-ink ps-4">
      <Text className="font-body text-meta text-ink-faint">{t("redraw.title")}</Text>

      <View className="mt-2 flex-row flex-wrap items-baseline" style={{ rowGap: 6 }}>
        {spec.name ? (
          // The margin sits on a wrapper: the Text's own ltr direction would flip its margin-end to the wrong side.
          <View className="me-2">
            {/* Its own direction: an English name in an RTL line otherwise loses its closing quote to the next word. */}
            <Text className="font-body-semibold text-body text-ink" style={{ writingDirection: /[\u0590-\u05FF]/.test(spec.name) ? "rtl" : "ltr" }}>
              {`"${spec.name}"`}
            </Text>
          </View>
        ) : null}
        {words.map((w, n) => (
          <View key={w.key} className="flex-row items-baseline">
            <Pressable
              onPress={() => setWord(word === w.key ? null : w.key)}
              accessibilityRole="button"
              accessibilityState={{ expanded: word === w.key }}
              accessibilityHint={t("redraw.wordHint")}
              hitSlop={6}
            >
              {/* An underline is a bordered wrapper: RN cannot offset or colour text-decoration. */}
              <View className="border-b pb-1" style={{ borderColor: word === w.key ? colors.ink : colors["ink-faint"], borderBottomWidth: word === w.key ? 2 : 1 }}>
                <Text className="font-body text-body text-ink">{w.label}</Text>
              </View>
            </Pressable>
            {/* The dot trails its word, so a wrapped line never starts with one. */}
            {n < words.length - 1 ? <Text className="font-body text-body text-ink-faint">{" · "}</Text> : null}
          </View>
        ))}
      </View>
      {word ? <WordOptions word={word} tags={props.tags} colorHex={props.colorHex} onPick={(patch) => (props.onTagsChange(patch), setWord(null))} /> : null}

      <Text className="mt-5 font-body text-meta text-ink-faint">{t("redraw.details")}</Text>
      <View className="flex-row flex-wrap" style={{ gap: 8, paddingTop: 8 }}>
        {shownDetails.map((id) => (
          <ComposerChip
            key={id}
            label={t(`redraw.detail.${id}`)}
            selected={spec.details.includes(id)}
            onPress={() => tapDetail(id)}
            onLongPress={() => startNote({ kind: "detail", fromDetail: id, text: t(`redraw.detail.${id}`) })}
          />
        ))}
        {!allDetails && offered.length > shownDetails.length ? (
          <ComposerChip label={t("redraw.more", { n: offered.length - shownDetails.length })} selected={false} onPress={() => setAllDetails(true)} />
        ) : null}
        {noteChips("detail")}
      </View>

      <Text className="mt-5 font-body text-meta text-ink-faint">{t("redraw.fixes")}</Text>
      <View className="flex-row flex-wrap" style={{ gap: 8, paddingTop: 8 }}>
        {suggestion.fixes.map((id) => (
          <ComposerChip key={id} label={t(`redraw.fix.${id}`)} selected={spec.fixes.includes(id)} onPress={() => tapFix(id)} />
        ))}
        {noteChips("fix")}
      </View>

      {editing ? (
        <View className="mt-4">
          <Text className="font-body text-meta text-ink-faint">{editing.kind === "detail" ? t("redraw.noteDetail") : t("redraw.noteFix")}</Text>
          <TextInput
            value={editing.text}
            onChangeText={(text) => setEditing({ ...editing, text })}
            onSubmitEditing={commitNote}
            maxLength={MAX_REDRAW_FREE_CHARS}
            autoFocus
            returnKeyType="done"
            placeholder={t("redraw.notePlaceholder")}
            placeholderTextColor={colors["ink-faint"]}
            accessibilityLabel={editing.kind === "detail" ? t("redraw.noteDetail") : t("redraw.noteFix")}
            className="mt-1 border-b border-ink pb-1 font-body text-body text-ink"
            style={align}
          />
          <View className="mt-3 flex-row flex-wrap items-center" style={{ columnGap: 18, rowGap: 10 }}>
            <TextAction label={t("redraw.noteSave")} onPress={commitNote} />
            {editing.index !== undefined ? <TextAction label={t("redraw.noteRemove")} quiet onPress={removeNote} /> : null}
            <TextAction label={t("redraw.noteCancel")} quiet onPress={() => setEditing(null)} />
            <Text className="font-mono text-meta text-ink-faint">{`${editing.text.length}/${MAX_REDRAW_FREE_CHARS}`}</Text>
          </View>
        </View>
      ) : null}

      {notice ? <Text className="mt-3 font-body text-meta text-ink-soft">{notice}</Text> : null}

      <View className="mt-5 self-start">
        <TextAction label={showPrompt ? t("redraw.hidePrompt") : t("redraw.showPrompt")} quiet onPress={() => setShowPrompt(!showPrompt)} />
      </View>
      {showPrompt ? (
        // The prompt is English: always left-to-right, whatever the app's direction.
        <Text selectable className="mt-2 font-body text-meta text-ink-soft" style={{ writingDirection: "ltr", textAlign: "left" }}>
          {buildRedrawPrompt(spec)}
        </Text>
      ) : null}

      <View className="mt-5 flex-row flex-wrap items-center" style={{ columnGap: 18, rowGap: 12 }}>
        <Pressable
          accessibilityRole="button"
          disabled={props.busy || outOfBudget || editing !== null}
          onPress={() => props.onSubmit(spec)}
          className="items-center justify-center rounded border border-ink px-5"
          style={{ height: 40, opacity: props.busy || outOfBudget || editing !== null ? 0.4 : 1 }}
        >
          <Text className="font-body-semibold text-body-sm text-ink">
            {props.busy ? t("redraw.drawing") : price ? t("redraw.submitPrice", { price }) : t("redraw.submit")}
          </Text>
        </Pressable>
        <TextAction label={t("redraw.cancel")} quiet disabled={props.busy} onPress={props.onCancel} />
      </View>
      {quote?.ok && quote.left_usd !== null ? (
        <Text className="mt-2 font-body text-meta text-ink-faint">
          {outOfBudget ? t("intake.reason.monthly_limit") : t("redraw.left", { left: `$${quote.left_usd.toFixed(2)}` })}
        </Text>
      ) : null}
    </View>
  );
}

/** The closed list behind one garment word: the same chip row as the review screen, opened in place. */
function WordOptions({ word, tags, colorHex, onPick }: { word: Word; tags: ItemTags; colorHex: (c: ColorName) => string; onPick: (patch: Partial<ItemTags>) => void }) {
  const { t } = useTranslation();
  const common = { unsure: false, title: t(`item.spec.${word === "color_name" ? "color" : word === "subcategory" ? "type" : word}`) };
  switch (word) {
    case "subcategory":
      return <Row {...common} values={SUBCATEGORIES} proposed={tags.subcategory} selected={tags.subcategory} label={(v) => t(`item.subcategory.${v}`)} onPick={(v) => onPick({ subcategory: v })} />;
    case "color_name":
      return (
        <Row
          {...common}
          values={COLOR_NAMES}
          proposed={tags.color_name}
          selected={tags.color_name}
          label={(v) => t(`wardrobe.color.${v}`)}
          swatch={colorHex}
          onPick={(v) => onPick({ color_name: v, color_hex: colorHex(v) })}
        />
      );
    case "pattern":
      return <Row {...common} values={PATTERNS} proposed={tags.pattern} selected={tags.pattern} label={(v) => t(`item.pattern.${v}`)} onPick={(v) => onPick({ pattern: v })} />;
    case "material":
      return <Row {...common} values={MATERIALS} proposed={tags.material} selected={tags.material} label={(v) => t(`item.material.${v}`)} onPick={(v) => onPick({ material: v })} />;
    case "sleeve":
      return (
        <Row
          {...common}
          values={SLEEVE_CHOICES}
          proposed={undefined}
          selected={tags.sleeve === "na" ? "short" : tags.sleeve}
          label={(v) => t(`item.sleeve.${v}`)}
          onPick={(v) => onPick({ sleeve: v })}
        />
      );
  }
}

/**
 * The wardrobe filter chip (DESIGN.md section 3: selected is an ink fill, never the accent), plus a dashed border
 * for the user's own notes so typed text is never mistaken for a suggestion. Long press turns a detail into a note.
 */
function ComposerChip({ label, selected, free, onPress, onLongPress }: { label: string; selected: boolean; free?: boolean; onPress: () => void; onLongPress?: () => void }) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityHint={onLongPress ? t("redraw.longPressHint") : undefined}
      hitSlop={4}
      className={`justify-center rounded border px-3 ${selected ? "border-ink bg-ink" : "border-hairline"}`}
      style={{ minHeight: 34, borderStyle: free ? "dashed" : "solid", ...(free && !selected ? { borderColor: colors["ink-soft"] } : {}) }}
    >
      <Text className={`font-body text-body-sm ${selected ? "text-ivory" : "text-ink-soft"}`}>{label}</Text>
    </Pressable>
  );
}

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
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, TextInput, View } from "react-native";
import { Button, Chip, focusRingProps, Meta, Sheet, StatusLine } from "../../components/ui";
import { fetchRedrawHistory, previousSpec, quoteRedraw } from "../../data/redraw";
import { colors } from "../../theme/tokens";
import { hasSleeves, SLEEVE_CHOICES } from "../intake/tagRules";
import { spoken } from "../item/a11y";

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
  /**
   * Present = the composer is its own sheet (the item screen): the paid button and the budget line are pinned in the
   * sheet's footer so they stay visible however far the chips scroll, and closing the sheet cancels. Absent = inline
   * (intake review), with the actions at the end.
   */
  sheet?: { open: boolean; title: string };
  /** Why the last redraw failed, shown next to the paid button. */
  error?: string | null;
};

/**
 * The AI redraw composer (Roy, 2026-11-18): the paid redraw's instructions as tappable words instead of a prompt.
 * The garment is running text, each word a tag that opens its closed list; details and fixes are chips suggested for
 * free from the name, detection and past redraws; at most two short free notes, for what the chips cannot say. The
 * English prompt is shown read-only, exactly as the server will build it. The price is on the button: that button is
 * the confirmation, nothing is added before it and nothing taken away.
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

  const frame = (body: ReactNode, actions: ReactNode) =>
    props.sheet ? (
      <Sheet
        open={props.sheet.open}
        // A redraw in flight finishes in the sheet: closing would hide its result and its failure.
        onClose={() => (props.busy ? undefined : props.onCancel())}
        title={props.sheet.title}
        footer={actions}
      >
        {body}
      </Sheet>
    ) : (
      <View className="mt-6" style={{ gap: 24 }}>
        {body}
        {actions}
      </View>
    );

  if (!suggestion || !choices) {
    return frame(<StatusLine message={t("redraw.loading")} />, null);
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
        <Chip key={`note-${n.index}`} label={n.text} selected onPress={() => startNote({ kind, index: n.index, text: n.text })} />
      ))}
      {offers
        .filter((o) => o.kind === kind)
        .map((o) => (
          <Chip
            key={`offer-${o.text}`}
            label={o.text}
            dashed
            onPress={() => (spec.free.length >= MAX_REDRAW_FREE ? setNotice(t("redraw.limitFree", { n: MAX_REDRAW_FREE })) : update(setFree(spec, o)))}
          />
        ))}
      <Chip label={t("redraw.other")} dashed onPress={() => startNote({ kind, text: "" })} />
    </>
  );

  // Details the user picked, offered in an empty "own detail" note as starting text: the button route to what a
  // long press on a detail chip does (DESIGN.md section 6: a gesture is never the only way).
  const startFrom = editing && editing.kind === "detail" && editing.index === undefined && !editing.fromDetail && editing.text === "" ? spec.details : [];

  const body = (
    <View style={{ gap: 24 }}>
      <View style={{ gap: 8 }}>
        <Meta>{t("redraw.title")}</Meta>
        <View className="flex-row flex-wrap items-baseline" style={{ rowGap: 8 }}>
          {spec.name ? (
            // The margin sits on a wrapper: the Text's own ltr direction would flip its margin-end to the wrong side.
            <View className="me-2">
              {/* Its own direction: an English name in an RTL line otherwise loses its closing quote to the next word. */}
              <Text className="font-body-semibold text-body text-ink" style={{ writingDirection: /[֐-׿]/.test(spec.name) ? "rtl" : "ltr" }}>
                {`"${spec.name}"`}
              </Text>
            </View>
          ) : null}
          {words.map((w, n) => (
            <View key={w.key} className="flex-row items-baseline">
              <Pressable
                {...focusRingProps}
                onPress={() => setWord(word === w.key ? null : w.key)}
                accessibilityRole="button"
                accessibilityState={{ expanded: word === w.key }}
                accessibilityHint={spoken(t("redraw.wordHint"))}
                hitSlop={8}
              >
                {/* An underline is a bordered wrapper: RN cannot offset or colour text-decoration. Open = 2px ink. */}
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
      </View>

      <View style={{ gap: 8 }}>
        <Meta>{t("redraw.details")}</Meta>
        <ChipWrap>
          {shownDetails.map((id) => (
            <Chip
              key={id}
              label={t(`redraw.detail.${id}`)}
              selected={spec.details.includes(id)}
              onPress={() => tapDetail(id)}
              onLongPress={() => startNote({ kind: "detail", fromDetail: id, text: t(`redraw.detail.${id}`) })}
              accessibilityHint={spoken(t("redraw.longPressHint"))}
            />
          ))}
          {!allDetails && offered.length > shownDetails.length ? (
            <Chip label={t("redraw.more", { n: offered.length - shownDetails.length })} dashed onPress={() => setAllDetails(true)} />
          ) : null}
          {noteChips("detail")}
        </ChipWrap>
      </View>

      <View style={{ gap: 8 }}>
        <Meta>{t("redraw.fixes")}</Meta>
        <ChipWrap>
          {suggestion.fixes.map((id) => (
            <Chip key={id} label={t(`redraw.fix.${id}`)} selected={spec.fixes.includes(id)} onPress={() => tapFix(id)} />
          ))}
          {noteChips("fix")}
        </ChipWrap>
      </View>

      {editing ? (
        <View style={{ gap: 8 }}>
          <Meta>{editing.kind === "detail" ? t("redraw.noteDetail") : t("redraw.noteFix")}</Meta>
          {startFrom.length > 0 ? (
            <View style={{ gap: 8 }}>
              <Meta tone="text-ink-soft">{t("redraw.startFrom")}</Meta>
              <ChipWrap>
                {startFrom.map((id) => (
                  <Chip key={id} dashed label={t(`redraw.detail.${id}`)} onPress={() => setEditing({ kind: "detail", fromDetail: id, text: t(`redraw.detail.${id}`) })} />
                ))}
              </ChipWrap>
            </View>
          ) : null}
          <TextInput
            value={editing.text}
            onChangeText={(text) => setEditing({ ...editing, text })}
            onSubmitEditing={commitNote}
            maxLength={MAX_REDRAW_FREE_CHARS}
            autoFocus
            returnKeyType="done"
            placeholder={t("redraw.notePlaceholder")}
            placeholderTextColor={colors["ink-faint"]}
            accessibilityLabel={spoken(editing.kind === "detail" ? t("redraw.noteDetail") : t("redraw.noteFix"))}
            className="border-b-2 border-ink pb-1 font-body text-body text-ink outline-none"
            style={align}
          />
          <View className="flex-row flex-wrap items-center" style={{ columnGap: 24 }}>
            <Button variant="text" label={t("redraw.noteSave")} onPress={commitNote} />
            {editing.index !== undefined ? <Button variant="text" label={t("redraw.noteRemove")} onPress={removeNote} /> : null}
            <Button variant="text" label={t("redraw.noteCancel")} onPress={() => setEditing(null)} />
            <Text className="font-mono text-num-sm text-ink-soft">{`⁦${editing.text.length}/${MAX_REDRAW_FREE_CHARS}⁩`}</Text>
          </View>
        </View>
      ) : null}

      {notice ? <StatusLine message={notice} /> : null}

      <View>
        <Button variant="text" label={showPrompt ? t("redraw.hidePrompt") : t("redraw.showPrompt")} onPress={() => setShowPrompt(!showPrompt)} />
        {showPrompt ? (
          // The prompt is English: always left-to-right, whatever the app's direction.
          <Text selectable className="mt-2 font-body text-meta text-ink-soft" style={{ writingDirection: "ltr", textAlign: "left" }}>
            {buildRedrawPrompt(spec)}
          </Text>
        ) : null}
      </View>
    </View>
  );

  const disabled = props.busy || outOfBudget || editing !== null;
  const actions = (
    <View style={{ gap: 8 }}>
      {props.error ? <StatusLine variant="error" message={props.error} /> : null}
      <View className="flex-row flex-wrap items-center" style={{ columnGap: 24, rowGap: 8 }}>
        <Button
          variant="ink"
          fullWidth={props.sheet !== undefined}
          disabled={disabled}
          onPress={() => props.onSubmit(spec)}
          label={props.busy ? t("redraw.drawing") : price ? t("redraw.submitPrice", { price }) : t("redraw.submit")}
        />
        {/* In a sheet the close button is the cancel; inline needs its own. */}
        {props.sheet ? null : <Button variant="text" label={t("redraw.cancel")} disabled={props.busy} onPress={props.onCancel} />}
      </View>
      {quote?.ok && quote.left_usd !== null ? (
        outOfBudget ? (
          <StatusLine variant="error" message={t("intake.reason.monthly_limit")} />
        ) : (
          <Text className="font-body text-body-sm text-ink-soft">{t("redraw.left", { left: `⁦$${quote.left_usd.toFixed(2)}⁩` })}</Text>
        )
      ) : null}
    </View>
  );

  return frame(body, actions);
}

function ChipWrap({ children }: { children: ReactNode }) {
  return (
    <View className="flex-row flex-wrap" style={{ gap: 8 }}>
      {children}
    </View>
  );
}

/** The closed list behind one garment word, opened in place under the sentence. The current value is selected. */
function WordOptions({ word, tags, colorHex, onPick }: { word: Word; tags: ItemTags; colorHex: (c: ColorName) => string; onPick: (patch: Partial<ItemTags>) => void }) {
  const { t } = useTranslation();
  const title = t(`item.spec.${word === "color_name" ? "color" : word === "subcategory" ? "type" : word}`);
  const list = <T extends string>(values: readonly T[], selected: T, label: (v: T) => string, patch: (v: T) => Partial<ItemTags>, swatch?: (v: T) => string) => (
    <View className="mt-2" style={{ gap: 8 }}>
      <Meta tone="text-ink-soft">{title}</Meta>
      <ChipWrap>
        {values.map((v) => (
          <Chip key={v} label={label(v)} swatch={swatch?.(v)} selected={v === selected} onPress={() => onPick(patch(v))} />
        ))}
      </ChipWrap>
    </View>
  );
  switch (word) {
    case "subcategory":
      return list(SUBCATEGORIES, tags.subcategory, (v) => t(`item.subcategory.${v}`), (v) => ({ subcategory: v }));
    case "color_name":
      return list(COLOR_NAMES, tags.color_name, (v) => t(`wardrobe.color.${v}`), (v) => ({ color_name: v, color_hex: colorHex(v) }), colorHex);
    case "pattern":
      return list(PATTERNS, tags.pattern, (v) => t(`item.pattern.${v}`), (v) => ({ pattern: v }));
    case "material":
      return list(MATERIALS, tags.material, (v) => t(`item.material.${v}`), (v) => ({ material: v }));
    case "sleeve":
      return list(SLEEVE_CHOICES, tags.sleeve === "na" ? "short" : tags.sleeve, (v) => t(`item.sleeve.${v}`), (v) => ({ sleeve: v }));
  }
}

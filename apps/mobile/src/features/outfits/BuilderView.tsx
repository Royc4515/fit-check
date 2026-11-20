import type { Item, Slot } from "@fit-check/schema";
import { useNavigation, usePreventRemove, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BackHandler, Platform, ScrollView, Text, View, useWindowDimensions } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ActionBar,
  Button,
  Chip,
  Display,
  EmptyState,
  FlatLay,
  LegendRow,
  Meta,
  Sheet,
  Skeleton,
  StatusLine,
  TextField,
  type FlatLayEmptySlot,
  type FlatLayPiece,
} from "../../components/ui";
import { fitFlatLay } from "../../components/ui/flatLayFit";
import { useRtl } from "../../components/ui/interaction";
import { reasonOf } from "../../data/intake";
import { localDate } from "../../data/localDate";
import { SavedOutfitError } from "../../data/savedOutfit";
import { useWardrobe } from "../../data/WardrobeProvider";
import { colors, layout } from "../../theme/tokens";
import { failureMessage } from "../intake/failure";
import { spoken } from "../item/a11y";
import { heroGeometry } from "../item/geometry";
import { useItemFlight } from "../item/useItemFlight";
import {
  BUILDER_CONTEXTS,
  BUILDER_SLOTS,
  draftFromOutfit,
  draftPieces,
  emptyDraft,
  isDirty,
  missingKey,
  missingSlots,
  NAME_COUNTER_FROM,
  NAME_MAX,
  withPiece,
  type Draft,
} from "./builder";
import { PickerSheet } from "./PickerSheet";
import { createSavedOutfit, editSavedOutfit, loadOutfit } from "./store";

/** Space between the block above the hero (header row) and the hero, as on the outfit screen. */
const HERO_GAP = 16;
/** Room under the last field so it scrolls clear of the floating bar. */
const UNDER_BAR = 24;
/** Desktop: air around the flat-lay column and between the columns (as on Today and the outfit screen). */
const DESKTOP_PAD = 32;
const DESKTOP_GAP = 64;
const DESKTOP_HERO_MAX = 560;
/** The missing line's own height (one `meta` line), kept when nothing is missing so the bar never changes height. */
const META_LINE = 18;
/** Web: the close button's box, focused when the screen opens (focus otherwise stays on <body> under the sheet). */
const FOCUS_CLOSE = "builder-close";
/** Longest wait for the opening sheet to leave before the first focus is given up (its exit is under 500 ms). */
const FOCUS_WAIT_MS = 1000;

const fill = { position: "absolute", top: 0, bottom: 0, start: 0, end: 0 } as const;

type Props = { userId: string; /** Present = editing that saved outfit; absent = a new one. */ editId?: string };

type Load = "loading" | "missing" | "error" | "done";
type Failure = { kind: "error"; message: string } | { kind: "same"; otherId: string };
type Done = { kind: "created" | "existing" | "edited"; id: string };

/** Device-local yyyy-mm-dd: the day the outfit was built (`created_for_date`). */
function today(): string {
  return localDate(Intl.DateTimeFormat().resolvedOptions().timeZone).date;
}

/**
 * Building an outfit by hand, and editing a saved one (DESIGN.md "שלב 5.2" item 5). Over everything like the outfit
 * screen (the bar hidden), with its fade-in. `close` and the title; the hero is the flat-lay itself, in the four-piece
 * arrangement from the start so a choice never moves the other garments (a choice only cross-fades, 180 ms; reduced
 * motion: at once), each empty slot a rectangle that opens the picker; four legend rows that open it too; "למתי" as
 * one row of chips; the name with a visible count near its 40; a floating bar with "שמור", the screen's one accent,
 * and above it what is missing. Desktop: two columns, the button in the end column.
 *
 * Failure modes: a failed save keeps every choice and shows the reason with "נסה שוב" by the button (the design
 * preview rejects every write, so there it always fails); a new outfit whose garments are already saved opens that
 * outfit instead (nothing written); an edit whose garments equal another saved outfit stays here with a line that
 * offers that outfit. Edit of an unknown id: "not found" with a way back; a failed read: an error line with retry.
 * Leaving with changes (close, Escape, browser or hardware back) asks first; without changes it just leaves.
 */
export function BuilderView({ userId, editId }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const rtl = useRtl();
  const { width, height: windowH } = useWindowDimensions();
  const desktop = width >= layout.desktopMin;
  const wardrobe = useWardrobe();

  const [load, setLoad] = useState<Load>(editId ? "loading" : "done");
  const [attempt, setAttempt] = useState(0);
  const [initial, setInitial] = useState<Draft>(emptyDraft);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  useEffect(() => {
    if (!editId) return;
    let active = true;
    void loadOutfit(userId, editId).then(
      (o) => {
        if (!active) return;
        if (!o) return setLoad("missing");
        const start = draftFromOutfit(o);
        setInitial(start);
        setDraft(start);
        setLoad("done");
      },
      (error: unknown) => {
        console.error("Outfit to edit could not be read", editId, error);
        if (active) setLoad("error");
      }
    );
    return () => {
      active = false;
    };
  }, [editId, userId, attempt]);

  // The wardrobe's current copy of each garment (availability, name, a fresh photo), else the one the draft holds.
  const byId = useMemo(() => new Map(wardrobe.status === "ready" ? wardrobe.items.map((i) => [i.id, i] as const) : []), [wardrobe]);
  const resolve = useCallback((item: Item) => byId.get(item.id) ?? item, [byId]);

  // A deep link has nothing beneath it: back lands on the collection.
  const goBack = useCallback(() => (router.canGoBack() ? router.back() : router.replace("/outfits")), [router]);
  const page = useItemFlight(undefined, heroGeometry(width, windowH, rtl), "tile", goBack);
  const { close: fadeOut } = page;

  // ---- leaving -------------------------------------------------------------------------------------------------
  const [done, setDone] = useState<Done | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  // The navigation that was held for the confirm step (browser back, a swipe); null = the screen's own close.
  const held = useRef<(() => void) | null>(null);
  const dirty = load === "done" && isDirty(draft, initial);
  usePreventRemove(dirty && !leaving && done === null, ({ data }) => {
    held.current = () => navigation.dispatch(data.action);
    setLeaveOpen(true);
  });
  const close = useCallback(() => {
    if (dirty) {
      held.current = null;
      setLeaveOpen(true);
    } else void fadeOut();
  }, [dirty, fadeOut]);
  // Only once the hold is released (the next render) may the held action, or the close, go through.
  useEffect(() => {
    if (!leaving) return;
    const resume = held.current;
    held.current = null;
    if (resume) resume();
    else void fadeOut();
  }, [leaving, fadeOut]);

  const [pickerSlot, setPickerSlot] = useState<Slot | null>(null);
  useEffect(() => {
    // Hardware back is an Android thing; react-native-web's BackHandler is a stub that logs an error.
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (pickerSlot || leaveOpen) return false;
      close();
      return true;
    });
    return () => sub.remove();
  }, [close, pickerSlot, leaveOpen]);
  useEffect(() => {
    // Web Escape outside the sheets (they close themselves on it): the same as `close`.
    // don't touch / on keyup, like react-native-web's Modal: on keydown the confirm sheet opened here mounted in time
    // for the same key's keyup, and its own Escape handler closed it again at once (seen in the browser check).
    if (Platform.OS !== "web" || pickerSlot || leaveOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector('[aria-modal="true"]')) return;
      close();
    };
    document.addEventListener("keyup", onKey);
    return () => document.removeEventListener("keyup", onKey);
  }, [close, pickerSlot, leaveOpen]);
  useEffect(() => {
    // Web: start keyboard users at the screen's first control. The "+" sheet that opened this screen is still sliding
    // away when it mounts and drops focus on <body> only when it is gone (its opener is inert under this screen), so
    // this waits for that, for at most FOCUS_WAIT_MS, and never takes focus from anything the user already reached.
    if (Platform.OS !== "web") return;
    const started = Date.now();
    let frame = 0;
    const tick = () => {
      const at = document.activeElement;
      if (at === null || at === document.body) {
        document.getElementById(FOCUS_CLOSE)?.querySelector<HTMLElement>("[role=button], button")?.focus();
        return;
      }
      const inSheet = at instanceof HTMLElement && at.closest('[aria-modal="true"]') !== null;
      if (inSheet && Date.now() - started < FOCUS_WAIT_MS) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  // ---- saving --------------------------------------------------------------------------------------------------
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const missing = missingSlots(draft);
  const save = async () => {
    if (missing.length > 0 || saving || load !== "done") return;
    setSaving(true);
    setFailure(null);
    try {
      if (editId) {
        await editSavedOutfit(userId, editId, { garments: draftPieces(draft), contextType: draft.contextType, name: draft.name });
        setDone({ kind: "edited", id: editId });
      } else {
        const result = await createSavedOutfit(userId, { userId, date: today(), contextType: draft.contextType, source: "manual", pieces: draftPieces(draft), name: draft.name });
        setDone({ kind: result.created ? "created" : "existing", id: result.outfit.id });
      }
    } catch (error) {
      console.error("Outfit save failed", error);
      if (error instanceof SavedOutfitError && error.code === "same_garments" && error.otherId) setFailure({ kind: "same", otherId: error.otherId });
      else setFailure({ kind: "error", message: t("builder.saveFailed", { reason: failureMessage(t, reasonOf(error)) }) });
    } finally {
      setSaving(false);
    }
  };
  // After the hold is released: a new outfit replaces this screen with its own (back = the collection beneath), an
  // edit goes back to the outfit it came from.
  useEffect(() => {
    if (!done) return;
    if (done.kind === "edited") {
      if (router.canGoBack()) router.back();
      else router.replace({ pathname: "/outfit/[id]", params: { id: done.id } });
      return;
    }
    // don't touch / to the collection first, then the outfit over it: "back" from the new outfit must land on the
    // collection, whichever tab the "+" was pressed on (a plain replace left whatever tab was beneath).
    router.dismissTo("/outfits");
    router.push({ pathname: "/outfit/[id]", params: done.kind === "existing" ? { id: done.id, notice: "already" } : { id: done.id } });
  }, [done, router]);

  // ---- picking -------------------------------------------------------------------------------------------------
  const typeOf = useCallback((sub: string) => t(`item.subcategory.${sub}`), [t]);
  const indexOf = (slot: Slot) => String(BUILDER_SLOTS.indexOf(slot) + 1).padStart(2, "0");
  const chosen = (slot: Slot) => {
    const item = draft.pieces[slot];
    return item ? resolve(item) : null;
  };
  const choose = (item: Item | null) => {
    if (!pickerSlot) return;
    setDraft((d) => withPiece(d, pickerSlot, item));
    setFailure(null);
    setPickerSlot(null);
  };

  const pieces: FlatLayPiece[] = BUILDER_SLOTS.flatMap((slot) => {
    const item = chosen(slot);
    return item ? [{ slot, item, index: indexOf(slot), accessibilityLabel: t("builder.rowChosen", { index: indexOf(slot), slot: t(`outfit.slotTitle.${slot}`), type: typeOf(item.tags.subcategory), name: item.name }) }] : [];
  });
  // Every slot is offered, the layer too: the four-piece arrangement from the first frame (see FlatLay `emptySlots`).
  const emptySlots: FlatLayEmptySlot[] = BUILDER_SLOTS.map((slot) => ({ slot, label: t(`outfit.slotTitle.${slot}`), accessibilityLabel: t(`builder.chooseSlot.${slot}`) }));

  // ---- layout --------------------------------------------------------------------------------------------------
  const [viewportHeight, setViewportHeight] = useState(0);
  const [aboveHeight, setAboveHeight] = useState(0);
  const [barHeight, setBarHeight] = useState(0);
  const fit = fitFlatLay({
    measured: viewportHeight > 0 && aboveHeight > 0 && (desktop || barHeight > 0),
    desktop,
    width,
    viewportHeight,
    heroTop: aboveHeight,
    bottomReserved: desktop ? 0 : barHeight,
  });
  const desktopHero = Math.min(DESKTOP_HERO_MAX, viewportHeight > 0 ? (viewportHeight - aboveHeight - DESKTOP_PAD) / 1.25 : DESKTOP_HERO_MAX);
  const gutter = { paddingHorizontal: desktop ? DESKTOP_PAD : layout.gutter };
  const pageStyle = { width: "100%" as const, maxWidth: desktop ? layout.maxContentWidthWide : layout.maxContentWidth, alignSelf: "center" as const };

  const title = t(editId ? "builder.titleEdit" : "builder.titleNew");
  const header = (
    <View className="flex-row items-center" style={{ marginHorizontal: -8, gap: 4 }}>
      {/* The glyph sits 10px inside its 44 box; pulling the row out by 8 lines it up with the text's edge. */}
      <View nativeID={FOCUS_CLOSE}>
        <Button variant="icon" icon="close" accessibilityLabel={t("ui.close")} onPress={close} />
      </View>
      <Display size="display" level={1}>
        {title}
      </Display>
    </View>
  );

  const missingText = missingKey(missing);
  const failureLine =
    failure?.kind === "same" ? (
      <StatusLine
        variant="error"
        message={t("builder.sameAsOther")}
        action={{ label: t("builder.openOther"), onPress: () => router.push({ pathname: "/outfit/[id]", params: { id: failure.otherId } }) }}
      />
    ) : failure?.kind === "error" ? (
      <StatusLine variant="error" message={failure.message} action={{ label: t("common.retry"), onPress: () => void save() }} disabled={saving} />
    ) : null;
  const barContent = (
    <>
      {failureLine}
      {/* Always one line high, empty when nothing is missing: the bar never changes height as garments are chosen. */}
      <View style={{ minHeight: META_LINE }} accessibilityLiveRegion="polite">
        {missingText ? <Meta tone="text-ink-soft">{t(`builder.missing.${missingText}`)}</Meta> : null}
      </View>
      <Button
        variant="primary"
        fullWidth
        label={saving ? t("builder.saving") : t("builder.save")}
        onPress={() => void save()}
        disabled={missing.length > 0 || saving || load !== "done"}
      />
    </>
  );

  const heroLabel = spoken(pieces.length > 0 ? t("builder.heroLabel", { pieces: pieces.map((p) => p.accessibilityLabel).join(", ") }) : t("builder.heroEmpty"));
  const hero = (
    <View style={fit.cardWidth !== null ? { width: fit.cardWidth, alignSelf: "center" } : desktop ? { width: desktopHero } : undefined}>
      <FlatLay
        pieces={pieces}
        emptySlots={emptySlots}
        rise={false}
        onPressPiece={setPickerSlot}
        // The legend rows below do the same in 01-04 order; the garments, painted in z-order, would be extra tab stops.
        pieceFocusable={false}
        radius={desktop || fit.card ? "md" : "none"}
        accessibilityLabel={heroLabel}
        maxHeight={fit.maxHeight}
      />
    </View>
  );

  const legend = (
    <View className="border-t border-hairline">
      {BUILDER_SLOTS.map((slot) => {
        const item = chosen(slot);
        const slotName = t(`outfit.slotTitle.${slot}`);
        return item ? (
          <LegendRow
            key={slot}
            index={indexOf(slot)}
            title={typeOf(item.tags.subcategory)}
            detail={item.name}
            onPress={() => setPickerSlot(slot)}
            accessibilityLabel={spoken(t("builder.rowChosen", { index: indexOf(slot), slot: slotName, type: typeOf(item.tags.subcategory), name: item.name }))}
          />
        ) : (
          <LegendRow
            key={slot}
            index={indexOf(slot)}
            title={slotName}
            detail={t("builder.choose")}
            onPress={() => setPickerSlot(slot)}
            accessibilityLabel={t("builder.rowEmpty", { index: indexOf(slot), slot: slotName })}
          />
        );
      })}
    </View>
  );

  // An outfit saved from Today may be for a context outside the six; it stays selectable so an edit does not drop it.
  const contexts = BUILDER_CONTEXTS.some((c) => c === draft.contextType) ? [...BUILDER_CONTEXTS] : [...BUILDER_CONTEXTS, draft.contextType];
  const contextRow = (
    <View style={{ gap: 8 }}>
      <Meta tone="text-ink-soft">{t("builder.context")}</Meta>
      <View role="group" accessibilityLabel={t("builder.context")}>
        {/* One row that scrolls sideways when it does not fit; 4 above and below so the chips' 44 boxes are not cut.
            On a phone it runs to the screen's edges (the gutter moves inside it), so a chip that does not fit is cut by
            the screen, which reads as "more this way", not by an invisible line 20 in. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingVertical: 4, paddingHorizontal: desktop ? 0 : layout.gutter }}
          style={{ marginVertical: -4, marginHorizontal: desktop ? 0 : -layout.gutter }}
        >
          {contexts.map((c) => (
            <Chip key={c} label={t(`outfit.context.${c}`)} selected={draft.contextType === c} onPress={() => setDraft((d) => ({ ...d, contextType: c }))} />
          ))}
        </ScrollView>
      </View>
    </View>
  );

  const nameField = (
    <TextField
      label={t("builder.name")}
      value={draft.name}
      onChangeText={(name) => setDraft((d) => ({ ...d, name }))}
      maxLength={NAME_MAX}
      counterFrom={NAME_COUNTER_FROM}
      counterLabel={(n, max) => t("builder.nameCount", { n, max })}
    />
  );

  const details = (
    <View>
      {legend}
      <View className="mt-8">{contextRow}</View>
      <View className="mt-8">{nameField}</View>
    </View>
  );

  let content;
  if (load === "loading") {
    content = (
      <View>
        <Skeleton aspect={1.25} radius={desktop ? "md" : "none"} />
        <View className="mt-8" style={{ ...gutter, gap: 8 }}>
          <Skeleton height={46} width="60%" radius="sm" />
        </View>
      </View>
    );
  } else if (load === "error") {
    content = (
      <View style={gutter}>
        <StatusLine
          variant="error"
          message={t("outfit.loadFailed")}
          action={{
            label: t("common.retry"),
            onPress: () => {
              setLoad("loading");
              setAttempt((n) => n + 1);
            },
          }}
        />
      </View>
    );
  } else if (load === "missing") {
    content = (
      <View style={gutter}>
        <EmptyState title={t("outfit.notFound.title")} body={t("outfit.notFound.body")} level={2} action={{ label: t("outfit.notFound.action"), onPress: close }} />
      </View>
    );
  } else if (desktop) {
    content = (
      <View className="flex-row items-start" style={{ ...gutter, gap: DESKTOP_GAP }}>
        {hero}
        <View className="flex-1">
          {details}
          <View className="mt-8">
            <ActionBar floating={false}>{barContent}</ActionBar>
          </View>
        </View>
      </View>
    );
  } else {
    content = (
      <View>
        {hero}
        <View className="mt-8" style={gutter}>
          {details}
        </View>
      </View>
    );
  }

  const floatingBar = !desktop && load === "done";
  return (
    <View style={{ flex: 1 }} onLayout={(e) => setViewportHeight(e.nativeEvent.layout.height)}>
      {/* The ivory page fades in over whatever opened it, as the outfit screen does. */}
      <Animated.View pointerEvents="none" style={[fill, { backgroundColor: colors.ivory }, page.fadeStyle]} />
      <ScrollView
        contentContainerStyle={{ paddingBottom: (floatingBar ? barHeight : insets.bottom) + UNDER_BAR }}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View style={[pageStyle, page.contentStyle]}>
          <View onLayout={(e) => setAboveHeight(e.nativeEvent.layout.height)} style={{ ...gutter, paddingTop: insets.top + 8, paddingBottom: desktop ? DESKTOP_PAD : HERO_GAP }}>
            {header}
          </View>
          {content}
        </Animated.View>
      </ScrollView>
      {floatingBar ? (
        <ActionBar floating onLayout={(e) => setBarHeight(e.nativeEvent.layout.height)}>
          {barContent}
        </ActionBar>
      ) : null}
      <PickerSheet
        slot={pickerSlot}
        current={pickerSlot ? chosen(pickerSlot) : null}
        draft={draft}
        wardrobe={wardrobe}
        onChoose={choose}
        onClose={() => setPickerSlot(null)}
      />
      {/* The two answers sit in the footer: the sheet's first focus skips it (lands on the title), so an Enter pressed
          out of habit does not throw the work away. */}
      <Sheet
        open={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        title={t("builder.leave.title")}
        footer={
          <View className="flex-row flex-wrap items-center" style={{ columnGap: 24, rowGap: 8 }}>
            <Button
              variant="ink"
              label={t("builder.leave.confirm")}
              onPress={() => {
                setLeaveOpen(false);
                setLeaving(true);
              }}
            />
            <Button variant="text" label={t("builder.leave.stay")} onPress={() => setLeaveOpen(false)} />
          </View>
        }
      >
        <Text className="font-body text-body-sm text-ink-soft">{t("builder.leave.body")}</Text>
      </Sheet>
    </View>
  );
}

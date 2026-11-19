import type { Item } from "@fit-check/schema";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Display, Meta } from "../../components/ui";
import type { ItemWear } from "../../data/feedback";
import { InlineText } from "./InlineText";
import type { WearState } from "./useItemWears";
import type { Writing, WritingStatus } from "./useTextWriting";
import type { OpenText } from "./writing";
import { WearHistory } from "./WearHistory";

/** Fixed, so the fixture reads the same on any day: this year's wears carry no year, the last one does. */
const FIXTURE_YEAR = 2026;
const FIXTURE_DATES = ["2026-11-17", "2026-11-12", "2026-11-06", "2026-10-30", "2026-10-21", "2026-10-02", "2025-12-26"];
const noop = () => undefined;

/** A frozen writing state for a fixture: shown exactly as on the item screen, nothing reacts and nothing is saved. */
function fixtureWriting(open: OpenText | null, status: WritingStatus | null): Writing {
  return {
    open,
    status,
    // No focus and no scrolling: a fixture field must not pull the gallery to itself.
    quietOpen: true,
    start: noop,
    setDraft: noop,
    submit: noop,
    cancel: noop,
    retry: noop,
    flush: noop,
    pencilRef: () => noop,
  };
}

/**
 * Writing in place (DESIGN.md section 4, "כתיבה במקום") in its four looks, without writes: at rest, writing with a
 * changed name, the "נשמר" line, and a failed note save reopened with the typed text.
 */
function WritingGallery({ subject }: { subject: Item }) {
  const { t } = useTranslation();
  const typedNote = t("ds.item.writingFixtureNote");
  const name = (writing: Writing) => (
    <InlineText field="name" value={subject.name} writing={writing} label={t("item.edit.name")} editLabel={t("item.writing.editName")} size="display-xl">
      <Display size="display-xl" level={null} style={{ textAlign: "start" }}>
        {subject.name}
      </Display>
    </InlineText>
  );
  const demos: [string, ReturnType<typeof name>][] = [
    [t("ds.item.writingRest"), name(fixtureWriting(null, null))],
    [t("ds.item.writingEditing"), name(fixtureWriting({ field: "name", original: subject.name, draft: `${subject.name} ${t("ds.item.writingFixtureWord")}` }, null))],
    [t("ds.item.writingSaved"), name(fixtureWriting(null, { field: "name", kind: "saved", n: 1 }))],
    [
      t("ds.item.writingFailed"),
      <InlineText
        key="failed"
        field="notes"
        value=""
        writing={fixtureWriting(
          { field: "notes", original: "", draft: typedNote },
          { field: "notes", kind: "failed", message: t("item.writing.failed", { reason: t("item.writing.failedUnknown") }), draft: typedNote, original: "" }
        )}
        label={t("item.notes.title")}
        editLabel={t("item.writing.editNotes")}
        emptyText={t("item.notes.add")}
        size="body"
        multiline
      >
        {null}
      </InlineText>,
    ],
  ];
  return (
    <>
      {demos.map(([label, node]) => (
        <View key={label} style={{ gap: 8 }}>
          <Meta>{label}</Meta>
          {node}
        </View>
      ))}
    </>
  );
}

/**
 * The item screen's writing states and wear history in every state, for /design-system: the preview snapshot holds no worn outfit, so
 * the rows and "show all" are only visible here. Fixture wears built from real garments (one per category, in turn).
 */
export function ItemGallery({ items }: { items: readonly Item[] }) {
  const { t } = useTranslation();
  const { subject, wears } = useMemo(() => {
    const subject = items.find((i) => i.tags.category === "top") ?? items[0];
    const bottoms = items.filter((i) => i.tags.category === "bottom");
    const shoes = items.filter((i) => i.tags.category === "shoes");
    const layers = items.filter((i) => i.tags.category === "layer" || i.tags.category === "outerwear");
    const wears: ItemWear[] = subject
      ? FIXTURE_DATES.map((date, n) => {
          const pick = (list: Item[], stride: number) => (list.length ? [list[(n * stride) % list.length]!.id] : []);
          return { wearId: `fixture-${n}`, date, itemIds: [subject.id, ...pick(bottoms, 3), ...pick(shoes, 2), ...(n % 2 ? pick(layers, 1) : [])] };
        })
      : [];
    return { subject, wears };
  }, [items]);
  if (!subject) return null;

  const demos: [string, WearState][] = [
    [t("ds.item.wears"), { status: "ready", history: { total: 12, wears } }],
    [t("ds.item.once"), { status: "ready", history: { total: 1, wears: wears.slice(0, 1) } }],
    [t("ds.item.never"), { status: "ready", history: { total: 0, wears: [] } }],
    [t("ds.item.loading"), { status: "loading" }],
    [t("ds.item.failed"), { status: "failed" }],
  ];
  return (
    <View style={{ gap: 32 }}>
      <WritingGallery subject={subject} />
      {demos.map(([label, state]) => (
        <View key={label} style={{ gap: 8 }}>
          <Meta>{label}</Meta>
          <WearHistory itemId={subject.id} items={items} state={state} onRetry={noop} currentYear={FIXTURE_YEAR} />
        </View>
      ))}
    </View>
  );
}

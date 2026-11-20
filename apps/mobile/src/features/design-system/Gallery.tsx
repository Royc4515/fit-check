import { slotOf } from "@fit-check/engine";
import { COLOR_NAMES, type Item, type Slot } from "@fit-check/schema";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Monogram } from "../../components/brand/Monogram";
import {
  Button,
  Chip,
  CrossFade,
  Display,
  Meta,
  EmptyState,
  FlatLay,
  FlatLayPlaceholder,
  Icon,
  LegendRow,
  ListRow,
  MasonryGrid,
  MetaLink,
  OutfitTile,
  OutfitTileSkeleton,
  ScreenHeader,
  Segmented,
  Sheet,
  Skeleton,
  StatusLine,
  Stepper,
  Swatch,
  TabBar,
  TextField,
  TextTabs,
  Tile,
  TILE_CAPTION_HEIGHT,
  TopNav,
  type FlatLayPiece,
  type IconName,
  type MasonrySection,
  type NavItem,
} from "../../components/ui";
import { useWardrobe } from "../../data/WardrobeProvider";
import { tileAspect, tileTone, type TileTone } from "../../theme/tileTone";
import { layout, masonryColumnsFor } from "../../theme/tokens";
import { InsightsGallery } from "../insights/InsightsGallery";
import { IntakeGallery } from "../intake/IntakeGallery";
import { ItemGallery } from "../item/ItemGallery";
import { COLOR_HEX } from "../intake/palette";
import { CATEGORY_ORDER, groupByCategory } from "../wardrobe/filters";

const ICONS: readonly IconName[] = [
  "checkroom",
  "today",
  "add",
  "style",
  "insights",
  "person",
  "tune",
  "more_horiz",
  "close",
  "arrow_back",
  "chevron",
  "check",
  "search",
  "location_on",
  "undo",
  "info",
  "check_circle",
  "error",
  "favorite",
  "favorite_fill",
  "bookmark",
  "bookmark_fill",
];
const TONES: readonly TileTone[] = ["tile", "tile-deep", "tile-cool"];
/** Enough combinations to see every arrangement with several garment shapes. */
const FLAT_LAY_DEMOS = 8;
const AVAILABILITY = ["home", "laundry", "away", "lent"] as const;
type NavKey = "wardrobe" | "today" | "outfits" | "profile";
type Category = (typeof CATEGORY_ORDER)[number];

// Section head inside the masonry: display line (34) + 16 below it.
const SECTION_HEADER_H = 34 + 16;
const ltr = (s: string | number) => `⁦${s}⁩`;

/** A gallery block: display heading, then the demos. Gallery-only scaffolding, not a library component. */
function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View className="mt-12">
      <View className="mb-4 border-b border-hairline pb-3">
        <Display>{title}</Display>
      </View>
      {children}
    </View>
  );
}

/** A labelled demo cell: the state's name in meta above the component. */
function Demo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Meta>{label}</Meta>
      {children}
    </View>
  );
}

function Wrap({ children, gap = 16 }: { children: ReactNode; gap?: number }) {
  return (
    <View className="flex-row flex-wrap items-end" style={{ gap }}>
      {children}
    </View>
  );
}

/**
 * The CrossFade toggle, with its own state: a toggle in the gallery's state re-rendered the whole page on the same
 * frame as the fade and the browser dropped every frame of it.
 */
function CrossFadeDemo() {
  const { t } = useTranslation();
  const [faded, setFaded] = useState(false);
  return (
    <View style={{ gap: 16, maxWidth: layout.maxContentWidth }}>
      <CrossFade swapKey={faded ? "b" : "a"}>
        <Text className="font-body text-body text-ink">{t(faded ? "ds.crossFade.b" : "ds.crossFade.a")}</Text>
      </CrossFade>
      <View className="items-start">
        <Button variant="outline" label={t("ds.crossFade.toggle")} onPress={() => setFaded((f) => !f)} />
      </View>
    </View>
  );
}

/**
 * /design-system: every ui/ component in every variant and state, on ivory, fed by the real wardrobe. Internal
 * (not linked anywhere); it is how a screen task checks a component before using it. The whole page is the
 * MasonryGrid's header, which doubles as the demo of a grid under a scrolling screen header.
 */
export function Gallery() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width: windowW } = useWindowDimensions();
  const wardrobe = useWardrobe();
  const items = useMemo<Item[]>(
    () => (wardrobe.status === "ready" ? wardrobe.items.filter((i) => i.status === "active") : []),
    [wardrobe]
  );

  const contentW = Math.min(windowW, layout.maxContentWidthWide) - 2 * layout.gridGutter;
  const columns = masonryColumnsFor(windowW);
  // Demo tiles use the masonry's own column width, so they look exactly like the grid below.
  const tileW = (contentW - layout.gridGap * (columns - 1)) / columns;

  const [chips, setChips] = useState<ReadonlySet<string>>(new Set(["summer"]));
  const [removed, setRemoved] = useState(false);
  const [availability, setAvailability] = useState<(typeof AVAILABILITY)[number]>("home");
  const [mode, setMode] = useState<"one" | "many">("one");
  const [color, setColor] = useState<string | null>("navy");
  const [tileSelected, setTileSelected] = useState(true);
  const [sheet, setSheet] = useState<"short" | "long" | null>(null);
  const [nav, setNav] = useState<NavKey>("today");
  const [category, setCategory] = useState<Category | "all">("all");
  const [status, setStatus] = useState<"info" | "ok" | "error">("error");
  const [twoTab, setTwoTab] = useState("today");
  const [fourTab, setFourTab] = useState("day1");
  const [outfitFav, setOutfitFav] = useState(true);
  const [fieldText, setFieldText] = useState("");

  const toggleChip = (k: string) =>
    setChips((cur) => {
      const next = new Set(cur);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  // One real item per tone, so the tone rule is shown on actual garments.
  const byTone = useMemo(() => {
    const found = new Map<TileTone, Item>();
    for (const i of items) {
      const tone = tileTone(i.tags.color_hex);
      if (!found.has(tone)) found.set(tone, i);
    }
    return found;
  }, [items]);
  const sample = items[0];
  const withPhoto = items.find((i) => i.cutout_path) ?? sample;

  // Flat-lays from real garments: deterministic combinations stepping through each slot at a different stride, so
  // the demo covers many shapes (shorts, long trousers, boots, sneakers) and alternates 3 and 4 pieces.
  const [steps, setSteps] = useState(1);
  const flatLayW = Math.min(contentW, 390);
  const flatLays = useMemo<FlatLayPiece[][]>(() => {
    const bySlot = (s: Slot) => items.filter((i) => slotOf(i) === s);
    const [tops, bottoms, shoes, layers] = (["top", "bottom", "shoes", "layer"] as const).map(bySlot);
    if (!tops?.length || !bottoms?.length || !shoes?.length) return [];
    return Array.from({ length: FLAT_LAY_DEMOS }, (_, n) => {
      const pick: [Slot, Item | undefined][] = [
        ["top", tops[n % tops.length]],
        ["bottom", bottoms[(n * 3) % bottoms.length]],
        ["shoes", shoes[(n * 5) % shoes.length]],
        ["layer", n % 2 === 1 && layers?.length ? layers[(n * 2) % layers.length] : undefined],
      ];
      return pick.flatMap(([slot, item], k) =>
        item ? [{ slot, item, index: String(k + 1).padStart(2, "0"), accessibilityLabel: item.name }] : []
      );
    });
  }, [items]);

  const captionOf = useCallback(
    (i: Item) => ({
      title: i.name,
      meta:
        i.availability === "home"
          ? `${t(`item.subcategory.${i.tags.subcategory}`)} · ${t(`wardrobe.color.${i.tags.color_name}`)}`
          : t(`wardrobe.availability.${i.availability}`),
    }),
    [t]
  );

  const sections = useMemo<MasonrySection<Item>[]>(() => {
    const groups = groupByCategory(items).filter((g) => category === "all" || g.category === category);
    // "All" groups by category with a heading each; one category is a continuous grid (DESIGN.md "ארון" item 6).
    if (category !== "all") return [{ key: category, items: groups[0]?.items ?? [] }];
    return groups.map((g) => ({
      key: g.category,
      items: g.items,
      header: (
        <View className="flex-row items-baseline" style={{ gap: 8 }}>
          <Display level={3}>{t(`wardrobe.category.${g.category}`)}</Display>
          <Text className="font-mono text-num-sm text-ink-soft">{ltr(g.items.length)}</Text>
        </View>
      ),
    }));
  }, [items, category, t]);
  const shownCount = sections.reduce((n, s) => n + s.items.length, 0);
  const presentCategories = useMemo(() => CATEGORY_ORDER.filter((c) => items.some((i) => i.tags.category === c)), [items]);

  const keyOf = useCallback((i: Item) => i.id, []);
  const aspectOf = useCallback((i: Item) => tileAspect(i.tags.subcategory), []);
  const renderItem = useCallback(
    (i: Item, { width }: { width: number }) => (
      <Tile item={i} width={width} caption={captionOf(i)} dimmed={i.availability !== "home"} onPress={() => undefined} onLongPress={() => setSheet("short")} />
    ),
    [captionOf, setSheet]
  );

  const navItems: NavItem<NavKey>[] = [
    { key: "wardrobe", label: t("ds.nav.wardrobe"), icon: "checkroom" },
    { key: "today", label: t("ds.nav.today"), icon: "today" },
    { key: "outfits", label: t("ds.nav.outfits"), icon: "style" },
    { key: "profile", label: t("ds.nav.profile"), icon: "person" },
  ];
  const noop = () => undefined;
  const colorName = color ? t(`wardrobe.color.${color}`) : null;

  const header = (
    <View style={{ width: contentW, alignSelf: "center" }}>
      <ScreenHeader
        title={t("ds.title")}
        count={ICONS.length}
        actions={
          <>
            <Button variant="icon" icon="search" accessibilityLabel={t("ds.button.filter")} onPress={noop} />
            <Button variant="icon" icon="more_horiz" accessibilityLabel={t("ds.button.more")} onPress={noop} />
          </>
        }
      />
      <Text className="mt-2 font-body text-body text-ink-soft">{t("ds.intro")}</Text>

      <Block title={t("ds.section.buttons")}>
        <Text className="mb-4 font-body text-body-sm text-ink-soft">{t("ds.state.hint")}</Text>
        <Wrap>
          <Demo label={t("ds.variant.primary")}>
            <Button label={t("ds.button.primary")} onPress={noop} />
          </Demo>
          <Demo label={t("ds.variant.ink")}>
            <Button variant="ink" label={t("ds.button.ink")} onPress={noop} />
          </Demo>
          <Demo label={t("ds.variant.outline")}>
            <Button variant="outline" label={t("ds.button.outline")} onPress={noop} />
          </Demo>
          <Demo label={t("ds.variant.text")}>
            <Button variant="text" label={t("ds.button.text")} onPress={noop} />
          </Demo>
          <Demo label={t("ds.variant.icon")}>
            <View className="flex-row">
              <Button variant="icon" icon="arrow_back" accessibilityLabel={t("ds.button.back")} onPress={noop} />
              <Button variant="icon" icon="tune" accessibilityLabel={t("ds.button.filter")} onPress={noop} />
              <Button variant="icon" icon="tune" selected accessibilityLabel={t("ds.button.filterActive")} onPress={noop} />
            </View>
          </Demo>
        </Wrap>
        <View className="mt-6">
          <Wrap>
            <Demo label={t("ds.state.withIcon")}>
              <Button variant="ink" icon="add" label={t("ds.button.add")} onPress={noop} />
            </Demo>
            <Demo label={t("ds.state.disabled")}>
              <Button label={t("ds.button.primary")} disabled onPress={noop} />
            </Demo>
            <Demo label={t("ds.state.disabled")}>
              <Button variant="outline" label={t("ds.button.outline")} disabled onPress={noop} />
            </Demo>
            <Demo label={t("ds.state.disabled")}>
              <Button variant="icon" icon="more_horiz" disabled accessibilityLabel={t("ds.button.more")} onPress={noop} />
            </Demo>
          </Wrap>
        </View>
        <View className="mt-6" style={{ maxWidth: layout.maxContentWidth }}>
          <Demo label={t("ds.variant.fullWidth")}>
            <Button label={t("ds.button.primary")} fullWidth onPress={noop} />
          </Demo>
        </View>
      </Block>

      <Block title={t("ds.section.chips")}>
        <Wrap gap={8}>
          <Chip label={t("ds.chip.summer")} selected={chips.has("summer")} onPress={() => toggleChip("summer")} />
          <Chip label={t("ds.chip.winter")} selected={chips.has("winter")} onPress={() => toggleChip("winter")} />
          <Chip label={t("wardrobe.color.beige")} swatch={COLOR_HEX.beige} selected={chips.has("beige")} onPress={() => toggleChip("beige")} />
          <Chip label={t("wardrobe.color.white")} swatch={COLOR_HEX.white} selected={chips.has("white")} onPress={() => toggleChip("white")} />
          {removed ? null : <Chip label={t("ds.chip.removable")} swatch={COLOR_HEX.navy} removable onPress={() => setRemoved(true)} />}
          <Chip label={t("ds.chip.suggestion")} dashed onPress={() => toggleChip("linen")} selected={chips.has("linen")} />
          <Chip label={t("ds.chip.cotton")} disabled onPress={noop} />
        </Wrap>
      </Block>

      <Block title={t("ds.section.segmented")}>
        <View style={{ gap: 24, maxWidth: layout.maxContentWidth }}>
          <Segmented
            accessibilityLabel={t("ds.segmented.label")}
            segments={AVAILABILITY.map((k) => ({ key: k, label: t(`wardrobe.availability.${k}`) }))}
            value={availability}
            onChange={setAvailability}
          />
          <Segmented
            accessibilityLabel={t("ds.segmented.twoLabel")}
            segments={[
              { key: "one", label: t("ds.segmented.two.one") },
              { key: "many", label: t("ds.segmented.two.many") },
            ]}
            value={mode}
            onChange={setMode}
          />
          <Demo label={t("ds.state.disabled")}>
            <Segmented
              accessibilityLabel={t("ds.segmented.twoLabel")}
              disabled
              segments={[
                { key: "one", label: t("ds.segmented.two.one") },
                { key: "many", label: t("ds.segmented.two.many") },
              ]}
              value="one"
              onChange={noop}
            />
          </Demo>
        </View>
      </Block>

      <Block title={t("ds.section.textTabs")}>
        {/* Today's day tabs in both languages (the page's own direction applies to both rows). */}
        <View style={{ gap: 24, maxWidth: layout.maxContentWidth }}>
          {(["he", "en"] as const).map((lng) => (
            <View key={lng} style={{ gap: 16 }}>
              <Demo label={`${t("ds.textTabs.two")} · ${t(`ds.textTabs.${lng}`)}`}>
                <TextTabs
                  accessibilityLabel={t("ds.textTabs.label")}
                  tabs={[
                    { key: "today", label: t("today.tabs.today", { lng }) },
                    { key: "shabbat", label: t("today.tabs.shabbat", { lng }) },
                  ]}
                  value={twoTab}
                  onChange={setTwoTab}
                />
              </Demo>
              <Demo label={`${t("ds.textTabs.four")} · ${t(`ds.textTabs.${lng}`)}`}>
                <TextTabs
                  accessibilityLabel={t("ds.textTabs.label")}
                  tabs={[
                    { key: "today", label: t("today.tabs.today", { lng }) },
                    { key: "day1", label: t("today.tabs.holidayDay1", { lng }) },
                    { key: "day2", label: t("today.tabs.holidayDay2", { lng }) },
                    { key: "shabbat", label: t("today.tabs.shabbat", { lng }) },
                  ]}
                  value={fourTab}
                  onChange={setFourTab}
                />
              </Demo>
            </View>
          ))}
        </View>
      </Block>

      <Block title={t("ds.section.crossFade")}>
        <CrossFadeDemo />
      </Block>

      <Block title={t("ds.section.swatches")}>
        {/* A swatch is a 44 box around a 32 ring: the 12 between ring rows is already inside the boxes, so only the
            columns have a gap, and the 6 each box adds above and below the ring is pulled back by the margins. */}
        <View className="flex-row flex-wrap items-center" style={{ columnGap: 12, marginVertical: -6 }}>
          {COLOR_NAMES.map((name) => (
            <Swatch
              key={name}
              color={COLOR_HEX[name]}
              accessibilityLabel={t(`wardrobe.color.${name}`)}
              selected={color === name}
              onPress={() => setColor((cur) => (cur === name ? null : name))}
            />
          ))}
        </View>
        {/* The selected colour's name: selection is never colour-only. */}
        <Text className="mt-3 font-body text-body-sm text-ink-soft">{colorName ? t("ds.swatch.picked", { name: colorName }) : t("ds.swatch.none")}</Text>
      </Block>

      <Block title={t("ds.section.icons")}>
        <View className="flex-row flex-wrap" style={{ gap: 16 }}>
          {ICONS.map((name) => (
            <View key={name} className="items-center" style={{ width: 96, gap: 4 }}>
              <View className="flex-row" style={{ gap: 8 }}>
                <Icon name={name} size={24} color="ink" mirrorInRtl />
                <Icon name={name} />
              </View>
              <Text className="font-mono text-num-sm text-ink-soft">{name}</Text>
            </View>
          ))}
        </View>
      </Block>

      <Block title={t("ds.section.tiles")}>
        {withPhoto ? (
          <Wrap gap={8}>
            <Demo label={t("ds.state.default")}>
              <Tile item={withPhoto} width={tileW} caption={captionOf(withPhoto)} onPress={noop} onLongPress={() => setSheet("short")} />
            </Demo>
            <Demo label={t("ds.state.selected")}>
              <Tile
                item={withPhoto}
                width={tileW}
                caption={captionOf(withPhoto)}
                toggle
                selected={tileSelected}
                onPress={() => setTileSelected((v) => !v)}
              />
            </Demo>
            <Demo label={t("ds.state.notHome")}>
              <Tile item={withPhoto} width={tileW} dimmed caption={{ title: withPhoto.name, meta: t("wardrobe.availability.laundry") }} onPress={noop} />
            </Demo>
            <Demo label={t("ds.state.loading")}>
              <Tile loading width={tileW} aspect={1.25} caption={{ title: "", meta: "" }} />
            </Demo>
            <Demo label={t("ds.state.mini")}>
              <View className="flex-row" style={{ gap: 8 }}>
                {items.slice(0, 3).map((i) => (
                  <Tile key={i.id} item={i} size="mini" width={64} onPress={noop} />
                ))}
              </View>
            </Demo>
          </Wrap>
        ) : (
          <Skeleton width={tileW} aspect={1.25} />
        )}
        {sample ? (
          <View className="mt-6" style={{ width: Math.min(contentW, 390) }}>
            <Demo label={t("ds.state.hero")}>
              <Tile item={withPhoto ?? sample} size="hero" aspect={1} />
            </Demo>
          </View>
        ) : null}
      </Block>

      <Block title={t("ds.section.tones")}>
        <Wrap gap={8}>
          {TONES.map((tone) => {
            const i = byTone.get(tone);
            return (
              <Demo key={tone} label={t(`ds.tone.${tone}`)}>
                {i ? <Tile item={i} width={tileW} caption={captionOf(i)} /> : <Skeleton width={tileW} aspect={1.25} tone={tone} />}
              </Demo>
            );
          })}
        </Wrap>
      </Block>

      <Block title={t("ds.section.flatLay")}>
        <Text className="mb-4 font-body text-body-sm text-ink-soft">{t("ds.flatLay.intro")}</Text>
        <Wrap gap={24}>
          {flatLays.map((pieces, n) => (
            <View key={pieces.map((p) => p.item.id).join("+")} style={{ width: flatLayW }}>
              <FlatLay pieces={pieces} onPressPiece={noop} accessibilityLabel={t("ds.flatLay.label", { n: ltr(n + 1) })} />
              <View className="mt-2">
                {pieces.map((p) => (
                  <LegendRow key={p.slot} index={p.index} title={t(`item.subcategory.${p.item.tags.subcategory}`)} detail={p.item.name} />
                ))}
              </View>
            </View>
          ))}
          {/* The build screen's hero: every slot offered, one chosen (stage 5.2 item 5). */}
          {flatLays[0] ? (
            <View style={{ width: flatLayW }}>
              <FlatLay
                pieces={flatLays[0].filter((p) => p.slot === "top")}
                emptySlots={(["top", "bottom", "shoes", "layer"] as const).map((slot) => ({ slot, label: t(`outfit.slotTitle.${slot}`), accessibilityLabel: t(`builder.chooseSlot.${slot}`) }))}
                rise={false}
                onPressPiece={noop}
                accessibilityLabel={t("ds.flatLay.empty")}
              />
              <View className="mt-2">
                <Text className="font-body text-body-sm text-ink-soft">{t("ds.flatLay.empty")}</Text>
              </View>
            </View>
          ) : null}
          {/* Today's hero while its outfit is on its way (the frame, "waiting for a fresh forecast"). */}
          <View style={{ width: flatLayW }}>
            <FlatLayPlaceholder label={t("today.awaitingForecast")} />
          </View>
        </Wrap>
      </Block>

      <Block title={t("ds.section.textField")}>
        <View style={{ maxWidth: 360 }}>
          <TextField
            label={t("builder.name")}
            value={fieldText}
            onChangeText={setFieldText}
            maxLength={40}
            counterFrom={30}
            counterLabel={(n, max) => t("builder.nameCount", { n, max })}
          />
        </View>
      </Block>

      <Block title={t("ds.section.outfitTile")}>
        <Wrap gap={8}>
          {[flatLays[0], flatLays[1]].map((pieces, n) =>
            pieces ? (
              <Demo key={n} label={t(n === 0 ? "ds.outfitTile.plain" : "ds.outfitTile.favorite")}>
                <View style={{ width: tileW }}>
                  <OutfitTile
                    pieces={pieces}
                    title={n === 0 ? pieces.map((p) => t(`item.subcategory.${p.item.tags.subcategory}`)).join(" · ") : t("ds.outfitTile.name")}
                    meta={n === 0 ? t("outfits.neverWorn") : t("outfits.wornWithDate", { worn: t("outfits.worn", { count: 3, n: ltr(3) }), date: ltr("12.11") })}
                    favorite={n === 0 ? false : outfitFav}
                    onPress={noop}
                    onToggleFavorite={n === 0 ? noop : () => setOutfitFav((f) => !f)}
                    accessibilityLabel={t(n === 0 ? "ds.outfitTile.plain" : "ds.outfitTile.favorite")}
                    favoriteLabel={t(n === 1 && outfitFav ? "outfits.favoriteRemove" : "outfits.favoriteAdd")}
                  />
                </View>
              </Demo>
            ) : null
          )}
          <Demo label={t("ds.outfitTile.loading")}>
            <View style={{ width: tileW }}>
              <OutfitTileSkeleton />
            </View>
          </Demo>
        </Wrap>
      </Block>

      <Block title={t("ds.section.metaLink")}>
        <MetaLink label={t("location.osmCredit")} href="https://www.openstreetmap.org/copyright" />
      </Block>

      <Block title={t("ds.section.stepper")}>
        <View style={{ maxWidth: layout.maxContentWidth }}>
          <Stepper
            accessibilityLabel={t("ds.stepper.label")}
            value={steps}
            decrease={{ label: t("ds.stepper.less"), onPress: () => setSteps((s) => s - 1) }}
            increase={{ label: t("ds.stepper.more"), onPress: () => setSteps((s) => s + 1) }}
          />
          <Stepper
            accessibilityLabel={t("ds.stepper.label")}
            value={0}
            decrease={{ label: t("ds.stepper.less"), onPress: noop }}
            increase={{ label: t("ds.stepper.more"), onPress: noop }}
            disabled
          />
        </View>
      </Block>

      <Block title={t("ds.section.rows")}>
        <View style={{ maxWidth: layout.maxContentWidth }}>
          <ListRow label={t("ds.row.location")} value={t("ds.row.locationValue")} onPress={noop} />
          <ListRow label={t("ds.row.credits")} value={ltr(12)} />
          <ListRow label={t("ds.row.language")} value={t("ds.row.languageValue")} onPress={noop} disabled />
        </View>
      </Block>

      <Block title={t("ds.section.empty")}>
        <View style={{ maxWidth: layout.maxContentWidth }}>
          <EmptyState title={t("ds.empty.title")} body={t("ds.empty.body")} action={{ label: t("ds.empty.action"), onPress: noop }} />
        </View>
      </Block>

      <Block title={t("ds.section.skeleton")}>
        <Wrap gap={8}>
          {TONES.map((tone) => (
            <View key={tone} style={{ width: 96 }}>
              <Skeleton aspect={1.25} tone={tone} />
            </View>
          ))}
          <View style={{ width: 200, gap: 8 }}>
            <Skeleton height={22} radius="sm" />
            <Skeleton height={18} width={tileW} radius="sm" />
          </View>
        </Wrap>
      </Block>

      <Block title={t("ds.section.status")}>
        <View style={{ maxWidth: layout.maxContentWidth }}>
          <StatusLine variant="info" message={t("ds.status.info")} />
          <StatusLine variant="ok" message={t("ds.status.ok")} action={{ label: t("ds.status.undo"), onPress: noop }} />
          <StatusLine
            variant="info"
            message={t("today.status.skipped")}
            action={{ label: t("today.undo"), onPress: noop }}
            secondaryAction={{ label: t("today.dislike"), onPress: noop }}
          />
          <StatusLine variant="error" message={t("ds.status.error")} action={{ label: t("common.retry"), onPress: () => setStatus("ok") }} />
          <View className="mt-2">
            <Segmented
              accessibilityLabel={t("ds.section.status")}
              segments={(["info", "ok", "error"] as const).map((k) => ({ key: k, label: t(`ds.variant.${k}`) }))}
              value={status}
              onChange={setStatus}
            />
            <View className="mt-2">
              <StatusLine variant={status} message={t(`ds.status.${status}`)} />
            </View>
          </View>
        </View>
      </Block>

      <Block title={t("ds.section.sheet")}>
        <Text className="mb-4 font-body text-body-sm text-ink-soft">{t("ds.sheet.intro")}</Text>
        <Wrap>
          <Button variant="outline" label={t("ds.sheet.open")} onPress={() => setSheet("short")} />
          <Button variant="outline" label={t("ds.sheet.openLong")} onPress={() => setSheet("long")} />
        </Wrap>
      </Block>

      <Block title={t("ds.section.nav")}>
        <Demo label={t("ds.nav.mobile")}>
          <View className="border border-hairline" style={{ width: Math.min(contentW, 390), paddingTop: 8 }}>
            <TabBar items={navItems} activeKey={nav} onSelect={setNav} add={{ label: t("ds.nav.add"), onPress: () => setSheet("short") }} />
          </View>
        </Demo>
        <View className="mt-6">
          <Demo label={t("ds.nav.desktop")}>
            {/* TopNav is desktop-only (>= 900); squeezed into a phone it would only show clipping. */}
            {windowW >= layout.desktopMin ? (
              <View className="border border-hairline">
                <TopNav
                  brand={<Monogram size={32} />}
                  items={navItems}
                  activeKey={nav}
                  onSelect={setNav}
                  add={{ label: t("ds.nav.add"), onPress: () => setSheet("short") }}
                />
              </View>
            ) : (
              <StatusLine variant="info" message={t("ds.nav.desktopOnly")} />
            )}
          </Demo>
        </View>
      </Block>

      <Block title={t("ds.section.intake")}>
        <IntakeGallery items={items} />
      </Block>

      <Block title={t("ds.section.item")}>
        <ItemGallery items={items} />
      </Block>

      <Block title={t("ds.section.insights")}>
        <InsightsGallery />
      </Block>

      <Block title={t("ds.section.masonry")}>
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          <Chip label={t("ds.masonry.all")} selected={category === "all"} onPress={() => setCategory("all")} />
          {presentCategories.map((c) => (
            <Chip key={c} label={t(`wardrobe.category.${c}`)} selected={category === c} onPress={() => setCategory(c)} />
          ))}
        </View>
        <Text className="mt-3 mb-8 font-body text-body-sm text-ink-soft">
          {wardrobe.status === "ready" ? t("ds.masonry.hint", { n: ltr(shownCount), cols: ltr(columns) }) : t("ds.masonry.loading")}
        </Text>
      </Block>
    </View>
  );

  return (
    <View className="flex-1 bg-ivory">
      <MasonryGrid
        sections={sections}
        width={contentW}
        columns={columns}
        captionHeight={TILE_CAPTION_HEIGHT}
        sectionHeaderHeight={SECTION_HEADER_H}
        keyOf={keyOf}
        aspectOf={aspectOf}
        renderItem={renderItem}
        ListHeaderComponent={header}
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 }}
      />
      <Sheet
        open={sheet === "short"}
        onClose={() => setSheet(null)}
        title={t("ds.sheet.title")}
        footer={
          <View className="flex-row items-center justify-between">
            <Button variant="text" label={t("ds.sheet.clear")} onPress={() => setChips(new Set())} />
            <Button variant="ink" label={t("ds.sheet.show", { count: shownCount, n: ltr(shownCount) })} onPress={() => setSheet(null)} />
          </View>
        }
      >
        <Meta tone="text-ink-soft">{t("ds.sheet.season")}</Meta>
        <View className="mt-2 flex-row flex-wrap" style={{ gap: 8 }}>
          <Chip label={t("ds.chip.summer")} selected={chips.has("summer")} onPress={() => toggleChip("summer")} />
          <Chip label={t("ds.chip.winter")} selected={chips.has("winter")} onPress={() => toggleChip("winter")} />
        </View>
        <Meta tone="text-ink-soft" className="mt-6">{t("ds.sheet.type")}</Meta>
        <View className="mt-2 flex-row flex-wrap" style={{ gap: 8 }}>
          {presentCategories.map((c) => (
            <Chip key={c} label={t(`wardrobe.category.${c}`)} selected={category === c} onPress={() => setCategory(c)} />
          ))}
        </View>
      </Sheet>
      <Sheet open={sheet === "long"} onClose={() => setSheet(null)} title={t("ds.sheet.longTitle")}>
        {COLOR_NAMES.map((name) => (
          <ListRow key={name} label={t(`wardrobe.color.${name}`)} onPress={() => setColor(name)} value={color === name ? t("ds.state.selected") : undefined} />
        ))}
      </Sheet>
    </View>
  );
}

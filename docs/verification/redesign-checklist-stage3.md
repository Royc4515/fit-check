# Independent verification of stage 3

Two passes by a verifier that did not write the code: the first at a6f3fa4 (nine defects), the recheck at d39e451 after the fixes. Chromium on the web build, read-only design preview, Nominatim stubbed. Screenshot file names in the text are the verifier's scratch files; they are not in the repo.

## Pass 1 (a6f3fa4)

### Verification report, Fit Check head a6f3fa4 (verify3)
Method: web export served locally, Playwright chromium, preview mode (read-only), Nominatim stubbed in every run (no request left the browser), Open-Meteo and Hebcal real. Scripts and screenshots are in this directory (t*.js, *.png). `git status` clean.

### A. Today after "wearing" : PARTIAL / FAIL for the laundry case
- Worn state (preview already has today's wear): no floating bar; "נרשם · ביטול" at x=20 between masthead and hero; hero 0..390 wide.
- 390x844: hero 249..737, tab bar top 787: 50 px clear. 360x800: hero 249..699, tab top 743: 44 px clear. Preview banner (752-787 at 390) does not overlap the hero in this state. No blank band (legend starts right under the hero).
- Failed undo (real rejected write): focus stays on "ביטול"; error line "הפעולה לא נשמרה. נסה שוב." appears above the hero and pushes it: 390: hero bottom 789 vs tab 787 (2 px under); 360: 751 vs 743 (8 px under, plus the preview banner). Screenshots A_undofail_*.png.
- Laundry line cannot be produced (needs a real write). Emulated by cloning the real worn StatusLine DOM and replacing text with 4 item names ("אל תעביר לכביסה" / "Keep out of the laundry"): he 390: 789/787, he 360: 751/743 (2-line message, fits the 44 min height); EN 390: line 66 px, hero bottom 811 vs 787 (24 px of shoes hidden); EN 360: line 88 px, hero bottom 795 vs 743 (52 px hidden). So "the whole flat-lay is visible without scrolling" is false whenever a second line is present, worst in English. A_laundryemu_*.png (emulation, not the real component state).
- Opened already worn at 700x844 and 899x800 (card band): hero 560 wide, bottom 949 vs tab 787/743: 162-206 px below the tab bar. (Author listed as unchecked.)
- Success path of "לובש" and focus after it: NOT VERIFIABLE (write blocked in the data layer before the network, PreviewReadOnlyError).

### B. Shabbat row: PASS on the four rules and on times; one misleading case
Hebcal curl for geonameid 294981 equals the app to the minute in all cases.
- Fri 2026-11-20: "כניסת שבת 16:18 · צאת שבת 17:17" / "Shabbat begins 16:18 · Shabbat ends 17:17" (Hebcal 16:18, 17:17).
- Sat 11-21: "צאת שבת 17:17". Wed 11-18: nothing. Chanukah Tue 2026-12-08: nothing (correct, Hebcal gives only holiday events).
- Erev Pesach Wed 2027-04-21: "הדלקת נרות 18:53 · צאת החג 19:53" (end is tomorrow Thu, Hebcal 18:53 / 19:53).
- Yom Kippur eve Sun 2027-10-10: "הדלקת נרות 17:54 · צאת החג 18:50" (end is Monday). Wording says "holiday ends" for the fast.
- Rosh Hashana day 1 Sat 2027-10-02: "הדלקת נרות 19:01 · צאת החג 19:00" (candles tonight after nightfall, end is Sunday). Reads as the holiday ending a minute before candles are lit; no "Shabbat ends" shown although Shabbat ends tonight; no hint that the 19:01 is after nightfall. Correct data, misleading line. Screenshot B_rh1_360_he.png.
- 360 wide: all lines one line, 320 px, no clip; times are LTR isolates.

### C. Candle minutes, current location: PASS
Fixed Fri 2026-11-20, device tz Asia/Jerusalem. App request `b=` and displayed times vs Hebcal city id:
- Western Wall 31.7767,35.2345: b=40, 15:57 / 17:16 = geonameid 281184 (15:57/17:16).
- Haifa 32.7940,34.9896: b=30, 16:06 / 17:15 = 294801.
- Tel Aviv 32.0853,34.7818: b=20, 16:18 / 17:17 = 293397.
- Extra: Zikhron 32.5718,34.9528 b=30; Ramat Gan b=20; Gilo, Mt of Olives, Kiryat Shmuel b=40 (= Jerusalem id); Mevaseret 31.80,35.15 b=20; Ma'ale Adumim b=20; Carmel b=30 (= Haifa id); London tz Europe/London b=18 and no i=on.
- Code read (axis order [lon,lat], ray casting, tz rule): no logic error found. Limits: the rule keys on the DEVICE time zone, not the position: Tel Aviv coordinates with a device in Europe/London gave b=18 and 14:20 (London clock time), wrong for someone in Israel on a wrong-zone device. Also every load sends the same Hebcal request twice (duplicate fetch, harmless).

### D. Place name: PASS with defects
- Today weather label "מזג האוויר בירושלים", place line "ירושלים"; profile "מיקום נוכחי · ירושלים"; location screen shows name under the row; credit "שמות מקומות: © OpenStreetMap" at the bottom.
- Stub hits: 1 for first position (URL `...reverse?format=jsonv2&lat=31.777&lon=35.235&zoom=10&addressdetails=1&accept-language=he`), still 1 after reload, still 1 after +0.001 lat, 2 after +~1 km, 2 on repeat, 3 after switching to English (accept-language=en). Coordinates rounded to 3 decimals.
- Stub 500 / abort / delayed 6 s: Today shows "מיקום נוכחי", weather arrived at 0.7-0.9 s in all three (not delayed); profile and location screen fall back too; slow lookup aborts at 3 s.
- Permission denied: location screen says "אין הרשאת מיקום. אפשר לבחור עיר."; Today silently uses the default city Giv'at Shmuel, zero Nominatim hits.
- Regression: default city and searched city (חיפה) work: hebcal geonameid=294801, 16:06/17:15, no Nominatim call.
- Credit link: DIV role=link (no href), 44 px high, reachable by Tab (5th stop), 2 px ink outline. DEFECT: Enter and Space do nothing; only a pointer click opens openstreetmap.org/copyright.

### E. Inline writing: PARTIAL (preview limits)
- Pencils "עריכת שם"/"עריכת מותג" at the end edge, 44 px; field bordered, "שמירה" ink disabled when unchanged or when the name is empty (Enter on empty name does nothing, no hint); Enter saves name; Escape cancels, restores text and focus goes back to the pencil; Cancel button likewise; blur (click elsewhere) keeps the field open with the text. Notes: Enter = newline, Ctrl+Enter saves, maxlength 500 (counter "420/500" appears from 400), brand/name textarea/input labelled "שם הפריט"/"מותג". Failure: field reopens with typed text, role=alert line "לא נשמר. תצוגה לעיצוב בלבד: הפעולה לא בוצעה" + "נסה שוב"; name text at rest stays the old one.
- Second field while first has unsaved text: first is saved (fails in preview), the brand field opens, the name shows the OLD name with the error line and "נסה שוב" under it; field not reopened (author's known gap), the typed text lives only in the retry.
- DEFECT: leaving the screen with changed text: 2 save attempts are logged for one leave, the save fails, nothing visible anywhere (no alert, no message), typed text gone. Spec says it is saved; when it fails it is silently lost.
- DEFECT: after a failed save (Enter / Save via keyboard / Retry), focus is on BODY (field reopens quietly, previous focused element unmounted). Keyboard user loses place; Escape then does nothing.
- DEFECT: the name text and brand text are stray tab stops (DIV tabindex=0, no role, no name) before each pencil; Enter on them opens the editor. Source comment says the pencil is the only stop.
- Notes pencil/saved line/success path/haptic: NOT VERIFIABLE (preview item has no note; every write rejected). Gallery: `/design-system` renders without errors but contains NO writing fixtures (diff adds only MetaLink); EditField states rest/editing/saved/failed are not in the gallery.

### F. Regressions: PASS
No console errors or page errors on Today, Wardrobe, filter sheet, Insights, Archive, Profile, Location, Item, design-system at 390 he and 1280 en, other than the expected PreviewReadOnlyError logs and (first runs only, environment) an Open-Meteo CORS block through the sandbox proxy. Wardrobe -> item -> back keeps the wardrobe under the item (screenshots F_flight*.png). Language switch he<->en x2: dir rtl/ltr and lang switch correctly. `pnpm turbo run lint test --force` (uncached): exit 0, 8/8 tasks; tests schema 27, engine 82, mobile 92 passed. Deno function tests not run.

### G. Rule scan of `git diff e09aaba..HEAD -- apps/mobile/src`: PASS with nits
No physical ml-/mr-/left/right, no `any`, no `as unknown as`, no hex/rgba, no @ts-ignore, no JSX string literals in added lines. Exported constants without TSDoc: candleLighting.ts:11-13 (CANDLE_MINUTES_HAIFA_ZIKHRON/ISRAEL/DIASPORA; covered by the preceding group comment only). New one-off px values and `style={{gap:8}}` Views in TodayView.tsx (wornStatus wrapper) follow existing pattern. No animation-path state found in the diff.

### Defects by severity
1. MAJOR: laundry line (and a failed undo) push the flat-lay under the tab bar; EN 390 loses 24 px, EN 360 loses 52 px (emulated), he 2-8 px. Contradicts DESIGN item 8 "the whole flat-lay stays visible". A_laundryemu_*.png.
2. MAJOR: leaving the item screen with changed text whose save fails is silent data loss (no visible failure), and two save attempts per leave. 
3. MAJOR (for an observant user): Rosh Hashana day 1 on Saturday shows "candle lighting 19:01 · holiday ends 19:00", reads as end before start, no "Shabbat ends", no "after nightfall". Yom Kippur eve says "holiday ends" for the fast end.
4. MINOR: focus goes to BODY after a failed save (Enter, Save, Retry) on the item screen.
5. MINOR: OSM credit link ignores Enter/Space; no href.
6. MINOR: unnamed tab stops on name/brand text.
7. MINOR: already-worn at 600-899 wide leaves the hero 160-200 px under the tab bar.
8. MINOR: gallery has no writing fixtures.
9. MINOR: candle minutes key on the device time zone; duplicate Hebcal request per load; denied location silently shows the default city on Today.

### Not checked
Success paths of wear, undo, keep-home, text save (all writes blocked before the network); native keyboard; screen reader announcement (only the DOM roles/live regions inspected); the real laundry line (emulated); notes pencil with an existing note; Deno tests; weather timing beyond the fixed stubs.

## Recheck (d39e451)

### Recheck at d39e451 (verify3b). Method as before; scripts m*.js and mb.js, screenshots *.png here. git status clean.
Measurement note: "limit" = floating bar top, or the scene bottom above the tab bar / preview banner (preview banner sits above the tabs, so limit = banner top). Default (not worn) state is reached with a fake clock on Fri 2026-11-20 (the preview has a wear only for 11-19).

### 1 FIXED (one MINOR new)
Hero bottom vs limit-16, all met (slack >= 0):
- worn: 390x844 hero 249..736 h487 (limit 752); 360x800 249..692 h443; 700x900 w434 h543 bottom 792 (banner 808); 899x800 w354 h443 bottom 692; 1280 97..741 (banner 773).
- worn+failed undo: 390 h435 (bottom 736); 360 h391; 700 w393 h491; 899 w313 h391.
- worn+failed undo+emulated laundry (4 names): he 390 h383, he 360 h339, en 390 h361, en 360 h300 (bottom 697, limit 708; garments still readable, shoes visible, screenshot m_laundry_360_en.png); en 700 w351 h439; 899 w271 h339. worn+laundry only: 360 en h347.
- default Fri (times row present): 390 hero 207..663, bar top 679 (exactly 16); 360 207..619, bar 635. default Mon (no row): 390 181..663 h482. default + failed "לובש": 390 h404 (207..611), 360 h360 (207..567), bar tracks it, 16 gap kept. 700x900: h512/h460; 899x800: w330 h412 / w288 h360.
- 1280: two columns, hero 515x644, bottom 741 < banner 773.
- Worn + a times row (emulated by cloning the dateline): hero re-fits, 360 en bottom 692 (limit 708).
- No ivory side slivers, no clipped garments or numbers in the screenshots; surface stays full width and same tone. Window resize re-fits (390x700: h312 bar 535; back to 390x844: h456). Swipe forward follows the finger at 0.5 (90 px drag, garments +45), backward damped by design, springs back. Piece sheet "לפריט": item screen opens, the expanding image starts at 109,160 w222 near the garment (148,257 w182), not exactly on it; I cannot say how it was before.
- NEW MINOR: one-frame size jumps. First paint on Friday 390: hero 488 high for ~35 ms then 456 (and top 215->207 over 150 ms); after pressing "ביטול" (worn) hero is 487 high for one frame then 435; after failed "לובש" it goes straight to 404. Seen via rAF logging, not visible in 200 ms screenshots (seq_*.png).

### 2 FIXED
Item, brand text typed, preview (save fails). Write requests on /rest/v1/: 0 (blocked before network); save attempts counted from the console: exactly 1 per leave for header back by mouse, by keyboard (Enter), browser back, and a "goes with" item. In each: URL unchanged, screen open, field holds the typed text, "לא נשמר..." line and "נסה שוב".
- Second back press (still unsaved): 1 more attempt, stays. Browser back twice: stays, text kept; forward: still there. Cancel ("ביטול") then back: closes at once, 0 attempts. Emptied name then back: closes at once, 0 attempts. Not trapped: Cancel then back always gets out.
- Escape does nothing at screen level (no exit). Tab bar and dim area are not reachable on the item screen (item covers the tabs; no dim area). Overflow "remove from wardrobe" opens a confirm sheet; confirming ("הסר") attempts archive only (it does not save the typed text first; archive failed in preview and the screen stayed with the text). Typing a URL is a full page load, not testable.

### 3 FIXED for the misleading row; one MINOR left
Hebcal 294981 equals the app to the minute everywhere. Rows (he / en), all one line at 360 unless noted:
- Fri 11-20: כניסת שבת 16:18 · צאת שבת 17:17 / Shabbat begins 16:18 · Shabbat ends 17:17. Right (no "tomorrow" on Friday).
- Sat 11-21: צאת שבת 17:17. Right.
- Erev Pesach Wed 04-21: הדלקת נרות 18:53 · צאת החג מחר 19:53 / Candle lighting 18:53 · Holiday ends tomorrow 19:53 (en wraps to 2 lines at 360, exactly at " · "). Right.
- Pesach Thu 04-22: צאת החג 19:53. Right.
- Rosh Hashana eve Fri 10-01: כניסת שבת 18:06 / Shabbat begins 18:06. Correct for the candle; does not say it is also RH eve (MINOR, not misleading).
- RH day 1 Sat 10-02: הדלקת נרות 19:01 · צאת החג מחר 19:00 / Candle lighting 19:01 · Holiday ends tomorrow 19:00 (en wraps at " · "). The contradiction is gone. Still no "Shabbat ends" and no "after nightfall" for that candle time (MINOR).
- RH day 2 Sun 10-03: צאת החג 19:00. Right.
- Yom Kippur eve Sun 10-10: הדלקת נרות 17:54 · צאת הצום מחר 18:50 / ... Fast ends tomorrow 18:50. Right.
- Yom Kippur Mon 10-11: צאת הצום 18:50. Right.
- Erev Shavuot Thu 06-10: הדלקת נרות 19:26 (no end: it is two days away, per spec). Right.
- Shavuot Fri 06-11: כניסת שבת 19:26 · צאת שבת 20:30. Right.
- Chanukah weekday Tue 12-08: no row. Right.

### 4 FIXED
After a failed save by Enter, by Save (Space) and by Retry (Enter): document.activeElement = the textarea ("שם הפריט" / "Item name"), he and en. Tab next goes to "שמירה".

### 5 FIXED
Credit is now a real <a href=https://www.openstreetmap.org/copyright target=_blank>, 44 px. Enter: exactly one new tab to that URL. Click: exactly one. Space: nothing (normal for a link).

### 6 FIXED
Tab order on item (he and en): Back > More actions > Edit name (pencil) > Edit brand (pencil) > availability radio > Type chip > Colour chip > Pattern chip. Text is no longer a stop.

### 7 FIXED
Opened already worn: 700x900 hero w434 h543, bottom 792 (banner 808, tabs 843); 899x800 w354 h443, bottom 692 (tabs 743).

### 8 FIXED
/design-system section "מסך פריט: כתיבה במקום ולבישות" / "Item screen: writing in place and wears" renders rest, writing-changed (Save/Cancel), after saving ("נשמר"), save failed (notes text, Save/Cancel, "לא נשמר. בדוק את החיבור ונסה שוב." + "נסה שוב"), plus wears states. No console errors, no horizontal overflow at 390 he and 1280 en.

### 9 FIXED (Hebcal); PARTLY (permission)
Cold load of Today: 1 Hebcal request for the default city; 1 for current location (plus 1 Nominatim). Context without geolocation permission (Chromium answers denied): right after choosing "המיקום הנוכחי שלי" the location screen shows "אין הרשאת מיקום. אפשר לבחור עיר."; after reopening the screen the line is gone while Today silently still shows Giv'at Shmuel (MINOR).

### Regression
Today default Fri (times row + capped hero) 390/360 he/en measured above; "worn on a Friday" cannot be reached in the preview (wear only exists for 11-19), done by emulating the extra line. Console and page errors on Today, wardrobe, insights, archive, profile, location, design-system at 390 he and 360 en: none. Wardrobe -> item -> edit name -> cancel -> back: back at /wardrobe, 13 tiles, no errors. Language round trip x2: dir/lang switch correctly. `pnpm turbo run lint test --force`: exit 0, 8/8, 0 cached; schema 27, engine 82, mobile 101 tests passed.

### Not checked
Success paths of every write (wear, undo, keep-home, text save, archive); the real laundry line (emulated by DOM clone); native; screen-reader speech; typed-URL navigation; deno tests.

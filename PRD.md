# Fit Check - PRD

גרסה 0.1, 6.11.2026. מקור: מסמך המחקר "אפליקציית ארון וסטיילינג אישית".

## 1. מטרה ומדד הצלחה

אפליקציה אישית לניהול ארון וסטיילינג שפותרת את הבעיה שאף מתחרה לא פתרה: הזנה.
פריט נכנס לארון ב-2 הקשות, לא ב-2 דקות.

**מדד ההצלחה היחיד של ה-MVP:** 14 ימים רצופים של שימוש יומי (push בבוקר, אאוטפיט אושר או הוחלף) בלי לחזור לגיליון.

## 2. משתמש

- משתמש יחיד (Roy). הרחבה למשתמשים נוספים אפשרית בהמשך, לכן: `user_id` בכל טבלה + RLS מהמיגרציה הראשונה. אין מסכי הרשמה ב-MVP; התחברות בגוגל.
- מכשיר: אנדרואיד. web לניהול בדסקטופ. iOS מאותו קוד בהמשך.
- שפה: עברית ואנגלית מהיום הראשון (i18n), RTL/LTR לפי שפה.

## 3. היקף

| פיצ'ר | MVP | גרסה 2 |
| --- | --- | --- |
| הזנה | צילום של כמה בגדים, הפרדה, הסרת רקע, תיוג JSON, כרטיס אישור; ייבוא הגיליון הישן | ייבוא מ-Gmail, ייבוא מקישור, תמונת קטלוג אחידה |
| ארון | גריד, סינון, מצב זמינות (בבית / בכביסה / במילואים / מושאל) | סטטיסטיקות, עלות ללבישה, היגיינה שנתית |
| סטיילינג | אאוטפיט יומי לפי מזג אוויר + שבת וחג מ-Hebcal + override ידני; הסבר בעברית; לבשתי / דילגתי / לא אהבתי | יומן Google, תכנון שבועי, רשימות אריזה, זיכרון דייטים |
| קנייה | בדיקה לפני קנייה מתמונה: אאוטפיטים שנפתחים + כפילות + מידה | ניתוח חוסרים שבועי, רשימת משאלות עם מעקב מחירים |
| פלטפורמה | Expo: אנדרואיד (APK) + web; push בוקר בשעה קבועה | iOS, widgets |
| עיצוב | DESIGN.md, מסך "היום" ומסך ארון מלוטשים, shared element transition אחד | שאר ההנפשות, מצב כהה |
| AI | Gemini 2.5 Flash Image, Claude Haiku, Claude Sonnet, FashionCLIP, BiRefNet | מדידה וירטואלית (FASHN), ניתוח צבעים אישי |

## 4. פלואים

### 4.1 Onboarding (פעם אחת)
1. התחברות בגוגל.
2. מידות: גובה, חולצה, מכנס (W/L), נעליים. נשמר ב-`profile`.
3. צילום גוף מלא (אופציונלי, לגרסה 2). נשמר ב-bucket פרטי.
4. כללי הקשר: ברירות המחדל מסעיף 7 מוצגות לאישור או לעריכה.
5. ייבוא הגיליון: CSV של 109 פריטים הופך לכרטיסים בלי תמונה, עם בקשה לצלם.

### 4.2 הזנה (Intake)
1. המשתמש פורס 2-5 בגדים על משטח אחיד ומצלם תמונה אחת.
2. `intake-separate`: Gemini 2.5 Flash Image מחזיר תמונה לכל פריט (flat-lay). אם חזר פריט אחד בלבד, ממשיכים איתו.
3. `intake-cutout`: worker ב-Modal (BiRefNet) מסיר רקע, מייצר PNG שקוף + thumbnail 400px. נשמרים ב-Storage.
4. `intake-tag`: Claude Haiku מקבל את ה-cutout ומחזיר JSON לפי סכמת התגיות (סעיף 6.2). בנוסף: embedding של FashionCLIP (512-d) מה-worker.
5. כרטיס אישור: תמונה + תגיות. החלקה ימינה = שמירה. הקשה על תגית = תיקון מרשימה סגורה. שדות ידניים אופציונליים: מותג, מחיר, תאריך רכישה.
6. פריט נשמר עם `status = active`, `availability = home`.

יעד: מצילום לשמירה של 4 פריטים בפחות מ-60 שניות, מתוכן פחות מ-15 שניות של אינטראקציה.

### 4.3 היום (המסך הראשי)
1. cron ב-06:00 מייצר הצעה ליום (`generate-daily`) ושולח push ב-07:00 (שעה מוגדרת בהגדרות).
2. המסך מציג: האאוטפיט (תמונות הפריטים על רקע שנהב), ההסבר (משפט-שניים), מזג האוויר, ההקשר שזוהה (חול / שבת / אירוע).
3. פעולות: "לובש" (נרשם ב-`wears`), "החלף פריט" (בוחר slot, מקבל 3 חלופות), "יותר חם / קר", "יותר רשמי / פחות", "דלג" (עם סיבה אופציונלית).
4. ביום שישי ההצעה היא לשבת ונשלחת 3 שעות לפני הדלקת נרות. בערב חג, אותו דבר לכל ימי החג. המימוש (19.11.2026, `DESIGN.md` "שלב 4.1"): ביום שיש בו הדלקת נרות המסך מציג, לצד הלוק של היום, לוק לכל אחד מהימים שעד ההבדלה; כל לוק הוא הלוק של התאריך שלו ונרשם עליו. ההתראה עצמה מחכה לאפליקציית האנדרואיד.

### 4.4 ארון
- גריד של cutouts, קיבוץ לפי קטגוריה, סינון לפי צבע, עונה, פורמליות, זמינות.
- מסך פריט: תמונה גדולה, תגיות, היסטוריית לבישות, "עם מה זה הולך" (3 אאוטפיטים מהמנוע), עריכה, שינוי זמינות.
- פעולת "מילואים": בחירת פריטים שיוצאים מהבית, מסומנים `availability = away` עד הקשה על "חזרתי" (ואז מוצע לסמן אותם `laundry`).

### 4.5 בדיקה לפני קנייה
1. תמונה (בחנות) או קישור (גרסה 2).
2. הפריט עובר את צינור ההזנה כ-`status = virtual`.
3. המנוע מחשב: מספר אאוטפיטים חדשים מעל סף, כפילות (פריטים קיימים עם דמיון embedding מעל 0.85), התאמת מידה.
4. כרטיס תוצאה: כן / לא / "כן, אבל", עם הסבר של משפט. הפריט הווירטואלי נמחק אחרי 7 ימים אלא אם סומן "קניתי".

## 5. מנוע הסטיילינג

ארבעה שלבים. ה-LLM נכנס רק בשלב 3 ואף פעם לא רואה את כל הארון.

1. **סינון קשיח (SQL):** `availability = home`, `status = active`, טווח טמפרטורה לפי התחזית (`temp_min_c`, `temp_max_c` על הפריט), עונה, כללי ההקשר (סעיף 7), דגלי צניעות.
2. **יצירת מועמדים:** לכל slot (top, bottom, shoes, layer אופציונלי לפי טמפרטורה) אחזור HNSW ב-pgvector לפי עוגן (פריט שנבחר ידנית, או הפריט שהכי פחות נלבש לאחרונה מהקטגוריה). ניקוד לכל שילוב:
   - `color_harmony` (0-1): לפי מרחק hue וכללי ניטרליים.
   - `formality_consistency` (0-1): 1 פחות סטיית התקן של הפורמליות בשילוב, מנורמל.
   - `context_fit` (0-1): מרחק מהטווח של ההקשר.
   - `recency_penalty`: פריט שנלבש ב-3 הימים האחרונים מקבל 0.5-; אאוטפיט שלם שחזר על עצמו ב-14 יום מקבל 1-.
   - `pair_weight`: משקל נלמד לזוג פריטים (התחלה מהערות הגיליון, עדכון מפידבק).
   - ציון = ממוצע משוקלל; המשקלים בקובץ config, לא בקוד.
3. **הסטייליסט (Claude Sonnet):** קלט: 5-8 שילובים מדורגים כ-JSON (id, name, color, formality לכל פריט), הקשר, מזג אוויר, 7 הלבישות האחרונות, תקציר הארון (ב-system prompt עם prompt caching). פלט JSON קבוע: `{chosen_outfit_id, explanation_he, explanation_en, swap_suggestion: {slot, item_id, reason}}`. טמפרטורה 0.3.
4. **פידבק:** `wears` עם `feedback ∈ {worn, skipped, disliked}` + `reason` חופשי. כל worn מעלה `pair_weight` לכל זוג בשילוב ב-0.05; disliked מוריד ב-0.1. חלון למידה: 90 יום.

## 6. נתונים

### 6.1 טבלאות (Supabase Postgres)

- `profile`: user_id, height_cm, shirt_size, pants_w, pants_l, shoe_size, locale, push_hour, body_photo_path.
- `items`: id, user_id, name, brand, category, subcategory, tags (jsonb, סכמה 6.2), color_hex, color_name, pattern, material, formality (1-10), seasons text[], temp_min_c, temp_max_c, modesty_flags text[], status (active | virtual | archived), availability (home | laundry | away | lent), price, currency, purchased_at, source (photo | sheet | link | receipt), original_path, cutout_path, thumb_path, redraw_spec (jsonb, the last AI redraw's composer choices; not part of the tags), created_at.
- `item_vectors`: item_id, embedding vector(512), model_version.
- `outfits`: id, user_id, context_type, created_for_date, score, llm_explanation_he, llm_explanation_en, source (daily | manual | swap).
- `outfit_items`: outfit_id, item_id, slot.
- `wears`: id, outfit_id, worn_on, feedback, reason, selfie_path.
- `contexts`: id, user_id, date, type (weekday | shabbat | holiday | reserve | date | interview | event | trip), source (hebcal | calendar | manual), payload jsonb.
- `pair_weights`: item_a, item_b, weight, updated_at.
- `context_rules`: user_id, type, rules jsonb (סעיף 7).
- `wishlist`, `price_history`, `receipts`: גרסה 2, נוצרות עכשיו ריקות כדי לא לשנות מיגרציות אחר כך.

Storage: bucket `originals` (פרטי), bucket `cutouts` (ציבורי דרך CDN; thumbnails נוצרים בזמן החיתוך, לא ב-transformations).

### 6.2 סכמת התגיות (קבועה; שינוי = תיוג מחדש של הכל)

```json
{
  "category": "top | bottom | shoes | layer | outerwear | accessory",
  "subcategory": "button_down | tshirt | polo | knit | sweatshirt | jeans | chinos | trousers | shorts | sneakers | boots | dress_shoes | sandals | coat | jacket | belt | watch | hat",
  "color_hex": "#RRGGBB",
  "color_name": "navy | white | black | grey | beige | brown | olive | burgundy | blue | light_blue | red | green | orange | yellow | pink | cream",
  "secondary_color_hex": "#RRGGBB | null",
  "pattern": "solid | stripes | check | print | melange | denim",
  "material": "cotton | linen | wool | denim | synthetic | leather | suede | mixed | unknown",
  "fit": "slim | regular | relaxed | oversized",
  "sleeve": "short | long | sleeveless | na",
  "formality": 1,
  "seasons": ["summer", "transition", "winter"],
  "temp_min_c": 0,
  "temp_max_c": 40,
  "modesty_flags": ["short_sleeve", "short_pants", "open_front"],
  "style_tags": ["preppy", "smart_casual", "streetwear", "outdoor", "sport", "formal", "resort"]
}
```

הסקאלה 1-10 לפורמליות נשמרת מהגיליון הקיים. מודל התיוג מקבל את הרשימות הסגורות בפרומפט ומחזיר רק ערכים מהן (structured output).

### 6.3 ייבוא הגיליון

מיפוי עמודות: Item Name → name, Category → category/subcategory (מפת תרגום קבועה), Style/Usage → style_tags, Primary Color → color_name, Formality → formality, Season → seasons, Notes → הערה + חילוץ "match with belt 1201/1204" ל-`pair_weights` התחלתי של 0.3. מותג מחולץ מהשם כשהוא מופיע (Tommy Hilfiger, Gant, Zara, Gap, Polo Ralph Lauren, Nike, American Eagle, Timberland, Kenneth Cole, Levi's, Mango, Fox, Nautica, Columbia, The North Face).

## 7. כללי הקשר (ברירות מחדל, נערכות ב-onboarding, נלמדות מפידבק)

| הקשר | זיהוי | כלל קשיח | טווח פורמליות |
| --- | --- | --- | --- |
| weekday | ברירת מחדל | לפי מזג אוויר, גיוון בין ימים | 3-6 |
| shabbat / holiday | Hebcal | top: button_down בלבד; bottom: chinos / trousers (לא jeans, לא shorts); shoes: dress_shoes / boots (לא sneakers, לא sandals) | 7-10 |
| reserve | ידני | אין סטיילינג; רשימת אריזה: N טי-שרטים לבנים (subcategory tshirt, color white); הפריטים שנבחרו מסומנים away | - |
| date | ידני | top: button_down / polo; bottom: jeans (כהה) / chinos; shoes: boots / sneakers (formality ≥ 4); בלי print, בלי shorts; אאוטפיט שלם לא חוזר עם אותה בחורה | 5-7 |
| interview | ידני, עם סוג חברה | tech: smart casual, button_down אופציונלי; corporate: button_down + trousers | tech 5-7, corporate 7-9 |
| trip | ידני, יעד + תאריכים | רשימת אריזה לפי תחזית היעד, כולל שבת | - |
| תמיד | - | ציצית מתחת: tops באורך regular ומעלה; כיפה: כובעי חורף תואמים | - |

### 7.1 הקשר ידני והקשר דרך ה-MCP (19.11.2026)

החלטות רועי: הקשר ידני באפליקציה הוא הבסיס; חיבור ליומן לא נבנה בתוך האפליקציה אלא דרך ה-AI האישי של המשתמש, שיש לו גישה ליומן וכותב את ההקשר דרך שרת ה-MCP ("רק את זה" ולא "גם וגם", עד שיהיו משתמשים בלי AI אישי). הסיבות: קריאת יומן היא הרשאה רגישה שדורשת אימות של Google, אסימונים שמורים, משימת שרת ושינוי במסד; ודרך ה-MCP אירועי היומן לא עוברים דרכנו בכלל, רק סוג היום.

- **מה נשמר.** שורה בטבלה הקיימת `contexts` לכל (משתמש, תאריך): `type` אחד מ-`date`, `interview`, `event` (ההקשרים שהמנוע מסגנן להם לוק; `reserve` ו-`trip` הם רשימות אריזה ונשארים בחוץ), `source` = `manual` (נבחר באפליקציה, או נאמר ל-AI במפורש) או `calendar` (ה-AI הסיק מהיומן), ו-`payload.label`: תיאור קצר להצגה, עד 60 תווים, בלי שמות של אנשים ובלי כותרת האירוע כלשונה ("ראיון עבודה", "אירוע משפחתי בערב"). הקשר אחד לכל תאריך: קביעת הקשר מוחקת הקשר קודם של אותו תאריך.
- **קדימות.** הקשר שנקבע לתאריך גובר על הקשר הלוח (יום חול, שבת, חג) לאותו תאריך: זו בחירה מפורשת. האפליקציה מציגה תמיד מה ההקשר ומאיפה הגיע ("ראיון · מהיומן"), עם אפשרות לבטל בהקשה אחת.
- **כלי MCP.** `context_set` (סוג, תאריך שברירת המחדל שלו היום, תיאור, מקור), `context_get`, `context_clear`. `outfit_today` מכבד את ההקשר של היום. ה-workflow שנותנים ל-AI האישי כתוב ב-`docs/mcp/daily-context-workflow.md`.
- **הגדרות אישיות עוברות ל-`profile`** (רועי אישר את המיגרציה): `observes_shabbat boolean not null default true`. האפליקציה קוראת וכותבת אותה (עם עותק במכשיר לעבודה בלי רשת), וגם שרת ה-MCP קורא אותה, כך ש-`outfit_today` מתנהג כמו האפליקציה. כשהמתג כבוי: שבת יום רגיל, וחג "טיפה יותר" חגיגי: הקשר יום חול עם צעד אחד של "יותר רשמי" כברירת מחדל.

## 8. אינטגרציות

- Open-Meteo: תחזית שעתית לגבעת שמואל (32.078, 34.848), cache של 3 שעות.
- Hebcal: `shabbat?cfg=json&geonameid=293397` (פתח תקווה הקרובה) או lat/lon, עם `i=on`; cache של 7 ימים. Assur Melacha API לקביעת "עכשיו שבת".
- זמן הדלקת נרות במיקום נוכחי (19.11.2026, רועי: "חשוב שיהיה נכון ומדויק"). עיר שנבחרה נשלחת ל-Hebcal עם `geonameid`, ו-Hebcal מחיל את מנהג המקום: 40 דקות לפני השקיעה בירושלים, 30 בחיפה ובזכרון יעקב, 20 בשאר ישראל, 18 בחו"ל. "המיקום הנוכחי שלי" נשלח כקואורדינטות, ולקואורדינטות Hebcal לא מחיל מנהג עיר. לכן האפליקציה קובעת את הדקות בעצמה ושולחת אותן ב-`b=`: פונקציה טהורה (`candleLightingMinutes`) שבודקת אם הנקודה בתוך הגבול המוניציפלי של ירושלים, חיפה או זכרון יעקב (פוליגונים מפושטים מ-OpenStreetMap, שמורים בקוד), אחרת 20 בישראל ו-18 מחוצה לה. הכלל זהה לכלל של Hebcal, כך שמיקום נוכחי בעיר נותן אותה שעה כמו בחירת העיר ברשימה. יישובים המוקפים כולם בתוך ירושלים (בית זית, מוצא עילית, רמת רחל) מקבלים 40, כי להדליק מוקדם מותר תמיד ולהדליק מאוחר ממנהג העיר שאתה עומד בתוכה הוא הטעות שיש להימנע ממנה. הקוד בפועל משתמש ב-`geonameid=294981` (גבעת שמואל) כברירת מחדל, לא ב-293397 שבשורה למעלה.
- push: expo-notifications, token נשמר ב-`profile`.
- Google Calendar (גרסה 2): readonly, מילות מפתח → context.

## 9. דרישות לא פונקציונליות

- כל מחרוזת UI בקובצי i18n (he, en). אף מחרוזת hard-coded.
- קריאות AI רק מ-Edge Functions; מפתחות לא מגיעים ללקוח.
- עלות AI צפויה: הזנה ראשונית 10-15 דולר, שוטף פחות מ-15 דולר בחודש. לוג עלות לכל קריאה בטבלת `ai_calls`.
- מסך "היום" נטען מ-cache מקומי תוך פחות משנייה גם בלי רשת.
- cron יומי שומר את פרויקט Supabase פעיל (Free מושהה אחרי 7 ימים).

## 10. שאלות פתוחות

- כמה טי-שרטים לבנים נדרשים לסופ"ש מילואים (קובע את ההתראה על חוסר).
- ~~האם "צבע מכובד" לשבת כולל תכלת ופסים דקים, או לבן וכחול כהה בלבד.~~ נענה (רועי, 19.11.2026): אין כלל קשיח. עדיפות ללבן דרך משקלי הניקוד; כל הצבעים עובדים, בעיקר הבהירים, וגם פסים, כל עוד זה "יפה ומכובד לשבת".

// Regenerate .impeccable/design.json from the palettes that actually ship.
//
// The file had drifted badly by 2026-09: it still described five themes and a
// `carbon-bg` that no longer exist, listed three of the six series colours, and
// carried none of the light-mode variants. DESIGN.md's own frontmatter had
// drifted too — nine tokens disagreed with the code, including the light
// background itself (#F1F5F9 in the doc, #DCE9F7 in Dashboard.jsx).
//
// That is what hand-maintaining a generated artefact gets you, so this reads the
// source of truth directly:
//   src/Dashboard.jsx            STATUS_DARK/LIGHT, SERIES_DARK/LIGHT, THEMES
//   src/lib/productCategories.js CATEGORY_COLORS_DARK/LIGHT
//
// Run after any palette change:  node scripts/build-impeccable-design.mjs
// It rewrites .impeccable/design.json and prints a contrast report. No deps.

import { readFileSync, writeFileSync } from "node:fs";

const DASH = readFileSync("src/Dashboard.jsx", "utf8");
const CATS = readFileSync("src/lib/productCategories.js", "utf8");

// ---------------------------------------------------------------- extraction
function block(src, declaration) {
  const i = src.indexOf(declaration);
  if (i < 0) throw new Error(`could not find ${declaration}`);
  const j = src.indexOf("};", i);
  return src.slice(i, j);
}
function pairs(src, declaration) {
  const out = {};
  for (const m of block(src, declaration).matchAll(/"?([\w ]+)"?\s*:\s*"(#[0-9A-Fa-f]{6})"/g)) {
    out[m[1].trim()] = m[2].toUpperCase();
  }
  return out;
}
const statusDark = pairs(DASH, "const STATUS_DARK");
const statusLight = pairs(DASH, "const STATUS_LIGHT");
const seriesDark = pairs(DASH, "const SERIES_DARK");
const seriesLight = pairs(DASH, "const SERIES_LIGHT");
const catDark = pairs(CATS, "export const CATEGORY_COLORS_DARK");
const catLight = pairs(CATS, "export const CATEGORY_COLORS_LIGHT");

function themeField(themeKey, field) {
  const i = DASH.indexOf(`  ${themeKey}: {`);
  const seg = DASH.slice(i, i + 1400);
  const m = seg.match(new RegExp(`${field}:\\s*"([^"]+)"`));
  if (!m) throw new Error(`${themeKey}.${field} not found`);
  return m[1];
}
const SLATE_BG = themeField("slate", "bg").toUpperCase();
const SLATE_INK = themeField("slate", "text").toUpperCase();
const LIGHT_BG = themeField("crisp", "bg").toUpperCase();
const LIGHT_INK = themeField("crisp", "text").toUpperCase();

// ------------------------------------------------------------------- colour
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

function oklch(hex) {
  const [r, g, b] = rgb(hex).map(toLin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  return { L, C: Math.hypot(A, B), H: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}
const show = ({ L, C, H }) => `oklch(${Math.round(L * 100)}% ${C.toFixed(2)} ${Math.round(H)})`;

// Eight stops sharing the colour's hue. Chroma follows a bell so the extremes
// read as near-neutral tints rather than over-saturated mud.
const STOPS = [0.16, 0.27, 0.39, 0.51, 0.63, 0.75, 0.87, 0.95];
function ramp(hex) {
  const { C, H } = oklch(hex);
  return STOPS.map((L) => {
    const falloff = 1 - Math.abs(L - 0.6) / 0.75;
    return `oklch(${Math.round(L * 100)}% ${(C * Math.max(falloff, 0.2)).toFixed(2)} ${Math.round(H)})`;
  });
}

const lum = (hex) => {
  const [r, g, b] = rgb(hex).map(toLin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
function contrast(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// -------------------------------------------------------------- colorMeta
const colorMeta = {};
const add = (key, hex, role, displayName, note) => {
  colorMeta[key] = { role, displayName, canonical: show(oklch(hex)), hex, note, tonalRamp: ramp(hex) };
};

add("signal-orange", statusDark.accent, "primary", "Signal Orange",
  "The only loud colour in the system. Capped at 10% of any screen and only where the user can act. Forbidden as decoration, as a heading colour, and as a chart fill for a salesperson's series.");
add("signal-orange-light", statusLight.accent, "primary", "Signal Orange (light mode)",
  "The daylight variant. White text on this fill clears contrast, which the dark value does not.");

const STATUS_NOTES = {
  ok: ["status-ahead", "Ahead Mint", "At or above target; positive year-on-year movement."],
  watch: ["status-watch", "Watch Amber", "90-99% of target: close enough to matter, not yet a failure."],
  bad: ["status-behind", "Behind Coral", "Under 90% of target, declines, and destructive actions."],
  info: ["status-info", "Info Blue", "Neutral emphasis and non-destructive controls (View, Refresh)."],
};
for (const [k, [key, name, note]] of Object.entries(STATUS_NOTES)) {
  add(key, statusDark[k], "secondary", name, note);
  add(`${key}-light`, statusLight[k], "secondary", `${name} (light mode)`,
    `${note} Darkened to clear 4.5:1 on the daylight background.`);
}

for (const [rep, hex] of Object.entries(seriesDark)) {
  const slug = rep.toLowerCase().replace(/\s+/g, "-");
  add(`series-${slug}-dark`, hex, "tertiary", `${rep} (dark)`,
    "Series identity only — it says who, never how it is going. No series value equals a status value.");
  add(`series-${slug}-light`, seriesLight[rep], "tertiary", `${rep} (light)`,
    "The light-mode counterpart. The sets are split per mode because no single set clears 3:1 on both backgrounds.");
}

for (const [cat, hex] of Object.entries(catDark)) {
  const slug = cat.toLowerCase().replace(/\s+product$/, "").replace(/\s+/g, "-");
  add(`category-${slug}-dark`, hex, "tertiary", `${cat} (dark)`,
    "Product-origin identity, used only on the Product Sales tab. A third vocabulary, disjoint from both status and series.");
  add(`category-${slug}-light`, catLight[cat], "tertiary", `${cat} (light)`,
    "The light-mode counterpart.");
}

add("slate-bg", SLATE_BG, "neutral", "Slate Ground",
  "The dark mode's background. Surface hierarchy is built from tint alpha, not new hex values: 2% card, 3% KPI, 4-5% hover, 6% border.");
add("slate-ink", SLATE_INK, "neutral", "Slate Ink",
  "The dark mode's foreground. Its RGB triplet (226,232,240) is the --tint every border and muted text derives from.");
add("crisp-bg", LIGHT_BG, "neutral", "Light Ground",
  "The daylight mode's background, keyed 'crisp' in storage but shown as 'Light'. A soft blue rather than near-white: #F1F5F9 read as glary in sun, so it was darkened and every status and series value re-verified against it.");
add("crisp-ink", LIGHT_INK, "neutral", "Light Ink",
  "The daylight mode's foreground. Its triplet (15,26,50) is the --tint on light.");

// --------------------------------------------------------------- narrative
const narrative = {
  northStar: "The Early Warning System",
  overview:
    "This is a monitoring panel, not a report. Its job is to stay quiet while the numbers behave and become impossible to ignore the moment one doesn't. Every visual decision follows from that: the surface is dim and even, figures are set in monospace so columns align and a drop is visible without reading, and exactly one loud colour exists on the whole system. When a screen looks calm, that is information.\n\nThe reader is a salesperson holding a phone between customer visits, possibly in direct Malaysian sun. They already know their business. The system therefore never explains, never congratulates, and never decorates — it reports. Density is welcome where it earns its place; ornament never is.\n\nThe system explicitly rejects two things named in PRODUCT.md. It is not a spreadsheet dump: every screen ranks and de-emphasises, because deciding what matters most is the entire value added over the source workbook. And it is not heavy corporate BI (Power BI, Tableau): no filter rails flanking the content, no chrome competing with the numbers, nothing that needs a training session before a rep can read their own figures.",
  keyCharacteristics: [
    "Flat, even surfaces built from hairline borders and 2-3% tint fills",
    "Monospaced figures throughout; the numbers are the interface",
    "One accent colour, used only where action is required",
    "Two modes — Slate (dark) and Light (soft blue, daylight) — both first-class, flipped by one toggle that follows the phone until the reader chooses",
    "Three strictly separated colour vocabularies: status says how it is going, series says which rep, category says which product origin",
    "Phone-first: judged at 375px before any desktop view",
  ],
  rules: [
    { name: "The Signal Rule", section: "colors",
      body: "Signal Orange appears on no more than 10% of any screen, and only where the user can act or has acted. It is forbidden as decoration, as a heading colour, and as a chart fill for a salesperson's series." },
    { name: "The Two-Palette Rule", section: "colors",
      body: "Status colours report how a number is performing; series colours identify a rep; category colours identify a product origin. The three vocabularies are disjoint — no value in one equals a value in another, in either mode — and none may be legible as another. Any chart showing identity and performance together should still separate them by position, label, or shape as well as colour." },
    { name: "The Daylight Rule", section: "colors",
      body: "The light mode is not a courtesy. Sunlight readability is a stated product requirement, so no colour decision ships until it has been checked on the daylight background as well as Slate. Every status, series and category value has a verified light variant; a value that only resolves on a dark background is unfinished. This extends to translucent washes: use color-mix over a token, never a literal rgba() of a dark-mode hex." },
    { name: "The Monospace Figures Rule", section: "typography",
      body: "Every number a user might compare — currency, percentage, row count, date, size — is set in Space Mono. Digits then share a width, columns align without effort, and a shorter bar reads as a smaller number at a glance. Proportional digits in a data column are prohibited." },
    { name: "The One Family Rule", section: "typography",
      body: "Inter carries headings, labels, buttons and body. Do not introduce a second sans; the contrast in this system comes from weight, size, and the mono/proportional split, not from a font pairing." },
    { name: "The Floating Rule", section: "elevation",
      body: "A shadow means 'this element is above the page and will go away.' Cards, KPI panels, tables and chart containers are page furniture; they are flat, forever. If a resting surface has a shadow, it is wrong — and if a dismissable one lacks its shadow, that is wrong too." },
  ],
  dos: [
    "Do set every comparable figure in Space Mono (700 for values) so columns align and outliers are visible without reading.",
    "Do keep Signal Orange under 10% of any screen, and only where the user can act.",
    "Do pair every colour-coded state with a non-colour cue — a ▲/▼ glyph, a label, a position — so meaning survives greyscale, sunlight, and colour-vision deficiency. WCAG 2.1 AA (SC 1.4.1) is the stated bar.",
    "Do verify every change on the light background as well as Slate. Sunlight readability is a product requirement, not a preference.",
    "Do build surface hierarchy from the tint ramp (2% card, 3% KPI, 4-5% hover, 6% border) rather than from new hex values.",
    "Do let tables scroll inside their own container on a phone. The page itself must never scroll sideways.",
    "Do keep transitions at 150-250ms. Users are mid-task and should not wait for choreography.",
  ],
  donts: [
    "Don't produce a spreadsheet dump — walls of figures at uniform weight where the reader does the analysis. Rank, group, and de-emphasise on every screen.",
    "Don't drift toward heavy corporate BI (Power BI, Tableau): filter rails flanking the content, chrome competing with the numbers, or anything requiring training before a rep can read their own figures.",
    "Don't put a shadow on a resting surface. Shadows mean 'floating and dismissable' — tooltip, modal, login card. Nothing else.",
    "Don't distinguish salespeople by colour alone in a chart. Colour needs a second channel — position, a direct label, or the year-line dash pattern.",
    "Don't hardcode a bright status/series/category hex as foreground text or a chart fill. Route it through STATUS.* / tk.categories (charts) or var(--st-*) (CSS) so it picks up the light variant. Translucent washes follow the same rule: color-mix(in srgb, var(--st-accent) 15%, transparent), never a literal rgba(232,99,59,0.15), which stays orange on light no matter what the theme says.",
    "Don't reintroduce a font the interface doesn't use, or inject font <link> tags from inside React. Fonts load once from index.html (Inter / DM Sans / Space Mono only).",
    "Don't nest a card inside a card, or reach for a card when a plain section with a heading would do.",
    "Don't introduce a second sans-serif family. Contrast comes from weight, size, and the mono/proportional split.",
    "Don't add gradients, glass blurs, coloured left-edge stripes, or gradient text anywhere. This is an instrument face.",
    "Don't celebrate. No badges, streaks, trophies or congratulation on a shortfall.",
    "Don't hand-edit this file. It is generated by scripts/build-impeccable-design.mjs from the palettes in src/; edit those and re-run.",
  ],
};

// ------------------------------------------------------------------ assemble
const prev = JSON.parse(readFileSync(".impeccable/design.json", "utf8"));
const out = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  generatedBy: "scripts/build-impeccable-design.mjs",
  title: "Design System: SEED Malaysia Sales Dashboard",
  extensions: {
    colorMeta,
    typographyMeta: prev.extensions.typographyMeta,
    shadows: prev.extensions.shadows,
    motion: prev.extensions.motion,
    breakpoints: prev.extensions.breakpoints,
  },
  components: prev.components,
  narrative,
};
writeFileSync(".impeccable/design.json", JSON.stringify(out, null, 2) + "\n");

// ------------------------------------------------------------------- report
let worst = Infinity, fails = 0;
const check = (label, hex, bg, floor) => {
  const c = contrast(hex, bg);
  if (c < floor) { fails++; console.log(`  FAIL ${label} ${hex} on ${bg} = ${c.toFixed(2)}:1 (needs ${floor})`); }
  worst = Math.min(worst, c);
};
for (const [k, v] of Object.entries(statusDark)) check(`status.${k}`, v, SLATE_BG, 3);
for (const [k, v] of Object.entries(statusLight)) check(`status.${k} light`, v, LIGHT_BG, 3);
for (const [k, v] of Object.entries(seriesDark)) check(`series.${k}`, v, SLATE_BG, 3);
for (const [k, v] of Object.entries(seriesLight)) check(`series.${k} light`, v, LIGHT_BG, 3);
for (const [k, v] of Object.entries(catDark)) check(`category.${k}`, v, SLATE_BG, 3);
for (const [k, v] of Object.entries(catLight)) check(`category.${k} light`, v, LIGHT_BG, 3);

const all = [
  ...Object.entries(statusDark).map(([k, v]) => [`status/${k}`, v]),
  ...Object.entries(seriesDark).map(([k, v]) => [`series/${k}`, v]),
  ...Object.entries(catDark).map(([k, v]) => [`category/${k}`, v]),
];
const collisions = [];
for (let i = 0; i < all.length; i++)
  for (let j = i + 1; j < all.length; j++)
    if (all[i][1] === all[j][1] && all[i][0].split("/")[0] !== all[j][0].split("/")[0])
      collisions.push(`${all[i][0]} == ${all[j][0]} (${all[i][1]})`);

console.log(`.impeccable/design.json written — ${Object.keys(colorMeta).length} colour tokens`);
console.log(`contrast: ${fails} failures, worst ${worst.toFixed(2)}:1 (floor 3:1 for graphics)`);
console.log(`cross-vocabulary collisions: ${collisions.length ? collisions.join("; ") : "none"}`);

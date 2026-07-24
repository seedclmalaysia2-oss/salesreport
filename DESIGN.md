---
name: SEED Malaysia Sales Dashboard
description: An early-warning panel for a distributor sales team — calm when the numbers are fine, unmistakable when they aren't.
colors:
  signal-orange: "#E8633B"
  status-ahead: "#34D399"
  status-watch: "#F59E0B"
  status-behind: "#F87171"
  status-info: "#3B82F6"
  series-alan: "#E8633B"
  series-dino: "#3B82F6"
  series-khen: "#10B981"
  series-sakinah: "#A855F7"
  series-simon: "#F59E0B"
  series-seed: "#EC4899"
  slate-bg: "#0F172A"
  slate-ink: "#F1F5F9"
  midnight-bg: "#0B1426"
  midnight-ink: "#E0F2FE"
  paper-bg: "#FAF7F2"
  paper-ink: "#1C1917"
  crisp-bg: "#F1F5F9"
  crisp-ink: "#0F172A"
  carbon-bg: "#000000"
  carbon-ink: "#FFFFFF"
typography:
  display:
    fontFamily: "Inter, DM Sans, system-ui, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.5px"
  headline:
    fontFamily: "Inter, DM Sans, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.3px"
  title:
    fontFamily: "Inter, DM Sans, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: "Inter, DM Sans, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 450
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "1.5px"
  metric:
    fontFamily: "Space Mono, monospace"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "normal"
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "12px"
  card: "14px"
  pill: "20px"
  full: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  xxl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.signal-orange}"
    textColor: "#FFFFFF"
    rounded: "{rounded.md}"
    padding: "10px 22px"
    typography: "{typography.body}"
  button-primary-disabled:
    backgroundColor: "rgba(232,99,59,0.5)"
    textColor: "#FFFFFF"
    rounded: "{rounded.md}"
    padding: "10px 22px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.status-info}"
    rounded: "{rounded.sm}"
    padding: "5px 10px"
  tab:
    backgroundColor: "transparent"
    textColor: "rgba(var(--tint),0.5)"
    rounded: "{rounded.md}"
    padding: "8px 18px"
  tab-active:
    backgroundColor: "rgba(232,99,59,0.15)"
    textColor: "{colors.signal-orange}"
    rounded: "{rounded.md}"
    padding: "8px 18px"
  pill:
    backgroundColor: "rgba(var(--tint),0.05)"
    textColor: "rgba(var(--tint),0.5)"
    rounded: "{rounded.pill}"
    padding: "6px 16px"
  pill-active:
    backgroundColor: "{colors.signal-orange}"
    textColor: "#FFFFFF"
    rounded: "{rounded.pill}"
    padding: "6px 16px"
  card:
    backgroundColor: "rgba(var(--tint),0.02)"
    textColor: "var(--text)"
    rounded: "{rounded.card}"
    padding: "20px"
  kpi:
    backgroundColor: "rgba(var(--tint),0.03)"
    textColor: "var(--text)"
    rounded: "{rounded.xl}"
    padding: "20px 24px"
  input:
    backgroundColor: "rgba(var(--tint),0.04)"
    textColor: "var(--text)"
    rounded: "{rounded.md}"
    padding: "10px 14px"
---

# Design System: SEED Malaysia Sales Dashboard

## 1. Overview

**Creative North Star: "The Early Warning System"**

This is a monitoring panel, not a report. Its job is to stay quiet while the numbers behave and become impossible to ignore the moment one doesn't. Every visual decision follows from that: the surface is dim and even, figures are set in monospace so columns align and a drop is visible without reading, and exactly one loud colour exists on the whole system. When a screen looks calm, that is information. When something is orange or coral, it is because a human needs to act.

The reader is a salesperson holding a phone between customer visits, possibly in direct Malaysian sun. They already know their business. The system therefore never explains, never congratulates, and never decorates — it reports. Density is welcome where it earns its place; ornament never is.

The system explicitly rejects two things named in PRODUCT.md. It is not a **spreadsheet dump**: every screen ranks and de-emphasises, because deciding what matters most is the entire value added over the source workbook. And it is not **heavy corporate BI** (Power BI, Tableau): no filter rails flanking the content, no chrome competing with the numbers, nothing that needs a training session before a rep can read their own figures.

**Key Characteristics:**
- Flat, even surfaces built from hairline borders and 2–3% tint fills
- Monospaced figures throughout; the numbers are the interface
- One accent colour, used only where action is required
- Five complete themes, dark and light, all first-class
- Phone-first: judged at 375px before any desktop view

## 2. Colors

A near-monochrome surface carrying two small, strictly separated colour vocabularies: one that says *who*, one that says *how it is going*.

### Primary
- **Signal Orange** (#E8633B): The only loud colour in the system. Reserved for the active tab, the primary action button, the admin badge, and the selected filter pill. It means "this is live, or act here." Its scarcity is what makes it work — the moment it appears twice on a screen for unrelated reasons, it stops meaning anything.

### Secondary
The status vocabulary. These four say how a number is performing and nothing else.
- **Ahead Mint** (#34D399): at or above target; positive year-on-year movement.
- **Watch Amber** (#F59E0B): 90–99% of target — close enough to matter, not yet a failure.
- **Behind Coral** (#F87171): under 90% of target; declines; destructive actions.
- **Info Blue** (#3B82F6): neutral emphasis and non-destructive controls (View, Refresh).

### Tertiary
The series vocabulary. These six identify a salesperson in a chart and carry no judgement.
- **Alan** (#E8633B) · **Dino** (#3B82F6) · **Khen** (#10B981) · **Sakinah** (#A855F7) · **Simon** (#F59E0B) · **Seed Malaysia** (#EC4899)

### Neutral
Five complete themes ship, each defining a background, an ink, and a tint triplet that every border, fill and muted text derives from via `rgba(var(--tint), α)`.
- **Slate** (#0F172A bg / #F1F5F9 ink): the default. Soft dark, low emission for sustained reading.
- **Midnight** (#0B1426 bg / #E0F2FE ink): deeper, cooler, more contrast between surface and ink.
- **Paper** (#FAF7F2 bg / #1C1917 ink): warm light.
- **Crisp** (#F1F5F9 bg / #0F172A ink): cool light. The strongest daylight option.
- **Carbon** (#000000 bg / #FFFFFF ink): maximum contrast, for the worst lighting or the sharpest eyes.

Surface hierarchy inside a theme is built from the tint alone: page background at 0%, cards at 2%, KPI panels at 3%, hover states at 4–5%, borders at 6%.

### Named Rules

**The Signal Rule.** Signal Orange appears on no more than 10% of any screen, and only where the user can act or has acted. It is forbidden as decoration, as a heading colour, and as a chart fill for anything other than Alan's series.

**The Two-Palette Rule.** Series colours identify *who*; status colours report *how it is going*. They must never be legible as each other. Three collisions exist today by inheritance — Alan shares Signal Orange, Simon shares Watch Amber, Dino shares Info Blue — so any chart that shows both a rep identity and a performance state must separate them by position, label, or shape, never by hue alone.

**The Daylight Rule.** The light themes are not a courtesy. Sunlight readability is a stated product requirement, so no colour decision ships until it has been checked in Crisp as well as Slate. A value that only resolves on a dark background is unfinished.

## 3. Typography

**Display Font:** Inter (fallback: DM Sans, system-ui, sans-serif)
**Body Font:** Inter — the same family, differentiated by weight and size
**Label Font:** DM Sans (uppercase micro-labels)
**Numeric Font:** Space Mono (monospace)

**Character:** One humanist sans carries the entire interface, paired on a genuine contrast axis with a monospace for every figure. That split is the system's signature: prose is set in Inter and recedes; numbers are set in Space Mono and hold their column. Nothing is decorative — there is no display face, because a dashboard that shouts in a headline has misunderstood its job.

### Hierarchy
- **Display** (700, 26px, 1.15, -0.5px): the dashboard title. One per page.
- **Headline** (700, 22px, 1.25): the login heading and full-screen states.
- **Title** (600, 14px, 1.4): card and section headings. The workhorse.
- **Body** (450, 13px, 1.6): supporting prose and descriptions. Cap explanatory prose at 65–75ch.
- **Label** (500, 11px, 1.5px tracking, uppercase, DM Sans): KPI labels and table headers (10px at 1px tracking in dense tables).
- **Metric** (700, 28px, 1.1, Space Mono): KPI values, and by extension every currency figure, percentage and row count in the system.

### Named Rules

**The Monospace Figures Rule.** Every number a user might compare — currency, percentage, row count, date, size — is set in Space Mono. Digits then share a width, columns align without effort, and a shorter bar reads as a smaller number at a glance. Proportional digits in a data column are prohibited.

**The One Family Rule.** Inter carries headings, labels, buttons and body. Do not introduce a second sans; the contrast in this system comes from weight, size, and the mono/proportional split, not from a font pairing.

## 4. Elevation

The system is flat at rest and depth is not decorative. Separation between surfaces comes entirely from tonal layering — a 2–3% tint fill and a 1px hairline border at 6% — never from a shadow. This keeps large, chart-heavy screens cheap to paint on a phone and keeps the page reading as one continuous instrument face rather than a scatter of floating cards.

Shadows exist for exactly one purpose: to say that an element is genuinely above the page and temporarily owns the user's attention.

### Shadow Vocabulary
- **Overlay** (`box-shadow: 0 8px 32px rgba(0,0,0,0.5)`): chart tooltips and transient popovers.
- **Dialog** (`box-shadow: 0 12px 40px rgba(0,0,0,0.5)`): the file preview modal and any dismissable panel.
- **Gateway** (`box-shadow: 0 20px 60px rgba(0,0,0,0.5)`): the login card only — the one moment the interface is a single object on an empty field.

### Named Rules

**The Floating Rule.** A shadow means "this element is above the page and will go away." Cards, KPI panels, tables and chart containers are page furniture; they are flat, forever. If a resting surface has a shadow, it is wrong.

## 5. Components

Controls are **quiet until needed**. At rest they are borders and muted text; colour arrives on hover, focus, or activation. Attention belongs to the numbers, not to the chrome around them.

### Buttons
- **Shape:** gently rounded (8px), with compact actions tighter (6px)
- **Primary:** Signal Orange fill, white text, 10px 22px padding, 13px/600. One per view — the single most likely next action.
- **Hover / Focus:** 200ms transition. Disabled state drops the fill to 50% opacity (`rgba(232,99,59,0.5)`) and switches the cursor to `not-allowed`.
- **Ghost (row actions):** transparent fill, 1px border at 55% of the action's own colour, text in that colour, 5px 10px padding, 11px/600. Colour is semantic: Info Blue for View, Ahead Mint for Save, Signal Orange for Update, Behind Coral for Remove.

### Chips
- **Pills (year and scope filters):** fully rounded (20px), 6px 16px, 12px/600 Space Mono. Inactive is a 5% tint fill with muted text; active is a solid Signal Orange fill with white text.
- **Status badges:** 3px 10px, 11px/600, rounded 6px, set as a 15% tint of their own colour with the text in that colour at full strength — never grey text on a coloured field.

### Cards / Containers
- **Corner Style:** 14px (KPI panels 12px)
- **Background:** 2% tint fill (KPI panels 3%)
- **Shadow Strategy:** none. See Elevation.
- **Border:** 1px at 6% tint
- **Internal Padding:** 20px, or 20px 24px for KPI panels
- Nested cards are prohibited. A card inside a card means the hierarchy was never decided.

### Inputs / Fields
- **Style:** 4% tint fill, 1px border at 8–10%, 8px radius, 10px 14px padding, 13–14px text
- **Focus:** `outline: none` paired with a visible border shift — never remove the ring without replacing it
- **Placeholder:** must clear 4.5:1 against the field fill; the default muted grey is not sufficient
- **Error:** message in Behind Coral on a 10% coral fill with a 25% coral border, 12px, above the control

### Navigation
- **Style:** a horizontal tab row of text buttons, 8px radius, 8px 18px padding, 13px. Inactive is muted tint text on transparent with a transparent 1px border, so the row does not shift on activation. Active is a 15% Signal Orange fill, Signal Orange text, 30% Signal Orange border, weight 600.
- **Mobile:** the row becomes a single horizontally scrolling strip (`flex-wrap: nowrap`, `overflow-x: auto`, scrollbar hidden). It must never wrap into stacked rows on a phone.

### The KPI Panel (signature component)
The system's most repeated object and the one that carries the north star. An uppercase DM Sans label at 11px/1.5px tracking, a Space Mono value at 28px/700 coloured by *status* rather than by brand, an optional muted sub-line, and an optional trend line that resolves to Ahead Mint or Behind Coral with a ▲/▼ glyph. The glyph matters: it is what makes direction survive a greyscale print, a colour-blind reader, or bright sunlight.

## 6. Do's and Don'ts

### Do:
- **Do** set every comparable figure in Space Mono (700 for values, per the Monospace Figures Rule) so columns align and outliers are visible without reading.
- **Do** keep Signal Orange (#E8633B) under 10% of any screen, and only where the user can act.
- **Do** pair every colour-coded state with a non-colour cue — a ▲/▼ glyph, a label, a position — so meaning survives greyscale, sunlight, and colour-vision deficiency. WCAG 2.1 AA (SC 1.4.1) is the stated bar.
- **Do** verify every change in Crisp as well as Slate. Sunlight readability is a product requirement, not a preference.
- **Do** build surface hierarchy from the tint ramp (2% card, 3% KPI, 4–5% hover, 6% border) rather than from new hex values.
- **Do** let tables scroll inside their own container on a phone. The page itself must never scroll sideways.
- **Do** keep transitions at 150–250ms. Users are mid-task and should not wait for choreography.

### Don't:
- **Don't** produce a **spreadsheet dump** — walls of figures at uniform weight where the reader does the analysis. Rank, group, and de-emphasise on every screen.
- **Don't** drift toward **heavy corporate BI** (Power BI, Tableau): filter rails flanking the content, chrome competing with the numbers, or anything requiring training before a rep can read their own figures.
- **Don't** put a shadow on a resting surface. Shadows mean "floating and dismissable" — tooltip, modal, login card. Nothing else.
- **Don't** distinguish salespeople by colour alone in a chart, and never let a series colour be read as a status colour. Alan collides with Signal Orange, Simon with Watch Amber, Dino with Info Blue.
- **Don't** rely on the KPI component's `#fff` colour fallback. It is invisible on Paper and Crisp; always pass an explicit status colour.
- **Don't** load a font the interface does not use. Space Grotesk is currently requested on every page load and referenced nowhere in `src/` — remove it, and de-duplicate the repeated DM Sans / Space Mono requests across the `<link>` tags.
- **Don't** nest a card inside a card, or reach for a card when a plain section with a heading would do.
- **Don't** introduce a second sans-serif family. Contrast comes from weight, size, and the mono/proportional split.
- **Don't** add gradients, glass blurs, coloured left-edge stripes, or gradient text anywhere. This is an instrument face.
- **Don't** celebrate. No badges, streaks, trophies or congratulation on a shortfall — PRODUCT.md sets the tone as factual, not encouraging.

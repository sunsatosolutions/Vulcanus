---
name: Vulcanus
description: A smith's temper chart for an agent-readable second brain; blackened steel, bone type, ember only where something is hot.
colors:
  ground: "#08080c"
  steel: "#121219"
  steel-2: "#181820"
  line: "#23232e"
  line-strong: "#34343f"
  bone: "#e8e3d9"
  iron: "#a3a7ac"
  dim: "#80868c"
  ember: "#e8572a"
  straw: "#dcbb72"
  gold: "#c99a48"
  bronze: "#b27645"
  plum: "#9a6894"
  violet: "#8070bd"
  blue: "#5f86c6"
  pale-blue: "#8ea5bd"
  grey: "#9aa3ab"
typography:
  display:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.6rem, 5.6vw, 4.9rem)"
    fontWeight: 800
    lineHeight: 0.97
    letterSpacing: "-0.035em"
    fontVariation: "'wdth' 114"
  display-close:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.3rem, 5vw, 4rem)"
    fontWeight: 800
    lineHeight: 1
    fontVariation: "'wdth' 116"
  headline:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2rem, 3.6vw, 3rem)"
    fontWeight: 750
    lineHeight: 1.04
    letterSpacing: "-0.03em"
    fontVariation: "'wdth' 110"
  subheading:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.4rem, 2.2vw, 1.8rem)"
    fontWeight: 700
    letterSpacing: "-0.02em"
    fontVariation: "'wdth' 108"
  title:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.08rem"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-0.005em"
    fontVariation: "'wdth' 106"
  lede:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.1rem, 1.6vw, 1.28rem)"
    fontWeight: 400
    lineHeight: 1.55
  body:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.6
    fontFeature: "'tnum'"
  label:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.85rem"
    fontWeight: 400
    lineHeight: 1.45
  code:
    fontFamily: "JetBrains Mono, ui-monospace, SF Mono, Menlo, Consolas, monospace"
    fontSize: "0.85rem"
    fontWeight: 400
    lineHeight: 1.7
    fontFeature: "'liga' 0, 'calt' 0"
rounded:
  hair: "2px"
  strip: "3px"
  code: "4px"
  plate: "6px"
spacing:
  gutter: "clamp(16px, 4vw, 40px)"
  block: "clamp(2.2rem, 4vw, 3rem)"
  section-top: "clamp(4.5rem, 8vw, 7rem)"
  section-bottom: "clamp(4rem, 8vw, 6.5rem)"
  row: "1.25rem"
  row-tight: "0.9rem"
  container: "1240px"
components:
  install-line:
    backgroundColor: "{colors.steel}"
    textColor: "{colors.bone}"
    typography: "{typography.code}"
    rounded: "{rounded.plate}"
    padding: "1rem 0.75rem"
    width: "37rem"
  install-copy:
    backgroundColor: "transparent"
    textColor: "{colors.iron}"
    padding: "0 1.1rem"
  install-copy-hover:
    backgroundColor: "{colors.steel-2}"
    textColor: "{colors.bone}"
  install-copy-copied:
    textColor: "{colors.straw}"
  nav-github:
    backgroundColor: "transparent"
    textColor: "{colors.bone}"
    rounded: "{rounded.plate}"
    padding: "0.42rem 0.8rem"
  nav-github-hover:
    backgroundColor: "{colors.steel}"
  plate:
    backgroundColor: "{colors.steel}"
    textColor: "{colors.iron}"
    typography: "{typography.code}"
    rounded: "{rounded.plate}"
    padding: "1.1rem 1.2rem 1.25rem"
  code-inline:
    backgroundColor: "{colors.steel-2}"
    textColor: "{colors.bone}"
    rounded: "{rounded.code}"
    padding: "0.05em 0.35em"
  skip-link:
    backgroundColor: "{colors.bone}"
    textColor: "{colors.ground}"
    rounded: "{rounded.plate}"
    padding: "0.6rem 0.9rem"
---

# Design System: Vulcanus

## Overview

**Creative North Star: "The Temper Chart"**

The page is a smith's temper chart. Steel drawn from the fire passes through a fixed sequence of oxide colours as it cools: straw, gold, bronze, plum, violet, blue, pale blue, grey. Vulcanus uses that sequence as its only colour logic. The ground is blackened steel and never changes; what changes is the colour of the rules, ticks and markers as the reader moves down, so the page cools from the heat of the first viewport to the settled grey of the last questions. Ember is reserved for real heat: the place you type, the hottest layer, the current position, the focus ring.

Density is that of a well-set technical document: generous section spacing, measured line lengths (37 to 46rem for prose), structure carried by 1px hairlines rather than boxes. Framed surfaces ("plates") exist only for real code and real CLI output; everything else is ruled rows, notes and tables. Type is a single variable family, Archivo, whose width axis carries rank: headings are set expanded and heavy, text at normal width. JetBrains Mono appears only where the content is literally code or output.

The system rejects the dark-plus-neon developer page: no glowing terminal, no glow halos on elements, no badge pills, no gradient keywords, no cards used as layout. The one exception is the forge heat: a single soft ember radial held at the top of the viewport (`body::before`, fixed, #ff6b35 at 14% opacity), kept exactly as the earlier design had it at the owner's request (2026-10-09). Nothing else glows.

**Key Characteristics:**
- Fixed blackened-steel ground with three type tones (bone, iron, dim).
- Ember as heat only; temper oxides as depth and position, always in scale order.
- Every section opens with a calibrated rule (hairline, fine ticks, coarse ticks) in its band colour.
- Archivo variable: width and weight rise together with rank.
- Flat; hairline-ruled; one soft shadow in the whole system, on the install line.
- Charts are calibrated in measured product figures, never invented units.

## Colors

A near-black steel ground, warm bone type, and a single ordered oxide scale that carries depth; ember is the only hot colour.

### Primary
- **Forge Ember** (ember): heat, and only heat. The `$` prompt of the install line, the hottest segment of the depth gauge, the sliding rail marker, the focus outline, the text caret, the central index node in the graph, the brand mark tile, the first band of the closing strip, and the 404 bar.

### Secondary (the temper scale)
Oxide colours in the order steel takes them while cooling. Each section is assigned one band through its temper class; the band colours that section's opening rule, table head rule, row and note top rules, column rules, check icons, open-FAQ icon, and its rail entry.
- **Straw** (straw): first band, the cold-start layer of the gauge, the copied state, text selection, and answer lines in CLI plates.
- **Gold** (gold): second band.
- **Bronze** (bronze): third band; the Capsule layer of the gauge.
- **Plum** (plum): fourth band.
- **Violet** (violet): fifth band.
- **Tempered Blue** (blue): sixth band; the deep layers of the gauge (hub, context, decisions, rules), the settled state.
- **Pale Blue** (pale-blue): seventh band; also "ok" lines in CLI plates.
- **Spent Grey** (grey): eighth and last band; closes the scale for the final sections.

### Neutral
- **Blackened Steel** (ground): the page ground, theme colour, and text on bone.
- **Steel** (steel): raised surfaces: plates, the install line, hover fill on the GitHub link.
- **Steel Two** (steel-2): one step higher: inline code, the gauge strip track, budget bar tracks, copy-button hover.
- **Hairline** (line): default row separators, plate borders, footer and topbar rules.
- **Strong Hairline** (line-strong): install-line border, gauge top rule, tick marks, graph edges, link underlines at rest.
- **Bone** (bone): primary text and headings.
- **Iron** (iron): secondary text: ledes, row and note bodies, table cells, inactive nav.
- **Dim** (dim): tertiary text: captions, plate labels, axis ticks, table heads, rail labels, footer.

### Named Rules
**The Real Heat Rule.** Ember marks something that is actually hot: where you type, where you are, what has focus, the entry layer. It is never a decorative accent, a heading colour, or a background wash.

**The Temper Order Rule.** Oxide colours appear only in scale order (straw, gold, bronze, plum, violet, blue, pale blue, grey), one band per section, top to bottom. A new section takes the next band; a band is never reused out of order or applied as decoration outside its section.

**The Fixed Ground Rule.** The ground stays blackened steel for the whole page. Bands colour rules, ticks, icons and markers; they never tint surfaces or text blocks. Section band rules use the band at 75% (`color-mix`), soft plate-label rules mix 38% of the band into the hairline.

## Typography

**Display Font:** Archivo, variable weight 100 to 900 and width 62 to 125%, self-hosted (with ui-sans-serif, system-ui)
**Body Font:** Archivo at normal width
**Label/Mono Font:** JetBrains Mono, self-hosted (with ui-monospace, SF Mono, Menlo, Consolas), ligatures off

**Character:** One grotesque doing all the talking, stretched and thickened as rank rises, so headings feel struck rather than styled; the mono is a tool, present only where a terminal would be.

### Hierarchy
- **Display** (800, width 114%, clamp 2.6 to 4.9rem, line-height 0.97, tracking -0.035em): the single page h1, set as two forced lines. The 404 heading uses the same setting at a smaller clamp.
- **Display Close** (800, width 116%, clamp 2.3 to 4rem, line-height 1, max 18ch): the closing statement above the second install line.
- **Headline** (750, width 110%, clamp 2 to 3rem, line-height 1.04, tracking -0.03em): section h2s.
- **Subheading** (700, width 108%, clamp 1.4 to 1.8rem): a second heading inside a long section.
- **Title** (650, width 106%, 1.08rem, line-height 1.3): h3 in rows and columns; gauge layer names and FAQ summaries sit at the same weight and width family (600 to 650, 104 to 108%).
- **Lede** (400, clamp 1.1 to 1.28rem, line-height 1.55, iron, max 37rem): hero lede; section ledes run 1.12rem, max 42rem.
- **Body** (400, 1.0625rem, line-height 1.6; 1rem below 640px): running text, tabular numerals on throughout.
- **Label** (400 to 600, 0.75 to 0.88rem, dim): captions, axis ticks, table heads, rail title, gauge source. Sentence case, no tracking, no uppercase.
- **Code** (JetBrains Mono, 0.85rem, line-height 1.7 in plates; 1rem in the install line; 0.86em inline): commands, paths, CLI output.

### Named Rules
**The Width Is Rank Rule.** Width and weight rise together: text at 100% and 400, titles at 104 to 108% and 600 to 650, headlines at 110%, display at 114 to 116% and 800. Never set body text expanded or a heading at normal width.

**The Mono Is Code Rule.** JetBrains Mono appears only for literal commands, file paths, CLI output and figures quoted from it. Labels, navigation and headings stay in Archivo.

## Layout

A single centred column, max 1240px with a fluid gutter (16 to 40px). The first viewport is a 7/5 grid: wordmark nav, h1, lede, install line and the no-account line on the left; the depth gauge on the right. Below it, the body is a two-column grid of content and a 12.5rem sticky temper rail (sticky at 2rem from the top).

Sections stack with large vertical rhythm (4.5 to 7rem top, 4 to 6.5rem bottom); content blocks sit a fluid 2.2 to 3rem below their section head. Inside sections, the recurring arrangements are a split (two equal columns, or 1.25 to 1 with code on the left), a stack, three ruled columns, and ruled rows with a 15rem (13rem tight) title column. Prose measures cap at 37 to 50rem.

Responsive behaviour: at 1100px the rail is removed and the body becomes one column. At 900px the hero stacks, the vertical gauge turns into a horizontal strip under the install line with labels below, wide-left splits and the three columns collapse, and secondary nav links hide. At 640px rows go single-column, body type drops to 1rem, and the copy button keeps only its icon (label kept for screen readers).

## Elevation & Depth

The system is flat. Depth is conveyed by tone (ground, steel, steel two) and by hairlines, and on the larger scale by temperature: the page cools as it goes down. There is exactly one shadow, on the install line, so the one command a visitor needs reads as a slightly raised tool.

### Shadow Vocabulary
- **Install lift** (`box-shadow: 0 1px 0 rgb(255 255 255 / 0.03) inset, 0 6px 14px -8px rgb(0 0 0 / 0.7)`): the install line only.

### Named Rules
**The One Lift Rule.** Only the install line and the cards inside a scene cast a shadow. Plates, rows, tables and navigation stay flat; nothing glows except the forge heat behind the page top.

## Shapes

Mostly square, with small machined radii: 6px on plates, the install line, the GitHub link and the skip link; 4px on inline code; 3px on the gauge strip and the rail's end caps; 2px on budget bars, the closing temper strip and focus outlines. Circles appear only as graph nodes and their legend keys. Borders are always 1px hairlines, except band leaders and gauge layer edges (2px) and the section rule's coarse ticks (2px). Temper strips use hard colour stops, never blends.

## Components

### Install Line
The one command, always one glance away. A steel bar (6px radius, strong hairline border, the one shadow) holding an ember `$` prompt (not selectable), the command in bone mono, and a copy button separated by a strong hairline. Copy: iron at rest, bone on steel-two on hover, straw once copied. Max 37rem. Appears in the hero and again in the close.

### Depth Gauge (signature)
A real chart of how deep an agent reads. Vertically: an axis of dim ticks calibrated in measured share of the vault read (0, 24, 26, 100%), a 0.9rem strip of hard-stop segments (ember into straw for the cold start, bronze for the capsule, blue for the deep layers), and layer labels joined to the strip by 2px band-coloured leaders, each with name, one-line role and its share in band colour. A source line under it cites the measuring command and links to the measurement. Below 900px the strip turns horizontal.

### Calibrated Section Rule (signature)
Every section opens with a full-measure rule drawn as three hard backgrounds: a 1px hairline in the band at 75%, fine 1px ticks every 2rem down 0.5rem, and coarse 2px ticks every 10rem down 0.9rem in the full band. It is the section's only band-coloured structure at the top.

### Temper Rail (signature)
The sticky "On this page" index on wide screens: each entry is a band swatch (0.5rem, 75% opacity) beside a dim label, with rounded caps at the ends so the list reads as one continuous temper strip. The current entry turns bone, its swatch goes full opacity and widens 1.8x, and an ember triangle marker slides to it (0.55s, expressive ease-out). Without JavaScript it is a plain anchor list; reduced motion removes the slide.

### Plates
Framed code and output only. Steel ground, 1px hairline border, 6px radius; a mono dim label bar on top (file name or command, optional right-aligned note) ruled by the band-soft line; content in mono iron at 0.85rem / 1.7. Inside output: prompts and questions in bone, answers in straw, ok lines in pale blue, comments dim, directory names bone 600.

### Ruled Rows and Notes
Structure without cards. Rows: a list with a band top rule and hairline separators, title column (15rem, or 13rem tight) beside an iron body, padding 1.25rem (0.9rem tight). Notes: a short iron passage (max 46rem) under a band top rule, with bone strong lead-ins. Columns: three, each under a band top rule. Checks: hairline-ruled list with band-coloured check icons.

### Tables
Full width, collapsed. Head in dim 600 at 0.85rem over a band rule; cells iron with hairline separators; first column bone. The token-budget table adds a mono figure column and a band-filled bar on a steel-two track.

### FAQ
Native details/summary under a band top rule, hairline between items, max 50rem. Summary at title weight (600, width 104%); a plus icon that is dim at rest, bone on hover, and on open rotates 45 degrees and takes the band colour. Answers in iron.

### Navigation
Topbar: the ember brand tile and wordmark (700, width 112%) on the left; iron text links that turn bone on hover; the GitHub link as the only outlined control (strong hairline, 6px radius, steel on hover). Links in text use a 1px strong-hairline underline at 0.22em offset that brightens to bone on hover. Focus everywhere is a 2px ember outline at 3px offset.

## Do's and Don'ts

### Do:
- **Do** keep the ground blackened steel (ground) on every surface and let only rules, ticks, icons and markers carry band colour.
- **Do** assign each new section the next band of the temper scale and open it with the calibrated section rule.
- **Do** reserve ember for the install prompt, the hottest layer, the current-position marker, focus and the caret.
- **Do** set headings expanded and heavy (width 106 to 116%, weight 650 to 800) and text at normal width.
- **Do** frame only real code and real CLI output in plates; use ruled rows, notes and tables for everything else.
- **Do** calibrate charts in measured product figures and cite the source under them.
- **Do** keep every interaction readable without JavaScript and remove transitions under reduced motion.

### Don't:
- **Don't** use ember as a decorative accent, heading colour or background wash.
- **Don't** add glow halos, neon text, a glowing terminal, badge pills or gradient keywords. The forge heat behind the page top is the only glow; never add a second.
- **Don't** blend temper colours into soft gradients; temper strips use hard stops.
- **Don't** use cards or boxed panels as page structure.
- **Don't** add shadows beyond the install line's lift.
- **Don't** set labels, navigation or headings in JetBrains Mono.
- **Don't** invent units or figures for a chart; an invented temperature is not product truth.


## Scenes (added 2026-10-09)

The owner asked for the page to stop reading like a blog and to draw the product the way the other Sunsato sites do: no screenshots, the product drawn in code with its own words.

- **Stage:** a section head beside its scene (`.stage`, 4.4fr / 7fr; `.stage.flip` puts the scene first). Below 900px the scene follows the head.
- **Scene:** a dotted workshop floor in the section's band (`.scene`: 18px dot grid at 22% of the band, a faint band light from the top-right corner, steel ground, 12px radius). Its parts are absolutely placed drawn cards (`.sc-card`, steel-2, 8px radius, one soft shadow; `.is-hot` takes the band border, `.is-cold` dims to 55%), grey text bars (`.sc-bar`), chips and band-coloured wires (`.sc-wire`, an SVG with `vector-effect: non-scaling-stroke`). Below 560px a scene stacks as a list and drops its wires.
- **Content:** every word in a scene is the page's own example (Atlas, Northwind, Kiln, Flora and the example run's counts) or a real path or command; a scene that shows behaviour rather than a run says "Illustration".
- **Scenes on the page:** the vault's layers with an agent stopping at the Capsule (Structure), sources flowing into ticked candidates (Import), the thirteen commands grouped by job (Commands), one `recall` returning the Capsule (MCP), one square per percent of the measured vault (Token budget), the doctor run over its graph (Checks), three tools wired to one vault (Agents), the labelled project graph (Obsidian), and what stays on your machine (Questions).
- **Flow scenes:** a scene whose parts read better in order than placed (`.scene-flow`) lays them out as a grid instead of absolute positions; the waffle (`.waffle`, 20 × 5, filled column-first) is one.

## Motion (added 2026-10-09)

CSS only, inside `prefers-reduced-motion: no-preference`; content is visible without it.

- **On load:** the depth gauge fills from the hot top down and its labels arrive in order.
- **On scroll** (`animation-timeline: view()` inside `@supports`, so browsers without it show everything at once): heads, scenes and rows rise in; wires and graph edges draw; candidate boxes and check marks tick; budget bars fill; a scene's result card arrives last.
- **Always, slowly:** the agent's dot walks down to the Capsule and pauses; the MCP wire carries a flowing dash. No other loop.

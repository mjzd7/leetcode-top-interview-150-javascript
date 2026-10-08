# Keyboard Navigation Plan: Search, Command Palette & Navigation Rail

**Status:** Ready for Implementation  
**Scope:** `docs/index.html` (sidebar search, navigation list, command palette, global shortcut hierarchy), `docs/assets/theme.css` (focus/selection styling), `tests/nav.spec.mjs` (Playwright verification suite)  
**Research & Standards Basis:** WAI-ARIA 1.2 Combobox Design Pattern (APG), WCAG 2.1 AA (SC 2.1.1 Keyboard, SC 2.4.3 Focus Order, SC 2.4.7 Focus Visible, SC 4.1.2 Name, Role, Value).

---

## 1. Architectural Baseline & Codebase Audit

An audit of the live tree reveals the exact mechanics and limitations across all typeahead and navigation surfaces:

### 1.1 Surface 1: Sidebar Quick Filter (`#searchInput` + `#curriculumNav`)
- **Markup:** `docs/index.html:1388-1389` defines `<input id="searchInput" type="search" placeholder="Filter this list…" autocomplete="off">`.
- **Nav container:** `docs/index.html:1397` defines `<nav id="curriculumNav" class="p-3 space-y-5 flex-1 overflow-y-auto" aria-label="Curriculum"></nav>`.
- **Current input handling (`docs/index.html:2646`):**
  ```javascript
  searchInput.oninput = (e) => { searchQuery = e.target.value; renderNav(); };
  ```
- **Current gaps:**
  1. **Zero arrow navigation:** ArrowUp / ArrowDown does nothing; focus stays trapped in the input text field.
  2. **No Enter-to-open:** Pressing Enter in `#searchInput` submits nothing. To open a problem, the user must reach for the mouse or press Tab repeatedly through the difficulty filter buttons (`All`, `Easy`, `Med`, `Hard` at `docs/index.html:1391-1394`) before reaching the first guide row.
  3. **No Escape clear:** Pressing Escape inside `#searchInput` relies on native browser `type="search"` quirks instead of predictably clearing the query first and then closing the mobile drawer on a second Escape.
   4. **Missing ARIA Combobox contract:** `#searchInput` lacks `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded`, `aria-controls="curriculumNav"`, and `aria-activedescendant`. The `.nav-item` buttons lack `role="option"` and `aria-selected`.
   5. **No selection paint function:** The palette has `paintPalSelection()`; the sidebar has no equivalent — there is nothing to set `aria-selected` / `aria-activedescendant` / scroll on for `.nav-item`. A `paintNavSelection()` mirroring the palette's must be specified and budgeted.
   6. **No selection highlight style:** `docs/assets/theme.css:333-378` only styles `.nav-item:hover`, `[data-active="true"]`, and `[aria-current="page"]`. There is no `.nav-item[aria-selected="true"]` rule.

### 1.2 Surface 2: Command Palette (`#paletteInput` + `#paletteList`)
- **Markup:** `docs/index.html:1511-1526` (`#palette`, `#paletteCard`, `#paletteInput`, `#paletteList`).
- **State & navigation (`docs/index.html:2676-2711`):**
  - Arrow keys modify `palIndex` between `0` and `palResults.length - 1` (`docs/index.html:2706-2711`).
  - Selection paint (`docs/index.html:2700-2702`):
    ```javascript
    function paintPalSelection() {
      paletteList.querySelectorAll('.pal-item').forEach((el, i) => el.setAttribute('aria-selected', i === palIndex ? 'true' : 'false'));
    }
    ```
- **Current gaps:**
  1. **No `scrollIntoView`:** `#paletteList` has `max-h-[50dvh] overflow-y-auto` (`docs/index.html:1520`). With up to 12 results (~50px each = ~600px), arrowing down past the 5th or 6th item moves `palIndex` off-screen, but the container never scrolls to keep the selected item in view.
  2. **Missing Home / End keys:** APG Combobox requires Home (jump to first item) and End (jump to last item).
  3. **Incomplete ARIA plumbing:** `#paletteList` has `role="listbox"`, and items have `role="option"`, but:
     - `#paletteInput` lacks `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded="true"`, `aria-controls="paletteList"`, and `aria-activedescendant`.
     - None of the `.pal-item` elements have an `id` attribute. Without an `id` (e.g. `pal-opt-${i}`), `aria-activedescendant` cannot reference the selected item, rendering it invisible to screen readers.
   4. **Mousemove vs. Keyboard collision (`docs/index.html:2696`):**
     ```javascript
     div.onmousemove = () => { palIndex = i; paintPalSelection(); };
     ```
     When arrowing down through the list, the scrolling container moves items under a resting mouse cursor, immediately firing `mousemove` and stomping the keyboard highlight.
   5. **Escape handled but leaks (`docs/index.html:2711-2712`):** `paletteInput.onkeydown` calls `closePalette()` on Escape without `e.stopPropagation()`, so the document-level Escape handler (`docs/index.html:2715`) fires too — palette is still in its 150ms hide transition (`closePalette` defers `hidden`), so the document branch sees `!palette.classList.contains('hidden')` and calls `closePalette()` a second time, and on the same press can also hit `closeSidebar()` depending on transition timing.
   6. **Focus destination on close:** `closePalette()` only blurs (`paletteInput.blur()`). Focus falls to `<body>`, breaking keyboard flow. The plan must define an explicit restore target.
   7. **Modal dialog with no focus trap:** `#palette` is `role="dialog" aria-modal="true"` (docs/index.html:1511) but `paletteInput.onkeydown` and `closePalette` implement no trap. Tab from `#paletteInput` escapes the dialog into the page behind it — a WCAG 2.1 AA modal-focus failure. The chat panel already solves this same problem with `trapFocus(e)` (docs/chat-widget.js:2463); mirror it.

### 1.3 Surface 3: Global Shortcuts & Escape Hierarchy
- **Existing shortcuts:**
  - `⌘K` / `Ctrl+K` (`docs/index.html:2714`): Opens / closes palette.
  - `Alt+V` (`docs/index.html:1927-1933`): Toggles collapsed sidebar rail between `cat` (category glyphs) and `num` (guide numbers). Skips when typing in inputs/textareas.
  - `ArrowLeft` / `ArrowRight` on `#ltRailResizer` (`docs/index.html:2631-2635`): Resizes right rail.
  - `ArrowUp` / `ArrowDown` / `Home` / `End` on `#ltcPanelResizer` (`docs/chat-widget.js:1917-1921`): Resizes chat panel.
  - Enter / Shift+Enter in `#ltcInput` (`docs/chat-widget.js:2428-2433`): Sends message / inserts newline.
- **Escape consumption stack:**
  - `docs/chat-widget.js:2442-2463`: `el.panel` keydown intercepts Escape. In `fullscreen`, drops to docked; in `floating` / `pinned-right` / `sheet`, stops streaming and closes panel. Uses `e.stopPropagation()`.
  - `docs/index.html:2715`: Document keydown closes palette if open; else closes mobile sidebar drawer (`closeSidebar()`).
- **Current gap in Escape precedence:** If `#searchInput` has typed text (e.g., "binary"), pressing Escape in `#searchInput` should first clear the search text and restore the unfiltered list. Only if the input is already empty should a subsequent Escape close the mobile drawer or blur focus.

---

## 2. Architectural Decisions

### 2.1 Decision: Zero-Dependency Vanilla Helper vs. `@github/combobox-nav`
- **Context:** The original draft suggested evaluating `@github/combobox-nav`.
- **Verdict: REJECT external package; implement a self-contained ~35-line native combobox controller.**
- **Rationale:**
  1. **No client-side build step:** The project serves static files directly from `docs/` using CDN libraries (`marked`, `katex`, `prism`, `dompurify`). Adding an npm client dependency would require introducing a bundler (esbuild/rollup) into `build-site.mjs` or pulling third-party bundle CDNs, violating the zero-build client runtime design.
  2. **Custom DOM lifecycle:** The sidebar is dynamic and stage-aware:
     - `renderNav()` (`docs/index.html:1703`) completely wipes and rebuilds `#curriculumNav.innerHTML`.
     - Stage 2 (`#sidebar[data-stage="2"]`) hides `#searchInput` (`docs/index.html:238`) and toggles row visibility via `data-rail-mode` (`cat` hides `.nav-item`; `num` displays `.nav-item`).
     - A standard off-the-shelf library does not understand stage transitions, difficulty pill filters, or dynamic category group wrapping.
  3. **Simplicity:** A lightweight, pure-vanilla controller (~35 lines) cleanly manages virtual highlight, `aria-activedescendant`, smooth `scrollIntoView`, and keydown delegation for both surfaces without bundle bloat or runtime overhead.

### 2.2 Decision: Virtual Focus (`aria-activedescendant`) vs. Real DOM Focus
- **Verdict: Virtual focus (DOM focus remains in the `<input>`).**
- **Rationale:**
  1. In a typeahead/combobox pattern, the user expects to continue typing immediately to refine their query without having to Tab back to the input.
  2. Moving physical DOM focus to `.nav-item` breaks standard text editing keys (Backspace, characters) and triggers unwanted browser scroll jumps.
  3. Virtual focus conforms directly to WAI-ARIA APG Combobox with `aria-activedescendant` pointing to the selected option's ID.

### 2.3 Decision: Visibility Filtering Rule
- **Verdict: Strictly filter navigable items using `offsetParent !== null`.**
- **Rationale:**
  - When `#sidebar` is at `data-stage="2"` with `data-rail-mode="cat"`, all `.nav-item` elements are styled `display: none` (`docs/index.html:260`).
  - In addition, empty filter states or collapsed categories could hide rows.
  - Walking `document.querySelectorAll('.nav-item')` without checking visibility would cause arrow keys to highlight invisible DOM nodes. Checking `el.offsetParent !== null` ensures only visible, interactive items are indexed.

---

## 3. The Combobox Contract (WAI-ARIA APG)

Both `#searchInput` and `#paletteInput` will implement this unified contract:

```
+-----------------------------------------------------------------------------------+
|  <input id="searchInput"                                                          |
|         role="combobox"                                                           |
|         aria-autocomplete="list"                                                  |
|         aria-haspopup="listbox"                                                   |
|         aria-controls="curriculumNav"                                             |
|         aria-activedescendant="nav-item-01-array-string_01-merge-sorted-array">   |
+-----------------------------------------------------------------------------------+
         |
         | controls virtual selection
         v
+-----------------------------------------------------------------------------------+
|  <nav id="curriculumNav" role="listbox" aria-label="Curriculum">                  |
|    <div class="nav-group" role="group" aria-label="ARRAY / STRING">               |
|      <button class="nav-item"                                                     |
|              role="option"                                                        |
|              id="nav-item-01-array-string_01-merge-sorted-array"                   |
|              aria-selected="true"                                                 |
|              data-highlighted="true"> ... </button>                               |
|      <button class="nav-item"                                                     |
|              role="option"                                                        |
|              id="nav-item-01-array-string_02-remove-element"                       |
|              aria-selected="false"> ... </button>                                 |
|    </div>                                                                         |
|  </nav>                                                                           |
+-----------------------------------------------------------------------------------+
```

### Key Behavioral Rules:
1. **Focus:** Real DOM focus stays in the input while arrow keys navigate options.
2. **ArrowDown:** Moves virtual highlight to the next visible option (clamped at last item).
3. **ArrowUp:** Moves virtual highlight to previous visible option (clamped at first item).
4. **Home / End:**
   - In Command Palette: Home moves to first result; End moves to last result.
   - In Sidebar Search: a single explicit rule — a "list-engaged" flag becomes true on first ArrowUp/ArrowDown/Home/End inside `#searchInput`. While engaged, Home/End jump to first/last visible option; plain Home/End edit the caret only when not engaged. Any text input (`oninput`) clears the flag. This avoids the ambiguity of "plain Home/End moves caret unless the option list is active" without defining what makes it active.
5. **Enter:** Activates the currently highlighted option (opens article via `openArticle(id)`), closes palette if open, and closes mobile sidebar if on mobile.
6. **Escape:**
   - On `#searchInput`: If input has text, clears text and re-renders nav (`renderNav()`). If input is already empty, blurs input on desktop or closes sidebar drawer on mobile (`closeSidebar()`).
   - On `#paletteInput`: Closes palette dialog (`closePalette()`) and returns focus to the opener button (`#paletteBtn`).
7. **Scroll Synchronization:** Every highlight change calls `element.scrollIntoView({ block: 'nearest' })`. `scroll-margin: 8px` on `.nav-item` and `.pal-item` prevents clipping beneath container edges.
8. **Invalidation / Reset:** Whenever results re-render (typing, difficulty pill click, rail mode switch), the highlight index resets to `0` whenever at least one visible item exists (`-1` when zero matches), and `aria-activedescendant` is updated or cleared. Match the palette's existing behavior exactly: the first option is painted selected immediately after every render (no "wait for first arrow" state), so keyboard Enter and mouse users see the same initial selection.
9. **Pointer Safety:** A flag (`isKeyboardNavigating = true`) plus `lastMousePos = {x, y}` — ignore `mousemove` while the cursor coordinates are unchanged, since scrolling the list under a stationary cursor re-fires `mousemove`. Clear the flag on a real coordinate change.

---

## 4. Implementation Tasks & Concrete Changes

### Task 1: Styling & Tokens for Option Highlights
**Files:** `docs/index.html` (lines 168+), `docs/assets/theme.css` (lines 333-378)
- Add CSS rule for `.nav-item[aria-selected="true"]` matching the active aesthetic:
  ```css
  .nav-item[aria-selected="true"] {
    background: var(--canvas-ins) !important;
    border-color: var(--accent-rim) !important;
    color: var(--fg) !important;
    padding-left: 20px !important;
  }
  .nav-item[aria-selected="true"]::before {
    transform: scaleY(1) !important;
  }
  html[data-theme="light"] .nav-item[aria-selected="true"] {
    background: rgba(17, 24, 39, 0.08) !important;
  }
  .nav-item, .pal-item {
    scroll-margin: 8px 0;
  }
  ```

### Task 2: Command Palette ARIA & Scroll Overhaul
**File:** `docs/index.html` (lines 1516, 1520, 2676-2711)
- **Markup:**
  - On `#paletteInput` (`docs/index.html:1516`): add `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded="false"`, `aria-haspopup="listbox"`, `aria-controls="paletteList"`.
  - On `#paletteList` (`docs/index.html:1520`): add `id="paletteList"`, `role="listbox"`, `aria-label="Search results"`.
- **Item generation (`updatePalette`, `docs/index.html:2684-2698`):**
  - Assign unique deterministic ID: `div.id = 'pal-opt-' + i`.
  - Set `div.setAttribute('role', 'option')`.
  - Update `#paletteInput.setAttribute('aria-expanded', 'true')` when open, `'false'` when closed.
- **Selection painting (`paintPalSelection`, `docs/index.html:2700-2702`):**
   - Update `aria-selected` on all items.
   - Set `#paletteInput.setAttribute('aria-activedescendant', palResults.length ? 'pal-opt-' + palIndex : '')`.
   - Call `selectedEl.scrollIntoView({ block: 'nearest' })`.
 - **Focus restore:** Capture `document.activeElement` in `openPalette()` as `paletteReturnFocus`; in `closePalette()`, restore focus to `paletteReturnFocus` when it is still in the document (fallback: `#paletteBtn`). Do not unconditionally focus `#paletteBtn` — that steals focus when the palette was opened via ⌘K from mid-page.
- **Keyboard & Mouse handling (`paletteInput.onkeydown`, `docs/index.html:2706-2711`):**
  - Add `Home` (`palIndex = 0`) and `End` (`palIndex = palResults.length - 1`).
  - `Escape`: `e.preventDefault(); e.stopPropagation(); closePalette();` — stop the document-level Escape handler from double-firing during the 150ms hide transition.
  - Ignore `mousemove` when cursor hasn't moved (suppress mouse-hover override during arrow scroll).

### Task 3: Sidebar Filter Navigation Controller
**File:** `docs/index.html` (lines 1388-1397, 1757-1783, 2646)
- **Markup:**
   - On `#searchInput` (`docs/index.html:1388`): add `role="combobox"`, `aria-autocomplete="list"`, `aria-haspopup="listbox"`, `aria-controls="curriculumNav"`. Omit `aria-expanded` (listbox is always rendered; a statically-true value lies in stage 2 — see §5).
  - On `#curriculumNav` (`docs/index.html:1397`): ensure `role="listbox"`, `aria-label="Curriculum"`.
- **Nav rendering (`renderNav`, `docs/index.html:1757-1783`):**
   - On each `.nav-group`: add `role="group"`, `aria-label="${cat.category}"`.
   - On the non-option wrapper divs inside each group — the `head` label div, the `rule` div, and crucially the inner `list` div that actually wraps the buttons (docs/index.html:1755) — add `role="presentation"`. Otherwise the DOM is `listbox > group > div.list > option`, and axe's `aria-required-children` flags the option as not a required child of its group (the same reason `<ul><div><li>` fails). Palette is safe here: `.pal-item`s are direct children of `#paletteList`.
  - On each `btn.nav-item`:
    - Set `btn.id = 'nav-item-' + item.id`.
    - Set `btn.setAttribute('role', 'option')`.
    - Set `btn.setAttribute('aria-selected', 'false')`.
  - Reset sidebar highlight state on rerender:
    - Maintain `navHighlightIndex`; reset to `0` (or `-1` if 0 matches).
    - Paint selection immediately via `paintNavSelection()` (index 0), matching the palette.
    - Maintain `navListEngaged = false`; cleared here and on any `searchInput.oninput`.
 - **`paintNavSelection()` (new, mirrors `paintPalSelection`):** iterate visible `.nav-item`s, set `aria-selected`, set `#searchInput`'s `aria-activedescendant` to the highlighted item's `id` (or clear it), and `scrollIntoView({ block: 'nearest' })` the highlighted element.
- **Keyboard listener on `#searchInput`:**
  - Attach `keydown` handler directly to `#searchInput`:
    - `ArrowDown`: find all visible `.nav-item`s (`el.offsetParent !== null`), increment index, update `aria-selected` and `aria-activedescendant`, call `scrollIntoView({ block: 'nearest' })`.
    - `ArrowUp`: decrement index, update selection, scroll into view.
    - `Enter`: find highlighted visible item and invoke `openArticle(targetId)`. On mobile, ensure `closeSidebar()` executes.
     - `Escape`:
       - Always `e.preventDefault(); e.stopPropagation();` first (Chrome `type="search"` fires native clear on Escape; the document handler must not also close the drawer on the same press).
       - If `searchInput.value !== ''`: clear `searchInput.value = ''; searchQuery = ''; renderNav();`.
       - If `searchInput.value === ''`: on mobile, close drawer (`closeSidebar()`); on desktop, blur input (`searchInput.blur()`).

### Task 4: Invalidation Safeguards
**File:** `docs/index.html` (lines 1801-1827, 1927-1933, 2643-2646)
- Ensure highlight index cleanly resets on every event that mutates visible rows (all of these already route through `renderNav()`, except the last):
  - Difficulty pill click (`.filter-btn.onclick`, line 2644).
  - Search query text change (`searchInput.oninput`, line 2646) — also clears `navListEngaged`.
  - Stage collapse / rail toggle (`setNavStage`, line 1801; `Alt+V` listener, line 1927).
  - Article navigation (`openArticle`, line 2312).
  - `revealCategory` (docs/index.html:1892): does NOT call `renderNav()` — it expands the rail and `nav.scrollTo`s to a group. It changes which rows are in the scrollport, so it must reset `navHighlightIndex = 0` and clear `aria-activedescendant` (or re-paint index 0) without re-rendering.

---

## 5. Failure Modes & Edge Cases

| Failure Mode | Root Cause | Codebase Mechanism & Fix |
|--------------|------------|--------------------------|
| **Arrow highlights invisible rows** | In stage 2 rail mode `cat`, `.nav-item` has `display: none` (`docs/index.html:260`). Querying all `.nav-item` selects hidden elements. | Filter candidate rows with `el.offsetParent !== null`. If 0 visible items, do nothing. |
| **Enter opens wrong guide after filter change** | Stale highlight index retained across `renderNav()`. | Reset `navHighlightIndex = 0` (or clamp) synchronously at the start of `renderNav()`. |
| **Double Escape on mobile** | Pressing Esc in `#searchInput` bubbles to `document.onkeydown` (`docs/index.html:2715`), clearing search AND closing the drawer at once. | `#searchInput.onkeydown` stops propagation (`e.stopPropagation()`) when clearing a non-empty query. |
| **Chrome native search clear desync** | Chrome `<input type="search">` clears field on Esc without firing custom input events in some versions. | Explicitly preventDefault on Escape in `#searchInput` and invoke custom clear + `renderNav()`. |
| **Palette mousemove fights arrow keys** | Rapid arrow keys scroll list items under a motionless mouse cursor, firing `mousemove` (`docs/index.html:2696`). | Track `lastMousePos = { x, y }`; ignore `mousemove` if mouse coordinates haven't changed. |
| **Sticky header hides scrolled row** | `#sidebar` has sticky header with progress ring + filters (~191px). Unconstrained `scrollIntoView` can align row under header. | Add `scroll-margin: 8px 0` to `.nav-item` and verify `#curriculumNav` is the scrolling container (`overflow-y-auto`). |
| **Screen reader silence on selection** | `aria-activedescendant` set to an ID that doesn't exist on any DOM node. | Ensure `.pal-item` has `id="pal-opt-${i}"` and `.nav-item` has `id="nav-item-${id}"` matching `aria-activedescendant`. |
| **Empty search result Enter crash** | User types "zzzznomatch" and presses Enter; code assumes `items[0]` exists. | Guard `if (visibleItems.length === 0 || !visibleItems[index]) return;` |
| **Palette Escape fires twice** | `paletteInput.onkeydown` handles Escape but doesn't stop propagation; document handler (`docs/index.html:2715`) re-fires `closePalette()` because `hidden` is deferred 150ms. | `e.stopPropagation()` in the palette's Escape branch. |
| **Focus dumped to `<body>` on palette close** | `closePalette()` only blurs. | Capture opener in `openPalette()`; restore to it (fallback `#paletteBtn`). |
| **Sidebar & palette disagree on initial highlight** | Sidebar plan painted only "on first arrow"; palette always paints index 0. | Single rule: index 0 painted on every render, both surfaces. |
| **`revealCategory` leaves stale highlight** | It scrolls without `renderNav()`, so no reset hook fires. | Reset `navHighlightIndex`/`aria-activedescendant` inside `revealCategory`. |
| **Tab escapes the palette dialog** | `#palette` is `aria-modal="true"` but has no focus trap; Tab from `#paletteInput` walks into the occluded page. | Mirror chat-widget's `trapFocus` in the palette keydown path. |
| **axe `aria-required-children` on the sidebar** | Options sit under `listbox > group > div.list > option`; intermediate unroled divs break ownership. | `role="presentation"` on `head`, `rule`, and inner `list` wrappers (docs/index.html:1755). |
| **`aria-expanded="true"` on the sidebar input is a lie in stage 2** | `#sidebar[data-stage="2"]` hides `#searchInput` (docs/index.html:238), so a statically-true `aria-expanded` advertises a popup that does not exist while the input is hidden. | Low harm (hidden inputs aren't announced), but set `aria-expanded` from visibility on `setNavStage`, or drop the attribute for the sidebar and keep it only on the palette. Simplest: drop `aria-expanded` from `#searchInput`; keep `aria-activedescendant` + `aria-controls`. |

---

## 6. Verification Suite (`tests/nav.spec.mjs`)

Extend `tests/nav.spec.mjs` with a dedicated `test.describe('keyboard navigation & combobox contract')`:

1. **Sidebar: Arrow down and Enter opens guide**
   - Focus `#searchInput`, type `"reverse"`.
   - Press `ArrowDown` twice, check `aria-activedescendant` updates to the 2nd item.
   - Press `Enter`.
   - Assert `location.hash` and article title match the 2nd filtered problem.
2. **Sidebar: Long list arrowing scrolls into viewport**
   - Set filter to `All`. Focus `#searchInput`.
   - Arrow down 20 times.
   - Assert highlighted `.nav-item` bounding rect is within `#curriculumNav` visible client rect (`top >= navTop && bottom <= navBottom`).
3. **Sidebar: Escape two-step precedence**
   - Type `"two sum"` in `#searchInput`.
   - Press `Escape`.
   - Assert `#searchInput.value === ''`, all guides visible, sidebar drawer still open.
   - Press `Escape` again.
   - On mobile viewport: assert `#sidebar` has `-translate-x-full`.
4. **Sidebar: Invisible items skipped in stage 2**
   - Collapse to 56px rail (`data-stage="2"`), rail mode `cat`.
   - Ensure `#searchInput` is hidden (`display: none`) and does not capture arrow keys.
5. **Command Palette: ArrowDown past viewport scrolls item**
   - Press `⌘K` to open palette.
   - ArrowDown 8 times.
   - Assert highlighted `.pal-item` is fully visible within `#paletteList` scrollport.
6. **Command Palette: Home and End keys**
   - In palette with results, press `End` -> selection reaches last item.
   - Press `Home` -> selection returns to index 0.
7. **Command Palette: Mousemove does not stomp keyboard scroll**
   - Position mouse over palette list, arrow down rapidly.
   - Assert selection index follows keyboard arrows.
8. **ARIA validation (axe-core)**
    - Run axe-core WCAG 2.1 AA audit on `#searchInput` + `#curriculumNav` and `#paletteCard`. `axe-core@^4.13.0` is already a dependency — reuse the `page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' })` pattern from `tests/dry-run.spec.mjs:671-687`.
    - Assert 0 violations for `aria-activedescendant`, `aria-required-children`, `aria-valid-attr-value`.
9. **Palette Escape does not double-close**
    - Open palette, press `Escape`, assert `#palette` gains `hidden` within ~200ms and NOT a second `closePalette` side effect on `#sidebar` (drawer still in prior state).
10. **Palette close restores focus to opener**
    - Open via `⌘K` while focus is on the article body; press `Escape`; assert `document.activeElement` is the element focused before opening (or `#paletteBtn` when opened via the button).
11. **Focus trap: Tab never leaves the palette**
    - Open palette, press `Tab` repeatedly (5+), assert focus target stays inside `#paletteCard`.

---

## 7. Execution Checklist

- [ ] **Phase 1: Styles & Tokens**
  - Add `.nav-item[aria-selected="true"]` in `docs/assets/theme.css` and `docs/index.html`.
  - Add `scroll-margin: 8px 0` for `.nav-item` and `.pal-item`.
- [ ] **Phase 2: Command Palette Refinement**
  - Add `role="combobox"`, `aria-controls`, `aria-autocomplete`, `aria-expanded` to `#paletteInput`.
  - Add deterministic IDs (`id="pal-opt-${i}"`) to `.pal-item`.
  - Add `scrollIntoView({ block: 'nearest' })` in `paintPalSelection`.
  - Add `Home` / `End` key handling in `paletteInput.onkeydown`.
  - Add pointer movement guard to prevent spurious mouse hover hijacking.
- [ ] **Phase 3: Sidebar Filter Navigation Controller**
  - Add combobox ARIA attributes to `#searchInput` and `#curriculumNav`.
  - Assign IDs (`id="nav-item-${item.id}"`) and `role="option"` to `.nav-item`.
  - Implement `#searchInput.onkeydown` for `ArrowDown`, `ArrowUp`, `Enter`, `Escape`.
  - Connect `scrollIntoView({ block: 'nearest' })` on highlighted row.
  - Implement visibility filter (`offsetParent !== null`).
  - Wire highlight reset on `renderNav()`, filter pill click, and stage change.
  - Add `paintNavSelection()` mirroring the palette; call it from render and every key handler.
  - Add `navListEngaged` flag; Home/End behavior keyed off it; cleared on input/render.
  - Reset highlight + `aria-activedescendant` inside `revealCategory`.
  - `role="presentation"` on the `head`/`rule`/`list` wrapper divs inside each nav group (required-children ownership).
- [ ] **Phase 4: Playwright Test Suite**
   - Add 11 new end-to-end tests to `tests/nav.spec.mjs`.
   - Verify existing tests in `tests/nav.spec.mjs` (28 `test(` blocks as of this audit) stay green.
   - Run full test suite: `npx playwright test tests/nav.spec.mjs`.
- [ ] **Phase 2 additions (from scrutiny)**
  - `Escape` in palette: `stopPropagation` + `closePalette`.
  - Focus restore to opener element (fallback `#paletteBtn`).
  - Focus trap for the modal `#palette` (mirror chat-widget `trapFocus`); Tab cycles within the dialog.

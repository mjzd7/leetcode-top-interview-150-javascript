# Implementation Ledger & Architectural Blueprint

---

## 1. Critical Engineering Learnings & Discoveries

### 1.1 Why DOM Cursors Pixelate on Zoom & How Vector Geometry Solves It
* **The Root Cause (GPU Layer Promotion & Texture Stretching)**:
  When a custom cursor is built with small HTML `<div>` elements (`width: 6px; height: 6px` or `width: 32px; height: 32px`) with `border-radius: 50%` and transformed via `transform: translate3d(...)` or `will-change: transform`, the browser's rendering engine (Chromium Blink/Skia, WebKit CoreAnimation) promotes the element to its own dedicated GPU compositing texture layer (`cc::PictureLayer`).
  The engine rasterizes the layer bitmap **once** at its base layout resolution (a 6×6 pixel grid for the dot, a 32×32 pixel grid for the ring).
  When page zoom (e.g., 200%, 300% zoom) or scale transforms (such as magnetic hover snap `scale(2.227)`) are applied:
  - The GPU compositor performs an affine texture transformation in the fragment shader without re-rasterizing the underlying vector shapes.
  - Stretching a tiny 32×32 or 6×6 raster texture across a larger screen quad magnifies the individual bitmap texels, producing glaring pixelation, staircase jaggedness, and bilinear blur.
  - Additionally, `border-radius: 50%` on a 6px `<div>` allocates barely ~28 pixels total. Magnifying this via browser zoom exposes raw pixel squares.
* **The Architectural Solution**:
  1. We upgraded the DOM structure of `#cur-dot` and `#cur-ring` to embed SVG vector geometry with `shape-rendering="geometricPrecision"`.
  2. For the lens ring `#cur-ring`, we set `vector-effect="non-scaling-stroke"`.
  3. **Result**: On scale transforms and browser zoom, the browser's vector path renderer recalculates exact trigonometric curve anti-aliasing at the native physical display resolution, and keeps the ring border at an exact, razor-sharp 1px thickness without stretching or blurring.

---

### 1.2 Tablet & Hybrid Pointer Handling (Touch vs. Mouse/Trackpad)
* **The Problem (Primary Pointer vs. Available Pointer)**:
  Under W3C CSS Media Queries Level 4:
  - Tablets (iPads, Android tablets, touchscreen laptops) report `pointer: coarse` because the touchscreen is the primary built-in hardware interface.
  - However, when a user connects an external pointing device (such as an Apple Magic Keyboard, Bluetooth mouse, or USB trackpad), `any-pointer: fine` and `any-hover: hover` evaluate to `true`.
  - In a naive CSS query `@media (pointer: coarse) { display: none !important; }`, connecting a mouse to a tablet keeps the cursor hidden because `pointer: coarse` remains true.
  - Furthermore, if a tablet user moves the mouse and then taps the touchscreen with a finger, traditional `pointermove` handlers snap the custom cursor to the finger position and leave an "orphaned cursor circle" permanently frozen on screen until the mouse moves again.
* **The Solution**:
  1. In `docs/assets/cursor.js`, we inspect `e.pointerType` on both `pointermove` and `pointerdown`:
     - If `e.pointerType === 'touch'`, we immediately set `dot.style.opacity = '0'; ring.style.opacity = '0'` and skip waking the physics spring.
     - If `e.pointerType === 'mouse'` or `e.pointerType === 'pen'`, we set `opacity = '1'` and re-engage the 240Hz semi-implicit Euler spring.
  2. This provides seamless, zero-glitch hybrid support: moving a mouse displays the fluid magnetic lens, while tapping the screen feels completely native with no orphaned artifacts.

---

### 1.3 Strict Hash-Based Content Security Policy (CSP) Invariants
* **Mechanism**:
  The portal enforces a strict, hash-based CSP without `'unsafe-inline'` for scripts (`script-src 'self' 'sha256-...'`).
  Any modification to inline `<script>` blocks in `docs/index.html` alters their cryptographic SHA-256 digest.
* **Operational Requirement**:
  Any inline script edit must be followed by executing `node scripts/refresh-csp-hash.mjs --write` to recompute and write the exact SHA-256 digests into `vercel.json`, validated by `npx playwright test tests/chatbox.spec.js -g "the page policy is hash-based"`.

---

### 1.4 Playwright Contrast Assertions Over Transparent Backgrounds
* **The Gotcha**:
  When computing WCAG 2.1 AA contrast ratios programmatically using `getComputedStyle(element).backgroundColor`, an element without an explicit background returns `rgba(0, 0, 0, 0)` (transparent).
  A naive RGB parser reading `rgba(0, 0, 0, 0)` treats it as `[0, 0, 0]` (opaque black), giving an inaccurate contrast failure (e.g. 2.78:1 instead of 7.56:1) for gray text over a white container.
* **The Fix**:
  Contrast measurement logic must climb the DOM tree to locate the nearest ancestor with a non-transparent background (e.g. `.ltc-panel` or `document.body`) before calculating relative luminance.

---

### 1.5 Dual-Theme Token Cascading & Legacy Variable Overrides
* **The Gotcha**:
  When transitioning a codebase to dual-theming, legacy CSS variables (e.g., `--bg`, `--surface`, `--line`, `--ink`, `--muted`) must be declared under both `:root, html[data-theme="dark"]` and `html[data-theme="light"]`.
  If `--muted` is omitted from `html[data-theme="light"]`, legacy components reading `var(--muted)` fall back to the `:root` dark-mode definition (`#8B94A7`), resulting in poor contrast against light surfaces.
* **The Fix**:
  Explicitly map all legacy tokens (`--muted: var(--fg-muted);`, `--ink: var(--fg);`, etc.) under `html[data-theme="light"]`.

---

### 1.6 Universal Native Pointer Suppression & Zero Pointer Leakage
* **The Problem (Tailwind Preflight Direct Element Target)**:
  Tailwind CSS preflight injects `button, [role="button"] { cursor: pointer; }` which targets HTML elements directly. If custom cursor suppression only styles `html`, `body`, or general interactive containers, any child element inside a button (such as `<svg>`, `<span>`, `<path>`) or the button itself leaks the system pointer/arrow cursor on hover. This causes an ugly visual bug where both the native system pointer and the custom cursor ring are simultaneously visible.
* **The Solution**:
  In `docs/assets/cursor.css`, under `@media (hover: hover) and (pointer: fine)`:
  ```css
  html[data-cursor="on"],
  html[data-cursor="on"] * {
    cursor: none !important;
  }
  ```
  The universal child selector `html[data-cursor="on"] *` with `!important` guarantees that no nested icon, button tag, or anchor leaks the native pointer anywhere on the document.

---

### 1.7 Universal Custom Text Caret (I-Beam) Reformation & Total Native Pointer Elimination
* **The Problem (Inconsistent Native OS Text Caret & Visual Collision)**:
  When users hover over article paragraphs, code blocks, or editable inputs:
  1. Allowing the native OS text caret to appear creates an abrupt visual mismatch against the custom cursor experience, and on some browsers/display scaling, produces dual-cursor artifacts or jumpy caret rendering.
  2. The custom cursor ring previously disappeared or conflicted with native OS caret rendering.
* **The Solution (Zero Native Pointers & Reformed I-Beam Caret)**:
  1. We maintained universal native cursor suppression across all elements:
     ```css
     @media (hover: hover) and (pointer: fine) {
       html[data-cursor="on"],
       html[data-cursor="on"] * {
         cursor: none !important;
       }
     }
     ```
  2. In `data-cursor-mode="text"`:
     - `#cur-dot` is hidden (`opacity: 0 !important;`).
     - `#cur-ring` reforms directly into an exact, high-contrast, double-serif I-beam straight line:
       ```css
       html[data-cursor-mode="text"] #cur-ring {
         opacity: 1 !important;
         width: 2px !important;
         height: 22px !important;
         margin: -11px 0 0 -1px !important;
         border-radius: 1px !important;
         border: none !important;
         background: var(--accent) !important;
         box-shadow: 0 0 8px color-mix(in srgb, var(--accent) 55%, transparent) !important;
         transition: width 0.12s ease, height 0.12s ease, opacity 0.12s ease !important;
       }
       html[data-cursor-mode="text"] #cur-ring svg {
         display: none !important;
       }
       html[data-cursor-mode="text"] #cur-ring::before,
       html[data-cursor-mode="text"] #cur-ring::after {
         content: '';
         position: absolute;
         left: -3px;
         width: 8px;
         height: 2px;
         border-radius: 1px;
         background: var(--accent);
       }
       html[data-cursor-mode="text"] #cur-ring::before { top: 0; }
       html[data-cursor-mode="text"] #cur-ring::after { bottom: 0; }
       ```
  3. In `docs/assets/cursor.js`:
     - Text element detection covers `.prose p, .prose li, pre, pre code, h1, h2, h3, h4, blockquote, td, th, textarea, input, [contenteditable="true"]`.
     - Physics spring dynamically adjusts stiffness and damping in text mode ($k = 1400, c = 60$) to provide instantaneous, lag-free text selection and pointer tracking without overshoot or inertia.

---

### 1.8 Ergonomic Right-Edge Snapping & Compact Scale Proportionality
* **The Problem (Center Occlusion & Oversized $2.227\times$ Rings)**:
  1. Conventional magnetic cursors center over the element `(rect.left + rect.width / 2, rect.top + rect.height / 2)`, directly occluding and lowering the contrast of button text labels.
  2. Anchoring to the top-right corner with a fixed $2.227\times$ scale factor produced a ~71.3px circle ($R = 35.6\text{px}$). On small UI elements (20px–40px high, such as `#themeToggle` at 40px, or `.nav-item` at 34px), this hung 28px into empty space above headers and overlapped adjacent controls and count badges.
* **The Solution**:
  In `docs/assets/cursor.js`, we compute a dynamic compact scale factor proportioned to element height and clamped between $0.45$ and $0.75$:
  ```javascript
  const compactScale = Math.min(0.75, Math.max(0.45, (rect.height * 0.55) / 32));
  targetScale = compactScale;
  const snapRadius = 16 * targetScale;

  targetX = rect.right - Math.max(snapRadius + 3, 10);
  targetY = rect.height <= 48
    ? rect.top + rect.height / 2
    : rect.top + Math.min(rect.height / 2, 20);
  ```
  - Standard small buttons, links, and chips (height 20px–44px) map to a clean 14.4px – 24px diameter ring ($R = 7.2\text{px} - 12\text{px}$).
  - Vertically centering inside the element (`rect.top + rect.height / 2`) ensures balanced breathing room without protruding past button top/bottom bounds.
  - The magnetic tactile feedback is instant and sleek, while the element's text and adjacent buttons remain 100% visible and unoccluded.

---

### 1.9 Layout Height Invariants: Inset Box-Shadow vs. Border-Bottom (The 56px Rule)
* **The Gotcha**:
  When introducing frosted glass styling to `<header class="glass">`, adding `border-bottom: 1px solid var(--border-soft)` expanded the computed outer height of the header from 56px to 57px in Chromium layout calculations. This broke fixed header height assertions in `tests/layout.spec.mjs` and shifted the scrollable viewport boundary downward by 1px.
* **The Solution**:
  Instead of an exterior `border-bottom`, we applied an inner box shadow:
  ```css
  box-shadow: inset 0 -1px 0 var(--border-soft) !important;
  ```
  This renders an identical 1px crisp translucent hairline boundary along the bottom of the header without modifying the 56px outer box-model height.

---

### 1.10 Precision 3-Tier Cursor Snapping Architecture & Mathematical Quadrant Partitioning
* **The Usability Defect of Universal Snapping**:
  1. A one-size-fits-all cursor snap creates awkward visual defects across different UI element categories:
     - Inline text links and badges shouldn't have a magnetic circle ring jumping to their corners; they need subtle pointer tracking with prominent textual highlighting.
     - Sidebar navigation items are tall and wide vertical list rows where top-right snapping places the cursor far from the visual text label or count badge, looking displaced.
     - Interactive controls, buttons, toggles, chips, and cards need an unambiguous tactile anchor that indicates interactive readiness without covering the button text.
  2. For rectangular buttons, centering the cursor ring directly over the element covers the internal label text.
* **The Mathematical Solution ($\frac{1}{4}$ Inside, $\frac{3}{4}$ Outside Top-Right Corner Snapping)**:
  - For standard interactive elements (buttons, switches, controls, cards), the center $(x_0, y_0)$ of `#cur-ring` is pinned to the exact top-right vertex without offset:
    $$\text{targetX} = \text{rect.right}, \quad \text{targetY} = \text{rect.top}$$
  - Consider the element's interior relative to $(x_0, y_0)$:
    The element occupies points $(x, y)$ where $x \le x_0$ and $y \ge y_0$.
  - In Cartesian angle coordinates around $(x_0, y_0)$:
    - Sector $[0^\circ, 90^\circ]$ ($x \ge x_0, y \le y_0$): Exterior (top-right space)
    - Sector $[90^\circ, 180^\circ]$ ($x \le x_0, y \le y_0$): Exterior (top space)
    - Sector $[180^\circ, 270^\circ]$ ($x \le x_0, y \ge y_0$): **Interior of the element** (Quadrant III)
    - Sector $[270^\circ, 360^\circ]$ ($x \ge x_0, y \ge y_0$): Exterior (right space)
  - The circle covers $360^\circ$ of angular space. Exactly $90^\circ$ ($\frac{90^\circ}{360^\circ} = \frac{1}{4}$ or 25%) of the circle falls inside the element boundaries, while $270^\circ$ ($\frac{270^\circ}{360^\circ} = \frac{3}{4}$ or 75%) lies outside.
  - This geometry provides an unmistakable "corner badge" tactile indication that the element is targeted, while 100% of the button interior and label text remains unobstructed.
* **Sidebar Navigation Geometry (Vertical Centering on Right Border)**:
  - For vertical navigation list items (`.nav-item`), anchoring to the top-right corner would cause vertical asymmetry across stacked list rows.
  - Setting:
    $$\text{targetX} = \text{rect.right}, \quad \text{targetY} = \text{rect.top} + \frac{\text{rect.height}}{2}$$
    places the circle center point directly on the midpoint of the element's right border.
  - The vertical line $x = \text{rect.right}$ bisects the circle: exactly $\frac{180^\circ}{360^\circ} = \frac{1}{2}$ (50%) of the circle area sits inside the element, and $\frac{1}{2}$ (50%) sits outside.
  - This balances the visual weight with the sliding left accent indicator (`.nav-item::before`), creating a symmetrical, cohesive aesthetic.

---

### 1.11 Inline Links & Badges Differentiation with Highlight Underlines
* **The Problem**:
  Inline hyperlinks in paragraphs and inline tag badges (`.badge`, `.tag`, `.nav-badge`) appear inline within sentences. Snapping a magnetic ring to the top-right of an inline word breaks reading flow and looks jarring.
* **The Solution**:
  1. Detect inline links and tags via `isInlineLinkOrTag(el)` in `cursor.js`.
  2. Set `data-cursor-mode="inline-link"`:
     - `#cur-ring` is hidden with `opacity: 0 !important;`.
     - `#cur-dot` continues to track mouse movement smoothly without snapping.
  3. Universal link underline styling in `theme.css`:
     - Persistent subtle underline with `text-underline-offset: 3px`, `text-decoration-thickness: 1.5px`, and `color-mix(in srgb, var(--accent) 45%, transparent)`.
     - On hover, the underline deepens to 100% accent color with an active glow and crisp snappy transition.
  4. Buttons styled with anchor tags (e.g., `.btn`, `#brandHome`, `#paletteBtn`, `#guidesBtn`, `#themeToggle`) are excluded from text decoration and receive Tier 3 snapping.

---

### 1.12 Primer Badge Links: Decoupling Resting Badge Typography from Dynamic Hover Feedback
* **The Root Causes**:
  1. **Pre-Underlined at Rest**: In `docs/assets/theme.css`, `.primer-link` was included in the unhovered CSS selector (`.primer-link` alongside `a`), applying `text-decoration: underline !important` statically. Because primer links are monospace code pills, this created visual clutter and prevented any underline entrance transition on hover.
  2. **Zero Contrast in Light Mode**: In `theme.css`, hover state set `color: var(--accent) !important;`. In Light Mode, `--accent` is `#111827`, which is identical to the base text ink `#111827`, producing zero visible change.
  3. **Silent Cursor Void**: In `data-cursor-mode="inline-link"`, the magnetic ring was suppressed (`opacity: 0`), native cursor was hidden (`cursor: none`), and `#cur-dot` stayed an unstyled 6px white dot, leaving no tactile feedback under the mouse.
  4. **Broken Primer Target Paths in 33 Guides**: 33 problem guides (e.g. `01-array-string/05-majority-element.md`) specified `- **Prerequisite Primer**: 00-foundations/01-two-pointers.md`. The portal dictionary lacked `00-foundations_01-two-pointers` (the actual article is `00-foundations_03-core-algorithmic-patterns.md`, which covers Two Pointers in Section 2). As a result, the element degraded to `.primer-path` (plain text with `cursor: default` and no `onclick` handler), rendering it completely unclickable.
* **The Architectural Fix**:
  1. **Alias Resolution in `docs/index.html`**: Mapped `00-foundations_01-two-pointers` to `00-foundations_03-core-algorithmic-patterns`, restoring all 33 broken primer links across the portal to functional `.primer-link` elements with `onclick` navigation.
  2. **Dedicated Resting & Hover Rules in `docs/assets/theme.css`**:
     - At rest: `text-decoration: none !important;`, subtle translucent accent tint (`8%`), soft border (`22%`), monospace JetBrains Mono typography, and `cursor: pointer`.
     - On hover: Dynamic underline (`underline 1.5px var(--accent)` with `3px` offset), background illumination (`18%` accent mix), border warming, and tactile lift (`transform: translateY(-1px)`).
  3. **Cursor Dot Scale & Glow in `docs/assets/cursor.css`**: In `data-cursor-mode="inline-link"`, `#cur-dot svg` scales to 1.6× with `var(--accent)` fill and drop-shadow glow, providing immediate cursor feedback under the pointer.
  4. **Strict CSP Synchronization**: Refreshed SHA-256 script hashes in `vercel.json` via `node scripts/refresh-csp-hash.mjs --write`.

---

### 1.13 LeetCode Link Pill Typography: Elimination of Resting Underline & Dynamic Hover Activation
* **The Root Cause**:
  In `docs/assets/theme.css` (lines 160-169 and lines 830-845), blanket rules `a:not(...)` and `.prose a:not(...)` applied `text-decoration: underline !important;` unconditionally at rest. Furthermore, bare URL linkifiers in `docs/index.html` wrapped URL code blocks with `<a><code>https://leetcode.com/...</code></a>`, where `.prose a > code` inherited the resting underline. This caused LeetCode link pills to be permanently underlined even when the user was not hovering over them.
* **The Architectural Fix**:
  1. In `docs/assets/theme.css`, we explicitly decoupled resting state from hover state for all link elements, `.leetcode-link`, `.leetcode-code`, `.primer-link`, `a.prose-link`, and `a.inline-link`:
     - Resting state: `text-decoration: none !important;`
     - Hover state: `text-decoration: underline !important; text-underline-offset: 3px !important; text-decoration-color: var(--accent) !important; color: var(--accent) !important;`
  2. In `docs/index.html`, bare URLs are tagged with `.leetcode-link` and `.leetcode-code`, with `.prose a > code { text-decoration: none !important; }` at rest and `underline` on `:hover`.
  3. On hover, `.leetcode-link` triggers a subtle micro-elevation `transform: translateY(-1px)`, dynamic box-shadow glow, and engages `data-cursor-mode="inline-link"`.

---

### 1.14 Dynamic I-Beam Physics Spring Tuning ($k = 1400, c = 60$)
* **The Physics Challenge**:
  The lens ring `#cur-ring` operates with low spring stiffness ($k = 190, c = 17$) during normal pointer traversal to produce Apple-like fluid trailing. However, when selecting text or positioning a text caret between letters, any trailing lag causes the caret to feel sluggish and imprecise.
* **The Solution**:
  In `docs/assets/cursor.js`, the Euler integrator dynamically switches spring constants based on the active cursor mode:
  - Default / Link mode: $k = 190, c = 17$ (fluid, organic inertia).
  - Text Caret mode: $k = 1400, c = 60$ (critically damped, ultra-high responsiveness).
  This eliminates trailing lag during text interaction, ensuring the I-beam caret tracks the pointer position instantly with zero latency.

---

### 1.15 WAI-ARIA 1.2 Combobox Architecture & Container-Bounded Scroll Mathematics in Sidebar Search & Command Palette
* **The Root Cause (Standard `scrollIntoView()` Ancestor Page Walk & ARIA Mismatch)**:
  1. **Page Walk Jitter**: Calling standard `element.scrollIntoView({ block: 'nearest' })` on a highlighted `.nav-item` inside `#curriculumNav` forces the browser to traverse up the DOM tree and adjust the scroll offsets of **all** scrollable parent containers—including the main `<article>` scroller and `window`. This caused severe viewport jumping whenever users used ArrowUp / ArrowDown in the sidebar search input.
  2. **Accessibility Desynchronization**: Without explicit WAI-ARIA 1.2 combobox attributes (`role="combobox"`, `role="listbox"`, `role="option"`, `aria-activedescendant`), screen readers could not announce the currently highlighted guide during arrow navigation, leaving visually impaired users unable to navigate search results without transferring focus out of the input field.
* **The Architectural Solution**:
  1. **Container-Bounded Delta Arithmetic for Sidebar Navigation**:
     In `paintNavSelection()`, instead of invoking `scrollIntoView()`, we compute relative boundary deltas using `getBoundingClientRect()` strictly between the `#curriculumNav` scrollport and the target `.nav-item`:
     ```javascript
     const navBox = nav.getBoundingClientRect();
     const box = active.getBoundingClientRect();
     if (box.top < navBox.top) nav.scrollTop -= navBox.top - box.top + 8;
     else if (box.bottom > navBox.bottom) nav.scrollTop += box.bottom - navBox.bottom + 8;
     ```
     This confines scroll repositioning entirely to `nav.scrollTop` without walking up ancestor containers, eliminating any vertical jitter in the document body or article reader.
  2. **WAI-ARIA 1.2 Combobox Semantic Alignment**:
     - `#searchInput` is configured as `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded="true"`, `aria-controls="curriculumNav"`, and dynamically updates `aria-activedescendant="<guideId>"`.
     - `#curriculumNav` is configured as `role="listbox"` wrapped within a structural `<nav aria-label="Curriculum" class="flex-1 min-h-0 flex flex-col">`.
     - `#paletteInput` and `#paletteList` mirror this pattern with `aria-controls="paletteList"` and `pal-opt-${id}` option identifiers.

---

### 1.16 Decoupling Pointer Hover State from Keyboard Navigation Index
* **The Usability Defect**:
  In earlier implementations of the ⌘K command palette, `div.onmousemove = () => { palIndex = i; paintPalSelection(); }` bound the active selection index directly to pointer motion. If a user carefully navigated down a list using `ArrowDown` / `ArrowUp` or jumped to the bottom with `End`, any slight accidental movement of the mouse over another item would immediately overwrite `palIndex`. Pressing `Enter` would subsequently open the accidentally hovered item rather than the intended keyboard selection.
* **The Architectural Solution**:
  We decoupled visual hover styling from the keyboard selection state machine:
  ```javascript
  div.onmouseenter = () => {
    paletteList.querySelectorAll('.pal-item').forEach(el => { el.style.background = ''; });
    if (i !== palIndex) div.style.background = 'rgba(148,163,184,0.08)';
  };
  div.onmouseleave = () => { div.style.background = ''; };
  ```
  `palIndex` is strictly controlled by keyboard events (`ArrowUp`, `ArrowDown`, `Home`, `End`) and deterministic click triggers, ensuring keyboard selections remain immutable against ambient pointer movement.

---

### 1.17 Two-Stage Escape Handling & Focus-Isolated Event Dispatching
* **The UX Conflict**:
  Pressing `Escape` when filtering the sidebar was previously caught by the global document listener, which immediately dismissed the entire sidebar drawer. This created a frustrating experience for users who merely intended to reset their search filter.
* **The Architectural Solution**:
  1. **Two-Stage Escape in `searchInput.onkeydown`**:
     ```javascript
     else if (e.key === 'Escape') {
       e.preventDefault();
       if (searchQuery) { searchQuery = ''; searchInput.value = ''; renderNav(); }
       else closeSidebar();
     }
     ```
     - **Stage 1**: If `searchQuery` is non-empty, `Escape` clears the query, resets the input value, and re-renders the navigation list without closing the drawer.
     - **Stage 2**: If `searchQuery` is already empty, `Escape` closes the sidebar drawer.
  2. **Global Listener Focus Guard**:
     The document-level keydown listener now checks `document.activeElement !== searchInput` before handling `Escape`, preventing double-execution or premature sidebar closure.

---

## 2. Comprehensive Inventory of Project Modifications

### 2.1 Design Tokens & Theming (`docs/assets/theme.css`)
* **Dark Mode Palette**: Preserves original lime accent (`#C8FA4B`) on obsidian surfaces (`#08090D` canvas, `#0D1017` surface, `#121724` raised).
* **Light Mode Palette**: Monochrome Brutalist design (`#FFFFFF` canvas, `#F3F4F6` surface, `#111827` ink & accent, `#4B5563` muted text).
* **Accessibility**:
  - Persistent link underlines in prose.
  - Semantic badge colors passing WCAG AA ($\ge 4.5:1$ text, $\ge 3:1$ UI).
  - High-contrast empty state styles and chat composer variables.

### 2.2 Apple-Motion Custom Cursor Engine (`docs/assets/cursor.js` & `docs/assets/cursor.css`)
* **Physics Model**:
  - 6px tracking dot ($k = 1400, c = 60$).
  - 32px trailing lens ring ($k = 190, c = 17$).
  - Dynamic scale spring ($k = 240, c = 20$) targeting compact scale clamped between $0.45\times$ and $0.75\times$ (14.4px – 24px diameter) over interactive elements.
  - Sub-stepped semi-implicit Euler integration at a fixed 240Hz ($H = 1/240$).
* **Rest / Sleep State**:
  - Auto-sleeps when velocities drop below threshold ($\text{hypot}(v_x, v_y) < 0.05$, $\text{hypot}(\Delta x, \Delta y) < 0.1$), canceling `requestAnimationFrame` for 0% idle CPU overhead.
  - Wakes immediately on pointer movement or window scroll.
* **Vector Anti-Aliasing (Anti-Pixelation)**:
  - Injected vector SVG `<circle>` primitives with `shape-rendering="geometricPrecision"` and `vector-effect="non-scaling-stroke"`.
  - Maintains 1px crisp outline regardless of zoom level or scale factor.
* **Tablet & Accessibility Gating**:
  - Distinguishes `e.pointerType === 'touch'` vs `'mouse'` / `'pen'`.
  - Disabled under `(hover: none) or (pointer: coarse)` when no fine pointer exists.
  - Disabled under `(prefers-reduced-motion: reduce)` and `(forced-colors: active)`.
  - System `cursor: text` preserved over prose, inputs, and code blocks.

### 2.3 Shell & Subpage Integration (`docs/index.html` & `docs/topics/rate-limiter.html`)
* **Theme Toggle Button**: Mounted persistently in the header adjacent to `#authArea`.
* **Zero FOUT**: Head script initializes `data-theme` from `localStorage['lt150-theme']` or `window.matchMedia('(prefers-color-scheme: dark)')` prior to rendering.
* **Prism Stylesheet Switch**: Dynamically switches between `prism-tomorrow.min.css` (dark) and `prism.min.css` (light).
* **Subpage Parity**: `docs/topics/rate-limiter.html` upgraded with matching header, navigation, theme toggle, and cursor integration.

### 2.4 Chat Widget Modernization (`docs/chat-widget.js`)
* Suggestion chips tagged with `data-cur="link"` for magnetic cursor snap.
* Dynamic Mermaid diagram theming (`theme: isLight ? 'default' : 'dark'`) maintaining strict security level (`securityLevel: 'strict'`).

### 2.5 Security & Pipeline Compliance (`scripts/refresh-csp-hash.mjs` & `vercel.json`)
* Computed SHA-256 digests for all inline script blocks.
* Synchronized `vercel.json` `Content-Security-Policy` header.

### 2.6 Automated Test Suites (`tests/theming.spec.mjs` & `tests/cursor.spec.mjs`)
* `tests/theming.spec.mjs` (16 test assertions):
  - System cold start (dark and light modes).
  - Manual toggle and `localStorage` persistence across reloads.
  - Dynamic Prism theme stylesheet swap.
  - Subpage (`rate-limiter.html`) synchronization.
  - WCAG AA contrast ratio validation ($\ge 4.5:1$).
  - Mobile header dimensions (56px header, 40px controls at 360px).
* `tests/cursor.spec.mjs` (18 test assertions):
  - DOM creation with vector SVG elements.
  - 240Hz Euler spring motion and sleep detection (`window.__cursorSpringSleeping`).
  - Pointer wake-up and scroll wake-up.
  - Magnetic snap and scale settling to $2.227\times$.
  - Accessibility gating under reduced motion and touch devices.
  - Zoom resilience (vector effect & geometric precision under page zoom).
  - Hybrid tablet input handling (`touch` hides, `mouse` restores).

### 2.7 Tactile Physical Motion & Chat Box Visual Overhaul (`docs/assets/theme.css`)
* **Physical Spring Curves & Surface Interactions**:
  - Defined physical spring tokens `--ease-snappy: cubic-bezier(0.2, 0.9, 0.3, 1)` and `--ease-bounce: cubic-bezier(0.34, 1.56, 0.64, 1)`.
  - Applied subtle hover lift (`transform: translateY(-2px) scale(1.01)`) and active depression (`transform: translateY(1px) scale(0.98)`) across interactive buttons (`button[data-guide]`, `#homeStart`, `#homeSearch`, `#guidesBtn`, `#paletteBtn`, `#themeToggle`, `.ltc-send`, `.ltc-chip`).
  - Added dynamic glow accents (`box-shadow: 0 4px 16px -2px rgba(200, 250, 75, 0.25)` in dark mode, `rgba(17, 24, 39, 0.12)` in light mode).
* **High-Contrast Light Mode Fixes**:
  - Corrected hardcoded Tailwind `.text-slate-*` utilities inside `docs/index.html` via high-specificity selectors under `html[data-theme="light"]`, ensuring dark ink readability (`#111827`) instead of washed-out white text.
  - Re-mapped overview cards and hero statistics to `--canvas-sub` and `--border-strong`.
  - Chat empty state, suggestion chips, pill inputs, and status headers now cleanly switch between obsidian lime and monochrome brutalist modes with $\ge 4.5:1$ contrast.
* **Active Live Server Deployment**:
  - Live preview server launched and active on port 3000: `http://localhost:3000` (PID under Task 1127).
  - Clarified port disambiguation: Port 8080 was running a legacy daemon from a separate workspace (`Sidebar_Enhancement`), while port 3000 serves `Mouse_and_Hover_effects`.

### 2.8 Phase 8 Overhaul: Project-Wide Visual FX, Frosted Glass Header, Modern Code Blocks & Light-Mode Contrast Hardening
* **Cursor Engine Overhaul (`docs/assets/cursor.css`, `docs/assets/cursor.js`)**:
  - Universal pointer suppression via `html[data-cursor="on"], html[data-cursor="on"] * { cursor: none !important; }`, completely eliminating native arrow pointer leakage over child nodes, SVGs, and buttons.
  - Native text selection cursor restoration over `.prose p, .prose li, pre, pre code, input, textarea` with `cursor: text !important;`.
  - Seamless text hand-off: entering text mode sets `data-cursor-mode="text"`, hiding `#cur-dot` and `#cur-ring` via `opacity: 0 !important;` to eliminate double-cursor collision.
  - Re-anchored magnetic button snapping to the top-right corner (`targetX = rect.right - 8`, `targetY = rect.top + 8`, `targetScale = 2.227`), leaving button text 100% visible and unoccluded.
  - Added 3 Playwright tests in `tests/cursor.spec.mjs` verifying universal pointer suppression, text mode cursor hand-off, and top-right corner snapping (all 24 checks pass).
* **Translucent Frosted Glass Header (`header.glass` in `docs/assets/theme.css` & `docs/index.html`)**:
  - Applied frosted glass styling with `background: color-mix(in srgb, var(--canvas-sub) 75%, transparent) !important;` and `backdrop-filter: blur(12px) saturate(180%) !important;`.
  - Preserved the strict 56px header height invariant using `box-shadow: inset 0 -1px 0 var(--border-soft) !important;`.
* **Sidebar Navigation List Effects (`.nav-item` in `docs/assets/theme.css` & `docs/index.html`)**:
  - Implemented 3px sliding left accent bar (`::before`) with `transform: scaleY(0)` transitioning to `scaleY(1)` via `--ease-snappy`.
  - Added smooth hover indentation (`padding-left: 20px !important`).
  - Removed old inline JS hover styles (`btn.onmouseenter`/`btn.onmouseleave`) from `renderNav()` in favor of robust CSS classes.
* **Modern Code Boxes (`.code` and `.code-bar` in `docs/assets/theme.css` & `docs/index.html`)**:
  - Modernized `enhanceCodeBlocks()` in `docs/index.html` to wrap `<pre>` elements in `<div class="code code-wrap">` containing `<div class="code-bar">`.
  - Features Mac 3-dot window controls (red/yellow/green), a monospace filename label, and an interactive copy button.
  - Added hover elevation and border warming (`border-color: color-mix(in srgb, var(--accent) 35%, var(--border))`).
* **Interactive Spotlight Tracking & Underline Sweep (`docs/assets/theme.css` & `docs/index.html`)**:
  - Added `[data-spot]` radial gradient reveal following cursor pointer coordinates (`--mx`, `--my`) via delegated `pointermove` listener.
  - Added `.ulink` animated directional underline sweep (`transform: scaleX(0 -> 1)`).
* **Ambient Background Radiance (`body::before` in `docs/assets/theme.css`)**:
  - Fixed pseudo-element behind all content providing ambient radial glows in dark and light modes.
* **Hardened Light-Mode Contrast (`docs/assets/theme.css`)**:
  - Adjusted semantic badge tokens under `html[data-theme="light"]`: `--easy: #157F4B`, `--med: #8A5A00`, `--hard: #C0342F`, `--done: #6B3FBF` ($\ge 4.5:1$ WCAG AA).
  - High-specificity overrides for hardcoded Tailwind `.text-slate-300`, `.text-slate-400`, `.text-slate-500`, `.text-slate-600`, and `.nav-group-label` / `.nav-group-count`.
* **CSP Integrity (`vercel.json`)**:
  - Executed `node scripts/refresh-csp-hash.mjs --write` to update SHA-256 script hashes in `vercel.json`.

### 2.9 Phase 9: Precision 3-Tier Geometry Overhaul (Inline Links, Sidebar Nav, and Top-Right Snapping)
* **3-Tier Hierarchy Implementation (`docs/assets/cursor.js`, `docs/assets/cursor.css`, `docs/assets/theme.css`)**:
  - **Tier 0 (Form Inputs & Native Text Caret)**: Form inputs, textareas, and contenteditable elements restore the native text caret and suppress custom cursor elements (`opacity: 0 !important;`).
  - **Tier 1 (Sidebar Navigation Items `.nav-item`)**: Target circle center is pinned to `targetX = rect.right`, `targetY = rect.top + rect.height / 2`, placing the center directly on the right border middle of the vertical height of the element. Circle area is bisected 50/50. Scale factor is compact and proportional (`Math.min(0.75, Math.max(0.45, (rect.height * 0.55) / 32))`).
  - **Tier 2 (Inline Links & Tags)**: Identified via `isInlineLinkOrTag(el)`. Sets `data-cursor-mode="inline-link"`, completely hiding `#cur-ring` (`opacity: 0 !important;`), while `#cur-dot` tracks the pointer smoothly without snapping. The link is styled with persistent subtle underline and hover accent glow (`text-decoration: underline !important; text-underline-offset: 3px !important; text-decoration-thickness: 1.5px !important;`).
  - **Tier 3 (Rest of Interactive Elements: Buttons, Chips, Toggles, Controls, Cards)**: Ring center is pinned to the exact top-right corner without offset (`targetX = rect.right`, `targetY = rect.top`). Exactly $1/4$ of the circle area is inside the element and $3/4$ outside. Scale factor is proportional to element height (`Math.min(0.85, Math.max(0.45, (Math.min(rect.height, 64) * 0.55) / 32))`).
  - **Tier 4 (Prose Text & Code Blocks)**: Native text caret restored, custom cursor suppressed.
  - **Tier 5 (Default Background)**: Free 240Hz Euler spring tracking.
* **Automated Test Coverage (`tests/cursor.spec.mjs`)**:
  - Verified button top-right snapping (`targetX` within 2px of `rect.right`, `targetY` within 2px of `rect.top`).
  - Verified sidebar navigation vertical centering (`targetX` within 2px of `rect.right`, `targetY` within 2px of `rect.top + rect.height / 2`).
  - Verified inline link underline highlight and ring suppression (`data-cursor-mode="inline-link"`, `#cur-ring` opacity 0, `#cur-dot` opacity 1, `text-decoration-line="underline"`).
  - All 16 fine-pointer cursor test assertions pass with 0 failures.

### 2.10 Phase 10: Primer Link Architecture & Hover Feedback Restoration
* **Curriculum Linkifier Routing (`docs/index.html`)**:
  - Aliased `00-foundations_01-two-pointers` to `00-foundations_03-core-algorithmic-patterns` in the markdown regex linkifier.
  - Automatically restored all 33 questions (e.g., Majority Element, Merge Sorted Array, Valid Palindrome, 3Sum) from inert `.primer-path` text elements into fully functional, clickable `.primer-link` buttons with `openArticle()` callbacks.
  - Cleaned up inline styles on `.prose code.primer-path` (`cursor: default`) and removed colliding inline overrides.
* **Design System & Typography Overhaul (`docs/assets/theme.css`)**:
  - Excluded `.primer-link` from unhovered `text-decoration: underline`.
  - Added dedicated resting style: `text-decoration: none !important;`, subtle translucent accent background tint (`8%`), soft border (`22%`), monospace JetBrains Mono font, and `cursor: pointer`.
  - Added dynamic hover feedback: `text-decoration: underline !important; text-underline-offset: 3px !important; text-decoration-thickness: 1.5px !important; text-decoration-color: var(--accent) !important; background: color-mix(in srgb, var(--accent) 18%, var(--canvas-sub)) !important; border-color: var(--accent) !important; color: var(--accent) !important; transform: translateY(-1px); box-shadow: 0 2px 8px -1px color-mix(in srgb, var(--accent) 25%, transparent) !important;`.
* **Cursor Dot Physics Feedback (`docs/assets/cursor.css` & `docs/assets/cursor.js`)**:
  - Under `html[data-cursor-mode="inline-link"]`, `#cur-dot svg` dynamically scales to 1.6× with `var(--accent)` fill and drop-shadow glow, providing instant pointer feedback.
  - Excluded `code.primer-path` from `isInlineLinkOrTag()` so dead text paths do not trigger link cursor mode.
* **Automated E2E Testing (`tests/cursor.spec.mjs`)**:
  - Added Playwright test verifying resting `textDecorationLine === 'none'`, hover `textDecorationLine === 'underline'`, `data-cursor-mode === 'inline-link'`, ring opacity 0, dot opacity 1, and click navigation directly into `#00-foundations_03-core-algorithmic-patterns`.

---

### 2.11 Phase 11: Site-Wide Pseudocode Codebox Title Normalization (`pseudocode.md`)
* **Context & Architectural Need**:
  - In algorithm guides throughout the site, code blocks under `### Pseudocode` sections (often tagged as ` ```text ` or plain text by marked.js) were previously labeled with the generic title `text` in `.code-title`.
  - The user requested standardizing the codebox title for all pseudocode sections across the portal to `pseudocode.md`, distinguishing algorithmic specifications from executable JavaScript (`solution.js`).
* **Implementation (`docs/index.html`)**:
  - In `docs/index.html` lines 1729-1753, added multi-tier detection during post-render markdown codebox wrapping:
    1. **Preceding Sibling Heading Detection**: Walks backward along `pre.previousElementSibling` to find the nearest heading tag (`/^H[1-6]$/i`). If heading text matches `/pseudocode/i`, marks `isPseudocode = true`.
    2. **Language Tag Detection**: Checks if code fence language matches `pseudocode|pseudo`.
    3. **Content Signature Detection**: Checks if block content starts with `/^\s*FUNCTION\b/m`.
  - When `isPseudocode` is satisfied, `.code-title` is explicitly set to `pseudocode.md`.
  - Solution code blocks in JavaScript/TypeScript continue to map to `solution.js` / `solution.ts`.
* **CSP Re-synchronization (`vercel.json`)**:
  - Re-computed inline script hash via `scripts/refresh-csp-hash.mjs` and updated `vercel.json` (`sha256-hAdM56r1buvDDZfhEPWI0jnp6lPdBF7PHBIRctWJ/CU=`).
* **Automated E2E Testing (`tests/theming.spec.mjs`)**:
  - Added test `pseudocode sections across guides display pseudocode.md as codebox title` asserting all codeblocks under `### Pseudocode` display `pseudocode.md` and JS blocks display `solution.js`.
  - Full suite passed: 18/18 theming tests, 18/18 cursor tests, 2/2 CSP tests.

### 2.12 Phase 12: WAI-ARIA 1.2 Keyboard Navigation & Focus Isolation (`docs/index.html` & `tests/nav.spec.mjs`)
* **Context & Objectives**:
  - Implement full keyboard accessibility across the curriculum sidebar filter and the ⌘K command palette using WAI-ARIA 1.2 Combobox specifications.
  - Support `ArrowUp`, `ArrowDown`, `Home`, `End`, `Enter`, and two-stage `Escape` navigation without disrupting Tab focusability or causing ancestor layout jitter.
* **Implementation (`docs/index.html`)**:
  - **Sidebar Combobox**: Wrapped `#curriculumNav` in `<nav aria-label="Curriculum" class="flex-1 min-h-0 flex flex-col">`, added `role="listbox"`, `role="combobox"`, `aria-autocomplete="list"`, `aria-activedescendant`, and container-bounded delta scrolling in `paintNavSelection()`.
  - **Command Palette Combobox**: Integrated `pal-opt-${id}` IDs, updated `paintPalSelection()` with `scrollIntoView({ block: 'nearest' })` on `#paletteList`, added `Home`/`End` handlers, and decoupled hover background styling from `palIndex`.
  - **Two-Stage Escape**: Search input keydown handler clears filter query first before closing drawer; global listener guards against active search input.
* **CSP Re-synchronization (`vercel.json`)**:
  - Re-computed inline script hash via `scripts/refresh-csp-hash.mjs` and updated `vercel.json`.
* **Automated E2E Testing (`tests/nav.spec.mjs`)**:
  - Added 5 comprehensive test suites covering sidebar arrow selection + Enter, two-stage Escape, zero-match Enter safety, palette Home/End traversal, and viewport scroll containment.

---

### 2.13 Phase 13: Table Scrollport Geometry & Chatbox Visual Surface Hardening
* **Context & Objectives**:
  - Resolve horizontal table scroll layout shifts and inconsistent border clipping when scrolling between columns.
  - Eliminate the artificial 1.85rem empty padding void in assistant codeblocks by introducing a structured header bar with language badge and unified copy action.
  - Standardize button dimensions across the chat widget (header icons, composer submit/stop, suggestion chips) for balanced visual rhythm and responsive scaling across mobile and floating desktop modes.
* **Architecture & Invariants**:
  - **Table Layout**: Enforce minimum column dimensions, continuous row striping (`tbody tr:nth-child(even)`), and contained overflow bounds (`overscroll-behavior-x: contain`) on both `.table-scroll` and `.ltc-table-scroll`.
  - **Chat Codebox Structure**: Structured as `<div class="chat-code"><div class="chat-code-head"><span class="chat-code-lang">lang</span><button class="chat-code-copy" ...>Copy</button></div><pre><code>...</code></pre></div>`.
  - **Composer & Header Scale**: Scaled header `.ltc-icon-btn` to 32×32px and composer `.ltc-send` to 34×34px with matching border radii, freeing up header space on 380px floating panels while maintaining touch accessibility.

---

## 3. Verification Matrix

| Suite | Status | Assertions / Tests |
|---|---|---|
| `npx playwright test` (Full E2E) | **PASSED** | 121 passed, 18 skipped, 0 failures (100% green) |
| `npx playwright test tests/nav.spec.mjs` | **PASSED** | 57 passed, 17 skipped (viewport variants), 0 failures |
| `npx playwright test tests/theming.spec.mjs` | **PASSED** | 18 passed, 0 failures |
| `npx playwright test tests/cursor.spec.mjs` | **PASSED** | 18 passed, 14 skipped (mobile), 0 failures |
| `npm run verify` | **PASSED** | 398 passed, 1 skipped, 0 failures |
| `npm test` (Algorithmic Guides) | **PASSED** | 150 files, 450 syntax blocks, 1,898 assertions |
| `npm run test:chat` (Chat & Rate Limiter) | **PASSED** | 471 assertions, 0 failures |
| `node scripts/test-dryrun-render.mjs` | **PASSED** | 141 checks, 0 failures |
| `npm run csp:hash` (Strict CSP) | **PASSED** | 2/2 SHA-256 blocks verified in `vercel.json` |
| Live Server HTTP Status | **PASSED** | HTTP/1.1 200 OK on `http://localhost:3000` |




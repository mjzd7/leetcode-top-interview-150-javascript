# UI Effects & Motion System — Recreation Spec

Hand this file to any agent. It documents every UI effect, transition, physics routine, transparency/glass device, scroll behavior, cursor engine, and hover/interaction affordance implemented in this project. Colors are intentionally NOT enumerated: every value is expressed via CSS custom properties (var(--...)), inherited DOM attributes, and structural constants. Recreate the behavior; plug in your own palette.

Scope files: docs/assets/theme.css, docs/assets/cursor.css, docs/assets/cursor.js, docs/assets/chat-widget.css, docs/index.html (header/progress/theme orchestration).

Legend: var(--*) = replace from your own token set with same semantic role; literal px/ms/cubic-bezier are structural and must be copied verbatim.

## 0. Global conventions

- Theme selection: html[data-theme="dark"|"light"] plus html.classList.toggle('dark').
- Persist in localStorage['lt150-theme']; honor prefers-color-scheme when unset.
- Emit window CustomEvent 'themechange' { detail: { theme } } on change.
- color-scheme: dark|light is set per mode.
- Reduced motion: prefers-reduced-motion: reduce disables transforms/transitions on chat, mermaid, and hides custom cursor.
- Forced colors / touch / coarse pointer / reduced-motion: hide custom cursor, restore native cursor.
- Two easings used everywhere:
  --ease-smooth: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-snappy: cubic-bezier(0.2, 0, 0, 1);

## 1. Surface layer & transparency architecture

### 1.1 Body ambient radiance (required backdrop for glass)
body { position: relative; isolation: isolate; }. A fixed pseudo-element body::before sits at z-index: -1, pointer-events: none, carrying two wide radial washes so glass has something to see through:

background:
  radial-gradient(1100px 460px at 82% -8%,  color-mix(in srgb, var(--accent) 9%, transparent),  transparent 62%),
  radial-gradient(900px  520px at -8% 108%, color-mix(in srgb, var(--done)   8%, transparent), transparent 62%);
transition: opacity 0.3s var(--ease-smooth);

Also html { background-color: var(--canvas); color: var(--fg); } and body { background: var(--canvas); color: var(--fg-prose); }.

### 1.2 Frosted glass (subpixel-preserving pseudo-element architecture)
Class .glass and header.glass get background: transparent !important and use a ::before pseudo for the blur pane so child content (text/subpixels) is never blurred:

@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .glass::before, header.glass::before {
    content: '';
    position: absolute; inset: 0; z-index: -1; border-radius: inherit;
    background: color-mix(in srgb, var(--canvas-sub) 70%, transparent);
    -webkit-backdrop-filter: blur(12px) saturate(180%);
    backdrop-filter:          blur(12px) saturate(180%);
  }
}
@supports not (...) {
  .glass::before, header.glass::before {
    content: ''; position: absolute; inset: 0; z-index: -1; border-radius: inherit;
    background: var(--canvas-sub);
  }
}
.glass {
  position: relative; isolation: isolate; background: transparent !important;
  box-shadow: 0 1px 0 var(--rim), var(--shadow-rest) !important;
}
header.glass {
  position: sticky; top: 0; z-index: 30; isolation: isolate;
  background: transparent !important;
  box-shadow: inset 0 -1px 0 var(--border-soft), 0 1px 0 var(--rim), var(--shadow-rest) !important;
}

Rule: glass is always transparent on top; blur pane behind content; solid fallback for @supports not.

### 1.3 Other translucency surfaces
- Mobile header uses translateY on scroll (see 3.2), plus blur on takeover.
- Chat panel variants use backdrop-filter blur(20-24px) saturate(180-190%), dropping to blur(8-12px) while dragged; fullscreen mode drops backdrop-filter entirely to prevent GPU lag.
- Cursor ring over glass/panels flips mix-blend-mode to normal (see 4.7).
- ltc-scroll-down button: backdrop-filter: blur(10px); box-shadow: 0 6px 18px rgba(0,0,0,0.45).

### 1.4 Text selection
::selection { background: var(--accent); color: var(--accent-ink); }

## 2. Typography & link effects

### 2.1 Link base (no static underline, semantic transition)
All inline anchors (with exclusions):
transition: text-decoration-color 0.18s var(--ease-snappy), color 0.18s ...,
            border-color 0.18s ..., background-color 0.18s ..., transform 0.18s ... !important;
text-decoration: none !important;
Hover: text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1.5px; text-decoration-color: var(--accent); color: var(--accent).

Exclusion selectors for broad link rule: .btn, .nav-item, #brandHome, #paletteBtn, #guidesBtn, #themeToggle, .ltc-chip, .nav-cat-btn, [role="button"], [class*="btn"], [class*="h-11"], [class*="h-10"].

### 2.2 Light-mode affordance (persistent rest vs hover)
html[data-theme="light"] .prose a, html[data-theme="light"] a.prose-link { text-decoration: none !important; }
...:hover { text-decoration: underline !important; text-underline-offset: 3px !important; text-decoration-color: var(--accent) !important; }

### 2.3 .ulink (underline sweep, origin flips exit-aware)
.ulink { position: relative; text-decoration: none !important; }
.ulink::after { content:''; position:absolute; bottom:-1px; left:0; width:100%; height:1.5px; background: currentColor; transform: scaleX(0); transform-origin: 100% 50%; transition: transform 0.22s var(--ease-snappy); }
.ulink:hover::after { transform: scaleX(1); transform-origin: 0% 50%; }

### 2.4 Link pills
- .leetcode-link: inline-flex; rest no underline; hover inner code gets underline + accent-tinted background (color-mix accent 18%), glow box-shadow 0 0 10px color-mix(accent 35%), transform translateY(-1px).
- .primer-link / prose code.primer-link: badge shape at rest (accent-tinted bg/border, monospace, radius .375rem); hover underline sweeps 0 to 1 with lift translateY(-1px) + glow box-shadow.

### 2.5 Spotlight hover tracking (--mx, --my)
[data-spot], .spot, .table-scroll, .ltc-table-scroll, .tbl, .chat-code, .ltc-msg--user .ltc-msg-body have ::after radial gradient:
background: radial-gradient(280px circle at var(--mx, 50%) var(--my, 50%), color-mix(in srgb, var(--accent) 13%, transparent), transparent 62%);
opacity 0 rest, opacity 1 on :hover with transition opacity 0.25s var(--ease-smooth). pointer-events: none overlay. Children position: relative (z-index above).

JS: pointermove computes --mx/--my as percentage of closest matched element: mx = ((clientX - rect.left)/rect.width*100).toFixed(1)+'%'. Runs for closest('[data-spot], .spot, .table-scroll, ...').

### 2.6 Specular sheen on surfaces
.card, .code, .table-scroll, .ltc-msg--user .ltc-msg-body, .chat-code, .viz-array/.mermaid in chat, .ltc-chip, .ltc-composer, .mermaid, .prose .mermaid all get ::before:
content:''; position:absolute; inset:0; border-radius:inherit; background: var(--sheen); opacity ~0.6-0.8; pointer-events:none; z-index 0/1.
--sheen is a top-to-bottom linear gradient light→transparent. Creates glossy top edge. Hover lift: translateY(-2px to -3px) + border-color color-mix(accent 35-42%) + var(--shadow-lift). Active: scale(0.975-0.985) and translateY(0).

### 2.7 Mac traffic lights in code blocks
.chat-code::before: three 6px dots positioned top-left (13px/12px), using ::before at top 13px left 12px width/height 6px border-radius 50% with box-shadow: 12px 0 0 var(--badge-med-fg), 24px 0 0 var(--badge-easy-fg), fill var(--badge-hard-fg). z-index 1.

### 2.8 Button sweep highlight
.btn, button[data-guide], #homeStart, #guidesBtn, #themeToggle use position relative overflow hidden. ::after: inset 0; background linear-gradient(105deg, transparent 32%, rgba(255,255,255,.26) 48%, transparent 64%) [light uses .7 transparency]; transform translateX(-120%); transition transform 0.3s var(--ease-smooth). Hover: translateX(120%). Subtle one-shot sweep.

## 3. Scroll & header

### 3.1 Reading progress bar
Element #progressBar h-full w-0 background var(--accent). On scroll: pct = scrollTop/(scrollHeight-clientHeight)*100; width = pct+'%'.

### 3.2 Mobile auto-hiding header (sweet-spot sliding drawer)
Only max-width 767px. header.glass CSS transitions transform 0.28s cubic-bezier(0.16,1,0.3,1) and box-shadow 0.28s ease; will-change transform. .header-hidden { transform: translateY(-100%) !important; box-shadow: none !important; }. On ≥768px, transform 0 !important.

JS algorithm: thresholds HEADER_SWEET_SPOT_TOP=56, HIDE_DELTA_DOWN=10, SHOW_DELTA_UP=-8. Accumulate scroll delta. If currentY <= 56, always show + reset accumulator. If drawer open (sidebar visible) or palette open, show. If delta>0 accumulate; if ≥10 hide. If delta<0 accumulate; if ≤-8 show. Also resets when direction changes (negative accumulator zeroed). lastHeaderScrollTop updated. Use passive scroll listener on scroller and window.

### 3.3 Scrollbar styling
WebKit: ::-webkit-scrollbar width/height 8px; track transparent; thumb #232B3D radius 8px; thumb:hover #2E3850. .ltc-log: width 9px, track transparent, thumb rgba(148,163,184,0.24) radius 999px with border 2px solid transparent background-clip content-box, hover 0.34.

Touch browsers: * { scrollbar-width: none; -ms-overflow-style:none } *::-webkit-scrollbar { display:none } (hide all scrollbars). Desktop uses thin/auto scrollbars in panels: scrollbar-width: thin; scrollbar-color: rgba(148,163,184,0.25) transparent.

Table/panel containers use overscroll-behavior-x: contain; margin; border-radius 12px.

### 3.4 Table scroll lift/spotlight (see 2.5)

## 4. Cursor & magnetic lens engine

### 4.0 Mount
Elements #cur-dot (6x6 white svg circle) and #cur-ring (32x32). If absent, JS creates them with SVG markup. Sets html[data-cursor]="on". On DOM ready or immediate if body exists. Skip entirely under (hover:none)/(pointer:coarse), prefers-reduced-motion reduce, forced-colors active: display:none and cursor:auto.

### 4.1 Physics integrator (fixed timestep)
Semi-implicit Euler, fixed H = 1/240 (240Hz). requestAnimationFrame loop with dt clamped to 0.05s, n = ceil(dt/H) up to cap. Each step:
  a = -k*(pos-target) - c*v; v += a*H; pos += v*H
Sleep: when all velocities < threshold (dotV <0.05, ringV<0.05, ring distance<0.1, scaleV<0.005, scale diff<0.005), snap exactly to targets and cancel RAF; wakeUp() restarts. Exposes window.__cursorSpringSleeping, __cursorTargetX/Y for tests.

Spring constants:
- Dot: k=1400, c=60 tracks mouseX/mouseY.
- Ring: base k=190, c=17 tracks targetX/Y; stiffens to k=1400, c=60 in text/resize/grab modes.
- Scale: k=240, c=20 tracks targetScale.
Rendering: translate3d(posX, posY,0) scale(scale). Will-change transform.

### 4.2 Mouse & target positions
Pointer move updates mouseX/Y; calls updateTarget(target), then wakeUp. Text-mode target = cursor; others compute target geometry:
- .nav-item: targetX=rect.right (circle center on right border middle), targetY=rect.top + height/2; targetScale = clamp(0.45..0.75, height*0.55/32).
- interactive selector (buttons etc.): targetX=rect.right, targetY=rect.top (circle centre top-right, so 1/4 inside 3/4 outside); targetScale = clamp(0.45..0.85, min(height,64)*0.55/32).
- Inline links/tags: no ring circle scaling (targetScale 0, ring opacity 0), dot follows cursor; underline handled by CSS mode inline-link. targetX/Y=mouse.
- Text: targetX/Y=mouse, scale 1, ring becomes I-beam.
- Default: target = mouse, scale 1.

INTERACTIVE_SELECTOR covers: 'a, button, [role="button"], input, select, .nav-item, #paletteBtn, #guidesBtn, #themeToggle, [data-cur="link"], .ltc-chip'.

TEXT_SELECTOR covers prose paragraphs, headings, blockquotes, td/th, pre, code, textarea, text inputs, contenteditable, [data-cursor-text].

isInlineLinkOrTag logic: exceptions for .nav-item, form inputs/editable, explicit buttons/controls/chips/toggles, then badges/tags/code.primer-link/leetcode-link are inline; anchors whose class contains btn/chip/h-11/h-10/rounded-xl/rounded-lg are NOT inline (control); other anchors ARE inline.

### 4.3 Cursor modes (data-cursor-mode on <html>)
- '' (default): dot difference-blend visible, ring circle visible with CSS border (if no svg fallback handled by markup svg). mix-blend difference.
- link: ring color warms to var(--accent-rim); circle stroke color changes.
- inline-link: ring opacity 0; dot svg scales 1.6; filter drop-shadow(0 0 6px var(--accent)); dot circle fill accent.
- text: dot opacity 0; ring becomes 2px wide, 22px high I-beam (radius 1, accent bg, glow shadow), with ::before/::after horizontal bars (8px x 2px) at top/bottom forming serifs. light mode overrides bg/color to #0A0D13.
- resize-ew/ns/nwse/nesw: dot hidden; ring becomes pill 44x24 (ew) / 24x44 (ns) / 36x36 diagonal; dark pill bg rgba(15,20,30,0.9), accent border, icon fades in; stiffness high so tracks instantly. light uses white pill.
- grab: 36x36 accent-bordered pill, grab icon dots; light white pill.
- grabbing: 32x32 solid accent pill with white border & accent glow.
- resize-* classification derived from body[data-resizing] value e/w/n/s/nw/se/ne/sw; cursor override native cursors ns/ew/nesw/nwse.
- handle/hover classification checks .ltc-handle, .ltc-panel-resizer, #ltRailResizer → selects resize mode.
- titlebar/draggrip header → grab mode.

Active dragging (body.is-chat-dragging) → grabbing mode and dot hidden.

### 4.4 Cursor events
- pointermove passive: if pointerType touch → hide dot/ring (touch) and return; else restore opacity. Delegated spotlight tracking updates --mx/--my. updateTarget(e.target); wakeUp.
- pointerdown: hide dot/ring on touch.
- scroll passive: if mouse inside window, elementFromPoint(mouseX,mouseY) then updateTarget and wakeUp.
- onPointerDown/up handle chat dragging.

### 4.5 Sensitivity gating
- Media queries hide cursor: (hover:none) or (pointer:coarse), prefers-reduced-motion, forced-colors active → #cur-dot,#cur-ring display:none !important; * cursor:auto !important.
- Universal cursor suppression only when (hover:hover) and (pointer:fine) and html[data-cursor="on"]*: cursor:none !important.

### 4.6 blend-mode GPU rule
Over .ltc-panel.is-open (body:has), and directly .ltc-panel #cur-dot/#cur-ring, resize/grab modes: mix-blend-mode: normal !important (avoid framebuffer readbacks). Panel open fullscreen makes dot accent-filled with glow, ring accent-accent with glow.

### 4.7 Sleep / wake
On each frame, update transforms. Sleep threshold as above. wakeUp cancels? Actually wakeUp starts RAF if none. Sleep stops RAF. This saves CPU.

### 4.8 Icon markup inside ring
Ring contains .cur-icons flex container centered with SVGs: ew, ns, nwse, nesw, grab. Toggled via .cur-icon display none/opacity/transform.

## 5. Nav, cards, tables, forms

### 5.1 Nav items
.nav-item: position relative; overflow hidden; transition padding-left 0.18s snappy, bg 0.18s, color 0.18s, border 0.18s.
::before left rail: absolute left 0 top 4 bottom 4 width 3px accent radius 0 3px 3px 0, transform scaleY(0), origin center, transition transform 0.18s snappy.
:hover sets bg var(--canvas-ins), padding-left 20px; ::before scaleY(1).
Active/data-active=aria-current: bg accent-soft, border accent-rim, color fg, ::before scaleY(1).
Compact rail hover (#sidebar[data-stage=2][data-rail-mode=num]) padding-left 0.

### 5.2 Cards
.card: radius 12px, border border-soft, bg canvas-sub, shadow rest; transitions transform 0.22s snappy, border 0.15s, shadow 0.22s, bg 0.15s. ::before sheen opacity .8. .hoverable:hover/focus-within: translateY(-3px), border color-mix(accent 42%), shadow lift.

### 5.3 Code boxes
.code: radius 8, border border-soft, bg canvas-ins, margin 1.25rem 0, overflow hidden, shadow rest. ::before sheen opacity .8. :hover border color-mix(accent 35%) + shadow lift. .code-bar with traffic lights etc. .copy-btn hover accent-soft.

### 5.4 Tables
(See 2.5 spotlight, sheen, hover). tbody tr hover bg accent-soft; td:first-child becomes mono accent bold on hover; light mode row hover bg var(--raised), first-col bold fg. Transition bg 0.15s smooth.

### 5.5 Interactive buttons tactile (global set)
Selector: button[data-guide], #homeStart, #homeSearch, #guidesBtn, #paletteBtn, #themeToggle, .ltc-send, .ltc-chip, .btn, a.btn, ... common transition 0.18s snappy for transform/box-shadow/bg/border/color.
- button[data-guide]:hover translateY(-2px), box-shadow 0 8px 24px -4px rgba(0,0,0,.35), border accent-rim.
  :active translateY(0) scale(0.985).
- #homeStart: accent bg accent-ink, shadow 0 2px 8px accent-soft; hover translateY(-2) + shadow 0 6px 20px accent-soft; active translateY(0) scale(.97).
- #homeSearch: bg canvas-sub, border border-soft, color fg-muted; hover translateY(-1), border accent-rim, color fg; active scale(.98).
- #guidesBtn etc.
- Theme toggle: cursor pointer; transition bg/border/transform .15s; hover translateY(-1); active scale(.96). Light mode styled white pill with shadow.

## 6. Chat widget effects

### 6.1 Panel modes
- docked: full-height sidebar panel, can be resized via ltRailResizer (vertical drag), height stored var(--ltc-panel-h), data-resized attribute switches flex.
- floating: draggable, resizable, glass surface; is-dragging lowers backdrop blur to 24px and opacity .98; snap-to positions.
- fullscreen: drops backdrop-filter entirely, accent-tinted ring, cursor accent.
- snap-bottom: bottom sheet transform translateY(101%) closed → 0 open; height var(--ltc-snap-h, 40dvh); draggable handle.

z-index 44. Backdrop .ltc-backdrop z 39 opacity transition 0.2s.

### 6.2 Glass & dragging
- Fullscreen-mode drag: cursor suppression (native cursors), custom morphing to grabbing.
- .ltc-panel.is-dragging transforms relative maybe; transition none !important to track pointer 1:1.
- backdrop-filter transitions on mode changes (20px/24px/8px etc.).

### 6.3 Chips, composer, bubbles (tactile + sheen)
- .ltc-chip: radius 999px, min-height 44px, sheen opacity .8, ::after specular sweep (translate -120 to 120 over .35s). Hover translateY(-2) + lift shadow + border accent 42%. Active scale .975. Focus-visible outline 2px accent offset 2. Also full tactile hover with border accent-rim, bg accent-soft, shadow 0 4px 12px rgba(0,0,0,.08).
- .ltc-composer: radius 18px, bg canvas-ins, border soft, shadow rest, sheen opacity .6. :hover border accent 32%. :focus-within border accent + shadow 0 0 0 3px accent-soft.
- User bubble: 14/14/4/14 radius, bg canvas-sub, border soft, shadow rest, sheen opacity .8, spotlight ::after opacity hover. Hover translateY(-1), border accent 38%, shadow lift.
- Assistant body: fg-prose.
- Traffic lights (::before) on chat code blocks.
- Chat code block: hover translateY(-2), border accent 38%, shadow lift, spotlight.
- ltc-scroll-down: bottom-center fixed above input; backdrop-filter blur(10px); boxShadow 0 6px 18px; hover translateY(-2) with translateX(-50%) centering.
- Composer growing per content: autoGrow() in JS.

### 6.4 Open/close
- Panel slides via translateY(101%) → 0, transition 0.28s cubic-bezier(0.32,0.72,0,1).
- Fade-in opacity 0.2s.
- Mobile.sheet detection at max-width 1023px (isSheet).

### 6.5 Reduced motion chat
@media (prefers-reduced-motion: reduce): .mermaid/.viz-array transforms/transitions none.

## 7. Mermaid & diagrams

.mermaid, .prose .mermaid: radius .75rem, border soft, shadow rest, ::before sheen opacity .8; :hover translateY(-2), border accent 35%, shadow lift. Reduced-motion disables transform/transition. Mermaid re-renders after themechange with 100ms debounce.

## 8. Executable self-check

There is no test harness for CSS; validate by:
- grep for legacy hex where var expected: none in theme.css except fallbacks.
- run node scripts/test-fonts.mjs.
- Manual QA (per project rules): drive actual page, capture screenshots, verify blur present, custom cursor renders, theme toggle flips, mobile header hides on scroll down, progress bar moves, hover lifts apply, spotlight tracking follows pointer (--mx/--my update), glass shows backdrop behind.
- cursor self-exposes window.__cursorSpringSleeping, window.__cursorTargetX/Y.

## 9. Recreation checklist (TDD-ish for effects)

1. Implement CSS custom property layer (tokens not colors in this spec; supply own).
2. Add motion curves.
3. Add body ambient radiance + glass system with @supports fallback.
4. Add ::selection.
5. Add link base + hover + .ulink + pills.
6. Add spotlight tracking JS + CSS.
7. Add specular sheen on surfaces + hover lift.
8. Add button sweep + tactile hover.
9. Add nav item rail bar.
10. Add cards/code/tables effects.
11. Add cursor engine (physics + modes + gating).
12. Add theme toggle & persistence & themechange event.
13. Add mobile header auto-hide.
14. Add reading progress bar.
15. Add chat widget (modes, glass, drag, chips, composer).
16. Add mermaid FX + reduced-motion gates.
17. Gating for reduced-motion/forced-colors/touch/coarse.
18. Validate all manual surfaces.

Done when all surfaces above render effects and QA captured. Colors explicitly out of scope.

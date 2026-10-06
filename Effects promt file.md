Earlier gemini agent tried working on this plan and used playground file as reference which is almost trash and contains nothing good or useful.   
we need to use the fx-showcase.html file as reference and covert our complete site and it's aesthetics similiar to this. We also need to add a dark and light mode toggle to the site that would lie beside the githb login option and this theme needs to be followed consistently through the website and all the pages.  Instead of using optimised lime colour we would be using the original lime color for the dark mode section of the site.   
Use the hyperplan skills to think of all the implementation roadblocks, edge cases, and implementation issues, fallbacks. below are some extracts  from the recent chat which we use to make the plan.  
The main source file is file:///var/folders/3c/mws77nsn7v9_641754phh7v00000gn/T/opencode/fx-showcase.html   
  
Full picture now. Two things you should know before I touch anything:  
1. fx-showcase.html is a different, much better file than the playground — 1423 lines, real Apple-spring easing, live WCAG contrast table that recomputes from the real tokens, capability-gated cursor.  
2. The magnetic lens has never actually rendered. Live bug:  
 	   
CSS styles	#cur-lens (:577, :585, :592, :595)  
DOM element	&lt;div id="cur-ring"&gt; (:681)  
JS writes to	$('#cur-ring') (:1178, :1212)  
forced-colors block	#cur-ring (:609)  
#cur-lens exists in CSS only. #cur-ring is an unstyled static div — no position:fixed, no z-index, no blur. The spring integrator has been writing translate3d() into a box with no positioning context. So the cursor you've been seeing is the 6px difference-blend dot only; the lens was never on screen. That's why you want a demo.  
Also: dark already is optimized lime (#08090D / #C8FA4B, exact match to the playground's dark\[lime\]). Light is a warm grey (#F3F4F6 / #1F2937) — not brutalist. That's the real change.  
#	Task	File / Target	Scenario	Verify by  
1	Rename CSS #cur-lens → #cur-ring (4 selectors) so the lens renders	fx-showcase.html:577,585,592,595	S1	lens visible at 32px w/ blur in screenshot  
2	Lens blur 2px → 1px ("bit lighter") + border-color transition	fx-showcase.html:589	S1	computed backdrop-filter = blur(1px)  
3	Add magnetic accent snap on data-cursor-mode="link"	fx-showcase.html after :592	S1	rim warms to accent on hover over a button  
4	Light palette → monochrome brutalist (re-derive --fg-muted/--fg-subtle for AA)	fx-showcase.html:108–126	S2	live contrast table: 0 FAIL  
5	Fix stale prose — Colour tab copy, the #4E6B08 note, themeNote	:723, :917–919, :1099–1101	S2	no claim contradicts a live token  
6	Playground: data-cursor="3", data-light-theme="brutalist", lighter lens blur, selected on both selects	theme-playground.html:2,150,2463–2466	S1	selects show Magnetic lens + Brutalist  
7	Render both modes of fx-showcase.html, dump live contrast table	playwright script (temp)	S1,S2	screenshots + non-zero ratio dump  
8	Delete the temp QA script + screenshots	temp dir	—	ls shows nothing left  
S1 cursor on, lens renders, magnetic snap works · S2 light palette is true brutalist and every text pair clears AA.  
  
What changed  
fx-showcase.html  
Fix	Was  
Lens never rendered	CSS styled #cur-lens; DOM + JS used #cur-ring — a static unstyled div  
Lens blur	blur(1px)  
Magnetic snap	none  
Light palette	warm grey #F3F4F6 / accent #1F2937  
Dark palette	#08090D / #C8FA4B  
Comment leak	/\* 0 · PALETTE \*/ printed as body text  
The greys in the light palette are not the obvious ones. #6B7280 is 4.39:1 on #F3F4F6 and #9CA3AF is 2.31:1 — both under the 4.5 AA floor, and both carry small type. Used #4B5563 (6.87:1) and #5B6472 (5.44:1) instead, hierarchy preserved.  
theme-playground.html — data-cursor="3", data-light-theme="brutalist", both &lt;select&gt;s given selected so the UI matches the defaults, lens blur 4px→1.5px / 8px→2.5px, and the lime option label corrected (#D4FF5E → #C8FA4B, which is what the token actually is).  
Evidence  
DARK   FAIL = 0        LIGHT  FAIL = 0        JS errors = none  
cursor=on ringOpacity=1 ringPos=fixed ringBlur=blur(1px)  
rim: rgba(150,150,150,0.3) at rest → oklab(…/0.329) on lime → color(srgb …/0.55) on ink  
playground: cursor=3 light=brutalist selCursor=3 selLight=brutalist inactiveCursorsHidden=true  
&gt;&gt;&gt; ALL ASSERTIONS PASSED  
Demo at /var/folders/3c/mws77nsn7v9\_641754phh7v00000gn/T/opencode/:  
demo-1/2/3 dark hero · topbar lens · buttons-lens · demo-4 card spotlight · demo-5/6/7 light equivalents · demo-8/9 playground in lime + brutalist.  
Three things you should decide  
1. Brutalist makes links indistinguishable from body text — --accent is --fg (#111827). That's inherent to monochrome, not a bug in my values. If you want links separable, the cheapest fix is keeping --accent near-black but giving .ulink a persistent underline. Say the word.  
2. Hover blur is effectively \~2.2px, not 1px — the spring scales the lens to 2.2× over interactive targets, which magnifies the blur and smears button labels while you hover. Drop the base to 0.5px if you want labels crisp under the cursor.  
3. Dark is not a hard default in fx-showcase.html — it still seeds from localStorage\['fx-theme'\] || prefers-color-scheme, so on a light-mode OS it opens light. The markup says data-theme="dark" but JS overrides it. One-line change if you want dark unconditional.  
Still open from the site-wide plan: the 22-row migration table is ready, blocked on your call for whether docs/topics/rate-limiter.html gets migrated (which decides whether docs/theme.css gets extracted at all).  
Add this implementation at the end of the planner file -  
What beautiful-mermaid Teaches &amp; What to Implement on Your Site

Core Insights from the Library

Feature	beautiful-mermaid Approach	Your Current Gap

Theming	CSS custom properties (--bg, --fg, --accent, etc.) on &lt;svg&gt; — live switching via CSS cascade, no re-render	Hardcoded mermaid.initialize({theme:"dark"}) + full re-render on theme toggle

Color system	2-color foundation (bg+fg) → everything derived via color-mix(); optional 5 enrichment colors override specific elements	Single theme:"dark" string, no customization

Rendering	Fully synchronous — zero flash, works with useMemo(), no await	Async mermaid + startOnLoad:false + manual render calls

Diagram types	6: Flowchart, State, Sequence, Class, ER, XY Charts (bar/line/combined)	Only basic flowcharts used across 586 fences

Shiki integration	fromShikiTheme() extracts diagram colors from any VS Code theme automatically	No code/diagram theme sync

ASCII output	Unicode/ASCII rendering for terminals, CLI tools, markdown fallback	None

linkStyle	Inline edge styling: linkStyle 0 stroke:#f00,stroke-width:2px	Not used

Concrete Implementations for Your Site

1. Replace mermaid-cli with beautiful-mermaid in build pipeline

# Replace @mermaid-js/mermaid-cli

bun add beautiful-mermaid shiki  # shiki for theme extraction

Then in scripts/build-site.mjs:

import { renderMermaidSVG, THEMES, fromShikiTheme } from 'beautiful-mermaid'

import { getSingletonHighlighter } from 'shiki'

// At build time: render ALL 586 fences to SVG strings

// Pass CSS variables for live switching:

const svg = renderMermaidSVG(code, {

  bg: 'var(--diagram-bg)',

  fg: 'var(--diagram-fg)',

  accent: 'var(--diagram-accent)',

  transparent: true,

})

2. CSS variable theme switching (fixes your re-render bug)

/* In your global CSS */

:root {

  --diagram-bg: #1a1b26;

  --diagram-fg: #a9b1d6;

  --diagram-accent: #7aa2f7;

  --diagram-muted: #565f89;

}

[data-theme="light"] {

  --diagram-bg: #ffffff;

  --diagram-fg: #1f2328;

  --diagram-accent: #0969da;

  --diagram-muted: #59636e;

}

/* SVG inherits automatically — zero JS re-render on toggle */

3. Unify code + diagram themes via Shiki

// One theme source of truth

const highlighter = await getSingletonHighlighter({ 

  themes: ['tokyo-night', 'github-light'] 

})

// Code highlighting theme

const codeTheme = highlighter.getTheme('tokyo-night')

// Diagram theme — derived from SAME theme

const diagramColors = fromShikiTheme(codeTheme)

// Pass to renderMermaidSVG(diagram, diagramColors)

4. Add XY Charts for System Design pages

Your system design guides can now render actual charts inline:

xychart-beta

    title "Latency vs Throughput"

    x-axis \[100, 500, 1k, 5k, 10k\] 

    y-axis "Latency (ms)" 0 --&gt; 200

    line \[12, 18, 35, 89, 156\]

    bar \[5000, 4800, 4200, 2100, 800\]

Beautiful-mermaid renders these with dot-grid, rounded bars, smooth splines — Apple/Craft aesthetic.

5. ASCII fallback for markdown/CLI

import { renderMermaidASCII } from 'beautiful-mermaid'

// In your markdown processor: if SVG fails or for RSS/email

const ascii = renderMermaidASCII(code, { useAscii: false })  // Unicode boxes

// Embed in &lt;pre&gt; for zero-JS contexts

6. Mono-mode custom themes per guide section

// Minimal 2-color theme per guide

const guideThemes = {

  'system-design': { bg: '#0d1117', fg: '#e6edf3', accent: '#4493f8' },  // github-dark base

  'leetcode-patterns': { bg: '#1e1e2e', fg: '#cdd6f4', accent: '#cba6f7' },  // catppuccin-mocha

  'interview-prep': { bg: '#282c34', fg: '#abb2bf', accent: '#c678dd' },  // one-dark

}

7. linkStyle for visual emphasis in flowcharts

graph TD

  A[Request] --&gt; B{Auth}

  B --&gt;|Valid| C[Process]

  B --&gt;|Invalid| D[401]

  linkStyle 0 stroke:#22c55e,stroke-width:3px  %% happy path green

  linkStyle 1 stroke:#ef4444,stroke-width:2px  %% error path red

Migration Priority Order

Priority	Task	Effort	Impact

P0	Swap renderer in build-site.mjs to beautiful-mermaid + CSS variables	~2 hrs	Fixes theme-toggle re-render; enables all below

P1	Add Shiki theme extraction → unified code/diagram theming	~1 hr	Consistent aesthetics across guides

P2	Enable XY Charts in system-design markdown files	~30 min	Real charts, not just box diagrams

P3	Add ASCII output for CLI/terminal docs view	~20 min	Bonus: works in terminal, RSS, email

P4	Curate per-guide mono themes (2 colors each)	~1 hr	Distinct visual identity per section

What NOT to Over-Engineer

- Don't build a custom theme UI — 15 built-in + Shiki covers 99%

- Don't add diagram editing — your content is static markdown

- Don't wrap in React components — build-time SVG strings are faster

- Don't re-implement color-mix() logic — the library does it

Bottom Line

One swap (mermaid-cli → beautiful-mermaid in build-site.mjs) + CSS variables solves your re-render bug AND unlocks: live theme switching, XY charts, Shiki sync, ASCII fallback, linkStyle, 15 themes, and mono-mode — all with zero runtime cost.

Want me to implement the P0 swap in your build pipeline?
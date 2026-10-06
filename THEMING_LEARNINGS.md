# Theming Migration & Architectural Learnings

This document captures critical learnings and edge cases discovered during the attempted migration of dynamic theming and cursor effects (from `fx-showcase.html`) into the core documentation site (`docs/index.html`). Any future agent attempting to modify the UI, theming, or build pipeline should read this first.

## 1. Content Security Policy (CSP) Strictness
* **The Constraint:** The project enforces a strict Content Security Policy defined in `vercel.json`. It pins the exact `sha256` hashes of any inline `<script>` blocks found in `docs/index.html`.
* **The Trap:** If you add new inline scripts (e.g., for a settings modal or cursor tracking loop) or modify existing ones, the browser will block them, and the `npm run verify` check will fail.
* **The Solution:** Whenever `docs/index.html` inline scripts are modified, you **must** run `node scripts/refresh-csp-hash.mjs --write`. This will recalculate the hashes and update `vercel.json` automatically.

## 2. Build Pipeline Dependencies & Goldens
* **The Constraint:** Running `npm run build` directly on a fresh clone (or in a CI/Vercel environment) will **fail** with a `ManifestMissingError` or missing goldens error.
* **The Trap:** The site relies on trace files (`judge/traces/*.json`) that are deliberately `.gitignore`d to save repository space.
* **The Solution:** The correct sequence to build the site locally or for deployment is `npm run build:deploy`, which safely runs `npm run gen:blocks && npm run gen:traces && npm run build`. Ensure `npm install` has been run first to fetch required dependencies like `quickjs-emscripten`.

## 3. Cursor Trapping (Accessibility & Usability)
* **The Constraint:** The `fx-showcase.html` uses `cursor: none !important` globally to hide the system cursor and replace it with a custom `requestAnimationFrame` follower.
* **The Trap:** Applying this globally to `docs/index.html` prevents users from seeing the I-beam (`text`) cursor over the heavy `.prose` Markdown content, making text selection incredibly frustrating. It also leaves sticky blobs on mobile/touch screens.
* **The Solution:** 
  1. Restrict custom cursors to non-touch devices using `@media (hover: hover) and (pointer: fine)`.
  2. Use a CSS `:not(:has(...))` exclusion to restore the system cursor over text and code. Example:
     ```css
     html:not(:has(.prose p:hover)):not(:has(pre code:hover)) * { cursor: none !important; }
     ```

## 4. Third-Party Theming (Prism & Mermaid)
* **Prism.js:** The syntax highlighter is hardcoded to a dark theme (`prism-tomorrow.min.css`). CSS variables won't automatically fix its colors. If implementing a Light Mode, you must use JS to dynamically swap the `<link>` tag's `href` between `prism-tomorrow.min.css` and `prism.min.css`.
* **Mermaid.js:** `docs/chat-widget.js` initializes Mermaid charts with hardcoded hex colors (e.g., `primaryTextColor: '#E9EDF4'`). These must be updated to use CSS variables like `var(--text)` and `var(--surface)` so charts respect the active theme without needing a full re-render loop.

## 5. CSS `color-mix()` Tokenization
* Converting static `rgba(148, 163, 184, 0.15)` alphas into dynamic `color-mix(in srgb, var(--text-muted) 15%, transparent)` works beautifully across the codebase.
* **Warning:** When doing global Regex replacements for hardcoded hex codes (like `#0A0D13` or `#E9EDF4`), ensure you use word boundaries (`\b`) to avoid accidentally corrupting SVG paths, UUIDs, or random hashes in the codebase that might happen to contain those 6-character strings.

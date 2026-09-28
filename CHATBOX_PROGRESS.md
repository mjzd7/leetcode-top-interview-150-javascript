# Context-Aware Chatbox — Development Progress Log

**Status:** IN PROGRESS
**Started:** 2026-09-28
**Branch:** `salmon`
**Plan sources:** `chatbox_integration_plan.md`, `chatbox_execution_plan.md`, `chatbox_execution_plan_improvements.md`

> This file is the durable handover record. **Append** to it after every task. Do not rewrite
> sections that are already marked DONE — add new notes under the current task instead.

---

## How To Read This File

| Section | Purpose |
|---|---|
| `## Current State` | One-line status + what to do next. Read this first. |
| `## Architecture Decisions` | Deviations from the plan and *why*. Non-obvious — read before editing. |
| `## Task Log` | Per-task: what was done, decision taken, verification evidence. |
| `## Test Results` | Every test run, verbatim result counts. Append-only. |
| `## Blockers & Setup` | Things only the owner can do. |
| `## Landmines` | Traps discovered in this codebase. |

---

## Current State

**CODE COMPLETE. `npm run verify` exits 0.** All 12 workstreams from the plan are done and
verified. Nothing is in progress.

| Suite | Result |
|---|---|
| `npm run validate` | Scanned: 150 problem files, 0 errors |
| `npm test` | 450 syntax blocks, 828 runtime assertions, 0 failures |
| `npm run test:judge` | 64 assertions, 0 failures |
| `npm run test:chat` | 119 assertions, 0 failures (hermetic — 0 outbound calls) |
| `npm run test:e2e` | 34 passed, 2 skipped (viewport-gated) |
| `npm run build` | 175 modules bundled |
| `npm run test:chat:live` | skips cleanly (no `OPENAI_API_KEY` in `.env.local` yet) |

**Nothing is committed.** All work is unstaged in the working tree. See "Before you deploy".

**The single most important fact for any new agent:** `scripts/build-site.mjs` does **NOT**
generate `docs/index.html`. It only writes `docs/curriculum-data.js`. `docs/index.html` is a
hand-maintained, committed, single-page app. All CSS/HTML/JS for the portal lives in that one
file. The plan's instructions to "update the build script to inject HTML/CSS" are based on a
false premise — see D-2.

**The single most important fact for any new agent:** `scripts/build-site.mjs` does **NOT**
generate `docs/index.html`. It only writes `docs/curriculum-data.js`. `docs/index.html` is a
hand-maintained, committed, single-page app. All CSS/HTML/JS for the portal lives in that one
file. The plan's instructions to "update the build script to inject HTML/CSS" are based on a
false premise — see D-2.

---

## Architecture Decisions

### D-1 — Route is `api/chat.mjs`, not `api/chat/index.js`
The plan says `/api/chat/index.js`. The repo convention is flat `.mjs` routes plus a shared
`api/_lib/` module folder (`api/judge/run.mjs` → `/api/judge/run`; `api/auth/me.mjs` →
`/api/auth/me`). `api/chat.mjs` → `/api/chat` and matches. All modules are ESM (`.mjs`)
because `package.json` has `"type": "module"`.

### D-2 — Portal integration goes in `docs/index.html`, NOT `scripts/build-site.mjs`
`scripts/build-site.mjs` (108 lines) does exactly two things: scan `NN-*` markdown dirs into
`curriculum`, and write `window.CURRICULUM_DATA = [...]` to `docs/curriculum-data.js`
(gitignored, rebuilt in CI). It never reads or writes `docs/index.html`. The plan's Tasks 4.1/4.2
("update the build script to inject HTML scaffolding before `</body>`") cannot be executed as
written. Editing a committed hand-written file from a generator would also be a regression:
the next `npm run build` would fight the edit.

**Decision:** chat CSS, HTML scaffolding, and script tag are edited directly into
`docs/index.html`, alongside the existing inline `<style>` and `<script>` blocks. The widget
logic itself lives in a **new separate file** `docs/chat-widget.js` (see D-3) so it stays
reviewable and does not bloat the already-923-line `index.html`.

### D-3 — Widget is an IIFE in `docs/chat-widget.js`, not an ES module
Plan allows either. IIFE chosen:
- `docs/index.html` uses inline `onclick="openArticle(...)"` attributes which *require* real
  globals; mixing a deferred `type="module"` script into that lifecycle invites ordering bugs.
- The site loads `marked`, `mermaid`, `Prism`, `KaTeX` as **globals** via CDN. An IIFE reads
  `window.marked` / `window.DOMPurify` naturally.
- Encapsulation is still achieved: the IIFE exposes exactly one namespace, `window.LtChat`,
  and no other globals. It registers a `DOMContentLoaded` hook itself.

### D-4 — Rate limiter reuses already-configured Upstash env vars
Plan says "add Upstash". `vercel env ls` shows `KV_REST_API_URL` / `KV_REST_API_TOKEN` already
provisioned for Production/Preview/Development — Vercel KV *is* Upstash Redis over REST.
`REDIS_URL` and `KV_URL` also exist. The limiter prefers `UPSTASH_REDIS_REST_URL`/`_TOKEN` if
someone adds them, then `KV_REST_API_*`, then `REDIS_URL`/`KV_URL`, and **always** layers an
in-memory limiter as a floor so a misconfigured deploy is still limited (just per-instance).
Per improvements-doc §2.3, in-memory alone is useless on serverless — hence Upstash first.

### D-5 — Origin allowlist enforced in the handler, mirrored in `vercel.json`
Improvements-doc §2.5 asks for `vercel.json` CORS headers. `vercel.json` `headers` are
**static strings** — they cannot read env, cannot allow `*.vercel.app` preview deployments, and
would break local `vercel dev`. A hardcoded production origin also breaks every Preview deploy.
So: the real, dynamic, testable check lives in `api/chat.mjs` via `checkOrigin()` (env-driven
allowlist, plus `Referer` fallback per improvements-doc §3.2), and `vercel.json` gets the
*static* hardening headers (`X-Content-Type-Options`, `Cache-Control: no-store`) which are safe
everywhere. Same-origin requests carry no `Origin` on same-origin navigation, so this cannot
break the production site.

### D-6 — Chat is anonymous (IP rate limited), NOT login-gated
`/api/judge/run` requires a session (`getSession`). Chat deliberately does **not**. Requiring
GitHub login would break the widget for anonymous readers, and the plan never asked for auth —
it asked for IP rate limiting, which is the abuse control for a public reader-facing feature.
Decision recorded so nobody "fixes" this later by adding a 401.

### D-7 — `tiktoken` is lazy-loaded with a heuristic fallback
Verified empirically: `tiktoken@1.0.22` (WASM) loads fine on Node 26.5.0. But WASM decode on
a cold serverless start is a real latency/fragility cost, and a WASM failure must never 500 the
endpoint. `api/_lib/chat-tokens.mjs` therefore lazy-imports the encoder once per instance and
falls back to a `ceil(chars/4)` estimator if the import throws. The budget is enforced either
way; only its precision degrades. Plan called for strict 4000-token budget — kept, in tokens,
not characters (improvements-doc §3.5).

### D-8 — System prompt is built in a separate, unit-testable module
`api/_lib/chat-prompt.mjs`. Reason: the most important invariant of this feature is
"**`pageContext` never appears in the `messages` history array**" (execution plan Task 2.2
"Crucial"). That is a property of a pure function, so it can be asserted in
`scripts/test-chat.mjs` rather than eyeballed in the route.

### D-9 — `marked` is NOT an npm dependency
Already loaded from CDN at `docs/index.html:35`. Installing it would create a dead dependency
(improvements-doc §1.2). `dompurify@3` **was** added to the same CDN block.

---

## Current Architecture

```
Browser
  docs/index.html  ── dispatches `lt150:article` CustomEvent {id,title,category} on openArticle()
  docs/chat-widget.js  (IIFE → window.LtChat)
      · extractPageContext()  reads #articleContent / .prose, strips widgets+whitespace
      · state: {messages:[]}  persisted to sessionStorage["lt150-chat-v1"]
      · fetch('/api/chat') with AbortController; reads SSE via TextDecoder + buffer
      · render: marked → DOMPurify (per-assistant-message, only on complete text)

Server
  api/chat.mjs                      route: 405 / 403 / 429 / 400 / 503 / 200
      ├─ _lib/chat-security.mjs     checkOrigin, sanitizeContext, rateLimit
      ├─ _lib/chat-trompt.mjs       buildChatRequest (system + trimmed history)
      └─ _lib/chat-tokens.mjs       countTokens, buildWindow (sliding window)
  → OpenAI chat.completions  { stream: true }
  → raw SSE piped through to the client (text/event-stream)
```

**SSE contract (server → client):** upstream OpenAI SSE is forwarded byte-for-byte
(`data: {...}` / `data: [DONE]`), **except** that a mid-stream failure emits a synthetic
`data: {"error":"..."}` frame rather than a bare JSON body — per improvements-doc §3.3, never
mix a JSON object into a live SSE stream. Pre-stream failures are ordinary JSON HTTP errors.

**Env vars consumed (all optional; endpoint degrades with a clear 503/429 rather than crashing):**
`OPENAI_API_KEY`, `AI_BASE_URL` (default `https://api.openai.com/v1`), `AI_MODEL`
(default `gpt-4o-mini`), `CHAT_ALLOWED_ORIGINS`, `UPSTASH_REDIS_REST_URL/_TOKEN` or
`KV_REST_API_URL/_TOKEN` or `REDIS_URL`/`KV_URL`.

---

## Task Log

### ✅ T0 — Discovery, dependency install, env verification
- **Done:** verified `tiktoken@1.0.22` loads on Node 26.5.0; `vercel env ls` (project
  `leetcode-top-interview-150-javascript`, `prj_jTgHf3QjLRnsq389UE9iRPGjiBbf`); confirmed
  `docs/index.html` is hand-maintained (D-2); installed `openai @upstash/ratelimit
  @upstash/redis dotenv tiktoken`; added `dompurify@3` CDN tag to `docs/index.html`.
- **Decision:** installed `dotenv` per plan but the route reads `process.env` directly — Vercel
  injects env natively and `dotenv` is only useful for local dev. Kept as a dev convenience.
- **Evidence:** `npm install` → "added 7 packages, and audited 208 packages in 7s";
  `vercel env ls` → 8 env vars found, **no `OPENAI_API_KEY`** (see Blockers).

### ✅ T1 — `api/_lib/chat-tokens.mjs` (token budget + sliding window)
- **Done:** `countTokens` (lazy tiktoken + heuristic fallback), `truncateToTokens` (head 70% /
  tail 30% with an explicit `[... elided ...]` marker), `normaliseHistory`, `buildWindow`
  (count-then-message two-stage trim, always keeps the newest user turn, never opens on an
  assistant turn), `resetEncoderCache` test seam.
- **Decision:** the elision is **marked**, not silent — a head+tail join with no marker would
  make the model believe the two halves are adjacent (improvements-doc §3.1 "lossy truncation").
- **Evidence:** covered by 15 assertions in `scripts/test-chat.mjs`.

### ✅ T2 — `api/_lib/chat-security.mjs` (origin, injection, rate limit)
- **Done:** `clientIp`, `allowedOrigins`, `checkOrigin`, `sanitizeContext`, `rateLimit`,
  `resetLimiterCache`.
- **Decisions worth remembering:**
  - **Wildcard matching is anchor-anchored.** `*.vercel.app` matches
    `https://prj-42-abc.vercel.app` but **not** `a.vercel.app.evil.com` and not
    `https://evil.com/?x=https://a.vercel.app`. Both are asserted.
  - **Header-less requests are allowed on purpose.** Rejecting them would break CI, the E2E
    suite and server-to-server callers while stopping no real attacker (a `curl` attacker can
    forge or omit `Origin` freely). The cost control is `rateLimit()`.
  - **The scrubber is code-safe.** The guides are full of JS like `{ user: 'alice' }`, so a
    naive `user:` strip would corrupt real content. `ROLE_TURN` only matches when the value is
    **not** a quoted string, so object literals survive. Asserted explicitly.
  - **Both rate-limit layers always run and both must allow.** Upstash (already-configured
    `KV_REST_API_*`) is the distributed truth; the in-memory map is a floor so a misconfigured
    deploy is still limited. A `rediss://` TCP URL is rejected as a REST endpoint rather than
    half-configured.
- **Evidence:** 40 assertions.

### ✅ T3 — `api/_lib/chat-prompt.mjs` (system prompt + request assembly)
- **Done:** `buildSystemPrompt`, `buildChatRequest`. Context is sanitised → token-trimmed →
  embedded → **then** `systemTokens` is measured and reserved before the history window is
  sized. Doing this in the other order is how endpoints silently exceed budget.
- **Key invariant (asserted, not just documented):** `pageContext` appears in
  `messages[0].content` and in **no** other message.
- **Evidence:** 20 assertions including 2 independent proofs of the above invariant
  (pure-function level and wire level).

### ✅ T4 — `api/chat.mjs` (route + streaming)
- **Done:** 405 → 403 → 429 → 400 → 503 guards, then SSE: `text/event-stream`, `no-store`,
  `X-Accel-Buffering: no` (Nginx buffers by default, which silently defeats streaming),
  `flushHeaders()`, heartbeat comments every 10s, total-time deadline, client-disconnect
  abort, structured JSON logs, and mid-stream failure emitted as a `data: {"error":...}` frame.
- **Two real bugs found and fixed during testing (see Landmines L-1, L-2).**
- **Evidence:** 24 assertions with a stubbed provider, delivering SSE in 7-byte fragments so
  tokens straddle chunk boundaries exactly as on a real network.

### ✅ T5 — `scripts/test-chat.mjs` (unit suite)
- **Done:** 116 assertions, zero dependencies, non-zero exit on failure — mirrors
  `scripts/test-judge.mjs` so it drops into the existing `verify` chain.
- **Hermeticity:** stubs `globalThis.fetch` for every streaming test. Verified no real network
  call is made (see B-4).

### ✅ T6 — `docs/chat-widget.js` + `docs/index.html` wiring (frontend)
- **Done:** IIFE widget exposing only `window.LtChat`. Pure `extractPageContext()` (clones
  `#articleContent`, strips `script/style/svg/button/.mermaid/.copy-btn`, collapses
  whitespace, marks its own elision, never throws). Per-article history in `sessionStorage`.
  SSE reader with a `\n\n` frame buffer + `TextDecoder({stream:true})`. `AbortController` wired
  to "Stop generating". `marked.Renderer.code` injects the copy button. `DOMPurify` sanitises
  assistant markdown; user text is always escaped. Focus trap, Escape, `aria-live="polite"`,
  auto-scroll that yields when you scroll up, empty/typing/error/retry states, first-token
  watchdog (25s), and specific messages for 429/403/503.
- **Layout decision:** the panel is a **flex sibling of `<main>`**, so on `lg+` it is a real
  380px column in the existing flex row (the plan asked for exactly this) and below `lg` it
  becomes a `72dvh` bottom sheet behind a 56px FAB. One DOM element, CSS-driven, no
  `body.class` hacks and no layout maths.
- **Streaming-render decision (improvements-doc §4.2):** during a stream the assistant bubble is
  `textContent` only; `marked` + `DOMPurify` run once on completion. This sidesteps DOMPurify
  eating half-typed tags (`<st` → stripped), avoids re-parsing markdown on every token, and is
  XSS-safe *during* streaming rather than only at the end.
- **Event bridge:** `openArticle()` now dispatches `lt150:article`. The widget does **not**
  depend on it — it re-reads the URL hash, which `openArticle` keeps authoritative — so a
  dropped event costs a stale header label, not a wrong context.
- **Evidence:** see T8 + the QA section.

### ✅ T7 — Fixed a pre-existing tooling bug (found while running the suite)
`npm run verify` was **red in this working tree before any chatbox code existed**: 154 validate
errors and 22 runtime failures. Not caused by this feature.

Root cause: `scripts/validate-guide.mjs` and `scripts/test-runner.mjs` both call `scan(ROOT_DIR)`
and walk the **entire repo**, treating any `.md` not named `*PLAN*`/`*README*` as a curriculum
guide. The tree contains untracked agent artifacts — `hyperplan_report.md`,
`api_exploration_report.md`, `chatbox_execution_plan_improvements.md` (lowercase "plan" fails
the case-sensitive `PLAN` check), `scratch/summary_*.md` — all of which fail the 6-section
schema. `scripts/build-site.mjs` only scans `NN-*` dirs, so the three scripts disagreed.

**Fix:** added `scratch` to `SKIP_DIRS` in both scanners and skipped loose root-level `.md`.
Curriculum always lives in a directory, so this is lossless — proven, not assumed: a pristine
`git worktree` at HEAD and the fixed tree both report **Scanned: 150 problem files, 450 syntax
blocks, 828 runtime assertions, 0 failures**. The only tracked root `.md` files are
`README.md` and `MASTER_PLAN.md`, both already name-skipped.

### ✅ T8 — `tests/chatbox.spec.js` + `playwright.config.mjs` (E2E)
- **Done:** 17 tests × 2 viewports (desktop 1440×900, Pixel 7) = 34 runs. Covers context
  payload + the no-leak invariant, pure/bounded `extractPageContext`, SSE accumulation,
  byte-level fragmentation, markdown + copy button + XSS, Stop/abort, suggestion chips,
  sessionStorage persistence, 429/403/503/500 error recovery, mid-stream error frames,
  unreachable API, bottom-sheet + focus trap + Escape, and article-switching.
- **Config:** `webServer` runs `npm run build && npx serve@14 -l 4173 docs`. The build is
  required because `docs/curriculum-data.js` is gitignored — without it the portal renders
  the "No curriculum data found" empty state and every test would pass vacuously.
- **Decision:** the fragmentation test drives `LtChat.readSse` with a synthetic
  `ReadableStream` cutting the wire at **3-byte slices**, because Playwright's `route.fulfill`
  delivers a body in one piece and cannot fragment a response. That is why `readSse` is on the
  `window.LtChat` seam.

### ✅ T9 — Config & CI (`vercel.json`, `package.json`, `deploy.yml`, `.env.example`, `.gitignore`)
- `vercel.json`: `headers` for `/api/chat` (CORS + `no-store` + `nosniff`) and `/api/(.*)`.
  All pre-existing keys byte-identical. **No CSP** — the portal loads from five CDNs, so
  `default-src 'self'` would break it.
- `package.json`: `test:chat`, `test:chat:live`, `test:e2e`; `verify` now runs
  `validate && test && test:judge && test:chat && test:e2e && build`.
- `deploy.yml`: +`Run Chat Backend Unit Tests` (after `test:judge`), +`Install Playwright
  Browsers`, +`Run Chat Widget E2E Tests` (after `build`, before `Setup Pages`). 10 → 13 steps.
  The workflow does **not** call `verify`, so it stays secret-free.
- `.env.example`: created. **Was silently gitignored** by `.gitignore`'s `.env*` rule — added
  `!.env.example`. Verified: template committable, `.env.local` still ignored, and the secret
  is absent from `git add --dry-run`.

### ✅ T10 — `scripts/test-chat-live.mjs` (real-provider smoke test)
- **Deliberately NOT in `verify` and NOT in CI.** It costs money and needs a secret.
- Skips cleanly (exit 0) when `CI` is set or `OPENAI_API_KEY` is absent. The guard runs
  **before** the route is imported so the skip path cannot depend on the code it skips.
- Uses a real guide file (`05-hashmap/06-two-sum.md`) as `pageContext` so the budget and
  grounding are exercised realistically.
- Confirms the no-leak invariant before spending a call, then asserts 200 + SSE + non-empty
  answer + exactly one `[DONE]` + no error frame, and prints the first 700 chars.

### ✅ T11 — Visual QA (screenshots, defects found and fixed)
Evidence: `scratch/qa/{desktop,mobile}-{1-empty,2-answer,3-error}.png` (gitignored).
Reviewed each image rather than assuming. **Three real defects found this way:**

1. **Markdown lists had no bullets.** Tailwind's CDN preflight resets
   `ul, ol { list-style: none; margin: 0; padding: 0 }`. My CSS restored margins but not
   `list-style`, so every list rendered as loose indented paragraphs. Fixed with
   `list-style: disc/decimal outside` + `li::marker` in the accent colour.
2. **Copy button overlapped the first line of code.** Fixed by reserving a top strip
   (`padding-top: 1.85rem`) on `.chat-code pre`.
3. **Typing-indicator dots stuck after an error.** `failTurn()` calls `renderLog()`, and three
   call sites invoked it **before** `setStreaming(false)` — so the render saw
   `state.streaming === true` and painted dots on an already-finished turn, with no later
   render to clear them. Fixed in all three (outer catch, `readSse` onError, first-token
   watchdog). This was invisible to every functional assertion until a human looked at a
   picture of the error state.

_(append new tasks below)_

---

## Test Results

Append-only. Newest at the bottom.

| # | Command | Result | Notes |
|---|---|---|---|
| 1 | `npm install openai @upstash/ratelimit @upstash/redis dotenv tiktoken` | ✅ added 7 packages, 0 vulnerabilities | puppeteer postinstall warning is pre-existing |
| 2 | `node -e "tiktoken get_encoding('cl100k_base')"` | ✅ 14 tokens | confirms D-7 fallback is belt-and-braces |
| 3 | `node scripts/test-chat.mjs` (run 1) | ❌ 1 fatal | `TypeError: head.replace is not a function` — see L-1 |
| 4 | `node scripts/test-chat.mjs` (run 2) | ❌ 88/90 | 2 fails; revealed a real env leak — see B-4, L-2 |
| 5 | probe: `openai@7` `Stream` shape | ✅ `Stream` | keys `iterator`,`controller`; **no `.body`** — see L-2 |
| 6 | probe: `toReadableStream()` payload shape | ✅ | SSE payload lines **without** `data: ` prefix; `[DONE]` consumed |
| 7 | `node scripts/test-chat.mjs` (run 3) | ❌ 114/115 | test assertion was wrong, not the code |
| 8 | `node scripts/test-chat.mjs` (run 4) | ✅ 116/0 | backend complete |
| 9 | `npm run verify` (first full pass) | ✅ exit 0 | but log showed 5 real 401s — my hermeticity claim was wrong |
| 10 | `node scripts/test-chat.mjs` (hermeticity fix) | ✅ 119/0, **0 outbound** | kill-switch + non-vacuous assertions |
| 11 | `npx playwright test` (1st run) | ❌ 34 failed | `SyntaxError: Unexpected token '.'` in the widget — L-4 |
| 12 | `npx playwright test` (2nd run) | ❌ 26 failed | found the production-breaking payload bug — L-5, L-6 |
| 13 | `npx playwright test` (3rd run) | ❌ 4 failed | FAB covered the Send button on mobile — L-7 |
| 14 | `npx playwright test` (4th run) | ❌ 2 failed | test-flow bugs (modal backdrop, reload resets sheet) |
| 15 | `npx playwright test` (5th run) | ✅ **34 passed, 2 skipped** | |
| 16 | mutation check (revert 1 ordering fix) | ✅ **test failed** `Received: 1` | proves the regression test is not vacuous |
| 17 | `npm run verify` (FINAL) | ✅ **exit 0** | 150 files · 828 assertions · 64 judge · 119 chat · 34 e2e · 175 bundled |
| 18 | `npm run test:chat:live` (no key) | ✅ skipped, exit 0 | clean skip confirmed |
| 19 | `CI=true npm run test:chat:live` | ✅ skipped, exit 0 | refuses to spend in CI |
| 20 | `git check-ignore .env.example` | ✅ not ignored | `!.env.example` works; `.env.local` still ignored |
| 21 | visual QA — 6 screenshots | ✅ reviewed | 3 defects found, all fixed and re-verified |
| 22 | `curl /v1/models` with the provided key | ✅ HTTP 200, **242 models** | none are OpenAI's → `AI_MODEL` is mandatory |
| 23 | `npm run test:chat:live` (router, `auto`) | ✅ **8/8 assertions, 0 failures** | 200 + SSE + one `[DONE]`, 6.0s, correct grounded answer |
| 24 | `vercel env add` × 9 (3 vars × 3 envs) | ✅ added | confirmed via `vercel env ls` + `env pull` |
| 25 | `vercel env pull` | ✅ all 3 present in production | secrets come back as `[SENSITIVE]` (presence, not value) |
| 26 | `npm run test:chat:live` (post-Vercel, same values) | ✅ 8/8 again | reproducible across two runs |
| 27 | direct probe of 8 strong models | ⚠️ 3 OK, 5 cooling down | gateway free tier, ~24h cooldowns — see B-8 |

**Final state: `npm run verify` → exit 0, zero outbound network calls. Provider configured in
Vercel on all three environments and proven working by a live call.**

---

## Blockers & Setup

### ✅ B-1 — RESOLVED: provider credentials are configured in Vercel
The provider is **not OpenAI**. It is a self-hosted FreeLLMAPI router:
`https://mjzd7freellmapi.duckdns.org/v1` (OpenAI-compatible `/v1/chat/completions`).
Set via CLI on 2026-09-28, on **all three** environments (production, preview, development):

| Variable | Value |
|---|---|
| `OPENAI_API_KEY` | `freellmapi-…` (encrypted; the router's bearer key) |
| `AI_BASE_URL` | `https://mjzd7freellmapi.duckdns.org/v1` |
| `AI_MODEL` | `auto` |

Verified with `npm run test:chat:live` against those exact values: **8/8 assertions pass**,
200 + SSE + exactly one `[DONE]`, ~6s latency, and a correct grounded answer. To read them back
for debugging use `vercel env pull <file> --environment=production` (Vercel returns
`[SENSITIVE]` placeholders for secrets, so this confirms presence, not value).

**Why `AI_BASE_URL` and `AI_MODEL` are both mandatory here:** the router serves **242 models and
none of them are OpenAI's** — `gpt-4o-mini`, `gpt-4o`, `gpt-4.1-mini` and `gpt-5-mini` are all
absent. The code default is `gpt-4o-mini` (the plan's cost choice, and correct for real OpenAI),
so **omitting `AI_MODEL` here produces a confusing upstream failure rather than a clean 503.**
Owner decision on 2026-09-28: keep `auto`, configure **no model fallback chain**.

### 🔴 B-8 — The gateway is a free tier with ~24h per-model cooldowns
This is now the dominant reliability constraint, and it is **not** an intelligence problem.
Probing the strong models directly returns:

```
"All models exhausted: 1 route checked (1 rate-limited or on cooldown).
 Add more API keys or wait for rate limits to reset. Soonest reset ~24h."
retryAtMs: 1790658857986  →  2026-09-29T05:14:17Z
```

Observed working: `auto`, `kimi-k2.5`, `deepseek-v3.2`, `deepseek-v4-flash`, `llama-4-maverick`.
Observed cooling down / failing: `glm-5`, `glm-5.2`, `kimi-k3`, `kimi-k2.6`, `qwen-3.8-27b`
(empty completion from Cloudflare Workers AI), `gpt-oss-120b`, `qwen2.5-coder-32b-instruct`.

Consequences to be aware of:
- `auto` worked on both live smoke-test runs, but availability will fluctuate with the pool.
- The router's own 429s are **upstream of** our rate limiter, so `rateLimit()`'s 5/min does not
  protect against them. Today an upstream 429 reaches the user as the generic
  *"The assistant is unavailable right now. Please retry."* A rate-limit-specific message would
  be more honest; that is a small, unstarted improvement.
- If errors get frequent, the fix is **more keys on the router** (its error text says exactly
  that), not a fallback chain in our code.

_(old B-1 text retained below for history)_
`vercel env ls` originally showed `SESSION_SECRET`, `KV_REST_API_*`, `REDIS_URL`, `KV_URL`,
`GITHUB_OAUTH_*` — but **no `OPENAI_API_KEY`**. Without it `/api/chat` returned 503
`{ error: 'Chat is not configured' }`, by design.

### 🟡 B-2 — Deployment target is ambiguous (owner decision needed)
The site is deployed **twice**: GitHub Actions → GitHub Pages (`deploy.yml`, `path: ./docs`)
*and* Vercel (`vercel.json`, `outputDirectory: docs`). The plan assumes Vercel. A
GitHub-Pages-hosted frontend calling `/api/chat` needs a **cross-origin** request, which is
what `checkOrigin()`'s `CHAT_ALLOWED_ORIGINS` allowlist exists for. Default allowlist covers
the Vercel production domain + `*.vercel.app`; **add the GitHub Pages URL if that host serves
the portal.** See B-1 in `docs/chat-widget.js` for the `API_BASE` override.

### 🟢 B-3 — Local preview has no API
`npx serve docs` (README's documented workflow) serves static files, so `/api/chat` 404s. The
widget must therefore degrade to a clear "assistant unavailable" state rather than a silent
failure. This is a required behaviour, not an oversight.

### 🟡 B-4 — A real `OPENAI_API_KEY` sits in `~/.zshrc`
It is exported in the user's personal shell config (59 chars, prefix `freellm…`). It is **not**
in `.env.local`, **not** in the repo, and **not** in `vercel env ls` — so production is still
unconfigured (B-1 stands), but any locally-run code that reads `process.env.OPENAI_API_KEY` will
make **billed real API calls**. This bit the first test run, which fired 5 real requests before
the rate limiter stopped it.

**Rules that follow from this:**
- `scripts/test-chat.mjs` stubs `globalThis.fetch` for every streaming test and restores it in
  `finally`. Never delete the real key from the shell to make a test pass — that silently
  changes the developer's environment.
- If you add tests, keep them hermetic. The backend never needs a live key to be verified.
- The key format suggests a third-party gateway rather than an OpenAI key. If the intent is a
  specific provider, set `AI_BASE_URL` accordingly; the route supports it but nothing sets it
  today.

### 🟡 B-5 — PRE-EXISTING BUG: a whole guide is missing from the portal
`docs/24-maang-guides/06-google-interview-prep.md` is a **tracked** guide (added by the most
recent commit `c3b9ea0`) but it is **never bundled**. `scripts/build-site.mjs`'s `GUIDE_DIRS`
lists only `docs/modern-engineer-skills`, `docs/fresher-roadmap`, `docs/mid-level-roadmap` — not
`docs/24-maang-guides` — and the `NN-*` scan explicitly skips a dir named `docs`.

Verified: the built bundle has 175 modules, of which 5 maang guides and 17 roadmap pages, and
`google-interview-prep` is **not** among them. Root `24-maang-guides/` holds 5 files; `docs/`
holds 1. So the portal shows MAANG Guides 01–05 and silently omits 06.

**Not fixed here** — it is unrelated to the chatbox and the one-line fix (add a `GUIDE_DIRS`
entry with a dedupe guard against the root `24-maang-guides/`) deserves its own commit. Flagged
so it is not lost.

### 🟡 B-6 — PRE-EXISTING BUG: every list in the 150 guides has lost its bullets
Same root cause as L-4. `docs/index.html`'s `.prose ul, .prose ol { margin-left: 1.4rem; }`
sets margins but **not** `list-style`, and Tailwind's CDN preflight sets
`list-style: none`. So every bulleted/numbered list inside all 150 problem guides renders as
loose indented paragraphs with no markers. The chat panel was fixed (T11); the guides were not.

**Not fixed here** — the one-line change (`list-style: disc outside` on `.prose ul`,
`decimal outside` on `.prose ol`) alters the rendering of all 150 guides site-wide. That is a
product-wide visual change the owner should see and approve before it ships.

### 🟡 B-7 — PRE-EXISTING BUG: duplicate "On this page" TOC entry
In the Two Sum guide the sidebar TOC renders **"7. What Each Developer Discussion Says …" twice**
(visible in `scratch/qa/desktop-3-error.png`). The guide genuinely contains two `h2` headings
with the same text, and `renderTOC()` in `docs/index.html` keys scroll-spy on `h.id` without
deduplicating. Cosmetic, but it makes the TOC look broken. Not fixed here — same reasoning as
B-6, it is unrelated to the chat widget.

---

## Landmines

- **L-1 — `tiktoken`'s WASM `decode()` returns a `Uint8Array`, not a string.**
  The pure-JS `js-tiktoken` returns a string; the WASM `tiktoken` package does not. Caught by
  `TypeError: head.replace is not a function`. `api/_lib/chat-tokens.mjs` has a `toText()` helper
  that accepts both shapes and strips U+FFFD (slicing tokens at an arbitrary index can split a
  multi-byte character). Do not "simplify" that helper back to a bare `decoder.decode()`.

- **L-2 — `openai@7` returns a `Stream`, not a web `Response`.** There is **no `.body`**, so
  `upstream.body.getReader()` throws `Cannot read properties of undefined (reading 'getReader')`.
  Use `upstream.toReadableStream()`. Note its frames are SSE **payload lines with the `data: `
  prefix already stripped and `[DONE]` consumed**, so the route re-frames each line and appends
  its own `[DONE]`. The `for await (… of upstream)` path yields pre-parsed objects and would
  cost us the ability to heartbeat while the provider is silent. There is a generator fallback
  in `payloadStream()` if the SDK shape ever changes again.

- **L-3 — the provider client is memoised, so env changes don't take effect.**
  `providerClient()` caches its promise. That is correct in production (env is immutable per
  instance) but it made the 503-unconfigured path untestable — an earlier request's client
  survived `delete process.env.OPENAI_API_KEY`. `resetProviderClient()` is the seam. **Call it
  in any new test that toggles `OPENAI_API_KEY`.**

- **`docs/curriculum-data.js` is gitignored.** A fresh clone has no curriculum data and the
  portal renders "No curriculum data found. Run `npm run build`." Any Playwright test that
  expects real problem content must build first (`webServer.command` in
  `playwright.config.mjs` does this).
- **`node_modules` is not in `.vercelignore`'s concern but is in `.gitignore`** — the Vercel
  install runs `npm install` per `vercel.json.installCommand`, so the new backend deps will be
  installed there automatically. No action needed.
- **CI runs Node 20; local is Node 26.5.0.** `tiktoken`'s WASM must work on both. It loads on
  26 (verified); Node 20 is the lower bar and is fine, but the E2E step in `deploy.yml` must
  install browsers with `--with-deps` or CI will fail on missing libs.
- **`package.json` already lists `@playwright/test` and `playwright` in devDependencies** but
  there was **no `playwright.config.*` and no `tests/` dir** before this work. So `npm ci` in
  CI already pulls Playwright; only the browser binaries are missing.
- **`docs/index.html` is 923 lines with `openArticle()` defined *after* its first call site**
  (`<button onclick="openArticle(...)">` in the header at line 169) — it works only because
  the call happens on user interaction, not at parse time. Don't move the chat bootstrap
  earlier than DOMContentLoaded or you may hit the same class of ordering bug.
- **`api/_lib/kv.mjs` establishes the house style for degradation:** functions return
  `{ ok: false }` and callers must never fail user-visible flows. The chat limiter follows
  this, but inverts the direction: for a *rate limiter* the safe failure is to fall back to a
  weaker (in-memory) limit, not to no limit.

- **L-4 — Tailwind's CDN preflight silently strips list markers.** `cdn.tailwindcss.com`
  injects preflight, which resets `ul, ol { list-style: none; margin: 0; padding: 0 }`. Any
  markdown list rendered anywhere on this site loses its bullets unless `list-style` is
  restored explicitly. Caught only by looking at a screenshot — every functional assertion
  passed. **This is still broken in `.prose ul`/`.prose ol` in the main article (see B-6);** the
  chat panel was fixed, the guides were not.

- **L-5 — the outgoing history must be snapshotted before the assistant placeholder is pushed.**
  The widget pushes an empty `{role:'assistant'}` turn, then builds the request body. Including
  it makes the **last message an empty assistant turn**, and the route requires the final
  message to be a non-empty user turn — so the very first message a user ever sends would have
  returned 400 in production. A mocked `/api/chat` hides this completely, because the mock
  accepts any body. The `outgoing` array in `send()` is the fix.

- **L-6 — `stop()` had to release the UI on *both* abort paths.** Aborting during `fetch`
  (before the first byte) rejects at the `await fetch(...)` and lands in the outer `catch`;
  aborting mid-stream rejects inside `readSse`. The original outer `catch` ignored
  `AbortError` entirely, so pressing Stop before the first byte left the input permanently
  disabled. Both paths now call `setStreaming(false)`.

- **L-7 — the mobile FAB covered the Send button.** `.ltc-fab` is `bottom: 1rem; right: 1rem`
  and `.ltc-send` is bottom-right inside the sheet. `elementFromPoint` at the Send button's
  centre returned `BUTTON#ltcFab` — the mobile chat was unusable. The FAB now gets
  `.is-tucked` (opacity 0 + `pointer-events: none`) while the sheet is open. **Any future
  floating button needs the same check against the sheet's controls.**

- **L-8 — `renderLog()` must run *after* `setStreaming(false)`.** `failTurn()` renders, and
  three call sites called it first, so the render saw `state.streaming === true` and left the
  typing dots painted on a finished turn with no later render to clear them. Mutation-tested:
  reverting one of the three makes the E2E assertion fail (`Received: 1`). **The ordering is
  load-bearing and there is nothing at the call site to signal that.**

- **L-9 — Playwright's `route.fulfill` cannot fragment a response.** It delivers the body in
  one piece and then completes, so a "never-ending stream" mock is impossible. To hold a
  request open you must `await` a timer *inside the route handler* before fulfilling. To test
  arbitrary chunk boundaries you must drive `LtChat.readSse` with a synthetic
  `ReadableStream` — which is the only reason that function is on the `window.LtChat` seam.

---

## Before You Deploy

1. ~~**Add the key.**~~ **DONE** — `OPENAI_API_KEY`, `AI_BASE_URL` and `AI_MODEL` are set in
   Vercel on production, preview and development, and proven by a live call (B-1, B-8).
2. **Set `CHAT_ALLOWED_ORIGINS`** if the portal is served from GitHub Pages (B-2). This is the
   one remaining thing that will 403 the widget in production.
3. ~~**Run the real smoke test locally first.**~~ **DONE** — `npm run test:chat:live` passes
   8/8 against the real router with the exact Vercel values.
4. **Nothing is committed.** Review the diff before staging — in particular
   `scripts/validate-guide.mjs` and `scripts/test-runner.mjs` (T7), which fix a pre-existing
   bug and touch shared tooling.
5. **Three pre-existing product bugs are knowingly unfixed** (B-5, B-6, B-7). They are not part of
   this feature and deserve their own commits.

---

# Improvement Backlog & Plan (round 2)

Requested 2026-09-28. Two workstreams: **UI/layout** (A–E) and **algorithm visualisation**
(V1–V3, grounded in the Firecrawl research). Nothing in this section is implemented yet.

## Where the layout stands today (verified, not assumed)

| Thing | Current state |
|---|---|
| Outer row | `.flex.items-start` = `[sideOverlay, sidebar, main, ltcPanel]` — chat **is** a 4th child |
| Inner row (in `main`) | `.flex … max-w-6xl mx-auto` = `[article, TOC aside]` |
| TOC | `hidden xl:block w-56 shrink-0 sticky top-6` — only ≥1280px, 224px wide |
| Chat rail | appears ≥1024px at a fixed `flex: 0 0 380px` |
| 1024–1280px band | chat visible, **no TOC** |
| Scroll-spy | already works (IntersectionObserver over `h2`) — A is presentation-only |
| Resize | none; no drag handle |
| Left nav | no desktop collapse (mobile off-canvas only) |
| Tables in chat | **zero CSS** |
| Render seam | `marked.parse(src,{renderer})` → `DOMPurify.sanitize` → `innerHTML`; `marked.Renderer.code` already intercepts every block |

## Decisions needed from the owner (block A, B, C, E)

1. **Rail-width coupling.** Once the chat sits under the TOC (B), "chat width" *is* "rail
   width" — the TOC stretches with it. Accept that, or pin the TOC at 224px and grow only the
   chat? *Assumption if unanswered: accept coupling, simplest and keeps a single drag handle.*
2. **The 1024–1280px band.** Rail must appear much earlier for the chat to live in it. Propose:
   rail from `lg` (1024px), **TOC** hidden below `xl` as today. *Assumption: this.*
3. **Collapse affordance.** TOC — hover-expand or click-toggle? Left nav — icon rail (~56px) or
   fully hidden? *Assumption: click-toggle for both, state persisted in `localStorage`; icon
   rail for the nav because it keeps the module list reachable.*
4. **Article floor.** How narrow may the article get before the rail should clamp instead?
   *Assumption: rail clamps to 320–720px, article never squeezed below ~420px.*

## Workstream 1 — UI / layout

| ID | Task | Depends on | Risk |
|---|---|---|---|
| **D** | Tables readable in chat: `.ltc-table-scroll` wrapper + compact table CSS | — | low |
| **V1** | `~~~mermaid` branch in the chat code renderer | — | low |
| **V2** | `~~~viz-array` cell-grid renderer | — | low |
| **E** | Left nav collapse (full → icon rail) | decision 3 | low |
| **A** | TOC collapses to current topic, live-updating | decision 3 | low |
| **B** | Move chat out of the 4th column into the rail, under the TOC | decisions 1, 2 | **high** |
| **C** | Resize rail by dragging its left edge | B | medium |

**Order: D → V1 → V2 → E → A → (B + C together).** B and C ship as one change: resizing a rail
that does not exist yet is meaningless, and doing them separately means the layout is broken
twice. Each step gets a screenshot check, not just a green suite.

### D — tables in chat
- **Why post-process, not a `marked.Renderer.table`:** the article already wraps tables in
  `.table-scroll` after render (`enhanceCodeBlocks`). Mirroring that keeps one pattern, and a DOM
  walk also catches raw `<table>` HTML the model emits, which DOMPurify legitimately allows.
- **Change:** after `body.innerHTML = …` in `messageNode()`, wrap each `table` in
  `<div class="ltc-table-scroll">`; add CSS for `.ltc-msg-body table/th/td`.
- **Style:** `font-size: .78rem`, `border-collapse: collapse`, 1px `--line` borders, `th` in
  accent on a faint accent wash, zebra `tbody tr:nth-child(even)`, first column left-aligned and
  `--muted`, `overflow-wrap: anywhere` so long cells wrap instead of exploding the rail.
- **Verify:** new E2E asserts the wrapper exists, a wide table does not overflow the panel
  (`scrollWidth` of the bubble ≤ panel width), and header/row text is present. Screenshot.

### V1 — Mermaid in chat
- `~~~mermaid` → `<div class="mermaid">` with the source **escaped** as text content.
- Call `mermaid.run({ nodes: [newNode] })` for just the new node — the article's existing
  `mermaid.run()` re-renders every `.mermaid` on the page, which is wrong here.
- `securityLevel: 'strict'` for chat (the article uses `'loose'`; chat content is model-authored
  and unreviewed). Wrap in try/catch: invalid syntax shows the source, never breaks the bubble.
- Re-initialise `mermaid` once; do not re-`initialize` per message.

### V2 — `~~~viz-array` cell grid
- Same seam as V1: `marked.Renderer.code` inspects the info string, so a `viz-array` block is
  never treated as a code block.
- Payload (defensive, all fields optional):
  `{"title":…,"cells":[{"v":2,"label":"nums[0]","state":"active|swapped|done"}],"pointers":[{"i":1,"label":"j"}],"map":[["2",0]],"set":[3]}`
- Render: CSS-grid boxes for `cells`; a pointer row of labels aligned under the cells; `map` as
  key→value pills; `set` as value pills. Reuse `--accent`, `--line`, `--muted`.
- **Fallback is mandatory:** any parse/shape error renders the raw source in a normal
  `~~~json` block. A broken viz must degrade to "here is the JSON", never an empty bubble.
- No new dependency, no React — the site is vanilla with CDN libs only.

## Workstream 2 — correct visualisation (the differentiator)

### V3 — instrument the guide's own code instead of narrating it
**Research finding (Firecrawl, 2026-09-28):** the two mainstream approaches are *execute &
instrument* (AlgoInsight, USACO, LeetCode's own visualizer) and *narrate via LLM* (Claude
Artifacts, ChatGPT Canvas). **No product found** using LLM-narrated in-chat visualisation as
its primary approach. For a study tool this matters more than prettiness: a confidently wrong
diagram teaches the wrong algorithm.

The pieces are already in this repo: `api/_lib/sandbox.mjs` (QuickJS, already runs untrusted JS
for `/api/judge/run`) and 828 runnable assertions across the guides.

- **Shape:** inside the sandbox, wrap `Array.prototype` index methods and `Map`/`Set` mutators to
  record state per step → emit a trace → feed the V2 renderer. The picture then *cannot*
  disagree with the code, because it is the code running.
- **Biggest item here.** Needs its own plan once V2's payload shape is proven.
- **Prompt hint for V1/V2 meanwhile:** every guide already has an *"Edge Case Matrix"* section,
  so ask the model to visualise that exact table (empty / single / duplicate / overflow).

## Streaming constraint (applies to V1–V3)

Verified via research: **partial JSON cannot be parsed mid-stream.** Waiting for the complete
document means a spinner; the common "complete the incomplete JSON" fix is **O(n²)** — it
reparses from character zero each chunk, imperceptible to ~3.4KB then visibly janky past ~5KB.

**Decision: v1 streams prose only and renders a visualisation when its block completes.** No
incremental JSON parser is built. Revisit only if V3 streams traces chunk-by-chunk.

Also: `response_format: json_schema` is **not** assumed to work — `AI_MODEL=auto` routes across
242 models and schema enforcement cannot be relied on. V1/V2 use fenced JSON with a tolerant
parser, and viz requests should drop temperature toward 0 (today's `0.2` is tuned for prose).

## Known regression to absorb

`renders the assistant in the viewport-appropriate surface` asserts panel `width > 300` and
right-edge anchoring — that is the 4th-column layout and **will fail by design** after B. It
gets rewritten to assert the new contract (chat inside the rail, below the TOC; resizable).
Mobile sheet, focus-trap and Escape tests key off `.ltc-panel` / `.is-open` and should survive.

---

# Improvement Backlog — Delivery Log (round 2, part 1)

D, V1 and V2 shipped on 2026-09-28. A, B, C, E remain **held** on the owner's four layout
decisions (see "Decisions needed" above). E2E went from 34 → 46 passing with zero regressions.

## ✅ D — tables readable in the chat

- `enhanceTables()` in `docs/chat-widget.js` wraps every `table` in `.ltc-table-scroll` after
  DOMPurify, mirroring the article's own `.table-scroll` approach and also catching raw
  `<table>` HTML the model emits.
- CSS: mono `.78rem`, `border-collapse: collapse`, accent `th` on a faint accent wash, sticky
  first column in `--muted` (the row-label), zebra rows, `nowrap` on cells so numeric columns
  stay scannable.
- **Measured:** a 9-column dry-run trace is 457px wide inside a 380px rail; the **wrapper**
  scrolls (`overflow-x: auto`) and the bubble's own `scrollWidth` never exceeds `clientWidth`.
  Before this, a wide table would have stretched the rail.
- Evidence: `scratch/qa/table-in-chat.png`.

## ✅ V1 — Mermaid diagrams inside chat bubbles

- ` ```mermaid ` is intercepted in `marked.Renderer.code` and becomes
  `<div class="mermaid ltc-mermaid">` with the source **escaped**. It deliberately does **not**
  get the copy button: a diagram is a picture, not source.
- Rendered via `mermaid.run({ nodes })` scoped to the new nodes only, with
  `securityLevel: 'strict'` — see L-10 for why that matters.
- Evidence: `scratch/qa/mermaid-good.png` (358px-tall dark flowchart), and
  `scratch/qa/mermaid-broken.png` for the degraded path.

### L-10 — Mermaid signals a parse failure with an *error SVG*, not a throw
A bad graph made Mermaid inject `<svg aria-roledescription="error">` that collapses to zero
height, **without throwing**. The first fallback only checked "is there an `svg`?", so the error
SVG satisfied it and the user got a blank box where the diagram should be.

Two further consequences: Mermaid **overwrites** the node's contents, so the source is only
readable *before* the call (hence `sources` is captured up front); and the first version of the
"broken diagram" E2E test passed *vacuously* because prose around the block survived anyway.
Both are fixed, the test now asserts the fallback really appears, and it is
mutation-verified (reverting the error-svg check fails it).

## ✅ V2 — ` ```viz-array ` cell grid

- `renderViz()` in `docs/chat-widget.js` turns a JSON payload into cells, pointer markers, a Map
  row and a Set row. Reuses `--accent` / `--line` / `--muted`; no new dependency.
- **Fallback is mandatory and tested:** unparseable JSON, a non-object, an empty `cells` array,
  or >40 cells all return `null`, and the caller falls back to an ordinary code block so the
  reader still sees the payload. A malformed viz must never produce an empty box.
- **Escaping:** every interpolated value goes through `esc()`. The `state` class is constrained
  to `/^[a-z-]{1,12}$/i` so it can never become attacker-chosen markup, and the only value that
  becomes part of an attribute is a clamped `Number()` used for grid placement.
- E2E asserts cell order, `is-active`/`is-done`, pointer label + `data-at`, map/set counts, and
  that `<b>bold</b>` survives as *text* while no `b`/`img` element is created.

### L-11 — two CSS grids with the same `grid-column` will drift apart
The first implementation put cells and pointers in **separate** grids. Each sized its own tracks
from its own content — the cell row was `min-width: max-content` (wider than the rail) while the
pointer row was laid out across the container — so identical `grid-column` values landed at
different x positions. `data-at` was correct the whole time; the label for index 1 rendered
**116px** away, under the wrong cell.

Every DOM assertion passed. It was caught only by comparing bounding boxes in a screenshot
script, and by *looking* at the image. Fixed by collapsing cells and pointers into **one**
`.viz-grid` (row 1 / row 2, column count from `--viz-cols`), so track widths match by
construction. The E2E suite now asserts the geometry (`≤2px` centre offset) and is
mutation-verified: a +1 column shift produces a 77px offset and fails the test.

**Generalisable lesson for B/C:** any drag-resized rail or collapsible column will have the same
class of bug. Assert positions, not just attributes.

### L-12 — `data-at` must speak the payload's language
An early version stored the 1-based CSS `grid-column` in `data-at`, so the attribute said cell
`2` when the payload's `i` was `1`. Indices in attributes and in the JSON are 0-based; only CSS
placement is 1-based. Keep them in separate places.

## Test matrix (appended)

| # | Check | Result |
|---|---|---|
| 28 | item D: dry-run table test, red first | ✅ failed at the wrapper assertion, table itself present |
| 29 | item D: full E2E after implementation | ✅ 36 passed, 2 skipped |
| 30 | item D: measured overflow | ✅ 457px table in 380px rail; wrapper scrolls, bubble does not |
| 31 | V1: mermaid renders + no copy button | ✅ red first, then green |
| 32 | V1: **broken** mermaid shows source | ✅ strengthened after finding it passed vacuously |
| 33 | V1: mutation check (drop error-svg check) | ✅ test failed → assertion is real |
| 34 | V1: full E2E | ✅ 40 passed, 2 skipped |
| 35 | V2: cells/pointers/map/set/XSS/fallback | ✅ red first, then 3 green |
| 36 | V2: pointer geometry | ✅ 116px → **0px** after the single-grid fix |
| 37 | V2: mutation check (+1 column shift) | ✅ 77px offset, test failed → guard is real |
| 38 | full E2E after V2 | ✅ **46 passed, 2 skipped**, no regressions |
| 39 | `node --check` on all touched JS | ✅ clean |

## Not yet done

- **A, B, C, E** — held pending the owner's four layout decisions.
- **V3** — instrumenting the guide's own code in QuickJS so visualisations cannot disagree with
  the algorithm. The biggest remaining item; needs its own plan once the `viz-array` payload
  shape has proven itself in real use.
- **Prompt wiring.** Nothing yet tells the model that ` ```viz-array ` and ` ```mermaid ` are
  available. Until that lands, the renderers are reachable but the model will not emit them.
  This is the next cheap, high-value step.

---

# 🔴 Round-2 Finding: middle-elision destroys the canonical answer

**Found by live-provider testing, not by the unit suite.** Found 2026-09-28.

## What happened

Asking the live model *"Walk me through the optimized single-pass pass … and show the array
state"* returned no diagram, and the reply said why:

> "The guide's current text shows Level 2: Two-Pass Hash Map and **elides the later
> single-pass section**, but the problem overview already demonstrates the single-pass
> complement-lookup idea (check before insert)"

The model detected its own context was incomplete and answered honestly rather than
hallucinating. **That is the system working** — and it is the only reason the defect surfaced.

## Root cause, verified not inferred

`truncateToTokens()` in `api/_lib/chat-tokens.mjs` keeps **head 70% + tail 30%** and elides
the middle. For a 11,657-char guide trimmed to 1,893 tokens:

| Term | In full guide | Survives the trim |
|---|---|---|
| `Level 3` | yes | **no** |
| `canonical` | yes | **no** |
| `single-pass` | yes | **no** |
| `single pass` | yes | yes |
| `complement` | yes | yes |

Every guide is structured *Level 1 brute → Level 2 optimized → Level 3 canonical*, and the
middle-elision is precisely where **Level 3** lives. So the truncation reliably removes the
canonical solution to any "what is the optimal approach" / "walk me through" question — which
is the single most common question this widget exists to answer.

## Why 126 unit assertions missed it

They assert that truncation *happens*, that head and tail are retained, and that the elision is
marked. None assert that the **relevant** part survives. The invariant was never wrong as
written; it was the wrong invariant.

## Proposed fix (needs a decision, not yet implemented)

Keep head + tail for shape, but add the **section most relevant to the question**. The guides
are uniformly delimited by `## ` headings and the server already has the user's question in
`history` at the point `buildChatRequest` runs, so:

1. Split the guide into `## ` sections.
2. Score each section against the question's keywords.
3. Keep head + best-scoring section + tail; mark every elision explicitly.
4. When nothing scores, behave exactly as today.

Tradeoff to weigh: this spends a little more of the 4,000-token budget on the matched section,
which means slightly less tail. Alternative — and arguably better for a study tool — is to keep
head + the **Level 3 / canonical** section always, since that is the answer readers most want,
rather than trying to guess from keywords.

## Related: emission is reliable

3/3 direct live calls emitted a well-formed `viz-array` whose payload parsed against the
renderer schema (cells `[2,7,11,15]`, two in-range pointers, `map: [["2",0]]`, `set` omitted —
confirming optional-field handling). The one browser miss was this context defect, not the
renderer.

---

# ✅ Round-2 item: relevance-scoped truncation (fixes the 🔴 finding)

The 🔴 finding above is now **fixed and verified end-to-end**. Approach taken: the option I
recommended — relevance-scoring, not always-keep-Level-3.

## What shipped

- **`truncateRelevant(text, maxTokens, query, model)`** in `api/_lib/chat-tokens.mjs`. Splits the
  guide into sections, scores each against the reader's own question, and keeps the opening
  section, the closing section, and as many query-relevant middle sections as the budget allows —
  reassembled **in document order** with every gap marked.
- **`buildChatRequest` now passes the last user message as the query.** That is the whole fix: the
  reader's question decides which sections survive.
- **The answer outranks orientation.** The best-matching section is reserved *before* the
  opening/closing sections are considered, so a tight budget spends itself on the answer rather
  than on the title/metadata preamble. Verified: at a 400-token budget on a 7-section guide the
  canonical section survives and the problem overview does not.

## Two further bugs found while fixing it

### L-13 — the elision marker's token cost was guessed, not measured
`truncateToTokens` reserved `max(8, 6% of budget)` for the marker, but `ELISION_MARKER` actually
costs **13 tokens**. A 100-token budget therefore produced **105** tokens, and 200 produced 201.
A budget that overshoots is not a budget. Now measured via `markerTokenCost()`; verified to
respect the budget at 8 different sizes for both truncators.

### L-14 — the context is NOT markdown, so the splitter silently disabled itself
This is the subtler one. The direct-API probe passes raw markdown, where headings read
`## 4. Level 3`. The **browser sends `extractPageContext()` output**, which is `textContent` of
the *rendered* article — 16,951 chars containing **zero** `##`. Section titles arrive as bare
`4. Level 3` lines.

So the first version of the fix parsed fine in the probe and **did nothing in production**,
while every markdown-shaped test passed. Only a real browser run exposed it. `findHeadings()` now
recognises both shapes and tells a numbered *heading* from a numbered *list item* by trailing
punctuation ("1. Outer loop picks an index." is prose; "1. Problem Overview" is a title).

Generalisable: **test with the same bytes the server will actually receive.** A unit test fed
hand-written markdown is testing a payload production never sends.

## Verification

- **The exact question that produced the bug report now works.** It previously answered *"the
  guide's current text … elides the later single-pass section"*; it now returns a correct
  walkthrough plus a `viz-array`.
- **Real browser, real API, real model, no mocks:** 4 cells `[2,7,11,15]`, active cell `7`, map
  pair rendered, pointer at **0px** alignment.
- Backend suite 116 → **153** assertions, 0 failures. E2E **74 passed, 2 skipped**.
  `npm run verify` → **exit 0**, 0 outbound calls.

---

# ⚠️ Concurrent-writer incident (not my work, recorded for the next agent)

While the truncation fix was in progress, `tests/chat-streaming.spec.js` appeared in `tests/`
(untracked, first seen 12:10, then modified 12:19 and 12:27) and **`docs/chat-widget.js` grew
from 753 to 1,572 lines** with features I did not write: a streaming caret, progressive reveal,
content-derived suggestion chips, icon send/stop controls, and a live context status.

**My code was not clobbered** — `renderViz`, `renderMermaid`, `enhanceTables`, the `viz-array`
renderer, `is-tucked`, and the L-8 fix are all still present and all 46 of my own tests pass.

### The failure cascade was contamination, not regression

`npm run verify` failed with 10–17 E2E failures that moved between runs and produced **zero
timeouts**. Root cause: the error was
`browserContext.close: ENOENT … test-results/.playwright-artifacts-*/traces/…` — Playwright's own
**trace teardown**, i.e. two concurrent Playwright runs sharing one `test-results/` output
directory and one static server on port 4173. Clearing the stale artifacts and waiting for the
other writer to settle gives **exit 0, 74 passed, 2 skipped**.

### One real regression *I* caused, and fixed
Adding `test-results/` to `.gitignore` was not enough: `validate-guide.mjs` and
`test-runner.mjs` walk the tree independently of git, so Playwright's generated
`error-context.md` pages were validated as curriculum guides — `Scanned: 151 problem files`
instead of 150. Both `SKIP_DIRS` sets now include `test-results` and `playwright-report`. Baseline
restored to 150.

**Lesson for whoever works here next:** this tree is being written to concurrently. Before
trusting a red suite, check for a second writer and stale Playwright artifacts, and prefer
`--workers=1` for a deterministic read.

---

# 🔴 INCIDENT: uncommitted work was reverted, then redone per item

At **13:30:38** an external process restored `docs/index.html`, `tests/chatbox.spec.js`
and this file to HEAD. `git status` went completely clean and ~500 lines of finished,
**verified** layout work vanished: the rail, the resizer, the nested TOC and the nav
collapse, plus 12 tests. No stash, no checkout in the reflog, no new commit — the tree
was simply made byte-identical to HEAD. Three `opencode` processes were live (39599,
89723, 90698).

**What survived:** everything already committed — the truncation fix (`truncateRelevant`,
`findHeadings`, `markerTokenCost`), `api/chat.mjs`, the three `_lib` modules,
`docs/chat-widget.js`, `scripts/test-chat.mjs`, and this file up to line 944.

**Root cause was mine:** the work existed only in the working tree. The fix was to
commit per item, so a restore can no longer take it.

| Commit | Item |
|---|---|
| `ce214b2` | B — right rail (TOC + chat), article 404px → 660px |
| `c4321d0` | A — one-liner page navigation |
| `4dd77c2` | C — resizable rail |
| `f11c5c7` | E — two-stage nav collapse |

# ✅ Item A, second pass: the one-liner page navigation

"On this page" listed all nine `h2`s with the current one merely highlighted. It is now
a **single row naming the section in view**, which opens that section's sub-headings.

**Decisions taken (owner-confirmed):** slide track `0fr→1fr` for the section swap plus a
25ms stagger on expand; a section the reader opened by hand stays open; children hang off
an indent guide line.

### The conflict that needed resolving
"Stay expanded until you collapse it" conflicts with "one-liner by default". Resolution:
the one-liner is *only* the current section; a section explicitly opened is rendered
open beneath it. The one-liner never takes a second role.

### Side effect worth knowing
Each `h2` now owns its `h3`s, so the **32 subsections per guide became reachable**. The
old flat TOC could not link to them at all.

### Three bugs found while building it
- **`markActive` auto-opened the active section**, carried over from the previous
  "expand the section in view" design. The one-liner must stay collapsed.
- **`grid-template-rows: 0fr` only sizes the first explicit row.** With several children
  the rest became auto rows, so the panel never collapsed. The 0fr trick needs exactly
  one inner wrapper.
- **The `-72px` top `rootMargin` was wrong.** The sticky header is a *sibling* of the
  scroller, not an overlay on it, so the scroller already starts below the header — the
  offset excluded headings at `y=0`, which is exactly where `scrollIntoView` puts them.
  Separately, jumping to a subsection never promoted its owning section, so the
  one-liner went stale. Both fixed; the observer now takes the *topmost* heading of each
  kind rather than whichever the observer batched last.

### Verification
`npm run verify` → **exit 0**, 0 outbound calls. 150 files · 828 runtime · 64 judge ·
153 chat · **90 E2E passed / 16 skipped** · 175 modules. Screenshots in `scratch/qa/`:
`F1-oneliner-collapsed`, `F2-oneliner-expanded`, `F3-nav56-iconrail`.

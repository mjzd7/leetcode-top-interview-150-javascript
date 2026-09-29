# Chat System Hardening — Scrutiny & Revised Plan

**Scope:** adversarial review of the revised plan (the 5 sections covering Mermaid, math,
data-structure visuals, truncation, and chat persistence), checked line-by-line against the
actual `salmon` tree, plus the changes required to make it safe.

**Verdict:** 2 of 5 sections are directionally right and mechanically wrong; 1 is built on a
false premise about the current code; 1 optimizes a non-problem while missing a real silent-
failure bug; 1 diagnoses an inverted cause and prescribes a harmful "fix". Two P0 issues that
outrank everything in the plan are not in it at all.

**Baseline (verified 2026-09-28, branch `salmon` @ `ead33a0`):**
`npm run test:chat` → 278 assertions, 0 failures. 42 e2e tests in `tests/chatbox.spec.js`,
19 in `tests/chat-streaming.spec.js`. All quoted line numbers are from this tree.

---

## 0. Section verdicts

| § | Section | Verdict | One-line reason |
|---|---------|---------|-----------------|
| 1 | Mermaid rendering | **Keep, fix mechanically** | Rule is right; the plan's own example contradicts it, and the "streaming thrashing" edge case is already solved. |
| 2 | Math / KaTeX | **Reject the fix, replace it** | The stated cause is false and the prescribed deferral *creates* the snap in this codebase. |
| 3 | Data-structure visuals | **Half keep** | Recursion→call-tree is right; the 5×5 ellipsis rule destroys DP dry-runs. |
| 4 | Truncation | **Reject the fix, keep the conclusion** | Wrong arithmetic, no evidence of the symptom, and it misses silent truncation. |
| 5 | Persistence | **Reject the premise, downgrade the tool** | The described bug does not exist; the tool choice trades a sync read path for nothing. |
| 6 | Auth (requirement) | **Already satisfied — harden, don't add** | GitHub OAuth is the sole login path, by explicit decision `MASTER_PLAN.md:308`. Four real gaps remain, none of them "add another provider". |

---

## 1. False premises — the plan describes a codebase it is not in

These matter more than any single edge case, because two of them are the basis for whole
sections.

### 1.1 §5 invents a broken persistence layer that works

> *"Update the `saveStore()` function (which currently seems to do nothing or relies on
> volatile state)"*

There is no `saveStore()`. Persistence is implemented, working, and covered by tests:

- `docs/chat-widget.js:43` — `STORAGE_KEY = 'lt150-chat-v1'`
- `docs/chat-widget.js:409` — `readStore()`
- `docs/chat-widget.js:421-424` — `sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store))`
- `docs/chat-widget.js:430-436` — per-guide thread restore on open
- `docs/chat-widget.js:438-448` — `clearCurrent()`, deletes the guide's entry
- `tests/chatbox.spec.js:517` — *"keeps the thread across a reload and clears on request"*
- `tests/chatbox.spec.js:656` — *"switching guides swaps the thread and the panel label"*

**Consequence:** §5 is a rewrite of working, tested code based on a guess. Anything it
proposes must be re-derived from the real functions, not from the plan's description of them.

### 1.2 §5 misnames the actual limitation

The real gap is not "no persistence" — it is that **`sessionStorage` is per-tab and dies when
the tab closes**. That is the whole problem, and it is one line away from fixed.

### 1.3 §1's "Streaming Thrashing" is already architecturally solved

> *"Running Mermaid during the stream causes severe layout reflows and browser lag."*

The reveal already separates a **stable prefix** from a **live tail**:

- `docs/chat-widget.js:878-896` — `stableSplit()` finds the last blank line, and is
  fence-aware (it will not split inside a ``` block)
- `docs/chat-widget.js:943-960` — `paintReveal()` re-renders markdown **only** when that
  stable boundary moves (once per paragraph, not per frame); the tail is a single
  `textContent` write
- `docs/chat-widget.js:712` — `renderMermaid()` is called from `messageNode()`, i.e. on
  settled messages, **never per chunk**

So Mermaid is not re-parsed during the stream. The plan's own §1.2 says "keep the current
design" — the instinct is right, the reasoning is not, and the plan does not know what it is
preserving.

### 1.4 §4's budget formula is a category error

> *"`remainingBudget = MAX_TOTAL_TOKENS - totalTokens` … `max_tokens = min(remaining, 4096)`"*

`MAX_TOTAL_TOKENS` (12,000 — `api/_lib/chat-tokens.mjs:25`) is the **prompt** budget, enforced
in `buildChatRequest` (`api/_lib/chat-prompt.mjs:170-177`). `max_tokens` is the **completion**
budget. Subtracting one from the other is meaningless. Worse, it is a no-op in disguise: with
a real request the metadata reports `systemTokens: 968, historyTokens: 6, totalTokens: 974`
(observed in the `chat.completed` log), so `min(12000 - 974, 4096) = 4096` — a constant. The
"dynamic" computation resolves to the same number on every request the system will ever see.

The plumbing is easy (`prepared.meta.totalTokens` is already available at `api/chat.mjs:427`)
but **the formula must be deleted, not ported.**

---

## 2. §2 Math — the diagnosis is inverted and the fix is harmful

### 2.1 "Partial tags crash KaTeX" — false

`renderMathInElement` with `throwOnError: false` does not throw on a partial expression, and
auto-render only fires on *matched* delimiters. The portal already passes that exact config
(`docs/index.html:1293-1294`). There is no crash to prevent.

### 2.2 "Defer to end-of-stream to avoid the snap" — this *creates* the snap

The plan prescribes: *"Inject `renderMathInElement` inside `messageNode()` … apply it only to
the solidified text when the stream completes."*

But the reader watches the **prefix** re-render once per paragraph for the whole stream
(`chat-widget.js:951-956`). If math is typeset only in `messageNode()`, then every paragraph
containing `$…$` shows raw LaTeX during the stream and snaps at turn end — for *every*
paragraph, not once at the end. That is strictly worse than the behaviour the plan is trying
to prevent.

**The correct fix falls out of the existing architecture:** run `renderMathInElement` on the
stable prefix node, at the same cadence as `renderMarkdown(prefix)`. Paragraph-stability
guarantees a `$…$` pair inside the prefix is already closed, so:

- math typesets as each paragraph settles — no snap, because there is nothing left to change
- the live tail stays plain `textContent`, so a partial `$` **never reaches KaTeX at all** —
  the "crash" the plan fears is structurally impossible, and for a different reason
- one call, reusing the exact options already proven in `docs/index.html:1283-1295`

### 2.3 The "prefer Unicode over LaTeX" prompt rule should be rejected

> *"For simple complexities … prefer standard Unicode plain text (e.g., `O(N log N)`)"*

- **Unverifiable.** No test can assert a model's stylistic preference; it will be honoured
  until it isn't.
- **A product regression.** The entire corpus is LaTeX-authored and the portal renders it
  (README: *"KaTeX math"*). Chat would become typographically inconsistent with the guides it
  is meant to complement. `O(N log N)` in Unicode is *worse* output than `O(N \log N)`.
- **It treats a symptom the correct fix removes.** Once math renders on the stable prefix,
  there is no snap left to suppress.

### 2.4 The real double-escaping hazard, which the plan misses

The plan attributes mangling to marked/DOMPurify. Neither touches backslashes. The actual
hazard is **`ignoredTags`**: the portal passes `['script','noscript','style','textarea','pre','code']`
(`docs/index.html:1293`) specifically so template literals like `` `${\`r${r}\`}` `` are never
parsed as math. The widget has no math renderer today, so it has no such config — **adding
one naively will typeset JS template literals into broken math.** That is a real, testable
regression the plan creates.

---

## 3. §4 Truncation — real risk misidentified; the actual bug is invisible

### 3.1 No evidence truncation is occurring

Model is `gpt-4o-mini` (`api/_lib/chat-prompt.mjs:19`, `.env.example:18`). Current completion
ceiling is 2,000 tokens (`api/_lib/chat-tokens.mjs:34`) ≈ 1,500 words. The prompt already says
*"Keep answers short enough to read on a phone"* (`api/_lib/chat-prompt.mjs:110`). The plan
raises the ceiling to 4,096 to fix a symptom nobody has measured.

### 3.2 What the raise actually costs

This is an anonymous, unauthenticated endpoint limited only per-IP at 5 req/min
(`api/_lib/chat-security.mjs:39-40`, decision D-6 in `CHATBOX_PROGRESS.md`). The tool loop can
run 3 rounds (`MAX_TOOL_ROUNDS = 3`, `chat-tokens.mjs:47`), so one request can drive three
model turns at the raised ceiling. On gpt-4o-mini pricing that is roughly **$0.012/request**,
≈ **$3.8/hour per IP** at the rate limit, of which the raise contributes ≈ half. The plan
presents this as a correctness fix and does not state the exposure.

### 3.3 The bug the plan misses: truncation is currently undetectable

`runTurn()` returns `{ cut: false, calls }` (`api/chat.mjs:339`) and never reads
`finish_reason`. When the provider hits the 2,000-token ceiling, the client receives a
silently truncated answer that is indistinguishable from a complete one — no affordance, no
log field, no way to measure the rate.

**Raising headroom without reading `finish_reason` halves the rate of a bug nobody can see.**
Detection first; headroom second, decided from the measured number.

### 3.4 What the plan gets right, and the one refinement

Abandoning client-side auto-continue is correct. But the stated reason is half wrong: a second
request gets a *fresh* 60s budget, so it would not 504 any differently than the first. The
real killer is what the plan also says — mid-fence corruption plus a filler preamble.

If continuation is ever wanted, the safe form is **server-side, inside the existing request**:
`api/chat.mjs:343` already loops turns under `deadline` and `toolRoundReserveMs()` (`:355`), so
a follow-up turn can be issued only when enough budget remains, with an explicit
"emit only the continuation, no preamble" instruction. That is a defensible design the plan
does not consider.

### 3.5 "Never exceed 500 words" is not a truncation control

Unverifiable as stated, and it directly fights §3: a 5×5 DP table plus explanation is already
~200 words. Demote to soft guidance. Prefer **structural** budgets, which the prompt partly
has already: *"at most one diagram"* (`chat-prompt.mjs:136`), *"at most a short JS snippet"*
(`:104-105`).

---

## 4. §1 / §3 — what to keep, what to change

### 4.1 §1 Mermaid: keep the rule, fix the contradiction

The quoting rule is correct and additive. But **the plan's rule contradicts the prompt's own
example**, which uses unquoted labels today:

- `api/_lib/chat-prompt.mjs:118-120` — `A[outer loop picks i] --> B{complement already seen}`

A model pattern-matches the example. Fixing the rule while leaving the example unquoted makes
the rule roughly a coin flip. The `< 15 nodes` cap is also consistent with existing
constraints (`"about 12 cells or fewer"`, `chat-prompt.mjs:131`; 40-cell hard cap at
`chat-widget.js:523`).

The `.ltc-mermaid-error` label is a good, small addition — with the caveat that the fallback
`<pre>` already exists (`chat-widget.js:496-499`) and needs a **test**, not just CSS. There is
a `scratch/qa-mermaid.mjs`, which suggests this was probed manually and never automated.

### 4.2 §3: keep recursion guidance, reject the 5×5 ellipsis rule

- **Keep:** recursion → call tree over `sequenceDiagram`. Correct and genuinely useful.
- **Reject:** *"Limit tables to max 5×5. Use ellipses (…) for larger grids."* 2D DP grids are
  the core of this curriculum (`17-multi-dp` = 9 guides, `04-matrix` = 5). Ellipsizing a 6×6
  DP table destroys the exact dry-run content the reader came for. Bound it (≤ 8×8) and prefer
  `viz-array` rows; do not ellipsize.

---

## 4.5 Auth — GitHub-only is already the architecture; the gaps are elsewhere

**Requirement: GitHub login, and no other login mechanism of any kind.**

**Status: already satisfied.** Not by omission — by explicit decision and existing code:

| Requirement | Where it is satisfied |
|---|---|
| GitHub is the only provider | `api/auth/login.mjs:27` builds a `github.com/login/oauth/authorize` URL. No other provider string exists anywhere in `api/`, `docs/index.html`, or `package.json`. |
| No third-party auth library | `package.json` deps are `openai`, `tiktoken`, `dotenv`, `quickjs-emscripten`, `@upstash/*`. Auth is hand-rolled on `node:crypto`. |
| No alternate identity path | No `openid`/`oidc`, no `user:email`, no password, no magic-link, no cookie import, no social providers. |
| Locked by decision | `MASTER_PLAN.md:308` — *"D2 \| Login via GitHub OAuth only \| Only standards-supported login available. No LeetCode login exists; no cookie import, ever."* |
| Minimal scope | `scope: 'read:user'`, `allow_signup: false` (`api/auth/login.mjs:25-26`) — identity only, no repo/gist/org access. |
| Token discarded | `api/auth/callback.mjs:83-86` — GitHub token is dropped after reading the id; only `githubId` + `login` are stored. |
| CSRF | `state` + short-lived `oauth_state` cookie (`login.mjs:19-29`, verified `callback.mjs:34-38`). GitHub OAuth Apps lack PKCE, so `state` is the whole defense. |
| Session hygiene | `api/_lib/session.mjs` — HS256 signed, constant-time compare, `HttpOnly`/`SameSite=Lax`, `Secure` in prod, 30-day expiry, **fails closed** when `SESSION_SECRET` is missing (`:95-98`). |
| Single UI entry | `docs/index.html:1400` — one "Login with GitHub" link, logout at `:1419`. |

**So: do not add a provider, and do not add an auth library.** The remaining work is four
real gaps in what is already there:

### A-1 — `appBaseUrl()` trusts client-supplied proxy headers (P1)

`api/_lib/session.mjs:70-79` builds the callback URL from `x-forwarded-proto` and
`x-forwarded-host`. On Vercel these are platform-set, so this is safe today. But it makes the
OAuth redirect URL attacker-influenceable the moment the app is self-hosted, fronted by
anything that doesn't sanitize them, or run behind a proxy that passes the header through. A
crafted `X-Forwarded-Host` makes `/api/auth/login` redirect to a hostile `redirect_uri` and
sends real users into a failed login.

GitHub's registered-callback allowlist bounds the blast radius (no code is stolen), so this is
not an emergency — but it is a two-line fix that removes the class entirely.

**Fix:** prefer a `PUBLIC_ORIGIN` env var when set; treat the headers as fallback only.

### A-2 — the `oauth_state` cookie is never `Secure`, and survives failure paths (P2)

Two inconsistencies in `api/auth/login.mjs:26`:
- The state cookie is built `HttpOnly; Max-Age; SameSite=Lax` with **no `Secure`**, while
  `sessionCookieHeader` *does* add it in production (`session.mjs:99-101`). Same site, two rules.
- On every failure path, `fail()` (`callback.mjs:4-9`) redirects **without** clearing
  `oauth_state`. Only the success path clears it (`callback.mjs:88-91`). A stale 10-minute
  cookie lingers after every failed attempt.

Low impact — it is overwritten on the next attempt — but it is half-finished cleanup and it
is inconsistent with the sibling cookie.

### A-3 — sessions cannot be revoked (P1)

`signSession` mints a fixed 30-day token and there is no server-side store, so **a leaked
cookie is valid for 30 days and cannot be invalidated.** `logout` only clears the client
cookie. If the `SESSION_SECRET` ever leaks, *every* session ever issued is compromised and
there is no kill switch.

**Fix:** add a `SESSION_EPOCH` env var to the signed payload and reject tokens minted under an
older epoch. Rotating the epoch invalidates every outstanding cookie instantly — the incident
response tool this design currently lacks. Cheap, no new storage.

### A-4 — login cannot be tested on a Preview deployment (P2, documentation)

`appBaseUrl()` derives the callback from the request host, so on a Vercel Preview the callback
becomes `https://<preview-host>/api/auth/callback`, which GitHub rejects because it is not a
registered callback. Login simply fails on every preview. Expected, but undocumented, and it
surprises people. Note the interaction with A-1: pinning `PUBLIC_ORIGIN` makes previews
deterministic (point at production, or refuse explicitly) instead of accidentally broken.

### A-5 — the rate limiter cannot tell users apart (P1) — **DECIDED: soft-gate, see §6 Wave 5.1**

`api/chat.mjs:151` keys the limiter on IP alone (`chat-security.mjs:39-40` — 5 req/min),
and `getSession` is consumed only by `api/auth/me.mjs` and `api/judge/run.mjs` — **not** by
`chat.mjs`. Decision D-6 in `CHATBOX_PROGRESS.md` locked chat as deliberately anonymous.

Today: a NAT'd user (office, campus, mobile carrier) shares one 5/min bucket with everyone
else behind the same IP, while an attacker rotating IPs gets a fresh budget every time. With
sessions already implemented, a per-`githubId` limit is a small change.

**Owner decision (2026-09-28): chat stays anonymous, with a soft gate on abuse.** A GitHub
login is never *required*; it is offered only when a reader has actually exhausted the
anonymous budget, and it *raises* their limit rather than unlocking a feature. The remedy for
hitting the limit is therefore a suggestion, not a wall.

**Constraint for every option below:** a logged-in identity must **never** move chat history
off the device. Login gives an *identity*, not a *datastore*. Progress is server-side by
`MASTER_PLAN.md` design (keyed by `githubId`); chat history stays local (§6 Wave 4). Adding
"and now we can finally store the chats in Postgres" is exactly the architectural collision
Wave 4 was written to avoid.

---

## 5. Issues the plan does not mention, ranked above its own content

### P0-1 — Mermaid `securityLevel` is downgraded to `loose` for model-authored chat content

`openArticle()` initializes Mermaid globally with `securityLevel: 'loose'` and
`htmlLabels: true`, then calls **unscoped** `mermaid.run()` across the whole document:

- `docs/index.html:1272-1279`

The widget initializes to `'strict'` — but **latches `mermaidReady = true` forever** and never
re-asserts:

- `docs/chat-widget.js:454`, `docs/chat-widget.js:476-484`

So any chat message rendered *after* an article load inherits `loose` + `htmlLabels` on
content that is **model-authored and unreviewed** — and `fetch_page` means a stranger's web
page can influence what the model emits. The widget's own comment
(`chat-widget.js:459-465`) states it has solved this by re-asserting `'strict'`; it has not,
because the latch is one-way and `openArticle` can win the race.

**This is more urgent than anything in the plan.** Fix: re-assert `securityLevel: 'strict'`
before *every* chat render (drop the latch), or scope the article's `run()` to `contentArea`.

### P0-2 — `marked` is loaded with no version at all

- `docs/index.html:36` — `cdn.jsdelivr.net/npm/marked/marked.min.js` (no `@version`)

The widget already carries a two-shape compatibility shim for exactly this reason
(`chat-widget.js:578-609`, handling the v12–v14 vs v15+ renderer signature). KaTeX and Prism
are pinned (`katex@0.16.9`, `prism/1.29.0`); `marked`, `mermaid@10`, and `dompurify@3` are
pinned to a *major* at best. A `marked` major release breaks markdown for the **entire
portal**, not just chat. Pin it.

### P1-1 — no `Content-Security-Policy`

`vercel.json` sets `nosniff`, `X-Frame-Options: DENY`, `no-store`, and CORS — and no CSP, on a
page running five third-party scripts and injecting model output into the DOM. Real work
(inline scripts in `index.html` need nonces/hashes), but the highest-leverage hardening
available.

### P1-2 — `max_tokens` is rejected by newer models

`AI_MODEL` is env-driven (`.env.example:18`). Set it to any newer reasoning model and the
request 400s, because `max_tokens` (`api/chat.mjs:245`) is no longer accepted in its place.
Either send `max_completion_tokens` for those families, or pin the model and document it.

### P1-3 — `setTimeout` leak in the heartbeat race

- `api/chat.mjs:282-285`

Each loop iteration creates a 10s `setTimeout` inside `Promise.race` and never clears it. When
the read wins, the timer stays pending and holds the event loop — hundreds of live timers over
a long stream, and it delays warm-instance shutdown after `res.end()`. Cheap fix, real effect.

### P1-4 — no verification anywhere in the plan

Every section changes shipped behavior. This repo has 278 hermetic chat assertions and 61 e2e
tests. **Each item below names the assertion that must exist**, or it will regress silently.

---

## 6. The revised plan

Ordered by dependency. Each item is independently shippable and independently testable.

### Wave 0 — P0 correctness and security (no change in reader-visible behavior)

| # | Change | File | Verify by |
|---|--------|------|-----------|
| 0.1 | Re-assert `securityLevel: 'strict'` before **every** chat `mermaid.run()`; drop the one-way `mermaidReady` latch | `docs/chat-widget.js:454,476-484` | new e2e: render a chat diagram **after** `openArticle()` has run; assert no `foreignObject`/raw HTML label and that a script payload in a label is not executable |
| 0.2 | Pin `marked` to an exact version (match the existing KaTeX/Prism style); consider exact pins for `mermaid`/`dompurify` | `docs/index.html:35-43` | e2e: markdown + code-block copy button still render |
| 0.3 | Capture `choices[0].finish_reason`; emit `{"truncated": true}` after the stream; add `finishReason` to the `chat.completed` log | `api/chat.mjs:339,413-428`; `docs/chat-widget.js` `readSse` | hermetic: upstream frame with `finish_reason:"length"` → client shows an honest "answer was cut off" notice; `chat.completed` log carries `finishReason` |
| 0.4 | `clearTimeout` the heartbeat timer per iteration | `api/chat.mjs:282-285` | hermetic: no pending timers after the stream ends; suite still 278+ green |
| 0.5 | **A-1** — prefer `PUBLIC_ORIGIN` for the OAuth redirect; headers become fallback | `api/_lib/session.mjs:70-79` | unit: a request with `X-Forwarded-Host: evil.com` still yields the configured origin; unconfigured falls back to the header |
| 0.6 | **A-2** — `Secure` on `oauth_state` in production; clear it on every callback exit path, not just success | `api/auth/login.mjs:26`; `api/auth/callback.mjs:4-9,88-91` | hermetic: after a failed callback the `oauth_state` cookie is expired in the response |
| 0.7 | **A-3** — add `SESSION_EPOCH` to the signed payload; reject older epochs | `api/_lib/session.mjs` (`signSession`, `verifySession`) | unit: a token signed under epoch 1 fails once `SESSION_EPOCH=2`; same-epoch token still valid; epoch absent ⇒ today's behaviour (back-compatible) |
| 0.8 | **5.1a** — a session *raises* the limit, never gates it: when `getSession(req)` returns a payload, also limit on `chat:u:<githubId>`; log the `login` on `chat.rate_limited` | `api/chat.mjs:151-159` | hermetic: request with a valid session cookie is keyed on identity, not IP; request without one behaves exactly as today |

**0.3 is the gate for §4.** Do not touch `max_tokens` until the truncation rate is measurable
in logs. **0.5-0.7 are independent of the login-gating decision** — do them either way.

### Wave 1 — Math rendering (replaces plan §2)

| # | Change | File | Verify by |
|---|--------|------|-----------|
| 1.1 | Add a `renderMath(scope)` helper that calls `window.renderMathInElement` with **the exact options from `index.html:1283-1295`** — including `ignoredTags: ['script','noscript','style','textarea','pre','code']` and `throwOnError: false` | `docs/chat-widget.js` (near `renderMarkdown`, `:628`) | unit: `$O(n \log n)$` in a settled paragraph becomes `.katex` |
| 1.2 | Call it on the **stable prefix only**, immediately after `renderMarkdown(prefix)` in `paintReveal()`; and in `messageNode()` for restored/settled messages | `docs/chat-widget.js:951-956`, `:708` | unit: math never typesets from the live tail; a streaming `$a+b` shows no flash and no throw |
| 1.3 | Reject the Unicode-preference prompt rule | — | assertion that prompt contains no "prefer Unicode" rule |
| 1.4 | Add the regression test the plan would otherwise create | `scripts/test-chat.mjs` / e2e | a ```js block containing `` `${x}` `` and `$r$` renders **unmodified** — math must not eat template literals |

### Wave 2 — Mermaid hardening (plan §1, mechanically corrected)

| # | Change | File | Verify by |
|---|--------|------|-----------|
| 2.1 | **Fix the prompt's own example** to quoted labels — the rule is worthless while the example contradicts it | `api/_lib/chat-prompt.mjs:116-121` | assertion: every `nodeId[...]`/`nodeId{...}` label in the prompt source is quoted |
| 2.2 | Add: quote labels with special chars; `< 15` nodes; "diagrams render — never apologize for text-only limits" | `api/_lib/chat-prompt.mjs` | prompt assertion |
| 2.3 | CSS label on `.ltc-mermaid-error` explaining why source is shown | `docs/index.html` styles | e2e: malformed mermaid → labelled `<pre>`, **not** a blank box |
| 2.4 | Automate what `scratch/qa-mermaid.mjs` probes by hand | e2e | the malformed-diagram case is a committed test |

### Wave 3 — Visual guidance (plan §3, corrected)

| # | Change | File | Verify by |
|---|--------|------|-----------|
| 3.1 | Add recursion → call-tree guidance (over `sequenceDiagram`) | `api/_lib/chat-prompt.mjs:112-137` | prompt assertion |
| 3.2 | **Replace** the 5×5-ellipsis rule: tables ≤ 8×8, prefer `viz-array` rows for 2D, do **not** ellipsize DP grids | same | prompt assertion |
| 3.3 | Demote "never exceed 500 words" to soft guidance; keep structural budgets (one diagram, short snippet) | same | prompt assertion |

### Wave 4 — Persistence (plan §5, rewritten)

| # | Change | File | Verify by |
|---|--------|------|-----------|
| 4.1 | `sessionStorage` → `localStorage`, **same key and same synchronous read path**. This is the actual fix for "dies when the tab closes" | `docs/chat-widget.js:43,409-424,444` | e2e: thread survives **tab close and reopen** (not just reload); existing reload + per-guide swap tests stay green |
| 4.2 | Add a size cap with oldest-first eviction, and a 30-day TTL on entries | same | e2e: cap evicts oldest, TTL drops stale |
| 4.3 | Explicit "clear all chats" control | same | e2e: clears every guide's thread |
| 4.4 | Soft-gate banner (5.1b): count consecutive 429s, offer GitHub sign-in from the third, styled like the existing `login_error` banner; capped so readers are not nagged | `docs/chat-widget.js:1231`; `index.html:1495-1505` | e2e: 1st and 2nd 429 show the plain message only; 3rd adds the sign-in line; input stays usable while it shows |
| 4.5 | Correct the privacy claim in any user-facing copy: "we store nothing server-side" ≠ "no privacy exposure". Questions and page context go to OpenAI every turn; `web_search`/`fetch_page` go to Tavily | copy | review |

**Why not IndexedDB:** `localStorage` buys the same zero-cost / zero-latency / no-auth /
no-server-storage properties the plan lists, while keeping `readStore()` synchronous.
IndexedDB makes every read a promise, which breaks the synchronous init path that
`messageNode()`, `clearCurrent()`, and the thread swap all depend on — and 61 e2e assertions
are built on that ordering. It then requires a schema, a version, and a migration path for a
dataset that is a few hundred KB. It also adds `localforage` as a new **unpinned** CDN global
on a page that already carries a P0-2 supply-chain problem. Revisit only if a single thread
ever exceeds ~1MB.

**Why the "Zero Privacy Liability" claim is wrong:** two ways. (a) Reader questions and page
context are sent to OpenAI on every turn (`api/chat.mjs:186-193`), and web-tool queries go to
Tavily — data leaving the device is unaffected by where history is stored. (b) Moving from
`sessionStorage` to `localStorage` *creates* a new surface: history that outlives the tab is
readable by anyone at the same browser profile. The TTL and the clear control (4.2, 4.3) are
the mitigation; "none" is not accurate.

### Wave 5 — Needs an owner decision (do not self-approve)

- **5.1 ✅ DECIDED (2026-09-28) — anonymous chat, soft-gate on abuse.**
  D-6 stands. Nobody is required to log in to chat. Two halves, and the server half needs no
  client work at all:

  **(a) A session is an upgrade, never a gate.** In `api/chat.mjs`, when `getSession(req)`
  returns a payload, apply an *additional*, more generous limiter keyed `chat:u:<githubId>`
  alongside the per-IP one. The widget already sends `credentials: 'same-origin'`
  (`chat-widget.js:1223`), so the session cookie **already reaches `/api/chat`** — this is
  purely server-side. A signed-in reader silently stops sharing a bucket with everyone behind
  their NAT; an anonymous reader is unaffected. Add the caller's `login` to the
  `chat.rate_limited` log so abuse becomes attributable.

  **(b) Offer the sign-in only when the budget is actually spent.** The widget already handles
  429 with a plain message (`chat-widget.js:1231`). Upgrade it: count consecutive 429s in the
  Wave 4 store, and from the **third** onward render an inline GitHub sign-in line in the
  panel — reusing the styling of the existing `login_error` banner (`index.html:1495-1505`) —
  that simply raises the limit. Never a modal, never a redirect, and never blocking: the
  anonymous reader can always just wait out the `Retry-After`. Cap the counter so a reader is
  not nagged permanently.

  **Invariant for both halves:** chat history stays on-device even for signed-in readers.
  A session is an identity, not a datastore (§4.5).

- **5.2 Completion ceiling.** Decide 2,000 vs 4,096 **after** 0.3 has logged a truncation rate
  for a week. If raised, use a real formula (e.g. proportional to remaining tool-round budget),
  not `MAX_TOTAL_TOKENS - totalTokens`. State the cost exposure: ≈ $0.012/request worst case,
  ≈ $3.8/hour/IP at the 5/min limit.
- **5.3 Per-IP daily cap** in addition to 5/min, to bound key spend from rotating IPs. Still
  needed under 5.1 — an anonymous attacker never signs in.
- **5.4 CSP** (`P1-1`) — needs a decision on nonce vs hash for `index.html`'s inline scripts.
- **5.5** `max_tokens` → `max_completion_tokens` compatibility shim (`P1-2`), or pin the model.
- **5.6** Register a second GitHub OAuth App for previews, or accept that login fails on every
  preview deployment (A-4).

---

## 7. Explicitly rejected

| Plan item | Reason |
|-----------|--------|
| §2.1 "prefer Unicode over LaTeX" prompt rule | Unverifiable, degrades output, treats a symptom 1.2 removes |
| §2.2 defer KaTeX to end-of-stream | Creates the snap it claims to prevent, once per paragraph |
| §4.1 `min(MAX_TOTAL_TOKENS - totalTokens, 4096)` | Category error; evaluates to a constant 4096 |
| §4.1 raise ceiling before measuring | No evidence of the symptom; doubles unauthenticated spend exposure |
| §4.2 "never exceed 500 words" | Unverifiable; fights the 2D-visualization guidance in §3 |
| §5.2 IndexedDB + localforage | Async read path, migration burden, new unpinned CDN global — for no benefit over `localStorage` |
| §5.3 "Zero Privacy Liability" | Factually wrong; provider transit + new shared-profile exposure |
| §1.2 "keep the current design" for Mermaid | Correct outcome, wrong reason — the design solves it upstream at the stable-prefix boundary |
| Adding Google / email / password / magic-link / any second provider | GitHub OAuth is already the sole path by decision (`MASTER_PLAN.md:308`); a second provider contradicts it and adds surface for no user |
| Adding an auth library (Auth0 / Clerk / Supabase / NextAuth / passport) | The hand-rolled GitHub flow is complete, minimal-scope, and dependency-free; a library adds a vendor, a bundle, and a second identity surface |
| "Store chats server-side now that we have logins" | Login yields an identity, not a datastore. Progress is server-side by design; chat history stays on-device (§4.5) |
| `localforage` / IndexedDB | Async read path, migration burden, new unpinned CDN global — for no benefit over `localStorage` |

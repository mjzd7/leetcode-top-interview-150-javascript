# Dry-Run Engine — Progress Ledger

**Plan of record:** [`DRY_RUN_ENGINE_PLAN_v5.md`](DRY_RUN_ENGINE_PLAN_v5.md) (v5.1).
This file records progress against it. Nothing here is authoritative; the plan is.

**Rules, non-negotiable:**

1. **Append-only.** Never rewrite history — a superseded line gets `~~struck~~`, not deleted.
2. **One append per row, in the same commit as the row's code.** A row whose evidence
   is missing here is *not done*, regardless of what the chat said.
3. **Every number cites a command.** No number enters this file that `npm run audit`
   or a shell one-liner cannot reproduce.
4. **A row with no test id in §5 is a hole**, visible on sight.

Opened: 2026-10-02 · Repo HEAD at open: `ab0a678` · Node local `v26.5.0` / CI `20`

---

## 1. Baseline (measured 2026-10-02, before any row ran)

| Fact | Value | Reproduce with |
|---|---|---|
| Guides | 150 | `npm run validate` |
| Runtime-tested | 109 | `npm test` |
| **Syntax-only (never executed)** | **41** | `npm test` |
| Syntax blocks checked | 450 | `npm test` |
| Runtime assertions | 828 | `npm test` |
| ` ```javascript ` fences (unfiltered) | 813 | `grep -c '```javascript'  **/*.md` |
| `Level 3` headings | 153 | audit (row 0) |
| `### Step-by-Step Dry Run` tables | 453 | audit (row 0) |
| Sandbox envelope slot | 1 MB — overflow **drops** the envelope | `grep -n ENVELOPE_MAX_CHARS api/_lib/sandbox.mjs` |
| Sandbox timeout / heap | 3 s / 16 MB | `sed -n '96,98p' api/_lib/sandbox.mjs` |
| Judge pilot registry | 5 hardcoded slugs · codec whitelist `['json','tree']` | `grep -n 'PILOT_SLUGS\|codec' api/_lib/problems.mjs` |
| Playwright projects | `desktop` 1440×900 + `Pixel 7` | `grep -n 'name:' playwright.config.mjs` |
| Guide bundle size | 20 KB / 556 lines per guide | audit (row 0) |
| `docs/curriculum-data.js` | 3.09 MB, gitignored | `ls -la docs/curriculum-data.js` |
| `api/_lib/kv.mjs` | exists, 73 lines, degrades `{ok:false}` — **reuse, never rewrite** | `wc -l api/_lib/kv.mjs` |
| `eval` / `new Function` in guides | 0 | audit (row 0) |
| `async`/`generator` inside solution regions | 0 (159 lines live in §6 follow-ups) | audit (row 0) |
| `Math.random` / `Date` in guides | 3 | audit (row 0) |

The 41 syntax-only guides are the whole point of W-1. They have never been executed.

---

## 2. Scope

**Deliverable: the 150 guides already in this repo.** Expansion to the full catalogue
is probable but not current — §8 of the plan is a *gated* track, dark until its trigger
fires. Owner decision, 2026-10-02.

---

## 3. Task table — 34 rows + 3 gated

One atomic action per row. `Evidence` is the receipt; empty means not done.

| Row | Task | Plan § | Status | Commit | Evidence |
|---|---|---|---|---|---|
| 0 | `audit-curriculum.mjs` pins every count | §7 | pending | | |
| 0b | `guide-quality` rubric (`book-to-skill`) | §7 | pending | | |
| 1 | `catalog/problems.json`, 150 entries | §7 | pending | | |
| 2 | Drop `fns` via `sg` | §7 | pending | | |
| 3 | **41 → 0 syntax-only** | §7 | pending | | |
| 4 | Validator rejects async/generator/eval | §7 | pending | | |
| 5 | Envelope v1.1 schema + validator | §7 | pending | | |
| 6 | Canonical serializer + 9 round-trips | §7 | pending | | |
| 7 | `gen-blocks.mjs` → `blocks.json` | §7 | pending | | |
| 8 | RED: golden differ catches a mutation | §7 | pending | | |
| 9 | Runtime instrumenter (Acorn) | §7 | pending | | |
| 10 | `trace-runner.mjs` region gate + chunking | §7 | pending | | |
| 11 | Byte budget + degrade-to-`diff` | §7 | pending | | |
| 12 | Execution/display caps, verdict isolation | §7 | pending | | |
| 13 | **V3 green → envelope v1.1 frozen** | §7 | pending | | |
| 14 | V2 replay determinism | §7 | pending | | |
| 15 | `gen-traces.mjs` → 150 goldens | §7 | pending | | |
| 16 | `docs/traces/*.json` static copies | §7 | pending | | |
| 17 | Codec registry + 5 codecs | §7 | pending | | |
| 18 | Widen or delete `problems.mjs` | §7 | pending | | |
| 19 | V4 differential harness | §7 | pending | | |
| 20 | V11 region isolation + non-vacuity | §7 | pending | | |
| 21 | Tier-1 table player | §7 | pending | | |
| 22 | `array` primitive — **first pixels** | §7 | pending | | |
| 23 | Tier-1 presets: stack/matrix/window/bits | §7 | pending | | |
| 24 | Tier-2 presets + overlay | §7 | pending | | |
| 25 | One table-driven Playwright spec | §7 | pending | | |
| 26 | V5 event-floor gate | §7 | pending | | |
| 27 | V9 table↔trace cross-check | §7 | pending | | |
| 28 | `trace-head.json` per problem | §7 | pending | | |
| 29 | V8 scan → repair thin tables | §7 | pending | | |
| 30 | Wire `verify` + CI cache + time budget | §7 | pending | | |
| 31 | Design pass: timing/contrast/keyboard | §7 | pending | | |
| 32 | "Unverified" = derived function | §7 | pending | | |
| 33 | V12 logging-only prediction events | §7 | pending | | |

**Gated — do not build unprompted.**

| Row | Trigger | Status |
|---|---|---|
| T-a `/api/judge/trace` + custom input | ≥5 readers ask **or** W2 static p95 > 800 ms | unfired |
| T-b prediction scoring UI | ≥1 guide repair attributable to row 33's aggregate | unfired |
| T-c degraded interview mode | decision 6 = default-on **and** ≥20 sessions | unfired (decision 6 = opt-in) |

---

## 4. Decision log — all closed 2026-10-02

| # | Decision | Answer | Reopen by |
|---|---|---|---|
| 1 | Anonymous dry runs | yes — read-only, 10/min, cached (binds T-a only) | editing this row |
| 2 | Animate all 3 levels? | all 3 for Tier 1, canonical only for Tier 2 | |
| 3 | Goldens: KV or static JSON? | **static JSON under `docs/`** | |
| 4 | Server QuickJS or browser tracer? | server, custom-input only (T-a) | |
| 5 | Trace user-submitted code? | **no — canonical only, permanently** | **security**; needs new design + threat model |
| 6 | Degraded interview mode | opt-in | |
| 7 | Prediction score storage | localStorage; aggregates → `kv.mjs` | |
| 8 | Premium problems | **link-only, own wording, never reproduce** | **licensing** |
| 9 | Model-generated content in CI | **not authorised** — T1 stays blocked | owner budget approval |
| A1 | Progress file | `DRY_RUN_ENGINE_PROGRESS.md`, repo root | |
| A2 | Plan sequencing | v5.1 tooling deltas folded in before row 0 | |
| A3 | Commits | one atomic commit per row, no batching | |
| A4 | Pre-commit hook | install before row 3 | |
| B1 | Who adjudicates the 41 | agent + owner spot-check | |
| B2 | Kill threshold | 15 of 41 — fixed, not re-negotiated after counting | |
| B3 | The 41's cases | derived from guide prose, owner reviews the list | |

---

## 5. Edge-case coverage — E1–E36 → test id

A row with no test id is a hole. `—` means the test does not exist yet.

| Group | Cases | Enforcing script | Test ids |
|---|---|---|---|
| Serialization / golden stability | E1 `undefined` · E2 `NaN`/`±Infinity` · E3 `-0` vs `0` · E4 `BigInt` · E5 `Map`/`Set` · E6 typed arrays · E7 cycle/shared ref · E8 key order · E9 depth > 10 000 | `test:trace` (row 6) | — |
| Instrumentation correctness | E10 recursive target · E11 class methods · E12 callbacks inside target · E13 same-block helper · E14 other-block helper · E15 IIFE/arrow/getter · E16 async/generator · E17 `eval`/`new Function` · E18 step throws · E19 guide edited after goldens | `test:trace` (7,9,10,20) · `validate` (4) | — |
| Budget / resource | E20 trace > 1 MB · E21 single chunk > slot · E22 heap blowup · E23 > 200 k steps · E24 3 s timeout · E25 16 MB OOM | `test:trace` (11,12) · `test:judge` (existing) | — |
| Correctness / determinism | E26 `Math.random`/`Date` · E27 random-jump ≡ forward walk · E28 six equivalence kinds · E29 input validation | `test:trace` (14,26) · `npm test` (19) | — |
| Scale-only (T1–T3, dark) | E30 path-keyed registry · E31 65 MB bundle · E32 golden footprint · E33 600 k execs · E34 authored tables · E35 derived equivalence · E36 premium | assertions inside the generators | n/a — track dark |

---

## 6. Kill-criterion counters

| Criterion | Threshold | Current | Fires when |
|---|---|---|---|
| **W-1** wrong canonicals among the 41 | **> 15** | **not yet measured** | row 3 completes |
| W0 oracle needs manual adjudication | > 25 % of equivalence kinds | n/a | row 19 |
| W2 static path adoption | < 10 users/week after a month | n/a | a month after W2 |
| T1 drafts failing adjudication twice | > 30 % | n/a | track dark |

---

## 7. Session log

### 2026-10-02 — plan v5.1 opened

- Re-verified every load-bearing fact in §1 against the repo at `ab0a678`. All held;
  none re-litigated.
- Folded the v5.1 tooling deltas into the plan: §0.2 receipts (`jq 1.7.1`,
  `delta 0.19.2`, `sg 0.44.1`, Playwright's two configured projects, `firecrawl`),
  rows 2/4/6/13/25 reshaped, row 0b added, row 30 extended with the CI
  `cache: 'npm'` + time-budget risk.
- Closed all 9 owner decisions on defaults + 7 process decisions (§4).
- Scope set: 150 guides now, expansion gated (§2).
- **Next: row 0** — `scripts/audit-curriculum.mjs`.
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

### 1.2 `lcId` is not in this repo — row 1's null column is a finding, not a gap

`catalog/problems.json` carries `lcId: null` for **all 150** entries. Verified by hand:
every guide's LeetCode link is slug-only (`leetcode.com/problems/two-sum/`), with no
numeric id anywhere in the tree — `grep -l "leetcode.com/problems" */*.md` → 150 files,
`grep -o "leetcode.com/problems/[a-z-]*/[0-9]*"` → **no matches**.

So the plan's row 1 spec ("`lcId`, extracted from the guide's link") names a field the
repo cannot supply. Not fixed by inventing one. Two honest routes, owner call:

1. **Drop `lcId` from the catalog** until something needs it — `path` is the identity
   anyway (E30), and nothing in rows 5–33 reads `lcId`.
2. **Harvest it later with `firecrawl`**, exactly as plan §8 already prescribes for the
   scale track ("the problem list is harvested with `firecrawl` — path, lcId, title,
   difficulty, tags are facts we fetch, never generate").

Row 1 left the field present and `null` rather than silently reshaping the plan's own
schema. Recommend route 2 and **no work now** — nothing in W-1…W-3 consumes `lcId`.

`returnType` is `null` on 1 of 150 (`01-array-string/*` — derivable, cosmetic, row 19's
equivalence work will want it).

### 1.1 Row 0 re-measurement — 16 drifts, none absorbed

`npm run audit` measured the §1 baseline against the repo on 2026-10-02 at `633931e`.
**16 asserted numbers do not hold.** They are printed as a DRIFT table, not corrected
in the script. Three change what a later row must do:

| Asserted | Measured | Why it matters |
|---|---|---|
| `eval`/`new Function` in guides = 0 | **0** ✓ | K7 invariant holds |
| async/generator lines inside solution regions = 0 | **1** | `08-linked-list/02-add-two-numbers.md:141` — the word `yield` in a *prose comment* (`// zero must yield one node`), not code. Row 4's `sg` scan is AST-shaped and correctly does **not** flag it. The plan's "0 lines" was right about code and wrong about raw text. |
| async/generator lines in follow-ups = 159 across 70 guides | **188 across 72** | risk is larger than the plan recorded, still bounded |
| `RUNTIME_TESTS` = 109 keys, 81 `fns`+`cases` / 28 `script` | **56 / 53** | the 81/28 split is wrong by 25/25. **Row 2 drops `fns` from 56 entries, not 109.** |
| thin tables = 22 in 19 guides (2 empty) | **27 in 23 guides (3 empty)** | **row 21 and row 29 have 5 more tables to repair than the plan assumed.** All 23 named in the audit output. |
| ` ```javascript ` fences = 813 | **807** | the 813 figure counted fences outside the 150-guide set |
| `Level 3` headings = 153 · 4-field header = 151 | **150 · 150** | earlier counts included non-guide files |
| dry-run tables = 453 | **450** | ditto — 453 was never 150-guide-only |
| `Map`/`Set` = 64 · `Math.random`/`Date` = 3 | **64 · 3** ✓ | serializer scope (E5) is right |
| typed arrays = 19 · BigInt literals = 14 | **23 · 15** | E6 scope larger than recorded |
| self-recursive guides = 87–152 | **78–85** | heuristic is pinned in the script; the old range was wider than reality |
| guide size = 20 KB / 556 lines | **16.5 KB / 430 lines** | |
| guides / 450 blocks / 109 / 41 / 828 | **150 / 450 / 109 / 41 / 828** ✓ | the numbers rows 3 and 7 build on all hold |

Row 3's kill criterion (**>15 wrong of 41**) is unaffected — that measures execution
failures, not counts. Nothing in this table blocks row 3.

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
| 0 | `audit-curriculum.mjs` pins every count | §7 | **done** | `633931e` | `npm run audit` → 150 guides / 450 solution blocks / 109+41 coverage, 16 DRIFT rows printed, exit 0. `node scripts/audit-curriculum.mjs --check` → 16 passed, 0 failed. `selectSolutionBlocks()` exported for rows 4/7/21. |
| 0b | `guide-quality` rubric (`book-to-skill`) | §7 | **done** | `2e7c4b9` | `docs/rubrics/guide-quality.md` (323 lines) + `npm run audit --scores` → **150 scores, mean 96.4, min 80, max 100 (96 guides)**; bands reference 96 / sound 44 / incomplete-evidence 10 / draft 0. Thin-table cross-check: the 23 thin-table guides score **9.1/15** on the depth component vs 15/15 for the other 127, **23/23 below the median**. **Deliberately NO gate, NO threshold, exit 0** — row 0b is `[Y]` and the gate belongs to T1. |
| 1 | `catalog/problems.json`, 150 entries | §7 | **done** | `1e2c9a4` | `npm run gen:catalog` → **150 entries, 150 unique paths, all exist on disk** (keyed by `path` per E30). Difficulty 40/92/18 E/M/H · codec `json` 101, `tree` 20, `list` 13, `graph` 9, `ops` 7 — **5 implemented codecs only, no 6th** · equivalence `exact` 123, `ops-terminal` 15, `order-insensitive` 9, `int-with-tolerance` 2, `multiset` 1. **`lcId` is `null` for all 150** — see §1.2. |
| 2 | Drop `fns` via `sg` | §7 | pending | | |
| 3 | **41 → 0 syntax-only** | §7 | pending | | |
| 4 | Validator rejects async/generator/eval | §7 | **done** | `0aceb10` | `npm run test:validate` → 23 assertions, 0 failures (E16 await/generator/yield, E17 eval/new-Function, K7 missing-L3, prose-`await` control). `npm run validate` → 150 scanned, **0 errors, 0 warnings**. Scan is `sg` rules in `.ast-grep/rules/solution-block-sync.yml`; missing `sg`/rules ⇒ `SOLUTION_SCAN_UNAVAILABLE`, unparseable block ⇒ error. |
| 5 | Envelope v1.1 schema + validator | §7 | **done** | `b3d44c1` | `npm run test:envelope` → **129 assertions, 0 failures**; 7 bad fixtures rejected by name across I1–I7 (+10 in-test mutations), good fixture exits 0. `docs/trace-schema.json` documents each field's meaning; caps taken from `sandbox.mjs` (1 MB / 3 s / 16 MB), not asserted. **Freeze point is row 13.** |
| 6 | Canonical serializer + 9 round-trips | §7 | **done** | `aa6fa3a` | `npm run test:serialize` → E1–E9, 9 cases, 0 failures, exit 0. Compared via `jq -S .` (plan §0.2), not `deepEqual`. Exports `serialize`/`stringify`/`deserialize`/`MAX_DEPTH`. |
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
| 21 | Tier-1 table player | §7 | **done** | `f4e7a3d` | `docs/dryrun/table.js` → **450 tables parsed across 150 guides**; thin = **27 tables / 23 guides, matching row 0's list exactly** (reconciled by me, diff empty). Dependency-free, browser-safe: **no `node:`/`fs`/`require`**, exports `parseGuide`/`parseAll`/`findThinTables`/`THIN_ROW_LIMIT`. `$…$` cells preserved verbatim. |
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
| Serialization / golden stability | E1 `undefined` · E2 `NaN`/`±Infinity` · E3 `-0` vs `0` · E4 `BigInt` · E5 `Map`/`Set` · E6 typed arrays · E7 cycle/shared ref · E8 key order · E9 depth > 10 000 | `test:trace` (row 6) | `npm run test:serialize` — E1…E9, one named case each |
| Instrumentation correctness | E10 recursive target · E11 class methods · E12 callbacks inside target · E13 same-block helper · E14 other-block helper · E15 IIFE/arrow/getter · E16 async/generator · E17 `eval`/`new Function` · E18 step throws · E19 guide edited after goldens | `test:trace` (7,9,10,20) · `validate` (4) | E16+E17+`npm run test:validate` (23 assertions); E18/E19 `—`, rows 10/15 |
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

### 2026-10-02 — row 0 done, and it found 16 wrong numbers

- `scripts/audit-curriculum.mjs` (`633931e`). `npm run audit` measures; `--check`
  self-verifies the K7 predicate; `--json` feeds rows 21/29.
- **The gate did its job.** 16 asserted counts in §1 do not hold. Recorded in §1.1.
  Three change a later row's shape: row 2 drops `fns` from **56** entries (not 109),
  rows 21/29 repair **27** thin tables in **23** guides (not 22/19), and row 4's `sg`
  scan is AST-shaped precisely because the one apparent "async line in a solution" is a
  prose comment.
- `npm run validate` and `npm test` unchanged throughout: 150 files, 109 runtime,
  41 syntax-only, 450 syntax blocks, 828 assertions, 0 failures, 0 errors.

### 2026-10-02 — wave 2: rows 5, 1, 0b, 21 done

- **Row 5** (`b3d44c1`) — envelope v1.1 + validator. 129 assertions, 7 bad fixtures
  rejected by name across I1–I7. Freeze point is row 13.
- **Row 1** (`cd2e85e`) — catalog, 150/150 keyed by path. **`lcId` null everywhere and
  that is correct** — see §1.2; the field is not in this repo and was not invented.
- **Row 0b** (`2e7c4b9`) — rubric + per-guide score. Ships **no gate**, per the row's own
  `[Y]` tag; the threshold is T1's to set.
- **Row 21** (`f4e7a3d`) — table player. 450 tables, thin list reconciled against row 0
  with an empty diff. Browser-safe, no Node imports.
- All four verified by hand, not taken on the agents' word. Regression held:
  `npm run validate` 150/0 errors, `npm test` 150 files / 109 runtime / 41 syntax-only /
  450 syntax blocks / 828 assertions / 0 failures, `audit --check` 16/0.

**Cross-row discipline held:** rows 5, 21, 0b and 1 all *import or reconcile against*
row 0/4/6's committed exports instead of re-deriving them. That is the direct payoff of
row 0 exporting `selectSolutionBlocks()` — the 813-vs-450 lie existed because three tools
counted fences three ways, and this wave added three consumers and zero new parsers.

### 2026-10-02 — rows 6 and 4 done

- **Row 6** (`aa6fa3a`) — `scripts/lib/serialize.mjs`, 9 round trips green under
  `jq -S`. Closes E1–E9 in §5.
- **Row 4** (`0aceb10`) — `sg`-shaped solution-block scan in `validate-guide.mjs`
  plus 9 rules and 5 fixtures. Closes E16, E17 and K7. It reads row 0's
  `selectSolutionBlocks()` rather than defining a second block predicate — the
  813-vs-450 ambiguity existed precisely because three tools counted fences three
  ways.
- New npm scripts `test:serialize` and `test:validate` are registered. **Not yet
  wired into `verify`** — row 30 owns that, and `verify` deliberately still ends at
  `build` so no row silently changes CI cost before row 30 measures it.

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
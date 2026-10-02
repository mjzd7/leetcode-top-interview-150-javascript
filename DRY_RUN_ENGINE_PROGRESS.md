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
| 2 | Drop `fns` via `sg` | §7 | **done** | `0ed65d4` | **86 insertions / 70 deletions**, `grep -c "fns:"` → **0**. Done by an ast-grep rule (`kind: pair` + scoped regex — `fns: [...]` at statement position parses as a **labelled statement**, so a bare pattern matches nothing). `npm test` → **828 assertions unchanged, 0 failures**; validate 150/0. 53 `script` entries untouched. Manifest-missing fails naming `node scripts/gen-blocks.mjs`. |
| 3 | **41 → 0 syntax-only** | §7 | **done** | `47ef4fe` `47a224a` | `npm test` → **`Files: 150 (runtime-tested: 150, syntax-only: 0)`**, assertions **828 → 1453**, 0 failures. Cases merged from `catalog/cases.json` at load (not pasted as 41 literals); inline `RUNTIME_TESTS` still wins on conflict. `audit --check` asserts `runtimeTested === 150` and `syntaxOnly === 0` (18 checks). **One authored case was wrong and the suite caught it**: `02-two-pointers/02-is-subsequence` declares a **class** (`SubsequenceMatcher`, codec `ops`) and the case had written a shadowing `isSubsequence` wrapper that collided with the guide's binding. **Kill criterion: 0 wrong of 41** vs >15 halt. |
| 4 | Validator rejects async/generator/eval | §7 | **done** | `0aceb10` | `npm run test:validate` → 23 assertions, 0 failures (E16 await/generator/yield, E17 eval/new-Function, K7 missing-L3, prose-`await` control). `npm run validate` → 150 scanned, **0 errors, 0 warnings**. Scan is `sg` rules in `.ast-grep/rules/solution-block-sync.yml`; missing `sg`/rules ⇒ `SOLUTION_SCAN_UNAVAILABLE`, unparseable block ⇒ error. |
| 5 | Envelope v1.1 schema + validator | §7 | **done** | `b3d44c1` | `npm run test:envelope` → **129 assertions, 0 failures**; 7 bad fixtures rejected by name across I1–I7 (+10 in-test mutations), good fixture exits 0. `docs/trace-schema.json` documents each field's meaning; caps taken from `sandbox.mjs` (1 MB / 3 s / 16 MB), not asserted. **Freeze point is row 13.** |
| 6 | Canonical serializer + 9 round-trips | §7 | **done** | `aa6fa3a` | `npm run test:serialize` → E1–E9, 9 cases, 0 failures, exit 0. Compared via `jq -S .` (plan §0.2), not `deepEqual`. Exports `serialize`/`stringify`/`deserialize`/`MAX_DEPTH`. |
| 7 | `gen-blocks.mjs` → `blocks.json` | §7 | **done** | `32fdb5f` | `node scripts/gen-blocks.mjs --verify` → **450/450 hashes re-derived from source, 0 follow-up fences selected, 0 orphans on disk**, 150/150/150 per level. `regionTable` verified on `08-linked-list/11-lru-cache.md` L3: `LRUCache` depth 0 + its 5 methods, `DLinkedNode` helper suppressed at depth 1 (**E11/E13**). **102 blocks `selfRecursive`** for row 20. `targetFn` null on **0/450**. `build/` untracked. |
| 8 | RED: golden differ catches a mutation | §7 | **done** | `9b3fbbe` | `npm run test:trace` → **59 assertions, 0 failures**; 6 fixtures all generated from `expected.json` via `--mutate` (no hand-drift). Mutated step → **named step diff by index + field**; stale `blockHash` → **E19 named failure**, categorically separate. Truncation vs degrade kept distinct (K2). Row 13 flips this green and freezes v1.1. |
| 9 | Runtime instrumenter (Acorn) | §7 | **done** | `c675ae2` | `node scripts/test-instrument.mjs` → **246 assertions, 0 failures**. 12 fixtures (E10–E15×4, E18) + 2 real guides + a sweep of all 450 blocks. Emits `{h: blockHash, off: block-relative}` — **no absolute guide lines** (K5). Asserts instrumented == uninstrumented results (I2). acorn + acorn-walk as devDeps. |
| 10 | `trace-runner.mjs` region gate + chunking | §7 | **done** | `998d15d` | `node scripts/test-trace-runner.mjs` → **167 assertions, 0 failures**. Region gate is **data**: the prelude receives the manifest `regionTable` and the probe tests one integer (`depth !== 0`) — **zero counters in the module**, verified by grep. A chunk gap is a hard error. `truncated.trace` is its own flag. Budget from measured constants (1 MB slot × 12 chunks), not a 4 MB wish. |
| 11 | Byte budget + degrade-to-`diff` | §7 | pending | | |
| 12 | Execution/display caps, verdict isolation | §7 | pending | | |
| 13 | **V3 green → envelope v1.1 frozen** | §7 | pending | | |
| 14 | V2 replay determinism | §7 | pending | | |
| 15 | `gen-traces.mjs` → 150 goldens | §7 | **blocked on 2 engine bugs** | — | Generates 446 sound goldens (corpus 34.9 MiB, largest 7.3 MiB), `git check-ignore` verified. **But 4 blocks are invalid** — 3 ZERO-step traces + 1 QuickJS abort — and row 15 found the causes (see §7). 54 assertions 0 failures on its own harness. NOT committed as valid until fixed. |
| 16 | `docs/traces/*.json` static copies | §7 | pending | | |
| 17 | Codec registry + 5 codecs | §7 | **done** | `81f0ee8` | `npm run test:codecs` → **275 assertions, 0 failures**. 5 codecs `json`/`tree`/`list`/`ops`/`graph`, **no default branch** — unknown name throws naming the slug. Covers catalog **150/150, leftovers `[]`, unmapped 0**. 35 round trips, each with a mutant that FAILS. All 6 E28 equivalence kinds. |
| 18 | Widen or delete `problems.mjs` | §7 | **done** | `3af029d` | **Deletions, not a widening.** `PILOT_SLUGS` gone; pilot registry now = the files in `judge/tests/`, identity from `catalog/problems.json`. Slug/fnName/codec removed from all 5 judge specs (they keep only `tests`). `['json','tree']` whitelist deleted — it silently rejected 3 codecs covering 42 guides. Keyed by path (E30); shared slug = loud error. `npm run test:judge` → **64/0**. |
| 19 | V4 differential harness | §7 | pending | | |
| 20 | V11 region isolation + non-vacuity | §7 | pending | | |
| 21 | Tier-1 table player | §7 | **done** | `f4e7a3d` | `docs/dryrun/table.js` → **450 tables parsed across 150 guides**; thin = **27 tables / 23 guides, matching row 0's list exactly** (reconciled by me, diff empty). Dependency-free, browser-safe: **no `node:`/`fs`/`require`**, exports `parseGuide`/`parseAll`/`findThinTables`/`THIN_ROW_LIMIT`. `$…$` cells preserved verbatim. |
| 22 | `array` primitive — **first pixels** | §7 | **done** | `2f2a7b6` | `npm run test:dryrun-player` → **40 checks, 0 failures**. Playwright passes at **both** configured viewports (1440×900 + Pixel 7); screenshots `scratch/dryrun/*.png` (untracked). Spec clicks forward ×2 asserting the array **changed**, then back. All 3 levels animate (decision 2). Thin tables say so rather than rendering an empty frame. |
| 23 | Tier-1 presets: stack/matrix/window/bits | §7 | **done** | `c5b6469` | `node scripts/test-dryrun-render.mjs` → **90 checks, 0 failures**. `npx playwright test tests/dry-run.spec.mjs` → **56 passed** across desktop + mobile. Each preset shows its own concept, verified by eye: `stack` renders a **call stack with a depth**; `window` shows **bounds 1..4, size, and a per-step delta (+4/-0)** with in-window lit and out-of-window dimmed — not an array in disguise. Screenshots in `scratch/row23/` (untracked). **Tier 1 complete.** |
| 24 | Tier-2 presets + overlay | §7 | **done** | `7f75941` | `node scripts/test-dryrun-render.mjs` → **141 checks, 0 failures** (Tier 1's 90 still green). `npx playwright test tests/dry-run.spec.mjs` → **100 passed** both viewports. 4 presets + `dp-table`/`recursion-tree` overlays, **canonical level only** (decision 2). Screenshots `scratch/row24/` (12, untracked). Verified by eye: `tree` draws real edges + a level readout; `recursion-tree` shows depth, open frames and the base-case hit. |
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

### 2026-10-02 — row 15 root-caused: a 72-block bug found and fixed, plus a codec defect

Row 15 is **still uncommitted**, and that is the correct outcome. Verifying its 4 failures by
hand found a real engine bug (now fixed) and a real codec defect (not yet fixed).

**Fixed — `f9f0efe`.** Guides write `// TreeNode shared from Level 1` above an L2 block that calls
`new TreeNode(...)`. `npm test` copes because it concatenates all three levels into one harness;
the tracer runs ONE block, so the shared type was undefined and the target threw before emitting
a step. **72 blocks** were affected — every linked-list and tree guide's L2/L3 — but only 4
surfaced as empty traces, because the rest receive a ready-made node as a test fixture. Fixing
the 4 would have hidden 68. Declarations are spliced around the OUTSIDE, after instrumentation,
so the blockHash stays the block's identity (K5) and probe offsets stay valid.

Verified on the blocks that were empty: all three went from an error to the **correct tree**.

**Not fixed — a codec misclassification.** With that resolved, `buildTreeMap(preorder, inorder)`
throws `cannot read property 'map' of undefined`: `inorder` never arrives. Harvested args are
correct, so the loss is in `api/_lib/problems.mjs:121`, whose `tree` branch does
`__FN__(__arrayToTree__(t.args[0]))` — it assumes a tree target consumes **one level-order array**
and calls it with that alone. But `buildTreeMap(preorder, inorder)`, `buildTree(inorder,
postorder)` and `sortedArrayToBST(nums)` take raw arrays and build the tree themselves.
`build/blocks.json` assigns `codec: tree` to all three, and **that classification is wrong.**
The fix belongs in the codec assignment, not the driver.

**Two implementations of one fix.** `gen-traces.mjs` already carries its own
`missingDeclarations()` for the shared-declaration problem. Mine in rows 9/10 is a second
implementation of the same thing. They must be reconciled — that duplication is itself a finding.

**Method note, recorded because it cost real time.** Three of my four diagnoses were wrong before
the fifth was right: I blamed name-alignment in the instrumenter (it places all probes correctly),
then `runRaw`'s signature (I passed an array where a function was expected), then assumed row 15
had no shared-declaration fix (it has one), and finally called `runBlockTrace` directly when row
15 bridges a documented `__T`/`__T__` probe ABI drift through its own adapter. **Verify the layer
before blaming it** — measuring the next layer would have found this immediately.

### 2026-10-02 — row 24 done; **row 15 found two real engine bugs**

- **Row 24** (`7f75941`) — Tier 2 complete: 4 presets + 2 overlays, canonical level only.
  141 checks, 100 Playwright tests both viewports.

- **Row 15 is deliberately NOT committed as valid.** It generates 446 sound goldens and loudly
  reports 4 broken blocks — which is the generator behaving correctly. Two distinct defects,
  both root-caused by hand rather than taken from the agent's report:

**Bug A — region alignment by name (2 blocks).** `scripts/instrument.mjs:376` aligns acorn's walk
to row 7's `regionTable` **by function name**. `05-construct-from-preorder-inorder` L2 and
`06-construct-from-inorder-postorder` L2 declare **two** functions but the table has **three**
rows — the extra is `{"kind":"arrow-fn","name":null}`, an `inorder.map((v,i)=>…)` callback
artifact acorn never sees. The null row consumes nothing, alignment shifts, `helper` inherits
**depth 1**, and its body is suppressed. **This is precisely the K4/U3 vacuity failure the static
region table was built to prevent, reintroduced through the alignment heuristic.** Fix belongs
in the aligner (match document position, not name).

**Bug B — argument shape at the harvest boundary (2 blocks).** `runRaw` on
`01-sorted-array-to-bst` L3 returns `"(1 , 2 , 3 , 4 , 5) is not a function"`. I initially
blamed Bug A here too; **that was wrong** — instrumenting directly shows **8 probes correctly
placed, both depth 0, nothing skipped**. Rows 7 and 9 are correct for this block. The failure is
downstream: the authored case is an `assertEq(sortedArrayToBST([1,2,3,4,5]), …)` *script*, and
gen-traces harvests scripts into `{args, expected}`; the harvested `args` is not in the shape
`runRaw` expects.

**A summary line that contradicts its own list is worse than no summary.** gen-traces printed
`empty traces: 0` while listing 3 ZERO-step traces. The count must include the listed failures.

**Method note:** measuring `instrumentBlock()` directly overturned my own first diagnosis. The
agent's summary was directionally right (4 bad blocks) and its cause was wrong; had I trusted the
report I would have "fixed" the instrumenter and left bug B in place.

### 2026-10-02 — **row 3 complete: 150/150 guides execute, syntax-only 0**

`npm test`: **`Files: 150 (runtime-tested: 150, syntax-only: 0)`**, assertions **828 → 1453**,
0 failures. This is the gate v5 was ordered around — v4 built goldens and a differential oracle
for 41 guides that had **never been executed**.

- Cases **merged** from `catalog/cases.json` at run time rather than pasted in as 41 object
  literals. Hand-pasted entries rot on rename; that is the same disease as the `fns` duplication
  row 2 deleted. An inline `RUNTIME_TESTS` entry still wins, so this cannot silently override a
  hand-tuned case.
- **One authored case was wrong, and the suite caught it.** `02-two-pointers/02-is-subsequence`
  declares a **class** (`SubsequenceMatcher`, codec `ops`); the case had invented a shadowing
  `isSubsequence` wrapper that collided with the guide's own binding. Driving the class directly
  also bought a 7th case — *right-order-matters, not just membership* — which the wrapper could
  not express. Fixed in the data, not the harness.
- **The audit under-reported coverage and was corrected.** It parsed only the `RUNTIME_TESTS`
  literal, so after the merge 41 executing guides read as syntax-only. An audit that
  under-reports coverage is precisely how a gap hides. `runtimeTested === 150` and
  `syntaxOnly === 0` are now asserted in `--check`, so the audit fails before `npm test` runs.

### **KILL CRITERION: 0 wrong canonicals of 41** (threshold: >15 halts the visual product)

Verified three ways, because a clean result is worthless without evidence it could have failed:
1. The harness compares **executed** output against **independently authored** expectations —
   structurally non-tautological.
2. The hardest case's provenance traces to the guide's own Level 3 dry-run table
   (`01-merge-sorted-array.md`: `[1,2,3,0,0,0]/3/[2,5,6]/3 → [1,2,2,3,5,6]`).
3. A genuinely wrong case **was** found and did fail — `02-is-subsequence` — proving the check
   bites. 0 mismatches is a measurement, not an absence of measurement.

Regression green: `validate` 150/0 · `test:judge` 64/0 · `audit --check` 17/0 · `audit` DRIFT 14
(the 14 remaining are genuine plan errors, §1.1).

### 2026-10-02 — row 2 delivered on retry; all 41 guides have cases

- **Row 2** (`0ed65d4`) — the retry edited the file: 86 insertions / 70 deletions, **0 `fns`
  keys left**, and critically **`npm test` still reports exactly 828 assertions with 0
  failures**. That number not moving was the entire risk, and it was verified before the
  deletion, not after.
- **Row 3** (`47ef4fe`) — **41/41 covered, 0 mismatches.** Tranche B completed the roster.
  Two defects found in the *verifier* while checking it, both fixed rather than tolerated:
  it was scoped to tranche A's `01-array-string/` prefix (so tranche B's 21 entries showed as
  21 bogus "EXTRA" rows — the data was right, the check was stale), and its roster lived only
  in gitignored `scratch/`, which would have failed on a clean checkout. Roster is now
  committed as `__meta.roster`.
- **Row 0's self-check** (`7b58219`) — row 2 invalidated the invariant `fns+cases + script ===
  keys`. Replaced with two **stronger** checks: every entry is script- or cases-style (which
  proves the 56 migrated entries resolve names from the manifest), and no entry declares both
  `fns` and `script`. DRIFT 16 → 14; `--check` now **17 assertions, 0 failed**.

**Kill criterion: 0 wrong canonicals of 41.** Not close to the >15 halt. Verified twice —
tranche A's harness compares executed output against independently authored expectations
(structurally non-tautological), and the hardest case's provenance traces to the guide's own
Level 3 dry-run table.

**Still owed on row 3:** the splice. The 41 entries exist in `catalog/cases.json` but are not
yet in `RUNTIME_TESTS`, so `npm test` still says `syntax-only: 41`. That is one commit away
and is the next thing to do.

### 2026-10-02 — wave 4: rows 9, 10, 23 done; row 2 was a no-op

- **Row 9** (`c675ae2`) — Acorn instrumenter. 246 assertions, 12 fixtures, 450-block sweep.
  Step addresses are `{blockHash, block-relative offset}`; no absolute guide lines anywhere.
- **Row 10** (`998d15d`) — trace-runner. 167 assertions. **The region gate is data, not
  arithmetic**: the prelude carries the manifest's `regionTable` and the probe compares one
  integer. Grepped both files for `depth++`/`callDepth`/`stackDepth` — absent. That is the
  U3 fix holding, and it is what keeps 102 recursive blocks from producing empty traces.
- **Row 23** (`c5b6469`) — **Tier 1 complete.** 90 logic checks, 56 Playwright tests across
  both viewports. Read the screenshots rather than trusting the report: `stack` shows a call
  stack with a depth, `window` shows bounds, size and a per-step delta with in-window cells
  lit — the two presets where a bare array would have been a plausible fake.
- **Row 3 tranche A** (`1902631`) — 20 of the 41 now executable. **0 mismatches**, verified
  twice over: the harness compares executed output against independently authored values, and
  the hardest case's provenance traces back to the guide's own dry-run table. The kill
  criterion (>15 wrong of 41) is not close.

**Row 2 failed and is recorded as failed.** Its agent returned in 3m43s having edited nothing
— `test-runner.mjs` byte-identical to HEAD, no `sg` rule written, all 56 `fns` keys intact.
Investigating was not the same as delivering. It did establish the facts the re-run needs:
`fns` is an **array**, the split is **56/53**, and all 56 equal `[targetFn L1,L2,L3]` with
**0 mismatches** — so the deletion is safe and the assertion count cannot move.

Regression held: `validate` 150/0 · `test` 150 files / 109 runtime / 41 syntax-only / 450
blocks / 828 assertions / 0 failures · `test:judge` 64/0 · six row suites green.

### 2026-10-02 — regression caught and fixed: `docs/` walked as curriculum

Row 0b landed the rubric at `docs/rubrics/guide-quality.md`. All three guide scanners
recurse into `docs/`, and a rubric is a real markdown file that is not a guide — so the
walk found **151 guides**, `npm run validate` reported **4 bogus errors** against a
document with no solution blocks, and `npm test` failed on a `[STRUCT]` entry for it.

The walk had been passing by **luck**: every markdown file in `docs/` happened to match a
skip name (`00-INDEX.md`, `_TEMPLATE-subpage.md`, `00-IA-PLAN.md` via the PLAN rule).
One real document ended that. Fixed by naming `docs` in `SKIP_DIRS` in all three scanners
— `validate-guide.mjs`, `test-runner.mjs`, `audit-curriculum.mjs` — in `7722532`.

Restored: `Files: 150 (runtime-tested: 109, syntax-only: 41)`, `Syntax blocks checked:
450 | Runtime assertions: 828`, `Failures: 0` · `validate` 150/0 errors · `audit --check`
16/0. **The fix had to land in all three at once**, which is the whole lesson: "a guide"
must mean the same thing in the validator, the runner and the audit, or the 813-vs-450
lie is available again.

**Lesson recorded for every later row:** any new file under `docs/`, `scratch/`, `scripts/`
or a roadmapped directory must be checked against `SKIP_DIRS` before it is committed.
Rows 16 (`docs/traces/*.json`) and 28 (`judge/traces/`) walk adjacent territory.

### 2026-10-02 — wave 3: rows 7, 8, 17, 18, 22 done

- **Row 7** (`32fdb5f`) — 450-block manifest. `--verify` re-derives 450/450 from source,
  0 follow-up fences, 0 orphans. `targetFn` resolved on **0 nulls**. The `regionTable`
  is the row: on the LRU-cache guide `LRUCache` sits at depth 0 with its five methods
  and the `DLinkedNode` helper is suppressed at depth 1, which is exactly why plan
  finding U3 demanded a static table — a runtime depth counter would have emptied
  every recursive trace and V11 would have passed vacuously.
- **Row 8** (`9b3fbbe`) — golden differ reports the first differing step by index and
  field. E19 gets its own category: a stale `blockHash` says "regenerate", not
  "450 steps differ".
- **Row 17** (`81f0ee8`) — 5 codecs, no default branch, covering the catalog 150/150.
- **Row 18** (`3af029d`) — the deletion row, and it deleted. `PILOT_SLUGS` and the
  `['json','tree']` whitelist are both gone; judge specs now declare only their cases.
- **Row 22** (`2f2a7b6`) — **first pixels.** A two-sum table steps as a four-cell array
  with working controls, at both configured viewports. Screenshots retained.

All five verified by hand before commit. Regression held at every commit:
`npm run validate` 150/0 errors · `npm test` 150 files / 109 runtime / 41 syntax-only /
450 blocks / 828 assertions / 0 failures · `npm run test:judge` 64/0 · `audit --check` 16/0.

**Note for row 2:** `blocks.json` now resolves `fnName` for all 450 blocks with 0 nulls,
so dropping `fns` from `RUNTIME_TESTS` has a source to resolve against. Measured split
remains **56 `fns`+`cases` / 53 `script`**, not the plan's 81/28.

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
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
| 11 | Byte budget + degrade-to-`diff` | §7 | **done** | `ef65555` | `node scripts/test-trace-runner.mjs` → **269 assertions, 0 failures** (was 167). Caps derived from the measured 1 MB sandbox slot in ONE place and imported: `BYTE_BUDGET = slot × 12 × 0.6`, `EXEC_STEP_CAP = 200k`, `DISPLAY_STEP_CAP = 2k`, each with a `ponytail:` ceiling. **E20–E25 all covered**, incl. a 3 MB chunked trace where **a gap is a hard error**. `truncated.trace` is its own flag. |
| 12 | Execution/display caps, verdict isolation | §7 | **done** | `ef65555` | `n=5000` → display truncation, `truncated.display` set, **verdict asserted UNCHANGED** — the acceptance test that proves a trace cannot move a verdict. |
| 13 | **V3 green → envelope v1.1 frozen** | §7 | **done — v1.1 FROZEN** | `4c06aa1` | `node scripts/test-trace.mjs` → **85 assertions, 0 failures** (was 59). **V3 green over all 450 real goldens.** Freeze **proven to bite by hand**: deleting `codec` from one real golden turned V3 red (1 failure); restoring returned it green. S10 asserts `docs/trace-schema.json` documents exactly the frozen set and the validator enforces all 14 envelope + 10 step fields — and **names the one field row 5 does not enforce**. `delta` renders the failing step side-by-side and degrades gracefully when absent. |
| 14 | V2 replay determinism | §7 | **done (rewritten)** | `2f1b9cd` | `npm run test:trace` → **107 assertions, 0 failures** (was 85). **The obvious check is a tautology and was replaced**: `delta` is always `[]` in `full` mode (portal derives it), so a forward walk of derived deltas reproduces the next snapshot *by construction*. What a random jump actually needs: `stepCount === steps.length` (450/450), `n` exactly 1..N with no gap/duplicate, and snapshots name only watched ids — **53 862 snapshots checked**. 18 487 steps carry `snap:null` (exit/throw) and are counted, not assumed to be objects. |
| 15 | `gen-traces.mjs` → 150 goldens | §7 | **PARTIAL — 11/450 verdicts still wrong** (was 14, 17, 23, 26, 33, 52, 58) | `1cf4e0c` `6a194d6` | **450 goldens (150 guides × 3 levels), 450 passed `validateEnvelope`**, `empty traces: 0` — now counted from the same tally failures land in. **Determinism proven**: two runs byte-identical (`sha256 76135f71…`). 54 assertions 0 failures. Cases resolved from 3 authored sources, never invented. E32 honoured: full traces ignored, 450 `*.head.json` committed (mean 1255 B; **10 exceed the ~2 KB cap, largest 2.9 KiB**). |
| 16 | `docs/traces/*.json` static copies | §7 | **done — heads only, 1.9 MB** | `df49a3f` | `node scripts/test-doc-traces.mjs` → **17 assertions, 0 failures**. **Shipped the 450 `*.head.json`, NOT the 35.1 MiB raw corpus** — the portal already loads 3.09 MB per page view and §8 names the portal the scale wall. **Proven serverless by `curl`: `traces/index.json` → HTTP 200 / 154538 B / parses; a head → HTTP 200 / 1082 B / parses.** Publishing is idempotent and removes orphaned heads. Whole tree gitignored. |
| 17 | Codec registry + 5 codecs | §7 | **done** | `81f0ee8` | `npm run test:codecs` → **275 assertions, 0 failures**. 5 codecs `json`/`tree`/`list`/`ops`/`graph`, **no default branch** — unknown name throws naming the slug. Covers catalog **150/150, leftovers `[]`, unmapped 0**. 35 round trips, each with a mutant that FAILS. All 6 E28 equivalence kinds. |
| 18 | Widen or delete `problems.mjs` | §7 | **done** | `3af029d` | **Deletions, not a widening.** `PILOT_SLUGS` gone; pilot registry now = the files in `judge/tests/`, identity from `catalog/problems.json`. Slug/fnName/codec removed from all 5 judge specs (they keep only `tests`). `['json','tree']` whitelist deleted — it silently rejected 3 codecs covering 42 guides. Keyed by path (E30); shared slug = loud error. `npm run test:judge` → **64/0**. |
| 19 | V4 differential harness | §7 | **done — 36 divergences, 0 wrong guides** | `685f7bf` | `npm test` → **426 execs, 36 divergences across 12 guides**, each with seed + shrink trace + minimal input. Runtime assertions **1453 → 1898**; `Files: 150 / syntax-only: 0 / Failures: 0` held. **All 36 adjudicated by hand: every one is the GENERATOR leaving the input domain** (`[[1]]` is not a `[start,end]` pair; `"j"` is not an RPN token; `"v"` is not an absolute path; `"t"` is not a binary digit). L3 verified correct on well-formed input. **12/150 = 8 %**, well under the 25 % adjudication kill threshold. |
| 20 | V11 region isolation + non-vacuity | §7 | **done** | `2f1b9cd` | **All 106 `selfRecursive` blocks emitted steps** (plan said 102) — the vacuity hole of plan §1 U3 is now closed in data. Every step proven to address `(blockHash, block-relative offset)` **inside its own block**, so no step originates outside the region. Emptying any golden flips it red. |
| 21 | Tier-1 table player | §7 | **done** | `f4e7a3d` | `docs/dryrun/table.js` → **450 tables parsed across 150 guides**; thin = **27 tables / 23 guides, matching row 0's list exactly** (reconciled by me, diff empty). Dependency-free, browser-safe: **no `node:`/`fs`/`require`**, exports `parseGuide`/`parseAll`/`findThinTables`/`THIN_ROW_LIMIT`. `$…$` cells preserved verbatim. |
| 22 | `array` primitive — **first pixels** | §7 | **done** | `2f2a7b6` | `npm run test:dryrun-player` → **40 checks, 0 failures**. Playwright passes at **both** configured viewports (1440×900 + Pixel 7); screenshots `scratch/dryrun/*.png` (untracked). Spec clicks forward ×2 asserting the array **changed**, then back. All 3 levels animate (decision 2). Thin tables say so rather than rendering an empty frame. |
| 23 | Tier-1 presets: stack/matrix/window/bits | §7 | **done** | `c5b6469` | `node scripts/test-dryrun-render.mjs` → **90 checks, 0 failures**. `npx playwright test tests/dry-run.spec.mjs` → **56 passed** across desktop + mobile. Each preset shows its own concept, verified by eye: `stack` renders a **call stack with a depth**; `window` shows **bounds 1..4, size, and a per-step delta (+4/-0)** with in-window lit and out-of-window dimmed — not an array in disguise. Screenshots in `scratch/row23/` (untracked). **Tier 1 complete.** |
| 24 | Tier-2 presets + overlay | §7 | **done** | `7f75941` | `node scripts/test-dryrun-render.mjs` → **141 checks, 0 failures** (Tier 1's 90 still green). `npx playwright test tests/dry-run.spec.mjs` → **100 passed** both viewports. 4 presets + `dp-table`/`recursion-tree` overlays, **canonical level only** (decision 2). Screenshots `scratch/row24/` (12, untracked). Verified by eye: `tree` draws real edges + a level readout; `recursion-tree` shows depth, open frames and the base-case hit. |
| 25 | One table-driven Playwright spec | §7 | **done** | `HEAD` | `npx playwright test tests/dry-run.spec.mjs` → **126 passed** (63 × 2 projects), exit 0 (was 110/55). Full `npx playwright test` → **272 passed, 18 skipped**, exit 0 (was 256/18). **11 surfaces × 4 table-driven tests.** Per scenario, one viewport: S1 **38** · S2 **10** · S3 **16** · S5 **11** · S4 **0 (deliberately unbuilt)**; both viewports: 76/20/32/22. 0 tests untagged. validate 150/0 · npm test **1898** · render **141** · player **40** · doc-traces **17** · axe clean in player. Screenshots `scratch/row25/` (22 = 11 × 2, untracked). |
| 26 | V5 event-floor gate | §7 | **done** | `2f1b9cd` | Floor is **derived from data**: **83 distinct values** across 150 problems (min 1, max 1962), pinned per level in `judge/traces/manifest.json`. No golden below its own floor (450 compared); dropping one step from any would fall under it. |
| 27 | V9 table↔trace cross-check | §7 | **done** | `2f1b9cd` | **140/150 authored L3 tables share a value with their trace.** **10 reported UNCOMPARABLE, not counted as agreement** — a table with no numeric tokens or a trace under 3 steps has nothing to cross-check, and calling that drift would be dishonest the other way. `override` guard rejects a declared-but-unwatched identifier, judged against the code's declared names, not every English word. |
| 28 | `trace-head.json` per problem | §7 | **done** | `HEAD` | **450 heads, mean 766 B, max 1392 B, 0 over the 2048 B cap** (was mean 1255 B, 11 over, max 2993 B). `npm run test:trace` → **117 assertions, 0 failures** (was 107). See the 2026-10-02 section at the end. |
| 29 | V8 scan → repair thin tables | §7 | **done — 25 of 27** | `971b344` | `npm run audit` → thin tables **27 → 2**. Rows derived from golden-trace steps with cited indices; where a table's input disagreed with the trace's canonical case, the trace won. **2 left deliberately** (`length-of-last-word` L2, `kth-largest-element` L1): each traces to exactly **2 steps**, so 3 rows cannot be derived and a padded row looks like evidence while being none. validate 150/0 · player 40/0 · **110 Playwright green**. Also surfaced L1 code defects (`rotate-array` L1 never returns) — reported, not patched. |
| 30 | Wire `verify` + CI cache + time budget | §7 | **done** | `159607d` `0e05af2` | **`npm run verify` green end to end for the first time: exit 0, 224 s measured, 450 goldens, 256 Playwright tests.** CI half earlier (`159607d`): `pull_request` trigger, `cache: 'npm'`, `timeout-minutes: 15`, Pages steps gated on `push`. `0e05af2`: 11 npm scripts registered, `verify` runs audit:check → gen:traces → validate → test → judge → chat → trace/envelope/serialize/validate/codecs/instrument/cases/doc-traces/renderers → e2e → build. `gen:traces` precedes `test:trace` because goldens are gitignored (E32). **Wiring the gates caught 2 real defects**: `gen:traces` flaked under load (flatten-binary-tree L1 TLE; generator now widens only its OWN budget to 9 s, judge stays 3 s) and `test-codecs` was pinning a stale codec interface (row 17's `name/encode/decode` vs row 15's added `owns`/`acceptsWire`/`toWire`/`fromWire` — assertion moved with the contract, still pins a CLOSED uniform surface). |
| 31 | Design pass: timing/contrast/keyboard | §7 | **done** | `5630110` | **110 Playwright tests pass** across both viewports (was 100; +5 design-pass × 2 projects). axe-core (devDep, test-only) clean **inside the player**. **Found and fixed a real bug**: `scrollable-region-focusable` at 390px — `.viz-array.dr-array` overflows horizontally with no `tabindex`, so a keyboard user could not scroll it. Fixed at all 3 construction sites with `tabindex`/`role`/`aria-label`. Invisible at 1440px — exactly why F11 wants both viewports. |
| 32 | "Unverified" = derived function | §7 | **done** | `HEAD` | The integration step the 2026-10-03 entry flagged is CLOSED: `scripts/test-trace.mjs` no longer carries a second copy of the predicate. The inline three-way branch is deleted — the S14 loop routes `v9Verdict` (`:1178`) and nothing else — and `declaredIn` / `namesIn` / `overrideOk` are imported from `scripts/lib/v9.mjs` (`:1162-1163`). **+3 gates** (`:1226-1254`) assert no local definition can return. `npm run test:trace` → **151 assertions, 0 failures** (was 148), published line **byte-identical**: `142/150 agreed, 8 uncomparable`. Gate proven RED first, naming `declaredIn at test-trace.mjs:1190`. Fidelity differential, old body vs `v9Verdict` over all 150 guides → **0 mismatches**. Portal badge re-proved live. See the 2026-10-03 section at the end. |
| 33 | V12 logging-only prediction events | §7 | **done** | `ebe75e3` | `npm run test:judge` → **76 assertions, 0 failures** (was 64; **+12** for the event store). Player 40/0, validate 150/0. **Logging only** — no score, nothing rendered. Browser half writes localStorage; aggregate half is `readPredictionEvents`/`recordPredictionEvents` in the **existing** `kv.mjs` (K3 reuse), capped at 500 with the oldest dropped. Records **reached-the-end only** — correctness is deliberately not recorded, since nothing can know it. **No endpoint added**: the plan names none, and a route nobody calls is the surface P1 cuts. |

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
| C1 | S1–S5 are undefined | **they are not** — recovered verbatim from `DRY_RUN_ENGINE_PLAN_v4.md:107-111`; row 25 unblocked, nothing invented | editing this row |
| C2 | Row 32 unblocked by V9 | **no** — G5/A2 need `V9 ∧ V10`; V10 *is* row 25, so row 32 is downstream of it | editing this row |
| C3 | Row 15's residual 58: replay the derivation, or record the observed return? | **replay it** — the harvest records which script-declared derivation the assertion applied and `buildBundle` replays it, so all 450 verdicts keep ONE meaning (a human wrote that value). Rejected: stamping a weaker `observed` basis on 58 blocks (mixed semantics nobody can see in the data) | **trust boundary** — authored-script functions now execute inside the driver; needs a threat-model note |
| C4 | Row 25 covers S4? | **no** — row 25 certifies S1/S2/S3/S5 against `v4:107-111` and reports S4 as deliberately unbuilt (§10 lists the scoring UI as not-built; row 33 shipped logging-only) | owner un-gates the scoring UI |

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

### 2026-10-02 — finding: **S1–S5 are referenced 62 times and defined nowhere**

Plan §7 tags almost every row with a scenario id (`S1`, `S2`, `S3`, `S4`, `S5`), §10 lists
"Playwright evidence: **S1–S5** + every preset" as a definition-of-done line, and rows 21/22/25/31
name them in their Verify columns. Counts across the file: **S1 ×18, S3 ×16, S2 ×11, S5 ×11, S4 ×6**.

**There is no legend.** No section defines them, and they are not in this ledger either. So §10's
finish line names five criteria that do not exist as written artefacts.

This matters more than a missing convenience, because the ids are the *only* thing that ties a row
to its acceptance evidence. A reader cannot tell whether row 22 is done — the ledger can point at
"40 checks" but cannot say which of the five scenarios that was. It is the same defect as the
813-vs-450 fence lie in a different costume: a predicate nobody pinned.

**Not invented here.** Writing five definitions mid-build would let me grade my own work against a
standard I chose after the fact, which is exactly how a vacuous check gets in. Row 25 and §10 need
the owner to say what S1–S5 are, or to ratify the reading inferred from each row's Verify column.
Until then the Playwright evidence is filed per-row, not per-scenario, and this gap stays open.

### 2026-10-02 — **finding: 139 of 450 goldens record a FAILED verdict. Row 15 is partial.**

Found while sizing row 28's head files, not by a test. `validateEnvelope` passed **450/450** and
`npm test` is green, yet **139 goldens across 47 of 150 guides** carry `verdict.passed === 0`.
**130 of the 139 have no `error` at all** — they are silently wrong, which is the exact failure
mode this whole system exists to prevent, and the schema validator is blind to it by construction.

**Blast radius is the verdict only.** The steps are real and non-empty — `merge-sorted-array` L3
carries **21 genuine steps** — because the traced run builds its own bundle and only the *raw*
verdict run goes through `buildBundle`. So the traces are usable; the pass/fail numbers are not.

**Two causes, both in `api/_lib/problems.mjs`'s `buildBundle` driver, both reproduced:**

1. **In-place mutators** (`json`, 45 blocks). `01-merge-sorted-array` L3's canonical is
   `function merge(nums1, m, nums2, n)` with **no `return` statement** — idiomatic LeetCode. The
   driver does `got = __FN__.apply(null, t.args)` and compares that `undefined` against
   `expected: [1,2,2,3,5,6]`. It can never pass. The authored case script already knows this: it
   wraps the call as `(nums1,m,nums2,n) => { merge(nums1,m,nums2,n); return nums1; }`.
2. **Scalar-returning tree targets** (`tree`, 48 blocks). `maxDepth(root)` returns the **number**
   `3`, but the driver's tree branch unconditionally encodes the result:
   `__treeToArray__(3)` → `[null]`, compared against `expected: 3`. Never equal.

`list` (24) and `ops` (22) follow the same shape.

### Driver fix landed — 139 → 58 zero-pass. **Row 15 is still PARTIAL.**

`api/_lib/problems.mjs` no longer carries its own inline codec. `api/_lib/codecs.mjs` now owns
decode, encode and the void/in-place case, and the driver consults it. **`6a194d6`.**

| Codec | zero-pass before | after |
|---|---|---|
| `list` | 24 | **0 — fixed** |
| `tree` | 48 | 12 |
| `json` | 45 | 24 |
| `ops` | 22 | 22 — untouched |
| **total** | **139** | **58** (silent 130 → 49) |

Suites held: `test:judge` 76 → **96 (+8, −0 removed — coverage added, nothing weakened)** ·
`test-trace-runner` 269/0 · `npm test` **1898 unchanged** · frozen envelope 85/0 · validate 150/0 ·
audit --check 17/0.

**The residual 58 is characterised, not excused.** All **20** residual guides fail *every* case,
which says the harness never lands one, rather than nearly landing one. Measured:
- the **22 `ops`** residuals are all class targets (`RandomizedSet`, `MinStack`, …) — the
  `Reflect.construct` case, still outstanding;
- the **12 `tree`** residuals include `isSameTree(p, q)`, whose canonical takes **two** tree args
  while the harvested args carry one, so it fails on **arity** (`cannot read property 'val' of
  undefined`) before any comparison happens.

So a residual is a case shape the driver cannot yet express. Both remaining classes need the
**harvest** in `scripts/gen-traces.mjs` to record arity and the op list — which this row did not
edit and should not, since row 15's harvest is the thing to change. **Row 15 stays PARTIAL.**

### Row 19's 36 divergences across 12 guides — adjudicated, and the kill criterion holds

`npm test` → `divergences: 36` over **12 guides**, 426 execs, tier=pr, `Failures: 0`. Every one
carries a **seed, a shrink trace and a minimal input**. Plan §7's Phase-4 kill criterion is "**>25 %
of equivalence kinds need manual adjudication**" — 12 of150 guides is **8 %**, so the oracle is not
the problem. But "not the oracle" is not "not bugs", so here is the adjudication.

**The dominant cause is the GENERATOR producing out-of-domain inputs, not wrong guides.**
`diffPerturb` perturbs *elements* of an authored case; it never perturbs *shape*. Verified cases:

| Guide | Minimal input | Verdict |
|---|---|---|
| `06-intervals/03-insert-interval` | `[[1]], [2]` | **generator artifact.** `[[1]]` is not a valid `[start,end]` pair, so `intervals[0][1]` is `undefined` and L3's phase-1 test reads `undefined < 2`. On well-formed input L3 is **correct**: `[[1,3]]+[4,9] → [[1,3],[4,9]]`, `[[1,5],[6,8]]+[4,9] → [[1,9]]` |
| `07-stack/04-evaluate-reverse-polish` | `["j"]` | **generator artifact**, and L1 is the weaker code. L3 is *specified* to throw `Invalid token: ${t}` (guide line 18 of the block); `"j"` is not a token any statement admits |
| `15-math/06-max-points-on-a-line` | not shrunk | **generator artifact** — L3 "no answer within 20 s" on an input outside the drawn domain |
| `19-graph-bfs/01-snakes-and-ladders` | not shrunk | same shape |
| `18-graph-general/05-course-schedule` | `[0,[[0]]]` | **generator artifact** — a self-loop `[[0]]` with `numCourses: 0` |

The agent had already caught two of this class itself and documented them in the code: an unsorted
`[2,0,2]` handed to a sorted-input problem, and `[-2]` drawn for `plus-one` digits. **Shape
perturbation is the remaining hole**, and `[[1]]` is its proof.

**Genuinely worth a guide's attention (input IS in-domain, L3's answer differs):**
`07-stack/02-simplify-path` on `["v"]` → L1 `"v"`, L3 `"/v"`. Both are defensible; L1 returns
`current === '' ? '/' : current` and L3 returns `'/' + stack.join('/')`, which differ on a single
segment. LeetCode's own constraint is an absolute path beginning `/`, so `["v"]` is again
out-of-domain — **also a generator artifact.** `22-bit-manipulation/01-add-binary` on `["t","d"]`
is the same: not a binary digit.

**Net: 0 confirmed wrong canonicals from row 19.** Every divergence traces to the generator leaving
the input domain, and the two level-order guides it reported (`single-number`, `single-number-ii`)
differ only because the harness fed `[1,1]` / `[0,1]`, which violates the "exactly one appears
once, the rest three times" premise those problems state.

**So the fix is in the generator, not the guides** — and it is the same class of bug row 19's own
comments already document twice. Shape perturbation (interval arity, path absoluteness, token
validity, digit range) belongs beside the numeric domain check. **Recorded, not fixed**: `test-runner.mjs`
is the row's file and the correct place to change it is a follow-up, not a drive-by edit here.

### The unifying root cause, found by checking all four codecs

Checking `list` and `ops` alongside `json` and `tree` collapses three symptoms into **one**:

| Codec | Symptom | Why |
|---|---|---|
| `ops` (22) | `TypeError: class constructors cannot be invoked without 'new'` | driver does `__FN__.apply(null, args)`; the traced run uses `Reflect.construct` |
| `list` (24) | `ok=false`, no error | guide wants `ListNode` objects, harvested args are plain arrays |
| `json` (45) | `ok=false`, no error | guide mutates in place and returns nothing |
| `tree` (48) | `ok=false`, no error | guide returns a scalar; driver wraps it in `__treeToArray__` |

**One cause: `buildBundle`'s driver calls the target DIRECTLY with the harvested args, and that
only works when the target's signature happens to match the args exactly.**

Every authored case is a small **script**, and those scripts routinely *adapt* before calling the
target — `(nums1,m,nums2,n) => { merge(nums1,m,nums2,n); return nums1; }` converts a mutation into a
return value; `new SubsequenceMatcher(t).isSubsequence(s)` constructs a class; an add-two-numbers
script builds `ListNode`s from arrays. The harvest records the args **as the script received them**,
then the driver replays them against the **bare target**, skipping the adaptation the script
performed. Row 3 wrote those adapting wrappers by hand; the driver cannot see them.

So this is not four bugs. It is one bug with four faces, and the fix is correspondingly smaller
than it looked: **the verdict must come from running the authored script, not from re-invoking the
target behind its back.** Everything else — the class wrapper, the in-place comparison, the tree
encode — falls out of that.

**The codec asymmetry names the defect.** RUNTIME_TESTS-sourced guides, pass vs fail by codec:

| Codec | fails | passes |
|---|---|---|
| `json` | 10 | **57** |
| `tree` | **16** | 2 |
| `list` | **8** | 3 |
| `ops` | **6** | 3 |
| `graph` | 0 | 4 |

`json` — the only codec whose branch is a bare `__FN__.apply(null, t.args)` — passes 57 and fails 10.
Every codec with a **conversion** branch fails far more than it passes. That is the shape of a bug
in the conversion, not in the guides: `graph` has no branch at all and never fails.

**And 0 of the 31 `cases`-shaped guides fail**, while 7 of the 10 `script`-shaped ones do. The
`cases` shape holds raw `{args, expect}` triples with no adaptation, and the driver replays those
correctly. The `script` shape wraps the call (`merge(...)` then `return nums1`; `new
SubsequenceMatcher(t).isSubsequence(s)`), and the driver cannot see the wrapper. Direct confirmation
of the cause.

**One line explains the whole discrepancy.** `scripts/test-runner.mjs`'s `buildFnHarness` calls the
target as a bare `__fn(...__args)` — **no codec conversion, no wrapper, no class special-case**.
`api/_lib/problems.mjs`'s `buildBundle` calls it through `eval(__FN_NAME__)` and then converts the
result per codec. Same guide, same code, same authored cases: the bare harness passes 1453
assertions, the converting driver fails 139 goldens. The conversion is the entire difference.

**Consequence for row 19.** Its differential harness builds on `buildFnHarness`, so it is
**immune** to this bug and its divergence count can be trusted. Rows 15 and the goldens are the only
things affected. That is worth stating plainly, because "the differential oracle is green" would
otherwise read as evidence the golden verdicts are fine.

**Proof the guides are correct and the DRIVER is wrong — same guide, two harnesses, opposite
results.** `npm test 01-array-string/01-merge-sorted-array.md` → `✅ [PASS] (6 assertions)`, using
the same canonical code and the same authored cases through `test-runner.mjs`'s harness. The golden
for that guide records `verdict {passed: 0, failed: 6}`. The guide cannot be both. It passes under
one driver and fails under the other, so the defect is in the driver and nowhere else.

**Not level-specific.** The four representative failures all happened to be L1/BruteForce variants,
which looked like a pattern. Measured across all 450: L1 **47/150 (31%)**, L2 **46/150 (31%)**, L3
**46/150 (31%)**. Uniform, so the cause is the driver's return-value comparison, not the level.

**The deeper problem is a second source of truth.** `buildBundle` carries its own inline
`__arrayToTree__` / `__treeToArray__` / `__ser__` — a hand-rolled codec that **duplicates row 17's
`api/_lib/codecs.mjs`**. Plan finding H1/P3 says nothing re-declares a codec; row 18 deleted
`PILOT_SLUGS` from this file but left the inline conversion behind. So the driver grades answers
with conversion rules that no test, schema or codec registry ever sees.

**Correction to my own earlier claim.** `1cf4e0c` says "450 goldens, 450 passed `validateEnvelope`".
That is true and it is not sufficient: `validateEnvelope` checks *shape*, and a golden whose verdict
is wrong is shape-perfect. I treated a schema pass as a correctness pass. The honest status is
**rows 15 and 19 are blocked on the driver**, and `npm test`'s green says nothing about either.

**Fix belongs in the driver, not the goldens** — and the smallest correct fix is to delete the
inline codec from `buildBundle` and route both the traced and raw runs through `codecs.mjs`, so one
registry decides what a return value means. Rows 11/12's agent is in that file right now; this must
not be fixed alongside them.

### 2026-10-02 — row 31 done: a real accessibility bug, invisible at 1440px

**110 Playwright tests pass** across both configured viewports (100 before; +5 design-pass tests ×
2 projects). `axe-core` is clean **inside the dry-run player**.

**The bug row 31 found is mine and was viewport-dependent.** axe's `scrollable-region-focusable`
failed at **390px only**: `.viz-array.dr-array` overflows horizontally, and with no `tabindex` a
keyboard user could not scroll it at all. Fixed at all three construction sites — the array
primitive, the Tier-1/2 stage, and the Tier-2 overlay — with `tabindex="0"` + `role="group"` + an
`aria-label`, so the region is both reachable and announced. **Invisible at 1440px**, which is
precisely why plan F11 insists on both viewports rather than the one a developer is looking at.

**Three pre-existing `serious` violations found and deliberately NOT adopted.** A whole-page axe
run reports them; none is in `docs/dryrun/`:

| Rule | Target | Where |
|---|---|---|
| `aria-hidden-focus` | `#ltcPanel` | chat widget (`docs/chat-widget.js`, last touched `71d9feb`) |
| `color-contrast` | `.ltc-empty-privacy` | chat widget |
| `scrollable-region-focusable` | `.code-wrap … > pre` | portal chrome |

They are real and they predate this project. Fixing them inside a dry-run commit would bury another
subsystem's a11y debt in someone else's change, and the chat widget carries **395 assertions** whose
show/hide logic owns that `aria-hidden`. The axe run is therefore **scoped to the player**, and
widening it is a one-word change once the debt is paid. **This is a deferral, not a pass** — the
portal as a whole is not yet WCAG-clean, and this ledger says so.

**Two of my own tests were wrong before the code was:**
- Asserting a focus outline after programmatic `.focus()` tests nothing — `:focus-visible`
  deliberately does not match it. That test failed against a *correct* player. It now navigates by
  `Tab`, which is what a keyboard user does.
- `prev` is `disabled` at step 0, and a disabled button is correctly not focusable. Asserted as
  its own contract rather than "fixed".

Contrast was not hand-rolled: axe's `color-contrast` rule resolves the real background through the
ancestor chain, which is the part a hand-written WCAG ratio gets wrong on a page with translucent
panels.

### 2026-10-02 — row 30's CI half: **CI was never running on this branch**

`deploy.yml` triggered on `push: [main, master]` only. Every row of this plan was committed to
`DRY_RUN_ENGINE` and **CI ran on none of them** — so the plan's own row-30 acceptance criterion,
"CI log shows the npm cache hit", had no CI log to be evidence in. Found by reading the workflow
against the plan, not by a failing build.

Fixed in `159607d`: `pull_request` trigger, `cache: 'npm'`, `timeout-minutes: 15`, and the three
Pages steps gated on `push` so a PR verifies without publishing. Verified by parsing all 13 steps
— **no deploy step is reachable on a pull_request**. (My first leak-check used a multi-line
regex lookahead, which JS `.` cannot do; it reported a false LEAK. Re-checked line by line.)

`timeout-minutes: 15` is deliberately **not** the measured step total. Measured on this machine:
validate 1.36 s · test 15.64 s · judge 4.03 s · chat 14.84 s · e2e (dry-run spec) 16.70 s ≈
**53 s of steps**, plus `npm ci`, `npx playwright install --with-deps chromium` and `npm run build`.
Sizing the budget to 53 s would fail a slow runner and ignore install overhead entirely.

**Known residue, not hidden:** the job still declares `environment: github-pages` at job level,
so a PR run depends on that environment having no protection rules. It does not, so it passes —
but if a rule is ever added, PRs would block on approval. Splitting verify from deploy would remove
the coupling; that is a bigger restructure than this row earns.

### 2026-10-02 — **row 15 done: 450 goldens** (after fixing the two bugs it found)

**`450 goldens · 450 passed validateEnvelope · empty traces: 0`** — corpus 35.1 MiB, largest
7.3 MiB. Determinism **proven, not asserted**: two consecutive runs are byte-identical
(`sha256 76135f71…`). The 3 `Math.random`/`Date` guides are pinned to a deterministic canonical
case, never a random input (E26). Cases resolve from three authored sources and are never
invented — a golden whose `expected` came from the code under test could never disagree with it.

Both bugs row 15 surfaced are now fixed, and **neither was where I first blamed**:

- **`dca56fc` — a codec misclassification, not an engine bug.** `codec: tree` has one meaning to
  the driver: the target consumes a level-order array (`__FN__(__arrayToTree__(t.args[0]))`).
  But `suggestCodec` fired on merely *mentioning* `TreeNode`, so it also labelled guides that
  **build** a tree from raw arrays — `buildTreeMap(preorder, inorder)`,
  `buildTree(inorder, postorder)`, `sortedArrayToBST(nums)`. The driver converted argument one
  and dropped the rest, so `inorder` arrived undefined. The discriminator is the target's own
  parameter list: a node-ish name (`root`, `node`, `p`, `q`, `k`) walks a tree; all-raw names
  (`nums`, `preorder`, `inorder`) allocate their own. **Undecidable stays `tree`** — a heuristic
  nobody has read must not reclassify 60 blocks on a guess. `tree` 63 → 54, `json` 317 → 326.
- **`f9f0efe` — the 72-block shared-declaration bug** (previous commit).

**A summary line that contradicted its own list.** `empty traces: 0` printed while three
zero-step traces were listed three lines below, because `assertNonVacuous` **throws** into
`failures` while the empty-trace tally only ever saw envelopes that survived. The error is now
tagged `err.vacuity` and both paths feed one tally. *A summary that contradicts its own list is
worse than no summary.*

**E32, honestly:** 450 `*.head.json` committed, mean 1255 B, 552 KiB total. **10 exceed the ~2 KB
plan cap** (largest 2.9 KiB) — recorded, not hidden. Trimming them is row 28's call.

Regression green: `test` 150 files / 1453 assertions / 0 failures · `validate` 150/0 ·
`test:judge` 64/0 · `audit --check` 17/0 · `test:gen-traces` 54/0 · `gen-blocks --verify` 450/450.

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

### 2026-10-02 — **correction: S1–S5 ARE defined. They are in the repo.**

The finding at line 234 ("referenced 62 times and defined nowhere") is **wrong, and
it was wrong because only v5 was searched.** The ids are defined in this repo's own
earlier plan versions, and v5 dropped the scenario *table* while keeping the ids in
§7's Scenario column:

| Where | Lines | Contents |
|---|---|---|
| `DRY_RUN_ENGINE_PLAN_v4.md` | **107–111** | S1 Happy · S2 Edge · S3 Regression · S4 Learning · S5 Fidelity — full pass condition, real-surface artefact, automated test |
| `DRY_RUN_ENGINE_PLAN_v3.md` | 83–87 | same five ids, same names |
| `DRY_RUN_ENGINE_PLAN.md` (v1) | 56–58 | S1–S3 only — the original form |

No renumbering ever happened: v3 and v4 agree id-for-id and name-for-name with each
other, and v5's usages (`S1,S3` / `S1,S2,S4,S5` / `S5` …) are consistent with v4's.
So the contract is **recovered, not invented** — which was the stated condition for
reopening row 25. Repeating the measurement: `grep -rn "S[1-5]" DRY_RUN_ENGINE_PLAN_v*.md`.

**Two consequences that were filed wrong:**

1. **Row 25 is not blocked on the owner.** Its scenario column (`S1,S2,S4,S5`) is
   satisfiable against v4:107–111.
2. **Row 32 is not unblocked — it is *downstream of row 25*.** G5 and A2 both say the
   label clears when **`V9 ∧ V10`** are green. V9 is row 27 (`2f1b9cd`, landed). V10 is
   **"Real-surface QA (Playwright)"** — `v4.md:296` — i.e. **row 25**. The handoff
   called row 32 unblocked because only V9 was checked.

**S4 remains genuinely out of reach**, for a different reason than "undefined":
v4:110 requires a *scored prediction UI*, and §10's "Deliberately not built" list names
the scoring UI, the custom-input form and degraded mode. Row 33 shipped **logging
only, no UI, no scoring**, by design. So S4's Playwright surface does not exist and
building it would contradict §10. Row 25 certifies S1/S2/S3/S5 and **reports S4 as
deliberately unbuilt** — it does not silently drop it.

### 2026-10-02 — **row 15's residual 58 re-measured: ONE root cause, not two**

The handoff names two classes — "22 `ops`" and "12 `tree`". Measured against the
committed heads at `2be142d`, the 58 zero-pass blocks split **22 `ops` / 24 `json` /
12 `tree`** across **20 guides**, and the two named classes do not explain the 24.

Every one of the 58 is the same defect, stated once:

> `harvestCases` records `expected` = `arguments[1]` of the asserter — **the value the
> authored script asserted, after its own derivation**. `buildBundle` compares that
> against the target's **raw return**. Wherever the script derives before asserting,
> the two live in different spaces and the verdict can never be anything but wrong.

Evidence: the first argument of every failing block's assertion, read off the AST of
the authored script (`scripts/test-runner.mjs` `RUNTIME_TESTS[].script` +
`catalog/cases.json[].script`, 63 scripts extracted):

| First-arg shape | Blocks | Guides | The derivation |
|---|---|---|---|
| bare call to a script-declared normaliser | 24 | 8 | `normCombos`, `normPerms`, `isPeakIndex`, `inorderVals`, `treeToArray`, `quadToGrid`, `collectRightChain` |
| call on / member of a constructed instance | 22 | 8 | `exerciseCache`, `exerciseIterator`, `exerciseMedian`, `exerciseTrie`, `exerciseWD`, `m.getMin()`, `m.top()` |
| `call:fn` — a **two-argument** target | 12 | 4 | `isSameTree(p, q)`, `kthSmallest` |

Worked example, `14-backtracking/02-combinations`:
`assertEq(normCombos(fn(4, 2)), EXPECTED_COMBOS)` where
`EXPECTED_COMBOS = normCombos([[1,2],[1,3],…])`. The harvest records
`args: [4,2]`, `expected: ['1,2','1,3',…]`. The driver calls `combine(4,2)`, gets
`[[1,2],[1,3],…]`, and compares it to the **normalised** form. 0/9, every case.

**One genuinely separate bug, also confirmed:** the spy's tree level-order preference
(`gen-traces.mjs:411`) keeps `__F__` — the *helper's* single argument — and **drops the
target's second argument**. `assertEq(fn(arrayToTree([1,2,3]), arrayToTree([1,2,3])), true)`
records `args: [[1,2,3]]`. `isSameTree(p, undefined)` → *"cannot read property 'val' of
undefined"*, which is the arity failure the ledger recorded. That one is a real
harvest bug and needs no design decision.

**Not decided here.** Making the driver compare in the space the human asserted in
requires the harvest to record the derivation and the driver to replay it — which means
authored-script functions execute inside `buildBundle`. That is a change to what
`{args, expected}` means and a new trust path, so it is an **owner decision**, taken
before any code. The alternative (record the observed raw return as `expected`) makes
those 58 verdicts mean something different from the other 392, which is the
mixed-semantics failure this ledger has already paid for twice.

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

### 2026-10-02 — row 28 done: every committed head is a summary, under E32's cap

Row 15's note said 10 heads over / 2.9 KiB. **Re-measured, and it was stale**: the truth
before this row was **450 heads, mean 1255 B, 11 over the 2048 B cap, largest 2993 B**
(`09-binary-tree-general__10-lowest-common-ancestor.L2.head.json`). After: **mean 766 B,
max 1392 B, 0 over cap** — met by the artefact's shape, not by moving the cap.

**The size driver was measured, not guessed.** The head embedded the WHOLE step
(`first: envelope.steps[0]`). `snap` — the serialised watch state — is the blowup: on the
binary-tree and trie guides it is a nested Map of hundreds of bytes, and `operands` rides with
it. `out` is already the truncated human summary (`"Step 1 · const parent = new Map(…"`), so
it is the payload that survives; `delta`/`cond`/`override` are per-step state and belong in
the full golden. The head step is now `{n, line, out}`, every value COPIED — see the second
defect. Head size was re-measured across three candidate shapes before settling on this one.

**A second, unrelated defect the new gate caught: `{"__ref":N}`.** Row 6's `stringify` spends
one id table per call and emits `{"__ref":N}` on the second sighting of a live object. When a
golden has exactly ONE step, `steps[0]` and `steps.at(-1)` are the same object — so **6 of the
450 committed heads shipped `last: {"__ref":2}`**: an artefact that cannot be read without the
stringifier that wrote it, and that no consumer can parse into a step. Fixed by copying each
value in `headStep` instead of aliasing the step object. **0 `__ref` tokens remain.**

`npm run test:trace` → **117 assertions, 0 failures** (was 107; **+10** — six over the 450
heads, four negatives). Every head is compared against its own full golden **on disk**; a
golden that is missing is reported BY NAME, never silently skipped, because checking 449 of 450
is how a gate becomes a gate that proves nothing. **The gate was proven red by hand**: bumping
`stepCount` in `05-hashmap__06-two-sum.L3.head.json` turned it
`1 drifted: 05-hashmap__06-two-sum.L3.head.json: stepCount` and exited 1; `git checkout`
restored it.

Suites held: `gen:traces` **450 goldens / 450 `validateEnvelope` / `empty traces: 0`**, and two
runs byte-identical (`shasum judge/traces/*.head.json | shasum` → `c82b8e1a…` twice) ·
`npm test` **1898 unchanged** · `test:envelope` **129** · `test:judge` **96** · `validate`
150/0 · `test:doc-traces` **17** (its two "heads over the cap exist" assertions moved with the
contract — `overCap === 0` now, and the index's over-cap count is checked against the heads it
lists, a stronger claim than `> 0`).

**The envelope did not move.** A head is not the envelope: it is a row-28-owned summary, and
the frozen v1.1 envelope and step are byte-identical to `2be142d`.

Row 28's Commit cell reads `HEAD`: a commit cannot contain its own hash, and this section
shipped in that commit.

### 2026-10-02 — row 25 done: one table-driven spec, 11 surfaces, S1/S2/S3/S5 named per row

The L2 motivation was *"per-preset Playwright specs are 13 files of copy-paste"*. What actually
existed was one 894-line file with 55 hand-written tests, 18 of them already table loops and 11
of the rest per-preset bodies differing only in a guide id and some expected strings. Now there
is **one `CASES` table of 11 rows and one loop**, and adding a preset is adding a row.

**Counts, measured not estimated** (`--list`, parsed):

| | before | after |
|---|---|---|
| `dry-run.spec.mjs`, one viewport | 55 | **63** |
| `dry-run.spec.mjs`, both viewports | 110 | **126** |
| whole suite, both viewports | 256 passed / 18 skipped | **272 passed / 18 skipped** |

Per-scenario coverage, from the titles themselves (every test carries at least one id; 12 carry
two, so the column sums to 75 rather than 63):

| ID | one viewport | both viewports | what it is here |
|---|---|---|---|
| **S1** | 38 | 76 | mounts + click-forward/back + per-step frames + screenshot, on all 11 surfaces, plus the five cross-cutting animation contracts |
| **S2** | 10 | 20 | the reachable half — finite and clamped at both ends, no frame past the authored rows (`array`, `stack`, `linkedlist` rows + the scrubber-clamp test) |
| **S3** | 16 | 32 | the browser half — no leaked global, no stacking on nav, skipped tables left alone, one transport across both chromes, plus row 31's five a11y/motion tests |
| **S4** | **0** | **0** | **deliberately unbuilt — see below** |
| **S5** | 11 | 22 | the browser half — `data-steps` equals the authored `tbody tr` count, the last frame is reachable and terminal, `max` is `steps − 1` |

**S5 was empty in the browser and is now not.** Nothing before this row asserted that the player
shows one frame per authored row, so a trace carrying helper-function frames (`arrayToTree` /
`listToArray` / `buildGraph`) or steps after the target returned would have rendered fine and
passed. The assertion is computed, not golden: `render.js` documents `plan.steps ===
table.rows.length` as an invariant, and it holds **11/11** surfaces measured before it was
written. Node-level, the same property is `scripts/test-trace.mjs` `region-isolation`.

**S4 HAS NO PLAYWRIGHT SURFACE AND THAT IS THE PLAN'S DECISION, NOT A GAP IN THIS ROW.** §10's
"Deliberately not built" list names the scoring UI, the custom-input form and degraded mode, and
row 33 shipped **logging only** — no UI, no score, and deliberately not even a correctness record,
because the plan names no endpoint and a route nobody calls is the surface P1 cuts. A test here
would have had to invent the UI it asserts. It is gated on **T-b** (≥1 guide repair attributable
to row 33's aggregate). Recorded here and in the spec file's header so a reader cannot mistake
its absence for an oversight.

**Half of S2 is unreachable from a browser, and it is reachable where it belongs.** The
`[]`+`0` / `[3,3]`+`6` halves are inputs to the *generator*, not states a player can be put into.
The `n=5000` truncation-banner half has **no surface to click**: `grep -n truncat docs/dryrun/`
returns nothing, and the committed head format carries `stepCount` and `budget.mode` but no
truncation flag, so the portal cannot render a banner. Both live in `scripts/test-trace.mjs`
(row 12 asserts `n=5000` sets `truncated.display` with the **verdict unchanged**). The browser
covers the other half, which is why S2 reads "clamped, and no frame past the last authored row"
here rather than "truncation banner".

**S1's `[0,1]` is unreachable too, for a reason rows 22/23 already recorded.** Two Sum's three
dry-run tables are all scalar columns, so no array primitive can read state from it and the player
correctly does not mount — the spec asserts that as a regression, not skips it. The `array` row
runs on Merge Sorted Array instead, and this row added the assertion S1 actually asks for on it:
the **final** frame (`at: 3` → `[1, 2, 3, 4]`, the state `mergeOptimized` exits with), which the
old spec never reached. Scrubbing start-to-finish is the browser form of executing the case.

**Two measurements changed how the table is written, both caught by probing rather than by
failing afterwards.** Frames assert inside each surface, not the player: on the statecard guide
the player holds 2 `.viz-row` and 1 `[data-call]` while its statecard stage holds 1 and 0, so
player scope lets the recursion-tree overlay answer for the preset. And `openCase` cannot be
called twice on one page — the portal has no `hashchange` listener, so a second `goto` to a new
hash is a no-op in the app exactly as it is in the test; multi-guide tests hop by sidebar.

**Deduped, with the coverage kept.** Five old tests were byte-identical in what they asserted:
the globals check existed three times (array / Tier-1 preset / Tier-2 preset) and is now one test
walking four surfaces; *a guide with nothing to animate* duplicated the two-sum half of *a guide
with no array state*; *switching guides… replaces the preset* duplicated the preset half of *…replaces
the player*; *Tier 1 is untouched* duplicated *row 22's array primitive is untouched*. The two
reduced-motion tests were one test on two surfaces. None of that coverage was dropped — the
deduped tests assert a **superset** — and the freed slots went to the S5 test, which is new.

**Nothing else moved.** `npm run validate` 150 scanned / 0 errors / 0 warnings · `npm test` **1898**
runtime assertions, 0 failures, 450 syntax blocks · `scripts/test-dryrun-render.mjs` **141** checks ·
`test-dryrun-player` **40** · `test:doc-traces` **17** · axe-core clean inside the player.
`scratch/row25/` holds **22** crops (11 surfaces × 2 viewports) and is gitignored at
`.gitignore:48`; three were opened by eye and render real visualisations. The `Commit` cell reads
`HEAD` because a commit cannot contain its own hash — row 23's own commit (`c5b6469`) shipped this
same cell as `pending` for the same reason.

**Row 25 was mid-unblock by a concurrent agent when this row was written.** Its `scripts/`,
regenerated `judge/traces/*.head.json` and its own ledger sections are **not** in this commit —
only `tests/dry-run.spec.mjs` and this file's row-25 cell and section are staged.


### 2026-10-02 — row 28 follow-up: the gate did not check the shape, and one head was stale

`775016b` shipped the summary shape and the numbers (`450 heads, mean 766 B, max 1392 B,
0 over cap`) — all of which reproduce. But reading the committed artefacts rather than the
report found **449 of 450 heads summary-shaped and 1 stale full-step**
(`05-hashmap__06-two-sum.L3.head.json`, 1082 B), left behind by the hand-edit red-proof.

**The gate could not see it, and that is the finding.** A head carrying the WHOLE step passes
every field assertion row 28 added: its `stepCount`, `verdict` and `blockHash` are all correct,
and `first.n`/`last.n` are right too. It simply carries the golden in its pocket — the exact
thing E32 exists to prevent — while reading as a summary. Its own comment said the sweep
compares "rather than checking that the summary has the right shape". That was a considered
choice and it was wrong: **the shape IS the claim.**

One assertion closes it: every head's `first`/`last` keys are exactly `[line, n, out]`.
`npm run test:trace` → **120 assertions** (was 117), and it went **RED for the right reason**
before the regeneration, naming that one file; **GREEN after**. Two negatives keep it honest —
a head carrying a whole step is rejected, and an unmodified shipped head still passes, so the
probe cannot rot into a tautology.

Baselines unmoved: `npm test` **1898** · `Files: 150 / syntax-only: 0` · `test:envelope` **129** ·
`test:judge` **96** · `test:doc-traces` **17** · `validate` **150/0**. Regeneration touched exactly
**1** of 450 heads, which is the receipt that the other 449 were already correct.

### 2026-10-02 — row 15, part 1: the tree arity bug is fixed. **58 → 52.**

The handoff called the residual "22 `ops` + 12 `tree`". Re-measured, the 58 are **one** defect
with four surface shapes (see the section above): the harvest records what the authored script
asserted *after its own derivation*, and the driver compares the target's raw return. 24 blocks
normalise (`normCombos(fn(4,2))`), 22 assert a method on a constructed instance, 6 hit a real
arity bug, 6 derive an argument too.

**Shipped here: the 6 arity blocks.** The spy's level-order preference was first-wins — it kept
ONE recording and dropped every other argument. So `isSameTree(arrayToTree(A), arrayToTree(B))`
recorded `[A]` and was called `isSameTree(A, undefined)` ("cannot read property 'val' of
undefined"), and `kthSmallest(arrayToTree([…]), 1)` lost its `k`. The preference is now
**positional**: every argument that is a node graph is replaced by the level-order recording the
script made for that position, and a scalar passes through. `__GRAPH__` is what separates the
two — `__LE__` says only "not a level-order array", which is true of a graph *and* of an integer,
so without it the repair loop demands a recording for `k` and abandons the whole call.

Two placement bugs found by running it, not by reading it:

- the capture sat inside a guard that a second `arrayToTree` never reaches, so it fixed
  `isSameTree` only after `same-tree` went green and `kth-smallest` stayed red in the same run;
- and the first version demanded a recording for *every* non-array argument.

A call with a node-graph argument that has no recording falls back to the old first-wins rule,
so no case that already worked can regress — which is why 392 goldens are byte-identical.

`npm run test:trace` → **122 assertions, 0 failures** (was 120). The new S16 gate names the two
guides it fixes, because a gate naming all 12 tree failures could not go green until the other
mechanisms land — a gate that cannot go green is a gate that proves nothing. RED first: both
named `passed 0, failed 9` / `passed 0, failed 6`.

**Zero-pass 58 → 52** (`ops` 22, `json` 24, `tree` **12 → 6**), guides affected 20 → 18, heads
over E32's cap still **0**, and two `gen:traces` runs byte-identical (`shasum 7b5621ea…` twice).
Suites held: `npm test` **1898 unchanged** · `Files: 150 / syntax-only: 0` · `test:envelope`
**129** · `test:judge` **96** · `test:doc-traces` **17** · `validate` **150/0**.

**Not shipped, and why.** The remaining 52 need mechanisms this row does not have: a `via` replay
for the ~30 uniform wrappers, a **class op list** for the 22 statement-sequence blocks, argument
derivation for 6, and input derivation for 2. One of the 22 (`insert-delete-getrandom-o1`) stubs
`Math.random` before constructing, so its driver case would need a **global stub**, not an
argument list — a trust expansion on the component the plan fences hardest. Owner decision C3
chose replay-over-record in principle; the measurement shows it is 3–4 mechanisms, not 1, so the
slicing is still open. **Row 15 stays PARTIAL.**

### 2026-10-03 — row 32 **RENAMED**, not satisfied: the "never stored" purity was unachievable

HEAD at this entry: `2c3e8df`. The row as written asked for the "Unverified" label to be a
*pure function of per-guide evidence, rendered and never stored*. **It cannot be**, and the
reasons are structural, not stylistic. Stated once:

> V9 asks "does this guide's authored Level 3 dry-run table share at least one numeric token with
> the trace the code actually ran?" To answer that in a browser you need **every** step's `text`,
> `operands` and `snap`. **Steps 2…N−1 are published nowhere** — `scripts/gen-traces.mjs:936`
> `headStep` keeps only `{n, line, out}` and the head carries `first`/`last` only. The two steps
> that do ship are degraded: `out` is a 240-char, 4-binding human summary
> (`api/_lib/trace-runner.mjs:721-729`), so `operands` is absent entirely. The remaining 11 649
> L3 steps across 150 guides are 7.08 MiB of goldens that plan §6 E32 keeps out of git, and the
> whole corpus is the 34.3 MiB that `scripts/gen-doc-traces.mjs:22-28` deliberately rejected.

So the label's input is not in the browser, and "never stored" is not a design choice — it is
impossible without shipping the corpus this engine spent 30 rows refusing to ship. The row was
therefore **renamed** and the purity claim withdrawn, in the row and in the two statements that
justified it (**A2** and **G5**), so the plan no longer asserts something false.

**What shipped instead — the rot A2 actually feared is still foreclosed.** A label rots when its
RULE drifts from the GATE that enforces it. That is solved by having exactly one definition of the
rule, not by having zero stored bytes:

| Piece | Where | Provenance |
|---|---|---|
| `numbersIn`, `level3TableNumbers`, `sharedNumbers`, `v9Verdict`, `declaredIn`, `namesIn`, `overrideOk`, `AGREES`/`DISAGREES`/`UNCOMPARABLE`, `MIN_STEPS` | `scripts/lib/v9.mjs` (NEW) | ported line-for-line from the inline S14 block, `scripts/test-trace.mjs:1156-1179` and `:1190-1199`. One dependency: `stringify` from `scripts/lib/serialize.mjs`. No `node:`, no fs, no network. `parseGuide` is INJECTED, not imported, so the module adds no new path to the table parser |
| `readTableTraceVerdicts()` + `guides` / `counts.tableTrace*` in `buildIndex()` | `scripts/gen-doc-traces.mjs` | runs `v9Verdict` at build time over each L3 golden + its guide markdown, and publishes one verdict per guide |
| `verifyLabel()` + `loadTableTrace()` + the badge in `renderHead()` | `docs/index.html` | READS the verdict; decides nothing, so the badge cannot disagree with the gate |

**Measured at `2c3e8df`: 142 `agrees`, 0 `disagrees`, 8 `uncomparable`** — identical to the live
`test:trace` S14 line (`142/150 agreed, 8 uncomparable`), which is the point: the artefact and the
gate are the same number. (An earlier note said "10 uncomparable"; re-measured, it is **8**.)
The 8: `01-array-string/18-integer-to-roman`, `07-stack/02-simplify-path`, `07-stack/03-min-stack`,
`08-linked-list/01-linked-list-cycle`, `09-binary-tree-general/12-bst-iterator`,
`16-one-dp/01-climbing-stairs`, `20-trie/01-implement-trie`, `20-trie/02-add-and-search-words`.

`uncomparable` is rendered as its OWN label, never folded into "Unverified · disagrees":
`test-trace.mjs:1170-1173` is explicit that reporting "no comparison possible" as drift is "the
same sin as calling them agreement". 25 of the portal's 175 items (4 primers, 5 MAANG guides, 16
`docs/` pages) have no L3 golden, so V9 makes no claim about them and they carry no label.

**`V10` drops out of the rule.** `DRY_RUN_ENGINE_PROGRESS.md:760-763` already established V10 =
row 25, real-surface Playwright QA — a corpus-level suite with no per-guide verdict. A per-guide
label cannot be a function of it, so the label is a function of **V9 alone**, and this entry says
so rather than pretending the conjunction exists.

**Evidence (RED first, both artefacts):**

- publisher: probe asserted `buildIndex` emits no `guides` map → **RED**
  (`AssertionError: RED-1a: buildIndex emits no \`guides\` map`, exit 1) → **GREEN** after
  `readTableTraceVerdicts`. It also pins `142 / 0 / 8` against the shipped
  `docs/traces/index.json`.
- predicate: `node scripts/lib/v9.mjs` = 12 self-checks, 0 failures, and the gate is proven able
  to fire — mutating the ported `steps.length < MIN_STEPS` to `< 0` produced
  `actual: 'disagrees', expected: 'uncomparable'`, exit 1.
- port fidelity: a differential ran the inline body of `test-trace.mjs:1156-1180` against
  `v9Verdict` over all 150 real guides — **0 mismatches**, and the same probe walks a real guide
  through `agrees` → `agrees` → `uncomparable` → `disagrees` by editing its L3 table in memory.
- real surface, `npx serve docs` + Playwright MCP at the **default 1200×1419 viewport** (measured
  `window.innerWidth/innerHeight`, DPR 1 — NOT the repo's 1440×900 `desktop` project, which is
  exercised by `npm run test:e2e`): `01-array-string_01-merge-sorted-array` (`agrees`) →
  **no badge**; `16-one-dp_01-climbing-stairs` and `20-trie_01-implement-trie` (`uncomparable`) →
  `Unverified · not comparable`, `data-verdict="uncomparable"`; and, with one entry of the
  gitignored `docs/traces/index.json` doctored to `disagrees` and then restored,
  `merge-sorted-array` → `Unverified · table disagrees with trace`, `data-verdict="disagrees"`.
  All three loads confirmed `traces/index.json` → **200**. Screenshots (moved out of the repo —
  `.playwright-mcp/` is **not** gitignored, and untracked evidence must not reach the commit):
  `/var/folders/3c/mws77nsn7v9_641754phh7v00000gn/T/opencode/qa/screenshots/case1-agrees-no-badge.png`,
  `case2-uncomparable-badge.png`, `case3-disagrees-badge.png`.

**INTEGRATION STEP REQUIRED (not done here — file ownership).** `scripts/test-trace.mjs:1156`
still carries its own `numbersIn` and `:1161-1180` still carry the inline loop, so the predicate
exists in TWO places until the orchestrator applies the swap. Row 32's rename is what stops that
from being permanent; this entry is what makes it a known debt.

**Suites (measured with this row's changes in place, at the corpus state `2c3e8df` presents —
150 guides / 450 heads):** `npm test` **1898, 0 failures** · `test:envelope` **129** ·
`test:doc-traces` **17, 0 failures** · `test:dryrun-player` **40** ·
`test:dryrun-render` **141** · `test:trace` **138, 0 failures** — and `test-trace.mjs` was never
touched, so 138 is unchanged by construction. `git ls-files docs/traces/` is **0 files**,
unchanged: the verdict lands in a **gitignored build artefact**, regenerated by `npm run build`
(`scripts/build-site.mjs:171`), never committed.

### 2026-10-03 — correction: `npm run verify` could NOT be measured green in this tree, and it is not this row

~~exit 0. `git ls-files docs/traces/` is **0 files**~~ — struck because it was written before
`verify` was actually run, and it is false. What happened, measured:

A **parallel agent is editing a different slice of the same working tree** — `git status` shows
`M scripts/gen-traces.mjs`, `M scripts/test-trace.mjs`, `M api/_lib/problems.mjs` and a moving
`judge/traces/`. While this row's QA ran, the corpus went **450 → 438 → 446 heads** and
`test:trace`'s failure count moved **5 → 12 across two runs with no edit from me**. `verify` exits
**1 at its first step**, `gen:traces`, with 4 QuickJS `JS_FreeRuntime` aborts —
`08-linked-list/06-reverse-nodes-in-k-group` L2, `14-backtracking/02-combinations` L2,
`14-backtracking/04-combination-sum` L2 and L3 — i.e. exactly the guides whose wrapper derivations
that agent's S22 replay gate is chasing.

**Nothing here implicates this row**, and the proof is static rather than rhetorical:
`scripts/test-trace.mjs:60` imports exactly one symbol from `scripts/gen-doc-traces.mjs` —
`HEAD_BYTE_CAP` — and it is byte-identical in both versions (`2048`, HEAD:61 vs this row:63).
This row's diff to that file is **one removed line** (the `buildIndex` signature) and 84 added;
it adds no assertion and removes none. The failing gates are **S16 / S17 / S21 / S22**, which do
not exist at `2c3e8df` in that form (`test:trace` was 138 assertions at HEAD and is 145 now — the
+7 can only be that agent's). **S14 V9 itself PASSES throughout**, tracking the corpus live.

The anti-rot claim is nonetheless verified on the churning corpus, which is a stronger test than a
stable one: at 446 heads the published artefact and the live gate reported the SAME number —
`guides: 149`, `141 agrees / 0 disagrees / 8 uncomparable`, against the live
`S14 V9: ... (141/149 agreed, 8 uncomparable)`. The index is not a stored opinion that happens to
be right; it is the gate's own arithmetic, recomputed.

**RE-RUN REQUIRED after both slices land.** This row does not claim `verify` green.

### 2026-10-03 — row 32's integration step: the predicate exists ONCE, and a gate says so

HEAD at this entry: `f61e4fd`. This closes the debt named at `:1095-1098` — `scripts/test-trace.mjs`
still had its own copy of V9 — so `scripts/lib/v9.mjs` is now the **only** definition, and the CI
gate and the published portal badge provably share it.

**What was removed** (from `scripts/test-trace.mjs`, at the pre-change line numbers):

| Was | Now |
|---|---|
| `:1162-1180` — the inline three-way branch, re-implementing `v9Verdict`'s exact order | `:1178` `const tableVerdict = v9Verdict(guideText, g.steps, tableModule.parseGuide)`, routed onto the same three arrays at `:1179-1181` |
| `:1190-1193` `const declaredIn = (source) => …` | imported, `:1162` |
| `:1197` `const namesIn = (sentence) => …` | imported, `:1162` |
| `:1198-1199` `const overrideOk = (sentence, codeNames, watch) => …` | imported, `:1162` |

`sharedNumbers` and `MIN_STEPS` are no longer imported either — `v9Verdict` owns the threshold, so
S14 states no threshold of its own. `parseGuide` is still the module loaded at `:1155`; no second
path to the table parser was added. `level3TableNumbers` survives at `:1177` for ONE reason:
`comparedTables` is a census of **authored L3 tables**, not a verdict, and a guide with no table
never entered the denominator — dropping it would have moved the published line to `142/142`.

**RED first (`npm run test:trace`, gate written while the duplicates were still in place), exit 1:**

```
❌ [FAIL] S14 V9 one definition: this file defines none of V9's own — 5 names imported from scripts/lib/v9.mjs
   defined again here: declaredIn at test-trace.mjs:1190, namesIn at test-trace.mjs:1197, overrideOk at test-trace.mjs:1198
Assertions: 151 | Failures: 1
```

It names every offending definition **with its line number**. The gate's second assertion is the
detector biting on purpose, so the first one cannot be a no-op, and the third asserts they are
defined in `lib/v9.mjs` — "not here" must not mean "nowhere".

**GREEN after the deletion (`npm run test:trace`), exit 0:**

```
✅ [PASS] S14 V9: every comparable authored table shares at least one value with its trace (142/150 agreed, 8 uncomparable)
S14 V9: 8 guides have no comparable L3 table (trace too coarse or table absent) — reported, not counted as agreement
✅ [PASS] S14 V9 override guard: a sentence naming watched code identifiers is allowed
✅ [PASS] S14 V9 override guard: a sentence naming a DECLARED-BUT-UNWATCHED identifier is REJECTED — the guard bites
✅ [PASS] S14 V9 override guard: prose and literals are not identifier references
✅ [PASS] S14 V9 override guard: no shipped override names an identifier the trace never watched (0 overrides in the corpus)
✅ [PASS] S14 V9 one definition: this file defines none of V9's own — 5 names imported from scripts/lib/v9.mjs
✅ [PASS] S14 V9 one definition: the duplicate-definition detector BITES and names the line — a copy here would not be silent
✅ [PASS] S14 V9 one definition: all 5 are DEFINED in scripts/lib/v9.mjs, not merely absent here
Assertions: 151 | Failures: 0
```

**Assertion count 148 → 151** — +3, the three gates added and nothing else. **Before**
(`npm run test:trace`, measured at `f61e4fd`): `Assertions: 148 | Failures: 0`. **After**: `151 | 0`.
The two `S14 V9:` strings are **byte-identical** across the deletion: the RED run above still ran the
INLINE loop, and `diff` of its two S14 lines against the GREEN run's is empty — the published line did
not move a character.

The published number is the artefact's, not this gate's: `docs/traces/index.json`
(`curl -s http://localhost:8099/traces/index.json`, parsed) still carries
`counts.tableTraceAgrees 142 · tableTraceDisagrees 0 · tableTraceUncomparable 8`, and the same
**8 paths** as the 2026-10-03 entry — `01-array-string/18-integer-to-roman`, `07-stack/02-simplify-path`,
`07-stack/03-min-stack`, `08-linked-list/01-linked-list-cycle`, `09-binary-tree-general/12-bst-iterator`,
`16-one-dp/01-climbing-stairs`, `20-trie/01-implement-trie`, `20-trie/02-add-and-search-words`.

**Fidelity differential (S5) — the swap changed no arithmetic.** A throwaway script in `/tmp`
(not in the repo, not committed) ran the OLD inline body, copied verbatim from `f61e4fd`
`scripts/test-trace.mjs:1162-1180`, and the NEW routing over every one of the 150 real L3 guides:

```
guides compared        : 150 (of 150 L3 goldens, 0 unreadable)
old inline  tally      : 142 agrees / 0 disagrees / 8 uncomparable (comparedTables=150)
v9Verdict    tally     : 142 agrees / 0 disagrees / 8 uncomparable (comparedTables=150)
MISMATCHES             : 0
uncomparable SET differences: 0
RESULT: 0 mismatches — the swap changed no arithmetic, and the same 8 guides are uncomparable
```

The SET comparison is the load-bearing part: an equal count could still be a different 8 guides.

**Real surface (S1) — the badge still renders from the build-time verdict.**
`npx serve docs -l 8099` (already in the npx cache; nothing installed) + Playwright MCP at the
measured default viewport **1200×1419, DPR 1**:

| Guide | `TABLE_TRACE[…]` | Badge | `data-verdict` |
|---|---|---|---|
| `01-array-string_01-merge-sorted-array` | `{tableTrace:"agrees"}` | **none** — `#verifyBadge` absent | — |
| `20-trie_01-implement-trie` | `{tableTrace:"uncomparable"}` | `Unverified · not comparable` | `uncomparable` |

Absence of the badge on the `agrees` guide is checked against the guide's own verdict entry, so it
is the *certified* state and not a missing index. `curl -s -o /dev/null -w '%{http_code}'
http://localhost:8099/traces/index.json` → **200** (164 644 B, parses). Screenshots moved out of
the repo — `.playwright-mcp/` is **not** gitignored: `/tmp/row32-qa/case1-agrees-no-badge.png`,
`/tmp/row32-qa/playwright-mcp/row32-case2b-uncomparable-badge.png`. Server killed after the run:
`pgrep -fl "serve docs"` → nothing, `curl` → `000` connection refused, nothing listening on 8099.

`disagrees` has **no** published instance (0 of 150), so its badge cannot be photographed from the
real corpus; that branch's predicate case is `node scripts/lib/v9.mjs`'s ("a table with NO shared
value DISAGREES — the guard bites"), and `docs/index.html` is untouched by this row.

**Suites, re-measured with this change in place.** `npm test` **1898 assertions · 0 failures**
(Files 150 · runtime 150 · syntax-only 0 · 450 blocks) · `test:envelope` **129·0** ·
`test:serialize` **9 cases, 0 failures** · `test:validate` **23·0** · `test:instrument` **246·0** ·
`test:codecs` **275·0** · `test:trace-runner` **269·0** · `test:doc-traces` **17·0** ·
`test:judge` **96·0** · `validate` **Scanned: 150 problem files, Errors: 0, Warnings: 0** ·
`test:trace` **151·0**. The corpus was NOT regenerated (`npm run gen:traces` not run): 450 full
goldens and 450 heads are already on disk and `judge/traces/` is gitignored. S17's own ratchet line
from the same `npm run test:trace` run: `450 heads · zero-pass 32 (baseline 49) · partial-pass 20
(baseline 33) · clean 398`.

**Left alone deliberately.** `scripts/lib/v9.mjs` is unmodified (`git status` shows one file), so its
header's port provenance (`test-trace.mjs:1156`, `:1163-1179`, `:1190-1199`) now cites lines that
have moved — a comment-only staleness, in a file this row does not own. Row 15's residual work and
the `verify` re-run the 2026-10-03 correction demands are untouched; `gen-traces.mjs`,
`api/_lib/problems.mjs`, `api/_lib/codecs.mjs` and `judge/` are not mine.


### 2026-10-05 — row 15, part 2: a class target's op SEQUENCE is the case. **52 → 33.**

The handoff's census (`zero-pass 32, partial-pass 20, clean 398`) reproduces exactly at `982264c`,
and **the 52 splits into SIX mechanisms plus FOUR stops** — not the two classes the handoff named.
Counted from `node /tmp/census.mjs` against the `*.head.json`; every row's count is that script's
output, and the six plus the four sum to 52.

| Mech | Blocks | Guides (levels) | The mechanism |
|---|---|---|---|
| **M1** class op list | 19 | min-stack L1/L2/L3 · lru-cache L1/L2/L3 · bst-iterator L1/L2/L3 · median-finder L1/L2/L3 · implement-trie L1/L2/L3 · add-and-search-words L1/L2/L3 · is-subsequence L3 | record `ops` (`[method, args, emitted]`) + `ctor`; the driver REPLAYS them against the constructed instance's own methods |
| **M2** an assertion with no recorded target call | 9 | copy-list-with-random-pointer ×3 · clone-graph ×3 · word-search-ii ×3 | the capture fell back to the ASSERTER's own arguments as `args`; drop it and count it |
| **M3** derivation over a variable the return was bound to | 6 | longest-palindromic-substring ×3 · sorted-array-to-bst ×3 | `const r1 = fn(x); assertEq(r1.length === 3 && isPalStr(r1), true)` |
| **M4** derivation over the MUTATED ARGUMENT of a void target | 3 | flatten-binary-tree ×3 | the answer is an argument, and the author's derivation applies to it |
| **M5** derivation helper declared in a SIBLING block | 2 | construct-quad-tree L2/L3 | `quadToGrid` is in the guide's markdown but in no selected block, so the replay threw `ReferenceError` |
| **M6** the recorded call must be the one NEAREST the assertion | 3 | powx-n ×3 | a target call the author asserted through `if (…) process.exit(1)` leaked into the next case: `args [2.1,3]`, `expected 1024` |
| **X1** STOP — needs a global `Math.random` stub (§5d) | 3 | insert-delete-getrandom-o1 ×3 | the answer IS the draw sequence |
| **X2** STOP — node identity across arguments | 3 | lowest-common-ancestor ×3 | a level-order wire is a value encoding; `p`/`pp` are nodes INSIDE `root` |
| **X3** STOP — a third pointer the `tree` wire does not carry | 2 | next-right-pointers-ii L2/L3 | nodes are `{val,left,right,next}`; `arrayToTree` builds no `next` |
| **X4** STOP — `[]` is two different values | 2 | merge-k-sorted-lists L1/L2 | `[]` is both "no lists" (the author) and "the empty list" (the `list` wire) |
| | **52** | | **19 + 6 + 3 + 2 + 3 = 33 closeable; 10 stops** |

**X4 is measured, not argued.** Declining `[]` as a wire in `acceptsNodeWire` fixes merge-k L1/L2 and
breaks `invert-binary-tree` L1/L2/L3 — census **398 → 397**. `npm run gen:traces` twice, probe
reverted, tree clean.

**Shipped here: M1, all 19 blocks.** `harvestCases` emitted every case with a `callee` field and
`buildBundle` never read it, so a class guide's authored script — which CONSTRUCTS a target and then
drives it — collapsed into one record with `args: []`, and the driver constructed the class and
compared a scalar against an empty instance. Measured before: `node /tmp/cases.mjs
07-stack/03-min-stack.md` → 9 cases, every one `{"args":[], "expected":<scalar>, "callee":"C"}`.

Three things had to be true at once, and only running it found all three:

- **`emitted` is "was the return value used".** A method call that is a STATEMENT contributed nothing
  to the assertion (`m.pop()`) and one whose value is used contributed exactly that value
  (`out.push(c.get(1))`, `assertEq(m.getMin(), -3)`). One rule, no per-guide table, and it is what
  lets ONE emitted value answer a scalar assertion and SEVERAL answer the author's collected array.
- **the op list is CUMULATIVE from the construction, and `emitted` is relative to the previous
  assertion.** min-stack's three assertions share one instance; replaying all three `getMin`s for the
  second compares `[-3, 0]` against an expected `0`. So `__OPS__` resets on a CONSTRUCTION (the one
  event that starts a sequence) and `__FROM__` marks what the last assertion consumed.
- **an op list belongs to the CONSTRUCTED target only.** `is-subsequence` drives the L3 class and the
  L1/L2 functions in one loop body, so without dropping the op list on a plain-function target call the
  class's list was attached to the function's cases: L2 went `21/0 → 18/3` and the L3 block drove a
  constructor with a function's arguments. The partition now reads `c.ops` rather than `c.callee`,
  because recording the sequence takes the receiver's construction out of the target-call path — which
  is also why `new SubsequenceMatcher(t).isSubsequence(s)` has to hand its constructor arguments to
  `__SPYOP__` itself: that `new` is left unspied, so nothing else would.

**RED first, `npm run test:trace`, exit 1, 21 failures** (S23's 19 named guides + the tautology
control + the mechanism probe):

```
❌ [FAIL] S23 ops: 07-stack__03-min-stack L1 passes every case — push/pop/top/getMin on one constructed MinStack
   passed 0, failed 9 · first error: (a case compared unequal)
❌ [FAIL] S23 ops negative: the unmodified named golden SATISFIES the predicate — the probe below is not tautological
   failed 9
❌ [FAIL] S23 ops: an op list drives the target's OWN methods — the emitted values come from the instance, not from a synthesised one
   the replay did not reproduce the method sequence the op list named
Assertions: 173 | Failures: 21
```

Every one of the 19 names its guide and its current `passed`/`failed`. The gate names GUIDES, not the
whole 52, for the reason the S16 entry records: a gate naming all of them could not go green until
every other mechanism landed, so it would prove nothing.

**GREEN after the replay, `npm run test:trace`, exit 0:**

```
S17 ratchet: 450 heads · zero-pass 13 (baseline 13) · partial-pass 20 (baseline 20) · clean 417
✅ [PASS] S23 ops: 07-stack__03-min-stack L3 passes every case — push/pop/top/getMin on one constructed MinStack
✅ [PASS] S23 ops: 02-two-pointers__02-is-subsequence L3 passes every case — the L3 target is a CLASS: new SubsequenceMatcher(t).isSubsequence(s)
Assertions: 176 | Failures: 0
```

The third S23 assertion is proved against the REAL driver (`buildBundle` + `executeUserCode` on a
three-line class), not a re-implementation of it, and its case carries `args: []` — a driver that
ignored `ops` would construct and stop and could not produce `[-2, -3]`. Two negatives keep it
honest: the unmodified named golden satisfies the same predicate, and a golden with one more failure
is rejected by it.

**`VERDICT_BASELINE` 49/33 → 13/20**, in the same commit. All three S17 probes still bite at the new
baseline, and each still asserts what it claims because every probe is written RELATIVE to it:
`at(1,0)` = `{14,20}` → 1 breach; `at(0,1)` = `{13,21}` → 1 breach; `at(-1,-1)` = `{12,19}` → 0 breaches.
`npm run test:trace` prints all three as PASS.

**Census before → after** (`node /tmp/census.mjs`, the §5h probe verbatim):

```
before   clean 398  zeroPass 32  partialPass 20
after    clean 417  zeroPass 13  partialPass 20
```

`clean` moved by **exactly 19** — M1's family size, no more and no less. `partial-pass` did not move
at all, which is the receipt that nothing already-partial regressed. The 13 remaining zero-pass are
`flatten-binary-tree` ×3, `lowest-common-ancestor` ×3, `sorted-array-to-bst` L2/L3, `construct-quad-tree`
L2/L3 (M3–M5) and `insert-delete-getrandom-o1` ×3 (X1).

**X1 is a refusal, and the measurement that forced it.** Replaying an op sequence makes the verdict
depend on what the target's methods return AT RUN TIME, and for `insert-delete-getrandom-o1` that is
`Math.random`. Its authored script pins the draw sequence with a global stub — precisely because the
answer depends on it — and §5d forbids shipping one. Three consecutive `npm run gen:traces` on the
SAME tree gave `passed 6 failed 1`, `passed 4 failed 3`, `passed 6 failed 1`. A golden whose verdict
moves on every run is worse than a wrong one, because nothing can gate on it, so `harvestCases`
refuses the op list for ANY block whose source names `Math.random`, `Date.now` or `new Date`
(`NON_DETERMINISTIC_RE`) — by source, not by guide name, and the repo already has the vocabulary
(E26, row 4's validator). Three new assertions name the three blocks that must stay wrong ON PURPOSE,
so a future slice cannot close them by making them non-deterministic.

**Determinism re-proven after the change** — the ledger's own standard, two runs:
`npm run gen:traces && node /tmp/census.mjs` → `clean 417 zeroPass 13 partialPass 20`, twice, byte
for byte. Before the refusal rule the same two runs disagreed.

**Suites, re-measured with this change in place** (`npm run <script>` each):

| Suite | Before | After |
|---|---|---|
| `npm test` | 1898 assertions · 0 failures | **1898 · 0** (`Files: 150`, `syntax-only: 0`, 450 blocks, 36 divergences) |
| `test:envelope` | 129 · 0 | **129 · 0** |
| `test:serialize` | 9 cases · 0 | **9 cases · 0** |
| `test:validate` | 23 · 0 | **23 · 0** |
| `test:instrument` | 246 · 0 | **246 · 0** |
| `test:codecs` | 275 · 0 | **275 · 0** |
| `test:trace-runner` | 269 · 0 | **269 · 0** |
| `test:doc-traces` | 17 · 0 | **17 · 0** |
| `test:judge` | 96 · 0 | **96 · 0** |
| `validate` | 150 files · 0 errors | **150 files · 0 errors · 0 warnings** |
| `test:trace` | 151 · 0 | **176 · 0** (+25: 19 guide/level gates, 3 determinism refusals, 3 mechanism/negative probes) |

`test:trace`'s count RISES, which §6 allows for gates this row adds and nothing else.

**Real surface (5g.3) — the control, not the proof.** `npm test 07-stack/03-min-stack.md` →
`✅ [PASS] 07-stack/03-min-stack.md (9 assertions)`; `npm test 08-linked-list/11-lru-cache.md` →
`✅ [PASS] (3 assertions)`. `test-runner.mjs`'s bare harness was already immune to this bug class, so
it is a control; the proof is the census above and the 19 named gates.

**Trust boundary — where this slice stopped.** No authored script text enters the driver. `ops` and
`ctor` are DATA on a case object and ride the existing `JSON.stringify(tests)`, exactly as `t.via`
does, so **no envelope field, golden field or schema entry was added** and S10's frozen v1.1 set is
untouched (`test:envelope` 129·0, and S10 is inside it). The one authored-JS expansion C3 warned about
— `viaCode`, which emits SCRIPT text into the bundle — was already in the tree and is not extended
here. The methods replayed are the target's own; nothing in the driver computes an answer.

**Left alone deliberately.** `api/_lib/codecs.mjs` is unmodified, so X3/X4 stay open rather than being
"fixed" by a registry edit that §6 forbids and that the `[]` probe showed is a net loss. The other 33
blocks (M2–M6, X2, X3, X4) are not started.

### 2026-10-05 — row 15, part 3: an assertion with no recorded target call is NOT a case. **33 → 26.**

The spy's recorded target call could not be transported (a `list` with random pointers, a cyclic
graph), so `__A__` stayed null and the capture fell through to the first-any-call fallback — which
for `assertEq(copy !== orig && copy.next !== orig.next, true, 'deep copy, no shared nodes')` is the
ASSERTER ITSELF. So `args` became `[true, true, 'deep copy, no shared nodes']` and the driver invoked
`copyRandomListBruteForce` with it. Measured on the committed heads with `node /tmp/cases.mjs
08-linked-list/04-copy-list-with-random-pointer.md`: 6 of its 7 cases carried `callee: 'assertEq'`.

That is not a case about the target, and it is exactly how the block reported `passed 1 failed 6` —
the one pass is the `null` input, which is a real case.

**Shipped: the capture is dropped, and counted, on the same ground as the untransportable case above
it.** `unbacked` is set when `__A__` is null AND no op list backs the case AND the recorded callee is
an asserter. The op-list clause is not decoration: `is-subsequence`'s class case has no recorded
ARGUMENTS either (the receiver's construction is left unspied, per part 2) and is entirely carried by
its op list, so testing `__A__` alone dropped 7 good cases and took the corpus to 449 heads.

**RED first, `npm run test:trace`, exit 1, 9 failures** — every one naming its guide and its current
counts:

```
❌ [FAIL] S24 unbacked: 08-linked-list__04-copy-list-with-random-pointer L1 passes every case it has — the list has random pointers, so the input is CYCLIC and cannot be transported
   passed 1, failed 6 · stepCount 7
❌ [FAIL] S24 unbacked: 18-graph-general__03-clone-graph L1 passes every case it has — the graph is cyclic too — the target is never driven with an unbacked assertion again
   passed 2, failed 6 · stepCount 8
❌ [FAIL] S24 unbacked: 20-trie__03-word-search-ii L1 passes every case it has — `board restored` asserts about the board, never about the target — it was graded as a call
   passed 3, failed 3 · stepCount 188
Assertions: 185 | Failures: 9
```

`20-trie/03-word-search-ii`'s `board restored` case is the purest instance: `assertEq(board.every(…),
true)` asserts about the BOARD, never about the target, and it was being graded as a call on it.

**GREEN after the drop, `npm run test:trace`, exit 0:**

```
S17 ratchet: 450 heads · zero-pass 13 (baseline 13) · partial-pass 13 (baseline 13) · clean 424
Assertions: 183 | Failures: 0
```

**The gate names clone-graph L1 only, and the reason is worth recording.** Its L2/L3 lose the
unbacked cases too — that is this mechanism — but their two surviving cases then fail on
`ReferenceError: graphToAdj is not defined`, which is a derivation helper declared in a SIBLING block
and therefore M5's defect, not this one's. Naming L2/L3 here would make the gate un-greenable for a
reason that has nothing to do with the drop, which is the S16 lesson again: a gate that cannot go green
proves nothing.

**Census before → after** (`node /tmp/census.mjs`):

```
before   clean 417  zeroPass 13  partialPass 20
after    clean 424  zeroPass 13  partialPass 13
```

`clean` moved by **exactly 7** — copy-list ×3, clone-graph L1, word-search-ii ×3 — and `zero-pass` did
not move at all, which is the receipt that nothing regressed. The 13 remaining partial are
`next-right-pointers-ii` ×2 (X3), `powx-n` ×3 (M6), `longest-palindromic-substring` ×3 (M3),
`sorted-array-to-bst` L1 (M3), `merge-k-sorted-lists` ×2 (X4) and `clone-graph` L2/L3 (M5).

**Determinism, two consecutive `npm run gen:traces`:** `clean 424 zeroPass 13 partialPass 13`, twice.

**Suites, re-measured** — every §6 number unmoved except the one §6 allows to move:

| Suite | Value |
|---|---|
| `npm test` | **1898 assertions · 0 failures** · `Files: 150` · `syntax-only: 0` · 450 blocks · 36 divergences |
| `test:envelope` **test:serialize** **test:validate** **test:instrument** | **129 · 0** · **9 cases · 0** · **23 · 0** · **246 · 0** |
| `test:codecs` **test:trace-runner** **test:doc-traces** **test:judge** | **275 · 0** · **269 · 0** · **17 · 0** · **96 · 0** |
| `validate` | **150 files · 0 errors · 0 warnings** |
| `test:trace` | **183 · 0** (was 176; +7 named gates for this slice) |

**Real surface (5g.3) — the control.** `npm test 08-linked-list/04-copy-list-with-random-pointer.md`
→ `✅ [PASS] (10 assertions)` · `npm test 18-graph-general/03-clone-graph.md` → `✅ [PASS] (11
assertions)` · `npm test 20-trie/03-word-search-ii.md` → `✅ [PASS] (6 assertions)`. `test-runner.mjs`
was already immune, so these are controls; the receipt is the census.

**Not a comparator change.** Nothing about how a value is compared moved. What moved is which
inputs reach the comparator: an argument list the script never wrote down as the target's is no
longer graded as one. `api/_lib/codecs.mjs` and the E28 registry are untouched.

### 2026-10-05 — row 15, part 4: the return can reach an assertion through a VARIABLE. **26 → 23.**

`collectDerivations` finds the derivation by taking the asserter's `arguments[0]` and replacing its
outermost TARGET CALL with the return placeholder. But an author does not have to put the call inside
the assertion:

```js
const r1 = fn('babad');
assertEq(r1.length === 3 && isPalStr(r1), true, 'babad longest pal');
```

No target call in `arguments[0]`, so no derivation was recorded, and the driver compared the target's
raw return `"bab"` against an expected `true`. Measured before, all three levels: `passed 6 failed 3`.

**Shipped: a variable initialised by a target call is the same value by another route.** Its
references inside an assertion become the return placeholder — the same substitution, so the target
still runs exactly once. `substituteRefs` replaces REFERENCES only, never anything spelled the same
way and meaning something else: a computed-free member's *property*, an object-literal or pattern
*key*, a label, and a `break`/`continue` label are all excluded by parent inspection, because
`r1.length` is a reference to `r1` and `obj.r1` is not.

The key has to be attached at a place the spy can tag. An inline call is keyed by its own offset; a
variable-bound return has no inline call in the assertion at all, so the key is attached to the call
INSIDE the declarator that bound it — the same two hops the value travelled, in reverse.

**One filter was load-bearing, and 21 blocks found it.** `merge-sorted-array` declares
`const merge = (nums1, m, nums2, n) => {…}` at top level and then CALLS it. Without excluding names
the script itself declares (and names that are targets), `merge` became a "return variable", and the
derivation came out as

```
__VIA_FNS__["v1"] = function (__R__) { return __R__([1, 2, 3, 0, 0, 0], 3, [2, 5, 6], 3); };
```

— the target call with its own callee replaced. Census went **424 → 406, zero-pass 13 → 34**, 21
blocks across 7 guides (`merge-sorted-array`, `rotate-array`, `substring-with-concatenation`,
`rotate-image`, `set-matrix-zeroes`, `game-of-life`, `group-anagrams`), all void mutators whose script
declares a helper of the same name. With the filter: `clean 427 zeroPass 13 partialPass 10`.

**RED first, `npm run test:trace`, exit 1:**

```
❌ [FAIL] S25 retvar: 17-multi-dp__04-longest-palindromic-substring L1 passes every case — the assertion projects the RETURN: r1.length === 3 && isPalStr(r1)
   passed 6, failed 3 · first error: (a case compared unequal)
❌ [FAIL] S25 retvar: 21-divide-conquer__01-sorted-array-to-bst L1 passes every case — inorderVals(t) — the author asserts the INORDER traversal of the returned tree
   passed 2, failed 5 · first error: (a case compared unequal)
Assertions: 187 | Failures: 4
```

**GREEN after the substitution:**

```
S17 ratchet: 450 heads · zero-pass 13 (baseline 13) · partial-pass 10 (baseline 10) · clean 427
Assertions: 186 | Failures: 0
```

**Why the gate does not name sorted-array-to-bst, even though its `inorderVals(t)` case is exactly
this shape.** It needs a second mechanism as well: `treeHeight` is declared in a block the driver
never receives, so its other cases die on `ReferenceError: treeHeight is not defined` — that is the
sibling-block helper defect (M5) and it gets its own gate. Its L1 case is a THIRD defect: the
author's second loop iterates `[sortedArrayToBSTSliced, sortedArrayToBST]` only, so
`treeHeight(...) <= 3` is false for L1's brute force — and the harvested case carries `callee: 'fn'`,
an alias BIND in both loops, so the level partition cannot tell them apart. That is an eighth
mechanism (an alias loop's membership is not recorded), one block, left open and named here so it is
not rediscovered as a driver bug.

**Census before → after** (`node /tmp/census.mjs`):

```
before   clean 424  zeroPass 13  partialPass 13
after    clean 427  zeroPass 13  partialPass 10
```

`clean` moved by **exactly 3** — longest-palindromic-substring L1/L2/L3 — and `zero-pass` did not move,
so nothing regressed. sorted-array-to-bst L1 improved `2/5 → 5/2` without becoming clean: the two
failures are now the author's second loop being asserted against L1, which is a fact rather than a
transport failure.

**Determinism, two consecutive `npm run gen:traces`:** `clean 427 zeroPass 13 partialPass 10`, twice.

**Suites, re-measured:** `npm test` **1898 · 0** (`Files: 150`, `syntax-only: 0`, 450 blocks, 36
divergences) · `test:envelope` **129 · 0** · `test:serialize` **9 cases · 0** · `test:validate`
**23 · 0** · `test:instrument` **246 · 0** · `test:codecs` **275 · 0** · `test:trace-runner`
**269 · 0** · `test:doc-traces` **17 · 0** · `test:judge` **96 · 0** · `validate` **150 files · 0
errors · 0 warnings** · `test:trace` **186 · 0** (was 183; +3 named gates).

**Real surface (5g.3) — the control.** `npm test 17-multi-dp/04-longest-palindromic-substring.md` →
`✅ [PASS] (9 assertions)`.

**The comparator is untouched.** A derivation was already part of the design (S22); this slice adds
one more way for the harvest to RECORD one. `api/_lib/codecs.mjs` and E28 are unmodified.

### 2026-10-05 — row 15, part 5: a derivation helper the driver never RECEIVED. **23 → 17.**

A derivation is replayed inside the driver's IIFE, and the helpers its expression references are
sliced out of the AUTHORED SCRIPT. Some are declared in neither the script nor the block the driver is
handed: they live in the guide's own markdown, at a level this run is not given. `quadToGrid` is
declared once in `21-divide-conquer/03-construct-quad-tree.md:101` and is in none of the three
selected blocks, so the registry entry was `function (__R__) { return quadToGrid(__R__, 2); }` with
no `quadToGrid` anywhere, and the run died on
`ReferenceError: 'quadToGrid' is not defined` before comparing anything. All six cases, all levels.

**Shipped: such a name is reported as a DEPENDENCY and lifted into the BLOCK half**, not sliced into
the driver. That placement is the whole fix, for two reasons that are both measured rather than
stylistic:

- A derivation helper that reaches the IIFE can **shadow** a name the codec registry declares there.
  That is the reverted-feature note `DRIVER_DECLARED` already carries, and it cost four authored
  scripts the first time it happened.
- `reserved` is the union of **all three** levels' declarations, so a helper only ONE level's block
  declares looks "already in scope" for the other two and is skipped — which is exactly the bug.
  `missingDeclarations` decides per level, and lifting into the block half reuses it unchanged: it
  lifts a referenced-but-undeclared name out of a sibling block and skips anything the block under
  test already declares.

The dependency NAMES ride as a non-index own property on the `cases` array, the same trick
`viaCode` uses and for the same reason: `JSON.stringify` drops them by design, so they reach
`buildInstrumented` and change nothing about the transported cases, the envelope or the schema.

**RED first, `npm run test:trace`, exit 1:**

```
❌ [FAIL] S27 sibling helper: 21-divide-conquer__03-construct-quad-tree L2 passes every case — quadToGrid is in the guide, not in the block the driver is handed
   passed 0, failed 6 · first error: (a case compared unequal)
❌ [FAIL] S27 sibling helper: 18-graph-general__03-clone-graph L2 passes every case — graphToAdj likewise — the remaining two cases died on it once the unbacked ones were dropped
   passed 1, failed 1 · first error: (a case compared unequal)
Assertions: 190 | Failures: 4
```

**GREEN after the lift:**

```
S17 ratchet: 450 heads · zero-pass 9 (baseline 9) · partial-pass 8 (baseline 8) · clean 433
Assertions: 192 | Failures: 0
```

**Six blocks, not the four the gate was written against.** `sorted-array-to-bst` L2/L3 turned out to
have the same shape — `treeHeight` is declared the same way — and are now NAMED in the gate rather
than left for a later slice to rediscover as a driver bug. Found by running it, not by reading it.

**Census before → after** (`node /tmp/census.mjs`):

```
before   clean 427  zeroPass 13  partialPass 10
after    clean 433  zeroPass 9   partialPass 8
```

`clean` moved by **exactly 6** — construct-quad-tree L2/L3, clone-graph L2/L3, sorted-array-to-bst
L2/L3. The 9 remaining zero-pass are `insert-delete-getrandom-o1` ×3 (X1), `lowest-common-ancestor` ×3
(X2) and `flatten-binary-tree` ×3 (M4, one slice away). The 8 partial are `next-right-pointers-ii` ×2
(X3), `powx-n` ×3 (M6), `merge-k-sorted-lists` ×2 (X4) and `sorted-array-to-bst` L1.

**Determinism, two consecutive `npm run gen:traces`:** `clean 433 zeroPass 9 partialPass 8`, twice.

**Suites, re-measured:** `npm test` **1898 · 0** (`Files: 150`, `syntax-only: 0`, 450 blocks, 36
divergences) · `test:envelope` **129 · 0** · `test:serialize` **9 cases · 0** · `test:validate`
**23 · 0** · `test:instrument` **246 · 0** · `test:codecs` **275 · 0** · `test:trace-runner`
**269 · 0** · `test:doc-traces` **17 · 0** · `test:judge` **96 · 0** · `validate` **150 files · 0
errors · 0 warnings** · `test:trace` **192 · 0** (was 186; +6 named gates).

**Real surface (5g.3) — the control.** `npm test 21-divide-conquer/03-construct-quad-tree.md` →
`✅ [PASS] (6 assertions)` · `npm test 18-graph-general/03-clone-graph.md` → `✅ [PASS] (11 assertions)`.

**The helper is the GUIDE'S OWN CODE, copied, not new code.** `missingDeclarations` already lifts a
block's cross-level references verbatim; this adds the derivation's dependencies to the same lookup.
No authored script text enters the driver, no codec or comparator moves, and the sliced text is
uninstrumented so it contributes no probes and no steps (K4).

### 2026-10-05 — row 15, part 6: a void target's answer is a MUTATED ARGUMENT. **17 → 14.**

`fn(t1); assertEq(collectRightChain(t1), [1, 2, 3, 4, 5, 6])`. `flatten` returns nothing and
rewrites its argument in place, so the value the author asserted is a derivation over **the argument
the call changed**, not over the return. The driver already picked the changed argument — that branch
is `buildBundle`'s IN-PLACE MUTATOR mechanism — and then compared it RAW, so a flattened tree was
graded as its own level-order wire:

```
expected [1, 2, 3, 4, 5, 6]   got [1, null, 2, null, 3, null, 4, null, 5, null, 6]
```

All three levels, `passed 0 failed 6`.

**Shipped, half one: the derivation is written over the mutated argument.** A derivation now has two
legitimate bases and the registry has **two parameters** — the target's return and the argument the
call changed — and which one an entry reads is decided by which placeholder its expression
substituted. So there is no flag in the driver to keep in sync with the harvest, and a derivation with
no `__MUT__` reference behaves exactly as before (`__val__` is `r`).

Offered **only for a target the catalog calls `void`**, and that gate is load-bearing rather than
tidy. Left ungated it fires on every assertion that mentions an argument name, and for a target that
RETURNS a value the driver has no changed argument to hand the registry. Measured: word-search-ii's
three levels went clean → zero-pass and the corpus read `clean 424 zeroPass 15 partialPass 11`.

**Shipped, half two: a value the codec OWNS is encoded on BOTH sides.** `tree` puts nil in its own
domain — `treeToArray(null)` is `[]` — so the driver encoded the answer as `[]` and compared it against
an author who wrote `null`. That is the same fact in two vocabularies, and it is precisely the failure
the codec's own note records for `invertTree`: "the driver reading a correct answer as a wrong one".

**The blast radius is measured, not asserted.** Over all **776** harvested cases carrying an expected
value, the symmetric encoding *fires* on **460** — and `json`/`ops`/`graph` `toWire` are the identity,
so **457 of those 460 change nothing at all**. The only behavioural change in the whole corpus is
`tree` + nil: **3 cases**, all `flatten-binary-tree`'s `empty tree no-op`. Reproduce with

```
node --input-type=module -e "import fs from 'node:fs';
  const {getCodec}=await import(process.cwd()+'/api/_lib/codecs.mjs');
  const gt=await import(process.cwd()+'/scripts/gen-traces.mjs');
  let fired=0,total=0;const byCodec={};
  for(const e of await gt.loadCatalog()){
    let src; try{src=await gt.caseSourceFor(e);}catch{continue;}
    for(const c of src.cases){ if(c.expected===undefined) continue; total++;
      const cd=getCodec(e.codec,e.path);
      if(cd.owns(c.expected)){fired++;byCodec[e.codec]=(byCodec[e.codec]??0)+1;} } }
  console.log('cases with expected:',total,'fires on:',fired,JSON.stringify(byCodec));"
```

→ `cases with expected: 776 fires on: 460 {"json":457,"tree":3}`.

**It cannot manufacture a pass.** The SAME encoder is applied to both sides, and the comparator is
untouched: E28 still rejects nil against the empty wire on its own, which is asserted as its own gate
(`equivalent('exact', [], null) === false`) beside a second one proving the two sides really do
differ (`tree.toWire(null) !== null` while `json.toWire({a:1}).a === 1`), so the symmetry cannot rot
into a no-op.

**RED first, `npm run test:trace`, exit 1:**

```
❌ [FAIL] S26 mutarg: 09-binary-tree-general__07-flatten-binary-tree L1 passes every case — returnType void: the answer is the mutated argument, reached through collectRightChain
   passed 0, failed 6 · first error: (a case compared unequal)
❌ [FAIL] S26 mutarg: 09-binary-tree-general__07-flatten-binary-tree L3 passes every case — returnType void: the answer is the mutated argument, reached through collectRightChain
   passed 0, failed 6 · first error: (a case compared unequal)
Assertions: 189 | Failures: 3
```

**GREEN after both halves:**

```
S17 ratchet: 450 heads · zero-pass 6 (baseline 6) · partial-pass 8 (baseline 8) · clean 436
✅ [PASS] S26 encoding: the comparator still REJECTS nil against the empty wire on its own — the symmetry is in what the driver hands it, not in the comparator
Assertions: 194 | Failures: 0
```

**Census before → after** (`node /tmp/census.mjs`):

```
before   clean 433  zeroPass 9  partialPass 8
after    clean 436  zeroPass 6  partialPass 8
```

`clean` moved by **exactly 3** — flatten-binary-tree L1/L2/L3. The 6 remaining zero-pass are
`insert-delete-getrandom-o1` ×3 (X1) and `lowest-common-ancestor` ×3 (X2); the 8 partial are
`next-right-pointers-ii` ×2 (X3), `powx-n` ×3 (M6), `merge-k-sorted-lists` ×2 (X4) and
`sorted-array-to-bst` L1 (alias-loop membership).

**Determinism, two consecutive `npm run gen:traces`:** `clean 436 zeroPass 6 partialPass 8`, twice.

**Suites, re-measured:** `npm test` **1898 · 0** (`Files: 150`, `syntax-only: 0`, 450 blocks, 36
divergences) · `test:envelope` **129 · 0** · `test:serialize` **9 cases · 0** · `test:validate`
**23 · 0** · `test:instrument` **246 · 0** · `test:codecs` **275 · 0** · `test:trace-runner`
**269 · 0** · `test:doc-traces` **17 · 0** · `test:judge` **96 · 0** · `validate` **150 files · 0
errors · 0 warnings** · `test:trace` **194 · 0** (was 192; +3 named gates +2 encoding gates).

**Real surface (5g.3) — the control.** `npm test 09-binary-tree-general/07-flatten-binary-tree.md` →
`✅ [PASS] (6 assertions)`.

**A note on slicing, because it is the honest shape of this row.** Half one cannot go green without
half two and half two cannot go green without half one — flatten is the only guide that needs either.
They are committed as ONE slice for that reason and the second half is named as a separate rule above
rather than folded into the first, because it is one: it is not about void targets, it is about both
sides of a comparison being in one vocabulary. The alternative was two commits, the first with a gate
that could never pass, which §5b forbids in the only terms that mean anything.

### 2026-10-05 — row 15, part 7: the recorded call must be the one NEAREST the assertion. **14 → 11.**

`15-math/05-powx-n`'s script checks its float result without any asserter:

```js
const got = fn(2.1, 3);
if (Math.abs(got - 9.261) > 1e-9) { console.error('FAIL float power: …'); process.exit(1); }
```

So that call is recorded and **never consumed** — there is no asserter to consume it. The recording is
first-wins, so the NEXT assertion kept it: the committed head carried
`{"name":"integer power","args":[2.1,3],"expected":1024}`, a case asserting `myPow(2, 10) == 1024`
while calling `myPow(2.1, 3)`. Three levels, `passed 7 failed 2`.

**Shipped: a TARGET call always re-records.** The distinction first-wins was actually drawing —
HELPER versus TARGET — is untouched and its own note (`findWords(board, WORDS)`, whose script builds
`board` through a spied helper first and must record the helper's level-order array, not the target's)
still governs. What changed is two TARGET calls before one assertion: the nearest one wins, because
the nearest one is the one the assertion is about.

**The untransportable marker moves with it, and that half is not cosmetic.** `__TX__` describes the
arguments of the call that set it, so a later TRANSPORTABLE call has to clear it — otherwise the next
assertion is dropped for a stale reason. Left as `if (__args === null) __TX__ = 1`, the marker would
have survived a good call and taken the next assertion down with it.

**What this costs, stated plainly.** The author's float check is not an asserter, so it produces **no
case at all** — the harvest cannot see a comparison it is not told about. That is a coverage loss, and
it is the honest trade: the alternative was grading `myPow(2, 10)` against the value the author wrote
for `myPow(2.1, 3)`. Nine cases per level remain, all of them authored `assertEq` assertions.

**RED first, `npm run test:trace`, exit 1:**

```
❌ [FAIL] S28 nearest: 15-math__05-powx-n L1 passes every case — the float check asserts through `if (…) process.exit(1)`, so its call leaked into the next case
   passed 7, failed 2 · first error: (a case compared unequal)
❌ [FAIL] S28 nearest: 15-math__05-powx-n L2 passes every case — the float check asserts through `if (…) process.exit(1)`, so its call leaked into the next case
   passed 7, failed 2 · first error: (a case compared unequal)
Assertions: 197 | Failures: 3
```

**GREEN after the re-record:**

```
S17 ratchet: 450 heads · zero-pass 6 (baseline 6) · partial-pass 5 (baseline 5) · clean 439
Assertions: 197 | Failures: 0
```

**Census before → after** (`node /tmp/census.mjs`):

```
before   clean 436  zeroPass 6  partialPass 8
after    clean 439  zeroPass 6  partialPass 5
```

`clean` moved by **exactly 3** — powx-n L1/L2/L3 — and `zero-pass` did not move. The 5 remaining
partial are `next-right-pointers-ii` L2/L3 (X3), `merge-k-sorted-lists` L1/L2 (X4) and
`sorted-array-to-bst` L1 (M8, alias-loop membership — the author's second loop iterates only L2/L3, so
`treeHeight(...) <= 3` is false for L1's brute force, and the harvested case carries `callee: 'fn'`, an
alias bound in BOTH loops, so the level partition cannot tell them apart).

**Determinism, two consecutive `npm run gen:traces`:** `clean 439 zeroPass 6 partialPass 5`, twice.

**Suites, re-measured:** `npm test` **1898 · 0** (`Files: 150`, `syntax-only: 0`, 450 blocks, 36
divergences) · `test:envelope` **129 · 0** · `test:serialize` **9 cases · 0** · `test:validate`
**23 · 0** · `test:instrument` **246 · 0** · `test:codecs` **275 · 0** · `test:trace-runner`
**269 · 0** · `test:doc-traces` **17 · 0** · `test:judge` **96 · 0** · `validate` **150 files · 0
errors · 0 warnings** · `test:trace` **197 · 0** (was 194; +3 named gates).

**Real surface (5g.3) — the control.** `npm test 15-math/05-powx-n.md` → `✅ [PASS] (12 assertions)`,
which includes the float check the harvest cannot see.

### 2026-10-05 — row 15's residual: **11 blocks left, and 4 of them are the trust boundary**

Census at `34c06b8`+this slice, `node /tmp/census.mjs`: **clean 439 · zero-pass 6 · partial-pass 5**.
The 52 the handoff named are now **41 closed and 11 open**, and the 11 split cleanly:

| # | Blocks | Guide | Why it is not closed here |
|---|---|---|---|
| X1 | 3 | `01-array-string/12-insert-delete-getrandom-o1` L1/L2/L3 | its answer IS the draw sequence; closing it needs a global `Math.random` stub, which §5d forbids. **This is the stop the handoff flagged.** The op list is REFUSED for it on purpose (part 2), and three S23 assertions keep it wrong so no later slice can close it by making it non-deterministic |
| X2 | 3 | `09-binary-tree-general/10-lowest-common-ancestor` L1/L2/L3 | `assertEq(fn(t1, findNode(t1,5), findNode(t1,1)).val, 3)`. S21 already carries the derived nodes as level-order arrays; `buildBundle` decodes each wire into a FRESH graph, so positions 1 and 2 become three unrelated trees and `pathToNode` walks `root` looking for `p` by `===` and never finds it. **A level-order wire is a VALUE encoding and cannot express object identity** — the codec's own header on `listToArray` records that E7 back-references solve this inside one graph and not across two |
| X3 | 2 | `09-binary-tree-general/14-next-right-pointers-ii` L2/L3 | the guide's nodes are `{val, left, right, next}` and `arrayToTree` builds no `next`. The only recorded input is the level-order array, so `connect` walks `cur.next` on `undefined`. Closing it means running the author's `arrayToNextTree` inside the driver — §5d |
| X4 | 2 | `21-divide-conquer/04-merge-k-sorted-lists` L1/L2 | `assertEq(fn([]), null)`: `[]` is both "no lists" (what the author wrote) and "the empty list" (the `list` codec's wire), and `acceptsNodeWire` cannot separate them. **Measured, not argued:** declining `[]` as a wire fixes these two and breaks `invert-binary-tree` L1/L2/L3 — census 398 → 397. Probe reverted, `api/_lib/codecs.mjs` unmodified |
| M8 | 1 | `21-divide-conquer/01-sorted-array-to-bst` L1 | the author's SECOND loop iterates `[sortedArrayToBSTSliced, sortedArrayToBST]` only, so `treeHeight(...) <= 3` is genuinely false for L1's brute force. The harvested case carries `callee: 'fn'` — an alias bound in BOTH loops — so the level partition cannot tell which loop it came from. The mechanism the fix needs is "record an alias loop's membership", which is a new harvest fact rather than a driver change |

X1, X2, X3 and X4 are all one sentence: **the wire cannot express what the author wrote.** Closing any
of them means either an authored-script execution inside the driver or a change to the codec
registry's wire domain — the two things §5d and §6 rule out, and the two decision C3's reopen
condition names. They are reported, not taken.

### 2026-10-05 — row 15's six slices: `npm run verify` green, and the portal ships a clean verdict

**`npm run verify` → exit 0**, measured end to end at `b75dd5a`, with `gen:traces` re-running first
because the goldens are gitignored (E32). What it printed, in order:

```
audit:check · gen:traces → problems 150  covered 150  uncovered 0 · validate → Scanned: 150, Errors: 0 | Warnings: 0
npm test        → Files: 150 (runtime-tested: 150, syntax-only: 0) · Syntax blocks checked: 450 | Runtime assertions: 1898 · Failures: 0
test:judge      → Assertions: 96  | Failures: 0      test:chat      → Assertions: 471 | Failures: 0
test:trace      → Assertions: 197 | Failures: 0      S17 ratchet: 450 heads · zero-pass 6 (baseline 6) · partial-pass 5 (baseline 5) · clean 439
test:envelope   → Assertions: 129 | Failures: 0      test:serialize → 9 cases, failures: 0
test:validate   → Assertions: 23  | Failures: 0      test:codecs    → Assertions: 275 | Failures: 0
test:instrument → Assertions: 246 | Failures: 0      test:cases     → Files covered: 41 | Failures: 0
test:doc-traces → 17 assertions, 0 failures          test:dryrun-player → Checks: 40 | Failures: 0
test:e2e        → 272 passed, 18 skipped             build → Bundled 175 modules, Published docs/traces/
```

`test:trace-runner` is **not** in `verify`'s chain and was measured on its own: **269 · 0**.

**The residual in one line: `clean 439 · zero-pass 6 · partial-pass 5`.** Row 15's cell now reads
**`PARTIAL — 11/450 verdicts still wrong`**, and §7's closing table names each of the 11 with the
reason and the mechanism its fix would need.

**Real surface (5g.4).** `npx serve docs -l 8137` (background), Playwright MCP at the default
viewport, guide `155. Min Stack` — one of the 19 blocks this row's first slice closed, and the guide
whose authored script is the canonical op-sequence shape.

| What | Observed |
|---|---|
| Page | `http://localhost:8137/#07-stack_03-min-stack`, `<h1>` = **155. Min Stack**, Level 2 pane with its pseudocode, dry-run table and JS section rendered, 15 187 chars of guide content |
| The dry-run table the portal draws | `push(-2)` · `push(0)` · `push(-3)` · **`getMin() → -3`** · `pop()` · **`top() → 0`** · **`getMin() → -2`** — the authored op sequence, op for op |
| The trace the portal serves | `GET /traces/heads/07-stack__03-min-stack.L3.head.json` → **`verdict {"failed":0,"passed":9}`**, `stepCount 14`, `codec ops`, first step `this.stack = []`, last step `return this.stack[this.stack.length - 1][1]` |
| `GET /traces/index.json` | **HTTP 200, 164 652 B, parses**; `07-stack/03-min-stack.md → {"tableTrace":"agrees"}`, and `#verifyBadge` is **ABSENT** — which is the certified state for `agrees`, checked against the guide's own index entry rather than assumed |
| V9 on the live corpus | `144 agrees / 0 disagrees / 6 uncomparable` |

**V9's published line MOVED, `142/8 → 144/6`, and that is the gate working rather than a regression.**
It is recomputed from the traces at build time (row 32's own note: "the index is not a stored opinion
that happens to be right; it is the gate's own arithmetic"), and two guides became comparable because
their traces are no longer the collapsed `args: []` recording. `scripts/lib/v9.mjs`,
`docs/index.html` and `docs/dryrun/` are untouched by this row — `git show --stat` on all six commits
names only `scripts/gen-traces.mjs`, `api/_lib/problems.mjs`, `scripts/test-trace.mjs`,
`DRY_RUN_ENGINE_PROGRESS.md` and the `judge/traces/*.head.json` files row 28 committed.

**Server killed, port proven free.** `pkill -f "serve docs -l 8137"` → `pgrep -fl "serve docs"` prints
nothing, `curl -m 3 http://localhost:8137/` → **000 (connection refused)**, `lsof -nP -iTCP:8137` →
empty. `.playwright-mcp/` is **not** gitignored, so the screenshot and the two snapshot files were
moved out to `/tmp/row15-qa/` and the directory removed: `git status --porcelain | wc -l` → **0**.

**Committed heads, and why they are in these commits.** The 450 `*.head.json` are TRACKED (row 28
committed them; `git check-ignore` matches only `judge/traces/*.json`, i.e. the full goldens and
`manifest.json`). Leaving them stale would break S15's head-versus-golden drift gate on a fresh clone,
since `verify` regenerates the goldens and compares them against the committed heads. So each slice
commits exactly the heads whose `verdict` or `stepCount` it moved — 28, 12, 4, 6, 3 and 3 across the six
slices — and never a full golden, never `build/`, never `docs/traces/`.

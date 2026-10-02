# Dry-Run Engine — Plan v3 (scrutinised v2)

> **Provenance.** v2 = v1 + AOT build-time instrumentation (Acorn), `Proxy`
> mutation tracking, owner decision #5. v3 is v2 after an adversarial hyperplan
> round (4 personas: `[ULTRA]`, `[UNSPEC-HIGH]`, `[UNSPEC-LOW]`, `[ARTISTRY]`)
> targeted specifically at those deltas. Sixteen concessions survived cross-attack
> (D1–D16); six claims were killed. Hyperplan step 7 requires handing the bundle
> to the `plan` agent; the user forbade spawning, so sequencing was authored
> in-thread from the distilled bundle. Deviation recorded, not hidden.

Status: **PLAN ONLY** — no code written. Audit measured read-only 2026-10-02.

---

## 0. v3 vs v2 — the delta

### Killed in v2 (do not reintroduce)

| v2 claim | Location | Killed by | Replacement |
|---|---|---|---|
| "Wrapping input arrays in a `Proxy` captures heap mutations reliably" | §4 | `[ULTRA]`, `[UNSPEC-LOW]` | **Snapshot tracked roots each step** (D1) |
| "QuickJS emits ONLY `delta` patches for heap objects" | §4 | `[ULTRA]` | Deltas are **derived client-side** by diffing snapshots (D2) |
| "If we allow user code, add Acorn as a dependency" | §11.5 | `[UNSPEC-HIGH]` | The judge **already** runs user code; AOT is demoted to a cache (D4, D5) |
| W0 exit = "150 specs generated" | §9 | `[UNSPEC-LOW]` | First executable milestone = goldens + diff, no UI (D10) |
| "13 renderers" | §6 | `[UNSPEC-LOW]` | ~5 primitives + presets (D15) |
| "200 randomized inputs per guide, assert L1 ≡ L2 ≡ L3" | §7 V4 | `[ULTRA]` | 150 authored equivalence relations, seeded (D14) |

### Added in v3

| # | Addition | Origin |
|---|---|---|
| D1 | One mechanism: **snapshot tracked roots** per step. No Proxy, no build-time delta | `[ULTRA]` |
| D2 | `delta` is a **client-side derivation**, not instrumenter output | `[ULTRA]` |
| D3 | **Trace-region suppression** — `__step` gated on target-function depth | `[ULTRA]` |
| D4 | **Runtime instrumentation + static-trace cache**; AOT demoted to an optimization | `[UNSPEC-HIGH]` |
| D5 | Decision #5 reframed honestly (judge already executes user code today) | `[UNSPEC-HIGH]` |
| D6 | Generated `watch` list (params + mutated locals) ⇒ byte budget is a consequence | `[UNSPEC-LOW]` |
| D7 | Build emits **`lineMap`** (`instrLine → guideLine`); post-hoc rebase cannot work | `[ULTRA]` |
| D8 | Acorn is a **devDependency**; scoped exception to the zero-dep rule, documented | `[UNSPEC-HIGH]` |
| D9 | Byte budget with degrade-to-diff; never snapshot a full grid per statement | `[UNSPEC-HIGH]` |
| D10 | **First executable milestone: goldens + diff. No UI, no renderer** | `[UNSPEC-HIGH]` |
| D11 | Tier-1 table player ships as an honest standalone deliverable, labelled unverified | `[UNSPEC-LOW]` |
| D12 | Sentences generated structurally; optional CI-checked per-guide override map | `[ARTISTRY]` × `[UNSPEC-LOW]` |
| D13 | Truncation split: execution cap (verdict-safe) vs display cap (UI-only) | `[ULTRA]` (round 1) |
| D14 | V4 needs 150 authored equivalence relations; seeded deterministic cases | `[ULTRA]` (round 1) |
| D15 | ~5 renderer primitives + presets | `[UNSPEC-LOW]` (round 1) |
| D16 | Still missing: **any learning mechanism** | `[ARTISTRY]` (round 1, unstruck) |

---

## 1. Audit (decision-relevant facts only)

159 guides / 150 with LeetCode links · 450 dry-run tables (3 per guide) · **27 thin**
tables (0/1/2 rows; 3 empty) across 23 guides · 863 JS blocks, all standalone
parseable · dry-run presence is warning-only (`scripts/validate-guide.mjs:51-54`) ·
only 5 of 150 judge specs · all 150 have fn names + cases in one map
(`scripts/test-runner.mjs:27` `RUNTIME_TESTS`) · working QuickJS sandbox
(`api/_lib/sandbox.mjs`, 3 s, **16 MB** at `:98`) · judge route already executes
**user** code (`api/judge/run.mjs`) · `extractJsBlocks()` carries **no offsets**
(`scripts/test-runner.mjs:1188`) · 57 class-based guides, 13 tree, 9 list.

---

## 2. Acceptance contract

**Correct** — per level:

| ID | Requirement | Binary check |
|---|---|---|
| D1x | Every step reproducible | `state(k)` forward-walk ≡ random-access jump, deep-equal |
| D2x | Step maps to a source line | `lineMap[instrLine]` ∈ block range in the guide file |
| D3x | Trace proves the claim | final return == that level's `RUNTIME_TESTS` expectation |

**Pedagogically sufficient:** P1 comparison operands + branch taken · P2 the
state-changing mutation is shown · P3 termination shown · P4 ≥1 edge case per guide.

---

## 3. Scenarios

| ID | Class | Pass condition | Surface artifact | Test |
|---|---|---|---|---|
| **S1** | Happy | Tier 1: `two-sum` L3 table animates row-by-row. Tier 2: same case executed → final step returns `[0,1]`, line highlighted | Playwright on `05-hashmap/06-two-sum`: animate, scrub to last step, screenshot shows `Return [0,1]` | `tests/e2e/dry-run.spec.mjs`, `scripts/test-trace.mjs` `two-sum/example1` |
| **S2** | Edge | `[]`+`0`, `[3,3]`+`6` → finite correct traces; `n=5000` → `displayTruncated:true` **with verdict unchanged** | Playwright: custom case, truncation banner, verdict still correct | `two-sum/empty`, `/dup`, `/oversize` |
| **S3** | Regression | `npm run verify` green (828+64+395); mutated canonical caught by golden diff; seeded divergence caught by V4; seeded thin table fails validator | `verify` exit 0; all 3 negative fixtures fail loudly | fixtures `mutated-canonical`, `seeded-mismatch`, table gate |
| **S4** | Learning | User commits a prediction for step *k* before reveal; scored; unavailable in degraded mode | Playwright: wrong pick → score 0, persists across reload | `tests/e2e/predict.spec.mjs` |
| **S5** | Fidelity | Trace contains **no steps from helper functions** (`arrayToTree`, `listToArray`, `buildGraph`) and **no steps after the target function returns** | Trace line histogram for `two-sum` shows only `twoSum` frames | `scripts/test-trace.mjs` `region-isolation` |

---

## 4. Architecture

```text
scripts/test-runner.mjs  RUNTIME_TESTS                 (fns / cases / scenario scripts)
        │
        ├─ gen-blocks.mjs (new)  ──► build/blocks.json
        │        ids · level · startLine · lineCount · codec · targetFn · watch[]
        │        ──► build/instrumented/<slug>-L<n>.js   (runtime-instrumented, cached)
        │        ──► build/lineMap/<slug>-L<n>.json      instrLine → guideLine
        │
        ├─ gen-traces.mjs (new) ──► judge/traces/<slug>.json   (goldens; static, shippable)
        │
        ▼
api/_lib/trace-runner.mjs (new) — execute instrumented src in EXISTING sandbox.mjs,
        │        snapshot tracked roots per step, emit __TRACE__ envelope
        ▼
api/judge/trace.mjs (new, optional — only needed for custom input)
        │
        ▼
docs/stepper.js (new) ──► docs/render.js (5 primitives + presets)
```

**AOT demoted to a cache (D4).** Instrumentation happens at **runtime** on a
parser walk, and `gen-blocks.mjs` persists the instrumented source so the live
route never re-parses. This removes the two-instrumentation-worlds problem: one
code path serves canonical code *and*, if ever wanted, user code (D5).

**Trace-region suppression (D3).** The instrumented code carries a `region` depth
counter; `__step` fires only at depth 0. Entering any non-target function
increments depth and suppresses emission. Solves the helper-noise problem in ~20
lines and is what makes S5 pass.

**Snapshot semantics (D1, D2).** At each step the runtime serializes exactly the
`watch` identifiers from `blocks.json` — parameters plus any local that appears on
a mutation site. `delta` is computed **client-side** by diffing snapshot *k* against
*k-1*. Nothing tries to detect *who* performed a write, so copy-then-mutate,
swap-via-temp, and in-place writes are all captured identically.

---

## 5. Envelope — frozen before any RED test

```jsonc
{
  "v": 1,
  "slug": "two-sum", "level": 3, "fnName": "twoSum", "codec": "json",
  "block": { "id": "05-hashmap/06-two-sum.md#b3", "startLine": 240, "lines": 18 },
  "watch": ["nums", "target", "left", "right", "maxArea"],
  "steps": [{
    "n": 7,
    "line": 281,                    // guideLine via lineMap
    "type": "if-test",              // decl|assign|if-test|loop-head|loop-back|call|return|exit
    "text": "nums[left] + nums[right] > target",
    "operands": { "nums[left]": 8, "nums[right]": 3, "target": 9 },
    "cond": true,
    "snap": { "left": 2, "right": 4, "maxArea": 0 },
    "out": "Step 7: 8 + 3 = 11 > 9 → right moves left to shrink the sum",
    "override": null                // optional per-guide sentence (D12)
  }],
  "result": [0, 1],
  "verdict": { "passed": 3, "failed": 0 },        // from the RAW run, never the traced run
  "truncated": { "execution": false, "display": false },
  "budget": { "bytes": 184320, "mode": "full" },  // "diff" ⇒ snap dropped, client derives
  "stepCount": 7
}
```

Invariants, enforced in code:

- `line` ∈ block range after `lineMap` resolution (D2x).
- `verdict` copied from an **uninstrumented** run — a trace can never alter a
  verdict. This is what makes truncation safe (D13).
- `truncated.execution` ⇒ run aborted; verdict comes from a prior complete raw run.
  `truncated.display` ⇒ all steps recorded, UI renders the first N.
- `budget.mode === "diff"` ⇒ older steps carry no `snap`; renderer draws
  transitions only (D9).
- Cycles / shared refs → id table → `{__ref: 3}`. Never `JSON.stringify` a live
  object.
- Caps: **execution** 200 000 steps (abort, TLE-shaped verdict) · **display** 2 000
  steps · **bytes** 4 MB per trace.
- `watch` must cover every identifier named in `operands` — else CI error (D12 guard).

---

## 6. Codecs

`json` · `tree` (level-order w/ `null`) · `list` (`[[val,nextIdx]…]`, optional
`cycleAt`) · `listRandom` · `nextTree` · `graph` (`n, edges[]`) · `trie` (`["word"…]`)
· `ops` (LeetCode operations JSON, for design classes) · `string` (+charset rule) ·
`bits` (+width) · `math`.

Mapping is mechanical from the §1 category scan. No per-problem guessing.

---

## 7. Five primitives + presets (D15)

| Primitive | Presets / coverage |
|---|---|
| `array` | bars (~70: array/string, two-pointer, binary-search, intervals, math, bit) · grid aspect (`matrix-grid`) · range highlight (`window-overlay`) · vertical (`stack-columns`) · bit cells (`bits-view`) |
| `linkedlist` | node cards + `next` / `random` / cycle edges (11 guides incl. LRU order) |
| `tree` | SVG + traversal cursor (`tree-svg` 21) · trie variant · heap layout toggle |
| `graph` | nodes/edges with visited + frontier states (9 guides) |
| `statecard` | class fields + method log + queue/deque (`class-state`, ~12 design guides) |

Overlay `table`: `dp-table` (1D row + 2D grid) and `recursion-tree` (frames + path).

**Event floors, not presence (D16-adjacent).** Each generated spec carries
`eventFloor` derived from the code's own control flow:

```jsonc
"eventFloor": { "if-test": 3, "pointer-move": 2, "swap": 1 }
```

CI asserts `count(event) >= eventFloor[event]`. A Two Sum trace with one
`pointer-move` and 400 steps now fails.

---

## 8. Verification spine

**V1 — Instrumentation neutrality.** Every level runs twice: raw → verdict;
instrumented → trace. Returns identical for every case. Truncation never reaches
the verdict (§5).

**V2 — Replay determinism (D1x).** Forward-walk ≡ random-access jump, deep-equal,
all k of all goldens.

**V3 — Golden traces as regression tests.** `gen:traces` writes
`judge/traces/<slug>.json`; `test:trace` re-runs and deep-diffs with step-level
output. **This is the first executable milestone (D10)** — no UI, no renderer, no
route. Turns "the implementation works as intended" for 150 problems into a
checked claim.

**V4 — Differential oracle L1 ≡ L2 ≡ L3 (D14).** Seeded, deterministic, bounded
(default 200 cases/guide). Requires an authored per-problem equivalence relation:

```jsonc
"equivalence": { "kind": "order-insensitive-nested-array", "sortBy": [0, 1] }
```

Kinds: `exact` · `boolean-exact` · `order-insensitive` · `multiset` ·
`int-with-tolerance` · `shape-only`. In-repo precedent for the non-default kinds:
order-insensitive merge (`scripts/test-runner.mjs:135`), shape-only tree compare
(`:1037`). Mismatch ⇒ shrink to a minimal failing input and print it. `15-math`
and `22-bit-manipulation` get `int-with-tolerance` and reduced case counts — never
a silent default.

**V5 — Per-problem event floors.** §7.

**V6 — Codec round-trip.** `encode(decode(input)) === normalize(input)`;
`decode → run → encode(result)` matches expectations. Guards level-order off-by-one.

**V7 — Input validation at the trust boundary.** Reject pre-execution:
non-integer where integer required, negative `n`, unsolvable `target`, cyclic tree
input, ragged matrix rows, non-lowercase trie words, unknown `ops`, oversize `n`.
Every message names the field. Written **when the input form exists**.

**V8 — Written-table quality gates.** Report-only first, then enforced: ≥3 data
rows per table; ≥1 row per shown loop iteration; ≥1 branch-taken row; ≥1
output/return row; ≥1 edge-case table per guide; `$…$` cells need a plain-text
fallback. **Backlog: the 23 guides from §1.**

**V9 — Tier 1 table ↔ Tier 2 trace cross-check.** For each level, the trace's
final state values must appear among that level's table numbers, and case names
must match. Also the CI guard for `override` sentences: every identifier an
override references must exist in that step's `snap`, or CI fails (D12).

**V10 — Real-surface QA.** Playwright per primitive (5 specs) + per preset (13
cases), plus S1–S5. Screenshots + action logs retained.

**V11 — Region isolation (S5).** Assert no step's `line` falls outside the target
function's block range, and no step occurs after the target returns.

**V12 — Learning loop (D16).** Prediction attempts/outcomes logged per problem and
level, aggregate only. Purpose: route *failures* to V8/V9 repairs. Explicitly
**not** used to auto-judge a renderer — that inference was killed in round 2.

**V13 — Degraded interview mode (D16).** A UI flag, no new engine: hides play,
scrubber, speed and predictions; reveals one step per 10 s with a timer. Rationale:
the manual's purpose is interview readiness, and an always-available scrubber is a
crutch in exactly that setting. Default-on for a problem's first run.

---

## 9. Task table (serial; one atomic action per row)

| # | Task | Files / Target | Scenario | Verify by | Status |
|---|---|---|---|---|---|
| 1 | Freeze envelope §5 → `docs/trace-schema.json` + validator | new | S1,S2 | validator accepts fixture, rejects bad one | pending |
| 2 | RED: goldens differ catches a mutated canonical fn | `scripts/test-trace.mjs` | S3 | fails before row 5 | pending |
| 3 | `gen-blocks.mjs`: ids, level, startLine, lineCount, codec, targetFn, generated `watch[]` | new → `build/blocks.json` | S1 | 450 blocks / 150 guides; offsets match markdown by spot-check | pending |
| 4 | Runtime instrumenter (Acorn walk) + **lineMap** emitter + region-depth gate | new; `acorn`, `acorn-walk` in **devDependencies** | S1,S5 | emitted `lineMap` resolves every step into its block; `D8` noted in README | pending |
| 5 | `trace-runner.mjs`: snapshot `watch` roots per step, serialize, `__TRACE__` envelope | new | S1 | V1 green on pilot 5 | pending |
| 6 | Cycle / shared-ref serializer (id table) | new | S2 | cycle case serializes, no throw | pending |
| 7 | Byte budget + degrade-to-`diff` mode | `trace-runner.mjs` | S2 | 4 MB budget degrades; no OOM under 16 MB | pending |
| 8 | Execution cap 200 k / display cap 2 k, verdict isolation | `trace-runner.mjs` | S2 | `n=5000` → display truncation, verdict still correct | pending |
| 9 | **V3 golden differ** — first executable milestone | `scripts/test-trace.mjs` | S3 | `mutated-canonical` → non-zero exit + step diff | pending |
| 10 | `gen-traces.mjs` → 150 goldens + 150 `eventFloor` + 150 `equivalence` (D14) | new; `judge/traces/*.json` | S1,S3 | 150 files; every slug has fnName + codec + ≥1 case + equivalence kind | pending |
| 11 | Codec module + round-trip self-tests (11 codecs) | new `api/_lib/codecs.mjs` | S2 | V6 green on all codecs | pending |
| 12 | V4 differential harness: seeded cases, equivalence kinds, shrink-on-mismatch | new phase in `scripts/test-runner.mjs` | S3 | `npm test` green; seeded divergence shrinks to minimal input | pending |
| 13 | V11 region-isolation assertions | `scripts/test-trace.mjs` | S5 | helper-call fixture fails; real traces clean | pending |
| 14 | Tier 1 table player: parse 450 tables, rows+columns, opaque `$…$` cells | new `docs/tableplayer.js` | S1 | parses 450; flags exactly the 27 thin tables | pending |
| 15 | **W0 ship:** `array` primitive + table player under each level's table | `docs/index.html`, `docs/render.js` | S1 | Playwright: `two-sum` L1 animates; controls work; 390px OK; honest "unverified" label | pending |
| 16 | Tier 1 remaining presets: stack / matrix / window / bits | `docs/render.js` | S1 | 5 presets render from tables | pending |
| 17 | Tier 2 `linkedlist`, `tree`, `graph`, `statecard` + `table` overlay | `docs/render.js` | S1,S2 | cycle, tree, graph, LRU-ops cases render | pending |
| 18 | `/api/judge/trace` route: read-only, optional auth, rate limit, envelope caps | new | S1,S2 | 405/400/401/429/200 contract tests | pending |
| 19 | Custom-input form per codec + V7 validation | `docs/stepper.js` | S2 | invalid input → field error, no request | pending |
| 20 | V5 event-floor gate | `scripts/test-trace.mjs` | S3 | under-floor trace fails | pending |
| 21 | V9 table↔trace cross-check + `override` identifier guard | `scripts/test-trace.mjs` | S3 | seeded table edit fails; bad override fails | pending |
| 22 | S4 prediction-commit UI + scoring | `docs/stepper.js` | S4 | wrong pick scores 0; persists across reload | pending |
| 23 | S4/V13 degraded interview mode | `docs/stepper.js` | S4 | toggle hides controls; 10 s timer advances one step | pending |
| 24 | V12 aggregate learning-loop logging | `docs/stepper.js`, `api/_lib/kv.mjs` | S4 | events land in KV; no per-render inference | pending |
| 25 | V8 report-only scan → repair the 23 thin-table guides | `scripts/validate-guide.mjs` + 23 files | S1 | scan reports 0 thin tables | pending |
| 26 | Promote V8 warnings → errors; wire `gen:traces`, `test:trace` into `verify` | `package.json`, `scripts/validate-guide.mjs` | S3 | `verify` exit 0; seeded bad guide exits 1 | pending |
| 27 | Design pass: timing, contrast, keyboard, mobile, reduced-motion | `docs/stepper.js` | S1 | screenshots 1440px + 390px; no overlap | pending |

---

## 10. Waves

| Wave | Rows | Exit criterion | Visible? |
|---|---|---|---|
| **W0 Schema + goldens** | 1–13 | Envelope frozen; 150 goldens generated; V1/V2/V3/V4/V6/V11 green on all 150 | No UI — but **finds real bugs** |
| **W1 Table player** | 14–16, 25 | 450 tables parse; `array` + 4 presets animate authored traces; 27 thin tables repaired | **Yes — first pixels** |
| **W2 Tier 2 render** | 17 | All 5 primitives + overlay animate executed traces | **Yes** |
| **W3 Custom input** | 18, 19 | Live route; custom cases animate; V7 green | **Yes** |
| **W4 Learning loop** | 22–24 | Prediction scored; degraded mode; V12 logging | **Yes** |
| **W5 Integrity** | 20, 21, 26 | Event floors + cross-check enforced; `verify` green | Indirect |

**Kill criterion.** If W0's differential harness surfaces more than ~15 guides
needing genuine adjudication, stop: the canonical solutions have real bugs and the
visual product is the wrong next move. Fix code first.

---

## 11. Risks

| Risk | Likelihood | Response |
|---|---|---|
| Snapshot volume vs 16 MB (`sandbox.mjs:98`) — `17-multi-dp` grids, `merge-k-sorted-lists` | high | generated `watch` + 4 MB budget + degrade-to-`diff` (D6/D9) |
| Instrumentation alters semantics (parser walk over real guide code) | high | V1 neutrality gate; region suppression (D3) |
| `lineMap` drift after any guide edit | high | regenerated in `gen-blocks`; CI fails on unresolvable line |
| Equivalence relations expose genuine logic bugs | medium-high | that is the point — kill criterion above |
| Step explosion: `19-graph-bfs/03-word-ladder.md`, `14-backtracking`, `17-multi-dp` | high | display cap 2 k, execution cap 200 k |
| Design classes need ops scripts (57 class guides) | certain | `ops` codec reusing `RUNTIME_TESTS.script` |
| L1 helpers needed by the driver | certain | bundle all three blocks as `buildBundle` already does |
| Auth wall blocks logged-out learners | high | route read-only + anonymous, tighter cap (owner decision 1) |
| Stepper becomes a crutch | high | V13 degraded mode, default-on first run |
| Frozen sentences go stale | medium | D12 override map, CI-checked against step snapshots |
| `docs/index.html` hand-written with classic-script globals | medium | module strategy decided in row 15, not at render time |
| acorn/walk violates the zero-dep curriculum rule | medium | devDependencies only; README note (D8) |

---

## 12. Owner decisions

1. Anonymous dry runs? (recommend yes — read-only, 10/min, cached)
2. Animate all three levels or L3 only? (recommend all three for Tier 1 since it is
   nearly free; L3 only for Tier 2)
3. Goldens in KV or static JSON under `docs/`? (recommend **static JSON** — offline,
   no KV dependency, and it makes W1 shippable with no route at all)
4. Server QuickJS vs browser tracer? (recommend server; browser only if p95 > 800 ms)
5. **Will tracing ever cover user-submitted code?** (reframed from v2: the judge
   *already* executes user code for verdicts. Recommend: canonical only for now,
   but keep the instrumenter runtime so this stays a config change, not a rewrite.)
6. Is degraded interview mode acceptable as default-on for a problem's first run,
   or opt-in only?

---

## 13. Definition of done

- 150/150 guides: Tier 1 animates all three levels from W1; Tier 2 animates the
  canonical level on default **and** custom input.
- 150/150 goldens; 150/150 equivalence relations; V4 green.
- V1–V13 green in `npm run verify`; seeded fixtures for mutation, divergence, thin
  table, and bad override all fail loudly.
- Zero thin dry-run tables, each cross-verified against its executed trace.
- No trace step outside the target function (V11).
- S4 in place: prediction scored, degraded interview mode available.
- Playwright evidence per primitive + per preset, screenshots retained.

**Deliberately not built:** 150 bespoke animations · hand-authored judge specs ·
`Proxy` interception · build-time delta emission · hand-written interpreter ·
any auto-judgement of renderer quality from learner accuracy.
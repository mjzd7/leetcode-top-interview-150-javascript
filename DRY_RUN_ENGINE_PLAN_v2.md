# Dry-Run Engine — Plan for all 150 Problems (with per-category verification)

Status: PLAN ONLY — no code written. Audit numbers below were measured from the
repo on 2026-10-02 (read-only scan), not assumed.

---

## Audit — what already exists

| Fact | Evidence |
|---|---|
| 159 markdown guides, 150 carry `- **LeetCode Link**` | scan of `NN-*` dirs |
| 450 dry-run tables = 3 per problem guide (L1/L2/L3) | `### Step-by-Step Dry Run` count |
| 27 of 450 tables are **thin** (0/1/2 data rows); 3 have zero rows | row histogram: `0:3, 1:8, 2:16, 3:102, 4:225, 5:51, 6:21, 7:16, 8:3, 9:3, 11:1, 13:1` |
| 23 guides have at least one thin table | e.g. `05-hashmap/06-two-sum.md` L1+L2 show only the return step |
| 863 ` ```javascript ` blocks; every guide ≥3, all standalone-parseable | `scripts/validate-guide.mjs:37`, `scripts/test-runner.mjs` phase 2 |
| Dry-run presence is only a **warning**, never an error | `scripts/validate-guide.mjs:51-54` |
| Only **5** of 150 problems have judge specs | `judge/tests/` = two-sum, valid-parentheses, search-insert-position, climbing-stairs, invert-binary-tree |
| All 150 already have executable fn names + cases in one map | `scripts/test-runner.mjs:27` `RUNTIME_TESTS` (fns / cases / script forms) |
| Working untrusted-JS sandbox + verdict driver already live | `api/_lib/sandbox.mjs` (QuickJS, 3 s timeout, 16 MB, log caps), `api/_lib/problems.mjs` `buildBundle` |
| Judge route requires auth, 20 runs/min | `api/judge/run.mjs:2-21` |
| Portal renders markdown client-side; no stepper exists | `docs/index.html`, `scripts/build-site.mjs` writes `docs/curriculum-data.js` |
| Category shape: 57 class-based guides, 13 tree, 9 list, 1 graph helper | per-category scan |

**Consequence:** this does not need 150 hand-built animations, and does not need
150 hand-written judge specs. It needs **one trace engine + category renderers +
a spec generator that reuses `RUNTIME_TESTS`**.

---

## 1. Definition of "proper dry run" (acceptance contract)

Correct — per level (L1/L2/L3):

| ID | Requirement | Binary check |
|---|---|---|
| D1 | Every execution step is reproducible | `state(k)` computed by forward-walk and by random-access jump are deep-equal, for all k |
| D2 | Every step maps to a source line in the shown code block | `line` ∈ `[blockStart, blockStart + blockLines)` |
| D3 | The trace proves the guide's claim | final returned value == value asserted in that level's `RUNTIME_TESTS` case |

Pedagogically sufficient:

| ID | Requirement | Binary check |
|---|---|---|
| P1 | Shows operands of each comparison + branch taken | every `if`/`while` step has `conditionResult` + operand values |
| P2 | Shows the mutation that changed state | every state delta maps to array-write / pointer-move / push / pop event |
| P3 | Shows termination | last step is return/exit; loop counter reaches its bound |
| P4 | Shows at least one edge case per guide | ≥1 dry-run table derived from empty / single / duplicate / max input |

---

## 2. Scenarios (the contract for the whole build)

| ID | Class | Pass condition | Real-surface artifact | Automated test |
|---|---|---|---|---|
| **S1** | Happy path | L3 canonical fn traced on LeetCode Example 1 → final step returns expected value; UI shows step 1..N with the code line highlighted | Playwright: load `05-hashmap/06-two-sum`, click *Animate Example 1*, scrub to last step, screenshot shows `Return [0,1]` | `tests/e2e/dry-run.spec.mjs` + `scripts/test-trace.mjs` case `two-sum/example1` |
| **S2** | Edge / adversarial | `nums=[], target=0` and `nums=[3,3], target=6` both produce finite, non-crashing, correct traces; `n=5000` returns `truncated:true` with no hang | Playwright: type custom case, run, verdict banner shows `truncated` | `scripts/test-trace.mjs` cases `two-sum/empty`, `two-sum/dup`, `two-sum/oversize` |
| **S3** | Adjacent-surface regression | `npm run verify` still green (828 + 64 + 395 assertions); a **mutated** canonical solution is detected as a trace mismatch | `npm run verify` exit 0; mutation fixture fails loudly | `scripts/test-trace.mjs` negative fixture `mutated-canonical` |

---

## 3. Architecture (reuses what exists; zero new runtime deps)

```text
scripts/test-runner.mjs  RUNTIME_TESTS        (single source of truth: fns + cases + scripts)
        │  gen-trace-specs.mjs  (new, build-time: AST instruments canonical code via Acorn)
        ▼
judge/traces/<slug>.json   (spec: slug, fnName, codec, cases, category, instrumentedJs)
        │
        ▼
api/_lib/trace-bundle.mjs (new) — extends buildBundle(): wraps pre-instrumented code
        │                         from JSON, appends __TRACE__<json> envelope
        ▼
api/_lib/sandbox.mjs (EXISTING — QuickJS, timeout/memory/log caps reused as-is)
        │
        ▼
api/judge/trace.mjs       (new route) → ExecutionStep[]  (same envelope discipline)
        │
        ▼
docs/stepper.js           (new) — timeline scrubber, code highlight, renderer dispatch
        │
        ▼
docs/renderers/*.js       (new, one per data-structure family)
```

**Why server-side QuickJS, not in-browser Babel instrumentation:** the sandbox,
timeout, memory cap, bundle builder, verdict-envelope parser, rate limiter, and the
828-assertion test suite already exist and are tested. A browser tracer needs a JS
parser shipped to the client. By shifting AST instrumentation to BUILD TIME (AOT),
we keep Vercel runtime dependencies at zero. The API route simply executes the
pre-instrumented JS string with custom inputs. Trade-off accepted: one network hop. Mitigation: golden-trace cache keyed
`slug + fn + inputHash` in KV.

---

## 4. Trace data model

```jsonc
{
  "steps": [{
    "n": 7,
    "line": 42,                 // absolute line in the guide file
    "level": 3,                 // 1 | 2 | 3
    "type": "if-test",          // decl|assign|if-test|loop-head|loop-back|call|return|mutate|exit
    "desc": "nums[left] + nums[right] = 8 + 3 = 11",
    "vars": { "left": 2, "right": 4, "maxArea": 0 },
    "delta": { "path": ["right"], "from": 4, "to": 3 },
    "cond": true,
    "callStack": ["twoSum"],
    "out": "Step 7: sum 11 > target → shrink right"
  }],
  "result": [0, 1],
  "truncated": false,
  "stepCount": 7
}
```

Constraints enforced by schema, not by hope:

- `line` must be inside the bound block (D2).
- `vars` snapshot per step: QuickJS emits ONLY `delta` patches for heap objects (arrays/trees) to prevent IPC envelope bloat. The frontend stepper applies the merge. Cap **2000 steps**.
- Heap mutations (e.g. `nums[i] = 5`) are captured reliably by wrapping input arrays in a `Proxy` during trace execution, avoiding fragile AST member-expression analysis.
- Cyclic / shared structures serialized with an id table → `{__ref: 3}`; never
  `JSON.stringify` a live object (QuickJS `ctx.dump` chokes on cycles).
- `out` = human sentence synthesized structurally by the AOT-instrumented AST (e.g. evaluating operands of a BinaryExpression: `${left_val} > ${right_val} -> branch taken`), never hand-written.

---

## 5. Codecs (input parsing per category — S2 depends on this)

| Codec | Input shape | Renderer family |
|---|---|---|
| `json` | `number[]`, `string[]`, nested arrays | array / matrix / table |
| `tree` | level-order with `null` | binary tree, BST |
| `list` | `[[val, nextIdx], …]`, optional `cycleAt: n` | linked list |
| `listRandom` | `[[val, nextIdx, randIdx], …]` | linked list + random ptr |
| `nextTree` | level-order with `null` | next-pointer tree |
| `graph` | `n, edges[]` | graph BFS/DFS |
| `trie` | `["word", …]` | trie |
| `ops` | LeetCode operations/arguments JSON | design classes (LRU, MinStack, Trie, MedianFinder) |
| `string` | raw string + charset rule | string / two-pointer |
| `bits` | integer + width | bit manipulation |
| `math` | numbers only | math / pow / sqrt |

Category → codec mapping is mechanical, taken from the per-category scan above
(linked list = `list`, tree guides = `tree`, trie = `trie`, design = `ops`, …).
No per-problem guessing.

---

## 6. Renderers (ordered by problem count — highest value first)

| # | Renderer | Problems | Required emitted events |
|---|---|---|---|
| R1 | `array-bars` (values, index labels) | ~70 (array/string, two-pointer, sliding-window, binary-search, intervals, math, bit) | `compare`, `assign`, `swap`, `pointer-move`, `range` |
| R2 | `window-overlay` (sliding window) | 4 + overlaps | `window-resize`, `window-slide`, `freq-update` |
| R3 | `stack-columns` | 5 + overlaps | `push`, `pop`, `peek`, `match` |
| R4 | `matrix-grid` | 5 + overlaps | `cell-write`, `cell-mark`, `row-clear`, `col-clear` |
| R5 | `linked-list` (nodes + next/random arrows) | 11 | `node-visit`, `pointer-advance`, `relink`, `cycle-detect` |
| R6 | `tree-svg` (BST + general + next-pointers) | 21 | `node-visit`, `edge-traverse`, `swap-children`, `return-unwind` |
| R7 | `graph-canvas` | 9 | `node-visit`, `edge-scan`, `mark`, `frontier-push` |
| R8 | `dp-table` (1D row + 2D grid) | 14 | `dp-write`, `dp-read`, `cell-activate` |
| R9 | `heap-tree` (array ↔ tree toggle) | 4 | `sift-up`, `sift-down`, `swap`, `peek` |
| R10 | `recursion-tree` (backtracking, divide-conquer) | 11 | `frame-push`, `frame-pop`, `choice`, `prune` |
| R11 | `trie-tree` | 3 | `insert-char`, `terminal-set`, `search-fail` |
| R12 | `class-state` (design: LRU order, MinStack, Trie, MedianFinder) | ~12 | `method-call`, `state-write`, `evict` |
| R13 | `bits-view` | 6 | `bit-set`, `bit-clear`, `shift` |

13 renderers cover all 150. **Not 150.**

---

## 7. The verification spine

### V1 — Instrumentation neutrality (kills the #1 risk)
Run each level's code **twice**: once raw → verdict; once instrumented → trace +
verdict. Assert identical return values for every case. An instrumentation bug
can never silently ship.

### V2 — Replay determinism (D1)
`state(step k)` computed by forward-walk and by random-access jump must be
deep-equal for every k of every golden trace.

### V3 — Golden traces as regression tests (implementation correctness for all 150)
`npm run gen:traces` writes `judge/traces/<slug>.json` with the recorded steps for
the level-3 canonical fn on all its cases. `npm run test:trace` re-runs and
**deep-diffs**. Any edit to a canonical solution that changes observable behaviour
fails CI loudly with a step-level diff. This is what makes "the implementation
works as intended" a *checked* claim for 150 problems, not a review opinion.

### V4 — Brute force as differential oracle (free correctness, already in repo)
Every guide ships L1 brute force and L3 canonical. Extend the generator: for
**N = 200 randomized inputs per guide** (small domains for math/bit, bounded n
elsewhere), assert L1 ≡ L2 ≡ L3. On mismatch, shrink to a minimal failing input
and print it. Catches real logic bugs in optimized solutions that fixed cases miss.
Cost: pure CPU inside `test-runner.mjs`, no new infra.

### V5 — Category event-coverage gate (kills "animation plays but teaches nothing")
Each renderer declares a **required event set** (§6). CI asserts every golden trace
contains ≥1 of each required event for its category. A Two Sum trace with zero
`pointer-move` events fails, even though it "ran fine".

### V6 — Codec round-trip property
For every case: `encode(decode(input)) === normalize(input)`, and
`decode → run → encode(result)` matches the expected representation. Guards
tree/list/graph/trie/nextTree codecs against off-by-one in level-order handling —
the classic silent-wrong-visualization bug.

### V7 — Per-category input validation (trust boundary, never lazy)
Reject before executing: non-integer where integer required, negative n, `target`
outside the solvable domain, cyclic tree input, ragged matrix rows, non-lowercase
trie words, oversized n (>2000 → `truncated`), unknown ops for design classes.
Every rejection message names the offending field.

### V8 — Written-table quality gates (fix the 27 thin tables)
Promote the current warning into staged gates, report-only first:
- every dry-run table ≥3 data rows, ≥1 row per loop iteration shown, ≥1
  branch-taken row, ≥1 output/return row;
- per guide: ≥1 edge-case table derived from empty/single/duplicate/max input;
- no `$…$` KaTeX inside cells without a plain-text fallback (KaTeX cells are
  unparseable by machines — this is why the machine-readable spec is a JSON
  sidecar, not parsed prose).

Remediation backlog = the 23 guides found in the audit (two-sum L1/L2,
valid-palindrome L1, kth-smallest L1, search-insert-position L1, …).

### V9 — Written table ↔ animation cross-check
For each level, assert the animation's **final state values** appear among the
numbers in that level's markdown table (loose set-containment), and that the level's
asserted case name matches. Catches drift where the guide's table was hand-edited
and no longer matches the code.

### V10 — Real-surface QA gates (Playwright, config exists)
Per renderer: load a real guide page, run default case + custom case, assert
timeline controls, code-line highlight, step count, and final verdict in the DOM;
capture screenshot + action log. One spec file per renderer family (13 files), plus
S1/S2/S3 specs.

---

## 8. Task table (serial; each row = one atomic action)

| # | Task | Files / Target | Scenario | Verify by | Status |
|---|---|---|---|---|---|
| 1 | Export `RUNTIME_TESTS` map + block offsets from `test-runner.mjs` | `scripts/test-runner.mjs` | S3 | import map → 150 keys, exits 0 | pending |
| 2 | Write RED spec: generator emits 150 trace specs | `scripts/test-trace.mjs` | S1,S3 | run → fails "expected 150 specs, got 0" | pending |
| 3 | `scripts/gen-trace-specs.mjs`: AOT AST instrumentation (Acorn), codec, cases | new | S1 | `npm run gen:traces` → 150 files with `instrumentedJs` | pending |
| 4 | Codec module: json/tree/list/listRandom/nextTree/graph/trie/ops/bits round-trip + self-tests | new `api/_lib/codecs.mjs` | S2 | V6 property test green on all codecs | pending |
| 5 | RED: instrumented run ≡ raw run | `scripts/test-trace.mjs` | S3 | fails before task 6 | pending |
| 6 | `trace-bundle.mjs`: assemble pre-instrumented block + `Proxy` mutation tracker + `__TRACE__` envelope | new | S1 | V1 green on pilot 5 | pending |
| 7 | Snapshot serializer: cycles / shared refs via id table | new | S2 | cycle case serializes, no throw | pending |
| 8 | Step cap 2000 + `truncated:true` path | `api/_lib/trace-bundle.mjs` | S2 | `n=5000` → truncated, <3 s, no hang | pending |
| 9 | Line-number rebasing to absolute guide lines | `trace-bundle.mjs` | S1 | every `step.line` inside its block range (D2) | pending |
| 10 | `/api/judge/trace` route: auth-optional read-only, rate limit, envelope caps | new | S1,S2 | 405/400/429/200 contract tests | pending |
| 11 | V3 golden-trace differ | `scripts/test-trace.mjs` | S3 | mutated fixture → non-zero exit with step diff | pending |
| 12 | V4 randomized differential L1≡L2≡L3, 200 cases/guide, shrink on mismatch | `scripts/test-runner.mjs` (new phase) | S3 | `npm test` green; seeded mismatch fixture shrinks | pending |
| 13 | `docs/stepper.js` shell: timeline, scrub, play/pause, speed, code highlight | new | S1 | Playwright: scrub changes highlighted line | pending |
| 14 | R1 `array-bars` + `matrix-grid` | new | S1,S2 | S1 on two-sum, binary-search; e2e green | pending |
| 15 | R2 `window-overlay` + R3 `stack-columns` | new | S1 | e2e on longest-substring, valid-parentheses | pending |
| 16 | R5 `linked-list` + R6 `tree-svg` | new | S1 | e2e on cycle, invert-tree; cycle case renders | pending |
| 17 | R7 `graph-canvas` + R11 `trie-tree` | new | S1 | e2e on number-of-islands, implement-trie | pending |
| 18 | R8 `dp-table` | new | S1 | e2e on climbing-stairs, word-break; grid writes animate | pending |
| 19 | R9 `heap-tree` + R10 `recursion-tree` | new | S1 | e2e on kth-largest, N-Queens; frames push/pop | pending |
| 20 | R12 `class-state` (ops driver) + R13 `bits-view` | new | S1,S2 | e2e on LRU ops script; bad op rejected (V7) | pending |
| 21 | V5 event-coverage gate per renderer | `scripts/test-trace.mjs` | S3 | zero-event trace fails | pending |
| 22 | Wire stepper into `docs/index.html` next to each level's code block | `docs/index.html` | S1 | Playwright finds stepper; block offset matches | pending |
| 23 | Custom-input form per codec (validation messages) | `docs/stepper.js` | S2 | invalid input → field-level error, no request | pending |
| 24 | V8 report-only table-quality scan → remediation of 27 thin tables | `scripts/validate-guide.mjs` + 23 guides | S1 | scan lists 0 remaining thin tables | pending |
| 25 | Promote V8 warnings → errors after report is clean | `scripts/validate-guide.mjs` | S3 | `npm run validate` exit 1 on seeded bad guide | pending |
| 26 | V9 table ↔ animation cross-check | `scripts/test-trace.mjs` | S3 | seeded table edit → failure | pending |
| 27 | Wire new gates into `npm run verify` | `package.json` | S3 | `npm run verify` exit 0 end to end | pending |
| 28 | Design pass on stepper UI (timing, contrast, mobile) | `docs/stepper.js` | S1 | screenshots at 1440px + 390px, no overlap | pending |

---

## 9. Rollout waves (each wave independently shippable)

| Wave | Rows | Exit criterion |
|---|---|---|
| **W0 Foundation** | 1–3 | 150 specs generated from one source; zero hand-authored spec files |
| **W1 Trace correctness** | 4–11 | V1, V2, V3 green on pilot 5; route contract tests green |
| **W2 First value** | 13, 14, 22, 28 | S1 passes on `two-sum` with real code + real animation; a reviewer opens the page and it teaches |
| **W3 Bulk renderers** | 15–20 | every one of 150 guides gets ≥1 working renderer; V5 event coverage green per renderer |
| **W4 Custom input** | 23, 8, 10 | S2 passes: empty / duplicate / oversize / custom all behave |
| **W5 Correctness at scale** | 12, 24, 25, 26, 27 | randomized differential green for 150; table gates enforced; `verify` green |

---

## 10. Risks and pre-chosen responses

| Risk | Likelihood | Response |
|---|---|---|
| QuickJS lacks `Error.prototype.stack` line fidelity | medium | rely on instrumentation, not stack parsing; verify in task 6 before building renderers |
| Step explosion on `n = 10^4` (e.g. word-search II) | high | input cap per category + `truncated` flag + "show static trace instead" |
| Cyclic list input breaks `JSON.stringify` | certain | id-table serializer (task 7) |
| Design classes need ops scripts, not `fn(args)` | certain (57 class guides) | `ops` codec reusing the `RUNTIME_TESTS.script` form already in test-runner |
| Guides' L1 helpers (`arrayToTree`, `listToArray`) needed by driver | certain | bundle all three blocks, like `buildBundle` already does |
| Auth wall blocks logged-out learners | high | trace route is read-only + anonymous with a tighter cap; owner decision |
| 27 thin tables drift from code | certain | W5 V8 + V9 |
| KaTeX in table cells unparseable | certain | machine-readable spec is a JSON sidecar; prose tables stay human-only |
| 150 golden traces bloat CI | medium | per-guide step cap 2000, gzip, run in parallel shards |

---

## 11. Owner decisions needed before W1

1. Anonymous dry runs allowed? (recommend yes — read-only, 10/min, cached)
2. Animate **all three levels** or L3 only with L1/L2 as text tables? (recommend L3
   animated first, L1/L2 tables unchanged — 1/3 the renderer work, 100% of the
   learning value)
3. Cache golden traces in KV, or ship them as static JSON in `docs/`? (recommend
   static JSON — works offline, no KV dependency, Vercel-hosted)
4. Keep QuickJS on the server, or move tracing to the browser later if latency
   bites? (recommend server now; browser tracer is a Phase-2 option only if
   p95 > 800 ms)
5. Will we eventually allow tracing *user-submitted* code? (If yes, we must move AST instrumentation to the server runtime and add Acorn as a dependency. Recommend no: stick to custom inputs for canonical code).

---

## 12. Definition of done

- 150/150 guides have an animated dry run on at least one level, driven by their
  own real canonical JS.
- 150/150 custom-input forms validate per codec.
- V1–V10 green in `npm run verify`; V3 catches a seeded mutation; V4 catches a
  seeded L2/L3 divergence.
- Zero thin dry-run tables.
- Playwright evidence for all 13 renderers + S1/S2/S3, screenshots stored.

**Deliberately skipped:** 150 bespoke animations, a hand-authored judge spec per
problem, a browser-side Babel tracer, a hand-written interpreter. Each is strictly
more code for the same teaching outcome.
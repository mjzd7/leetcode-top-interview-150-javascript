# Dry-Run Engine — Plan v5.1 (scrutinised v4, verified against the repo)

> **This file is the single source of truth.** Progress against it is recorded in
> **`DRY_RUN_ENGINE_PROGRESS.md`** (repo root), one append per row, in the same
> commit as the row's code. A row is not done until its evidence is in that file.

> **Provenance.** v1 → v2 (AOT/Acorn, Proxy) → v3 (hyperplan round 1: D1–D16) →
> v4 (hyperplan round 2 in-thread: F1–F13) → **v5** → **v5.1** (tooling deltas
> folded in, owner decisions closed; §0.2 lists what changed and why).
>
> v5 differs from v4 in kind, not degree: **every audit number in v4 §1 was
> re-measured by running the repo, and three of them were wrong.** One of the
> wrong ones (RUNTIME_TESTS coverage) invalidates the ordering of v4's first
> wave. v5 therefore begins with a **row-0 gate** that v4 does not have.
>
> **Deviations recorded, not hidden.** (1) `team_create` unavailable and the user
> forbade subagents → the five personas ran **in-thread**, rounds kept intact.
> (2) Hyperplan step 7 (hand the bundle to the `plan` agent) skipped — user
> constraint. Sequencing below was authored in-thread from the distilled bundle.

Status: **PLAN ONLY** — no product code written. Audit run read-only
2026-10-02 on `ab0a678`. Scope: **the 150 guides in this repo**; expansion to the
full catalogue is a gated track (§8), not the committed deliverable.

---

## 0. Verification receipts (the part v4 skipped)

v4 asserted a §1 audit and built 27 rows on it. Re-measured:

| v4 §1 claim | Measured | Verdict |
|---|---|---|
| all 150 have fn names + cases in one `RUNTIME_TESTS` map (`:27`) | `npm test` → `Files: 150 (runtime-tested: 109, syntax-only: **41**)`; `RUNTIME_TESTS` has 109 keys (81 `fns`+`cases`, 28 `script`) | **FALSE — kills v4 row ordering** |
| byte budget **4 MB** per trace (§5 caps) | `ENVELOPE_MAX_CHARS = 1024*1024` (`api/_lib/sandbox.mjs:11`); overflow **silently drops** the envelope (`:117-123`) and only sets the shared `truncated` flag | **FALSE — 4 MB is unreachable, and a drop is indistinguishable from log spam** |
| row 24 targets `api/_lib/kv.mjs` | file exists, 73 lines, degrades to `{ok:false}` | **FALSE — reuse, do not write** |
| 159 guides / 150 with links / 450 tables / 27 thin in 23 guides / 863 JS blocks | 153 guides carry `Level 3` · 151 carry the 4-field header · 453 `### Step-by-Step Dry Run` · 813 ` ```javascript ` fences · 22 thin (2 empty) in 19 guides | **UNREPRODUCIBLE — predicate never pinned** |
| 450 syntax-checked blocks | `npm test` → `Syntax blocks checked: 450` | TRUE (and this is the number that matters) |
| 57 class-based guides | 55 guides have a `class` in a JS block | off by 2 (predicate drift again) |
| sandbox 3 s / 16 MB (`:98`) | `timeoutMs = 3000`, `memoryLimitBytes = 16*1024*1024` (`:96-98`) | TRUE |
| `extractJsBlocks()` carries no offsets (`:1188`) | verbatim at `:1188` | TRUE |
| judge route already executes user code | `api/judge/run.mjs`, 131 lines | TRUE |
| dry-run presence warning-only (`validate-guide.mjs:51-54`) | verbatim | TRUE |
| — (not in v4) | 5 judge specs; `problems.mjs:13` hardcodes 5 slugs, `:20` codec whitelist `['json','tree']` | new constraint |
| — (not in v4) | `playwright.config.mjs`: `testDir './tests'`, projects desktop 1440×900 + Pixel 7, `webServer` serves `docs/` | row 27 is nearly free |
| — (not in v4) | async/generator code: **0 lines inside any solution region**, 159 lines across 70 guides' follow-up extensions (`12-binary-search/03-find-peak-element.md:250`, `23-kadanes-algorithm/01-maximum-subarray.md:281`) | risk is bounded and lintable |
| — (not in v4) | `eval`/`new Function`: **0**. `Math.random`/`Date`: **3 guides**. `Map`/`Set`: 64 guides. Typed arrays: 19. BigInt-scale literals: 14. Self-recursive functions: most guides (heuristic 87–152, predicate owed to row 0) | drives §5 serializer + §6 region rule |
| — (not in v4) | guide = 20 KB / 556 lines; `docs/curriculum-data.js` = 3.09 MB ⇒ **~65 MB at 3 400 problems** | the scale wall is the portal, not the engine |

**Net:** v4's architecture survives. v4's **sequencing** does not — W0 as written
builds goldens and a differential oracle for 41 guides that have never been
executed.

### 0.1 v3 → v4 delta, re-verified

F1 (delta becomes an envelope field) **survives** and hardens: `full` ⇒ client
derives from `snap`, `diff` ⇒ server-emitted `delta`, no `snap`.
F2 (row-2 re-scope) **survives** but is now moot — row 2 dies with the reordering.
F3 (lexical region rule) **survives as intent, fails as mechanism** — a runtime
depth counter cannot see that a class method is lexically inside the target
(K5 below).
F4 (`watch` reaches enclosing-scope operands) **survives**.
F5 (floor pinned to canonical case; rel **and** abs 1e-9) **survives**.
F6 (`ops-terminal-state-and-outputs`) **survives**; needs `problems.mjs` widened.
F7 (CI cost tiers) **survives**, and §7 scales it down further.
F8 (score → localStorage) **survives**; the KV half already exists.
F9 (exhaustive `startLine`) **moot** — v5 stops storing line numbers (K6).
F10 (freeze point = first green row) **survives**, retargeted.
F11 (axe + 1440/390 diff) **survives** — both viewports already configured.
F12 (auto-derived "unverified") **survives**; make it *derived from data*, not a flag.
F13 (V9/D16/S4/D12 definitions) **survives**; D16 demoted (P4).

### 0.2 v5.1 — tooling deltas, measured before the rows that use them

Every tool below was confirmed on `PATH` on 2026-10-02 before any row was written
against it. A row may only name a tool that appears here.

| Tool | Version | Replaces | Which row changes shape |
|---|---|---|---|
| `jq -S` | 1.7.1 | hand-rolled JSON key sorting in assertions | **6** — serializer fixtures compared as sorted-key JSON, not `deepEqual` |
| `delta` | 0.19.2 | eyeballing a golden diff in CI logs | **13** — differ emits a `delta`-rendered side-by-side in the job log |
| `sg` (ast-grep) | 0.44.1 | a 109-entry hand edit of `RUNTIME_TESTS` | **2** — `fns` deletion is a `sg` rule + `npm test`; **4** — the `async`/`function*`/`eval` scan is `sg`, not a regex |
| Playwright (installed) | `@playwright/test` ^1.63.0 | 13 hand-written per-preset specs | **25** — one table-driven spec; `desktop` 1440×900 + `Pixel 7` projects already supply both viewports (F11 evidence for free) |
| `firecrawl` | on `PATH` | generating slugs/titles from a model | **§8-T1** — harvest the public problem list instead |

**New risk, measured from `.github/workflows/deploy.yml`:** `actions/setup-node@v4`
has **no `cache: 'npm'`**, and the job has **no time budget**. As `verify` grows to
`validate → test → test:judge → test:chat → test:e2e → build → audit → test:trace`,
every push re-downloads the full tree, and a hung Playwright or QuickJS run burns
CI minutes with no ceiling. Folded into row 30 (the row that already owns CI wiring).

**Not added, deliberately:** `hyperfine`/`tokei`/`watchexec` (shell `time`/`wc`/`fd`
cover it) · `bun`/`deno`/`uv` (QuickJS is the bottleneck; the repo is Node-20-pinned)
· `sqlite3` (JSON + git until T2 query latency hurts) · any runtime dependency beyond
`acorn` + `acorn-walk` as **devDependencies**.

---

## 1. Adversarial round 1 — independent findings

`[ULTRA]` U1**·**U2**·**U3**·**U4**·**U5**
`[UNSPEC-HIGH]` H1**·**H2**·**H3**·**H4**
`[UNSPEC-LOW]` L1**·**L2**·**L3**
`[ARTISTRY]` A1**·**A2**·**A3**
`[PONYTAIL]` P1**·**P2**·**P3**·**P4**·**P5**

| # | Finding | Evidence |
|---|---|---|
| **U1** | **41 guides have never been executed.** v4 row 10 asserts "every slug has fnName + codec + ≥1 case"; row 12's differential oracle has nothing to run on. Goldens for those 41 will be generated from code that may not work. | `npm test` summary line |
| **U2** | **The 4 MB byte budget is fiction.** The envelope slot is 1 MB and *drops* the payload on overflow, reusing the log-spam `truncated` flag. A >1 MB trace yields an empty envelope and a plausible-looking "no steps" trace. Silent-wrong is the worst failure mode in this system. | `sandbox.mjs:11`, `:117-123` |
| **U3** | **Region depth conflates two different things.** "Fires only at depth 0" suppresses a *recursive target's own body* on every recursive call. Most guides are recursive, so most traces would be empty — and S5/V11 would pass **vacuously**. | F3 rule + self-recursion in most guides |
| **U4** | **Line numbers in goldens are a churn engine.** One edited guide shifts `startLine` for every block in it and invalidates goldens repo-wide; the diff is unreadable and `lineMap drift` becomes a permanent §11 row. | v4 §5 stores `line`, §11 row 3 |
| **U5** | **Undefined serialization policy.** `undefined` silently drops a key, `NaN`/`Infinity` become `null`, `BigInt` makes `JSON.stringify` **throw inside the sandbox** (killing the run), `Map`/`Set` become `{}`. 64 guides use `Map`/`Set`, 14 use BigInt-scale literals. Golden diffs will be flaky and traces will die mid-run. | `JSON.stringify` semantics + measured guide scan |
| **H1** | **`problems.mjs` is a second registry.** 5 hardcoded slugs, codec whitelist `['json','tree']`. Row 11's 11 codecs are dead code until this widens; if it stays, slug lives in three places (guide, `RUNTIME_TESTS`, `problems.mjs`). | `problems.mjs:13`, `:20` |
| **H2** | **Block selection is unspecified.** `extractJsBlocks()` returns *all* 813 fences, including polyfills, gotcha snippets and streaming extensions. "450 blocks" only exists if selection is by **section heading**. Nothing in v4 says so. | `:1188` + measured 813 vs 450 |
| **H3** | **The route is on the critical path for no reason.** Canonical traces are static JSON in `docs/` (owner decision 3). Nothing needs a server until someone types a custom input. v4 spends wave W3 on a route with 5 contract tests before a single learner has used the static path. | v4 §4 diagram, row 18 |
| **H4** | **Two sources of truth for the same execution.** 450 authored tables + computed traces, cross-checked by V9. At 150 that is a *feature* (it catches wrong canonical code — the kill criterion depends on it). At 3 400 it is 3 400 × 3 hand-authored tables nobody will write. | v4 §8 V9, §13 |
| **L1** | **11 codecs is a guess.** Measured need: `json` (~64 guides w/ Map-Set), `ops` (55 class guides), `tree`, `list`, `graph`. The other six have no measured consumer yet. A registry with lazy per-codec implementations costs the same to start and grows on evidence. | guide category scan |
| **L2** | **Per-preset Playwright specs are 13 files of copy-paste.** One table-driven spec over the preset list gives identical coverage. | v4 row 17, V10 |
| **L3** | **Row 26's wiring is smaller than stated.** `verify` already runs `test:e2e`, and Playwright already has both viewports. | `package.json`, `playwright.config.mjs` |
| **A1** | **`watch` derivation is the real product and is unspecified.** Destructuring, `for (const x of y)`, catch params, class fields, module-level consts, loop-scoped shadowing. Every CI guard in the plan depends on this one function being right. | v4 §4, D6 |
| **A2** | **"Unverified" as a label will rot into a lie.** It should be a *derived* function of evidence (`V9 ∧ V10` per guide), rendered from data — never a stored flag. | F12, hardened |
| **A3** | **Steps that throw lose the trace.** Guide code contains `try`/`catch`, comparators can throw, `assertEq` in `script`-style entries throws by design. A thrown step must still flush what it has plus an `error` field — otherwise one throw in 2 000 steps silently truncates the trace. | 28 `script`-style entries |
| **P1** | **The route, the custom-input form, the scoring UI and the degraded mode are four features no one has asked for.** All four are downstream of "does the static path work". Trigger-gate them. | ladder rung 1 |
| **P2** | **The engine is ~5 % of the cost of the scale-up; the content is 95 %.** 20 KB of prose per guide × 3 400 = 68 MB of markdown and ~3 400 hand-adjudicated solution sets. The judge's gates (V1/V3/V4) *are* the adjudication machinery — which is why W0-first is right and why the content track, not the renderer, is the thing to design for. | measured bytes/line |
| **P3** | **Delete before adding.** `PILOT_SLUGS`, the `fns` duplication in `RUNTIME_TESTS`, the 813-vs-450 ambiguity, three new `docs/*.js` global scripts → one ES module. Net-new surface in v5 is smaller than v4's despite covering more. | ladder rung 2/6 |
| **P4** | **D16 has admitted it is unproven, then kept the UI.** v4's own success metric says "cut to logging-only unless a repair is attributable". Build logging-only. Score the UI only when the log says it pays. | F13, D16 |
| **P5** | **Two measures beat a budget.** 4 MB / 200 k steps / 25 cases are all guesses. The repo already gives hard numbers: 1 MB envelope, 16 MB heap, 3 s. Where a budget must exist, derive it from a measured constant and mark it `ponytail:`. | `sandbox.mjs` |

---

## 2. Round 2 — cross-attack

| Attacker | Target | Attack | Outcome |
|---|---|---|---|
| `[PONYTAIL]` | `[ULTRA]` U3 | "Two counters" is a feature. Compute region membership **statically** at build time from the AST (which function nodes are lexically inside the target block) and let runtime compare one integer. No depth accounting at all. | **U3 concedes** → K5 becomes a static region table |
| `[UNSPEC-HIGH]` | `[ULTRA]` U2 | "Just raise `ENVELOPE_MAX_CHARS`." Raising a protocol constant to 4 MB trades a silent drop for a 16 MB-heap OOM on the exact inputs (huge DP grids) the budget exists to protect. | **U2 holds**, adds chunking: `__TRACE__<n>` slots, per-chunk cap, host-side assembly, one attributable `traceTruncated` flag |
| `[UNSPEC-LOW]` | `[ULTRA]` U1 | "Author 41 more entries by hand." 41 guides × 3 levels × cases is a week of prose for something a generator can produce from `blocks.json` + one authored case list per guide. | **U1 concedes the method**: cases stay authored (they encode intent), **fn names get derived** — kills the `fns` duplication too (P3) |
| `[ARTISTRY]` | `[UNSPEC-HIGH]` H3 | "Defer the route" leaves custom input permanently unbuilt, and custom input is where the *interesting* traces are (learner's own case). | **H3 partially concedes**: keep a **row-0-spike** design note (one function signature) so deferral is reversible; ship the trigger, not the route |
| `[ULTRA]` | `[UNSPEC-LOW]` L1 | "5 codecs now, add later" undercuts `gen-traces`' promise that every slug has a codec. | **L1 holds** with a hard rule: a slug with no implemented codec **fails CI loudly**; no default fallback |
| `[PONYTAIL]` | `[UNSPEC-HIGH]` H4 | "Two sources of truth" — at 150 the duplication is the *oracle*. The fix is not to remove it but to stop pretending 3 400 is the same problem. | **H4 concedes**, splits the track: canonical level authored (checked) at any scale; L1/L2 tables derived from trace above T1 |
| `[ARTISTRY]` | `[ULTRA]` U4 | "Drop line numbers and you lose the guide↔trace link that makes step 3 highlightable in the markdown." | **U4 holds**: keep the link, resolve it at render time from `blockHash` + offset, so the link survives edits |
| `[UNSPEC-HIGH]` | `[PONYTAIL]` P4 | "Logging-only is not a product, it is a stub." True, and it is the *honest* one: v4 already banned using accuracy to judge renderers, and predicted nothing. | **P4 holds** |
| `[ULTRA]` | `[PONYTAIL]` P2 | "Content is 95 % of cost — then the plan should be a content plan." No: content generation is *unbounded LLM prose* and the engine is what makes it **checkable**. Without V1/V3/V4 the content track has no quality gate and silently rots. | **P2 concedes**, reframed: engine-first is the only ordering under which scale is safe |
| `[UNSPEC-LOW]` | `[UNSPEC-HIGH]` H2 | "Section-based selection is 3 lines." Yes — and it also fixes the 813-vs-450 lie in the audit. | **H2 concedes**, promoted to a gate (K7) |

## 3. Round 3 — concessions, distilled

Survive as **K** (kills/rewrites of v4) and **G** (gains):

| # | Distilled decision |
|---|---|
| **K1** | **Row 0: runtime coverage 109 → 150.** Zero syntax-only guides, before any golden exists. `RUNTIME_TESTS` keeps *cases only*; `fns` derived from `blocks.json`. |
| **K2** | **Envelope is chunked.** `__TRACE__<seq>` slots (own cap, own `traceTruncated`), host-side assembly. Budget derived from the measured 1 MB slot, not a 4 MB wish. Degrade at 60 % of the assembled cap. |
| **K3** | **Reuse `api/_lib/kv.mjs`.** No new KV code anywhere. |
| **K4** | **Region membership is static.** `blocks.json` carries a region table (which function nodes are lexically inside the target, including class bodies, object-literal methods, getters, arrow fields). Runtime compares one integer. Recursive self-calls keep depth 0. |
| **K5** | **No line numbers in goldens.** Identity = `sha256(blockSource)`; steps carry `line: {blockHash, off}`. Render resolves to a guide line. Kills the lineMap-drift risk class. |
| **K6** | **Serializer spec is normative.** `undefined`→`{"__u":1}`, `NaN`/`±Infinity`→typed tokens, `-0`→`{"__n0":1}`, `BigInt`→`{"__bi":"…"}`, `Map`/`Set`→entries array, cycles→`{__ref}`. One canonical serializer, sorted keys, used for both the envelope and golden comparison. |
| **K7** | **Block selection is a gate.** The 450 blocks are the first ` ```javascript ` fence inside each `Level 1/2/3` heading. CI rejects `async`/`await`/`function*`/`yield` inside a solution block (measured: 0 today, so this is a cheap invariant to keep). |
| **K8** | **Trigger-gate the route, custom input, scoring UI and degraded mode** (§7). Row-0 spikes keep each reversible for <20 lines. |
| **G1** | **Codec registry with 5 implemented codecs** (`json`, `tree`, `list`, `ops`, `graph`) and a hard CI failure — never a default fallback — for any slug naming an unimplemented codec. |
| **G2** | **`scripts/audit-curriculum.mjs`** pins every count in §1 and every doc number cites it. Ends the "27 vs 22" class of argument. |
| **G3** | **Throw-safe trace flush.** Any thrown step flushes the partial trace with `error` set; verdict still comes from the raw run. |
| **G4** | **Table player and stepper are one ES module** under `docs/dryrun/`, imported once. No new globals. |
| **G5** | **"Unverified" is a pure function** of per-guide evidence (`V9 ∧ V10`), rendered, never stored. |
| **G6** | **One table-driven Playwright spec** covers S1–S5 + all presets; both existing viewports supply the 1440/390 evidence. |

Kept unchanged from v4 and *not* re-litigated: D1 snapshot-tracked roots · D2
client-side delta in `full` mode · D3 region suppression · D4 runtime
instrumentation as the single path · D6 generated `watch` · D9 budget with
degrade · D10 goldens-first · D12 override map with CI guard · D13 truncation
split · D14 seeded differential · D15 five primitives · F1 · F5 · F6 · F7 · F10 ·
F11 · F12 · F13.

---

## 4. Architecture (v5)

```text
catalog/problems.json                 NEW single registry: path, slug, lcId, title,
                                      difficulty, patterns[], codec, equivalence,
                                      fnName per level, cases per level

scripts/audit-curriculum.mjs          G2 — pins every count
        │
scripts/gen-blocks.mjs  ──► build/blocks.json
        │   { path, level, blockHash, blockOffset, codec, targetFn,
        │     regionTable[], watch[], fnName }
        │   ──► build/instrumented/<path>-L<n>.js   (cached, runtime instrumented)
        │
scripts/gen-traces.mjs ──► judge/traces/<path>.json   goldens (small: see §7)
        │                ──► docs/traces/<path>.json  shippable static copy
        │
api/_lib/trace-runner.mjs  ──► existing api/_lib/sandbox.mjs  (3 s, 16 MB, 1 MB slots)
        │   chunked __TRACE__<seq> · canonical serializer · static region gate
        │
docs/dryrun/index.js  (ES module)  ──► 5 primitives + presets + table overlay
```

One instrumentation path (D4). Canonical traces are **static files under
`docs/`**, so W1/W2 need no server, no auth, no rate limit, and `vercel.json`
already ships `outputDirectory: docs`.

---

## 5. Envelope v1.1 (supersedes v4 §5; freeze at row 12 green)

```jsonc
{
  "v": 1,
  "path": "05-hashmap/06-two-sum.md", "level": 3, "fnName": "twoSum",
  "codec": "json",
  "block": { "hash": "sha256:9f2c…", "startLine": 240, "lines": 18 },
  "watch": ["nums", "target", "left", "right", "maxArea"],
  "steps": [{
    "n": 7,
    "line": { "h": "sha256:9f2c…", "off": 41 },   // resolved to a guide line at render
    "type": "if-test",                            // decl|assign|if-test|loop-head|loop-back|call|return|exit|throw
    "text": "nums[left] + nums[right] > target",
    "operands": { "nums[left]": 8, "nums[right]": 3, "target": 9 },
    "cond": true,
    "snap": { "left": 2, "right": 4, "maxArea": 0 },
    "delta": [{ "path": "left", "from": 1, "to": 2 }],
    "out": "Step 7: 8 + 3 = 11 > 9 → right moves left to shrink the sum",
    "override": null
  }],
  "result": [0, 1],
  "verdict": { "passed": 3, "failed": 0 },       // RAW run only, never the traced run
  "truncated": { "execution": false, "display": false, "trace": false },
  "budget": { "bytes": 184320, "mode": "full", "chunks": 1 },
  "stepCount": 7,
  "error": null                                    // set on a thrown step; trace still valid (G3)
}
```

Invariants, each with an executable check:

1. `line.h === block.hash` for every step; `line.off < block.lines`. (D2x)
2. `verdict` copied from an **uninstrumented** run — a trace can never move a verdict.
3. `truncated.trace` ⇒ **exactly one** `traceTruncated` flag, never borrowed from the log cap (K2).
4. `budget.mode === "diff"` ⇒ no `snap`, server-emitted `delta` present (D2/F1).
5. Every identifier named in `operands` exists in `watch` **or** is a literal — else CI error.
6. Every `snap` value round-trips through the canonical serializer (K6).
7. `verdict.passed + verdict.failed > 0` unless `truncated.execution`.

Caps — all derived from measured constants, all carrying a ceiling comment:

```js
// ponytail: slots are 1 MB because sandbox.mjs:11 says so; degrade at 60% of the
// assembled budget. Raise only with a measured need (a 3000-problem median step size).
const CHUNK_MAX_CHARS = 1_048_576;
const BYTE_BUDGET     = Math.floor(CHUNK_MAX_CHARS * 12 * 0.6);
const EXEC_STEP_CAP   = 200_000;  // ponytail: arbitrary, ~4× the worst guide measured; retune after 150 goldens
const DISPLAY_STEP_CAP = 2_000;   // ponytail: UI-only; raise when a real trace needs it
```

---

## 6. Edge-case ledger

Every row is a required test. Grouped by the failure it prevents.

**Serialization / golden stability (K6)**

| # | Case | Handling | Test |
|---|---|---|---|
| E1 | `undefined` in `snap` | `{"__u":1}` token, never a dropped key | round-trip test |
| E2 | `NaN`, `Infinity`, `-Infinity` | typed tokens; never `null` | round-trip |
| E3 | `-0` vs `0` | `-0` token; golden comparator distinguishes | `-0 !== 0` fixture fails |
| E4 | `BigInt` | string token; **never** `JSON.stringify` raw (throws) | `22-bit-manipulation` + unit |
| E5 | `Map` / `Set` (64 guides) | entries array, insertion-ordered | round-trip |
| E6 | Typed arrays / `ArrayBuffer` (19 guides) | `{__ta:"Uint8", v:[…]}` | round-trip |
| E7 | Cycle / shared ref | id table → `{__ref}`; never re-`stringify` a live object | `08-linked-list/01-linked-list-cycle` |
| E8 | Key order | canonical serializer sorts keys; comparator ignores order | two-order fixture diffs equal |
| E9 | Depth > 10 000 (degenerate tree input) | depth cap → `error: "maxDepth"`, trace flushed | V7 fixture |

**Instrumentation correctness (K4, K7)**

| # | Case | Handling | Test |
|---|---|---|---|
| E10 | Recursive target's own body | `regionTable` marks it depth 0 — steps **are** emitted | `09-binary-tree-general/01-maximum-depth` non-empty trace |
| E11 | Class methods (55 guides) | methods lexically inside the target block ⇒ depth 0 | `08-linked-list/11-lru-cache` non-empty trace |
| E12 | `map`/`forEach`/`sort` comparators inside the target | callback lexically inside ⇒ depth 0, emits | S5 `map` fixture |
| E13 | Helper defined in the same block but outside the target (`arrayToTree`) | depth 1, suppressed | S5 histogram |
| E14 | Helper defined in **another** block / module | suppressed (lexical test is per-block) | S5 |
| E15 | IIFE, arrow-field, object-literal method, getter | all classified statically | 4 fixtures |
| E16 | Solution block containing `async`/`await`/`function*` | **CI rejects the guide** (measured: 0 today) | validator test |
| E17 | `eval` / `new Function` | **CI rejects the guide** (measured: 0 today) | validator test |
| E18 | Step throws (`try`/`catch` in guide code, `assertEq` in `script` entries) | flush partial trace + `error`; verdict from raw run | throw fixture |
| E19 | Guide edited after goldens exist | `blockHash` mismatch ⇒ **named** failure, not a line diff | edit-one-guide fixture |

**Budget / resource (K2)**

| # | Case | Handling | Test |
|---|---|---|---|
| E20 | Trace > 1 MB assembled | degrade to `diff` at 60 % of budget; `traceTruncated` set | `17-multi-dp` grid fixture |
| E21 | Single chunk > slot cap | chunk seq-numbered, host-assembled; gap ⇒ hard error | synthetic 3 MB trace |
| E22 | Snapshot blowup inside 16 MB heap | per-step byte estimate; abort to `diff` **inside** the sandbox | `n=5000` two-sum |
| E23 | > 200 k execution steps | abort, TLE-shaped verdict, trace flushed | synthetic |
| E24 | Sandbox timeout (3 s) mid-trace | `truncated.execution`, verdict from the raw run | infinite-loop fixture |
| E25 | Heap OOM (16 MB) | error verdict; trace flushed if any | `merge-k-sorted-lists` |

**Correctness / determinism**

| # | Case | Handling | Test |
|---|---|---|---|
| E26 | `Math.random` / `Date` in a solution block (3 guides) | goldens pinned to the **canonical case only**, which is deterministic; random-input traces are never goldens | `12-insert-delete-getrandom-o1` golden is stable over 5 runs |
| E27 | Random-access jump ≡ forward walk (D1x) | replay harness | V2 on all goldens |
| E28 | Equivalence `exact` vs order-insensitive vs multiset vs shape-only vs `int-with-tolerance` vs `ops-terminal-state-and-outputs` | 6 kinds, each with a fixture that must pass **and** a mutated fixture that must fail | 12 fixtures |
| E29 | Custom-input validation: negative `n`, ragged matrix, cyclic tree, uppercase trie word, unknown `op`, unsolvable `target`, non-integer where integer required | field-named errors, pre-execution | V7 fixtures |

**Scale-specific (§7)**

| # | Case | Handling |
|---|---|---|
| E30 | Two guides sharing a title/slug | registry keyed by **path**, never slug |
| E31 | 65 MB `curriculum-data.js` | per-module JSON + lazy fetch + index over titles/patterns only |
| E32 | 300 MB of goldens in git | commit only `trace-head.json` per problem (first/last step, stepCount, verdict, hash); full trace is a CI artifact |
| E33 | 600 k differential execs | tiered: PR 5/problem, changed-module 50, nightly 200, on-demand full |
| E34 | 3 400 × 3 hand-authored tables | canonical level authored + cross-checked; L1/L2 tables generated from the trace above T1 |
| E35 | Authored `equivalence` × 3 400 | derived from `returnType` in the catalog; override map for the residue |
| E36 | Premium problem statements | owner decision 8 — link only, never reproduce |

---

## 7. Task table (Dependency-Aware for Parallel Execution)

Ladder applied per row: `[Y]` = deleted by rung 1 (does it need to exist), `[R]` = reused existing repo code, `[S]` = smallest thing that works, `[P]` = carry a `ponytail:` ceiling comment.

While rows are listed numerically, they are **not strictly serial**. Agents can execute tasks in parallel based on the dependency graph below.

| # | Task | Files / Target | Scenario | Verify by | Ponytail | Status |
|---|---|---|---|---|---|---|
| 0 | `scripts/audit-curriculum.mjs`: pin every §1 count (blocks, tables, thin, coverage, metadata) | new | S3 | `npm run audit` prints counts; README + plan cite it; the 813-vs-450 ambiguity is gone | [S] | pending |
| 0b | `guide-quality` rubric: `book-to-skill` extracts a grading rubric to `docs/rubrics/guide-quality.md`; `audit` prints a per-guide score | new | S3 | rubric file exists and `npm run audit` emits a score column; the **gate** is deferred to T1 (ship the rubric, not the scorer) | [Y] no scorer before T1 | pending |
| 1 | `catalog/problems.json`: 150 entries extracted from the guides (path, slug, lcId, difficulty, patterns, codec, equivalence, fnName×3) | new | S1,S3 | 150/150 guides map 1:1; guide count == entry count | [R] replaces `PILOT_SLUGS` | pending |
| 2 | Drop `fns` from `RUNTIME_TESTS` with an `sg` rule (not a 109-entry hand edit); fn names resolve from `blocks.json` | `scripts/test-runner.mjs` | S3 | `sg` reports 109 rewritten entries and 0 remaining `fns` keys; `npm test` assertion count unchanged (828) | [Y] delete duplication | pending |
| 3 | **41 syntax-only → 0.** Cases derived from guide prose + one authored case list per guide, then owner-reviewed; every guide executes | `scripts/test-runner.mjs` | S3 | `npm test` → `syntax-only: 0` | [S] cases only | pending |
| 4 | Validator: reject `async`/`await`/`function*`/`yield`/`eval`/`new Function` inside a solution block; reject a missing 3rd fence. The scan is `sg` (syntax-shaped), not a regex | `scripts/validate-guide.mjs` | S2,S3 | 4 fixtures rejected, 0 real guides newly failing; the `sg` scan reports 0 hits today | [S] | pending |
| 5 | Envelope v1.1 schema + validator (row-12 freeze point) | `docs/trace-schema.json` | S1,S2 | accepts good fixture, rejects 6 bad ones | [S] | pending |
| 6 | Canonical serializer (K6) + 9 round-trip self-tests; fixtures are sorted-key JSON compared with `jq -S`, not `deepEqual` | new `scripts/lib/serialize.mjs` | S2 | E1–E9 green; `jq -S` of the fixture equals `jq -S` of the round-trip | [S] | pending |
| 7 | `gen-blocks.mjs`: section-scoped selection (450), `blockHash`, `regionTable`, `watch`, `codec` | new → `build/blocks.json` | S1,S2 | 450 blocks; **every** `blockHash` and `startLine` re-derived from source; 0 selects a follow-up fence | [S] | pending |
| 8 | RED: golden differ catches a mutated canonical | `scripts/test-trace.mjs` | S3 | fails with a step diff, not a crash | [S] | pending |
| 9 | Runtime instrumenter (Acorn walk) + `blockHash`-relative offsets; **no depth logic** | new; `acorn`, `acorn-walk` **devDependencies** | S1,S5 | emitted offsets resolve every step into its block; README notes the devDep | [R] D8 note | pending |
| 10 | `trace-runner.mjs`: static region gate, snapshot `watch`, chunked `__TRACE__<seq>`, throw-safe flush | new | S1,S2,S5 | V1 green on the 5 judge pilot slugs; E18 flush works | [S] | pending |
| 11 | Byte budget + degrade-to-`diff` + `traceTruncated` | `trace-runner.mjs` | S2 | E20–E22 green; 4 MB is gone | [P] | pending |
| 12 | Execution cap 200 k / display cap 2 k / verdict isolation | `trace-runner.mjs` | S2 | `n=5000` → display truncation, verdict unchanged | [P] | pending |
| 13 | **V3 golden differ green → envelope v1.1 frozen**; the failing step is rendered `delta`-style in the CI log, not buried in a stack trace | `scripts/test-trace.mjs` | S3 | `mutated-canonical` exits non-zero with a step diff | [S] milestone | pending |
| 14 | V2 replay determinism (forward ≡ random jump) | `scripts/test-trace.mjs` | S3 | deep-equal on every golden step | [S] | pending |
| 15 | `gen-traces.mjs` → 150 goldens + 150 `eventFloor` + per-module case-count table | new; `judge/traces/` | S1,S3 | 150 files; every entry has fnName, codec, ≥1 case, equivalence kind | [S] | pending |
| 16 | `docs/traces/*.json` static copies | new (generated) | S1 | W1 needs no server: file loads via `fetch` in the portal | [Y] kills the route | pending |
| 17 | Codec registry + 5 codecs (`json`,`tree`,`list`,`ops`,`graph`) + round-trip tests | new `api/_lib/codecs.mjs` | S2 | V6 green; a slug naming codec #6 **fails CI loudly** | [Y] L1 cut | pending |
| 18 | Widen `problems.mjs` codec whitelist or delete the registry in favour of the catalog | `api/_lib/problems.mjs` | S3 | no second source of slug truth | [Y] P3 | pending |
| 19 | V4 differential harness: seeded cases, 6 equivalence kinds, shrink-on-mismatch, tiered counts | new phase in `scripts/test-runner.mjs` | S3 | `npm test` green; seeded divergence shrinks to a minimal input | [S] F7 | pending |
| 20 | V11 region-isolation + non-vacuity assertion (E10/E11) | `scripts/test-trace.mjs` | S5 | helper fixture fails; recursive + class traces are **non-empty** | [S] closes the vacuity hole | pending |
| 21 | Tier 1 table player: parse 453 tables, opaque `$…$` cells, thin-table report | new `docs/dryrun/table.js` | S1 | parses all; names every thin table from row 0's audit | [S] | pending |
| 22 | `array` primitive + table player under each level's table | `docs/dryrun/index.js`, `docs/index.html` | S1 | Playwright: `two-sum` L1 animates; controls work; **first pixels** | [S] | pending |
| 23 | Remaining Tier 1 presets: stack / matrix / window / bits | `docs/dryrun/render.js` | S1 | 5 presets render from traces | [S] | pending |
| 24 | Tier 2: `linkedlist`, `tree`, `graph`, `statecard` + `dp-table`/`recursion-tree` overlay | `docs/dryrun/render.js` | S1,S2 | cycle, tree, graph, LRU-ops cases render | [S] | pending |
| 25 | One table-driven Playwright spec over S1–S5 + every preset; the existing `desktop` 1440×900 and `Pixel 7` projects supply both viewports' evidence | `tests/dry-run.spec.mjs` | S1,S2,S4,S5 | screenshots + action logs retained; both viewports | [Y] L2 cut | pending |
| 26 | V5 event-floor gate | `scripts/test-trace.mjs` | S3 | under-floor trace fails | [S] F5 | pending |
| 27 | V9 table↔trace cross-check + `override` identifier guard | `scripts/test-trace.mjs` | S3 | seeded table edit fails; bad override fails | [S] | pending |
| 28 | `trace-head.json` per problem (committed summary of the golden) | `judge/traces/*.head.json` | S3 | 150 heads; `stepCount` + `verdict` + hash match the full trace | [P] scale ceiling | pending |
| 29 | V8 report-only scan → repair thin tables **with the trace open** | `scripts/validate-guide.mjs` + guides | S1 | audit reports 0 thin | [S] | pending |
| 30 | Promote V8 warnings → errors; wire `audit`/`gen:traces`/`test:trace` into `verify`; add `cache: 'npm'` to `actions/setup-node@v4` and a job time budget | `package.json`, `scripts/validate-guide.mjs`, `.github/workflows/deploy.yml` | S3 | `verify` exit 0; seeded bad guide exits 1; CI log shows the npm cache hit and the budget | [R] L3 | pending |
| 31 | Design pass: timing, contrast, keyboard, reduced-motion | `docs/dryrun/index.js` | S1 | axe-core passes; 1440 + 390 diff ≤ threshold | [R] F11 | pending |
| 32 | "Unverified" label = pure function of per-guide evidence | `docs/dryrun/index.js` | S1 | label clears automatically when V9 ∧ V10 green; no stored flag | [R] A2 | pending |
| 33 | V12 **logging-only** prediction events (no UI, no scoring) | `docs/dryrun/index.js`, existing `api/_lib/kv.mjs` | S4 | events land in KV or degrade to `{ok:false}` | [Y] P4 cut | pending |
| **—** | **Trigger-gated — build only when the trigger fires** | | | | | |
| T-a | `/api/judge/trace` route + custom-input form | new | S2 | *trigger:* ≥5 readers ask, **or** W2 lands and static traces show p95 > 800 ms | [Y] H3 | deferred |
| T-b | Prediction scoring UI + S4 target picker | `docs/dryrun/index.js` | S4 | *trigger:* ≥1 guide repair attributable to the row-33 aggregate | [Y] P4 | deferred |
| T-c | V13 degraded interview mode | `docs/dryrun/index.js` | S4 | *trigger:* owner decision 6 = default-on **and** ≥20 sessions observed | [Y] | deferred |

### Execution DAG & Parallel Phases

To maximize agent throughput, tasks are restructured into parallel phases. A phase can begin once its dependencies are met. Within a phase, agents can take unblocked tasks concurrently.

| Phase | Description | Parallel/Independent Tasks | Sequential/Dependency Chains |
|---|---|---|---|
| **Phase 1** | **Foundations** (Data, Specs, Base UI) | `0`, `0b`, `1`, `3`, `4`, `5`, `6`, `7`, `8`, `21`, `31` | All tasks in Phase 1 can be started immediately and concurrently. |
| **Phase 2** | **Engine & UI Primitives** | `22`, `23` | **Engine Chain:** `9` → `10` → `11` → `12`.<br>**Cleanup Chain:** `7` → `2`. |
| **Phase 3** | **Trace Freeze & Goldens** | `24`, `29` | **Freeze Chain:** (`8`, `12`) → `13` → `14`.<br>**Trace Gen:** (`1`, `7`, `13`) → `15` → (`16`, `28`, `17`). |
| **Phase 4** | **Validation Guards & Logic** | `20`, `26`, `30` | **Codec Chain:** `17` → `18` → `19`.<br>**Cross-check:** `15` → `27`. |
| **Phase 5** | **Final UI Polish** | `25`, `33` | **Label Chain:** (`25`, `27`) → `32`. |

**Kill criteria.**
- Phase 1: if executing the 41 previously-unexecuted guides surfaces **> 15**
  genuinely wrong canonical solutions → **stop the visual product**, fix code
  first. (This is v4's kill criterion, moved earlier — it fires sooner and
  cheaper.)
- Phase 4: if the differential oracle needs **> 25 %** manual adjudication of its own
  equivalence kinds, the oracle is wrong, not the solutions.
- Phase 5: if the static path serves < 10 users/week after a month, T-a stays deferred
  indefinitely.

---

## 8. Scale track — 150 → the full LeetCode catalogue

**Scope decision (2026-10-02, owner): the deliverable is the catalogue as it stands
today — the 150 guides already in this repo. Expansion is probable but not current.**
W-1…W3 below are the whole of the committed work; this section is a *gated* track
that stays dark until its trigger fires. Nothing here is built because it is
inevitable.

**T1 entry trigger — all three must hold:** (a) the owner asks for expansion, (b)
owner decision 9 is answered with a CI model budget, (c) the row-0b `guide-quality`
rubric exists and `audit` can score a draft. Until then the honest status of §8 is
*documented, not started* — and §7's definition of done in §10 is the finish line.

Target ≈ 3 000–4 000 problems. Three gated tracks, each independently killable.
**Nothing in W-1…W3 changes to enter T1** except what T1 lists.

**The wall is the portal, not the engine.** Measured: 20 KB/guide markdown,
3.09 MB `curriculum-data.js` at 150 ⇒ **~65 MB at 3 400**, loaded as one file on
every page view. T1 is therefore a *loading* problem before it is a content
problem.

| Track | Scope | What must be built | What is explicitly **not** built | Kill criterion |
|---|---|---|---|---|
| **T1 — 500** | 500 problems | Sharded bundle: `docs/data/<module>.json` fetched on demand; search index over titles/patterns/difficulty only (~200 KB, ships always). **The problem list is harvested with `firecrawl`** (path, lcId, title, difficulty, tags are facts we fetch, never generate) and catalog entries are built from the same pipeline as `catalog/problems.json`. LLM drafts solution + cases; **CI adjudicates** (V1 neutrality, V3 goldens, V4 differential, V6 codecs, V7 input validation) and a repair loop rewrites failures. Each draft is **graded against the row-0b `guide-quality` rubric before adjudication** — a guide that fails the rubric never reaches the golden stage. | No new UI. No bespoke animation. | > 30 % of drafted problems fail adjudication twice ⇒ the generator is not ready; stop and fix the generator. |
| **T2 — 1 500** | 1 500 problems | Tiered differential (E33). Authored tables: **canonical level only**, cross-checked by V9; L1/L2 tables generated from the trace (H4). `equivalence` derived from catalog `returnType`, override map for the residue (E35). Golden storage = `trace-head.json` committed, full trace as CI artifact (E32). | No per-problem authoring beyond the canonical level. No goldens in git. | Portal p95 > 2 s on a mid-range laptop ⇒ sharding is insufficient; stop before T3. |
| **T3 — full** | ~3 000–4 000 | Only what T1/T2 proved missing. Premium problems: link + own wording only (E36). | — | — |

**Invariants that must hold from row 0 (the anti-corner-painting list):**

1. Every problem is keyed by **path**, never slug (E30).
2. Every artifact is generated from `catalog/problems.json`; nothing re-declares a
   slug, fn name or codec (H1/P3).
3. `blockHash` identity, not line numbers (K5) — the only cheap way 3 400 guides
   stay diffable.
4. Committed per-problem footprint ≤ ~2 KB (E32). Anything larger is an artifact.
5. Any per-problem human-authored data is bounded to: cases, `equivalence`
   override, `override` sentences, canonical dry-run table. Everything else is
   derived.
6. Counts in docs cite `scripts/audit-curriculum.mjs` (G2) — at 3 400, an
   unpinned number is a lie waiting for a reader.

---

## 9. Owner decisions — all answered (2026-10-02)

Every one of the nine is **closed on the owner's defaults**. "Reopen" means changing a
cell in this table, not discovering mid-build that it was never decided.

| # | Decision | **Answered** | Consequence binding on the rows |
|---|---|---|---|
| 1 | Anonymous dry runs? | **yes** — read-only, 10/min, cached | moot while traces are static; binds T-a only |
| 2 | Animate all three levels or L3 only? | **all three for Tier 1, canonical level only for Tier 2** | rows 22–24 |
| 3 | Goldens in KV or static JSON under `docs/`? | **static JSON under `docs/`** | row 16 kills the route; `kv.mjs` is not on the W1 path |
| 4 | Server QuickJS or browser tracer? | **server**, and only for custom input (T-a) | canonical traces ship as files; no serializer in the page |
| 5 | **Will tracing ever cover user-submitted code?** | **canonical only — permanently.** | the instrumenter stays pointed at repo files. User code would be a new untrusted-input surface and needs its own design + threat model, not a config flip. **A security decision, not a feature.** |
| 6 | Degraded interview mode default-on or opt-in? | **opt-in** | T-c stays deferred either way; opt-in is the cheaper default to un-ship |
| 7 | Prediction score persistence? | **localStorage; aggregates → existing `kv.mjs`** | row 33 stays logging-only; no scoring UI (T-b unfired) |
| 8 | **Premium LeetCode problems?** | **link-only, with our own wording — never reproduce the statement** (E36) | a licensing boundary, not an engineering one. Applies at every scale; T3 included. |
| 9 | Generate content with a model in CI? | **not yet** — no budget authorised | T1 stays blocked. W-1…W3 need no model. |

**Progress-file decision (A1):** `DRY_RUN_ENGINE_PROGRESS.md` at the repo root is the
single append-only ledger for this plan. `CHATBOX_PROGRESS.md` stays owned by the
chatbox work.

**Process decisions (A2–A4, B1–B3):** v5.1 tooling deltas folded into this file before
any row runs · one atomic commit per row, no batching · pre-commit hook installed
before row 3 · the agent adjudicates the 41 newly-executed guides and the owner
spot-checks · the `>15 wrong of 41` kill threshold is fixed at 15 and is not
re-negotiated after the count is known.

---

## 10. Definition of done (150 problems)

- 150/150 guides execute (`syntax-only: 0`) and pass `npm run verify`.
- 150/150 registry entries; 150/150 goldens; 150/150 `trace-head.json`.
- Envelope v1.1 frozen at row 13 green; 6 bad fixtures rejected by its validator.
- V1, V2, V3, V4, V5, V6, V7, V9, V11 green; E1–E29 fixtures green.
- Tier 1 animates all three levels **from static files**; Tier 2 animates the
  canonical level.
- 0 thin dry-run tables, each cross-checked against its executed trace.
- No trace step outside the target region; recursive and class guides non-empty.
- Playwright evidence: S1–S5 + every preset, both configured viewports.
- Prediction events logged; no scoring UI (trigger T-b unfired).

**Deliberately not built:** bespoke animations · hand-authored judge specs per
problem · `Proxy` interception · build-time delta emission · a hand-written
interpreter · any auto-judgement of renderer quality from learner accuracy ·
`/api/judge/trace` · custom-input form · scoring UI · degraded mode ·
full-trace goldens in git.
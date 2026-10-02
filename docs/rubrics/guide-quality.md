# Guide-quality rubric

A guide in this repo is a **study session**, not a code sample: intuition, three
escalating solutions, a dry run you can watch, the JS-specific traps, and what
the interviewer asks next. A draft that has correct code and none of that is not
a guide, and at 150 hand-written guides nobody noticed 22 thin dry-run tables
until a script measured them (row 0, `633931e`).

This rubric is the grading bar for one guide, out of 100. It is used in two
places:

- **Today:** as a report. `node scripts/audit-curriculum.mjs --scores` prints a
  score for all 150 guides and a summary. Nothing gates on it — no threshold, no
  non-zero exit, no `verify` wiring.
- **At T1 (500 problems):** as the pre-adjudication filter. Plan §8 T1 says a
  machine draft is *"graded against the row-0b guide-quality rubric before
  adjudication — a guide that fails the rubric never reaches the golden stage."*
  That gate does not exist yet. T1 wires it, over the same score, once there is
  a drafter to fail.

Grading it by hand is fine and expected. Every criterion below is a fact you can
count; none of them needs an opinion. If you find yourself arguing about
whether a section is *good enough*, you are outside this rubric — see
[What this rubric does not grade](#what-this-rubric-does-not-grade).

## How to score a guide

**With the scorer** (recommended, and the only way the numbers stay comparable):

```bash
node scripts/audit-curriculum.mjs --scores          # every guide + summary
node scripts/audit-curriculum.mjs --json --scores | jq '.guideScores[] | select(.score < 90)'
```

**By hand**, for one file, in this order — each step names the predicate so two
graders get the same answer:

| # | Criterion | Max | What to count |
|---|-----------|-----|---------------|
| 1 | `sch` — schema | 20 | 6 section headings (12, 2 each) + 4-field problem header (8) |
| 2 | `sol` — solution blocks | 20 | 3 K7 solution blocks, one per level |
| 3 | `tbl` — dry-run headings | 15 | `### Step-by-Step Dry Run` headings (15 × min(1, n/3)) |
| 4 | `dep` — dry-run depth | 15 | 15 × (1 − thin/tables), thin = < 3 data rows |
| 5 | `fol` — follow-ups | 10 | 10 × min(1, n/2) `### Follow-Up N:` headings |
| 6 | `run` — runnable | 10 | the path is a key in `RUNTIME_TESTS` |
| 7 | `syn` — synchronous | 10 | 10 if no async/generator/`eval`/`new Function` in solution code |

Sum the seven. 100 is the ceiling; there is no partial credit for prose quality
because prose quality is not measured here.

## The criteria

### 1. `sch` — the 6-section schema — 20 points

**Requirement.** All six of these strings appear verbatim:

```text
## 1. Problem Overview & Edge Case Matrix
## 2. Level 1: Brute Force Approach
## 3. Level 2: Optimized Approach
## 4. Level 3: Most Optimal / Canonical Approach
## 5. JavaScript-Specific Gotchas & V8 Optimizations
## 6. Real-World MAANG Interview Follow-Ups & Extensions
```

…plus the four header fields every guide opens with (`- **LeetCode Link**: …`,
`- **Difficulty**: …`, `- **Pattern Category**: …`, `- **Prerequisite Primer**: …`).
2 points per heading, 8 for the header, so a header-only guide cannot reach 20.

**FOR.** The order is the pedagogy: edge cases before code, brute force before
optimal, JS traps before follow-ups. It is also the portal's contract —
`scripts/build-site.mjs` reads those headings to lay out a page, and the header
fields are what make difficulty and pattern filters work. A guide missing §5 is
not a JS manual.

**Failure mode.** A draft that renames or reorders a heading. The check is a
**literal `content.includes()`**, so trailing text is fine — real guides append a
parenthetical, e.g. `05-hashmap/06-two-sum.md:190`:

```text
## 4. Level 3: Most Optimal / Canonical Approach (Single-Pass Hash Map with Complement Interception)
```

— but a rewording (`## 4. Canonical approach`) loses the section *and* the
solution block, so it costs 6⅔ points in one edit. The mirror-image failure is a
guide that keeps the headings and drops the content: §1 with no edge-case matrix,
§6 with a single "see also LeetCode". The headings pass; the guide is empty.

**How it is computed.** `RUBRIC_SECTIONS` in `scripts/audit-curriculum.mjs`,
mirrored from `REQUIRED_SECTIONS` in `scripts/validate-guide.mjs` (whose entry 0
is the `'# '` title sentinel, not a section, so it carries no points), plus the
existing `HEADER_FIELDS` list.

### 2. `sol` — three solution blocks, one per level — 20 points

**Requirement.** Exactly one K7 solution block per level: the **first**
`` ```javascript `` fence inside each `## 2|3|4. Level 1|2|3` heading, stopping
at the next heading of the same or shallower depth. 20 × (distinct levels / 3).

**FOR.** These 450 blocks (150 × 3) are the only code the tracer will ever load
(plan K7). A block that is not selected by that predicate is dead weight in a
guide and invisible to every downstream check.

**Failure mode.** Code parked outside its level section — a solution that lives
in §1 as a "worked example", or a fourth fence after the level heading. Both are
real shapes in this repo, and both are decoys the predicate must skip:
`08-linked-list/02-add-two-numbers.md` has follow-up fences at lines 302, 321 and
336 that `selectSolutionBlocks` deliberately does not pick (its three real blocks
are 90, 198, 259 — pinned in the audit's `FIXTURES`). A draft that adds its
Level 2 code *after* a `### Complexity Breakdown` subheading still passes (same
depth), but one that adds a sibling `##` heading first loses the block.

**How it is computed.** `selectSolutionBlocks(content)` — the exported K7
predicate. Row 7's `gen-blocks.mjs` will import the same function rather than
re-implement it.

### 3. `tbl` — three dry-run headings — 15 points

**Requirement.** `### Step-by-Step Dry Run` appears at least three times — once
per level. 15 × min(1, n/3).

**FOR.** The dry run is the part a reader uses to *watch* the algorithm, and it
is the only per-level artifact a tracer can turn into frames (rows 21–24). The
heading is the anchor.

**Failure mode.** Two levels documented, one skipped: "the optimized approach is
the same but faster" leaves the reader with nothing to compare against, and the
level-2 animation has no table to attach to.

**How it is computed.** `dryRunTables(lines, file)` in the audit script. Note
that this criterion counts **headings, not tables** — deliberately, because
heading count and table count are different failures and `dep` catches the
second one.

### 4. `dep` — the dry run has enough rows to be a trace — 15 points

**Requirement.** No dry-run table may have fewer than 3 data rows (header row and
`| :--- |` separator excluded). 15 × (1 − thin / tables); a guide with no tables
scores 0 here.

**FOR.** A two-row table states its conclusion; it does not show the loop. The
dry-run player (row 21) needs ≥ 3 rows to animate anything, and row 29's job is
to get this to zero by repairing tables **with the trace open**. This is the one
criterion that measures the thing row 21/29 exist to fix, so it is where a real
draft's weakness shows up first.

**Failure mode.** Two distinct ones, both live in this repo today:

1. **A one-row table for a loop.** `05-hashmap/06-two-sum.md:72-77`, the Level 1
   brute-force dry run, has a single data row for an exhaustive nested loop:

   ```text
   ### Step-by-Step Dry Run
   `nums = [2, 7, 11, 15]`, `target = 9`

   | `i` | `nums[i]` | `j` | `nums[j]` | `sum = nums[i] + nums[j]` | `sum === target`? | Action |
   | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
   | 0 | 2 | 1 | 7 | $2 + 7 = 9$ | Yes ($9 == 9$) | Return `[0, 1]` |
   ```

   A learner cannot see the 15 comparisons that were skipped. Same guide, same
   defect at Level 3 (lines 240-246, 2 rows) — hence 2 thin tables and `dep` 5/15
   for the repo's flagship guide.
2. **A heading standing in for a table.** `01-array-string/24-text-justification.md`
   has `### Step-by-Step Dry Run` at lines 91 and 199, and both are bullet prose:

   ```text
   ### Step-by-Step Dry Run
   `words = ["This", "is", "an"]`, `maxWidth = 16`
   - Words: `"This"` (4), `"is"` (2), `"an"` (2). Total word chars = 8.
   - Remaining spaces = $16 - 8 = 8$ spaces.
   ```

   Zero rows. `tbl` is satisfied, `dep` is not — which is exactly why they are
   two criteria. 23 guides own at least one thin table; the audit names all of
   them, and `--scores` shows every one of them losing depth points.

**How it is computed.** `dryRunTables()` counts data rows; `measure()` collects
the thin ones into `thinTableOwners`, which the score reads rather than
re-detecting.

### 5. `fol` — at least two follow-ups — 10 points

**Requirement.** `### Follow-Up N:` appears at least twice. 10 × min(1, n/2).

**FOR.** §6 is the interview-prep payload — "what if the array is a stream",
"what if you need all pairs", "how would you shard this". It is the difference
between a solved problem and a prepared candidate. Two is the floor, and the
floor is real: 53 of the 150 guides sit exactly on it.

**Failure mode.** One follow-up plus a link. `05-hashmap/06-two-sum.md:293` and
`:321` are the shape to copy — two follow-ups, each with a strategy and code.
The failure to avoid is the *heading-only* follow-up: `### Follow-Up 2:` followed
by "this is left as an exercise". It scores 10 and teaches nothing, which is the
limit of a mechanical rubric stated honestly in the next section.

**How it is computed.** `(content.match(/### Follow-Up \d+:/g) || []).length`.

### 6. `run` — the canonical solution actually runs — 10 points

**Requirement.** The guide's path is a key in `RUNTIME_TESTS` in
`scripts/test-runner.mjs`, so the runner calls its function with real inputs and
counts assertions against it.

**FOR.** 828 assertions exist because 109 of the 150 guides are executed. The
other 41 are *syntax-only*: parsed, never called, so no assertion can fail and
nothing proves the code is right. Plan row 3 exists to take that count to zero.
For a machine draft this is the single most valuable criterion, because it is
the one that a correct-looking solution cannot fake.

**Failure mode.** Code that parses and does nothing. `01-array-string/01-merge-sorted-array.md`
is one of the 41: its three blocks are syntax-checked by the runner and never
invoked, so `npm test` reports it under `syntax-only` and a regression in it
would ship silently.

**How it is computed.** `readRuntimeTestRegistry()` — the runner's own table,
evaluated rather than re-parsed — intersected with `listGuides()`.

### 7. `syn` — solution code is synchronous — 10 points

**Requirement.** No `async`, `await`, `function*`, `yield`, `eval(` or
`new Function(` inside any solution block. All or nothing: 10 or 0.

**FOR.** The instrumenter traces synchronous execution (plan K7). An `await`
inside a solution region yields an empty or truncated trace that passes CI
*vacuously* — the worst possible failure, because it looks green. Solution
blocks must also stay parseable so the scan can vouch for them at all.

**Failure mode.** A draft that reaches for `eval`, or an `async` helper pasted
into Level 3. §6 follow-ups legitimately use async/generator examples — 188 such
lines across 72 guides today — and none of that counts against a guide.

**A real near-miss, and why it does not cost points.**
`08-linked-list/02-add-two-numbers.md:141`:

```js
  if (n === 0n) return new ListNode(0); // zero must yield one node, not none
```

The word *yield* is prose in a comment. The audit's raw-text counter sees it
(`asyncLinesInSolutions: 1`, a genuine DRIFT row row 0 reports), the code-only
counter correctly reports `asyncLinesInSolutionsCode: 0`, and row 4's
`solution-block-must-be-sync` `sg` rule ignores it entirely — `npm run validate`
passes with 0 errors. Scoring the raw-text hit would have penalised a correct
guide for a comment. That is why this criterion strips comments first and why
the tracer's real gate is a syntax-shaped scan, not a regex.

**How it is computed.** `ASYNC_GEN` + `stripComment` + `FEATURES.evalOrFunction`
over the code of the three K7 blocks — all already defined in the audit script.

## Bands

Descriptive labels, not thresholds. **No band gates anything** — the lowest
scoring guide in the repo today still exits 0 from `npm run audit`.

| Band | Score | Means, today |
|------|-------|--------------|
| `reference` | 100 | every criterion met |
| `sound` | 90-99 | one criterion short, and it is `run` (awaiting row 3) |
| `incomplete evidence` | 80-89 | a dry run is too thin *and* the code never ran |
| `draft` | below 80 | two or more criteria short; nothing in the corpus is here |

## What this rubric does not grade

Listed because a rubric that silently omits its own gaps is worse than no
rubric. Each of these needs judgement or a tool that does not exist yet, and
**each needs a scorer T1 will have to write** — none of them is a number
somebody could add today:

- **Is the canonical solution actually correct?** Not "does it run" (`run` covers
  that) but "does it return the right answer". That is adjudication: V1 neutrality,
  V3 goldens, V4 differential (rows 8, 13, 19). A rubric criterion for it would be
  a claim with no reproducer.
- **Is the intuition any good, and does the dry run tell the *truth*?** A table
  can have 8 correct-shaped rows that describe an algorithm the code does not
  implement. Only a trace diff (row 27's V9 table↔trace cross-check) can settle
  it, and that needs generated traces first.
- **Is the §6 follow-up substantive, or a heading with "left as an exercise"
  under it?** `fol` counts headings. Judging the body is prose analysis.
- **Are the complexity claims right?** Nothing counts a Big-O claim.
- **Is the difficulty label honest?** `**Difficulty**:` is checked for presence,
  never for truth.
- **Prose quality, diagram quality, KaTeX, Mermaid.** Mermaid presence is a
  `validate-guide.mjs` *warning* and 150/150 guides pass it, so it carries no
  weight here rather than duplicating a check that already runs.

## The corpus as measured today

Every number below is `scripts/audit-curriculum.mjs --scores`, 2026-10-02. Row 0
is the provenance for all of it — if a doc quotes a curriculum count, this
script is what makes it true or false.

- 150 guides · mean 96.4 · min 80 · max 100
- bands: `reference` 96 · `sound` 44 · `incomplete evidence` 10 · `draft` 0
- `sch`, `sol`, `tbl` and `syn` are **saturated**: 150/150 guides score full marks
  on all four. The cheap criteria cannot separate a good draft from a bad one
  until a draft exists that fails them — which is precisely why they are in the
  rubric and not in the summary's interesting columns.
- The only criteria that separate anything today are `dep` and `run`:
  - `dep`: 127 guides at 15/15, 19 at 10/15, 4 at 5/15. All 23 thin-table guides
    score below the median of the other 127, which is what row 29 will work
    through.
  - `run`: 109 guides at 10/10, 41 at 0/10 — exactly row 3's work list.

## Why this file was briefly called `README.md`

It was first written as `docs/rubrics/README.md`, and that was not an accident — it was a
correct read of a real bug. All three guide scanners decide what a guide is by walking
the repo for `.md` files and excluding matches by **name**, so a rubric at
`docs/rubrics/guide-quality.md` would have been validated as a guide: **151 problem
files, 9 errors**, a `Files: 151` failure in `npm test`, and **3 failing** `--check`
assertions. `README` is one of the two substrings those scanners exclude, so the name was
load-bearing.

The underlying fault was that `docs/` was **not in any skip set**. The walk had been
passing by luck: every markdown file that happened to live there matched a skip name
(`00-INDEX.md`, `_TEMPLATE-subpage.md`, `00-IA-PLAN.md` via the `PLAN` rule). One real
document ended the luck. `scripts/build-site.mjs` had never needed an entry because it
hardcodes `entry.name !== 'docs'` at line 39 — the original authors knew the portal was
not curriculum, and row 0's copied skip list dropped that knowledge.

So the fix was to restore the guard, not to hide behind a filename: `'docs'` now appears
in the `SKIP_DIRS` set of `validate-guide.mjs`, `test-runner.mjs` **and**
`audit-curriculum.mjs`, and this file carries its plan name.

Two lessons, both still true:

1. **A name that matches a skip pattern is a load-bearing decision.** If a file's *name* is
   what keeps it out of a walker, that is a fact about the walker, not the file.
2. **One predicate, three copies.** The fix had to land in all three scanners at once. The
   same divergence is what produced the 813-vs-450 fence lie in the plan's own audit, and
   row 0 now exports `selectSolutionBlocks()` so rows 4, 7 and 21 import one definition
   rather than each counting their own.
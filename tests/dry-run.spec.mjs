/**
 * Row 25: ONE table-driven spec over every dry-run surface.
 *
 * `CASES` below is the whole corpus — 11 surfaces, each naming the guide whose
 * `catalog/problems.json` entry teaches its shape and the S-scenarios it covers.
 * Adding a preset is adding a row; there is no per-preset spec to copy. Four tests
 * per row, so coverage stays legible:
 *
 *   1. mounts, and a step forward changes the render and back restores it   · S1
 *   2. the frames — what this concept draws on each step                     · S1 (+S2)
 *   3. the frame count equals the authored rows, and the last one is the end · S5
 *   4. screenshot evidence, retained at both viewports                     · S1
 *
 * `playwright.config.mjs` builds docs/ and serves it statically first, because
 * docs/curriculum-data.js is gitignored. The `desktop` project (1440x900) and the
 * `Pixel 7` project both run this file, so one assertion set is the responsive
 * evidence — there is deliberately no per-viewport branch in here. That matters:
 * row 31's `scrollable-region-focusable` bug existed at 390px only.
 *
 * ── Which guide each row uses, and why it is not the obvious one ─────────────
 * Rows name a guide from `catalog/problems.json` `patterns[]`, not from the module
 * directory, which is why the bit cases are in `22-bit-manipulation` and not in
 * `01-array-string`. Tier 1 is all three levels (decision 2); Tier 2 is the
 * canonical level only, so every `level` below is `'3'` except where Tier 1's
 * three-level promise needs a specific one.
 *
 * The `array` row is Merge Sorted Array, not Two Sum. Plan row 22 names two-sum L1,
 * but that table has one data row and seven scalar columns, so its input array
 * exists only in the prose above the table and there is no array STATE column for
 * any array primitive to read. Merge Sorted Array is a guide this repo ships a
 * per-step array state for at all three levels, and its L2 trace writes exactly one
 * element per step:
 *
 *   [1, 3, 0, 0] -> [1, 2, 0, 0] -> [1, 2, 3, 0] -> [1, 2, 3, 4]
 *
 * ── `mod: false` on the array row is load-bearing, not a special case ─────────
 * `docs/dryrun/render.js` is loaded with `addScriptTag` for every other row, because
 * rows 23/24 must not edit `docs/index.html`: it carries row 22's tag and this
 * module's list cannot grow. It is the same file, from the same origin, evaluated as
 * a module in the same page — the only difference is who fetched it. Adding the tag
 * to `docs/index.html` is a one-line change that makes the injection unnecessary.
 *
 * ── Frames are asserted inside the SURFACE, not the player ────────────────────
 * A Tier-2 player can carry a preset stage AND overlay panels. Measured on the
 * statecard row (insert-delete-getrandom-o1 is a statecard AND a call spine), the
 * player holds 2 `.viz-row` and 1 `[data-call]` while its statecard stage holds 1
 * and 0 — player scope would let the recursion-tree overlay answer for the preset.
 * `surface` is the narrow selector, so `signatures()` can stay player-wide.
 *
 * ── S2: which half is reachable here, and which half is not ──────────────────
 * S2 wants `[]`+`0`, `[3,3]`+`6` and `n=5000`. The first two are *inputs to the
 * generator*, not states the player can be put into, and the third's verdict-unchanged
 * half has NO surface to click: `grep -n truncat docs/dryrun/` returns nothing, and
 * the committed trace head format carries `stepCount`/`budget.mode` but no
 * truncation flag, so the portal cannot render a truncation banner. Both live where
 * they can actually be observed — `scripts/test-trace.mjs` (row 12: `n=5000` sets
 * `truncated.display` and asserts the verdict unchanged). What IS reachable is the
 * other half: that every trace is finite and clamped at both ends, and that no frame
 * exists past the last authored row. That is what the `S2` tags assert.
 *
 * ── S4 HAS NO PLAYWRIGHT SURFACE, AND THAT IS A DECISION ─────────────────────
 * S4 is "the reader commits a prediction for step k, it is scored". The plan does
 * not build that: §10's "Deliberately not built" list names the scoring UI, the
 * custom-input form and degraded mode, and row 33 (`V12 logging-only prediction
 * events`) shipped logging only — no UI, no scoring, and deliberately not even a
 * correctness record, because "no endpoint is named, and a route nobody calls is the
 * surface P1 cuts". A test here would have to invent the UI it asserts, so S4 is
 * REPORTED, not built. This paragraph is the report: the gap is deliberate, gated on
 * T-b (≥1 guide repair attributable to row 33's aggregate), and a reader must not
 * mistake its absence for an oversight.
 *
 * ── S3's browser half, and where the rest of it lives ────────────────────────
 * S3 is `npm run verify` green plus three negative fixtures (mutated canonical,
 * seeded divergence, seeded thin table). None of those is a browser act; they are
 * node-level and are covered by `verify`. What the browser CAN catch is the class
 * of regression a static trace cannot — a player that leaks a global, stacks on a
 * nav click, or half-renders a guide it cannot animate. Those are the `S3` tags.
 */
import { test, expect } from '@playwright/test';

/** `scripts/build-site.mjs` turns "01-array-string/01-merge-sorted-array.md" into this. */
const ARTICLE = '01-array-string_01-merge-sorted-array';
const ARTICLE_URL = `/#${ARTICLE}`;

const player = '[data-dryrun-player]';

/** Open a guide and wait for its players, the way a reader's click arrives. */
async function openGuide(page) {
  await page.goto(ARTICLE_URL);
  await expect(page.locator('h1')).toContainText('Merge Sorted Array');
  await expect(page.locator(player).first()).toBeVisible();
}

/** Open the sidebar if this viewport keeps it off-canvas, then click a guide by title. */
async function openGuideFromNav(page, title) {
  if (page.viewportSize().width < 768) await page.locator('#menuBtn').click();
  await page.locator('#curriculumNav .nav-item', { hasText: title }).first().click();
}

/** Open a row's guide, load its module if it needs one, and wait for its player. */
async function openCase(page, row) {
  await page.goto(`/#${row.id}`);
  await expect(page.locator('h1')).toContainText(row.title);
  if (row.mod) await page.addScriptTag({ type: 'module', url: '/dryrun/render.js' });
  const target = page.locator(`${player}${row.where}`);
  await expect(target).toBeVisible();
  return target;
}

/**
 * Everything a step changed, as one string: the cells and every readout under them.
 *
 * Comparing this before and after a click is the generic "stepping moves the picture"
 * assertion, and it is deliberately player-wide and not per-surface — a preset that
 * redrew the same cells and a different readout would pass a text-only check.
 */
async function signature(target) {
  // A Tier-2 player can carry a preset stage AND overlay panels, so every readout counts: the
  // generic "stepping moves the picture" assertion has to see all of them to mean anything.
  const cells = await target.locator('.viz-cell').allTextContents();
  const rows = await target.locator('.viz-row').allInnerTexts();
  const nodes = await target.locator('[data-preset-stage] [data-node], [data-preset-stage] [data-call]').allTextContents();
  return `${cells.join('|')}#${rows.join('#')}#${nodes.join('|')}`;
}

/**
 * The table. One row per surface; `frames` is data, not a hand-written body.
 *
 * A frame is `{at, exact, count, text, contains, attr, counter, disabled}` — every
 * assertion key is an array of `[selector, …]` pairs so one selector can be asserted
 * more than once in a frame (`.viz-row` appears four times on the window row), and
 * `at` is scrubbed to rather than clicked to: the click path is already covered per
 * row by test 1 below, so frames state a position and let the transport get there.
 */
const CASES = [
  {
    s: 'array', level: '2', mod: false, surface: '.viz-array', floor: 2000, page: true,
    id: ARTICLE, title: 'Merge Sorted Array', scenarios: 'S1,S2',
    where: '[data-level="2"]', // the Tier-1 primitive: three players, no data-preset
    frames: [
      { at: 0, exact: [['.viz-cell', ['1', '3', '0', '0']]], counter: '1 / 4', disabled: 'prev' },
      { at: 1, exact: [['.viz-cell', ['1', '2', '0', '0']]], counter: '2 / 4' },
      { at: 2, exact: [['.viz-cell', ['1', '2', '3', '0']]], counter: '3 / 4',
        count: [['.viz-cell.is-active', 1]], text: [['.viz-cell.is-active', '3']] },
      // S1's "the final step returns": the merged array, which is what mergeOptimized exits
      // with. Scrubbing the whole run start to finish is the browser form of executing the
      // case — there is no separate execution surface here, the trace IS the execution.
      { at: 3, exact: [['.viz-cell', ['1', '2', '3', '4']]], counter: '4 / 4', disabled: 'next' },
      { at: 0, exact: [['.viz-cell', ['1', '3', '0', '0']]], counter: '1 / 4', disabled: 'prev' },
    ],
  },
  {
    // Step 1 is the empty stack: no entries, and the depth marker says so rather than
    // drawing a row of empty boxes. Step 5 pops back off what step 3 pushed.
    s: 'stack', level: '2', mod: true, floor: 2000,
    id: '07-stack_02-simplify-path', title: 'Simplify Path', scenarios: 'S1,S2',
    where: '[data-preset="stack"][data-level="2"]',
    frames: [
      { at: 0, count: [['.viz-cell', 0]], text: [['.viz-pointer', 'empty']], counter: '1 / 9', disabled: 'prev' },
      { at: 1, exact: [['.viz-cell', ['"a"']]], text: [['.viz-k', 'push'], ['.viz-pointer', 'depth 0']] },
      { at: 3, exact: [['.viz-cell', ['"b"', '"a"']]], text: [['.viz-k', 'push']] },
      { at: 4, exact: [['.viz-cell', ['"a"']]], text: [['.viz-k', 'pop']] },
      { at: 8, counter: '9 / 9', disabled: 'next' },
    ],
  },
  {
    // A 2x2 grid plus one header row and one header column; step 2 writes (0, 1) —
    // the cell it says it is addressing.
    s: 'matrix', level: '2', mod: true, floor: 2000,
    id: '04-matrix_02-spiral-matrix', title: 'Spiral Matrix', scenarios: 'S1',
    where: '[data-preset="matrix"][data-level="2"]',
    frames: [
      { at: 0, count: [['.viz-cell', 9], ['[data-axis=""]', 5]],
        exact: [['[data-axis=""]', ['', 'c0', 'c1', 'r0', 'r1']]],
        attr: [['[data-at]', 'data-at', '0,0']] },
      { at: 1, attr: [['[data-at]', 'data-at', '0,1']], count: [['.viz-cell.is-active', 1]],
        text: [['.viz-cell.is-active', '101']], contains: [['.viz-row', 'addressed (0, 1)']] },
    ],
  },
  {
    // The guide writes four windows of `nums = [2, 3, 1, 2, 4, 3]`. All six indices
    // are on screen whether or not they are in the window — the proof this is not an
    // array drawn a different way. Step 4 skips `i = 3`, so the render says
    // "two left, one right" rather than rounding that to a one-cell slide.
    s: 'window', level: '1', mod: true, floor: 2000,
    id: '03-sliding-window_01-minimum-size-subarray-sum', title: 'Minimum Size Subarray', scenarios: 'S1',
    where: '[data-preset="window"][data-level="1"]',
    frames: [
      { at: 0, exact: [['.viz-cell', ['2', '3', '1', '2', '4', '3']]],
        count: [['.viz-cell.is-active', 4]],
        contains: [['.viz-row', '0…3'], ['.viz-row', 'size 4']] },
      { at: 1, count: [['.viz-cell.is-active', 4]], contains: [['.viz-row', '1…4']] },
      { at: 3, contains: [['.viz-row', '4…5'], ['.viz-row', '−2'], ['.viz-row', '−3'], ['.viz-row', '+5']] },
    ],
  },
  {
    // 1011 -> 1010 -> 1000, most significant digit leftmost. A cell reading
    // `101 & 110 = 100` is a bit operation, not three numbers in a row.
    s: 'bits', level: '3', mod: true, floor: 2000,
    id: '22-bit-manipulation_03-number-of-1-bits', title: 'Number of 1 Bits', scenarios: 'S1',
    where: '[data-preset="bits"][data-level="3"]',
    frames: [
      { at: 0, exact: [['.viz-cell', ['1', '0', '1', '1']]], attr: [['[data-bit]', 'data-bit', '0']],
        text: [['.viz-cell.is-active', '1']], contains: [['.viz-row', '3 set']] },
      { at: 1, exact: [['.viz-cell', ['1', '0', '1', '0']]], attr: [['[data-bit]', 'data-bit', '1']] },
      { at: 2, exact: [['.viz-cell', ['1', '0', '0', '0']]], attr: [['[data-bit]', 'data-bit', '3']],
        contains: [['.viz-row', '1 set']] },
    ],
  },
  {
    // Step 4 is the frame the guide's own edges leave in two pieces: hit—hot—{dot,lot}
    // and cog—{dog,log}. One node per SVG <g>, one line per edge, and the count says 2.
    s: 'graph', level: '3', mod: true, floor: 1500,
    id: '19-graph-bfs_03-word-ladder', title: 'Word Ladder', scenarios: 'S1',
    where: '[data-preset="graph"][data-level="3"]',
    frames: [
      { at: 3, exact: [['[data-node]', ['cog', 'dog', 'dot', 'hit', 'hot', 'log', 'lot']]],
        count: [['line', 5], ['[data-terminal]', 1]],
        contains: [['.viz-row', '2 components']], text: [['[data-terminal]', 'dot']] },
    ],
  },
  {
    // Level 1 is [20, 9] as the guide authored it, so the edge count is the tell:
    // 3 nodes joined by 2 edges is a list, 4 edges is a tree.
    s: 'tree', level: '3', mod: true, floor: 1500,
    id: '10-binary-tree-bfs_04-zigzag-level-order', title: 'Binary Tree Zigzag Level Order', scenarios: 'S1',
    where: '[data-preset="tree"][data-level="3"]',
    frames: [
      { at: 2, exact: [['[data-node]', ['3', '20', '9', '15', '7']]], count: [['line', 4]],
        contains: [['.viz-row', '3 levels']] },
      { at: 1, exact: [['[data-node]', ['3', '20', '9']]], count: [['line', 2]],
        contains: [['.viz-row', '2 levels']] },
    ],
  },
  {
    // Two state fields, both written by the first op — this is `ops` shape. Three ops
    // later the map field has changed twice: the swap IS the state transition, not
    // just the final answer.
    s: 'statecard', level: '3', mod: true, floor: 1500,
    id: '01-array-string_12-insert-delete-getrandom-o1', title: 'Insert Delete GetRandom', scenarios: 'S1',
    where: '[data-preset="statecard"][data-level="3"]',
    frames: [
      { at: 0, count: [['[data-field]', 2]], exact: [['[data-field]', ['[10]', '{ 10 => 0 }']]],
        contains: [['.viz-row', 'insert(10)']] },
      { at: 3, exact: [['[data-field]', ['[10, 30]', '{ 10 => 0, 30 => 1 }']]] },
      { at: 4, count: [['[data-output]', 1], ['[data-field][data-source="carried"]', 1]],
        contains: [['[data-output]', 'Yields 10 or 30']] },
    ],
  },
  {
    // Step 2 is `2 -> null`, and step 3 is `3 -> 2` — the terminator is gone because
    // the chain grew past it, which is exactly what `next = null` means.
    s: 'linkedlist', level: '3', mod: true, floor: 1500,
    id: '08-linked-list_05-reverse-linked-list-ii', title: 'Reverse Linked List II', scenarios: 'S1,S2',
    where: '[data-preset="linkedlist"][data-level="3"]',
    frames: [
      { at: 1, exact: [['.viz-cell', ['2', '∅']]], text: [['[data-terminator]', '∅']],
        contains: [['.viz-row', 'next = null']] },
      { at: 2, exact: [['.viz-cell', ['3', '2']]], count: [['[data-terminator]', 0]],
        contains: [['.viz-row', 'push']] },
    ],
  },
  {
    // unique-paths-ii L3 writes [1,1,1], then [1,0,1] (the wall), then dp[2] = 2.
    s: 'dp-table', level: '3', mod: true, floor: 1500, kind: 'overlay',
    id: '17-multi-dp_03-unique-paths-ii', title: 'Unique Paths II', scenarios: 'S1',
    where: '[data-level="3"][data-overlays~="dp-table"]',
    frames: [
      { at: 0, exact: [['.viz-cell', ['1', '1', '1']]], text: [['[data-cursor]', '1']] },
      { at: 1, exact: [['.viz-cell', ['1', '0', '1']]], text: [['[data-cursor]', '0']],
        contains: [['.viz-row', 'dp[1]']] },
    ],
  },
  {
    // invert-binary-tree L3: invert(4) at depth 0, invert(7) at depth 1 and a leaf.
    s: 'recursion-tree', level: '3', mod: true, floor: 1500, kind: 'overlay',
    id: '09-binary-tree-general_03-invert-binary-tree', title: 'Invert Binary Tree', scenarios: 'S1',
    where: '[data-level="3"][data-overlays~="recursion-tree"]',
    frames: [
      { at: 1, exact: [['[data-call]', ['invert(4)', 'invert(7)']]], count: [['[data-base]', 1]],
        text: [['[data-base]', 'base case']],
        contains: [['.viz-row', 'depth 1'], ['.viz-row', 'base case hit']] },
    ],
  },
].map((row) => ({
  ...row,
  // An overlay's panel IS its stage, so the narrow scope is the overlay element itself. The
  // array row already names its own scope: it is row 22's primitive and has no preset stage.
  surface: row.surface ?? (row.kind === 'overlay'
    ? `[data-overlay="${row.s}"]`
    : `[data-preset-stage="${row.s}"]`),
}));

/** Scrub to one frame and check everything the table says that frame shows. */
async function checkFrame(target, row, frame) {
  await target.locator('.dr-range').fill(String(frame.at));
  const at = (sel) => target.locator(`${row.surface} ${sel}`);
  for (const [sel, want] of frame.exact ?? []) expect(await at(sel).allTextContents(), sel).toEqual(want);
  for (const [sel, want] of frame.count ?? []) await expect(at(sel)).toHaveCount(want);
  for (const [sel, want] of frame.text ?? []) await expect(at(sel)).toHaveText(want);
  for (const [sel, want] of frame.contains ?? []) await expect(at(sel)).toContainText(want);
  for (const [sel, attr, want] of frame.attr ?? []) await expect(at(sel)).toHaveAttribute(attr, want);
  if (frame.counter) await expect(target.locator('[data-count]')).toHaveText(frame.counter);
  if (frame.disabled) await expect(target.locator(`[data-act="${frame.disabled}"]`)).toBeDisabled();
}

test.describe('dry-run surfaces (row 25)', () => {
  for (const row of CASES) {
    test(`${row.s}: mounts on ${row.title} and a step forward changes the render · ${row.scenarios}`, async ({ page }) => {
      const target = await openCase(page, row);

      // One frame per authored row, and the level's own table underneath it.
      const steps = await target.getAttribute('data-steps');
      await expect(target.locator('[data-count]')).toHaveText(new RegExp(`^1 / ${steps}$`));
      await expect(target.locator('xpath=preceding-sibling::*[1]')).toHaveClass(/table-scroll/);
      await expect(target.locator('xpath=ancestor::*[@id="articleContent"]')).toHaveCount(1);

      const before = await signature(target);
      await target.locator('[data-act="next"]').click();
      await expect(target.locator('[data-count]')).not.toHaveText(/^1 \//);
      expect(await signature(target)).not.toBe(before);

      // And back again, which is the half that catches a stage painting one-way.
      await target.locator('[data-act="prev"]').click();
      await expect(target.locator('[data-count]')).toHaveText(/^1 \//);
      expect(await signature(target)).toBe(before);
    });

    test(`${row.s}: what it draws on each step · ${row.scenarios}`, async ({ page }) => {
      const target = await openCase(page, row);
      for (const frame of row.frames) await checkFrame(target, row, frame);
    });

    test(`${row.s}: one frame per authored row, and none past the last · S5`, async ({ page }) => {
      const target = await openCase(page, row);
      const steps = Number(await target.getAttribute('data-steps'));

      // S5's browser half. `render.js` documents `plan.steps === table.rows.length` as
      // an invariant, and `steps` is built from the watched column of the trace. A trace
      // carrying helper-function frames (arrayToTree / listToArray / buildGraph) or
      // steps after the target returned would out-count the authored rows here — the
      // reader could drag past the end of the run. Node-level, the same property is
      // `scripts/test-trace.mjs` `region-isolation`.
      const table = target.locator('xpath=preceding-sibling::*[1]');
      const rows = await table.locator('tbody tr').count();
      expect(steps, `${row.s}: player frames vs authored rows`).toBe(rows);

      // And the reader cannot reach a frame the authored table does not have.
      await target.locator('.dr-range').fill(String(steps - 1));
      await expect(target.locator('[data-count]')).toHaveText(`${steps} / ${steps}`);
      await expect(target.locator('[data-act="next"]')).toBeDisabled();
      await expect(target.locator('.dr-range')).toHaveAttribute('max', String(steps - 1));
    });

    test(`${row.s}: screenshot evidence · ${row.scenarios}`, async ({ page }, testInfo) => {
      const target = await openCase(page, row);
      // Step to a frame where something has actually happened, so the shot is not the
      // blank state every preset draws first.
      await target.locator('[data-act="next"]').click();
      await expect(target.locator('[data-count]')).not.toHaveText(/^1 \//);

      // The surface's own box, to a stable path so the evidence can be cited by name.
      const stage = await target.locator(row.surface).screenshot();
      await target.locator(row.surface).screenshot({
        path: `scratch/row25/${row.s}-${testInfo.project.name}.png`,
      });
      expect(stage.byteLength, `${row.s} crop is blank`).toBeGreaterThan(row.floor);

      // And the table above it, which is the unit a reader actually reads.
      await testInfo.attach(`${row.s}-${testInfo.project.name}`, {
        body: await target.locator('xpath=preceding-sibling::*[1]').screenshot(),
        contentType: 'image/png',
      });

      // The array row also carries the whole-viewport shot: the player in the middle of
      // a real article is the evidence, and it is the only one that can show a viewport-
      // dependent failure at all — row 31's 390px bug was invisible at 1440px.
      if (row.page) {
        await testInfo.attach(`dry-run-page-${testInfo.project.name}`, {
          body: await page.screenshot({ fullPage: false }),
          contentType: 'image/png',
        });
      }
    });
  }
});

/* ------------------------------------------------------------------ *
 * Cross-cutting contracts — the regressions a static trace cannot catch.
 * ------------------------------------------------------------------ */

test.describe('cross-cutting (row 25)', () => {
  test('a stepper is mounted under all three level tables · S1,S3', async ({ page }) => {
    await openGuide(page);

    const players = page.locator(player);
    await expect(players).toHaveCount(3);
    await expect(page.locator('[data-dryrun="playing"]')).toHaveCount(3);
    await expect(page.locator('table[data-dryrun="skipped"]')).toHaveCount(0);

    // All three levels, in document order (decision 2: Tier 1 animates every level).
    const levels = await players.evaluateAll((nodes) => nodes.map((n) => n.dataset.level));
    expect(levels).toEqual(['1', '2', '3']);

    // Each sits directly under its own table's scroll wrapper, inside the article —
    // not floated into the chat rail or the sidebar.
    for (const node of await players.all()) {
      await expect(node.locator('xpath=preceding-sibling::*[1]')).toHaveClass(/table-scroll/);
      await expect(node.locator('xpath=ancestor::*[@id="articleContent"]')).toHaveCount(1);
    }
  });

  test('stepping marks the table row the current step came from · S1', async ({ page }) => {
    await openGuide(page);
    const l2 = page.locator(`${player}[data-level="2"]`);
    const table = page.locator('table[data-dryrun="playing"]').nth(1);

    await expect(table.locator('tr[data-dryrun-current]')).toHaveCount(1);
    await l2.locator('[data-act="next"]').click();
    await l2.locator('[data-act="next"]').click();

    // Step 3 of the trace is the row whose Step cell reads 3 — the picture and the
    // numbers above it are visibly the same step.
    await expect(table.locator('tr[data-dryrun-current]')).toHaveCount(1);
    await expect(table.locator('tr[data-dryrun-current] td').first()).toHaveText('3');
  });

  test('the scrubber jumps, and both ends clamp · S2', async ({ page }) => {
    await openGuide(page);
    const l2 = page.locator(`${player}[data-level="2"]`);

    await l2.locator('.dr-range').fill('3');
    await expect(l2.locator('[data-count]')).toHaveText('4 / 4');
    expect(await l2.locator('.viz-cell').allTextContents()).toEqual(['1', '2', '3', '4']);
    await expect(l2.locator('[data-act="next"]')).toBeDisabled(); // no wrap past the end

    await l2.locator('.dr-range').fill('0');
    await expect(l2.locator('[data-count]')).toHaveText('1 / 4');
    await expect(l2.locator('[data-act="prev"]')).toBeDisabled();
  });

  test('play advances on its own and stops at the last step · S1', async ({ page }) => {
    await openGuide(page);
    const l1 = page.locator(`${player}[data-level="1"]`); // 4 rows
    const play = l1.locator('[data-act="play"]');

    await play.click();
    await expect(play).toHaveAttribute('aria-pressed', 'true');
    await expect(l1.locator('[data-count]')).not.toHaveText('1 / 4');
    await expect(l1.locator('[data-count]')).toHaveText('4 / 4', { timeout: 8000 });
    expect(await l1.locator('.viz-cell').allTextContents()).toEqual(['1', '2', '3', '4', '5']);
    await expect(play).toHaveAttribute('aria-pressed', 'false'); // it let go at the end

    // A press after the end starts over rather than sitting there doing nothing.
    await play.click();
    await expect(l1.locator('[data-count]')).toHaveText('2 / 4');
  });

  test('a guide with no array state is left alone, not half-rendered · S3', async ({ page }) => {
    // Two Sum has three dry-run tables and every column in all three is a scalar.
    await page.goto('/#05-hashmap_06-two-sum');
    await expect(page.locator('h1')).toContainText('Two Sum');

    await expect(page.locator('table[data-dryrun="skipped"]')).toHaveCount(3);
    await expect(page.locator(player)).toHaveCount(0); // nothing invented, nothing broken
    await expect(page.locator('table[data-dryrun="skipped"]').first()).toBeVisible();

    // And the tables the player never claimed are still plain tables, not marked.
    const unmarked = await page.locator('#articleContent table').evaluateAll((nodes) =>
      nodes.filter((n) => !n.dataset.dryrun).length,
    );
    expect(unmarked).toBeGreaterThan(0);

    // Loading the preset module on top changes nothing: it must not rescue a guide that
    // has nothing to animate.
    await page.addScriptTag({ type: 'module', url: '/dryrun/render.js' });
    await expect(page.locator('table[data-dryrun="skipped"]')).toHaveCount(3);
    await expect(page.locator(player)).toHaveCount(0);
  });

  test('the array is drawn in the portal\'s own boxes, with no math to re-render · S3', async ({ page }) => {
    await openGuide(page);
    const first = page.locator(`${player} >> nth=0`);
    // Reuses the chat widget's array stylesheet rather than introducing a second one.
    await expect(first.locator('.viz-array')).toHaveCount(1);
    await expect(first.locator('.viz-grid')).toHaveCount(1);
    // Cells are plain text, so KaTeX has nothing inside the player to re-render — while
    // the table above it still carries its maths, untouched.
    await expect(first.locator('.katex')).toHaveCount(0);
    await expect(page.locator('#articleContent .katex').first()).toBeVisible();
  });

  test('switching guides in the sidebar replaces the player and the preset · S3', async ({ page }) => {
    // Navigated the way a reader navigates. The portal has no hashchange listener, so a
    // bare `goto` to a new hash is a no-op in the app as well as in the test — the sidebar
    // is the only in-page way in, and it is the one worth exercising.
    await openGuide(page);
    await page.locator(`${player}[data-level="2"] [data-act="next"]`).click();
    await expect(page.locator(`${player}[data-level="2"] [data-count]`)).toHaveText('2 / 4');

    await openGuideFromNav(page, 'Two Sum');
    await expect(page.locator('h1')).toContainText('Two Sum');
    await expect(page.locator(player)).toHaveCount(0);
    await expect(page.locator('table[data-dryrun="skipped"]')).toHaveCount(3);

    await openGuideFromNav(page, 'Merge Sorted Array');
    await expect(page.locator(player)).toHaveCount(3);
    // A fresh player starts at the first step; it does not inherit the old position.
    await expect(page.locator(`${player}[data-level="2"] [data-count]`)).toHaveText('1 / 4');

    // Same question asked of a preset: navigate to a guide whose tables a preset claims
    // and the previous guide's preset must be gone, not stacked underneath the new one.
    await page.locator(`${player}[data-level="2"] [data-act="next"]`).click();
    await openGuideFromNav(page, 'Spiral Matrix');
    await page.addScriptTag({ type: 'module', url: '/dryrun/render.js' });
    await expect(page.locator('h1')).toContainText('Spiral Matrix');
    await expect(page.locator(`${player}[data-preset="matrix"]`)).toHaveCount(1);
  });

  test('the preset reuses row 22\'s transport: same transport on adopted and own chrome · S3', async ({ page }) => {
    // minimum-size-subarray-sum L1 holds a plain array literal in its `Subarray` column, so
    // row 22 mounts an array player there and the preset adopts it. Simplify-path L2 has no
    // array column row 22 can use, so the preset builds the player itself. Both must end up
    // with one transport between them and the reader.
    await openCase(page, CASES.find((r) => r.s === 'window'));
    const adopted = page.locator(`${player}[data-preset="window"]`);
    await expect(adopted).toHaveAttribute('data-chrome', 'adopted');
    await expect(adopted.locator('.dr-bar')).toHaveCount(1);

    // Read the adopted player's contract while it is still on the page — the previous
    // article's players go away with it.
    const shape = (locator) => locator.locator('.dr-head > span').evaluateAll((nodes) => nodes.map((n) => n.className));
    const labels = (locator) => locator.locator('.dr-btn').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('aria-label')));
    const adoptedShape = await shape(adopted);
    const adoptedLabels = await labels(adopted);

    // Navigated the way a reader navigates: the portal has no hashchange listener, so a bare
    // `goto` to a new hash is a no-op in the app as well as in the test.
    await openGuideFromNav(page, 'Simplify Path');
    await page.addScriptTag({ type: 'module', url: '/dryrun/render.js' });
    const own = page.locator(`${player}[data-preset="stack"][data-level="2"]`);
    await expect(own).toHaveAttribute('data-chrome', 'own');
    await expect(own.locator('.dr-bar')).toHaveCount(1);
    await expect(own.locator('.dr-btn')).toHaveCount(3);
    await expect(own.locator('.dr-range')).toHaveAttribute('max', '8');

    // The two players are the same contract: same classes, same aria labels.
    expect(await shape(own)).toEqual(adoptedShape);
    expect(await labels(own)).toEqual(adoptedLabels);
  });

  test('Tier 2 mounts on the canonical level ONLY · S1,S3', async ({ page }) => {
    // word-ladder has three dry-run tables. Tier 2 claims the L3 one and nothing else — a
    // Tier-2 player on L1 or L2 would either be dead UI or a constraint the reader did not ask
    // for, and this is the assertion that says which.
    await openCase(page, CASES.find((r) => r.s === 'graph'));

    const tiers = await page.locator(player).evaluateAll((nodes) => nodes.map((n) => n.dataset.level));
    expect(tiers.filter((level) => level === '3').length).toBe(1);
    await expect(page.locator(`${player}[data-preset="graph"]`)).toHaveCount(1);
    await expect(page.locator(`${player}[data-preset="graph"]`)).toHaveAttribute('data-level', '3');
  });

  test('an overlay needs a transport, so an overlay-only table still gets a player · S3', async ({ page }) => {
    const target = await openCase(page, CASES.find((r) => r.s === 'dp-table'));
    await expect(target.locator('.dr-bar')).toHaveCount(1);
    await expect(target.locator('.dr-btn')).toHaveCount(3);
    // Nothing claimed the table as a preset, so there is no preset stage — the panel IS the
    // stage, and it still follows the scrubber.
    await expect(target.locator(`${player}[data-preset]`)).toHaveCount(0);
  });

  test('the overlays ride on a preset without taking the table from it · S1,S3', async ({ page }) => {
    // 01-array-string/12-insert-delete-getrandom-o1 L3 is a statecard AND a call spine: every
    // row names an op, so recursion-tree rides along without taking the preset away.
    const target = await openCase(page, CASES.find((r) => r.s === 'statecard'));
    const both = page.locator(`${player}[data-preset="statecard"][data-overlays~="recursion-tree"]`);
    await expect(both).toHaveCount(1);
    await expect(both.locator('[data-preset-stage="statecard"]')).toHaveCount(1);
    await expect(both.locator('[data-overlay="recursion-tree"]')).toHaveCount(1);
    // One transport between them, not two: three buttons, one scrubber.
    await expect(both.locator('.dr-bar')).toHaveCount(1);
    await expect(both.locator('.dr-range')).toHaveCount(1);
    // And the two panels follow the same step. Four independent `insert`s are four sibling
    // calls, not a four-deep recursion, so the spine holds one frame and it follows the
    // scrubber to the op of this step.
    await both.locator('.dr-range').fill('3');
    expect(await both.locator('[data-overlay="recursion-tree"] [data-call]').allTextContents())
      .toEqual(['remove(20)']);
  });

  test('reduced motion removes the pop without removing the highlight · S3', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });

    // Both a Tier-2 and a Tier-1 stage: the pop is drawn by each of them, and the point is
    // the highlight that survives it, not the pop's absence on one surface. The sidebar hop
    // needs no second injection — `render.js` subscribes to `lt150:article` and mounts itself
    // when the portal opens the next article.
    const tier2 = await openCase(page, CASES.find((r) => r.s === 'linkedlist'));
    await tier2.locator('[data-act="next"]').click();
    await tier2.locator('.dr-range').fill('2');
    await expect(tier2.locator('.viz-cell[data-node].is-active')).toHaveCount(1);
    await expect(tier2.locator('.dr-pop')).toHaveCount(0);

    await openGuideFromNav(page, 'Simplify Path');
    const tier1 = page.locator(`${player}[data-preset="stack"][data-level="2"]`);
    await expect(tier1).toBeVisible();
    await tier1.locator('[data-act="next"]').click();
    await expect(tier1.locator('.viz-cell.is-active')).toHaveCount(1);
    await expect(tier1.locator('.dr-pop')).toHaveCount(0);
  });

  test('row 22\'s array primitive is untouched on a guide no preset claims · S3', async ({ page }) => {
    await openGuide(page);
    await page.addScriptTag({ type: 'module', url: '/dryrun/render.js' });

    // Three players, still row 22's, none carrying a preset, no stage anywhere.
    await expect(page.locator(player)).toHaveCount(3);
    await expect(page.locator(`${player}[data-preset]`)).toHaveCount(0);
    expect(await page.locator('[data-preset-stage]').count()).toBe(0);

    // And the array still animates exactly as the `array` row's frames assert.
    const l2 = page.locator(`${player}[data-level="2"]`);
    await l2.locator('[data-act="next"]').click();
    await expect(l2.locator('[data-count]')).toHaveText('2 / 4');
    expect(await l2.locator('.viz-cell').allTextContents()).toEqual(['1', '2', '0', '0']);
  });

  test('no surface adds a global to the portal · S3', async ({ page }) => {
    // Every entry point, one assertion: an array player (index.js, from index.html's own
    // tag), a Tier-1 preset, a Tier-2 preset and an overlay. Three identical copies of this
    // test were one `openX` each.
    //
    // The hops go through the sidebar, not `goto`: the portal has no hashchange listener, so
    // a bare `goto` to a new hash is a no-op in the app as well as in the test. `render.js`
    // is injected exactly once — the later articles mount through the `lt150:article` seam it
    // subscribes to, which is the path a reader's own clicks take.
    await openGuide(page);
    await page.addScriptTag({ type: 'module', url: '/dryrun/render.js' });
    await openGuideFromNav(page, 'Simplify Path');
    await openGuideFromNav(page, 'Word Ladder');
    await openGuideFromNav(page, 'Unique Paths II');

    // One article at a time, and each of the four surfaces actually mounted before the
    // assertion — otherwise a surface that failed to mount would read as a clean window.
    for (const title of ['Merge Sorted Array', 'Simplify Path', 'Word Ladder', 'Unique Paths II']) {
      await openGuideFromNav(page, title);
      await expect(page.locator('h1')).toContainText(title);
      await expect(page.locator(player).first()).toBeVisible();

      const leaked = await page.evaluate(() =>
        Object.keys(window).filter((k) => /^dryrun|^DryRun|^dr[A-Z]/.test(k)),
      );
      expect(leaked, `${title} leaked a global onto window`).toEqual([]);
    }
  });
});

/**
 * Row 31 — design pass: accessibility, keyboard, contrast and motion, on the shipped player.
 *
 * Contrast is NOT hand-rolled here. axe-core's colour-contrast rule resolves the real
 * background through the ancestor chain, which is the part a hand-rolled ratio gets wrong on a
 * page with translucent panels. So one tool answers contrast and every other WCAG rule at once.
 *
 * `:focus-visible` on `.dr-btn` and `.dr-range` and the reduced-motion guard already exist in
 * `docs/index.html` (written by rows 22/23). This row's contribution is PROOF that they work:
 * a style nobody exercises is a style nobody knows is broken.
 */
test.describe('design pass (row 31)', () => {
  test('axe-core reports no violations inside the dry-run player · S3', async ({ page }) => {
    await openGuide(page);
    await expect(page.locator(player).first()).toBeVisible();

    await page.addScriptTag({ path: 'node_modules/axe-core/axe.min.js' });

    // Scoped to the player, and deliberately so. A whole-page scan reports three `serious`
    // violations that all predate this project and sit outside docs/dryrun/ — `aria-hidden-focus`
    // and a contrast miss in the chat widget (`docs/chat-widget.js`), and a scrollable code block
    // without keyboard access in the portal chrome. Adopting them here would put another
    // subsystem's a11y debt inside a dry-run commit; they are recorded in the progress ledger
    // as a finding instead. Widening the scope is a one-word change once they are fixed.
    const players = await page.locator(player).all();
    const violations = [];
    for (const [index, node] of players.entries()) {
      // eslint-disable-next-line no-undef
      const run = await node.evaluate(async (el) => globalThis.axe.run(el, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
      }));
      for (const v of run.violations) {
        violations.push({
          id: v.id,
          impact: v.impact,
          player: index,
          target: v.nodes[0]?.target?.join(' ') ?? '',
          help: v.help,
        });
      }
    }
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  test('every player control is keyboard reachable and labelled · S3', async ({ page }) => {
    await openGuide(page);
    const first = page.locator(player).first();

    // `prev` is `disabled` at step 0 and a disabled button is correctly not focusable — that is
    // the control working, not failing. Asserted as its own contract so the distinction survives
    // a future edit that "helpfully" focuses it anyway.
    await expect(first.locator('[data-act="prev"]')).toBeDisabled();
    await first.locator('[data-act="next"]').click();
    await expect(first.locator('[data-act="prev"]')).toBeEnabled();

    // Reach the controls with the KEYBOARD, not `.focus()`. `:focus-visible` deliberately does
    // not match programmatic focus, so asserting an outline after `.focus()` tests nothing —
    // it fails against a correct player and passes against a broken one.
    await first.locator('[data-act="prev"]').focus();
    await page.keyboard.press('Tab');
    await expect(first.locator('[data-act="play"]')).toBeFocused();

    for (const act of ['play', 'next']) {
      await expect(first.locator(`[data-act="${act}"]`)).toBeFocused();
      // A keyboard-focused control must show a visible ring, or a keyboard user cannot see
      // where they are.
      const outline = await first.locator(`[data-act="${act}"]`).evaluate((el) => {
        const s = getComputedStyle(el);
        return { width: s.outlineWidth, style: s.outlineStyle };
      });
      expect(outline.style, `${act} has no outline style`).not.toBe('none');
      expect(parseFloat(outline.width), `${act} outline is invisible`).toBeGreaterThan(0);
      if (act !== 'next') await page.keyboard.press('Tab');
    }

    await page.keyboard.press('Tab');
    await expect(first.locator('.dr-range')).toBeFocused();

    await first.locator('.dr-range').focus();
    await expect(first.locator('.dr-range')).toBeFocused();

    const name = await first.locator('[data-act="play"]').getAttribute('aria-label');
    expect(name).toBeTruthy();
    await first.locator('[data-act="play"]').focus();
    await page.keyboard.press('Enter');
    await expect(first.locator('[data-act="play"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('the scrubber is operable from the keyboard alone · S3', async ({ page }) => {
    await openGuide(page);
    const first = page.locator(player).first();
    const range = first.locator('.dr-range');

    await range.focus();
    await range.fill('0');
    await page.keyboard.press('ArrowRight');
    await expect(first).toHaveAttribute('data-step', '1');
    await page.keyboard.press('ArrowLeft');
    await expect(first).toHaveAttribute('data-step', '0');
  });

  test('reduced motion disables the step animation · S3', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openGuide(page);
    const first = page.locator(player).first();

    await first.locator('[data-act="next"]').click();
    await expect(first).not.toHaveAttribute('data-step', '0');

    const animated = await first.locator('.viz-cell.is-active').evaluate((el) => getComputedStyle(el).animationName);
    expect(animated).toBe('none');
  });

  test('motion IS present without the reduced-motion preference · S3', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openGuide(page);
    const first = page.locator(player).first();
    await first.locator('[data-act="next"]').click();
    await expect(first).not.toHaveAttribute('data-step', '0');

    const animated = await first.locator('.viz-cell.is-active').evaluate((el) => getComputedStyle(el).animationName);
    expect(animated).not.toBe('none');
  });
});
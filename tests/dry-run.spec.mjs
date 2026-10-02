/**
 * Rows 22 and 23 E2E: the Tier-1 presets on real guide pages, at both configured viewports.
 *
 * `playwright.config.mjs` builds docs/ and serves it statically first, because
 * docs/curriculum-data.js is gitignored. The `desktop` project (1440x900) and the
 * `Pixel 7` project both run this file, so one assertion set is the responsive
 * evidence — there is deliberately no per-viewport branch in here.
 *
 * ── The `array` primitive (row 22) ───────────────────────────────────────────
 * The guide is Merge Sorted Array, not Two Sum. Plan row 22 names two-sum L1; that
 * table has one data row and seven scalar columns (`i`, `nums[i]`, `j`, `nums[j]`,
 * `sum`, `sum === target`?, `Action`), so its input array exists only in the prose line
 * above the table and there is no array STATE column for any array primitive to read.
 * Merge Sorted Array is a guide this repo ships a per-step array state for at all three
 * levels, and its L2 trace writes exactly one element per step:
 *
 *   [1, 3, 0, 0] -> [1, 2, 0, 0] -> [1, 2, 3, 0] -> [1, 2, 3, 4]
 *
 * so two forward clicks are two real array changes, which is what the step test needs
 * in order to assert that stepping moves the picture.
 *
 * ── The other four presets (row 23) ──────────────────────────────────────────
 * One table-driven loop over `PRESET_CASES`, so row 25 extends the list rather than the
 * file. Each case names its guide, and each guide is chosen from `catalog/problems.json`
 * `patterns[]` — not from the module directory, which is why the bit cases are in
 * `22-bit-manipulation` and not in `01-array-string`:
 *
 *   stack   07-stack/02-simplify-path      patterns ["Stack", "String Tokenization", …]
 *   matrix  04-matrix/02-spiral-matrix     patterns ["Matrix", "Simulation", "Boundary Shrinking"]
 *   window  03-sliding-window/01-min-…-sum patterns ["Sliding Window", "Two Pointers", …]
 *   bits    22-bit-manipulation/03-num-1-b patterns ["Bit Manipulation", "Population Count"]
 *
 * `docs/dryrun/render.js` is loaded with `addScriptTag` rather than by a `<script>` tag in
 * `docs/index.html`, because row 23 must not edit that file: `index.html` carries row 22's
 * tag and this row's module list cannot grow. It is the same file, from the same origin,
 * evaluated as a module in the same page — the only difference is who fetched it — so the
 * assertions below are assertions about the shipped artefact. Adding the tag to
 * `docs/index.html` is a one-line change that makes the injection unnecessary.
 */
import { test, expect } from '@playwright/test';

/** `scripts/build-site.mjs` turns "01-array-string/01-merge-sorted-array.md" into this. */
const ARTICLE = '01-array-string_01-merge-sorted-array';
const ARTICLE_URL = `/#${ARTICLE}`;

const player = '[data-dryrun-player]';

/** The cells of one player, as the reader sees them. */
async function cells(player) {
  return player.locator('.viz-cell').allTextContents();
}

/** Open a guide and wait for its players, the way a reader's click arrives. */
async function openGuide(page) {
  await page.goto(ARTICLE_URL);
  await expect(page.locator('h1')).toContainText('Merge Sorted Array');
  await expect(page.locator(player).first()).toBeVisible();
}

/** One preset, on the guide whose catalog entry says it teaches that shape. */
const PRESET_CASES = [
  { preset: 'stack', id: '07-stack_02-simplify-path', title: 'Simplify Path', level: '2', chrome: 'own' },
  { preset: 'matrix', id: '04-matrix_02-spiral-matrix', title: 'Spiral Matrix', level: '2', chrome: 'own' },
  { preset: 'window', id: '03-sliding-window_01-minimum-size-subarray-sum', title: 'Minimum Size Subarray', level: '1', chrome: 'adopted' },
  { preset: 'bits', id: '22-bit-manipulation_03-number-of-1-bits', title: 'Number of 1 Bits', level: '3', chrome: 'own' },
];

/** Open a preset's guide, load the preset module, and wait for its player. */
async function openPreset(page, row) {
  await page.goto(`/#${row.id}`);
  await expect(page.locator('h1')).toContainText(row.title);
  await page.addScriptTag({ type: 'module', url: '/dryrun/render.js' });
  const target = page.locator(`${player}[data-preset="${row.preset}"][data-level="${row.level}"]`);
  await expect(target).toBeVisible();
  return target;
}

/**
 * Everything a step changed, as one string: the cells and the readout under them.
 *
 * Comparing this before and after a click is the generic "stepping moves the picture"
 * assertion, and it is deliberately not per-preset — a preset that redrew the same cells
 * and a different readout would pass a text-only check.
 */
async function signature(player) {
  // A Tier-2 player can carry a preset stage AND overlay panels, so every readout counts: the
  // generic "stepping moves the picture" assertion has to see all of them to mean anything.
  const cells = await player.locator('.viz-cell').allTextContents();
  const rows = await player.locator('.viz-row').allInnerTexts();
  const nodes = await player.locator('[data-preset-stage] [data-node], [data-preset-stage] [data-call]').allTextContents();
  return `${cells.join('|')}#${rows.join('#')}#${nodes.join('|')}`;
}

test.describe('dry-run array player', () => {
  test('plan decision 2: a stepper is mounted under all three level tables', async ({ page }) => {
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

  test('step forward twice moves the array, and back returns it', async ({ page }) => {
    await openGuide(page);
    const l2 = page.locator(`${player}[data-level="2"]`); // 4 rows, one write per row

    const step0 = await cells(l2);
    expect(step0).toEqual(['1', '3', '0', '0']);

    // The counter is the reader's position in the trace, and the first step is the
    // floor: back is disabled rather than wrapped.
    await expect(l2.locator('[data-count]')).toHaveText('1 / 4');
    await expect(l2.locator('[data-act="prev"]')).toBeDisabled();

    await l2.locator('[data-act="next"]').click();
    await expect(l2.locator('[data-count]')).toHaveText('2 / 4');
    expect(await cells(l2)).toEqual(['1', '2', '0', '0']); // nums2[0] written to index 1

    await l2.locator('[data-act="next"]').click();
    await expect(l2.locator('[data-count]')).toHaveText('3 / 4');
    expect(await cells(l2)).toEqual(['1', '2', '3', '0']); // and index 2 — changed, in the DOM
    await expect(l2.locator('.viz-cell.is-active')).toHaveText('3'); // the swap is marked

    await l2.locator('[data-act="prev"]').click();
    await expect(l2.locator('[data-count]')).toHaveText('2 / 4');

    await l2.locator('[data-act="prev"]').click();
    await expect(l2.locator('[data-count]')).toHaveText('1 / 4');
    expect(await cells(l2)).toEqual(step0); // and exactly back
  });

  test('stepping marks the table row the current step came from', async ({ page }) => {
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

  test('the scrubber jumps, and both ends clamp', async ({ page }) => {
    await openGuide(page);
    const l2 = page.locator(`${player}[data-level="2"]`);

    await l2.locator('.dr-range').fill('3');
    await expect(l2.locator('[data-count]')).toHaveText('4 / 4');
    expect(await cells(l2)).toEqual(['1', '2', '3', '4']);
    await expect(l2.locator('[data-act="next"]')).toBeDisabled(); // no wrap past the end

    await l2.locator('.dr-range').fill('0');
    await expect(l2.locator('[data-count]')).toHaveText('1 / 4');
    await expect(l2.locator('[data-act="prev"]')).toBeDisabled();
  });

  test('play advances on its own and stops at the last step', async ({ page }) => {
    await openGuide(page);
    const l1 = page.locator(`${player}[data-level="1"]`); // 4 rows
    const play = l1.locator('[data-act="play"]');

    await play.click();
    await expect(play).toHaveAttribute('aria-pressed', 'true');
    await expect(l1.locator('[data-count]')).not.toHaveText('1 / 4');
    await expect(l1.locator('[data-count]')).toHaveText('4 / 4', { timeout: 8000 });
    expect(await cells(l1)).toEqual(['1', '2', '3', '4', '5']);
    await expect(play).toHaveAttribute('aria-pressed', 'false'); // it let go at the end

    // A press after the end starts over rather than sitting there doing nothing.
    await play.click();
    await expect(l1.locator('[data-count]')).toHaveText('2 / 4');
  });

  test('a guide with no array state is left alone, not half-rendered', async ({ page }) => {
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
  });

  test('the player adds no global', async ({ page }) => {
    await openGuide(page);
    const leaked = await page.evaluate(() =>
      Object.keys(window).filter((k) => /^dryrun|^DryRun|^dr[A-Z]/.test(k)),
    );
    expect(leaked).toEqual([]);
  });

  test('the array is drawn in the portal\'s own boxes, with no math to re-render', async ({ page }) => {
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

  /** Open the sidebar if this viewport keeps it off-canvas, then click a guide by title. */
async function openGuideFromNav(page, title) {
  if (page.viewportSize().width < 768) await page.locator('#menuBtn').click();
  await page.locator('#curriculumNav .nav-item', { hasText: title }).first().click();
}

test('switching guides in the sidebar replaces the player, it does not stack', async ({ page }) => {
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
  });
});

test.describe('screenshots', () => {
  test('capture the player on the real page', async ({ page }, testInfo) => {
    await openGuide(page);
    const l2 = page.locator(`${player}[data-level="2"]`);
    await l2.locator('[data-act="next"]').click();
    await l2.locator('[data-act="next"]').click();
    await l2.locator('[data-act="next"]').click();
    expect(await l2.locator('[data-count]').textContent()).toBe('4 / 4');

    // Whole viewport — the player in the middle of a real article, not a component crop.
    await testInfo.attach(`dry-run-page-${testInfo.project.name}`, {
      body: await page.screenshot({ fullPage: false }),
      contentType: 'image/png',
    });
    // And the table + player together, which is the unit a reader actually reads.
    await testInfo.attach(`dry-run-player-${testInfo.project.name}`, {
      body: await page
        .locator(`${player}[data-level="2"]`)
        .locator('xpath=preceding-sibling::*[1]')
        .screenshot(),
      contentType: 'image/png',
    });
  });
});

/* ------------------------------------------------------------------ *
 * Row 23 — the other four Tier-1 presets
 * ------------------------------------------------------------------ */

test.describe('dry-run presets (row 23)', () => {
  for (const row of PRESET_CASES) {
    test(`${row.preset}: mounts on ${row.title} and a step forward changes the render`, async ({ page }) => {
      const target = await openPreset(page, row);

      // One frame per authored row, and the level's own table underneath it.
      const stepper = target.locator('[data-count]');
      await expect(stepper).toHaveText(/^1 \/ \d+$/);
      expect(await target.locator('[data-count]').textContent()).toMatch(new RegExp(`^1 / ${await target.getAttribute('data-steps')}$`));
      await expect(target.locator('xpath=preceding-sibling::*[1]')).toHaveClass(/table-scroll/);
      await expect(target.locator(`xpath=ancestor::*[@id="articleContent"]`)).toHaveCount(1);

      const before = await signature(target);
      await target.locator('[data-act="next"]').click();
      await expect(stepper).not.toHaveText(/^1 \//);
      const after = await signature(target);
      expect(after).not.toBe(before);

      // And back again, which is the half that catches a stage painting one-way.
      await target.locator('[data-act="prev"]').click();
      await expect(stepper).toHaveText(/^1 \//);
      expect(await signature(target)).toBe(before);
    });
  }

  test('stack: a LIFO that grows and shrinks, not a row of cells', async ({ page }) => {
    const target = await openPreset(page, PRESET_CASES[0]);

    // Step 1 of simplify-path L2 is the empty stack: no entries, and the depth marker says so
    // rather than drawing a row of empty boxes.
    await expect(target.locator('.viz-cell')).toHaveCount(0);
    await expect(target.locator('.viz-pointer')).toHaveText('empty');

    await target.locator('[data-act="next"]').click();
    await expect(target.locator('.viz-cell')).toHaveCount(1);
    expect(await cells(target)).toEqual(['"a"']); // one entry, not an empty index
    await expect(target.locator('.viz-k')).toHaveText('push');

    // The depth marker names where the top of the stack is — the thing a row cannot say.
    await expect(target.locator('.viz-pointer')).toHaveText('depth 0');

    // Step 3 pushes a second segment; step 5 pops it back off.
    await target.locator('.dr-range').fill('3');
    expect(await cells(target)).toEqual(['"b"', '"a"']); // top of the stack is the first cell
    await expect(target.locator('.viz-k')).toHaveText('push');
    await target.locator('.dr-range').fill('4');
    expect(await cells(target)).toEqual(['"a"']);
    await expect(target.locator('.viz-k')).toHaveText('pop');

    // Both ends clamp, on row 22's transport: 9 steps, so step 1 disables back and step 9 disables
    // forward — no wrap at either end.
    await target.locator('.dr-range').fill('0');
    await expect(target.locator('[data-count]')).toHaveText('1 / 9');
    await expect(target.locator('[data-act="prev"]')).toBeDisabled();
    await target.locator('.dr-range').fill('8');
    await expect(target.locator('[data-count]')).toHaveText('9 / 9');
    await expect(target.locator('[data-act="next"]')).toBeDisabled();
  });

  test('matrix: a rectangle with row and column headers, and the addressed cell marked', async ({ page }) => {
    const target = await openPreset(page, PRESET_CASES[1]);

    // 2x2 grid plus one header row and one header column.
    await expect(target.locator('.viz-cell')).toHaveCount(9);
    await expect(target.locator('[data-axis=""]')).toHaveCount(5);
    expect(await target.locator('[data-axis=""]').allTextContents()).toEqual(['', 'c0', 'c1', 'r0', 'r1']);

    // Spiral-matrix L2 writes (0, 1) on step 2 — the cell it says it is addressing.
    await expect(target.locator('[data-at]')).toHaveAttribute('data-at', '0,0');
    await target.locator('[data-act="next"]').click();
    await expect(target.locator('[data-at]')).toHaveAttribute('data-at', '0,1');
    await expect(target.locator('.viz-cell.is-active')).toHaveCount(1);
    await expect(target.locator('.viz-cell.is-active')).toHaveText('101');
    await expect(target.locator('.viz-row')).toContainText('addressed (0, 1)');
  });

  test('window: the whole array stays, and only the bounds move', async ({ page }) => {
    const target = await openPreset(page, PRESET_CASES[2]);

    // The guide writes four windows of the input `nums = [2, 3, 1, 2, 4, 3]`. All six
    // indices are on screen whether or not they are in the window — which is the proof
    // this is not an array drawn a different way.
    expect(await cells(target)).toEqual(['2', '3', '1', '2', '4', '3']);
    await expect(target.locator('.viz-cell.is-active')).toHaveCount(4); // the step-1 window, 0…3
    await expect(target.locator('.viz-row')).toContainText('0…3');
    await expect(target.locator('.viz-row')).toContainText('size 4');

    await target.locator('[data-act="next"]').click();
    await expect(target.locator('.viz-cell.is-active')).toHaveCount(4); // 1…4, still four long
    await expect(target.locator('.viz-row')).toContainText('1…4');

    // Step 4 jumps the left edge from 2 to 4, because the guide skips `i = 3`. The render
    // says "two left, one right" rather than rounding that to a one-cell slide.
    await target.locator('.dr-range').fill('3');
    await expect(target.locator('.viz-row')).toContainText('4…5');
    await expect(target.locator('.viz-row')).toContainText('−2');
    await expect(target.locator('.viz-row')).toContainText('−3');
    await expect(target.locator('.viz-row')).toContainText('+5');
  });

  test('bits: a number as its digits, with the bit the step cleared lit', async ({ page }) => {
    const target = await openPreset(page, PRESET_CASES[3]);

    // 1011 → 1010 → 1000, most significant digit leftmost.
    expect(await cells(target)).toEqual(['1', '0', '1', '1']);
    await expect(target.locator('[data-bit]')).toHaveAttribute('data-bit', '0'); // bit 0 cleared
    await expect(target.locator('.viz-cell.is-active')).toHaveText('1');
    await expect(target.locator('.viz-row')).toContainText('3 set');

    await target.locator('[data-act="next"]').click();
    expect(await cells(target)).toEqual(['1', '0', '1', '0']);
    await expect(target.locator('[data-bit]')).toHaveAttribute('data-bit', '1'); // and then bit 1

    await target.locator('[data-act="next"]').click();
    expect(await cells(target)).toEqual(['1', '0', '0', '0']);
    await expect(target.locator('[data-bit]')).toHaveAttribute('data-bit', '3');
    await expect(target.locator('.viz-row')).toContainText('1 set');
  });

  test('the preset reuses row 22\'s transport: same transport on adopted and own chrome', async ({ page }) => {
    // minimum-size-subarray-sum L1 holds a plain array literal in its `Subarray` column, so
    // row 22 mounts an array player there and this row adopts it. Simplify-path L2 has no
    // array column row 22 can use, so the preset builds the player itself. Both must end up
    // with one transport between them and the reader.
await openPreset(page, PRESET_CASES[2]);
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
    if (page.viewportSize().width < 768) await page.locator('#menuBtn').click();
    await page.locator('#curriculumNav .nav-item', { hasText: PRESET_CASES[0].title }).first().click();
    await expect(page.locator('h1')).toContainText(PRESET_CASES[0].title);
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

  test('reduced motion removes the pop without removing the highlight', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const target = await openPreset(page, PRESET_CASES[0]);
    await target.locator('[data-act="next"]').click();
    await expect(target.locator('.viz-cell.is-active')).toHaveCount(1);
    await expect(target.locator('.dr-pop')).toHaveCount(0);
  });

  test('row 22\'s array primitive is untouched on a guide no preset claims', async ({ page }) => {
    await openGuide(page);
    await page.addScriptTag({ type: 'module', url: '/dryrun/render.js' });

    // Three players, still row 22's, none carrying a preset.
    await expect(page.locator(player)).toHaveCount(3);
    await expect(page.locator(`${player}[data-preset]`)).toHaveCount(0);
    expect(await page.locator('[data-preset-stage]').count()).toBe(0);

    // And the array still animates exactly as row 22's spec asserts.
    const l2 = page.locator(`${player}[data-level="2"]`);
    await l2.locator('[data-act="next"]').click();
    await expect(l2.locator('[data-count]')).toHaveText('2 / 4');
    expect(await cells(l2)).toEqual(['1', '2', '0', '0']);
  });

  test('a guide with nothing to animate is still left alone', async ({ page }) => {
    await page.goto('/#05-hashmap_06-two-sum');
    await expect(page.locator('h1')).toContainText('Two Sum');
    await page.addScriptTag({ type: 'module', url: '/dryrun/render.js' });
    await expect(page.locator('table[data-dryrun="skipped"]')).toHaveCount(3);
    await expect(page.locator(player)).toHaveCount(0);
  });

  test('the presets add no global', async ({ page }) => {
    await openPreset(page, PRESET_CASES[1]);
    const leaked = await page.evaluate(() =>
      Object.keys(window).filter((k) => /^dryrun|^DryRun|^dr[A-Z]/.test(k)),
    );
    expect(leaked).toEqual([]);
  });

  test('switching guides in the sidebar replaces the preset, it does not stack', async ({ page }) => {
    await openPreset(page, PRESET_CASES[0]);
    await page.locator(`${player}[data-preset="stack"][data-level="2"] [data-act="next"]`).click();

    // Navigate the way a reader navigates: the sidebar, not a hash the portal ignores.
    if (page.viewportSize().width < 768) await page.locator('#menuBtn').click();
    await page.locator('#curriculumNav .nav-item', { hasText: 'Spiral Matrix' }).first().click();
    await expect(page.locator('h1')).toContainText('Spiral Matrix');
    // The stack players are gone with the previous article, and the new guide has exactly the
    // one its own tables claim — no leftover stage from the guide before it.
    await expect(page.locator(`${player}[data-preset="stack"]`)).toHaveCount(0);
    await expect(page.locator(`${player}[data-preset="matrix"]`)).toHaveCount(1);
  });
});

test.describe('preset screenshots', () => {
  for (const row of PRESET_CASES) {
    test(`${row.preset} on ${row.title}`, async ({ page }, testInfo) => {
      const target = await openPreset(page, row);
      // Step to a frame where something has actually happened, so the shot is not the
      // blank state every preset draws first.
      await target.locator('[data-act="next"]').click();
      await expect(target.locator('[data-count]')).not.toHaveText(/^1 \//);

      // The preset's own box, to a stable path so the evidence can be cited by name.
      const stage = await target.locator('[data-preset-stage]').screenshot();
      await target.locator('[data-preset-stage]').screenshot({ path: `scratch/row23/${row.preset}-${testInfo.project.name}.png` });
      expect(stage.byteLength).toBeGreaterThan(2000); // not a blank crop

      // And the table above it, which is the unit a reader actually reads.
      await testInfo.attach(`${row.preset}-${testInfo.project.name}`, {
        body: await target.locator('xpath=preceding-sibling::*[1]').screenshot(),
        contentType: 'image/png',
      });
    });
  }
});

/* ------------------------------------------------------------------ *
 * Row 24 — Tier 2: the canonical level only, plus the two overlays
 * ------------------------------------------------------------------ */

/**
 * The four Tier-2 presets and the two overlays, each on the guide whose `catalog/problems.json`
 * entry names its shape — not on the module directory:
 *
 *   graph            19-graph-bfs/03-word-ladder        codec graph, patterns Graph BFS|Implicit Word Graph
 *   tree             10-binary-tree-bfs/04-zigzag-…     codec tree,  patterns Binary Tree BFS|Alternating Direction
 *   statecard        01-array-string/12-insert-delete-… codec ops,   patterns Array|Hash Table|Design
 *   linkedlist       08-linked-list/05-reverse-linked-…  codec list,  patterns Linked List|Segment Reversal
 *   dp-table         17-multi-dp/03-unique-paths-ii     overlay, Multidimensional DP|Obstacle-Aware Counting
 *   recursion-tree   09-binary-tree-general/03-invert-… codec tree,  patterns Binary Tree|Mirror Swap
 *
 * `level` is `'3'` for every row and that is the point: plan §9 decision 2 says Tier 1 animates
 * all three levels and Tier 2 animates the canonical level only, so each case asserts the player
 * it found carries `data-level="3"` and that its L1 and L2 tables carry no Tier-2 player at all.
 */
const TIER2_CASES = [
  { preset: 'graph', id: '19-graph-bfs_03-word-ladder', title: 'Word Ladder', level: '3' },
  { preset: 'tree', id: '10-binary-tree-bfs_04-zigzag-level-order', title: 'Binary Tree Zigzag Level Order', level: '3' },
  { preset: 'statecard', id: '01-array-string_12-insert-delete-getrandom-o1', title: 'Insert Delete GetRandom', level: '3' },
  { preset: 'linkedlist', id: '08-linked-list_05-reverse-linked-list-ii', title: 'Reverse Linked List II', level: '3' },
];

const OVERLAY_CASES = [
  { overlay: 'dp-table', id: '17-multi-dp_03-unique-paths-ii', title: 'Unique Paths II' },
  { overlay: 'recursion-tree', id: '09-binary-tree-general_03-invert-binary-tree', title: 'Invert Binary Tree' },
];

/** Open a Tier-2 guide, load the module, and wait for the level-3 player of that name. */
async function openTier2(page, row) {
  await page.goto(`/#${row.id}`);
  await expect(page.locator('h1')).toContainText(row.title);
  await page.addScriptTag({ type: 'module', url: '/dryrun/render.js' });
  const target = page.locator(`${player}[data-preset="${row.preset}"][data-level="3"]`);
  await expect(target).toBeVisible();
  return target;
}

/** Open a guide whose L3 table carries only an overlay, and wait for that panel. */
async function openOverlay(page, row) {
  await page.goto(`/#${row.id}`);
  await expect(page.locator('h1')).toContainText(row.title);
  await page.addScriptTag({ type: 'module', url: '/dryrun/render.js' });
  const target = page.locator(`${player}[data-level="3"][data-overlays~="${row.overlay}"]`);
  await expect(target).toBeVisible();
  return target;
}

test.describe('dry-run Tier 2 (row 24)', () => {
  for (const row of TIER2_CASES) {
    test(`${row.preset}: mounts on the canonical level of ${row.title}, and steps`, async ({ page }) => {
      const target = await openTier2(page, row);
      expect(await target.getAttribute('data-steps')).toMatch(/^\d$/);
      await expect(target.locator('[data-count]')).toHaveText(/^1 \/ \d+$/);
      await expect(target.locator('xpath=preceding-sibling::*[1]')).toHaveClass(/table-scroll/);

      const before = await signature(target);
      await target.locator('[data-act="next"]').click();
      await expect(target.locator('[data-count]')).not.toHaveText(/^1 \//);
      expect(await signature(target)).not.toBe(before);
      await target.locator('[data-act="prev"]').click();
      await expect(target.locator('[data-count]')).toHaveText(/^1 \//);
      expect(await signature(target)).toBe(before);
    });
  }

  test('plan decision 2: Tier 2 mounts on the canonical level ONLY', async ({ page }) => {
    // word-ladder has three dry-run tables. Tier 2 claims the L3 one and nothing else — a
    // Tier-2 player on L1 or L2 would either be dead UI or a constraint the reader did not ask
    // for, and this is the assertion that says which.
    await page.goto('/#19-graph-bfs_03-word-ladder');
    await expect(page.locator('h1')).toContainText('Word Ladder');
    await page.addScriptTag({ type: 'module', url: '/dryrun/render.js' });

    const tiers = await page.locator(player).evaluateAll((nodes) => nodes.map((n) => n.dataset.level));
    expect(tiers.filter((level) => level === '3').length).toBe(1);
    await expect(page.locator(`${player}[data-preset="graph"]`)).toHaveCount(1);
    await expect(page.locator(`${player}[data-preset="graph"]`)).toHaveAttribute('data-level', '3');
  });

  test('graph: nodes, edges, and the components the guide never joins', async ({ page }) => {
    const target = await openTier2(page, TIER2_CASES[0]);

    // Step 4 is the frame the guide's own edges leave in two pieces: hit—hot—{dot,lot} and
    // cog—{dog,log}. One node per SVG <g>, one line per edge, and the count says 2.
    await target.locator('.dr-range').fill('3');
    expect(await target.locator('[data-preset-stage="graph"] [data-node]').allTextContents())
      .toEqual(['cog', 'dog', 'dot', 'hit', 'hot', 'log', 'lot']);
    await expect(target.locator('[data-preset-stage="graph"] line')).toHaveCount(5);
    await expect(target.locator('[data-preset-stage="graph"] .viz-row')).toContainText('2 components');

    // The node the guide says reached the target is marked, and it is the only one.
    await expect(target.locator('[data-terminal]')).toHaveCount(1);
    await expect(target.locator('[data-terminal]')).toHaveText('dot');
  });

  test('tree: parent/child edges, drawn — a flat list would have none', async ({ page }) => {
    const target = await openTier2(page, TIER2_CASES[1]);

    // Level 1 is [20, 9] as the guide authored it, so the edge count is the tell: 3 nodes
    // joined by 2 edges is a list, 4 edges is a tree.
    await target.locator('.dr-range').fill('2');
    expect(await target.locator('[data-preset-stage="tree"] [data-node]').allTextContents())
      .toEqual(['3', '20', '9', '15', '7']);
    await expect(target.locator('[data-preset-stage="tree"] line')).toHaveCount(4);
    await expect(target.locator('[data-preset-stage="tree"] .viz-row')).toContainText('3 levels');

    // Step 2 is `out = [[3],[20,9]]`: 3 nodes and 2 edges. A flat list of the same three values
    // would have 0 edges, which is the difference this assertion is here to catch.
    await target.locator('.dr-range').fill('1');
    expect(await target.locator('[data-preset-stage="tree"] [data-node]').allTextContents())
      .toEqual(['3', '20', '9']);
    await expect(target.locator('[data-preset-stage="tree"] line')).toHaveCount(2);
    await expect(target.locator('[data-preset-stage="tree"] .viz-row')).toContainText('2 levels');
  });

  test('statecard: the field-state after each op, and the op\'s own output', async ({ page }) => {
    const target = await openTier2(page, TIER2_CASES[2]);

    // Two state fields, both written by the first op — this is `ops` shape, not an array.
    await expect(target.locator('[data-preset-stage="statecard"] [data-field]')).toHaveCount(2);
    expect(await target.locator('[data-preset-stage="statecard"] [data-field]').allTextContents())
      .toEqual(['[10]', '{ 10 => 0 }']);
    await expect(target.locator('[data-preset-stage="statecard"] .viz-row')).toContainText('insert(10)');

    // Three ops later the map field has changed twice: the swap is the state transition, not
    // just the final answer.
    await target.locator('.dr-range').fill('3');
    expect(await target.locator('[data-preset-stage="statecard"] [data-field]').allTextContents())
      .toEqual(['[10, 30]', '{ 10 => 0, 30 => 1 }']);

    // `getRandom()` emits, and the emission is its own element.
    await target.locator('.dr-range').fill('4');
    await expect(target.locator('[data-output]')).toHaveCount(1);
    await expect(target.locator('[data-output]')).toContainText('Yields 10 or 30');
    await expect(target.locator('[data-field][data-source="carried"]')).toHaveCount(1);
  });

  test('linkedlist: a chain, and a null that ends it visibly', async ({ page }) => {
    const target = await openTier2(page, TIER2_CASES[3]);

    // reverse-linked-list-ii L3 step 2 is `2 -> null`: one node and a terminator box.
    await target.locator('.dr-range').fill('1');
    expect(await target.locator('[data-preset-stage="linkedlist"] .viz-cell').allTextContents()).toEqual(['2', '∅']);
    await expect(target.locator('[data-terminator]')).toHaveText('∅');
    await expect(target.locator('[data-preset-stage="linkedlist"] .viz-row')).toContainText('next = null');

    // Step 3 is `3 -> 2` — the terminator is gone because the chain grew past it, which is
    // exactly what `next = null` means.
    await target.locator('.dr-range').fill('2');
    expect(await target.locator('[data-preset-stage="linkedlist"] .viz-cell').allTextContents()).toEqual(['3', '2']);
    await expect(target.locator('[data-terminator]')).toHaveCount(0);
    await expect(target.locator('[data-preset-stage="linkedlist"] .viz-row')).toContainText('push');
  });

  test('dp-table overlay: the grid filling, with the current cell marked', async ({ page }) => {
    const target = await openOverlay(page, OVERLAY_CASES[0]);

    // unique-paths-ii L3 writes [1,1,1], then [1,0,1] (the wall), then dp[2] = 2.
    expect(await target.locator('[data-overlay="dp-table"] .viz-cell').allTextContents()).toEqual(['1', '1', '1']);
    await expect(target.locator('[data-overlay="dp-table"] [data-cursor]')).toHaveText('1');

    await target.locator('.dr-range').fill('1');
    expect(await target.locator('[data-overlay="dp-table"] .viz-cell').allTextContents()).toEqual(['1', '0', '1']);
    await expect(target.locator('[data-overlay="dp-table"] [data-cursor]')).toHaveText('0');
    await expect(target.locator('[data-overlay="dp-table"] .viz-row')).toContainText('dp[1]');
  });

  test('recursion-tree overlay: depth, and where the base case is hit', async ({ page }) => {
    const target = await openOverlay(page, OVERLAY_CASES[1]);

    // invert-binary-tree L3: invert(4) at depth 0, invert(7) at depth 1 and a leaf.
    await target.locator('.dr-range').fill('1');
    expect(await target.locator('[data-overlay="recursion-tree"] [data-call]').allTextContents())
      .toEqual(['invert(4)', 'invert(7)']);
    await expect(target.locator('[data-overlay="recursion-tree"] .viz-row')).toContainText('depth 1');
    await expect(target.locator('[data-base]')).toHaveCount(1);
    await expect(target.locator('[data-base]')).toHaveText('base case');
    await expect(target.locator('[data-overlay="recursion-tree"] .viz-row')).toContainText('base case hit');
  });

  test('an overlay needs a transport, so an overlay-only table still gets a player', async ({ page }) => {
    const target = await openOverlay(page, OVERLAY_CASES[0]);
    await expect(target.locator('.dr-bar')).toHaveCount(1);
    await expect(target.locator('.dr-btn')).toHaveCount(3);
    // Nothing claimed the table as a preset, so there is no preset stage — the panel IS the
    // stage, and it still follows the scrubber.
    await expect(target.locator(`${player}[data-preset]`)).toHaveCount(0);
  });

  test('the overlays ride on a preset without taking the table from it', async ({ page }) => {
    // 01-array-string/12-insert-delete-getrandom-o1 L3 is a statecard AND a call spine: every
    // row names an op, so recursion-tree rides along without taking the preset away.
    await openTier2(page, TIER2_CASES[2]);
    const both = page.locator(`${player}[data-preset="statecard"][data-overlays~="recursion-tree"]`);
    await expect(both).toHaveCount(1);
    await expect(both.locator('[data-preset-stage="statecard"]')).toHaveCount(1);
    await expect(both.locator('[data-overlay="recursion-tree"]')).toHaveCount(1);
    // One transport between them, not two: three buttons, one scrubber.
    await expect(both.locator('.dr-bar')).toHaveCount(1);
    await expect(both.locator('.dr-range')).toHaveCount(1);
    // And the two panels follow the same step.
    // Four independent `insert`s are four sibling calls, not a four-deep recursion, so the
    // spine holds one frame and it follows the scrubber to the op of this step.
    await both.locator('.dr-range').fill('3');
    expect(await both.locator('[data-overlay="recursion-tree"] [data-call]').allTextContents())
      .toEqual(['remove(20)']);
  });

  test('reduced motion removes the pop without removing the highlight', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const target = await openTier2(page, TIER2_CASES[3]);
    await target.locator('[data-act="next"]').click();
    await target.locator('.dr-range').fill('2');
    await expect(target.locator('.viz-cell[data-node].is-active')).toHaveCount(1);
    await expect(target.locator('.dr-pop')).toHaveCount(0);
  });

  test('Tier 1 is untouched: row 22 still owns all three levels on a Tier-2-free guide', async ({ page }) => {
    await openGuide(page);
    await page.addScriptTag({ type: 'module', url: '/dryrun/render.js' });
    await expect(page.locator(player)).toHaveCount(3);
    await expect(page.locator(`${player}[data-preset]`)).toHaveCount(0);
    await expect(page.locator('[data-preset-stage]')).toHaveCount(0);
    const l2 = page.locator(`${player}[data-level="2"]`);
    await l2.locator('[data-act="next"]').click();
    expect(await cells(l2)).toEqual(['1', '2', '0', '0']);
  });

  test('the Tier-2 module adds no global', async ({ page }) => {
    await openTier2(page, TIER2_CASES[0]);
    const leaked = await page.evaluate(() => Object.keys(window).filter((k) => /^dryrun|^DryRun|^dr[A-Z]/.test(k)));
    expect(leaked).toEqual([]);
  });
});

test.describe('Tier 2 screenshots', () => {
  for (const row of [...TIER2_CASES.map((r) => ({ ...r, kind: 'preset' })), ...OVERLAY_CASES.map((r) => ({ ...r, kind: 'overlay' }))]) {
    test(`${row.kind} ${row.preset || row.overlay} on ${row.title}`, async ({ page }, testInfo) => {
      const target = row.kind === 'preset' ? await openTier2(page, row) : await openOverlay(page, row);
      const selector = `[data-preset-stage="${row.preset || row.overlay}"]`;
      await target.locator('.dr-range').fill(String(Number(await target.getAttribute('data-steps')) - 1));
      await expect(target.locator('[data-count]')).not.toHaveText(/^1 \//);

      const stage = await target.locator(selector).screenshot();
      await target.locator(selector).screenshot({
        path: `scratch/row24/${row.preset || row.overlay}-${testInfo.project.name}.png`,
      });
      expect(stage.byteLength).toBeGreaterThan(1500);
      await testInfo.attach(`${row.preset || row.overlay}-${testInfo.project.name}`, {
        body: await target.locator('xpath=preceding-sibling::*[1]').screenshot(),
        contentType: 'image/png',
      });
    });
  }
});
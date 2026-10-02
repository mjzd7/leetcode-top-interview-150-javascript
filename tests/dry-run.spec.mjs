/**
 * Row 22 E2E: the `array` primitive on a real guide page, at both configured viewports.
 *
 * `playwright.config.mjs` builds docs/ and serves it statically first, because
 * docs/curriculum-data.js is gitignored. The `desktop` project (1440x900) and the
 * `Pixel 7` project both run this file, so one assertion set is the responsive
 * evidence — there is deliberately no per-viewport branch in here.
 *
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
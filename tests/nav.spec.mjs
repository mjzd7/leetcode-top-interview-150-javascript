import { test, expect } from '@playwright/test';

/**
 * Navigation invariants for the sidebar and the prev/next pair. Two separate
 * concerns live here because they are the two ways a reader gets lost:
 *   - "where am I" (the collapsed rail must identify its 28 destinations)
 *   - "how do I move" (prev/next must chain every guide, primers included)
 */

const PRIMER_03 = '00-foundations_03-core-algorithmic-patterns';
const PRIMER_04 = '00-foundations_04-how-to-explain-complexity-to-interviewers';
// "25. Reverse Nodes in k-Group" — chosen because its slug says 06 and its
// title number says 25, so a test can tell the two apart.
const PROBLEM_01 = '08-linked-list_06-reverse-nodes-in-k-group';

const open = async (page, id) => {
  await page.goto('/#' + id);
  await page.waitForSelector('#curriculumNav .nav-item', { state: 'attached' });
  await page.waitForTimeout(400);
};

const collapseToRail = async (page) => {
  await page.click('#ltNavCollapse');
  await page.click('#ltNavCollapse');
  await page.waitForTimeout(250);
};

test.describe('prev / next', () => {
  test('chains through the primers instead of skipping to a MAANG guide', async ({ page }) => {
    await open(page, PRIMER_03);
    const next = await page.evaluate(() =>
      document.querySelector('#prevNext [data-nav]:last-of-type')?.dataset.nav);
    expect(next, 'primer 03 hands off to primer 04, not past the foundations').toBe(PRIMER_04);
  });

  test('offers no Prev on the very first guide', async ({ page }) => {
    await open(page, '00-foundations_01-js-interview-runtime-quirks');
    const prev = await page.evaluate(() => {
      const b = [...document.querySelectorAll('#prevNext [data-nav]')]
        .find(x => x.textContent.includes('Prev'));
      return b ? b.dataset.nav : null;
    });
    expect(prev, 'nothing before the first guide').toBeNull();
  });

  test('is reachable without scrolling to the end of a long guide', async ({ page }) => {
    await open(page, '08-linked-list_06-reverse-nodes-in-k-group');
    await page.evaluate(() => { document.getElementById('contentContainer').scrollTop = 0; });
    await page.waitForTimeout(300);
    const atTop = await page.evaluate(() => {
      const b = document.querySelector('#prevNext [data-nav]').getBoundingClientRect();
      return b.top < innerHeight && b.bottom > 0;
    });
    expect(atTop, 'a nav control is on screen at the top of the article').toBe(true);

    await page.evaluate(() => { document.getElementById('contentContainer').scrollTop = 99999; });
    await page.waitForTimeout(300);
    const atEnd = await page.evaluate(() => {
      const b = document.querySelector('#prevNext [data-nav]').getBoundingClientRect();
      return b.top < innerHeight && b.bottom > 0;
    });
    expect(atEnd, 'and still on screen at the end').toBe(true);
  });

  test('follows a pasted guide URL into an already-open portal', async ({ page }) => {
    await open(page, PROBLEM_01);
    await page.evaluate((id) => { window.location.hash = '#' + id; }, PRIMER_04);
    await page.waitForTimeout(700);
    const crumb = await page.evaluate(() => document.getElementById('crumbRow').textContent.trim());
    expect(crumb, 'changing the hash actually navigates').toContain('FOUNDATIONS');
  });
});

test.describe('the collapsed rail', () => {
  // Below 768px the sidebar is an off-canvas drawer and #ltNavCollapse is
  // display:none, so there is no rail to collapse. These invariants are about
  // the 56px rail and have no meaning without it.
  test.skip(({ viewport }) => viewport.width < 768, 'no icon rail below md');

  test.beforeEach(async ({ page }) => {
    await open(page, PROBLEM_01);
    await collapseToRail(page);
  });

  test('offers exactly one icon per category and no dead gaps', async ({ page }) => {
    const r = await page.evaluate(() => {
      const nav = document.getElementById('curriculumNav');
      const btns = [...nav.querySelectorAll('.nav-cat-btn')];
      const groups = [...nav.querySelectorAll('.nav-group')];
      return {
        icons: btns.length,
        categories: new Set(btns.map(i => i.dataset.cat)).size,
        drawn: btns.filter(b => b.querySelector('svg')).length,
        visible: btns.filter(b => b.offsetParent !== null).length,
        // a group that contributes no height is the dead-void bug
        deadGroups: groups.filter(g => g.getBoundingClientRect().height < 8).length,
        // nothing may spill outside the 56px rail
        spill: groups.flatMap(g => [...g.querySelectorAll('button, svg')])
          .filter(e => {
            const gr = e.closest('.nav-group').getBoundingClientRect();
            const b = e.getBoundingClientRect();
            return b.width > 0 && (b.right > gr.right + 1 || b.left < gr.left - 1);
          }).length,
      };
    });
    expect(r.categories, 'one icon per category, not per guide').toBe(28);
    expect(r.icons, 'each category renders exactly one icon button').toBe(28);
    expect(r.drawn, 'and every one actually draws a glyph').toBe(28);
    expect(r.visible, 'all 28 are visible in category mode').toBe(28);
    expect(r.deadGroups, 'no group collapses to a dead void').toBe(0);
    expect(r.spill, 'nothing hangs outside the 56px rail').toBe(0);
  });

  test('shows the guide number in number mode, and every one is unique', async ({ page }) => {
    const codes = await page.evaluate(() => {
      const nav = document.getElementById('curriculumNav');
      const mode = document.getElementById('sidebar').dataset.railMode;
      return { mode, codes: [...nav.querySelectorAll('.nav-code')].map(e => e.textContent.trim()) };
    });
    expect(codes.mode, 'starts in category mode').toBe('cat');
    await page.keyboard.press('Alt+KeyV');
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => {
      const nav = document.getElementById('curriculumNav');
      return {
        mode: document.getElementById('sidebar').dataset.railMode,
        codes: [...nav.querySelectorAll('.nav-code')].map(e => e.textContent.trim()),
      };
    });
    expect(after.mode, 'the toggle switches to number mode').toBe('num');
    // Counted from the data, not hardcoded: the corpus grows, and a pinned
    // number turns the next guide that lands into a false failure here.
    const corpus = await page.evaluate(() =>
      window.CURRICULUM_DATA.reduce((n, c) => n + c.items.length, 0));
    expect(after.codes.length, 'one code per guide').toBe(corpus);
    const seen = new Map();
    for (const c of after.codes) seen.set(c, (seen.get(c) || 0) + 1);
    const dupes = [...seen].filter(([, n]) => n > 1);
    expect(dupes, `codes must be unambiguous, got collisions: ${JSON.stringify(dupes)}`).toEqual([]);
    expect(Math.max(...after.codes.map(c => c.length)), 'a code fits the 56px rail').toBeLessThanOrEqual(3);
  });

  test('remembers the chosen mode across a reload', async ({ page }) => {
    await page.keyboard.press('Alt+KeyV');
    await page.waitForTimeout(250);
    expect(await page.evaluate(() => document.getElementById('sidebar').dataset.railMode)).toBe('num');
    await page.reload();
    await page.waitForSelector('#curriculumNav .nav-item', { state: 'attached' });
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => document.getElementById('sidebar').dataset.railMode))
      .toBe('num');
  });

  test('names every destination for assistive tech without using title', async ({ page }) => {
    const r = await page.evaluate(() => {
      const items = [...document.querySelectorAll('#curriculumNav button[data-guide-id], #curriculumNav .nav-item')];
      return {
        total: items.length,
        withTitle: items.filter(b => b.hasAttribute('title')).length,
        named: items.filter(b => {
          const sr = b.querySelector('.sr-only, .ltc-sr-only');
          return (sr && sr.textContent.trim().length > 0) || b.getAttribute('aria-label');
        }).length,
      };
    });
    expect(r.total, 'there are destinations to name').toBeGreaterThan(0);
    expect(r.withTitle, 'title is announced inconsistently and absent on touch').toBe(0);
    expect(r.named, 'every collapsed destination still has an accessible name').toBe(r.total);
  });

  test('makes the current guide findable in a 56px rail', async ({ page }) => {
    const active = await page.evaluate(() => {
      const el = document.querySelector('#curriculumNav .nav-item[aria-current="page"], #curriculumNav [data-active="true"]');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, shadow: cs.boxShadow, marked: el.dataset.active === 'true' || el.getAttribute('aria-current') === 'page' };
    });
    expect(active, 'the active guide is marked, not just tinted').not.toBeNull();
    expect(active.marked, 'active state survives the collapse').toBe(true);
    const [r, g, b] = (active.bg.match(/[\d.]+/g) || []).map(Number);
    // the fill has to be visible against #0B0D12, not rgba(200,250,75,.1)
    expect(r + g + b, 'active fill is more than a 10% tint').toBeGreaterThan(40);
    expect(active.shadow, 'and carries an accent bar').toContain('rgb');
  });

  test('a category glyph opens the rail onto that category, not just any guide', async ({ page }) => {
  await page.locator('.nav-cat-btn[data-cat="MATRIX"]').click();
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => {
    const nav = document.getElementById('curriculumNav');
    const box = nav.getBoundingClientRect();
    const group = [...nav.querySelectorAll('.nav-group')]
      .find(g => g.querySelector('.nav-cat-btn')?.dataset.cat === 'MATRIX');
    const g = group.getBoundingClientRect();
    const onScreen = [...nav.querySelectorAll('.nav-item')].filter(b => {
      const q = b.getBoundingClientRect();
      return q.bottom > box.top + 4 && q.top < box.bottom - 4;
    }).map(b => b.textContent.trim());
    return {
      stage: document.getElementById('sidebar').dataset.stage,
      railW: Math.round(document.getElementById('sidebar').getBoundingClientRect().width),
      groupAtTop: Math.abs(g.top - box.top) < 12,
      firstOnScreen: onScreen[0] || '',
    };
  });
  expect(r.stage, 'the rail widens so the guides are readable').toBe('0');
  expect(r.railW, 'back to the full 320px').toBe(320);
  expect(r.groupAtTop, 'the clicked category is scrolled to the top of the list').toBe(true);
  // the guide under the cursor afterwards must belong to MATRIX, which is what
  // "36. Valid Sudoku" is. Anything else means it scrolled to the wrong place.
  expect(r.firstOnScreen, 'the first guide on screen belongs to the clicked category')
    .toMatch(/Valid Sudoku|Set Matrix|Spiral Matrix|Rotate Image|Game of Life/);
});

test('marks the open guide in BOTH rail modes', async ({ page }) => {
  // Category mode: the guide list is hidden, so the category glyph has to carry
  // the marker or the rail stops saying where you are.
  const cat = await page.evaluate(() => {
    const cur = document.querySelector('.nav-cat-btn[data-current="true"]');
    const cs = cur && getComputedStyle(cur);
    return cur ? { cat: cur.dataset.cat, bg: cs.backgroundColor, border: cs.borderColor } : null;
  });
  expect(cat, 'the category holding the open guide is marked in category mode').not.toBeNull();
  expect(cat.bg, 'and it is filled, not a 10% tint').not.toBe('rgba(0, 0, 0, 0)');

  await page.keyboard.press('Alt+KeyV');
  await page.waitForTimeout(300);
  const num = await page.evaluate(() => {
    const el = document.querySelector('.nav-item[aria-current="page"]');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { visible: el.offsetParent !== null, bg: cs.backgroundColor, shadow: cs.boxShadow, code: el.querySelector('.nav-code')?.textContent };
  });
  expect(num, 'the guide itself is marked in number mode').not.toBeNull();
  expect(num.visible, 'and it is actually on screen there').toBe(true);
  expect(num.code, 'showing the number the reader recognises').toBe('25');
});

test('scrolls the rail with the wheel while collapsed', async ({ page }) => {
  const before = await page.evaluate(() => document.getElementById('curriculumNav').scrollTop);
  await page.mouse.move(28, 500);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    nav: document.getElementById('curriculumNav').scrollTop,
    page: scrollY,
  }));
  expect(after.nav, 'the rail scrolls under the pointer').toBeGreaterThan(before);
  expect(after.page, 'and the page behind it does not').toBe(0);
});

test('never leaves a blank half-width cell where a neighbour is missing', async ({ page }) => {
  // The bar is a 2-column grid. Where there is no previous guide it used to
  // render an empty <span>, which still occupied half the row — a visible hole
  // on the home page and at either end of the curriculum.
  await page.goto('/');
  await page.waitForSelector('#curriculumNav .nav-item', { state: 'attached' });
  await page.waitForTimeout(600);

  const home = await page.evaluate(() => {
    const bar = document.getElementById('prevNext');
    const kids = [...bar.children];
    return {
      cells: kids.length,
      // a placeholder is any child that is not itself a destination button —
      // not "a child containing a button", since a button contains no button
      blanks: kids.filter(k => k.tagName !== 'BUTTON').length,
      width: Math.round(bar.getBoundingClientRect().width),
      cols: getComputedStyle(bar).gridTemplateColumns,
    };
  });
  expect(home.blanks, 'no empty cell on the home page').toBe(0);
  expect(home.cells, 'and the lone Next is there').toBe(1);
  expect(home.cols.split(' ').length, 'a lone Next spans the full row, not half').toBe(1);
});

test('the bar collapses to one column when only one neighbour exists', async ({ page }) => {
  await open(page, '00-foundations_01-js-interview-runtime-quirks'); // the very first guide
  const r = await page.evaluate(() => {
    const bar = document.getElementById('prevNext');
    const kids = [...bar.children];
    return {
      cells: kids.length,
      blanks: kids.filter(k => k.tagName !== 'BUTTON').length,
      cols: getComputedStyle(bar).gridTemplateColumns.split(' ').length,
      label: kids[0]?.textContent.trim().slice(0, 20),
    };
  });
  expect(r.blanks, 'no placeholder where Prev does not exist').toBe(0);
  expect(r.cells, 'just the Next cell').toBe(1);
  expect(r.cols, 'and it is full width').toBe(1);
  expect(r.label, 'which is the next guide').toMatch(/Next/);
});

test('reveals a label on hover and on keyboard focus', async ({ page }) => {
  // One tooltip parked on <body>: the nav is the scroll container, and
  // overflow-y:auto clips overflow-x too, so a tooltip nested inside it never
  // paints outside the 56px rail. Asserted by real geometry, not by class.
  const tipOf = () => page.evaluate(() => {
    const t = document.querySelector('body > .nav-tip');
    if (!t) return null;
    const r = t.getBoundingClientRect();
    const cs = getComputedStyle(t);
    return {
      shown: t.classList.contains('is-shown'), vis: cs.visibility,
      text: t.textContent.trim(), left: Math.round(r.left), right: Math.round(r.right),
      pe: cs.pointerEvents, w: Math.round(r.width),
    };
  });

  expect(await tipOf(), 'a tooltip is mounted on the body').not.toBeNull();
  expect((await tipOf()).shown, 'hidden until something asks for it').toBe(false);

  const railRight = await page.evaluate(() =>
    document.getElementById('sidebar').getBoundingClientRect().right);
  const btn = page.locator('.nav-cat-btn[data-cat="TRIE"]');
  await btn.scrollIntoViewIfNeeded();
  await btn.hover();
  await page.waitForTimeout(300);
  const hovered = await tipOf();
  expect(hovered.shown, 'hovering a glyph reveals the label').toBe(true);
  expect(hovered.vis, 'and it is actually visible').toBe('visible');
  expect(hovered.text, 'the label is the destination name').toBe('TRIE');
  expect(hovered.left, 'it opens beside the rail, not clipped inside it')
    .toBeGreaterThanOrEqual(railRight);
  expect(hovered.right, 'and stays on screen').toBeLessThanOrEqual(1440);
  expect(hovered.pe, 'it never eats the click underneath').toBe('none');

  await page.mouse.move(0, 0);
  await page.waitForTimeout(250);
  expect((await tipOf()).shown, 'leaving hides it again').toBe(false);

  await btn.focus();
  await page.waitForTimeout(300);
  const focused = await tipOf();
  expect(focused.shown, 'keyboard focus reveals it too — hover is not the only way').toBe(true);
  expect(focused.text, 'with the same name').toBe('TRIE');
});

test('a long guide title wraps on two lines rather than running off screen', async ({ page }) => {
  await page.keyboard.press('Alt+KeyV'); // number mode shows the guide rows
  await page.waitForTimeout(300);
  const item = page.locator('#curriculumNav .nav-item[data-tip]').filter({ hasText: 'Runtime Quirks' }).first();
  await item.scrollIntoViewIfNeeded();
  await item.hover();
  await page.waitForTimeout(300);
  const t = await page.evaluate(() => {
    const el = document.querySelector('body > .nav-tip');
    const r = el.getBoundingClientRect();
    return { text: el.textContent.trim(), h: Math.round(r.height), right: Math.round(r.right), lines: Math.round(r.height / 16) };
  });
  expect(t.text.length, 'it really is a long title').toBeGreaterThan(30);
  expect(t.h, 'so it wrapped instead of truncating to one line').toBeGreaterThan(24);
  expect(t.right, 'and it is fully on screen').toBeLessThanOrEqual(1440);
});
});
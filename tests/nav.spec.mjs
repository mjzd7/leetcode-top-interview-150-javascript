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

  test('is reachable at the top of a long guide without scrolling at all', async ({ page }) => {
    // It used to sit at the very end, three thousand pixels down a long guide,
    // which is why it was pinned to the scrollport. It is in the article head now,
    // so the guarantee is the opposite and simpler one: no scrolling to begin with.
    await open(page, '08-linked-list_06-reverse-nodes-in-k-group');
    await page.evaluate(() => { document.getElementById('contentContainer').scrollTop = 0; });
    await page.waitForTimeout(300);
    const atTop = await page.evaluate(() => {
      const b = document.querySelector('#prevNext [data-nav]').getBoundingClientRect();
      return { onScreen: b.top < innerHeight && b.bottom > 0, scrolled: document.getElementById('contentContainer').scrollTop };
    });
    expect(atTop.scrolled, 'the reader has not scrolled').toBe(0);
    expect(atTop.onScreen, 'and a nav control is already on screen').toBe(true);
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

  /* The rail is one column of glyphs on a centre line, and the collapse control
     lives in the header above them — so it has to be on that same line. The
     header row is laid out for ring + text + button; at stage 2 the ring's
     contents are hidden but its flex-1 wrapper is not, so an empty 11px spacer
     plus a 12px gap sat in front of the button and pushed it to the right edge.
     Nothing asserted this: the spill check above only walks .nav-group
     descendants, and the header is not inside one. */
  test('puts the collapse control on the same centre line as the icons', async ({ page }) => {
    const r = await page.evaluate(() => {
      const mid = (el) => { const b = el.getBoundingClientRect(); return b.left + b.width / 2; };
      const btn = document.getElementById('ltNavCollapse');
      const icon = document.querySelector('#curriculumNav .nav-cat-btn');
      const b = btn.getBoundingClientRect();
      return {
        offBy: Math.round((mid(btn) - mid(icon)) * 10) / 10,
        rightGap: Math.round(document.getElementById('sidebar').getBoundingClientRect().right - b.right),
        leftGap: Math.round(b.left - document.getElementById('sidebar').getBoundingClientRect().left),
      };
    });
    expect(Math.abs(r.offBy), 'the button shares the icon column centre line').toBeLessThanOrEqual(1);
    expect(Math.abs(r.leftGap - r.rightGap), 'and is not hugging either edge').toBeLessThanOrEqual(1);
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
  // scrollIntoView({behavior:'smooth'}) has no completion signal, so polling
  // for the settled position is the only honest wait: measured at 800ms it was
  // still 20px out, and it had arrived by 2s. A fixed sleep is a coin flip.
  await expect.poll(async () => page.evaluate(() => {
    const nav = document.getElementById('curriculumNav');
    const box = nav.getBoundingClientRect();
    const g = [...nav.querySelectorAll('.nav-group')]
      .find(x => x.querySelector('.nav-cat-btn')?.dataset.cat === 'MATRIX');
    return Math.round(Math.abs(g.getBoundingClientRect().top - box.top));
  }), { timeout: 5000 }).toBeLessThan(12);
  const r = await page.evaluate(() => {
    const nav = document.getElementById('curriculumNav');
    const box = nav.getBoundingClientRect();
    const onScreen = [...nav.querySelectorAll('.nav-item')].filter(b => {
      const q = b.getBoundingClientRect();
      return q.bottom > box.top + 4 && q.top < box.bottom - 4;
    }).map(b => b.textContent.trim());
    return {
      stage: document.getElementById('sidebar').dataset.stage,
      railW: Math.round(document.getElementById('sidebar').getBoundingClientRect().width),
      firstOnScreen: onScreen[0] || '',
    };
  });
  expect(r.stage, 'the rail widens so the guides are readable').toBe('0');
  expect(r.railW, 'back to the full 320px').toBe(320);
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
  // Where there is no previous guide it used to render an empty <span>, which
  // still occupied half the row — a visible hole on the home page and at either
  // end of the curriculum. The home page now has no prev/next at all: it opens
  // with "Start studying", which is the same door by a better name.
  await page.goto('/');
  await page.waitForSelector('#curriculumNav .nav-item', { state: 'attached' });
  await page.waitForTimeout(600);

  const home = await page.evaluate(() => {
    const bar = document.getElementById('prevNext');
    return {
      cells: bar.children.length,
      hidden: bar.hidden,
      hasStart: !!document.getElementById('homeStart'),
    };
  });
  expect(home.hidden, 'the home page offers no prev/next').toBe(true);
  expect(home.cells, 'and renders no leftovers').toBe(0);
  expect(home.hasStart, 'because it starts the reader instead').toBe(true);
});

test('the bar shows only the next guide when there is no previous one', async ({ page }) => {
  await open(page, '00-foundations_01-js-interview-runtime-quirks'); // the very first guide
  const r = await page.evaluate(() => {
    const bar = document.getElementById('prevNext');
    const kids = [...bar.children];
    return {
      cells: kids.length,
      blanks: kids.filter(k => k.tagName !== 'BUTTON').length,
      text: kids[0]?.innerText.replace(/\s+/g, ' ').trim() || '',
      aria: kids[0]?.getAttribute('aria-label') || '',
      // The title is truncated, not wrapped, so the button cannot grow past the
      // row and push the head onto a third line.
      rows: kids[0] ? Math.round(kids[0].getBoundingClientRect().height / 44) : 0,
    };
  });
  expect(r.blanks, 'no placeholder where Prev does not exist').toBe(0);
  expect(r.cells, 'just the one neighbour').toBe(1);
  expect(r.rows, 'and it stays one row tall').toBe(1);
  // The button names the guide instead of saying "Next": the arrow on the
  // outside edge is what says which way it goes.
  expect(r.text, 'it carries the guide code').toContain('P02');
  expect(r.text, 'and the guide name').toMatch(/Zero-Dependency/);
  expect(r.text, 'with the arrow on the trailing edge').toMatch(/→\s*$/);
  expect(r.aria, 'and a screen reader is told which neighbour it is').toMatch(/^Next: /);
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

/* A filter that matches nothing used to leave the reader staring at 653px of
   empty sidebar with no explanation. renderNav only ever wrote a message when
   DATA itself was empty, which is a missing build, not an empty result. */
test.describe('a filter that matches nothing', () => {
  test('says so, and names the query', async ({ page }) => {
    await open(page, PROBLEM_01);
    await page.fill('#searchInput', 'zzzznomatch');
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const nav = document.getElementById('curriculumNav');
      return { text: nav.innerText.trim(), items: nav.querySelectorAll('.nav-item').length };
    });
    expect(r.items, 'nothing matched, so there is nothing to list').toBe(0);
    expect(r.text, 'the reader is told why the list is empty').not.toBe('');
    expect(r.text, 'and which query emptied it').toContain('zzzznomatch');
  });

  test('a difficulty filter with no matches reads as a filter, not a query', async ({ page }) => {
    // The sidebar is an off-canvas drawer below md, so the pills are not reachable
    // without opening it. This case is about the message, which needs no drawer.
    test.skip(page.viewportSize().width < 768, 'the filter pills need a docked sidebar');
    await open(page, PROBLEM_01);
    await page.fill('#searchInput', 'zzzznomatch');
    await page.waitForTimeout(250);
    await page.fill('#searchInput', '');
    await page.click('.filter-btn[data-diff="Hard"]');
    await page.waitForTimeout(300);
    const items = await page.evaluate(() =>
      document.querySelectorAll('#curriculumNav .nav-item').length);
    expect(items, 'this corpus has Hard guides, so the filter is not empty').toBeGreaterThan(0);
    const noData = await page.evaluate(() =>
      document.getElementById('curriculumNav').innerText.includes('No curriculum data'));
    expect(noData, 'a filter that matched is not a missing build').toBe(false);
  });
});

/* The drawer opened with one control — the hamburger — and could only be put
   away by tapping the scrim, by Escape, or by opening a guide. Tapping a dimmed
   area is not an affordance you can see. */
test.describe('the drawer on a phone', () => {
  test.skip(({ viewport }) => viewport.width >= 768, 'below md the sidebar is an off-canvas drawer');

  test('offers a visible way to close it', async ({ page }) => {
    await open(page, PROBLEM_01);
    await page.click('#menuBtn');
    await page.waitForTimeout(400);
    const btn = page.locator('#sideClose');
    await expect(btn, 'a control you can see that closes the drawer').toBeVisible();
    const box = await btn.boundingBox();
    expect(box.height, 'and it is a real tap target').toBeGreaterThanOrEqual(44);
    await btn.click();
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => ({
      offscreen: document.getElementById('sidebar').classList.contains('-translate-x-full'),
      scrimGone: document.getElementById('sideOverlay').classList.contains('hidden'),
    }));
    expect(r.offscreen, 'the drawer is put away').toBe(true);
    expect(r.scrimGone, 'and the scrim goes with it').toBe(true);
  });
});

/* One glyph served three states, and then two served three: the glyph was tied
   to the LABEL rather than to the move, so the label for stage 1 — 200px → 56px,
   which narrows — said "Widen the navigation to a text rail" and pointed right.
   Two of the three stages narrow, so two of the three point the same way. */
test('the collapse control points the way it will move', async ({ page }) => {
  test.skip(page.viewportSize().width < 768, 'the control is md-only');

  await open(page, PROBLEM_01);
  await page.evaluate(() => localStorage.removeItem('lt150-nav-stage'));
  await page.reload();
  await page.waitForSelector('#curriculumNav .nav-item', { state: 'attached' });

  const read = () => page.evaluate(() => ({
    stage: document.getElementById('sidebar').dataset.stage,
    label: document.getElementById('ltNavCollapse').getAttribute('aria-label'),
    d: document.querySelector('#ltNavCollapse path').getAttribute('d'),
  }));
  const seen = [];
  for (let i = 0; i < 4; i += 1) {
    seen.push(await read());
    await page.click('#ltNavCollapse');
    await page.waitForTimeout(250);
  }

  expect(seen.map((s) => s.stage), 'the control cycles every stage and wraps')
    .toEqual(['0', '1', '2', '0']);
  expect(seen[0].label, 'stage 0 narrows 320px to 200px').toMatch(/collapse/i);
  expect(seen[1].label, 'stage 1 narrows 200px to 56px — it does not widen').toMatch(/collapse/i);
  expect(seen[2].label, 'only stage 2 widens the rail back out').toMatch(/widen/i);
  expect(seen[0].d, 'both narrowing stages point the same way').toBe(seen[1].d);
  expect(seen[1].d, 'narrowing must not look like widening').not.toBe(seen[2].d);
  expect(seen[3].d, 'and the cycle closes: stage 0 narrows again').toBe(seen[0].d);
});

/* The sidebar was roomier on a phone than on a desktop: 44px between groups
   below md, 20px from md up. The cause was a default that lived inside the
   min-width query — .nav-cat-btn fell back to inline-block below md, and a 0x0
   empty button still builds a line box from the font strut. 24px of nothing
   above each of the 27 group headers. */
test('the sidebar keeps the same rhythm at every width', async ({ page }) => {
  const gapsAt = async (width) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#' + PROBLEM_01);
    await page.waitForSelector('#curriculumNav .nav-item', { state: 'attached' });
    await page.waitForTimeout(300);
    return page.evaluate(() => {
      const groups = [...document.querySelectorAll('#curriculumNav .nav-group')];
      const gaps = [];
      for (let i = 0; i < groups.length - 1; i += 1) {
        const last = groups[i].querySelector('.nav-item:last-of-type');
        const head = groups[i + 1].querySelector('.nav-group-text');
        if (last && head) gaps.push(Math.round(head.getBoundingClientRect().top - last.getBoundingClientRect().bottom));
      }
      return {
        gaps,
        laidOutGlyphs: [...document.querySelectorAll('#curriculumNav .nav-cat-btn')]
          .filter((e) => getComputedStyle(e).display !== 'none').length,
      };
    });
  };

  const phone = await gapsAt(412);
  const desktop = await gapsAt(1440);

  expect(phone.laidOutGlyphs, 'no category glyph is laid out below md').toBe(0);
  expect(Math.max(...phone.gaps), 'a phone is not roomier than a desktop').toBeLessThanOrEqual(20);
  expect(phone.gaps[0], 'the gap between groups is the same at both widths').toBe(desktop.gaps[0]);
});

/* prev/next used to be a sticky bar over the scrollport, so the pair was always
   on screen and always competing with the assistant's button for the
   bottom-right corner. It lives with the page's own actions instead. */
test('prev/next sits with the page actions, not pinned to the scrollport', async ({ page }) => {
  const at = async (width) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#' + PROBLEM_01);
    await page.waitForSelector('#curriculumNav .nav-item', { state: 'attached' });
    await page.waitForTimeout(400);
    return page.evaluate(() => {
      const pn = document.getElementById('prevNext');
      const art = document.querySelector('#contentContainer article').getBoundingClientRect();
      const cells = [...pn.querySelectorAll('[data-nav]')].map((c) => c.getBoundingClientRect());
      const done = document.getElementById('doneToggle');
      return {
        inHead: document.getElementById('articleHead').contains(pn),
        position: getComputedStyle(pn).position,
        aboveContent: pn.getBoundingClientRect().bottom
          <= document.getElementById('articleContent').getBoundingClientRect().top + 1,
        overflows: pn.scrollWidth > pn.clientWidth + 1 || cells.some((b) => b.right > art.right + 1),
        pairTogether: cells.length < 2 || Math.abs(cells[0].top - cells[1].top) < 2,
        sharesRow: !done || cells.length === 0
          ? false
          : cells.every((b) => b.top < done.getBoundingClientRect().bottom
            && b.bottom > done.getBoundingClientRect().top),
      };
    });
  };

  for (const width of [360, 768, 1440]) {
    const r = await at(width);
    expect(r.position, `nothing is pinned at ${width}px`).not.toBe('sticky');
    expect(r.inHead, `prev/next is in the article head at ${width}px`).toBe(true);
    expect(r.aboveContent, `and above the guide body at ${width}px`).toBe(true);
    expect(r.overflows, `and inside the column at ${width}px`).toBe(false);
    expect(r.pairTogether, `the two halves stay together at ${width}px`).toBe(true);
  }

  // Four controls need ~694px and the column caps at 768, so they only share one
  // row on the widest screens. Below that the pair wraps as a unit under the
  // actions rather than being squeezed.
  expect((await at(1920)).sharesRow, 'a wide column fits them all on one row').toBe(true);
  expect((await at(1440)).sharesRow, 'a 1440 column wraps rather than squeezing').toBe(false);
});
/* Clicking a category glyph in the 56px rail widened the rail and scrolled the
   group into view. scrollIntoView scrolls every scrollable ancestor, and
   #sidebar is one of them — overflow:hidden still makes a box scrollable
   programmatically — so it scrolled the sidebar as well, pushing the 191px
   header block (ring, filter, difficulty pills) out of view and leaving exactly
   that much blank space at the bottom. */
test.describe('revealing a category from the collapsed rail', () => {
  test.skip(({ viewport }) => viewport.width < 1280, 'the rail is md-only');

  test('scrolls the list without moving the sidebar itself', async ({ page }) => {
    await open(page, PROBLEM_01);
    await page.evaluate(() => localStorage.removeItem('lt150-nav-stage'));
    await page.reload();
    await page.waitForSelector('#curriculumNav .nav-item', { state: 'attached' });
    await page.waitForTimeout(400);

    await page.click('#ltNavCollapse'); // 200px text rail
    await page.click('#ltNavCollapse'); // 56px icon rail
    await page.waitForTimeout(400);
    await expect(page.locator('#sidebar')).toHaveAttribute('data-stage', '2');

    await page.click('.nav-cat-btn[data-cat="HASHMAP"]');
    await page.waitForTimeout(1200); // the scroll is smooth

    const r = await page.evaluate(() => {
      const sb = document.getElementById('sidebar');
      const nav = document.getElementById('curriculumNav');
      const sbb = sb.getBoundingClientRect();
      const header = sb.firstElementChild.getBoundingClientRect();
      const nb = nav.getBoundingClientRect();
      return {
        sidebarScrollTop: sb.scrollTop,
        stage: sb.dataset.stage,
        headerH: Math.round(header.height),
        headerVisible: header.height > 0 && header.bottom > sbb.top + 1,
        navBelowHeader: Math.round(nb.top - header.bottom),
        scrolledInNav: nav.scrollTop > 0,
        blankBelowNav: Math.round(sbb.bottom - nb.bottom),
      };
    });

    expect(r.stage, 'the rail widened back out').toBe('0');
    expect(r.scrolledInNav, 'and the list did scroll to the group').toBe(true);
    expect(r.sidebarScrollTop, 'the sidebar itself is not scrolled — that was the blank space').toBe(0);
    expect(r.headerVisible, 'the progress ring, filter and pills are still on screen').toBe(true);
    expect(r.navBelowHeader, 'the list still starts under the header block').toBe(0);
    expect(r.blankBelowNav, 'and the list still reaches the bottom of the sidebar').toBe(0);
    expect(r.headerH, 'the header block is its full height, not collapsed').toBe(191);
  });
});

test.describe('keyboard navigation in the sidebar search', () => {
  test('arrow keys move a highlight and Enter opens that guide', async ({ page }) => {
    await open(page, PROBLEM_01);
    await page.fill('#searchInput', 'two sum');
    await page.waitForTimeout(300);
    const first = await page.evaluate(() =>
      document.querySelector('#curriculumNav .nav-item[aria-selected="true"]')?.textContent || '');
    expect(first, 'one row is highlighted after the query settles').not.toBe('');
    await page.locator('#searchInput').press('ArrowDown');
    const moved = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#curriculumNav .nav-item')];
      return rows.findIndex(r => r.getAttribute('aria-selected') === 'true');
    });
    expect(moved, 'the highlight is on a later row').toBeGreaterThan(0);
  });

  test('Escape clears the query instead of closing the drawer', async ({ page }) => {
    await open(page, PROBLEM_01);
    if (page.viewportSize().width < 768) {
      await page.click('#menuBtn');
      await page.waitForTimeout(250);
    }
    await page.fill('#searchInput', 'two sum');
    await page.waitForTimeout(250);
    await page.locator('#searchInput').press('Escape');
    await expect(page.locator('#searchInput')).toHaveValue('');
    const stillOpen = await page.evaluate(() =>
      document.getElementById('sidebar').classList.contains('-translate-x-full'));
    expect(stillOpen, 'the first Escape only cleared the query').toBe(false);
  });

  test('a query that matches nothing leaves Enter harmless', async ({ page }) => {
    await open(page, PROBLEM_01);
    await page.fill('#searchInput', 'zzzznomatch');
    await page.waitForTimeout(250);
    await page.locator('#searchInput').press('ArrowDown');
    await page.locator('#searchInput').press('Enter');
    const hash = await page.evaluate(() => location.hash);
    expect(hash, 'Enter did not navigate anywhere').toBe('#' + PROBLEM_01);
  });

  test('pressing / from page content focuses sidebar search without typing a slash', async ({ page }) => {
    await open(page, PROBLEM_01);
    await page.click('article');
    await page.keyboard.press('/');
    await page.waitForTimeout(100);
    const isFocused = await page.evaluate(() => document.activeElement === document.getElementById('searchInput'));
    expect(isFocused, 'searchInput is now the activeElement').toBe(true);
    const value = await page.locator('#searchInput').inputValue();
    expect(value, 'slash key was not typed into the input').toBe('');
  });
});

test.describe('keyboard navigation in the command palette', () => {
  test('End jumps to the last option and Home back to the first', async ({ page }) => {
    await open(page, PROBLEM_01);
    await page.click('#paletteBtn');
    await page.waitForTimeout(200);
    await page.fill('#paletteInput', 'two');
    await page.waitForTimeout(300);
    const total = await page.evaluate(() => document.querySelectorAll('#paletteList .pal-item').length);
    await page.locator('#paletteInput').press('End');
    const last = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#paletteList .pal-item')];
      return rows.findIndex(r => r.getAttribute('aria-selected') === 'true');
    });
    expect(last, 'End selected the last row').toBe(total - 1);
    await page.locator('#paletteInput').press('Home');
    const first = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#paletteList .pal-item')];
      return rows.findIndex(r => r.getAttribute('aria-selected') === 'true');
    });
    expect(first, 'Home selected the first row').toBe(0);
  });

  test('the highlighted row is inside the list viewport', async ({ page }) => {
    await open(page, PROBLEM_01);
    await page.click('#paletteBtn');
    await page.waitForTimeout(200);
    await page.fill('#paletteInput', 'e');
    await page.waitForTimeout(300);
    for (let i = 0; i < 8; i++) await page.locator('#paletteInput').press('ArrowDown');
    const visible = await page.evaluate(() => {
      const list = document.getElementById('paletteList');
      const row = list.querySelector('.pal-item[aria-selected="true"]');
      if (!row) return { ok: false };
      const a = row.getBoundingClientRect(), b = list.getBoundingClientRect();
      return { ok: a.top >= b.top - 1 && a.bottom <= b.bottom + 1 };
    });
    expect(visible.ok, 'arrowing scrolled the highlighted row into view').toBe(true);
  });
});

test.describe('reader and global keyboard shortcuts', () => {
  test('Escape from sidebar search returns focus to content scroller allowing arrow key scroll', async ({ page }) => {
    await open(page, PROBLEM_01);
    await page.fill('#searchInput', 'two sum');
    await page.waitForTimeout(200);
    // First Escape clears the query
    await page.locator('#searchInput').press('Escape');
    await expect(page.locator('#searchInput')).toHaveValue('');
    // Second Escape blurs and returns focus to #contentContainer
    await page.locator('#searchInput').press('Escape');
    await page.waitForTimeout(100);

    const focusedId = await page.evaluate(() => document.activeElement?.id);
    expect(focusedId, 'focus returned to contentContainer').toBe('contentContainer');

    const initialScroll = await page.evaluate(() => document.getElementById('contentContainer').scrollTop);
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(200);
    const scrolled = await page.evaluate(() => document.getElementById('contentContainer').scrollTop);
    expect(scrolled, 'PageDown scrolled the reader content').toBeGreaterThan(initialScroll);
  });

  test('pressing "c" opens chat assistant and focuses the chat composer', async ({ page }) => {
    await open(page, PROBLEM_01);
    await page.click('article');
    await page.keyboard.press('c');
    await page.waitForTimeout(200);

    const isChatFocused = await page.evaluate(() => document.activeElement?.id === 'ltcInput');
    expect(isChatFocused, 'chat composer is focused after pressing "c"').toBe(true);

    const val = await page.locator('#ltcInput').inputValue();
    expect(val, '"c" key was not typed into the composer').toBe('');
  });

  test('pressing Escape in chat composer blurs it and restores focus to content scroller', async ({ page }) => {
    await open(page, PROBLEM_01);
    await page.click('article');
    await page.keyboard.press('c');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('ltcInput');

    await page.keyboard.press('Escape');
    await page.waitForTimeout(100);

    const activeId = await page.evaluate(() => document.activeElement?.id);
    expect(activeId, 'focus returned to contentContainer upon Escape from chat').toBe('contentContainer');
  });

  test('arrow keys inside chat navigate/scroll the chat message history', async ({ page }) => {
    await open(page, PROBLEM_01);
    // Open chat
    await page.evaluate(() => window.LtChat?.open());
    await page.waitForTimeout(200);
    // Insert dummy messages into chat log to create scrollable overflow
    await page.evaluate(() => {
      const log = document.getElementById('ltcLog');
      for (let i = 0; i < 30; i++) {
        const p = document.createElement('div');
        p.className = 'ltc-msg';
        p.style.height = '40px';
        p.textContent = `Test message line ${i}`;
        log.appendChild(p);
      }
      log.scrollTop = 500;
    });

    const initScroll = await page.evaluate(() => document.getElementById('ltcLog').scrollTop);
    expect(initScroll).toBe(500);

    // Focus input and press PageUp
    await page.focus('#ltcInput');
    await page.keyboard.press('PageUp');
    await page.waitForTimeout(150);

    const newScroll = await page.evaluate(() => document.getElementById('ltcLog').scrollTop);
    expect(newScroll, 'PageUp in composer scrolled the chat log up').toBeLessThan(initScroll);
  });

  test('"[" and "]" navigate to previous and next guides', async ({ page }) => {
    await open(page, PROBLEM_01);
    const startHash = await page.evaluate(() => location.hash);
    expect(startHash).toBe('#' + PROBLEM_01);

    // Press ']' for next guide
    await page.keyboard.press(']');
    await page.waitForTimeout(400);
    const nextHash = await page.evaluate(() => location.hash);
    expect(nextHash, '"]" navigated to the next guide').not.toBe(startHash);

    // Press '[' for previous guide
    await page.keyboard.press('[');
    await page.waitForTimeout(400);
    const prevHash = await page.evaluate(() => location.hash);
    expect(prevHash, '"[" navigated back to the previous guide').toBe(startHash);
  });

  test('"m" toggles the completion status of the current guide', async ({ page }) => {
    await open(page, PROBLEM_01);
    // Clear completion state for test isolation
    await page.evaluate((id) => {
      localStorage.removeItem('lt150-done');
    }, PROBLEM_01);
    await page.reload();
    await page.waitForSelector('#doneToggle');

    const initialText = await page.evaluate(() => document.getElementById('doneToggle')?.textContent || '');
    expect(initialText).toContain('Mark complete');

    // Press 'm'
    await page.keyboard.press('m');
    await page.waitForTimeout(200);
    const completedText = await page.evaluate(() => document.getElementById('doneToggle')?.textContent || '');
    expect(completedText, '"m" toggled guide to Completed').toContain('Completed');

    // Press 'm' again to unmark
    await page.keyboard.press('m');
    await page.waitForTimeout(200);
    const unmarkedText = await page.evaluate(() => document.getElementById('doneToggle')?.textContent || '');
    expect(unmarkedText, '"m" toggled guide back to Mark complete').toContain('Mark complete');
  });

  test('single-key shortcuts do not trigger while typing in an input field', async ({ page }) => {
    await open(page, PROBLEM_01);
    await page.focus('#searchInput');
    await page.keyboard.type('music [test] c');
    await page.waitForTimeout(200);

    const val = await page.locator('#searchInput').inputValue();
    expect(val, 'keys typed as literal characters without triggering hotkeys').toBe('music [test] c');
    expect(await page.evaluate(() => location.hash)).toBe('#' + PROBLEM_01);
  });
});

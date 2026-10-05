import { test, expect } from '@playwright/test';

/**
 * Layout invariants for the header row and the right-hand rail. Each one is a
 * number measured off the live DOM, because the defect it guards is a number:
 * a header that is 57px tall while every column below it is positioned at
 * 3.5rem = 56px pushes the assistant's composer 1px off the bottom of the
 * screen, and nothing about that failure looks like a CSS bug in review.
 */

const box = (page, sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { w: Math.round(b.width), h: Math.round(b.height), y: Math.round(b.y), top: Math.round(b.top), bottom: Math.round(b.bottom), right: Math.round(b.right) };
  }, sel);

/** Below 1024px the rail is display:contents and the assistant is a bottom sheet. */
const isRailColumn = (page) =>
  page.evaluate(() => getComputedStyle(document.getElementById('ltRail')).display !== 'contents');

/* 1024 is where the layout first has to pay for everything at once: the sidebar
   is docked, and so is the rail. It used to be tested at 1440 and on a phone and
   nowhere between, which is exactly where the column collapsed. */
const GUIDE = '08-linked-list_06-reverse-nodes-in-k-group';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  // attached, not visible: below 1024px the assistant is a hidden bottom sheet.
  await page.waitForSelector('#ltcPanel', { state: 'attached' });
});

test('nothing in the shell extends past the viewport', async ({ page }) => {
  const m = await page.evaluate(() => ({
    innerW: innerWidth,
    innerH: innerHeight,
    scrollW: document.documentElement.scrollWidth,
    scrollH: document.documentElement.scrollHeight,
  }));
  expect(m.scrollW, 'no horizontal page scroll').toBeLessThanOrEqual(m.innerW);
  expect(m.scrollH, 'no vertical page scroll').toBeLessThanOrEqual(m.innerH);
});

test('the header is exactly the height every column is offset by', async ({ page }) => {
  const header = await box(page, 'header');
  expect(header.h, 'the hairline must not add a pixel on top of the row height').toBe(56);
  const sidebar = await box(page, '#sidebar');
  expect(sidebar.y, 'the sidebar starts where the header ends').toBeLessThanOrEqual(header.h + 1);
});

test('every header control shares one height and one baseline', async ({ page }) => {
  const ctrls = await page.evaluate(() => {
    const pick = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return b.width > 0 ? { h: Math.round(b.height), y: Math.round(b.y) } : null;
    };
    return { auth: pick('#authArea'), guides: pick('#guidesBtn'), palette: pick('#paletteBtn'), row: Math.round(document.querySelector('header > div').getBoundingClientRect().height) };
  });
  const visible = Object.entries(ctrls).filter(([k, v]) => k !== 'row' && v).map(([k, v]) => [k, v]);
  expect(visible.length, 'at least two header controls rendered').toBeGreaterThanOrEqual(2);
  for (const [k, v] of visible) {
    expect(v.h, `${k} matches its neighbours`).toBe(40);
    expect(v.y, `${k} shares the baseline`).toBe(visible[0][1].y);
    expect(v.h, `${k} fits inside the 56px header row`).toBeLessThanOrEqual(ctrls.row);
  }
});

test('the ⌘K chips read as keycaps, not as a nested control', async ({ page }) => {
  const chips = await page.evaluate(() => [...document.querySelectorAll('#paletteBtn kbd.k')]
    .map((k) => Math.round(k.getBoundingClientRect().height))
    .filter(Boolean));
  if (!chips.length) test.skip(true, 'the chips are hidden at this width');
  for (const h of chips) expect(h).toBeLessThanOrEqual(22);
});

test('the rail and its composer stay inside the viewport', async ({ page }) => {
  test.skip(!(await isRailColumn(page)), 'the assistant is a bottom sheet below 1024px, not a rail column');
  const rail = await box(page, '#ltRail');
  const form = await box(page, '#ltcForm');
  const hint = await box(page, '.ltc-hint');
  const inner = await page.evaluate(() => ({ h: innerHeight, w: innerWidth }));
  expect(rail.top, 'the rail starts under the header').toBeLessThanOrEqual(57);
  expect(rail.bottom, 'the rail ends at the viewport bottom').toBeLessThanOrEqual(inner.h + 1);
  expect(form.bottom, 'the composer is not clipped').toBeLessThanOrEqual(inner.h);
  expect(hint.bottom, 'the hint line under the composer is not clipped').toBeLessThanOrEqual(inner.h);
});

test('the scroll-down chevron fades the log out instead of sitting on it', async ({ page }) => {
  await page.evaluate(() => document.getElementById('ltcScrollDown').classList.add('is-shown'));
  await page.waitForTimeout(400); // the fade is a 200ms opacity transition
  const fade = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('.ltc-log-wrap'), '::after');
    return { content: cs.content, bg: cs.backgroundImage, opacity: cs.opacity, pe: cs.pointerEvents };
  });
  expect(fade.content, 'the fade exists').not.toBe('none');
  expect(fade.bg, 'the fade is a gradient').toContain('gradient');
  expect(Number(fade.opacity), 'the fade is on while the chevron is on').toBeGreaterThan(0.9);
  expect(fade.pe, 'the fade never eats a click on the log').toBe('none');
});

test('the collapsed navigation rail holds its own controls', async ({ page }) => {
  const collapse = await box(page, '#ltNavCollapse');
  test.skip(!collapse || collapse.w === 0, 'the collapse control is md-only');
  await page.click('#ltNavCollapse');
  await page.click('#ltNavCollapse');
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => {
    const sb = document.getElementById('sidebar');
    const b = sb.getBoundingClientRect();
    const spills = [...sb.querySelectorAll('button, input, svg')].filter((e) => {
      const c = e.getBoundingClientRect();
      return c.width > 0 && (c.right > b.right + 1 || c.left < b.left - 1);
    });
    return { stage: sb.dataset.stage, w: Math.round(b.width), spills: spills.length, ovf: sb.scrollWidth > sb.clientWidth + 1 };
  });
  expect(r.stage, 'two clicks land on the fully collapsed stage').toBe('2');
  expect(r.w, 'the collapsed rail is 56px').toBe(56);
  expect(r.spills, 'no control hangs outside the rail').toBe(0);
  expect(r.ovf, 'the rail does not scroll sideways').toBe(false);
});

/* The three below are one defect seen three ways, and every one of them was
   invisible to the suite. `nothing in the shell extends past the viewport`
   cannot see it: html clips horizontal overflow, so the page never scrolls
   sideways no matter how far the reader column spills, and a document-level
   assertion passes while content sits off the right edge. */
test.describe('the reading column when everything is docked', () => {
  test.skip(({ viewport }) => viewport.width < 768, 'the sidebar and rail only coexist from md up');

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto('/#' + GUIDE);
    await page.waitForSelector('#curriculumNav .nav-item', { state: 'attached' });
    await page.waitForTimeout(400);
  });

  test('the column can still afford the rail', async ({ page }) => {
    const w = await page.evaluate(() =>
      Math.round(document.querySelector('#contentContainer article').getBoundingClientRect().width));
    expect(w, 'under 500px the prose wraps to one or two words a line').toBeGreaterThanOrEqual(500);
  });

  test('the reader never needs a sideways scroll', async ({ page }) => {
    const m = await page.evaluate(() => {
      const cc = document.getElementById('contentContainer');
      return { scrollW: cc.scrollWidth, clientW: cc.clientWidth };
    });
    expect(m.scrollW, 'a sideways scroll hides the overflow where nobody looks for it')
      .toBeLessThanOrEqual(m.clientW);
  });

  test('both prev/next cells sit inside the column', async ({ page }) => {
    const past = await page.evaluate(() => {
      const art = document.querySelector('#contentContainer article').getBoundingClientRect();
      return [...document.querySelectorAll('#prevNext [data-nav]')].map((c) =>
        Math.round(c.getBoundingClientRect().right - art.right));
    });
    expect(past.length, 'this guide has a next guide to reach').toBe(2);
    for (const p of past) expect(p, 'no cell hangs past the column').toBeLessThanOrEqual(1);
  });
});

/* The assistant's button is fixed to the viewport, so anything the reader needs
   at the bottom edge is in its way. It used to find the prev/next pair there —
   3136px² of the bar and 2648px² of the Next cell at 360px. The pair now lives
   in the article head, so the button has the bottom edge to itself. This guards
   that: nothing may be pinned to the scrollport's bottom edge at all. */
test.describe('the bottom edge of the reader', () => {
  for (const width of [360, 768]) {
    test(`nothing is pinned over it at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/#' + GUIDE);
      await page.waitForSelector('#curriculumNav .nav-item', { state: 'attached' });
      await page.waitForTimeout(400);
      const r = await page.evaluate(() => {
        const box = (s) => document.querySelector(s).getBoundingClientRect();
        const overlap = (a, c) => Math.max(0, Math.min(a.right, c.right) - Math.max(a.left, c.left))
                               * Math.max(0, Math.min(a.bottom, c.bottom) - Math.max(a.top, c.top));
        const fab = box('.ltc-fab');
        const pinned = [...document.querySelectorAll('#contentContainer *')]
          .filter((el) => getComputedStyle(el).position === 'sticky')
          .filter((el) => { const b = el.getBoundingClientRect(); return b.height > 0 && b.bottom > innerHeight - 40; })
          .map((el) => el.id || el.className);
        return {
          pinnedInArticle: pinned,
          onPrevNext: Math.round(overlap(fab, box('#prevNext'))),
        };
      });
      expect(r.pinnedInArticle, 'no control is stuck to the bottom of the reader').toEqual([]);
      expect(r.onPrevNext, 'and the button no longer shares the corner with prev/next').toBe(0);
    });
  }
});

/* Read from the browser's own accessibility tree rather than a hand-rolled name
   computation. An earlier pass at this reported the assistant's suggestion chips
   as unnamed because it read innerText while the panel was still
   visibility:hidden — Chrome already knows which nodes it exposes. */
const INTERACTIVE_AX = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'switch', 'radio', 'menuitem',
]);

async function unnamedControls(page) {
  const client = await page.context().newCDPSession(page);
  await client.send('Accessibility.enable');
  await client.send('DOM.enable');
  const { nodes } = await client.send('Accessibility.getFullAXTree');
  const bad = nodes.filter((n) => !n.ignored && INTERACTIVE_AX.has(n.role?.value)
    && !String(n.name?.value || '').trim());
  const described = [];
  for (const n of bad) {
    let how;
    try {
      const { outerHTML } = await client.send('DOM.getOuterHTML', { backendNodeId: n.backendDOMNodeId });
      how = outerHTML.replace(/\s+/g, ' ').slice(0, 96);
    } catch {
      how = '(unresolvable)';
    }
    described.push(`${n.role.value}: ${how}`);
  }
  await client.detach();
  return described;
}

test.describe('accessible names', () => {
  // 360 is in the list because #paletteBtn's two text spans are hidden below md,
  // which left the button with an icon and no name at all.
  for (const width of [360, 1440]) {
    test(`every control has a name at ${width}px`, async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', 'the tree comes from CDP');
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/#' + GUIDE);
      await page.waitForSelector('#curriculumNav .nav-item', { state: 'attached' });
      await page.waitForTimeout(600);
      expect(await unnamedControls(page),
        'a keyboard or screen-reader user meets a control it cannot name').toEqual([]);
    });
  }
});

/* Every control below already clears WCAG 2.5.8 AA, which asks 24x24. 44 is the
   AAA figure and the one Apple's guidance uses, and it is the one that matters
   for the assistant: Send was a 34px target on a phone held in one hand, sitting
   beside the input rather than under a thumb. The header's own controls stay at
   40px — they clear AA with room, they sit at the top where reach is easy, and
   40 is a deliberate invariant from 029ff25 (one height, one baseline, 56px row)
   that layout.spec.mjs asserts at exactly 40. */
test.describe("the assistant's touch controls", () => {
  test('meet the 44px floor on the smallest phone claimed', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await page.waitForSelector('#ltcPanel', { state: 'attached' });
    await page.click('.ltc-fab');
    await page.waitForTimeout(700);
    // The scroll-down chevron rests at opacity 0 / pointer-events none, scaled to
    // 0.9. Measuring it there would score a control nobody can touch.
    await page.evaluate(() => document.getElementById('ltcScrollDown').classList.add('is-shown'));
    await page.waitForTimeout(400);
    const small = await page.evaluate(() => {
      const out = [];
      for (const sel of ['#ltcSend', '#ltcScrollDown', '#ltcClear', '#ltcClearAll', '#ltcClose', '.ltc-chip']) {
        for (const el of document.querySelectorAll(sel)) {
          const b = el.getBoundingClientRect();
          if (b.width === 0) continue; // not rendered in this state
          if (b.height < 44 || b.width < 44) out.push(`${sel} ${Math.round(b.width)}x${Math.round(b.height)}`);
        }
      }
      return out;
    });
    expect(small, 'a thumb should not have to find a 34px target').toEqual([]);
  });

  test('the composer still fits after they grow', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    await page.waitForSelector('#ltcPanel', { state: 'attached' });
    await page.click('.ltc-fab');
    await page.waitForTimeout(700);
    const m = await page.evaluate(() => {
      const form = document.getElementById('ltcForm').getBoundingClientRect();
      const hint = document.querySelector('.ltc-hint');
      return {
        formBottomOver: Math.round(form.bottom - innerHeight),
        hintOver: hint ? Math.round(hint.getBoundingClientRect().bottom - innerHeight) : null,
        vh: innerHeight,
      };
    });
    expect(m.formBottomOver, 'the composer is not clipped by the viewport').toBeLessThanOrEqual(1);
    expect(m.hintOver, 'and neither is the hint under it').toBeLessThanOrEqual(1);
  });
});

/* The right rail held two things: an "On this page" list taking up to 45% of the
   column, and the assistant below it. With one thing left in the rail the list
   has nothing to share the height with, so it is gone and the assistant takes
   the whole column. */
test.describe('the right rail', () => {
  test.skip(({ viewport }) => viewport.width < 1280, 'the rail is a column from 1280');

  test('has no table of contents and gives the full column to the assistant', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#' + GUIDE);
    await page.waitForSelector('#curriculumNav .nav-item', { state: 'attached' });
    await page.waitForTimeout(600);

    const r = await page.evaluate(() => {
      const rail = document.getElementById('ltRail');
      const panel = document.getElementById('ltcPanel');
      const rb = rail.getBoundingClientRect();
      const pb = panel.getBoundingClientRect();
      return {
        tocBlocks: document.querySelectorAll('.lt-rail-toc, #tocNav').length,
        heading: [...document.querySelectorAll('#ltRail *')].some((e) => e.textContent.trim() === 'On this page'),
        railH: Math.round(rb.height),
        panelH: Math.round(pb.height),
        panelTopGap: Math.round(pb.top - rb.top),
        // The rail's first element child should be the resizer, then the panel.
        order: [...rail.children].map((e) => e.id || String(e.className).split(' ')[0]),
        formOver: Math.round(document.getElementById('ltcForm').getBoundingClientRect().bottom - innerHeight),
      };
    });

    expect(r.tocBlocks, 'no table-of-contents markup survives').toBe(0);
    expect(r.heading, 'and no "On this page" label').toBe(false);
    expect(r.order, 'the rail is the resizer and the assistant, nothing else').toEqual(['ltRailResizer', 'ltcPanel']);
    expect(r.panelTopGap, 'the assistant starts at the top of the rail').toBe(0);
    expect(r.panelH, 'and fills its height').toBe(r.railH);
    expect(r.formOver, 'with the composer still inside the viewport').toBeLessThanOrEqual(1);
  });
});
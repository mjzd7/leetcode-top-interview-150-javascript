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
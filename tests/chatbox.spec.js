/**
 * E2E coverage for the context-aware chat widget.
 *
 * `/api/chat` is always mocked at the network layer, so the suite needs no
 * OPENAI_API_KEY and spends nothing. `playwright.config.mjs` builds docs/ and
 * serves it statically first, because `docs/curriculum-data.js` is gitignored.
 *
 * Both viewports run: the widget is a flex column at >=1024px and a bottom
 * sheet below it, so "is it visible" is a different assertion on each.
 */

import { test, expect } from '@playwright/test';

/** Guide with a known id (pathToId: slashes become underscores). */
const ARTICLE = '05-hashmap_06-two-sum';
const ARTICLE_URL = `/#${ARTICLE}`;

/** A phrase that appears in the Two Sum guide body but never in our questions. */
const CONTEXT_SENTINEL = 'Given an array of integers';

const panel = '#ltcPanel';
const log = '#ltcLog';
const input = '#ltcInput';
const sendBtn = '#ltcSend';
const stopBtn = '#ltcStop';
const fab = '#ltcFab';

const isMobile = (page) => page.viewportSize().width < 1024;

/** Open the assistant the way a reader would for the current viewport. */
async function openChat(page) {
  if (isMobile(page)) {
    await page.locator(fab).click();
    await expect(page.locator(panel)).toHaveClass(/is-open/);
  }
  await expect(page.locator(input)).toBeVisible();
}

/** One upstream SSE frame carrying a text delta. */
const delta = (content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

/**
 * Fulfill /api/chat with a well-formed SSE body.
 * `chunks` is turned into a single string; framing happens in the browser.
 */
async function mockChat(page, chunks, { status = 200, extraHeaders = {} } = {}) {
  const body = chunks.map(delta).join('') + 'data: [DONE]\n\n';
  await page.route('**/api/chat', async (route) => {
    await route.fulfill({
      status,
      contentType: 'text/event-stream',
      headers: { 'Access-Control-Allow-Origin': '*', ...extraHeaders },
      body,
    });
  });
}

/** Capture the JSON body the widget posts to /api/chat. */
function captureRequest(page) {
  const captured = {};
  page.on('request', (req) => {
    if (req.url().includes('/api/chat') && req.method() === 'POST') {
      try { captured.body = JSON.parse(req.postData() || '{}'); } catch { /* ignore */ }
    }
  });
  return captured;
}

const assistantBubble = (page) => page.locator(`${log} .ltc-msg[data-role="assistant"]`).last();

test.beforeEach(async ({ page }) => {
  // Silence the animation guard so sliding/focus assertions are deterministic.
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

/* ------------------------------------------------------------------ *
 * Layout
 * ------------------------------------------------------------------ */

test('renders the assistant in the viewport-appropriate surface', async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  await expect(page.locator(fab)).toHaveCount(1);
  await expect(page.locator(panel)).toHaveCount(1);

  if (isMobile(page)) {
    await expect(page.locator(fab)).toBeVisible();
    await expect(page.locator(panel)).not.toHaveClass(/is-open/);
  } else {
    // Desktop: a permanent flex column, and the FAB must get out of the way.
    await expect(page.locator(fab)).toBeHidden();
    await expect(page.locator(panel)).toBeVisible();
    const box = await page.locator(panel).boundingBox();
    expect(box.width).toBeGreaterThan(300);
    // Parked on the right edge, not overlapping the article.
    expect(box.x + box.width).toBeGreaterThan(page.viewportSize().width - 4);
  }
});

test('mobile: the FAB opens the bottom sheet and Escape closes it', async ({ page }) => {
  test.skip(!isMobile(page), 'bottom sheet is a mobile-only surface');
  await page.goto(ARTICLE_URL);

  const sheet = page.locator(panel);
  const before = await sheet.boundingBox();
  expect(before.y).toBeGreaterThan(page.viewportSize().height * 0.5);

  await page.locator(fab).click();
  await expect(sheet).toHaveClass(/is-open/);
  await expect(page.locator(fab)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#ltcBackdrop')).toHaveClass(/is-open/);

  const open = await sheet.boundingBox();
  expect(open.height).toBeLessThanOrEqual(page.viewportSize().height);

  await page.keyboard.press('Escape');
  await expect(sheet).not.toHaveClass(/is-open/);
  await expect(page.locator(fab)).toHaveAttribute('aria-expanded', 'false');
});

test('mobile: focus stays trapped inside the open sheet', async ({ page }) => {
  test.skip(!isMobile(page), 'focus trap applies to the modal sheet');
  await page.goto(ARTICLE_URL);
  await openChat(page);

  // Tab past the last focusable and confirm focus wrapped inside the panel.
  const inside = async () =>
    page.evaluate(() => !!document.getElementById('ltcPanel').contains(document.activeElement));

  expect(await inside()).toBe(true);
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await inside()).toBe(true);
  }
  await page.keyboard.press('Shift+Tab');
  expect(await inside()).toBe(true);
});

/* ------------------------------------------------------------------ *
 * Context extraction
 * ------------------------------------------------------------------ */

test('sends the visible guide as pageContext but never inside the message history', async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  const captured = captureRequest(page);
  await mockChat(page, ['ok']);
  await openChat(page);

  await page.locator(input).fill('what is the time complexity?');
  await page.locator(sendBtn).click();
  await expect(assistantBubble(page)).toContainText('ok', { timeout: 15_000 });

  const body = captured.body;
  expect(body, 'a request body was captured').toBeTruthy();
  expect(body.pageContext).toContain(CONTEXT_SENTINEL);
  expect(body.pageTitle).toBeTruthy();

  // The whole point of the prompt split: context is the system prompt's job.
  expect(Array.isArray(body.messages)).toBe(true);
  for (const m of body.messages) {
    expect(m.content).not.toContain(CONTEXT_SENTINEL);
  }
  expect(body.messages.at(-1)).toEqual({ role: 'user', content: 'what is the time complexity?' });
});

test('extractPageContext is pure, bounded, and survives a missing article', async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  const result = await page.evaluate(() => {
    const first = window.LtChat.extractPageContext();
    const second = window.LtChat.extractPageContext();
    document.getElementById('articleContent').remove();
    let afterRemoval;
    try { afterRemoval = window.LtChat.extractPageContext(); } catch (e) { afterRemoval = 'THREW: ' + e.message; }
    return { first, second, afterRemoval };
  });

  expect(result.first).toContain(CONTEXT_SENTINEL);
  expect(result.second).toBe(result.first);
  expect(result.first.length).toBeLessThanOrEqual(40_400);
  // Stripped: the copy button is widget chrome, not guide content.
  expect(result.first).not.toContain('Copy');
  expect(result.afterRemoval).not.toContain('THREW');
});

/* ------------------------------------------------------------------ *
 * Streaming
 * ------------------------------------------------------------------ */

test('accumulates SSE deltas into one assistant answer', async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });
  await mockChat(page, ['Use a ', 'hash map ', 'for O(n).']);
  await openChat(page);

  await page.locator(input).fill('explain');
  await page.locator(sendBtn).click();

  const bubble = assistantBubble(page);
  await expect(bubble).toContainText('Use a hash map for O(n).', { timeout: 15_000 });
  await expect(page.locator(`${log} .ltc-msg`)).toHaveCount(2);
  await expect(page.locator('[data-typing]')).toHaveCount(0);
  await expect(page.locator(input)).toBeEnabled();
  await expect(page.locator(stopBtn)).toBeHidden();
});

test('buffers an SSE stream split at arbitrary byte boundaries', async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  // Playwright route mocks deliver a body in one piece, so the buffer is driven
  // directly with a stream that cuts frames mid-JSON and mid-delimiter.
  const out = await page.evaluate(async () => {
    const enc = new TextEncoder();
    const wire = 'data: {"choices":[{"delta":{"content":"frag"}}]}\n\n'
      + 'data: {"choices":[{"delta":{"content":"mented"}}]}\n\n'
      + ': ping\n\n'
      + 'data: [DONE]\n\n';
    const bytes = enc.encode(wire);
    // 3-byte slices guarantee every frame boundary lands mid-token.
    const stream = new ReadableStream({
      start(c) {
        for (let i = 0; i < bytes.length; i += 3) c.enqueue(bytes.slice(i, i + 3));
        c.close();
      },
    });
    const seen = [];
    let done = null;
    await new Promise((resolve) => {
      window.LtChat.readSse({ body: stream }, (t) => seen.push(t), (e) => { done = e; resolve(); }, () => resolve());
    });
    return { seen, done };
  });

  expect(out.seen.join('')).toBe('fragmented');
  expect(out.done).toBeNull();
});

test('renders assistant markdown with a copy button and strips injected HTML', async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  const malicious = 'Here:\n\n```js\nconst a = 1;\n```\n\n'
    + '<img src=x onerror="window.__pwned=1">\n\n'
    + '<script>window.__pwned=2<\/script>';
  await mockChat(page, [malicious]);
  await openChat(page);

  await page.locator(input).fill('show me code');
  await page.locator(sendBtn).click();

  const bubble = assistantBubble(page);
  await expect(bubble.locator('.chat-code pre code')).toContainText('const a = 1;', { timeout: 15_000 });
  await expect(bubble.locator('.chat-code-copy')).toHaveCount(1);

  const pwned = await page.evaluate(() => window.__pwned);
  expect(pwned).toBeUndefined();
  await expect(bubble.locator('img[onerror], script')).toHaveCount(0);
});

test('renders a dry-run table inside a scroll wrapper without blowing out the rail', async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  // Deliberately wider than the 380px rail, so the wrapper has to earn its keep.
  const wide = '| step | i | j | target | nums[0] | nums[1] | nums[2] | nums[3] | seen map |\n'
    + '| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n'
    + '| 1 | 0 | - | 9 | 2 | 7 | 11 | 15 | {} |\n'
    + '| 2 | 1 | - | 9 | 2 | 7 | 11 | 15 | {2:0} |\n'
    + '| 3 | 1 | 0 | 9 | 2 | 7 | 11 | 15 | {2:0} |';
  await mockChat(page, ['Here is the dry run:\n\n' + wide]);
  await openChat(page);

  await page.locator(input).fill('dry run the optimized version');
  await page.locator(sendBtn).click();

  const bubble = assistantBubble(page);
  await expect(bubble.locator('table')).toHaveCount(1, { timeout: 15_000 });

  // The wrapper is what keeps a wide table from stretching the rail.
  const wrap = bubble.locator('.ltc-table-scroll');
  await expect(wrap).toHaveCount(1);
  await expect(wrap.locator('table')).toHaveCount(1);
  await expect(bubble.locator('th').first()).toContainText('step');
  await expect(bubble.locator('td').first()).toContainText('1');

  const m = await bubble.evaluate((el) => {
    const w = el.querySelector('.ltc-table-scroll');
    const t = el.querySelector('table');
    return {
      bubbleScroll: el.scrollWidth,
      bubbleClient: el.clientWidth,
      wrapperOverflowX: w ? getComputedStyle(w).overflowX : null,
      wrapperScrollable: w ? w.scrollWidth > w.clientWidth : false,
      tableWiderThanBubble: t ? t.getBoundingClientRect().width > el.clientWidth : false,
      borderCollapse: t ? getComputedStyle(t).borderCollapse : null,
    };
  });
  expect(m.wrapperOverflowX, 'wrapper scrolls horizontally').toBe('auto');
  expect(m.bubbleScroll, 'the bubble itself must not overflow the rail').toBeLessThanOrEqual(m.bubbleClient + 1);
  expect(m.borderCollapse, 'table collapses borders for a clean grid').toBe('collapse');
  // Guards the case where the table fits: the wrapper still exists but need not scroll.
  if (m.tableWiderThanBubble) expect(m.wrapperScrollable, 'overflowing table is scrollable').toBe(true);
});

test('renders a mermaid block as a diagram, not as a copyable code block', async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  const graph = 'flowchart TD\n  A[Start] --> B{Check}\n  B -->|yes| C[Done]\n  B -->|no| A';
  await mockChat(page, ['Here is the control flow:\n\n```mermaid\n' + graph + '\n```']);
  await openChat(page);

  await page.locator(input).fill('show the control flow');
  await page.locator(sendBtn).click();

  const bubble = assistantBubble(page);
  await expect(bubble.locator('.mermaid')).toHaveCount(1, { timeout: 15_000 });
  // Mermaid swaps the div's contents for an <svg> once it has run.
  await expect(bubble.locator('.mermaid svg')).toHaveCount(1, { timeout: 15_000 });

  // A diagram is not source code, so it must not get the copy affordance.
  await expect(bubble.locator('.chat-code')).toHaveCount(0);
  await expect(bubble.locator('.chat-code-copy')).toHaveCount(0);
  await expect(bubble).toContainText('Here is the control flow');
});

test('a broken mermaid diagram degrades instead of blanking the bubble', async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await mockChat(page, ['Intro line.\n\n```mermaid\nthis is (((not valid mermaid\n```\n\nOutro line.']);
  await openChat(page);

  await page.locator(input).fill('draw something invalid');
  await page.locator(sendBtn).click();

  const bubble = assistantBubble(page);
  // The prose around it must survive regardless of the diagram.
  await expect(bubble).toContainText('Intro line.', { timeout: 15_000 });
  await expect(bubble).toContainText('Outro line.');

  // Mermaid signals a parse failure by injecting an <svg aria-roledescription="error">
  // rather than throwing, so this asserts the real fallback: the source comes back
  // in a readable block instead of a collapsed blank box.
  const fallback = bubble.locator('.ltc-mermaid-error');
  await expect(fallback).toHaveCount(1, { timeout: 15_000 });
  await expect(fallback).toContainText('not valid mermaid');
  await expect(bubble.locator('[aria-roledescription="error"]')).toHaveCount(0);
  expect(errors, 'no uncaught page errors from bad diagram syntax').toEqual([]);
});

const VIZ_PAYLOAD = JSON.stringify({
  title: 'nums = [2, 7, 11, 15], target = 9',
  cells: [
    { v: 2, state: 'done' },
    { v: 7, state: 'active' },
    { v: 11, state: '' },
    { v: 15, state: '' },
  ],
  pointers: [{ i: 1, label: 'j' }],
  map: [['2', 0]],
  set: [3],
});

test('renders a viz-array block as cells, pointers and collections, not code', async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  await mockChat(page, ['Here is the state:\n\n```viz-array\n' + VIZ_PAYLOAD + '\n```']);
  await openChat(page);

  await page.locator(input).fill('visualise the array state');
  await page.locator(sendBtn).click();

  const bubble = assistantBubble(page);
  const viz = bubble.locator('.viz-array');
  await expect(viz).toHaveCount(1, { timeout: 15_000 });
  await expect(viz.locator('.viz-cell')).toHaveCount(4);
  await expect(viz).toContainText('nums = [2, 7, 11, 15], target = 9');

  // Cell values, in order, with the state modifier reflected.
  const cells = await viz.locator('.viz-cell').allTextContents();
  expect(cells.map((c) => c.trim())).toEqual(['2', '7', '11', '15']);
  await expect(viz.locator('.viz-cell.is-active')).toHaveCount(1);
  await expect(viz.locator('.viz-cell.is-done')).toHaveCount(1);

  // Pointer label sits under the cell it references.
  await expect(viz.locator('.viz-pointer')).toHaveCount(1);
  await expect(viz.locator('.viz-pointer')).toHaveText('j');
  expect(await viz.locator('.viz-pointer').getAttribute('data-at')).toBe('1');

  // Geometry, not just DOM. Cells and pointers used to live in two separate
  // grids whose tracks were sized independently, so `data-at` was correct while
  // the label rendered 116px away from its cell. Only a bounding-box comparison
  // catches that.
  const offsets = await viz.evaluate((v) => [...v.querySelectorAll('.viz-pointer')].map((p) => {
    const cells = [...v.querySelectorAll('.viz-cell')];
    const a = p.getBoundingClientRect();
    const c = cells[Number(p.dataset.at)].getBoundingClientRect();
    return Math.abs((a.left + a.width / 2) - (c.left + c.width / 2));
  }));
  for (const off of offsets) {
    expect(off, 'each pointer is centred on the cell it names').toBeLessThanOrEqual(2);
  }

  await expect(viz.locator('.viz-map .viz-pair')).toHaveCount(1);
  await expect(viz.locator('.viz-set .viz-item')).toHaveCount(1);

  // A visualisation is a picture, so no copy affordance.
  await expect(bubble.locator('.chat-code')).toHaveCount(0);
});

test('a malformed viz-array falls back to readable source instead of an empty box', async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await mockChat(page, ['Before.\n\n```viz-array\n{ not json at all\n```\n\nAfter.']);
  await openChat(page);

  await page.locator(input).fill('draw a broken viz');
  await page.locator(sendBtn).click();

  const bubble = assistantBubble(page);
  await expect(bubble).toContainText('Before.', { timeout: 15_000 });
  await expect(bubble).toContainText('After.');
  await expect(bubble.locator('.viz-array')).toHaveCount(0);
  await expect(bubble.locator('.chat-code pre code')).toContainText('not json at all');
  expect(errors, 'no uncaught errors from a malformed payload').toEqual([]);
});

test('viz-array cell text is escaped, not injected as HTML', async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  const evil = JSON.stringify({ title: '<img src=x onerror="window.__vizPwned=1">', cells: [{ v: '<b>bold</b>' }] });
  await mockChat(page, ['```viz-array\n' + evil + '\n```']);
  await openChat(page);

  await page.locator(input).fill('render something nasty');
  await page.locator(sendBtn).click();

  const bubble = assistantBubble(page);
  await expect(bubble.locator('.viz-array .viz-cell')).toHaveCount(1, { timeout: 15_000 });
  await expect(bubble.locator('.viz-cell b, .viz-array img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__vizPwned)).toBeUndefined();
  // The literal text still survives — escaped, not dropped.
  await expect(bubble.locator('.viz-cell')).toContainText('<b>bold</b>');
});

/* ------------------------------------------------------------------ *
 * Controls, abort, persistence
 * ------------------------------------------------------------------ */

test('Stop generating halts the stream and re-enables the input', async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  // A fulfilled route always completes, so the request must be held open before
  // responding for "still streaming" to be a genuine state.
  await page.route('**/api/chat', async (route) => {
    await new Promise((r) => setTimeout(r, 30_000));
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: delta('too late') });
  });
  await openChat(page);

  await page.locator(input).fill('go on forever');
  await page.locator(sendBtn).click();

  await expect(page.locator(stopBtn)).toBeVisible();
  await expect(page.locator(input)).toBeDisabled();

  await page.locator(stopBtn).click();
  await expect(page.locator(stopBtn)).toBeHidden();
  await expect(page.locator(input)).toBeEnabled();
});

test('an empty-state suggestion chip sends its question', async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });
  await mockChat(page, ['Brute force.']);
  await openChat(page);

  const chip = page.locator(`${log} .ltc-chip`).first();
  const question = await chip.textContent();
  await chip.click();

  await expect(assistantBubble(page)).toContainText('Brute force.', { timeout: 15_000 });
  await expect(page.locator(`${log} .ltc-msg[data-role="user"]`)).toContainText(question.trim());
});

test('keeps the thread across a reload and clears on request', async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });
  await mockChat(page, ['Remembered.']);
  await openChat(page);

  await page.locator(input).fill('remember this');
  await page.locator(sendBtn).click();
  await expect(assistantBubble(page)).toContainText('Remembered.', { timeout: 15_000 });

  await page.reload();
  await page.waitForSelector(`${log} .ltc-msg`, { state: 'attached' });
  await expect(page.locator(`${log} .ltc-msg`)).toHaveCount(2);

  // A reload resets the sheet to closed, so it has to be reopened to reach Clear.
  await openChat(page);
  await page.locator('#ltcClear').click();
  await expect(page.locator(`${log} .ltc-msg`)).toHaveCount(0);
  await expect(page.locator(`${log} .ltc-empty`)).toHaveCount(1);

  await page.reload();
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });
  await expect(page.locator(`${log} .ltc-msg`)).toHaveCount(0);
});

/* ------------------------------------------------------------------ *
 * Failure modes
 * ------------------------------------------------------------------ */

for (const [status, expectText] of [
  [429, 'too quickly'],
  [403, 'not available from this origin'],
  [503, 'not configured'],
  [500, 'unavailable'],
]) {
  test(`HTTP ${status} surfaces a readable message and offers retry`, async ({ page }) => {
    await page.goto(ARTICLE_URL);
    await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });
    await page.route('**/api/chat', (route) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: expectText }) }));
    await openChat(page);

    await page.locator(input).fill('hello');
    await page.locator(sendBtn).click();

    await expect(assistantBubble(page)).toContainText(expectText, { timeout: 15_000 });
    await expect(page.locator(input)).toBeEnabled();
    await expect(page.locator('.ltc-retry')).toHaveCount(1);
    // Regression: failTurn() renders, so it must run *after* setStreaming(false)
    // or the typing dots are painted on a turn that has already ended.
    await expect(page.locator('[data-typing]')).toHaveCount(0);
  });
}

test('a mid-stream error frame is shown without corrupting the partial answer', async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });
  await page.route('**/api/chat', (route) => route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    body: delta('Partial answer') + 'data: {"error":"The response stream was interrupted."}\n\n' + 'data: [DONE]\n\n',
  }));
  await openChat(page);

  await page.locator(input).fill('hi');
  await page.locator(sendBtn).click();

  await expect(assistantBubble(page)).toContainText('Partial answer', { timeout: 15_000 });
  await expect(assistantBubble(page)).toContainText('interrupted');
  await expect(page.locator(input)).toBeEnabled();
});

test('an unreachable API degrades instead of hanging', async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });
  await page.route('**/api/chat', (route) => route.abort('failed'));
  await openChat(page);

  await page.locator(input).fill('hi');
  await page.locator(sendBtn).click();

  await expect(page.locator('.ltc-retry')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(input)).toBeEnabled();
});

/* ------------------------------------------------------------------ *
 * Integration with the host page
 * ------------------------------------------------------------------ */

test('switching guides swaps the thread and the panel label', async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });
  await mockChat(page, ['two sum answer']);
  await openChat(page);

  await page.locator(input).fill('q1');
  await page.locator(sendBtn).click();
  await expect(assistantBubble(page)).toContainText('two sum answer', { timeout: 15_000 });

  // Close the chat first: the open sheet is modal, so its backdrop covers the
  // header and the hamburger cannot be reached while it is up.
  if (isMobile(page)) {
    await page.locator('#ltcClose').click();
    await expect(page.locator(panel)).not.toHaveClass(/is-open/);
    await page.locator('#menuBtn').click();
    await expect(page.locator('#sidebar')).not.toHaveClass(/-translate-x-full/);
  }
  await page.locator('#curriculumNav .nav-item').nth(3).click();
  await page.waitForFunction(() => !location.hash.startsWith('#05-hashmap_06-two-sum'));

  await expect(page.locator(`${log} .ltc-msg`)).toHaveCount(0);
  await expect(page.locator(`${log} .ltc-empty`)).toHaveCount(1);
  await expect(page.locator('#ltcPanelTitle')).not.toBeEmpty();
  expect(await page.evaluate(() => window.LtChat.state.articleId)).not.toBe('05-hashmap_06-two-sum');
});

/* ------------------------------------------------------------------ *
 * Layout: the right rail (item B)
 * ------------------------------------------------------------------ *
 * The chat used to be a 4th flex column beside <main>, which squeezed the
 * article on a 1440 screen. Decision B puts the TOC and the chat in ONE
 * right rail: TOC on top, chat below, sharing a width that item C resizes.
 */

const rail = '#ltRail';

test('the right rail holds both the table of contents and the assistant', async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  await expect(page.locator(rail)).toHaveCount(1);
  await expect(page.locator(`${rail} #tocNav`)).toHaveCount(1);
  await expect(page.locator(`${rail} ${panel}`)).toHaveCount(1);

  // Asserted as a negative: a direct child of <body> would mean the chat is
  // still a 4th flex column rather than a member of the rail.
  expect(await page.locator(`body > ${panel}`).count()).toBe(0);
});

test('the assistant sits below the table of contents inside the rail', async ({ page }) => {
  test.skip(isMobile(page), 'the rail only exists on wide viewports');

  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  const toc = await page.locator(`${rail} #tocNav`).boundingBox();
  const chat = await page.locator(panel).boundingBox();

  expect(toc, 'TOC has a box').not.toBeNull();
  expect(chat, 'chat has a box').not.toBeNull();
  expect(chat.y, 'chat starts below the TOC').toBeGreaterThan(toc.y);
});

test('the article is no longer squeezed by a fourth column', async ({ page }) => {
  test.skip(isMobile(page), 'measure the desktop grid only');

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  const article = await page.locator('article').boundingBox();
  // Measured 404px with the TOC as a 224px sibling inside <main>, 660px once it
  // moved into the rail; 660 is the ceiling (max-w-3xl inside a padded 740px main).
  expect(article.width, 'article gets real width back').toBeGreaterThan(600);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'no horizontal page overflow').toBeLessThanOrEqual(0);
});

/* ------------------------------------------------------------------ *
 * The one-liner page navigation (item A)
 * ------------------------------------------------------------------ *
 * Collapsed, "On this page" is a single row naming the section in view.
 * Clicking it opens that section's sub-headings, which hang off a guide
 * line. Moving to another section closes the one that was open, so the
 * navigation is never more than a single section deep and never lists
 * sections out of article order.
 */

/** Sections actually painted, i.e. not hidden by the one-liner rule. */
const visibleSecs = (page) => page.locator('#tocNav .toc-sec:visible').count();

/** Load the guide and return the active section's one-liner row. */
async function oneLiner(page) {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector('#tocNav .toc-link');
  return page.locator('#tocNav .toc-sec.is-active .toc-row');
}

/** Scroll a section into view by a phrase in its heading. */
const scrollToSection = (page, re) =>
  page.evaluate((src) => {
    const re = new RegExp(src);
    const h = [...document.querySelectorAll('#articleContent h2')].find((e) => re.test(e.textContent));
    h.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, re.source);

/** Scroll a subsection into view by a phrase in its heading. */
const scrollToSubsection = (page, re) =>
  page.evaluate((src) => {
    const re = new RegExp(src);
    const h = [...document.querySelectorAll('#articleContent h3')].find((e) => re.test(e.textContent));
    h.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, re.source);

test('the page navigation is one line naming only the section in view', async ({ page }) => {
  test.skip(isMobile(page), 'the TOC only exists on wide viewports');

  const row = await oneLiner(page);
  await expect(row).toBeVisible();
  expect(await visibleSecs(page), 'exactly one section is shown').toBe(1);
  await expect(row).toContainText(/Problem Overview/);
  await expect(page.locator('#tocNav .toc-sec.is-active .toc-sub')).toBeHidden();
});

test('the one-liner opens that section and nothing else', async ({ page }) => {
  test.skip(isMobile(page), 'the TOC only exists on wide viewports');

  const row = await oneLiner(page);
  await row.locator('.toc-toggle').click();

  const open = page.locator('#tocNav .toc-sec[data-collapsed="false"]');
  await expect(open).toHaveCount(1);
  await expect(open.locator('.toc-sub')).toBeVisible();
  expect(await open.locator('.toc-sub-link').count()).toBeGreaterThan(1);
  await expect(open.locator('.toc-toggle')).toHaveAttribute('aria-expanded', 'true');
});

test('sub-headings hang off a guide line so they read as children', async ({ page }) => {
  test.skip(isMobile(page), 'the TOC only exists on wide viewports');

  const row = await oneLiner(page);
  await row.locator('.toc-toggle').click();
  const child = page.locator('#tocNav .toc-sec.is-active .toc-sub-link').first();
  await expect(child).toBeVisible();

  const guide = await page.locator('#tocNav .toc-sec.is-active .toc-sub').evaluate((el) => {
    const s = getComputedStyle(el);
    return { border: parseFloat(s.borderLeftWidth), pad: parseFloat(s.paddingLeft) };
  });
  expect(guide.border, 'a visible guide line').toBeGreaterThan(0);
  expect(guide.pad, 'children are indented').toBeGreaterThan(0);

  const indent = await child.evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
  expect(indent, 'child sits right of the guide').toBeGreaterThan(0);
});

test('an opened section closes when the reader moves to another', async ({ page }) => {
  test.skip(isMobile(page), 'the TOC only exists on wide viewports');

  const row = await oneLiner(page);
  await row.locator('.toc-toggle').click();
  await expect(page.locator('#tocNav .toc-sec[data-collapsed="false"]')).toHaveCount(1);

  await scrollToSection(page, /Level 3/);

  // The new section leads and the one that was open has folded away, so the
  // navigation is a single line again rather than two out-of-order sections.
  expect(await visibleSecs(page), 'only the section in view is shown').toBe(1);
  await expect(page.locator('#tocNav .toc-sec.is-active .toc-link').first())
    .toContainText(/Level 3/);
  await expect(page.locator('#tocNav .toc-sec[data-collapsed="false"]')).toHaveCount(0);
});

test('only the section in view is ever shown', async ({ page }) => {
  test.skip(isMobile(page), 'the TOC only exists on wide viewports');

  const row = await oneLiner(page);
  await row.locator('.toc-toggle').click();
  await scrollToSection(page, /Level 3/);

  const shown = page.locator('#tocNav .toc-sec:visible');
  await expect(shown).toHaveCount(1);
  await expect(shown.first()).toHaveClass(/is-active/);
});

test('the one-liner keeps tracking the section in both directions', async ({ page }) => {
  test.skip(isMobile(page), 'the TOC only exists on wide viewports');

  const row = await oneLiner(page);
  await row.locator('.toc-toggle').click();

  for (const [target, name] of [[/Level 3/, /Level 3/], [/Gotchas/, /Gotchas/], [/Level 1/, /Level 1/]]) {
    await scrollToSection(page, target);
    expect(await visibleSecs(page), `one section shown at ${name}`).toBe(1);
    await expect(page.locator('#tocNav .toc-sec.is-active .toc-link').first())
      .toContainText(name);
  }
});

test('the sub-heading being read is marked as the active child', async ({ page }) => {
  test.skip(isMobile(page), 'the TOC only exists on wide viewports');

  const row = await oneLiner(page);
  await row.locator('.toc-toggle').click();
  expect(await page.locator('#tocNav .toc-sub-link.is-current').count()).toBe(0);

  // A child is only "in view" once the reader scrolls into it, not when the
  // section head arrives, so scroll to a specific subsection.
  await scrollToSubsection(page, /Pseudocode/);
  await page.locator('#tocNav .toc-sec.is-active .toc-toggle').click();

  const current = page.locator('#tocNav .toc-sub-link.is-current');
  await expect(current).toHaveCount(1);
  await expect(current).toHaveText(/Pseudocode/);
});

/* ------------------------------------------------------------------ *
 * Resizing the rail (item C)
 * ------------------------------------------------------------------ *
 * Decision C: a draggable divider, 320-720px, persisted, double-click
 * to reset. The width drives --lt-rail-w, which the rail already reads.
 */

const resizer = '#ltRailResizer';
const RAIL_MIN = 320;
const RAIL_MAX = 720;
const RAIL_DEFAULT = 380;

const railWidth = (page) =>
  page.locator(rail).evaluate((el) => el.getBoundingClientRect().width);

/** Drag the divider to an absolute x, the way a reader moves the handle. */
async function dragTo(page, x) {
  const box = await page.locator(resizer).boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 12 });
  await page.mouse.up();
}

test('the rail has a draggable divider', async ({ page }) => {
  test.skip(isMobile(page), 'the rail only exists on wide viewports');

  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  await expect(page.locator(resizer)).toBeVisible();
  await expect(page.locator(resizer)).toHaveAttribute('role', 'separator');
  await expect(page.locator(resizer)).toHaveAttribute('aria-orientation', 'vertical');
});

test('dragging the divider resizes the rail and clamps to 320-720', async ({ page }) => {
  test.skip(isMobile(page), 'the rail only exists on wide viewports');
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  // The rail hugs the right edge, so its width is innerWidth minus the
  // divider's x: dragging left widens it, dragging right narrows it.
  await dragTo(page, 1440 - 560);
  expect(await railWidth(page), 'drag widened the rail').toBeCloseTo(560, 0);

  await dragTo(page, 1440 - 340);
  expect(await railWidth(page), 'drag narrowed the rail').toBeCloseTo(340, 0);

  await dragTo(page, 0);
  expect(await railWidth(page), 'clamped at the max').toBeLessThanOrEqual(RAIL_MAX);

  await dragTo(page, 1440);
  expect(await railWidth(page), 'clamped at the min').toBeGreaterThanOrEqual(RAIL_MIN);
});

test('the rail width survives a reload and resets on double-click', async ({ page }) => {
  test.skip(isMobile(page), 'the rail only exists on wide viewports');
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  await dragTo(page, 1440 - 520);
  const dragged = await railWidth(page);

  await page.reload();
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });
  expect(await railWidth(page), 'width persisted across reload').toBeCloseTo(dragged, 0);

  await page.locator(resizer).dblclick();
  await expect
    .poll(() => railWidth(page), { timeout: 5000 })
    .toBeCloseTo(RAIL_DEFAULT, 0);
});

/* ------------------------------------------------------------------ *
 * Left nav collapse (item E)
 * ------------------------------------------------------------------ *
 * Decision E, read as a two-stage collapse: 320px full, 200px text rail,
 * 56px icon rail, then back to full. Only the icon rail drops the labels.
 */

const nav = '#sidebar';
const navCollapse = '#ltNavCollapse';
const NAV_WIDTHS = [320, 200, 56];

const navWidth = (page) =>
  page.locator(nav).evaluate((el) => el.getBoundingClientRect().width);

test('the left nav has a collapse control that cycles three stages', async ({ page }) => {
  test.skip(isMobile(page), 'the nav is only docked on wide viewports');
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto(ARTICLE_URL);
  await page.waitForSelector('#curriculumNav .nav-item');

  await expect(page.locator(navCollapse)).toBeVisible();
  await expect(page.locator(nav)).toHaveAttribute('data-stage', '0');
  expect(await navWidth(page)).toBeCloseTo(NAV_WIDTHS[0], 0);

  for (const stage of [1, 2, 0]) {
    await page.locator(navCollapse).click();
    await expect(page.locator(nav)).toHaveAttribute('data-stage', String(stage));
    await expect
      .poll(() => navWidth(page), { timeout: 5000 })
      .toBeCloseTo(NAV_WIDTHS[stage], 0);
  }
});

test('only the icon rail drops the nav labels', async ({ page }) => {
  test.skip(isMobile(page), 'the nav is only docked on wide viewports');
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto(ARTICLE_URL);
  await page.waitForSelector('#curriculumNav .nav-item');

  const title = page.locator('#curriculumNav .nav-item .nav-title').first();
  await expect(title).toBeVisible();

  await page.locator(navCollapse).click();
  await expect(page.locator(nav)).toHaveAttribute('data-stage', '1');
  await expect(title, 'text rail keeps the labels').toBeVisible();

  await page.locator(navCollapse).click();
  await expect(page.locator(nav)).toHaveAttribute('data-stage', '2');
  await expect(title, 'icon rail drops the labels').toBeHidden();
  await expect(page.locator('#curriculumNav .nav-item').first()).toBeVisible();
});

test('the nav stage survives a reload', async ({ page }) => {
  test.skip(isMobile(page), 'the nav is only docked on wide viewports');
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto(ARTICLE_URL);
  await page.waitForSelector('#curriculumNav .nav-item');

  await page.locator(navCollapse).click();
  await page.locator(navCollapse).click();
  await expect(page.locator(nav)).toHaveAttribute('data-stage', '2');

  await page.reload();
  await page.waitForSelector('#curriculumNav .nav-item');
  await expect(page.locator(nav)).toHaveAttribute('data-stage', '2');
  expect(await navWidth(page)).toBeCloseTo(NAV_WIDTHS[2], 0);
});

test('the one-liner is operable from the keyboard', async ({ page }) => {
  test.skip(isMobile(page), 'the TOC only exists on wide viewports');

  const row = await oneLiner(page);
  await row.locator('.toc-toggle').focus();
  await expect(page.locator('#tocNav .toc-sec.is-active .toc-toggle')).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page.locator('#tocNav .toc-sec[data-collapsed="false"]')).toHaveCount(1);

  await page.keyboard.press('Space');
  await expect(page.locator('#tocNav .toc-sec.is-active .toc-sub')).toBeHidden();
});

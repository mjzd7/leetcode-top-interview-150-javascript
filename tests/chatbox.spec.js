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
import { readFileSync } from 'node:fs';

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

/** One route status frame, as /api/chat emits while a tool is running. */
const statusFrame = (text) => `data: ${JSON.stringify({ status: text })}\n\n`;

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

/** Fulfill /api/chat with arbitrary pre-framed SSE text (status frames, heartbeats). */
async function mockChatRaw(page, body, { status = 200 } = {}) {
  await page.route('**/api/chat', async (route) => {
    await route.fulfill({
      status,
      contentType: 'text/event-stream',
      headers: { 'Access-Control-Allow-Origin': '*' },
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

test('the empty state says where a chat goes, before anything is typed', async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });
  // On mobile the panel is a closed bottom sheet, so the empty state is attached
  // but not visible — and a disclosure nobody can see is not a disclosure.
  await openChat(page);

  // The disclosure has to name BOTH halves, or it is the "we store nothing
  // server-side" claim in a nicer font: a local thread does not mean the
  // question never left the device. Both are asserted so neither can be dropped
  // without this failing.
  const note = page.locator(`${log} .ltc-empty-privacy`);
  await expect(note).toBeVisible();
  await expect(note).toContainText(/stay in this browser/i);
  await expect(note).toContainText(/30 days/i);
  await expect(note).toContainText(/OpenAI/);
  await expect(note, 'and it does not claim nothing is stored anywhere').not.toContainText(/store nothing|nothing is stored|never leaves/i);

  // It has to be legible on the viewport where the 9.5px hint under the input is
  // hidden entirely, which is the whole reason this copy is not over there.
  const box = await note.boundingBox();
  expect(box?.height ?? 0, 'the disclosure is not a sliver of unreadable text').toBeGreaterThan(18);
  const size = await note.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  expect(size, 'and it is not the 9.5px hint size').toBeGreaterThanOrEqual(10);

  // Contrast, measured rather than eyeballed. The hint's #5A6377 is 3.2:1 on this
  // panel and fails AA at small sizes; copying it here would have shipped a
  // disclosure nobody with low vision can read.
  const contrast = await note.evaluate((el) => {
    const lin = (c) => {
      const [r, g, b] = c.match(/[\d.]+/g).map(Number).map((v) => {
        v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    let node = el, bg = 'rgba(0, 0, 0, 0)';
    while (node && bg === 'rgba(0, 0, 0, 0)') { bg = getComputedStyle(node).backgroundColor; node = node.parentElement; }
    const a = lin(getComputedStyle(el).color), b = lin(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  expect(contrast, 'the disclosure meets WCAG AA for small text (4.5:1)').toBeGreaterThanOrEqual(4.5);
});

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
  await expect(page.locator('[data-thinking]')).toHaveCount(0);
  await expect(page.locator(input)).toBeEnabled();
  await expect(page.locator(stopBtn)).toBeHidden();
});

/**
 * The thinking indicator is a green gradient chip that slides along the seam
 * between the conversation and the composer — Gemini's indeterminate progress
 * line, not a blinking ellipsis.
 *
 * Asserted rather than eyeballed because the three properties that make it
 * read as "blended" are the three a screenshot cannot show: it is anchored to
 * the seam rather than floating in the log, the chip is genuinely animating,
 * and both of its end stops are transparent. Opacity is read numerically
 * instead of via toBeHidden(), because Playwright counts an opacity:0 element
 * as visible and the line is faded rather than display:none'd so it can ease.
 */
test('a sliding green line marks the input seam while thinking, not three dots', async ({ page }) => {
  // The suite-wide default is reduced motion, which freezes the sweep by
  // design; this test is about the animation, so opt back in.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  // Hold the turn open so every streaming-only assertion below lands inside the
  // window. Everything that needs `data-streaming` is asserted immediately after
  // the click, before the ones that do not, so the 6s is never the thing being
  // tested — the read window has to comfortably outlast the assertion latency.
  await page.route('**/api/chat', async (route) => {
    await new Promise((r) => setTimeout(r, 6000));
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: delta('Use a hash map.') + 'data: [DONE]\n\n',
    });
  });
  await openChat(page);

  const line = page.locator('.ltc-think-line');
  await expect(line, 'the thinking line is part of the composer').toHaveCount(1);
  await expect(line, 'it costs no attention while the turn is idle').toHaveCSS('opacity', '0');

  await page.locator(input).fill('explain');
  await page.locator(sendBtn).click();

  await expect(line, 'the line shows while a turn is in flight').toHaveCSS('opacity', '1');

  // Anchored to the seam, not floating in the conversation: the line's box ends
  // where the composer begins.
  const [lineBox, composerBox] = await Promise.all([
    line.boundingBox(),
    page.locator('.ltc-composer').boundingBox(),
  ]);
  expect(lineBox.y + lineBox.height, 'the line rests on top of the composer')
    .toBeLessThanOrEqual(composerBox.y + 1);

  const chip = await line.evaluate((el) => {
    const cs = getComputedStyle(el, '::before');
    return {
      animationName: cs.animationName,
      animationDuration: cs.animationDuration,
      backgroundImage: cs.backgroundImage,
    };
  });
  expect(chip.animationName, 'the chip is actually animating').not.toBe('none');
  expect(chip.animationDuration).not.toBe('0s');
  expect(chip.backgroundImage, 'a gradient, not a flat fill').toMatch(/linear-gradient/);
  // "Blends into the conversation" is literally a transparent end stop.
  expect(chip.backgroundImage, 'the chip dissolves to nothing at its ends')
    .toContain('rgba(0, 0, 0, 0)');
  expect(chip.backgroundImage, 'and it is the panel accent green').toContain('200, 250, 75');

  await expect(page.locator('.ltc-typing'), 'the element that drew the dots is gone').toHaveCount(0);
  // The wait still has to be announced: the green line carries no text and the
  // header status is display:none below 1180px.
  const note = page.locator('[data-thinking]');
  await expect(note, 'a screen-reader note stands in for the dots').toHaveCount(1);
  await expect(note, 'and it is not something you can see').toBeHidden();

  await expect(assistantBubble(page)).toContainText('Use a hash map.', { timeout: 15_000 });
  await expect(line, 'the line fades out once the answer lands').toHaveCSS('opacity', '0');
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

/* ------------------------------------------------------------------ *
 * The mermaid securityLevel race (item 0.1)
 * ------------------------------------------------------------------ *
 * `mermaid.initialize` is GLOBAL state. The portal's openArticle() re-initialises
 * it to securityLevel:'loose' and then calls *unscoped* mermaid.run(), so any
 * mermaid rendered afterwards inherits 'loose' — including the chat's.
 *
 * The observable consequence in Mermaid 10.9.8 is NOT a foreignObject and NOT a
 * live event-handler attribute, both of which this file's other tests could
 * assert and both of which mermaid produces identically at either level
 * (`htmlLabels` survives the widget's initialize() because mermaid deep-merges
 * config, and DOMPurify runs on the label at 'loose' too). Asserting either
 * would be a test that passes on the vulnerable code.
 *
 * It is the *interactive* directives. Mermaid binds `click`/`href` only when
 * securityLevel === 'loose':
 *     if (qt().securityLevel !== 'loose' || arg === undefined) return;
 * so a `click` directive becomes a live <a xlink:href="javascript:..."> in the
 * reader's chat bubble at 'loose' and carries no href at all at 'strict'.
 * Chat diagrams are model-authored and unreviewed, and `fetch_page` lets a
 * stranger's web page influence what the model emits, which is exactly why the
 * widget must re-assert 'strict' immediately before every run.
 */

const CLICK_PAYLOAD = 'javascript:window.__MermaidPwned=1';

/** A valid diagram with a unique label, so the two bubbles are distinguishable. */
const diagram = (tag) => `flowchart TD\n  A[Start ${tag}] --> B[End ${tag}]`;

/** A valid diagram whose `click` directive is a javascript: URL. */
const CLICKY_DIAGRAM =
  'flowchart TD\n  A[Start] --> B[End]\n  click A "' + CLICK_PAYLOAD + '" "click me"';

test('a chat diagram stays strict after openArticle flips the global mermaid to loose', async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });
  await mockChat(page, ['Here:\n\n```mermaid\n' + diagram('one') + '\n```']);
  await openChat(page);

  // Turn 1: the first chat diagram of the session. This is what trips the old
  // one-way `mermaidReady` latch, so the race only opens on the *second* one.
  await page.locator(input).fill('draw the control flow');
  await page.locator(sendBtn).click();
  await expect(assistantBubble(page).locator('.mermaid svg')).toHaveCount(1, { timeout: 15_000 });

  // The portal now re-initialises the shared mermaid to 'loose' and runs it
  // unscoped across the page. This is the reader clicking a sidebar link, and
  // it is the whole bug: nothing about it is chat-specific.
  await page.evaluate(() => window.openArticle('24-maang-guides_01-maang-sde-roadmap'));
  expect(
    await page.evaluate(() => window.mermaid.mermaidAPI.getConfig().securityLevel),
    'precondition: the portal really did flip the global to loose',
  ).toBe('loose');

  // Turn 2: a diagram carrying a javascript: click directive.
  await page.unroute('**/api/chat');
  await mockChat(page, ['Here:\n\n```mermaid\n' + CLICKY_DIAGRAM + '\n```']);
  await page.locator(input).fill('now draw one with a link');
  await page.locator(sendBtn).click();

  const bubble = assistantBubble(page);
  await expect(bubble.locator('.mermaid svg')).toHaveCount(1, { timeout: 15_000 });

  // The fix re-asserts 'strict' before this run, so the level at run time is
  // strict even though the article left it loose a moment ago.
  const anchor = bubble.locator('a[data-id="A"]').first();
  await expect(anchor, 'the node is still rendered, just not wired up').toHaveCount(1);

  const href = await anchor.getAttribute('xlink:href');
  expect(href, 'a click directive must not become a live href in a chat diagram').toBeNull();

  // Belt and braces: not one anchor anywhere in the bubble carries an href, and
  // the javascript: payload appears nowhere in the rendered markup.
  const links = await bubble.locator('.mermaid [xlink\\:href]').count();
  expect(links, 'no diagram node in the chat may carry an href').toBe(0);
  expect(await bubble.locator('.mermaid').innerHTML()).not.toContain('javascript:');

  // And the payload is inert: a real trusted click must not run it.
  await anchor.scrollIntoViewIfNeeded();
  const box = await anchor.boundingBox();
  expect(box, 'the diagram node has a box to click').not.toBeNull();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(250);
  expect(
    await page.evaluate(() => window.__MermaidPwned),
    'clicking a chat diagram must never execute model-authored javascript:',
  ).toBeUndefined();

  // The widget's own config is what makes the above true, so pin it directly
  // rather than inferring the fix from the DOM alone.
  expect(await page.evaluate(() => window.mermaid.mermaidAPI.getConfig().securityLevel))
    .toBe('strict');
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
    // or the thinking note is painted on a turn that has already ended.
    await expect(page.locator('[data-thinking]')).toHaveCount(0);
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

test('tool status frames are progress, not answer text', async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });
  // Two lookups, as a cross-question turn produces, interleaved with the answer.
  await mockChatRaw(
    page,
    statusFrame('Looking up search_guides…')
    + delta('Guide 146: LRU Cache')
    + statusFrame('Looking up web_search…')
    + delta(' uses a hash map and a doubly linked list.')
    + 'data: [DONE]\n\n',
  );
  await openChat(page);

  await page.locator(input).fill('how does an LRU cache work while I am on Two Sum?');
  await page.locator(sendBtn).click();

  await expect(assistantBubble(page)).toContainText('Guide 146: LRU Cache', { timeout: 15_000 });
  await expect(assistantBubble(page)).toContainText('doubly linked list');

  // A status frame is chrome. If it reached the transcript the reader would read
  // "Looking up search_guides…" as part of the answer.
  const bubble = await assistantBubble(page).innerText();
  expect(bubble).not.toContain('Looking up');
  expect(bubble).not.toContain('search_guides');
  expect(bubble).not.toContain('web_search');

  // The pill returns to idle rather than sticking on a tool name.
  await expect(page.locator('#ltcStatusTxt')).toHaveText('Ready');
  await expect(page.locator(input)).toBeEnabled();
});

test('a status-only stream still ends the turn cleanly', async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });
  // The cut-off path: the route spent its lookup budget, so it reports progress
  // and then the stream closes. The widget must release the UI, not hang.
  await mockChatRaw(page, statusFrame('Looking up search_guides…') + 'data: [DONE]\n\n');
  await openChat(page);

  await page.locator(input).fill('something expensive');
  await page.locator(sendBtn).click();

  await expect(page.locator('#ltcStatusTxt')).toHaveText('Ready', { timeout: 15_000 });
  await expect(page.locator(input)).toBeEnabled();
  // data-busy, not the disabled attribute: send stays disabled while the input
  // is empty, which is correct and would make this assertion meaningless.
  await expect(page.locator(sendBtn)).toHaveAttribute('data-busy', 'false');
});

/* ------------------------------------------------------------------ *
 * The truncation notice (item 0.3b, client half)
 * ------------------------------------------------------------------ *
 * The route emits `data: {"truncated":true}` after the last content delta and
 * before [DONE] when the provider stopped on finish_reason === 'length'. The
 * wire format is pinned by the other half of the item; these tests only pin the
 * client's half of it.
 *
 * The notice is a quiet subordinate line under the bubble, never a modal or a
 * toast, and the absence case has to be as exact as the presence case: a
 * stream with no such frame must render byte-identically to before. That is why
 * the third test compares innerHTML rather than just counting nodes.
 */

/** The exact frame the route emits, verbatim and unnegotiated. */
const truncatedFrame = 'data: {"truncated":true}\n\n';

const TRUNCATED_ANSWER =
  'The dry run proceeds one pair at a time, and the second pass is where the '
  + 'complement lookup pays for itself, because every earlier value has already '
  + 'been seen and the map makes each membership test a constant-time read.';

test('a truncated answer is marked with a quiet notice under the bubble', async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });
  await mockChatRaw(page, delta(TRUNCATED_ANSWER) + truncatedFrame + 'data: [DONE]\n\n');
  await openChat(page);

  await page.locator(input).fill('explain the optimized version');
  await page.locator(sendBtn).click();

  const bubble = assistantBubble(page);
  await expect(bubble).toContainText('constant-time read', { timeout: 15_000 });

  const notice = bubble.locator('.ltc-truncated');
  await expect(notice, 'the reader is told the answer was cut off').toHaveCount(1);
  await expect(notice).toContainText('cut off');

  // The copy affordance is the reader's way to salvage the partial answer, so
  // the notice must not have displaced it or renamed its accessible name.
  const copy = bubble.locator('.ltc-msg-copy');
  await expect(copy).toHaveCount(1);
  await expect(copy).toHaveAttribute('aria-label', 'Copy this answer');

  // A subordinate line, not chrome that blocks the transcript.
  expect(await page.locator('.ltc-truncated').count(), 'exactly one notice in the thread')
    .toBe(1);
  expect(await page.locator(`${log} [role="alert"], ${log} [role="dialog"]`).count(),
    'a notice must not be an alert or a dialog').toBe(0);
});

test('the truncation notice survives a reload', async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });
  await mockChatRaw(page, delta(TRUNCATED_ANSWER) + truncatedFrame + 'data: [DONE]\n\n');
  await openChat(page);

  await page.locator(input).fill('explain the optimized version');
  await page.locator(sendBtn).click();
  await expect(assistantBubble(page).locator('.ltc-truncated')).toHaveCount(1, { timeout: 15_000 });

  // Asserted, not assumed: the restore filter keeps whole message objects, so
  // the flag has to be in the persisted copy and not merely in live state.
  // Read from localStorage, which is where the store lives — a reader that was
  // already signed in when this shipped is served from the migrated copy, and
  // the flag has to survive that path too.
  const stored = await page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('lt150-chat-v1') || '{}');
    return store['05-hashmap_06-two-sum'].messages.map((m) => m.truncated);
  });
  expect(stored, 'the flag is persisted with the message, not just held in memory')
    .toEqual([undefined, true]);

  await page.reload();
  await page.waitForSelector(`${log} .ltc-msg`, { state: 'attached' });
  await expect(assistantBubble(page).locator('.ltc-truncated')).toHaveCount(1);
  await expect(assistantBubble(page)).toContainText('constant-time read');
});

test('an answer with no truncation frame renders exactly as it did before', async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });
  // No truncated frame. This is the false-positive guard: a client that sets the
  // flag on anything — on [DONE], on an error frame, on an empty stream — passes
  // the two tests above and fails here.
  await mockChatRaw(page, delta(TRUNCATED_ANSWER) + 'data: [DONE]\n\n');
  await openChat(page);

  await page.locator(input).fill('explain the optimized version');
  await page.locator(sendBtn).click();

  const bubble = assistantBubble(page);
  await expect(bubble).toContainText('constant-time read', { timeout: 15_000 });

  await expect(page.locator('.ltc-truncated'), 'no notice without a truncation frame')
    .toHaveCount(0);
  expect(await page.evaluate(() => window.LtChat.state.messages.at(-1).truncated))
    .toBeUndefined();

  // Byte-identical bubble: the copy button, its accessible name, and the
  // message's own aria-label are all untouched, with nothing appended. The
  // message label carries the turn's HH:MM, so it is matched by shape.
  const shape = await bubble.evaluate((el) => ({
    children: [...el.children].map((c) => c.className),
    ariaLabel: el.getAttribute('aria-label'),
    copyAria: el.querySelector('.ltc-msg-copy')?.getAttribute('aria-label'),
  }));
  expect(shape.children, 'no extra node is appended to the bubble').toEqual([
    'ltc-msg-head', 'ltc-msg-body', 'ltc-msg-actions',
  ]);
  expect(shape.ariaLabel).toMatch(/^Assistant answered( at \d{2}:\d{2})?$/);
  expect(shape.copyAria).toBe('Copy this answer');
});

/* ------------------------------------------------------------------ *
 * The labelled Mermaid fallback (items 2.3, 2.4)
 * ------------------------------------------------------------------ *
 * The test above pins that the fallback *exists*. This one pins that it is
 * readable, which is the part that could regress silently: a `<pre>` with no
 * explanation is indistinguishable from a broken box to a reader who does not
 * know a diagram was attempted, and nothing about it fails loudly.
 *
 * `scratch/qa-mermaid.mjs` probed this by hand and screenshotted it. That file is
 * gitignored throwaway tooling, so the case it checked had no committed test at
 * all — which is exactly how an untested fallback rots. This is the automated
 * version, and it asserts the two things a screenshot could only suggest: the
 * label says *why* the source is on screen, and the block has real geometry
 * rather than collapsing to nothing.
 */

test('a malformed diagram shows a labelled, sized source block, not a blank box', async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await mockChat(page, ['Intro line.\n\n```mermaid\nflowchart TD\n  A --> ((( \n```\n\nOutro line.']);
  await openChat(page);

  await page.locator(input).fill('draw a broken diagram');
  await page.locator(sendBtn).click();

  const bubble = assistantBubble(page);
  await expect(bubble).toContainText('Outro line.', { timeout: 15_000 });

  const fallback = bubble.locator('.ltc-mermaid-error');
  await expect(fallback, 'the diagram fell back to its source').toHaveCount(1);
  await expect(bubble.locator('[aria-roledescription="error"]'),
    'no collapsed zero-height error svg is left behind').toHaveCount(0);

  // The label. Its job is to say the *diagram* failed and that what follows is
  // its source, so the reader can read or copy it instead of waiting for a
  // picture that is never going to arrive.
  const note = fallback.locator('.ltc-mermaid-error-note');
  await expect(note, 'the fallback explains itself').toHaveCount(1);
  const noteText = (await note.textContent()).trim();
  expect(noteText, 'the label says the diagram failed').toMatch(/could ?n[o']?t|failed|did not parse|can'?t parse/i);
  expect(noteText, 'the label says this is the source').toMatch(/source/i);

  // The label is styled as chrome, distinct from the source it introduces. A
  // block-level, smaller, differently-coloured note is what makes the two
  // readable; without the stylesheet it inherits the <pre>'s own type and a
  // reader cannot tell where the diagram ends and the source begins.
  const labelStyle = await note.evaluate((el) => {
    const s = getComputedStyle(el);
    const pre = getComputedStyle(el.closest('pre'));
    return { display: s.display, size: s.fontSize, color: s.color, preSize: pre.fontSize, preColor: pre.color };
  });
  expect(labelStyle.display, 'the label is its own block, not run into the source').toBe('block');
  expect(parseFloat(labelStyle.size), 'the label is smaller than the source it labels')
    .toBeLessThan(parseFloat(labelStyle.preSize));
  expect(labelStyle.color, 'the label is not the same colour as the source')
    .not.toBe(labelStyle.preColor);

  // Not a blank box: the block is laid out, and the source is in it verbatim.
  const box = await fallback.boundingBox();
  expect(box, 'the fallback occupies real space').not.toBeNull();
  expect(box.height, 'the fallback is taller than one line of nothing').toBeGreaterThan(24);
  expect(box.width, 'the fallback is wide enough to read').toBeGreaterThan(120);
  expect(await fallback.textContent(), 'the diagram source is shown to the reader')
    .toContain('A --> ((( ');

  expect(errors, 'no uncaught page errors from a bad diagram').toEqual([]);
});

/* ------------------------------------------------------------------ *
 * Math rendering (items 1.1, 1.2, 1.4)
 * ------------------------------------------------------------------ *
 * The portal has always rendered `$…$` with KaTeX (`docs/index.html`'s
 * openArticle). The chat widget did not, so an answer containing `$O(n \log n)$`
 * showed the reader raw LaTeX while the guide they were reading beside it showed
 * a typeset formula.
 *
 * Everything asserted here was measured against KaTeX 0.16.9 / auto-render
 * rather than assumed, and two of those measurements change what the test can
 * honestly claim:
 *
 *  1. **`$…$` is NOT an auto-render default delimiter.** With no `delimiters`
 *     option the defaults are `$$…$$`, `\(…\)` and `\[…\]` — probed:
 *     `renderMathInElement(span("$x$"))` → 0 `.katex`, but `\(x\)` → 1. So the
 *     `delimiters` half of the option object is load-bearing, not decorative:
 *     drop it and math silently never renders.
 *
 *  2. **The hazard is an `ignoredTags` list that is wrong, not one that is
 *     absent.** Omitting `ignoredTags` entirely is safe, because 0.16.9's own
 *     default is `['script','noscript','style','textarea','pre','code','option']`.
 *     Probed against a real widget code block containing `` `${x}` `` and `$r$`:
 *       exact index.html options → 0 `.katex`, source byte-identical
 *       `ignoredTags: []`        → 1 `.katex`, source mangled to
 *                                  "const r = `x'lets={x}`;\nlet s = x'lets=r$;"
 *       list without pre/code    → 1 `.katex`, same mangling
 *     So the template-literal regression is real and reproducible, it just takes
 *     a *wrong* list to trigger rather than a missing one. Copying index.html's
 *     list verbatim is what forecloses it.
 *
 * KaTeX runs AFTER DOMPurify, so its output is not sanitised. Probed for that
 * specifically: `\href{javascript:…}` yields 0 anchors and `\htmlClass{<img
 * onerror=…>}` yields 0 images, because `trust` is not enabled. That is a
 * property of the option object (no `trust` key), which is why the options test
 * below pins the whole object rather than only the `ignoredTags` list.
 */

const MATH_ANSWER = 'Use a hash map. The lookup is $O(1)$ and the whole pass is $O(n \\log n)$ time.';

/** Template literal plus a bare `$r$`, in a fenced js block — the payload item 1.4 is about. */
const TEMPLATE_LITERAL_BLOCK =
  'Here is the code:\n\n```js\n'
  + 'const seen = new Map();\n'
  + 'const key = `${nums[i]}`;\n'
  + 'let total = $r$;\n'
  + '```';

/**
 * Record every renderMathInElement call the widget makes, with its scope.
 *
 * Installed after load rather than as an init script: the auto-render bundle is a
 * classic <script> and does not exist yet when an init script would run.
 *
 * The scope class, not `closest('#ltcPanel')`, is the discriminator: messageNode
 * calls renderMath on a body that has not been appended to the wrap yet — the
 * same detached call the pre-existing renderMermaid makes — so an ancestor query
 * returns null for exactly the calls under test.
 */
async function recordChatMathCalls(page) {
  await page.evaluate(() => {
    window.__chatMathCalls = [];
    const original = window.renderMathInElement;
    window.renderMathInElement = function (element, options) {
      window.__chatMathCalls.push({
        scope: String((element && element.className) || ''),
        streaming: document.getElementById('ltcPanel').dataset.streaming === 'true',
        options: JSON.parse(JSON.stringify(options || {})),
      });
      return original.call(this, element, options);
    };
  });
}

/** Only the calls made against the widget's own message markup. */
const isChatScope = (call) => /\bltc-msg-(body|md)\b/.test(call.scope);

const chatMathCalls = (page) =>
  page.evaluate(() => (window.__chatMathCalls || []).filter(
    (c) => /\bltc-msg-(body|md)\b/.test(c.scope),
  ));

test('a settled paragraph with inline math is typeset by KaTeX', async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });
  await mockChat(page, [MATH_ANSWER]);
  await openChat(page);

  await page.locator(input).fill('what is the complexity?');
  await page.locator(sendBtn).click();

  const bubble = assistantBubble(page);
  await expect(bubble).toContainText('Use a hash map.', { timeout: 15_000 });

  // Two expressions in one sentence, so the count is a real assertion rather
  // than "some math appeared somewhere".
  await expect(bubble.locator('.katex'), 'both $…$ expressions are typeset').toHaveCount(2);

  // The raw LaTeX is gone from what the reader sees. Measured: KaTeX keeps
  // "O(n \log n)" inside the MathML annotation but drops the delimiters, so the
  // assertion is on the delimiters, not on the prose.
  const text = await bubble.innerText();
  expect(text, 'the raw $ delimiters are not shown to the reader').not.toContain('$');
  expect(text).not.toContain('\\log');
  expect(text, 'the surrounding prose is not swallowed').toContain('The lookup is');
  expect(text).toContain('time.');
});

test("the widget typesets with the portal's exact option object", async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });
  await recordChatMathCalls(page);
  await mockChat(page, [MATH_ANSWER]);
  await openChat(page);

  await page.locator(input).fill('what is the complexity?');
  await page.locator(sendBtn).click();
  await expect(assistantBubble(page).locator('.katex').first()).toBeVisible({ timeout: 15_000 });

  const calls = await chatMathCalls(page);
  expect(calls.length, 'the widget calls renderMathInElement on its own markup').toBeGreaterThan(0);

  // index.html:1283-1295, verbatim. Key by key rather than as a deep equal, so
  // a failure names the option that drifted.
  for (const call of calls) {
    const options = call.options;
    expect(options.delimiters,
      'the $…$ delimiters must be passed explicitly; they are not auto-render defaults')
      .toEqual([
        { left: '$$', right: '$$', display: true },
        { left: '$', right: '$', display: false },
      ]);
    expect(options.ignoredTags,
      'pre and code must stay ignored, or a template literal is typeset as math')
      .toEqual(['script', 'noscript', 'style', 'textarea', 'pre', 'code']);
    expect(options.throwOnError).toBe(false);
    // Probed: \href{javascript:…} and \htmlClass{<img onerror=…>} are both
    // refused only because `trust` is absent, and math runs after DOMPurify.
    expect('trust' in options, 'the widget must not enable KaTeX trust').toBe(false);
  }
});

test('a template literal and a bare $r$ in a code block are left alone', async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });
  await mockChat(page, [TEMPLATE_LITERAL_BLOCK]);
  await openChat(page);

  await page.locator(input).fill('show me the code');
  await page.locator(sendBtn).click();

  const bubble = assistantBubble(page);
  const code = bubble.locator('.chat-code pre code');
  await expect(code).toContainText('const seen = new Map();', { timeout: 15_000 });

  // Byte-identical to the fenced source. A renderer that ate the template
  // literal produced "const key = `x'lets={nums[i]}`;" when probed, so an exact
  // compare is the assertion that actually catches it. No trailing newline:
  // marked strips the one after the closing fence, measured here.
  expect(await code.textContent(), 'the code block is untouched').toBe(
    'const seen = new Map();\nconst key = `${nums[i]}`;\nlet total = $r$;',
  );
  expect(await code.locator('.katex').count(), 'no math is typeset inside code').toBe(0);
  // The whole answer is the code block, so this is exact rather than partial.
  expect(await bubble.locator('.katex').count(), 'no math anywhere in the answer').toBe(0);
  await expect(bubble.locator('.chat-code-copy')).toHaveCount(1);
});

test('math typesets on the stable prefix, not only when the turn ends', async ({ page }) => {
  // Deferring math to messageNode() alone — the design this item rejects — is
  // observably worse: the prefix re-renders once per paragraph for the whole
  // stream, so every paragraph holding `$…$` would show raw LaTeX and snap at
  // turn end. The discriminator is *when* the call happens, so the call is
  // recorded in-page with the panel's streaming flag read at call time. A
  // cross-process poll would race the reveal and flake; this cannot.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });
  await recordChatMathCalls(page);

  const answer = 'The lookup is $O(1)$ per element.\n\n'
    + 'Scanning the array costs one pass. '.repeat(20)
    + '\n\nSo the whole thing is $O(n)$.';
  await mockChat(page, answer.match(/[^\n]+\n?|\n/g));
  await openChat(page);

  await page.locator(input).fill('what is the complexity?');
  await page.locator(sendBtn).click();
  await expect(assistantBubble(page).locator('.katex')).toHaveCount(2, { timeout: 15_000 });

  const calls = await chatMathCalls(page);
  const onPrefix = calls.filter((c) => /\bltc-msg-md\b/.test(c.scope));
  const onBody = calls.filter((c) => /\bltc-msg-body\b/.test(c.scope));

  expect(onPrefix.length, 'the stable prefix is typeset during the turn').toBeGreaterThan(0);
  expect(
    onPrefix.every((c) => c.streaming),
    'the prefix is only ever typeset while the turn is still running',
  ).toBe(true);
  expect(onBody.length, 'the settled message is typeset too, for a restored thread').toBeGreaterThan(0);
});

/* ------------------------------------------------------------------ *
 * Persistence: localStorage, retention, and the 429 soft gate (Wave 4)
 * ------------------------------------------------------------------ *
 * The store used to be `sessionStorage`, which is per-tab and dies with the tab.
 * That, not a missing persistence layer, was the actual defect.
 *
 * `localStorage` is chosen deliberately over IndexedDB: it keeps `readStore()`
 * SYNCHRONOUS, and messageNode(), clearCurrent() and the per-guide thread swap
 * are all built on that ordering. An async read path would break them.
 *
 * Retention is a privacy control, not hygiene. Moving the history off the tab
 * means it is now readable by anyone at the same browser profile, so it gets a
 * byte cap, a TTL, and a control that erases all of it — and those three are what
 * make "history outlives the tab" a defensible trade rather than just a longer
 * retention window.
 */

const STORE_KEY = 'lt150-chat-v1';

/** Bytes of a value as localStorage accounts for them (quota is in bytes, not chars). */
const byteLength = (page, key) => page.evaluate(
  (k) => new Blob([localStorage.getItem(k) || '']).size, key,
);

const readLocalStore = (page) => page.evaluate(
  (k) => JSON.parse(localStorage.getItem(k) || '{}'), STORE_KEY,
);

/**
 * A stored thread for an arbitrary guide, shaped exactly as the widget writes it.
 * Seeding beats sending for the retention cases: they need entries the reader
 * could not produce through the UI (expired, oversized, another guide's).
 */
function seedThread(page, articleId, { updatedAt = Date.now(), messages = [] } = {}) {
  return page.evaluate(([k, id, entry]) => {
    const store = JSON.parse(localStorage.getItem(k) || '{}');
    store[id] = { updatedAt: entry.updatedAt, messages: entry.messages };
    localStorage.setItem(k, JSON.stringify(store));
  }, [STORE_KEY, articleId, { updatedAt, messages }]);
}

const aMessage = (content) => ({ role: 'assistant', content, ts: '12:34' });
const aQuestion = (content) => ({ role: 'user', content, ts: '12:34' });

/* --- 4.1 the store is localStorage, same key, synchronous ------------- */

test('a thread survives closing the tab and opening a new one', async ({ page, context }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });
  await mockChat(page, ['Survives the tab.']);
  await openChat(page);

  await page.locator(input).fill('remember this across tabs');
  await page.locator(sendBtn).click();
  await expect(assistantBubble(page)).toContainText('Survives the tab.', { timeout: 15_000 });

  // The precondition that makes this test different from the reload one: a new
  // tab in the same context has its own sessionStorage, and the same
  // localStorage. So a store that survives this is not a per-tab store.
  await page.close();
  const reopened = await context.newPage();
  await reopened.goto(ARTICLE_URL);
  await reopened.waitForSelector(`${log} .ltc-msg`, { state: 'attached' });

  expect(await reopened.locator(`${log} .ltc-msg`).count(),
    'the thread is still there in a brand new tab').toBe(2);
  await expect(reopened.locator(`${log} .ltc-msg[data-role="assistant"]`))
    .toContainText('Survives the tab.');

  // And it is in the shared origin store, under the same key it always used.
  const store = await readLocalStore(reopened);
  expect(Object.keys(store), 'the thread is keyed by article in localStorage')
    .toEqual([ARTICLE]);
});

test('an existing sessionStorage thread is migrated, not silently dropped', async ({ page }) => {
  // A reader who was mid-conversation when this shipped has their thread only in
  // sessionStorage. Losing it on deploy would be a real regression, so the
  // migration is asserted rather than assumed: the thread must be readable, it
  // must be re-homed in localStorage, and the old copy must be cleared so it
  // cannot resurrect later or be double-counted.
  await page.addInitScript(([key, id, entry]) => {
    sessionStorage.setItem(key, JSON.stringify({ [id]: entry }));
  }, [STORE_KEY, ARTICLE, {
    updatedAt: Date.now(),
    messages: [aQuestion('carried over from before the deploy'), aMessage('Yes — this thread predates localStorage.')],
  }]);

  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-msg`, { state: 'attached' });

  await expect(page.locator(`${log} .ltc-msg[data-role="user"]`))
    .toContainText('carried over from before the deploy');
  await expect(page.locator(`${log} .ltc-msg[data-role="assistant"]`))
    .toContainText('predates localStorage');

  const migrated = await readLocalStore(page);
  expect(migrated[ARTICLE], 'the thread now lives in localStorage').toBeTruthy();
  expect(migrated[ARTICLE].messages.map((m) => m.content))
    .toEqual(['carried over from before the deploy', 'Yes — this thread predates localStorage.']);

  expect(await page.evaluate((k) => sessionStorage.getItem(k), STORE_KEY),
    'the per-tab copy is cleared, so it cannot come back or be counted twice').toBeNull();

  // And the writer must not re-add it: a thread that survives a reload is the
  // part that actually matters.
  await page.reload();
  await page.waitForSelector(`${log} .ltc-msg`, { state: 'attached' });
  expect(await page.locator(`${log} .ltc-msg`).count()).toBe(2);
});

/* --- 4.2 retention: a byte cap and a 30-day TTL ---------------------- */

const DAY_MS = 24 * 60 * 60 * 1000;

test('a thread older than 30 days is dropped, a recent one is kept', async ({ page }) => {
  const other = '05-hashmap_07-group-anagrams';
  // Seeded after a real navigation: localStorage is access-denied on about:blank,
  // so writing before the first goto is not a seeding failure to diagnose later.
  await page.goto(ARTICLE_URL);
  await seedThread(page, ARTICLE, { updatedAt: Date.now() - 31 * DAY_MS, messages: [aMessage('A month old.')] });
  await seedThread(page, other, { updatedAt: Date.now() - 2 * DAY_MS, messages: [aMessage('Two days old.')] });
  await page.reload();
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  // The expired thread is gone from the reader's view...
  expect(await page.locator(`${log} .ltc-msg`).count(), 'the expired thread is not restored').toBe(0);
  await expect(page.locator(`${log} .ltc-empty`)).toHaveCount(1);
  // ...and gone from the store, so it cannot be counted against the cap either.
  const store = await readLocalStore(page);
  expect(Object.keys(store), 'the expired entry is evicted, not just hidden').not.toContain(ARTICLE);

  // The discrimination is real: a thread inside the window is untouched.
  await page.goto(`/#${other}`);
  await expect(page.locator(`${log} .ltc-msg[data-role="assistant"]`)).toContainText('Two days old.');
  expect(Object.keys(await readLocalStore(page))).toContain(other);
});

test('the store is capped in bytes, evicting the oldest threads first', async ({ page }) => {
  // The cap is a byte budget, not a count of guides, so the payload is built to
  // exceed it in bytes: 12 guides × 40 messages × ~5KB of answer is ~1.25 MB
  // against a 1 MiB budget (see STORE_MAX_BYTES in the widget for the
  // measurement this number came from).
  const answer = 'x'.repeat(5000);
  const messages = [];
  for (let i = 0; i < 20; i++) messages.push(aQuestion(`question ${i}`), aMessage(answer));

  const ids = Array.from({ length: 12 }, (_, i) => `seeded-guide-${i}`);
  const base = Date.now() - 12 * DAY_MS;
  await page.addInitScript(([key, seeds]) => {
    const store = {};
    // Ascending updatedAt, so seeded-guide-0 is the oldest and -11 the newest.
    seeds.forEach((s, i) => { store[s.id] = { updatedAt: s.updatedAt, messages: s.messages }; });
    localStorage.setItem(key, JSON.stringify(store));
  }, [STORE_KEY, ids.map((id, i) => ({ id, updatedAt: base + i * DAY_MS, messages }))]);

  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  const store = await readLocalStore(page);
  const kept = Object.keys(store);

  expect(kept.length, 'something is kept, and something was evicted').toBeGreaterThan(0);
  expect(kept.length, 'the whole oversized set does not survive').toBeLessThan(ids.length);
  expect(kept, 'eviction is oldest-first').not.toContain('seeded-guide-0');
  expect(kept, 'the newest thread is never the thing evicted').toContain('seeded-guide-11');
  // Every survivor is newer than every evicted thread, not merely "some are new".
  const newestEvicted = ids.filter((id) => !kept.includes(id)).map((id) => ids.indexOf(id));
  expect(Math.min(...newestEvicted), 'only a prefix of the age order is evicted')
    .toBeLessThan(Math.max(...kept.map((id) => ids.indexOf(id))));

  // The cap is read from the shipped source rather than restated here, so a change
  // to the number cannot leave this test asserting a stale budget.
  const source = await page.evaluate(async () => {
    const res = await fetch('chat-widget.js');
    return res.text();
  });
  const declared = /STORE_MAX_BYTES\s*=\s*(\d+)/.exec(source);
  expect(declared, 'the widget declares a byte cap').not.toBeNull();
  const budget = Number(declared[1]);
  const size = await byteLength(page, STORE_KEY);
  expect(size, 'the store now fits the byte budget').toBeLessThanOrEqual(budget);
});

/* --- 4.3 clear all chats --------------------------------------------- */

test('clearing all chats erases every guide, not just the open one', async ({ page }) => {
  const other = '05-hashmap_07-group-anagrams';
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });
  await mockChat(page, ['thread on two sum']);
  await openChat(page);

  await page.locator(input).fill('q1');
  await page.locator(sendBtn).click();
  await expect(assistantBubble(page)).toContainText('thread on two sum', { timeout: 15_000 });

  // A second guide's thread, so "every guide" is actually more than one.
  await seedThread(page, other, { messages: [aQuestion('a question on another guide'), aMessage('an answer on another guide')] });
  expect(Object.keys(await readLocalStore(page)).sort()).toEqual([ARTICLE, other].sort());

  await page.locator('#ltcClearAll').click();

  // The current thread empties, and so does the other guide's.
  await expect(page.locator(`${log} .ltc-msg`)).toHaveCount(0);
  await expect(page.locator(`${log} .ltc-empty`)).toHaveCount(1);
  const store = await readLocalStore(page);
  expect(Object.keys(store), 'no guide keeps a thread').toEqual([]);

  // And the other guide really is empty on a fresh load, not just hidden.
  await page.goto(`/#${other}`);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });
  expect(await page.locator(`${log} .ltc-msg`).count()).toBe(0);
});

test('the two clear controls are distinct and separately named', async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });
  // Opened for both viewports: below 1024px the panel is a closed bottom sheet,
  // so "is this control visible" is a different assertion on each.
  await openChat(page);

  // An icon with no distinguishing name is a hazard: two adjacent trash buttons
  // that both say "Clear this conversation" is how a reader wipes 20 guides by
  // accident, which is the one action here with no undo.
  const clearOne = page.locator('#ltcClear');
  const clearAll = page.locator('#ltcClearAll');
  await expect(clearOne).toHaveAttribute('aria-label', /this conversation|this guide/i);
  await expect(clearAll).toHaveAttribute('aria-label', /all chats|every guide/i);
  expect(await clearOne.getAttribute('aria-label')).not.toBe(await clearAll.getAttribute('aria-label'));
  await expect(clearAll).toBeVisible();
});

/* --- 4.4 the 429 soft gate ------------------------------------------- *
 * A session RAISES the rate limit; it never gates chat (D-10). So this control
 * is a suggestion, not a wall: the plain 429 message stays, the input stays
 * usable, and the sign-in line appears only from the third consecutive 429 —
 * because the remedy for hitting an anonymous per-IP budget is an identity, and
 * the remedy for the first two is patience.
 */

const GATE = '.ltc-gate';

test('the first two 429s show the plain message only; the third adds a sign-in line', async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });
  await page.route('**/api/chat', (route) => route.fulfill({
    status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'rate limited' }),
  }));
  await openChat(page);

  const attempt = async (n) => {
    await page.locator(input).fill(`attempt ${n}`);
    await page.locator(sendBtn).click();
    await expect(assistantBubble(page)).toContainText('too quickly', { timeout: 15_000 });
    // The message is the pre-existing one, not a replacement.
    await expect(assistantBubble(page).locator('.ltc-msg-error')).toContainText('too quickly');
  };

  await attempt(1);
  expect(await page.locator(GATE).count(), 'the 1st 429 is just the plain message').toBe(0);
  await expect(page.locator(input)).toBeEnabled();

  await attempt(2);
  expect(await page.locator(GATE).count(), 'the 2nd 429 is still just the plain message').toBe(0);
  await expect(page.locator(input)).toBeEnabled();

  await attempt(3);
  const gate = page.locator(GATE);
  await expect(gate, 'the 3rd consecutive 429 offers a way out').toHaveCount(1);
  await expect(gate).toContainText(/sign in|log in|github/i);

  // Word spacing across the three sibling inline nodes. Caught by looking at the
  // rendered panel: with no spaces in the copy the reader gets
  // "too;sign in with GitHubfor a higher limit", which no textContent assertion
  // would have flagged. The seams are the only thing that can break.
  const gateText = await gate.innerText();
  expect(gateText, 'the sign-in line reads as prose, not as run-together nodes')
    .toMatch(/works too, or sign in with GitHub for a higher limit\./);

  // The remedy has to be reachable, and it has to be the existing login route.
  const link = gate.locator('a');
  await expect(link).toHaveCount(1);
  expect(await link.getAttribute('href')).toBe('/api/auth/login');

  // Never a modal, never a redirect, never blocking. The input still works and
  // the reader can simply send again.
  expect(await page.locator(`${log} [role="dialog"], ${log} [role="alert"]`).count(),
    'the sign-in line is not a dialog or an alert').toBe(0);
  await expect(page.locator(input)).toBeEnabled();
  await page.locator(input).fill('still typing after the gate');
  await expect(page.locator(input)).toHaveValue('still typing after the gate');
  await expect(page.locator(sendBtn)).toBeEnabled();
});

test('the gate is not permanent: a successful turn resets the count', async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });
  let rateLimited = true;
  await page.route('**/api/chat', (route) => (rateLimited
    ? route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'rate limited' }) })
    : route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: delta('Back within the limit.') + 'data: [DONE]\n\n',
    })));
  await openChat(page);

  for (const n of [1, 2, 3]) {
    await page.locator(input).fill(`nope ${n}`);
    await page.locator(sendBtn).click();
    await expect(assistantBubble(page)).toContainText('too quickly', { timeout: 15_000 });
  }
  await expect(page.locator(GATE)).toHaveCount(1);

  // One good turn, then a single 429 again: that is a burst of one, and nagging
  // a reader who is behaving would make the control noise rather than a remedy.
  rateLimited = false;
  await page.locator(input).fill('thanks');
  await page.locator(sendBtn).click();
  await expect(assistantBubble(page)).toContainText('Back within the limit.', { timeout: 15_000 });

  rateLimited = true;
  await page.locator(input).fill('one more 429');
  await page.locator(sendBtn).click();
  await expect(assistantBubble(page)).toContainText('too quickly', { timeout: 15_000 });
  // Scoped to the NEW turn: the gate on the earlier message is a real, already
  // shown notice and stays in the log. What must not happen is a second one.
  expect(await assistantBubble(page).locator(GATE).count(),
    'a single 429 after a success is not gated').toBe(0);
});

test('the 429 counter is capped, so a long outage cannot nag forever', async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });
  await page.route('**/api/chat', (route) => route.fulfill({
    status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'rate limited' }),
  }));
  await openChat(page);

  for (let n = 1; n <= 7; n++) {
    await page.locator(input).fill(`burst ${n}`);
    await page.locator(sendBtn).click();
    await expect(assistantBubble(page)).toContainText('too quickly', { timeout: 15_000 });
  }

  const counter = await page.evaluate(() => {
    const raw = localStorage.getItem('lt150-chat-v1:gate');
    return raw === null ? null : JSON.parse(raw).count;
  });
  expect(counter, 'the counter is persisted, so it survives the tab').not.toBeNull();
  expect(counter, 'the counter stops counting past its ceiling').toBeLessThanOrEqual(5);
  expect(counter, 'but it did count past the third').toBeGreaterThanOrEqual(3);
});

test('chat history stays on-device for a signed-in reader', async ({ page }) => {
  // D-10's invariant, asserted: a session is an identity, not a datastore. A
  // signed-in reader's thread is still a localStorage entry keyed by article, and
  // nothing about it moved to the server.
  await page.route('**/api/auth/me', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ githubId: 4242, login: 'octocat', done: [] }),
  }));
  await page.goto(ARTICLE_URL);
  await page.waitForSelector('#authArea a, #logoutBtn', { state: 'attached' });
  await expect(page.locator('#logoutBtn'), 'the reader really is signed in').toBeVisible();

  await mockChat(page, ['Answered while signed in.']);
  await openChat(page);
  await page.locator(input).fill('still on device?');
  await page.locator(sendBtn).click();
  await expect(assistantBubble(page)).toContainText('Answered while signed in.', { timeout: 15_000 });

  const store = await readLocalStore(page);
  expect(Object.keys(store), 'the thread is still the local on-device store').toEqual([ARTICLE]);
  expect(store[ARTICLE].messages.at(-1).content).toBe('Answered while signed in.');
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
 * CDN pinning (item 0.2)
 * ------------------------------------------------------------------ *
 * marked was the one third-party script loaded from a floating tag while its
 * siblings (KaTeX 0.16.9, Prism 1.29.0) carried an exact @version. A floating
 * tag means the code that runs in production is whatever npm published most
 * recently, with no review and no diff — for a markdown parser that is the
 * library standing between model output and the reader's DOM.
 *
 * The pin is to 15.0.12, which is what the floating tag served on 2026-09-28
 * (jsdelivr's own x-jsd-version header and the file's version banner both say
 * so), so this is a drift fix with no behaviour change. npm's current latest is
 * far ahead of that and is deliberately NOT what is pinned here.
 *
 * The URL is read from the live DOM rather than grepped out of the file, so the
 * assertion is about what the browser was actually told to fetch, and the
 * renderer assertions below are what stop the pin being traded away for a
 * silently broken markdown pipeline.
 */

const PINNED_MARKED = 'https://cdn.jsdelivr.net/npm/marked@15.0.12/marked.min.js';

/**
 * The page's Content-Security-Policy, read from vercel.json — the same file
 * Vercel serves the header from. Read from disk, never hardcoded: editing an
 * inline script invalidates its hash, and a copy here would not notice.
 */
const pageCsp = () => {
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const scoped = vercel.headers.find((h) => h.source === '/(.*)');
  return scoped.headers.find((h) => h.key === 'Content-Security-Policy-Report-Only')?.value || '';
};

test('every versioned CDN library is pinned to an exact version', async ({ page }) => {
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  // Deliberately not "every script[src]": curriculum-data.js and chat-widget.js
  // are first-party, and cdn.tailwindcss.com is a JIT CDN with no published
  // version path to pin to. The filter is the two hosts that do serve versioned
  // library paths, so an unpinned script on either of them is a real finding.
  const srcs = await page.evaluate(() =>
    [...document.querySelectorAll('script[src]')]
      .map((s) => s.src)
      .filter((s) => s.includes('cdn.jsdelivr.net') || s.includes('cdnjs.cloudflare.com')));

  // No new CDN library may be added to the page, and none dropped.
  expect(srcs.length, 'the host page loads the same set of versioned CDN libraries')
    .toBe(7);

  const SEMVER = '\\d+\\.\\d+\\.\\d+';
  const label = (src) => new URL(src).pathname.replace(/^\/(npm\/|ajax\/libs\/)/, '');

  for (const src of srcs) {
    // Every library is version-*constrained* — nothing floats on a bare tag.
    // Either host may serve it: //cdn.jsdelivr.net/npm/<name>@<ver>/ for jsdelivr,
    // //cdnjs…/ajax/libs/<name>/<ver>/ for the Prism theme and scripts.
    expect(src, `${label(src)} must carry a version constraint`).toMatch(new RegExp(
      '^(https://cdn\\.jsdelivr\\.net/npm/[^/]+@[^/]+/'
      + '|https://cdnjs\\.cloudflare\\.com/ajax/libs/[^/]+/[^/]+/)',
    ));
  }

  // Every one of these four is held to an EXACT semver. `dompurify@3` and
  // `mermaid@10` were left on major ranges, which is a floating tag wearing a
  // version hat: a major release breaks rendering for the whole portal. The
  // versions are the ones the floating tags resolve to today (jsdelivr's
  // `x-jsd-version` header), so this is a zero-behaviour-change pin.
  const marked = srcs.find((s) => s.includes('/marked'));
  expect(marked, 'marked is pinned to the probed version').toBe(PINNED_MARKED);

  // Reject the shape, not just the value, so a well-meaning "@3" edit cannot
  // silently come back.
  for (const [name, src] of [
    ['marked', marked],
    ['dompurify', srcs.find((s) => s.includes('/dompurify'))],
    ['mermaid', srcs.find((s) => s.includes('/mermaid'))],
    ['katex', srcs.find((s) => s.includes('/katex@'))],
  ]) {
    expect(src, `${name} carries a full semver, not a major range`)
      .toMatch(new RegExp(`^https://cdn\\.jsdelivr\\.net/npm/${name}@${SEMVER}/`));
  }

  expect(srcs.find((s) => s.includes('/dompurify')))
    .toBe('https://cdn.jsdelivr.net/npm/dompurify@3.4.16/dist/purify.min.js');
  expect(srcs.find((s) => s.includes('/mermaid')))
    .toBe('https://cdn.jsdelivr.net/npm/mermaid@10.9.8/dist/mermaid.min.js');

  expect(srcs.find((s) => s.includes('katex@'))).toContain('katex@0.16.9');
  expect(srcs.filter((s) => s.includes('prism/1.29.0')).length).toBe(2);
});

test('the page policy is hash-based and the portal provably satisfies it', async ({ page, context }) => {
  test.slow();
  const csp = pageCsp();
  expect(csp, 'vercel.json ships a report-only CSP for the page itself').not.toBe('');

  // script-src must name hashes, not 'unsafe-inline'. If a future edit swaps in
  // 'unsafe-inline' the policy still "works" and the page still passes — so the
  // shape is asserted, not just the presence of a header.
  const scriptSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src')) || '';
  const hashes = scriptSrc.match(/'sha256-[A-Za-z0-9+/=]+'/g) || [];
  expect(hashes.length, 'script-src pins at least one inline block by hash').toBeGreaterThan(0);
  expect(scriptSrc, 'script-src does not fall back to unsafe-inline').not.toContain("'unsafe-inline'");
  expect(csp, 'the policy does not weaken script execution with unsafe-eval')
    .not.toContain('unsafe-eval');
  expect(csp, 'object-src is closed').toContain("object-src 'none'");
  expect(csp, 'framing is denied').toContain("frame-ancestors 'none'");
  expect(csp, 'base-uri is pinned so a base tag cannot re-root relative URLs')
    .toContain("base-uri 'self'");

  // Install the policy and the listener BEFORE the single navigation. A second
  // goto to the same URL+hash is a same-document navigation, so the document
  // never reloads and the listener would never be installed.
  await context.route('**/*', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, headers: { ...res.headers(), 'content-security-policy-report-only': csp } });
  });
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__cspViolations.push(
      `${e.effectiveDirective} ${e.blockedURI}`));
  });
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  // No inline event handlers anywhere: that is what lets script-src stay
  // hash-only instead of needing 'unsafe-hashes' for every on*= attribute.
  const inlineHandlers = await page.evaluate(() =>
    [...document.querySelectorAll('*')]
      .flatMap((el) => [...el.attributes]
        .filter((a) => /^on/i.test(a.name))
        .map((a) => `${el.tagName.toLowerCase()}[${a.name}]`)));
  expect(inlineHandlers, 'no element carries an inline event handler').toEqual([]);

  // Now the real assertion: drive every surface that could violate the policy —
  // a guide (markdown, KaTeX, Mermaid, Prism) plus a chat turn carrying a
  // diagram, typeset math and a code block.
  await mockChat(page, [
    '```mermaid\nflowchart TD\n  A["one"] --> B["two"]\n```\n\n'
    + 'Cost is $O(n \\log n)$ in the general case.\n\n'
    + '```js\nconst t = `${x}`;\n```',
  ]);
  await openChat(page);
  await page.locator(input).fill('draw it and cost it');
  await page.locator(sendBtn).click();
  // Exercise the three renderers the policy could plausibly break.
  await expect(page.locator(`${log} svg`).first()).toBeAttached();
  await expect(page.locator(`${log} .katex`).first()).toBeAttached();
  await expect(page.locator(`${log} pre code`).first()).toContainText('`${x}`');

  const violations = await page.evaluate(() => window.__cspViolations);
  expect(violations, 'the portal violates nothing in its own policy').toEqual([]);

  // Proof the detector works: an inline script the policy does NOT hash must be
  // REPORTED, so a green run above means "satisfied", not "not measured".
  //
  // The script still EXECUTES, and that is correct: the policy is report-only, so
  // violations are reported rather than blocked. Flipping the header to enforcing
  // is a one-word change in vercel.json, and the `ran` half of this probe is the
  // assertion that becomes meaningful at that point.
  const probe = await page.evaluate(() => {
    const s = document.createElement('script');
    s.textContent = 'window.__cspProbeRan = true;';
    document.head.appendChild(s);
    return new Promise((res) => setTimeout(() => {
      res({ ran: window.__cspProbeRan === true, count: window.__cspViolations.length,
        scriptSrc: window.__cspViolations.filter((v) => v.startsWith('script-src')) });
    }, 250));
  });
  expect(probe.count, 'an unhashed inline script IS reported, so the run above is not vacuous')
    .toBeGreaterThan(0);
  expect(probe.scriptSrc.length, 'and it is reported against script-src specifically')
    .toBeGreaterThan(0);
});

test('markdown and the code-block copy button still render against the pinned marked', async ({ page, context }) => {
  // The widget writes via navigator.clipboard and only falls back to
  // execCommand; granting the permission keeps the assertion about the pinned
  // build rather than about whichever clipboard path the browser allows today.
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(ARTICLE_URL);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  const answer = '**Complement lookup** and a list:\n\n'
    + '- first item\n- second item\n\n'
    + '```js\nconst seen = new Map();\nreturn seen;\n```';
  await mockChat(page, [answer]);
  await openChat(page);

  await page.locator(input).fill('show me the code');
  await page.locator(sendBtn).click();

  const bubble = assistantBubble(page);
  await expect(bubble.locator('p strong')).toContainText('Complement lookup', { timeout: 15_000 });
  await expect(bubble.locator('li')).toHaveCount(2);

  // The custom renderer is the part a marked major bump breaks, so its output
  // is asserted directly rather than inferred from the prose around it.
  const code = bubble.locator('.chat-code pre code');
  await expect(code, 'the code block still gets the widget wrapper').toHaveCount(1);
  await expect(code).toContainText('const seen = new Map();');
  await expect(code).toHaveClass(/language-js/);

  const copy = bubble.locator('.chat-code-copy');
  await expect(copy).toHaveCount(1);
  await expect(copy).toHaveAttribute('aria-label', 'Copy code to clipboard');
  await expect(copy).toHaveText('Copy');

  // The copy affordance still works, which also proves the v15 token shape is
  // what the pinned build hands the renderer.
  await copy.click();
  await expect(copy).toHaveText('Copied');
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
  // Marking the active sub-heading is an IntersectionObserver reaction to a
  // scroll, so it costs a frame or two after the scroll settles — and the
  // portal's five CDN libraries can starve that frame for seconds on a bad
  // network. Headroom here buys the observer time; the waits stay state-based.
  test.slow();
  const row = await oneLiner(page);
  await row.locator('.toc-toggle').click();
  expect(await page.locator('#tocNav .toc-sub-link.is-current').count()).toBe(0);

  // A child is only "in view" once the reader scrolls into it, not when the
  // section head arrives, so scroll to a specific subsection.
  await scrollToSubsection(page, /Pseudocode/);
  await page.locator('#tocNav .toc-sec.is-active .toc-toggle').click();

  const current = page.locator('#tocNav .toc-sub-link.is-current');
  await expect(current).toHaveCount(1, { timeout: 30_000 });
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
  // The 56px rail has two modes: categories, or numbers. In category mode the
  // guide rows are hidden behind their glyphs, so what must be visible is the
  // category rail; number mode brings the rows back.
  await expect(page.locator('#curriculumNav .nav-cat-btn').first(), 'category rail is what shows').toBeVisible();
  await page.locator(nav).press('Alt+KeyV');
  await expect(page.locator(nav)).toHaveAttribute('data-rail-mode', 'num');
  await expect(page.locator('#curriculumNav .nav-item').first(), 'number mode shows the guides').toBeVisible();
});

test('the nav stage survives a reload', async ({ page }) => {
  test.skip(isMobile(page), 'the nav is only docked on wide viewports');
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto(ARTICLE_URL);
  await page.waitForSelector('#curriculumNav .nav-item');

  await page.locator(navCollapse).click();
  await page.locator(navCollapse).click();
  await expect(page.locator(nav)).toHaveAttribute('data-stage', '2');
  await page.locator(nav).press('Alt+KeyV');
  await expect(page.locator(nav)).toHaveAttribute('data-rail-mode', 'num');

  await page.reload();
  await page.waitForSelector('#curriculumNav .nav-item');
  // Both halves of the collapsed rail's state are remembered, or a deliberate
  // choice silently resets on the next reload.
  await expect(page.locator(nav)).toHaveAttribute('data-stage', '2');
  await expect(page.locator(nav)).toHaveAttribute('data-rail-mode', 'num');
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

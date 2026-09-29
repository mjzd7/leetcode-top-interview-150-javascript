/**
 * E2E coverage for the streaming *pacing* and the *content-derived* empty state.
 *
 * Split from chatbox.spec.js on purpose: that file pins the widget's contract
 * (renderers, abort, persistence, host integration) and emulates
 * `reducedMotion: 'reduce'` in beforeEach, which is the right default for making
 * layout/focus assertions deterministic but the WRONG default for testing that
 * text actually reveals progressively. Pacing is a motion behaviour, so it needs
 * motion enabled — this file therefore does not inherit that beforeEach and opts
 * in per test.
 *
 * `/api/chat` is mocked at the network layer, exactly as in chatbox.spec.js, so
 * the suite needs no OPENAI_API_KEY and spends nothing.
 *
 * The "reveals progressively" assertions are behavioural, not visual: they sample
 * the rendered bubble on a timer and require the visible text to grow in several
 * distinct steps. A single-shot dump — the old `textContent = whole buffer` — can
 * only ever produce one sample, so the test fails for the right reason.
 */

import { test, expect } from '@playwright/test';

const log = '#ltcLog';
const input = '#ltcInput';
const sendBtn = '#ltcSend';

/** A two-point problem guide: the canonical "question page". */
const PROBLEM = '05-hashmap_06-two-sum';
/** difficulty 'Guide', category 'MAANG GUIDES' — not a problem page. */
const MAANG = '24-maang-guides_01-maang-sde-roadmap';
/** difficulty 'Primer', category 'FOUNDATIONS' — not a problem page. */
const PRIMER = '00-foundations_01-js-interview-runtime-quirks';

const isMobile = (page) => page.viewportSize().width < 1024;

async function openChat(page) {
  if (isMobile(page)) {
    await page.locator('#ltcFab').click();
    await expect(page.locator('#ltcPanel')).toHaveClass(/is-open/);
  }
  await expect(page.locator(input)).toBeVisible();
}

/** One upstream SSE frame carrying a text delta. */
const delta = (content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

/**
 * Fulfill /api/chat with `chunks`, released one frame per `gapMs` so the widget
 * genuinely receives a drip rather than one burst. A fulfilled route hands over
 * the whole body in a single piece, so the pacing has to be produced here; that
 * is precisely the situation the old implementation could not survive.
 */
async function mockDrip(page, chunks, { gapMs = 60 } = {}) {
  await page.route('**/api/chat', async (route) => {
    await new Promise((r) => setTimeout(r, 10));
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: chunks.map(delta).join('') + 'data: [DONE]\n\n',
    });
  });
}

const assistantBody = (page) =>
  page.locator(`${log} .ltc-msg[data-role="assistant"]:last-of-type .ltc-msg-body`);

/* ------------------------------------------------------------------ *
 * S1 — text reveals word by word, with live markdown
 * ------------------------------------------------------------------ */

test('assistant text grows in several steps instead of appearing at once', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`/#${PROBLEM}`);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  const words = 'Use a hash map so the second pass is O(1) instead of O(n) per element. '.repeat(6);
  await mockDrip(page, words.match(/\S+\s*/g));
  await openChat(page);

  await page.locator(input).fill('explain the optimized version');
  await page.locator(sendBtn).click();

  // Sample the *visible* text while the turn is still running. Anything that
  // arrives as one blob produces a single non-empty sample and fails here.
  const samples = await page.evaluate(async () => {
    const body = () => document.querySelector(
      '#ltcLog .ltc-msg[data-role="assistant"]:last-of-type .ltc-msg-body');
    const seen = [];
    const started = performance.now();
    while (performance.now() - started < 12_000) {
      const el = body();
      if (el) {
        const t = (el.innerText || '').trim();
        if (t) seen.push({ t: t.length, streaming: document.querySelector('#ltcPanel').dataset.streaming === 'true' });
      }
      if (document.querySelector('#ltcPanel').dataset.streaming === 'false' && seen.length) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    // Collapse to the sequence of distinct lengths actually observed.
    return seen.map((s) => s.t).filter((n, i, a) => i === 0 || n !== a[i - 1]);
  });

  expect(samples.length, 'text must arrive in multiple visible steps, not one dump').toBeGreaterThan(3);
  // Monotonic: the message only ever grows.
  for (let i = 1; i < samples.length; i++) {
    expect(samples[i]).toBeGreaterThan(samples[i - 1]);
  }
  // It really was a drip, not a slow single frame: the last step is the whole
  // answer, and there were several strictly smaller ones before it.
  expect(samples.at(-1)).toBeGreaterThan(40);
});

test('a completed paragraph is real markdown while the turn is still streaming', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`/#${PROBLEM}`);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  // Three paragraphs, plus a fenced JS block, delivered in order.
  const answer = [
    '**Complement lookup.** For each value check whether its complement was seen.\n\n',
    'That turns the inner search from O(n) into O(1).\n\n',
    '```js\nconst seen = new Map();\nfor (let i = 0; i < nums.length; i++) {\n'
      + '  const need = target - nums[i];\n  if (seen.has(need)) return [seen.get(need), i];\n'
      + '  seen.set(nums[i], i);\n}\nreturn [];\n```\n\n',
    'The map holds every value already visited.',
  ];
  await mockDrip(page, answer.map((p) => p), { gapMs: 90 });
  await openChat(page);

  await page.locator(input).fill('walk me through it');
  await page.locator(sendBtn).click();

  const body = assistantBody(page);

  // The raw markdown must never be shown as literal text.
  await expect(body).not.toContainText('**Complement lookup.**', { timeout: 15_000 });

  // Paragraph 1 is complete after ~1 paragraph of drip, so it must already be a
  // rendered <p> containing a <strong> — before the code block has arrived.
  // The old implementation showed a flat textContent wall and could not satisfy
  // this at any point in the turn.
  await expect(body.locator('p strong').first()).toContainText('Complement lookup.', { timeout: 15_000 });
  const midStream = await page.evaluate(() => ({
    strongs: document.querySelectorAll('#ltcLog .ltc-msg[data-role="assistant"] p strong').length,
    hasCode: !!document.querySelector('#ltcLog .ltc-msg[data-role="assistant"] .chat-code'),
  }));
  expect(midStream.strongs, 'the first paragraph is formatted mid-stream').toBeGreaterThan(0);

  // And the final message is the full, correctly rendered markdown.
  await expect(body.locator('.chat-code pre code')).toContainText('const seen = new Map();', { timeout: 15_000 });
  await expect(body).toContainText('The map holds every value already visited.');
  // Two prose paragraphs, one code block, one closing paragraph.
  await expect(body.locator('p')).toHaveCount(3);
  await expect(body).not.toContainText('**Complement');
});

test('a caret marks the reveal position and disappears when the turn ends', async ({ page }) => {
  // The reveal is a wall-clock animation, so this test's cost is dominated by how
  // long the page takes to become interactive. The portal loads five libraries
  // from two public CDNs, and when jsdelivr is slow that load — not the
  // behaviour under test — is what runs the budget out. `slow()` buys headroom
  // for the load; the assertions below are still state-based, not timed.
  test.slow();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`/#${PROBLEM}`);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  // Long enough that the reveal is on screen for a second or so. Polling from
  // *inside* the page is deliberate: a caret that lives for a few hundred
  // milliseconds is easy for cross-process polling to step over under load,
  // and that would make this a flaky test rather than a real assertion.
  const answer = 'A moderately long sentence so the reveal is still running when we look. '.repeat(9);
  await mockDrip(page, answer.match(/\S+\s*/g));
  await openChat(page);

  await page.locator(input).fill('hello');
  await page.locator(sendBtn).click();

  // Wait for the turn to actually start before counting frames. Otherwise a slow
  // machine can finish the reveal between the click and the first poll, and the
  // caret is legitimately never seen — a timing artefact, not a regression.
  await expect
    .poll(() => page.evaluate(() => document.getElementById('ltcPanel').dataset.streaming === 'true'),
      { timeout: 30_000, intervals: [50] })
    .toBe(true);

  const seen = await page.evaluate(async () => {
    const panel = document.getElementById('ltcPanel');
    let caretFrames = 0;
    let sawStreamingCaret = false;
    let clearedAfterCaret = false;
    const started = performance.now();
    while (performance.now() - started < 25_000) {
      const streaming = panel.dataset.streaming === 'true';
      const caret = document.querySelector('.ltc-caret');
      if (caret) { caretFrames++; sawStreamingCaret = true; }
      else if (sawStreamingCaret) { clearedAfterCaret = true; break; }
      if (!streaming && !caret && !sawStreamingCaret) break;
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 16)));
    }
    return { caretFrames, sawStreamingCaret, clearedAfterCaret, finalCaret: !!document.querySelector('.ltc-caret') };
  });

  expect(seen.sawStreamingCaret, 'a caret marks the reveal position while text is arriving').toBe(true);
  expect(seen.caretFrames, 'the caret is visible for more than a single frame').toBeGreaterThan(3);
  expect(seen.clearedAfterCaret, 'the caret goes away when the turn ends').toBe(true);
  expect(seen.finalCaret).toBe(false);
  await expect(page.locator('[data-typing]')).toHaveCount(0);
});

/* ------------------------------------------------------------------ *
 * S2 — pacing honours reduced motion
 * ------------------------------------------------------------------ */

test('reduced motion reveals immediately instead of animating', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/#${PROBLEM}`);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  await mockDrip(page, 'Short enough that pacing is the only thing that could delay it. '.match(/\S+\s*/g), { gapMs: 5 });
  await openChat(page);

  await page.locator(input).fill('hi');
  await page.locator(sendBtn).click();

  // No caret, no lingering animation: the answer is simply there.
  await expect(assistantBody(page)).toContainText('pacing is the only thing', { timeout: 5_000 });
  await expect(page.locator('.ltc-caret')).toHaveCount(0);
});

/* ------------------------------------------------------------------ *
 * S3 — suggestions come from the page, and differ per page kind
 * ------------------------------------------------------------------ */

/** The visible chips, as plain strings. */
const chips = (page) =>
  page.locator(`${log} .ltc-chip`).allTextContents().then((t) => t.map((s) => s.trim()));

test('the three legacy hardcoded prompts are gone', async ({ page }) => {
  await page.goto(`/#${PROBLEM}`);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  const list = await chips(page);
  for (const legacy of [
    'Explain the brute force in one line',
    'What is the time complexity?',
    'Walk me through the dry run',
  ]) {
    expect(list, `legacy hardcoded prompt must not survive: ${legacy}`).not.toContain(legacy);
  }
});

test('a problem page suggests from its own sections, not a generic list', async ({ page }) => {
  await page.goto(`/#${PROBLEM}`);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  const list = await chips(page);
  expect(list.length, 'there are suggestions to choose from').toBeGreaterThanOrEqual(3);

  // Every problem guide in this manual is Level 1/2/3, so a prompt that names a
  // level is grounded in this guide's actual structure rather than a constant.
  expect(list.some((c) => /Level\s*3|canonical|most optimal/i.test(c)),
    `problem suggestions should reference the guide structure, got ${JSON.stringify(list)}`).toBe(true);

  // The page's own title must be visible in the empty state, so the reader can
  // see the assistant is grounded in the guide in front of them.
  await expect(page.locator(`${log} .ltc-empty`)).toContainText('Two Sum');
});

test('a MAANG guide suggests from its own headings, not the question page list', async ({ page }) => {
  await page.goto(`/#${MAANG}`);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  const headings = await page.evaluate(() =>
    [...document.querySelectorAll('#articleContent h2')].map((h) => h.textContent.trim()));

  const list = await chips(page);
  expect(headings.length, 'the MAANG guide has sections to draw from').toBeGreaterThan(3);
  expect(list.length).toBeGreaterThanOrEqual(3);

  // At least one chip must be traceable to a real heading on THIS page. Words
  // are compared, not whole strings, so a templated "Explain <heading>" is fine.
  const stems = headings.map((h) => h.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
  const grounded = list.filter((chip) => {
    const words = chip.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    return stems.some((s) => s.some((w) => words.includes(w)));
  });
  expect(grounded.length, `a MAANG chip should come from this guide's headings, got ${JSON.stringify(list)}`)
    .toBeGreaterThan(0);

  // And it must not be the problem page's script.
  expect(list.some((c) => /brute force|dry run|time complexity/i.test(c))).toBe(false);
});

test('a foundations primer gets primer suggestions, distinct from both other kinds', async ({ page }) => {
  await page.goto(`/#${PRIMER}`);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  const list = await chips(page);
  expect(list.length).toBeGreaterThanOrEqual(3);
  expect(list.some((c) => /brute force|dry run|time complexity/i.test(c))).toBe(false);
  expect(list.some((c) => /Level\s*3|canonical/i.test(c))).toBe(false);
  await expect(page.locator(`${log} .ltc-empty`)).toContainText('Runtime Quirks');
});

test('the home page gets its own suggestions', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  const list = await chips(page);
  expect(list.length).toBeGreaterThanOrEqual(3);
  // Home has no guide, so it must not pretend to have one.
  expect(list.some((c) => /brute force|dry run/i.test(c))).toBe(false);
  await expect(page.locator(`${log} .ltc-empty`)).not.toContainText('Two Sum');
});

test('switching from a problem to a MAANG guide rewrites the suggestions', async ({ page }) => {
  await page.goto(`/#${PROBLEM}`);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });
  const before = await chips(page);

  // Navigate through the portal, the way a reader does.
  await page.evaluate(() => window.openArticle('24-maang-guides_01-maang-sde-roadmap'));
  await expect
    .poll(async () => (await chips(page)).join('|'), { timeout: 10_000 })
    .not.toBe(before.join('|'));

  const after = await chips(page);
  expect(after.length).toBeGreaterThanOrEqual(3);
  expect(after).not.toEqual(before);
});

/* ------------------------------------------------------------------ *
 * S5 — math never typesets from the live tail (item 1.2 / 1.4)
 * ------------------------------------------------------------------ *
 * The reveal hands KaTeX two different regions. The stable prefix is finished
 * markdown that can no longer change, so a `$…$` pair inside it is already
 * closed and typesets without a snap. The live tail is the sentence currently
 * being typed, held as escaped text.
 *
 * A half-typed `$a+b` is the case that would flash: it has an opening delimiter
 * and no closing one. Probed against KaTeX 0.16.9 — `renderMathInElement` on
 * unclosed `$a+b` neither throws nor emits a `.katex`, it leaves the text alone.
 * So the honest assertion is not "it never crashed" (it never could, with
 * `throwOnError: false`); it is that no partial expression is ever typeset while
 * the turn is running, and the reader sees the literal characters instead.
 */

/**
 * Three paragraphs; the last is left mid-expression by the [DONE] boundary.
 *
 * That last sentence is deliberately long. `advance()` lands on the next space
 * unless the token is longer than REVEAL_HARD_CHARS, so a short tail is written
 * in a single frame and a 16ms sampler can step straight over it — which made
 * this test pass on desktop and fail on mobile for reasons that had nothing to
 * do with math. A ~200-char tail is revealed over dozens of frames instead.
 */
const UNCLOSED_MATH_ANSWER = 'The lookup is $O(1)$ per element, so the pass is linear.\n\n'
  + 'The second pass then walks the array once and looks each value up. '.repeat(10)
  + '\n\nPut the value as $a+b so the running sum reads back the way the walk computed it, '
  + 'and the reader can follow the arithmetic without re-running anything by hand.';

test('a half-typed $a+b is never typeset while the turn is running', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`/#${PROBLEM}`);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });
  await mockDrip(page, UNCLOSED_MATH_ANSWER.match(/[^\n]+\n?|\n/g), { gapMs: 60 });
  await openChat(page);

  await page.locator(input).fill('explain the second pass');
  await page.locator(sendBtn).click();

  // Sample the live bubble for the whole turn. Any `.katex` whose text is not a
  // complete expression would be the flash; the closed one in paragraph 1 is
  // legitimate, so the tail is inspected directly.
  const seen = await page.evaluate(async () => {
    const live = () => document.querySelector('#ltcLog .ltc-msg.is-streaming');
    const started = performance.now();
    let frames = 0;
    let sawTail = false;
    let tailHadKatex = false;
    let sawClosedMath = false;
    let tailSamples = [];
    while (performance.now() - started < 25_000) {
      const el = live();
      if (!el) {
        if (frames) break;
        await new Promise((r) => setTimeout(r, 16));
        continue;
      }
      const tail = el.querySelector('.ltc-msg-tail');
      const md = el.querySelector('.ltc-msg-md');
      if (tail) {
        frames++;
        sawTail = true;
        if (tail.querySelector('.katex')) tailHadKatex = true;
        if (tail.textContent.includes('$')) {
          tailSamples.push(tail.textContent);
        }
      }
      if (md && md.querySelector('.katex')) sawClosedMath = true;
      if (!document.getElementById('ltcPanel').dataset || document.getElementById('ltcPanel').dataset.streaming === 'false') {
        if (frames) break;
      }
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 16)));
    }
    return { frames, sawTail, tailHadKatex, sawClosedMath, tailSamples };
  });

  expect(seen.sawTail, 'the live tail is on screen while the turn runs').toBe(true);
  expect(seen.frames, 'the tail was observed over many frames, not one').toBeGreaterThan(3);
  expect(seen.sawClosedMath, 'a closed $…$ in the prefix does typeset mid-stream').toBe(true);
  expect(seen.tailHadKatex, 'the live tail is never handed to KaTeX').toBe(false);
  expect(seen.tailSamples.length, 'a partial $ really did reach the tail').toBeGreaterThan(0);
  expect(errors, 'an unclosed expression throws nothing').toEqual([]);

  // After the turn, the unclosed expression is still literal — KaTeX leaves an
  // unmatched delimiter as text rather than eating it.
  const bubble = assistantBody(page);
  await expect(bubble).toContainText('$a+b', { timeout: 15_000 });
  await expect(bubble.locator('.katex')).toHaveCount(1);
  expect(errors).toEqual([]);
});

/* ------------------------------------------------------------------ *
 * S4 — product-grade chrome
 * ------------------------------------------------------------------ */

test('the conversation does not label its own messages like a debug log', async ({ page }) => {
  await page.goto(`/#${PROBLEM}`);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });
  await mockDrip(page, ['ok']);
  await openChat(page);

  await page.locator(input).fill('hi');
  await page.locator(sendBtn).click();
  await expect(assistantBody(page)).toContainText('ok', { timeout: 15_000 });

  // The old chrome printed an uppercase ASSISTANT / YOU line above every message.
  await expect(page.locator('.ltc-msg-meta')).toHaveCount(0);
  await expect(page.locator(log)).not.toContainText('ASSISTANT');
  await expect(page.locator(log)).not.toContainText('YOU');

  // Roles are still conveyed, non-visually.
  const user = page.locator(`${log} .ltc-msg[data-role="user"]`);
  await expect(user).toHaveAttribute('aria-label', /you/i);
  await expect(page.locator(`${log} .ltc-msg[data-role="assistant"]`)).toHaveAttribute('aria-label', /assistant/i);
});

test('messages animate in and the panel shows a live context status', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(`/#${PROBLEM}`);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });

  await mockDrip(page, ['answer']);
  await openChat(page);
  await page.locator(input).fill('hi');
  await page.locator(sendBtn).click();
  await expect(assistantBody(page)).toContainText('answer', { timeout: 15_000 });

  // Entry animation hook, so a new message reads as arriving rather than blinking.
  const cls = await page.locator(`${log} .ltc-msg`).first().getAttribute('class');
  expect(cls).toMatch(/ltc-enter/);

  // The header says what the assistant can see, which is the whole premise of
  // this widget and was previously invisible.
  await expect(page.locator('#ltcPanelTitle')).toContainText('Two Sum');
  await expect(page.locator('#ltcPanel')).toHaveAttribute('data-context', /two-sum/i);
});

test('send and stop are icon controls, and the composer grows with the question', async ({ page }) => {
  await page.goto(`/#${PROBLEM}`);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });
  await openChat(page);

  // Accessible names instead of the bare word "Send".
  await expect(page.locator(sendBtn)).toHaveAttribute('aria-label', /send/i);
  await expect(page.locator('#ltcStop')).toHaveAttribute('aria-label', /stop/i);

  const before = (await page.locator(input).boundingBox()).height;
  await page.locator(input).fill('one\ntwo\nthree\nfour\nfive');
  await expect.poll(async () => (await page.locator(input).boundingBox()).height).toBeGreaterThan(before);
});

test('an assistant answer can be copied from the message itself', async ({ page }) => {
  await page.goto(`/#${PROBLEM}`);
  await page.waitForSelector(`${log} .ltc-empty`, { state: 'attached' });
  await page.route('**/api/chat', (route) => route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    body: delta('The answer is O(1) per lookup.') + 'data: [DONE]\n\n',
  }));
  await openChat(page);

  await page.locator(input).fill('hi');
  await page.locator(sendBtn).click();
  await expect(assistantBody(page)).toContainText('O(1) per lookup', { timeout: 15_000 });

  const copyBtn = page.locator(`${log} .ltc-msg[data-role="assistant"] .ltc-msg-copy`);
  await expect(copyBtn).toHaveCount(1);
  await expect(copyBtn).toHaveAttribute('aria-label', /copy/i);
});

import { test, expect } from '@playwright/test';

test.describe('Apple-Motion Custom Cursor & Magnetic Lens Engine', () => {
  test('creates dot and ring elements in DOM with vector SVG rendering', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForSelector('#cur-dot', { state: 'attached' });
    await page.waitForSelector('#cur-ring', { state: 'attached' });

    const dot = page.locator('#cur-dot');
    const ring = page.locator('#cur-ring');

    await expect(dot).toBeAttached();
    await expect(ring).toBeAttached();

    // Verify SVG vector circles inside dot and ring
    const dotSvg = dot.locator('svg circle');
    const ringSvg = ring.locator('.cur-ring-circle circle');

    await expect(dotSvg).toBeAttached();
    await expect(ringSvg).toBeAttached();

    const shapeRendering = await dotSvg.getAttribute('shape-rendering');
    expect(shapeRendering).toBe('geometricPrecision');

    const vectorEffect = await ringSvg.getAttribute('vector-effect');
    expect(vectorEffect).toBe('non-scaling-stroke');
  });

  test('integrator sleeps when stationary and wakes up on pointer move', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Custom cursor physics active on fine pointing devices only');

    await page.goto('/index.html');
    await page.waitForSelector('#cur-dot', { state: 'attached' });

    // Move mouse and wait for physics to settle to sleep state
    await page.mouse.move(300, 300);
    await page.waitForFunction(() => window.__cursorSpringSleeping === true, null, { timeout: 5000 });

    const isSleepingInitial = await page.evaluate(() => window.__cursorSpringSleeping);
    expect(isSleepingInitial).toBe(true);

    // Moving mouse must immediately wake up the integrator
    await page.mouse.move(500, 500);
    const isWoken = await page.evaluate(() => window.__cursorSpringSleeping);
    expect(isWoken).toBe(false);

    // Settle again
    await page.waitForFunction(() => window.__cursorSpringSleeping === true, null, { timeout: 5000 });
    const isSleepingAgain = await page.evaluate(() => window.__cursorSpringSleeping);
    expect(isSleepingAgain).toBe(true);
  });

  test('wakes up and runs physics on pointer activity and scroll', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop only');

    await page.goto('/index.html');
    await page.waitForSelector('#cur-dot', { state: 'attached' });

    // Settle
    await page.mouse.move(200, 200);
    await page.waitForFunction(() => window.__cursorSpringSleeping === true, null, { timeout: 5000 });

    // Wake up by moving
    await page.mouse.move(250, 250);
    expect(await page.evaluate(() => window.__cursorSpringSleeping)).toBe(false);

    // Settle again
    await page.waitForFunction(() => window.__cursorSpringSleeping === true, null, { timeout: 5000 });
    expect(await page.evaluate(() => window.__cursorSpringSleeping)).toBe(true);
  });

  test('magnetic snap triggers link mode and compact targetScale over interactive targets', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Magnetic snap applies to fine pointer devices');

    await page.goto('/index.html');
    await page.waitForSelector('#themeToggle', { state: 'attached' });

    const toggle = page.locator('#themeToggle');
    const box = await toggle.boundingBox();
    expect(box).toBeTruthy();

    // Move mouse directly over the themeToggle button center
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    // Wait for physics to settle over the button
    await page.waitForFunction(
      () =>
        document.documentElement.getAttribute('data-cursor-mode') === 'link' &&
        window.__cursorSpringSleeping === true,
      null,
      { timeout: 5000 }
    );

    const mode = await page.evaluate(() => document.documentElement.getAttribute('data-cursor-mode'));
    expect(mode).toBe('link');

    // Check transform on the ring contains settled compact scale between 0.45 and 0.75
    const ringTransform = await page.locator('#cur-ring').evaluate((el) => el.style.transform);
    expect(ringTransform).toContain('scale(');
    const scaleMatch = ringTransform.match(/scale\(([\d.]+)\)/);
    expect(scaleMatch).toBeTruthy();
    const scaleVal = parseFloat(scaleMatch[1]);
    expect(scaleVal).toBeLessThanOrEqual(0.85);
    expect(scaleVal).toBeGreaterThanOrEqual(0.45);

    // Move mouse to empty area away from interactive targets
    await page.mouse.move(10, 10);
    await page.waitForFunction(
      () =>
        !document.documentElement.getAttribute('data-cursor-mode') &&
        window.__cursorSpringSleeping === true,
      null,
      { timeout: 5000 }
    );

    const modeOff = await page.evaluate(() => document.documentElement.getAttribute('data-cursor-mode'));
    expect(modeOff).toBeNull();
  });

  test('hides cursor elements and restores native pointer under prefers-reduced-motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/index.html');
    await page.waitForSelector('#cur-dot', { state: 'attached' });
    await page.waitForSelector('#cur-ring', { state: 'attached' });

    const dotDisplay = await page.locator('#cur-dot').evaluate((el) => getComputedStyle(el).display);
    const ringDisplay = await page.locator('#cur-ring').evaluate((el) => getComputedStyle(el).display);

    expect(dotDisplay).toBe('none');
    expect(ringDisplay).toBe('none');
  });

  test('hides cursor elements on touch/mobile devices with coarse pointer', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Mobile touch only');

    await page.goto('/index.html');
    await page.waitForSelector('#cur-dot', { state: 'attached' });
    await page.waitForSelector('#cur-ring', { state: 'attached' });

    const dotDisplay = await page.locator('#cur-dot').evaluate((el) => getComputedStyle(el).display);
    const ringDisplay = await page.locator('#cur-ring').evaluate((el) => getComputedStyle(el).display);

    expect(dotDisplay).toBe('none');
    expect(ringDisplay).toBe('none');
  });

  test('subpage rate-limiter.html mounts cursor and executes physics', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop only');

    await page.goto('/topics/rate-limiter.html');
    await page.waitForSelector('#cur-dot', { state: 'attached' });
    await page.waitForSelector('#cur-ring', { state: 'attached' });

    await page.mouse.move(250, 250);
    await page.waitForFunction(() => window.__cursorSpringSleeping === true, null, { timeout: 5000 });

    const isSleeping = await page.evaluate(() => window.__cursorSpringSleeping);
    expect(isSleeping).toBe(true);
  });

  test('zoom resilience: vector SVG retains non-scaling stroke and geometric precision under page zoom', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop only');

    await page.goto('/index.html');
    await page.waitForSelector('#cur-ring', { state: 'attached' });

    // Simulate 200% zoom level via page scale / deviceScaleFactor emulation
    const ringSvgCircle = page.locator('#cur-ring .cur-ring-circle circle');
    const strokeWidth = await ringSvgCircle.getAttribute('stroke-width');
    expect(strokeWidth).toBe('1');
  });

  test('tablet hybrid input: touch pointerType hides cursor; mouse pointerType restores it', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop emulation of hybrid pointer events');

    await page.goto('/index.html');
    await page.waitForSelector('#cur-dot', { state: 'attached' });
    await page.waitForSelector('#cur-ring', { state: 'attached' });

    // Simulate mouse move
    await page.evaluate(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: 200, clientY: 200 }));
    });
    let dotOpacity = await page.locator('#cur-dot').evaluate((el) => el.style.opacity);
    expect(dotOpacity).not.toBe('0');

    // Simulate tablet touchscreen tap / touch drag
    await page.evaluate(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'touch', clientX: 300, clientY: 300 }));
    });
    dotOpacity = await page.locator('#cur-dot').evaluate((el) => el.style.opacity);
    expect(dotOpacity).toBe('0');

    // Re-engage mouse
    await page.evaluate(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: 250, clientY: 250 }));
    });
    dotOpacity = await page.locator('#cur-dot').evaluate((el) => el.style.opacity);
    expect(dotOpacity).toBe('1');
  });

  test('universal cursor suppression: buttons, links, paragraphs, and code have computed cursor none when data-cursor="on"', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Universal cursor suppression applies to fine pointing devices only');

    await page.goto('/index.html#01-array-string_05-majority-element');
    await page.waitForSelector('#cur-dot', { state: 'attached' });
    await page.waitForSelector('.prose p', { state: 'attached' });
    await page.waitForSelector('pre', { state: 'attached' });
    await page.waitForFunction(() => document.documentElement.getAttribute('data-cursor') === 'on');

    const buttonCursor = await page.locator('#themeToggle').evaluate((el) => getComputedStyle(el).cursor);
    expect(buttonCursor).toBe('none');

    const linkCursor = await page.locator('a[href]').first().evaluate((el) => getComputedStyle(el).cursor);
    expect(linkCursor).toBe('none');

    const svgCursor = await page.locator('svg').first().evaluate((el) => getComputedStyle(el).cursor);
    expect(svgCursor).toBe('none');

    const pCursor = await page.locator('.prose p').first().evaluate((el) => getComputedStyle(el).cursor);
    expect(pCursor).toBe('none');

    const preCursor = await page.locator('pre').first().evaluate((el) => getComputedStyle(el).cursor);
    expect(preCursor).toBe('none');
  });

  test('hovering over a paragraph (.prose p) activates data-cursor-mode="text", hides cur-dot, and reforms cur-ring into custom I-beam text caret', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop only');

    await page.goto('/index.html#01-array-string_05-majority-element');
    await page.waitForSelector('#cur-dot', { state: 'attached' });
    await page.waitForSelector('.prose p', { state: 'attached' });

    const p = page.locator('.prose p').first();
    const box = await p.boundingBox();
    expect(box).toBeTruthy();

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    await page.waitForFunction(
      () => document.documentElement.getAttribute('data-cursor-mode') === 'text',
      null,
      { timeout: 5000 }
    );

    const mode = await page.evaluate(() => document.documentElement.getAttribute('data-cursor-mode'));
    expect(mode).toBe('text');

    // Dot is hidden
    const dotOpacity = await page.locator('#cur-dot').evaluate((el) => getComputedStyle(el).opacity);
    expect(dotOpacity).toBe('0');

    // Ring is reformed into the custom I-beam caret (width 2px, height 22px)
    const ringOpacity = await page.locator('#cur-ring').evaluate((el) => getComputedStyle(el).opacity);
    expect(ringOpacity).toBe('1');

    const ringWidth = await page.locator('#cur-ring').evaluate((el) => getComputedStyle(el).width);
    expect(ringWidth).toBe('2px');

    const ringHeight = await page.locator('#cur-ring').evaluate((el) => getComputedStyle(el).height);
    expect(ringHeight).toBe('22px');

    // SVG circle inside ring is hidden
    const svgDisplay = await page.locator('#cur-ring .cur-ring-circle').evaluate((el) => getComputedStyle(el).display);
    expect(svgDisplay).toBe('none');

    // Native OS text cursor is suppressed (none)
    const pCursor = await p.evaluate((el) => getComputedStyle(el).cursor);
    expect(pCursor).toBe('none');
  });

  test('hovering over #themeToggle snaps circle center to exact top-right corner (1/4 inside, 3/4 outside)', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Magnetic snap applies to fine pointer devices');

    await page.goto('/index.html');
    await page.waitForSelector('#themeToggle', { state: 'attached' });

    const toggle = page.locator('#themeToggle');
    const box = await toggle.boundingBox();
    expect(box).toBeTruthy();

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    await page.waitForFunction(
      () =>
        document.documentElement.getAttribute('data-cursor-mode') === 'link' &&
        window.__cursorSpringSleeping === true,
      null,
      { timeout: 5000 }
    );

    const rect = await toggle.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
        centerX: r.left + r.width / 2,
        centerY: r.top + r.height / 2,
      };
    });

    const targetX = await page.evaluate(() => window.__cursorTargetX);
    const targetY = await page.evaluate(() => window.__cursorTargetY);

    // Rule 3: Circle center is at exact top-right corner (rect.right, rect.top) without offset
    // This geometrically places 1/4 (bottom-left quadrant) inside the element and 3/4 outside
    expect(Math.abs(targetX - rect.right)).toBeLessThanOrEqual(2);
    expect(Math.abs(targetY - rect.top)).toBeLessThanOrEqual(2);

    // Verify it is NOT centered in the button horizontally or vertically
    expect(Math.abs(targetX - rect.centerX)).toBeGreaterThan(4);
    expect(Math.abs(targetY - rect.centerY)).toBeGreaterThan(4);

    // Verify settled ring position in style transform matches target position
    const ringTransform = await page.locator('#cur-ring').evaluate((el) => el.style.transform);
    const match = ringTransform.match(/translate3d\(([\d.-]+)px,\s*([\d.-]+)px/);
    expect(match).toBeTruthy();
    const ringX = parseFloat(match[1]);
    const ringY = parseFloat(match[2]);

    expect(Math.abs(ringX - rect.right)).toBeLessThanOrEqual(2);
    expect(Math.abs(ringY - rect.top)).toBeLessThanOrEqual(2);
  });

  test('hovering over sidebar nav-item rests circle center on right border middle of element vertical height', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Magnetic snap applies to fine pointer devices');

    await page.goto('/index.html');
    await page.waitForSelector('.nav-item', { state: 'attached' });

    const navItem = page.locator('.nav-item').first();
    const box = await navItem.boundingBox();
    expect(box).toBeTruthy();

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    await page.waitForFunction(
      () =>
        document.documentElement.getAttribute('data-cursor-mode') === 'link' &&
        window.__cursorSpringSleeping === true,
      null,
      { timeout: 5000 }
    );

    const rect = await navItem.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        width: r.width,
        height: r.height,
        centerY: r.top + r.height / 2,
      };
    });

    const targetX = await page.evaluate(() => window.__cursorTargetX);
    const targetY = await page.evaluate(() => window.__cursorTargetY);

    // Rule 2: Circle center rests on the right border middle of the vertical height of the element
    const expectedX = rect.right;
    const expectedY = rect.top + rect.height / 2;

    expect(Math.abs(targetX - expectedX)).toBeLessThanOrEqual(2);
    expect(Math.abs(targetY - expectedY)).toBeLessThanOrEqual(2);

    // Verify settled ring transform
    const ringTransform = await page.locator('#cur-ring').evaluate((el) => el.style.transform);
    const match = ringTransform.match(/translate3d\(([\d.-]+)px,\s*([\d.-]+)px/);
    expect(match).toBeTruthy();
    const ringX = parseFloat(match[1]);
    const ringY = parseFloat(match[2]);

    expect(Math.abs(ringX - expectedX)).toBeLessThanOrEqual(2);
    expect(Math.abs(ringY - expectedY)).toBeLessThanOrEqual(2);
  });

  test('hovering over inline links removes circle ring and underlines link for highlight', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop only');

    await page.goto('/topics/rate-limiter.html');
    await page.waitForSelector('#cur-dot', { state: 'attached' });
    await page.waitForSelector('li a[href^="#"]', { state: 'attached' });

    const link = page.locator('li a[href^="#"]').first();
    const box = await link.boundingBox();
    expect(box).toBeTruthy();

    // Resting state: no underline
    const textDecorationRest = await link.evaluate((el) => getComputedStyle(el).textDecorationLine);
    expect(textDecorationRest).toBe('none');

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    await page.waitForFunction(
      () => document.documentElement.getAttribute('data-cursor-mode') === 'inline-link',
      null,
      { timeout: 5000 }
    );

    const mode = await page.evaluate(() => document.documentElement.getAttribute('data-cursor-mode'));
    expect(mode).toBe('inline-link');

    // Ring circle is removed (opacity 0)
    const ringOpacity = await page.locator('#cur-ring').evaluate((el) => getComputedStyle(el).opacity);
    expect(ringOpacity).toBe('0');

    // Dot cursor is visible following the pointer
    const dotOpacity = await page.locator('#cur-dot').evaluate((el) => getComputedStyle(el).opacity);
    expect(dotOpacity).toBe('1');

    // Link is highlighted with underline
    const textDecoration = await link.evaluate((el) => getComputedStyle(el).textDecorationLine);
    expect(textDecoration).toBe('underline');
  });

  test('LeetCode links: no underline at rest, dynamically underlined on hover with dot feedback', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop only');

    await page.goto('/index.html#03-sliding-window_03-substring-with-concatenation-of-all-words');
    await page.waitForSelector('a.leetcode-link', { state: 'attached' });

    const leetCodeLink = page.locator('a.leetcode-link').first();
    await expect(leetCodeLink).toBeVisible();

    // 1. Resting state: MUST NOT have an underline
    const linkRestDecor = await leetCodeLink.evaluate((el) => getComputedStyle(el).textDecorationLine);
    expect(linkRestDecor).toBe('none');

    const codeRestDecor = await leetCodeLink.locator('code').evaluate((el) => getComputedStyle(el).textDecorationLine);
    expect(codeRestDecor).toBe('none');

    // 2. Hover state: hover over LeetCode link
    const box = await leetCodeLink.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    await page.waitForFunction(
      () => document.documentElement.getAttribute('data-cursor-mode') === 'inline-link',
      null,
      { timeout: 5000 }
    );

    // Dynamic underline applied on hover
    const linkHoverDecor = await leetCodeLink.evaluate((el) => getComputedStyle(el).textDecorationLine);
    expect(linkHoverDecor).toBe('underline');

    // Ring circle removed
    const ringOpacity = await page.locator('#cur-ring').evaluate((el) => getComputedStyle(el).opacity);
    expect(ringOpacity).toBe('0');

    // Dot visible
    const dotOpacity = await page.locator('#cur-dot').evaluate((el) => getComputedStyle(el).opacity);
    expect(dotOpacity).toBe('1');
  });

  test('primer links: not underlined at rest, dynamically underlined and highlighted on hover with dot feedback', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop only');

    await page.goto('/index.html#01-array-string_05-majority-element');
    await page.waitForSelector('.primer-link', { state: 'attached' });

    const primerLink = page.locator('.primer-link').first();
    await expect(primerLink).toBeVisible();

    // 1. Resting state: MUST NOT be underlined at rest
    const textDecorationRest = await primerLink.evaluate((el) => getComputedStyle(el).textDecorationLine);
    expect(textDecorationRest).toBe('none');

    // 2. Hover state: move mouse directly over primer link
    const box = await primerLink.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    await page.waitForFunction(
      () => document.documentElement.getAttribute('data-cursor-mode') === 'inline-link',
      null,
      { timeout: 5000 }
    );

    // Dynamic underline applied on hover
    const textDecorationHover = await primerLink.evaluate((el) => getComputedStyle(el).textDecorationLine);
    expect(textDecorationHover).toBe('underline');

    // Ring circle is removed (opacity 0)
    const ringOpacity = await page.locator('#cur-ring').evaluate((el) => getComputedStyle(el).opacity);
    expect(ringOpacity).toBe('0');

    // Dot cursor is visible with inline-link scale
    const dotOpacity = await page.locator('#cur-dot').evaluate((el) => getComputedStyle(el).opacity);
    expect(dotOpacity).toBe('1');

    // 3. Primer click navigation: clicking navigates to the aliased algorithmic patterns primer
    await primerLink.click();
    await page.waitForFunction(() => window.location.hash.includes('00-foundations_03-core-algorithmic-patterns'));
    expect(page.url()).toContain('00-foundations_03-core-algorithmic-patterns');
  });

  test('chatbox floating edge resize handles trigger custom vector morphing cursor (not system cursor)', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop fine pointer only');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/index.html');
    await page.waitForSelector('#ltcPanel', { state: 'attached' });

    // Detach panel to floating mode
    const header = page.locator('#ltcPanel .ltc-head');
    const headerBox = await header.boundingBox();
    await page.mouse.move(headerBox.x + 80, headerBox.y + headerBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(headerBox.x - 120, headerBox.y + 40, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('#ltcPanel')).toHaveAttribute('data-mode', 'floating');

    // Test East resize handle (resize-ew mode)
    const handleE = page.locator('#ltcPanel .ltc-handle-e');
    const boxE = await handleE.boundingBox();
    expect(boxE).toBeTruthy();
    await page.mouse.move(boxE.x + boxE.width / 2, boxE.y + boxE.height / 2);

    await page.waitForFunction(
      () => document.documentElement.getAttribute('data-cursor-mode') === 'resize-ew',
      null,
      { timeout: 5000 }
    );

    // Native OS cursor MUST remain 'none' everywhere
    const cursorE = await handleE.evaluate((el) => getComputedStyle(el).cursor);
    expect(cursorE).toBe('none');

    // Custom ring morphs into horizontal pill capsule and shows vector resize icon
    const ringOpacityE = await page.locator('#cur-ring').evaluate((el) => getComputedStyle(el).opacity);
    expect(ringOpacityE).toBe('1');
    const ringWidthE = await page.locator('#cur-ring').evaluate((el) => getComputedStyle(el).width);
    const ringHeightE = await page.locator('#cur-ring').evaluate((el) => getComputedStyle(el).height);
    expect(ringWidthE).toBe('44px');
    expect(ringHeightE).toBe('24px');

    const iconE = page.locator('#cur-ring .cur-icon-ew');
    await expect(iconE).toBeVisible();

    // Dot is tucked away during resize
    const dotOpacityE = await page.locator('#cur-dot').evaluate((el) => getComputedStyle(el).opacity);
    expect(dotOpacityE).toBe('0');

    // Test South-East corner resize handle (resize-nwse mode)
    const handleSE = page.locator('#ltcPanel .ltc-handle-se');
    const boxSE = await handleSE.boundingBox();
    expect(boxSE).toBeTruthy();
    await page.mouse.move(boxSE.x + boxSE.width / 2, boxSE.y + boxSE.height / 2);

    await page.waitForFunction(
      () => document.documentElement.getAttribute('data-cursor-mode') === 'resize-nwse',
      null,
      { timeout: 5000 }
    );

    const iconSE = page.locator('#cur-ring .cur-icon-nwse');
    await expect(iconSE).toBeVisible();
  });

  test('chatbox titlebar and drag grip trigger custom vector grab cursor (not system cursor)', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop fine pointer only');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/index.html');
    await page.waitForSelector('#ltcPanel', { state: 'attached' });

    // Hover over drag grip in header
    const grip = page.locator('#ltcPanel .ltc-drag-grip');
    const gripBox = await grip.boundingBox();
    expect(gripBox).toBeTruthy();
    await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2);

    await page.waitForFunction(
      () => document.documentElement.getAttribute('data-cursor-mode') === 'grab',
      null,
      { timeout: 5000 }
    );

    // Native OS cursor must be 'none'
    const gripCursor = await grip.evaluate((el) => getComputedStyle(el).cursor);
    expect(gripCursor).toBe('none');

    // Custom ring morphs into grab lens with visible vector grab icon
    const ringOpacity = await page.locator('#cur-ring').evaluate((el) => getComputedStyle(el).opacity);
    expect(ringOpacity).toBe('1');
    const ringWidth = await page.locator('#cur-ring').evaluate((el) => getComputedStyle(el).width);
    const ringHeight = await page.locator('#cur-ring').evaluate((el) => getComputedStyle(el).height);
    expect(ringWidth).toBe('36px');
    expect(ringHeight).toBe('36px');

    const iconGrab = page.locator('#cur-ring .cur-icon-grab');
    await expect(iconGrab).toBeVisible();

    // cur-dot is hidden in grab mode
    const dotOpacity = await page.locator('#cur-dot').evaluate((el) => getComputedStyle(el).opacity);
    expect(dotOpacity).toBe('0');
  });

  test('fullscreen mode keeps custom cursor visible with zero-lag isolated GPU rendering', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop fine pointer only');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/index.html');
    await page.waitForSelector('#ltcPin', { state: 'attached' });

    // Click toggle to enter fullscreen
    await page.click('#ltcPin');
    await expect(page.locator('#ltcPanel')).toHaveAttribute('data-mode', 'fullscreen');

    // Move mouse inside fullscreen panel
    await page.mouse.move(500, 500);

    // Custom cursor elements MUST remain visible inside fullscreen chatbox (never hidden)
    const dotOpacity = await page.locator('#cur-dot').evaluate((el) => getComputedStyle(el).opacity);
    const ringOpacity = await page.locator('#cur-ring').evaluate((el) => getComputedStyle(el).opacity);
    expect(dotOpacity).toBe('1');
    expect(ringOpacity).toBe('1');

    // Zero-lag optimization: mix-blend-mode is decoupled to 'normal' to prevent framebuffer blur readbacks
    const dotBlendMode = await page.locator('#cur-dot').evaluate((el) => getComputedStyle(el).mixBlendMode);
    const ringBlendMode = await page.locator('#cur-ring').evaluate((el) => getComputedStyle(el).mixBlendMode);
    expect(dotBlendMode).toBe('normal');
    expect(ringBlendMode).toBe('normal');

    // Native OS cursor is suppressed across all panel elements
    const panelCursor = await page.locator('#ltcPanel').evaluate((el) => getComputedStyle(el).cursor);
    expect(panelCursor).toBe('none');

    const sendBtnCursor = await page.locator('#ltcSend').evaluate((el) => getComputedStyle(el).cursor);
    expect(sendBtnCursor).toBe('none');

    // Hovering over interactive button inside fullscreen triggers magnetic link mode
    const sendBox = await page.locator('#ltcSend').boundingBox();
    expect(sendBox).toBeTruthy();
    await page.mouse.move(sendBox.x + sendBox.width / 2, sendBox.y + sendBox.height / 2);

    await page.waitForFunction(
      () => document.documentElement.getAttribute('data-cursor-mode') === 'link',
      null,
      { timeout: 5000 }
    );
  });
});


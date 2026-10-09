import { test, expect } from '@playwright/test';

const open = async (page, id) => {
  await page.goto(id ? '/#' + id : '/');
  await page.waitForSelector('#curriculumNav .nav-item', { state: 'attached' });
  await page.waitForTimeout(300);
};

test.describe('Architecture Integration Suite', () => {
  test('header architecture button is removed completely', async ({ page }) => {
    await open(page, '');
    const archBtn = page.locator('#archBtn');
    await expect(archBtn).toHaveCount(0);
  });

  test('base of the page features architecture section with direct links and buttons', async ({ page }) => {
    await open(page, '');
    const footerLink = page.locator('#footerArchSuiteLink');
    const footerSpecBtn = page.locator('#footerArchSpecBtn');
    const footerMatrixBtn = page.locator('#footerEdgeMatrixBtn');

    await expect(footerLink).toBeVisible();
    await expect(footerLink).toHaveAttribute('href', 'ARCHITECTURE_AND_DECISIONS.html');
    await expect(footerSpecBtn).toBeVisible();
    await expect(footerMatrixBtn).toBeVisible();

    // Clicking 15 ADRs Spec opens in-reader spec
    await footerSpecBtn.click();
    await page.waitForTimeout(300);
    await expect(page.locator('article h1')).toContainText('Architecture, Technical Decisions & Engineering Governance');

    // Clicking 24-Ch Matrix opens verification matrix
    await footerMatrixBtn.click();
    await page.waitForTimeout(300);
    await expect(page.locator('article h1')).toContainText('Algorithmic & UI Edge-Case Matrix');
  });

  test('no pop-up modal exists on the page', async ({ page }) => {
    await open(page, '');
    const archModal = page.locator('#archModal');
    await expect(archModal).toHaveCount(0);
  });

  test('command palette indexes architecture spec, visualizer tabs, and ADRs', async ({ page }) => {
    await open(page, '00-foundations_01-js-interview-runtime-quirks');

    // Open Command-K palette via button or keyboard
    await page.click('#paletteBtn');
    const palette = page.locator('#palette');
    await expect(palette).toBeVisible();

    const input = page.locator('#paletteInput');
    await input.fill('ADR-01');
    await page.waitForTimeout(300);

    const results = page.locator('#paletteList .pal-item');
    await expect(results.first()).toBeVisible();
    await expect(results.first()).toContainText('ADR-01');

    // Pressing enter on an ADR item opens the spec article
    await input.press('Enter');
    await expect(palette).toBeHidden();
    await expect(page.locator('article h1')).toContainText('Architecture, Technical Decisions & Engineering Governance');
  });

  test('in-reader architecture and edge cases badges work cleanly without popup', async ({ page }) => {
    await open(page, '08-linked-list_06-reverse-nodes-in-k-group');

    const headArchBtn = page.locator('#headArchBtn');
    const headEdgeBtn = page.locator('#headEdgeBtn');
    await expect(headArchBtn).toBeVisible();
    await expect(headEdgeBtn).toBeVisible();

    // Click headArchBtn navigates directly to architecture spec (no modal)
    await headArchBtn.click();
    await page.waitForTimeout(300);
    await expect(page.locator('article h1')).toContainText('Architecture, Technical Decisions & Engineering Governance');

    // Click headEdgeBtn navigates to edge-cases-matrix
    await headEdgeBtn.click();
    await page.waitForTimeout(300);
    await expect(page.locator('article h1')).toContainText('Algorithmic & UI Edge-Case Matrix');
  });

  test('architecture suite page mounts custom cursor, theme sync, and supports keyboard controls', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Custom cursor is desktop pointer fine-tuned');
    await page.goto('/ARCHITECTURE_AND_DECISIONS.html');
    await page.waitForTimeout(500);

    // 1. Cursor elements mount and active
    const curDot = page.locator('#cur-dot');
    const curRing = page.locator('#cur-ring');
    await expect(curDot).toBeAttached();
    await expect(curRing).toBeAttached();
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-cursor'))).toBe('on');

    // 2. Cursor suppresses native pointer on interactive targets
    const toggleBtn = page.locator('#themeToggleBtn');
    await toggleBtn.hover();
    await page.waitForTimeout(200);
    expect(await toggleBtn.evaluate(el => getComputedStyle(el).cursor)).toBe('none');
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-cursor-mode'))).toBe('link');

    // 3. Hover over paragraph activates text caret
    const heroDesc = page.locator('.hero-description');
    await heroDesc.hover();
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-cursor-mode'))).toBe('text');

    // 4. Keyboard shortcut '/' focuses search input
    await page.keyboard.press('/');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('toolSearchInput');

    // 5. Section jumping via 'n' and 'p'
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('n');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.location.hash)).toBe('#visual-suite');

    await page.keyboard.press('p');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.location.hash)).toBe('#overview');
  });

  test('Archify visualizer suite embeds interactive diagrams with zoom and fullscreen controls', async ({ page }) => {
    await page.goto('/ARCHITECTURE_AND_DECISIONS.html');
    await page.waitForTimeout(500);

    // Verify all 4 archify iframes are present with valid src
    const iframes = page.locator('.archify-iframe');
    await expect(iframes).toHaveCount(4);

    const frameArch = page.locator('#frame-arch');
    await expect(frameArch).toHaveAttribute('src', 'architecture/molly-system-architecture.html');

    const frameSeq = page.locator('#frame-seq');
    await expect(frameSeq).toHaveAttribute('src', 'architecture/molly-chat-streaming.html');

    const frameFlow = page.locator('#frame-flow');
    await expect(frameFlow).toHaveAttribute('src', 'architecture/molly-dryrun-pipeline.html');

    const frameLife = page.locator('#frame-life');
    await expect(frameLife).toHaveAttribute('src', 'architecture/molly-verification-lifecycle.html');

    // Verify zoom toolbar buttons exist
    const zoomInBtns = page.locator('.archify-zoom-in');
    const zoomOutBtns = page.locator('.archify-zoom-out');
    const zoomResetBtns = page.locator('.archify-zoom-reset');
    const fullscreenBtns = page.locator('.archify-fullscreen');
    const launchBtns = page.locator('.archify-launch');

    await expect(zoomInBtns).toHaveCount(4);
    await expect(zoomOutBtns).toHaveCount(4);
    await expect(zoomResetBtns).toHaveCount(4);
    await expect(fullscreenBtns).toHaveCount(4);
    await expect(launchBtns).toHaveCount(4);

    // Verify initial zoom badge shows 100%
    const firstBadge = page.locator('.zoom-badge').first();
    await expect(firstBadge).toHaveText('100%');

    // Test tab switching
    const seqTabBtn = page.locator('.diagram-tab-btn[data-tab="tab-seq"]');
    await seqTabBtn.click();
    await expect(page.locator('#tab-seq')).toHaveClass(/active/);
    await expect(page.locator('#tab-arch')).not.toHaveClass(/active/);
  });

  test('no unparsed LaTeX dollar signs exist in architecture markup', async ({ page }) => {
    await page.goto('/ARCHITECTURE_AND_DECISIONS.html');
    await page.waitForTimeout(500);

    // Check DOM text for any stray LaTeX formulas like $...$ or $$...$$
    const rawDollarMatches = await page.evaluate(() => {
      // Exclude script tags and check main content
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const matches = [];
      let node;
      while ((node = walker.nextNode())) {
        if (node.parentElement?.tagName === 'SCRIPT' || node.parentElement?.tagName === 'STYLE') {
          continue;
        }
        const text = node.textContent || '';
        // Match expressions between dollar signs like $O(1)$ or $10^6$
        const found = text.match(/\$[a-zA-Z0-9\\^_{}\s+-\/()=><]+\$/g);
        if (found) {
          matches.push({ text, found });
        }
      }
      return matches;
    });

    expect(rawDollarMatches).toEqual([]);
  });
});


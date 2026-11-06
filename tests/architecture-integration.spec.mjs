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
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('searchInput');

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
    await expect(frameArch).toHaveAttribute('src', 'architecture/system-architecture.html');

    const frameSeq = page.locator('#frame-seq');
    await expect(frameSeq).toHaveAttribute('src', 'architecture/chat-streaming.html');

    const frameFlow = page.locator('#frame-flow');
    await expect(frameFlow).toHaveAttribute('src', 'architecture/dryrun-pipeline.html');

    const frameLife = page.locator('#frame-life');
    await expect(frameLife).toHaveAttribute('src', 'architecture/verification-lifecycle.html');

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

  test('left navigation bar supports 3 collapse stages, Alt+V dual rail modes, and category reveal', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Sidebar collapse stages are desktop rail features');
    await page.goto('/ARCHITECTURE_AND_DECISIONS.html');
    await page.waitForTimeout(500);

    const sidebar = page.locator('#sidebar');
    const collapseBtn = page.locator('#ltNavCollapse');

    // 1. Initial stage is 0
    expect(await sidebar.getAttribute('data-stage')).toBe('0');

    // 2. Stage cycle: 0 -> 1 -> 2 -> 0
    await collapseBtn.click();
    await page.waitForTimeout(100);
    expect(await sidebar.getAttribute('data-stage')).toBe('1');
    expect(await page.evaluate(() => localStorage.getItem('lt150-nav-stage'))).toBe('1');

    await collapseBtn.click();
    await page.waitForTimeout(100);
    expect(await sidebar.getAttribute('data-stage')).toBe('2');
    expect(await page.evaluate(() => localStorage.getItem('lt150-nav-stage'))).toBe('2');

    // In stage 2, metric ring block should be hidden
    expect(await page.locator('#ringBlock').evaluate(el => el.classList.contains('hidden'))).toBe(true);

    // 3. Alt+V toggles rail mode between 'cat' and 'num'
    expect(await sidebar.getAttribute('data-rail-mode')).toBe('cat');
    await page.keyboard.press('Alt+v');
    await page.waitForTimeout(100);
    expect(await sidebar.getAttribute('data-rail-mode')).toBe('num');
    expect(await page.evaluate(() => localStorage.getItem('lt150-rail-mode'))).toBe('num');

    await page.keyboard.press('Alt+v');
    await page.waitForTimeout(100);
    expect(await sidebar.getAttribute('data-rail-mode')).toBe('cat');

    // 4. Clicking category glyph in stage 2 reveals category and widens to stage 0
    const catBtn = page.locator('.nav-cat-btn[data-cat="adrs"]').first();
    await catBtn.click();
    await page.waitForTimeout(200);
    expect(await sidebar.getAttribute('data-stage')).toBe('0');

    // 5. Cycling from stage 2 returns to stage 0
    await collapseBtn.click(); // 0 -> 1
    await collapseBtn.click(); // 1 -> 2
    expect(await sidebar.getAttribute('data-stage')).toBe('2');
    await collapseBtn.click(); // 2 -> 0
    expect(await sidebar.getAttribute('data-stage')).toBe('0');
  });

  test('sidebar search and filter pills dynamically filter navigation items and show empty state', async ({ page, isMobile }) => {
    await page.goto('/ARCHITECTURE_AND_DECISIONS.html');
    await page.waitForTimeout(500);

    if (isMobile) {
      await page.locator('#menuBtn').click();
      await page.waitForTimeout(200);
    }

    const searchInput = page.locator('#searchInput');

    // Filter for "Euler"
    await searchInput.fill('Euler');
    await page.waitForTimeout(100);

    const physicsLabLink = page.locator('#curriculumNav a[href="#physics-lab"]');
    const overviewLink = page.locator('#curriculumNav a[href="#overview"]');
    await expect(physicsLabLink).toBeVisible();
    await expect(overviewLink).toBeHidden();

    // Clear search and test filter pill "ADRs"
    await searchInput.fill('');
    const adrsPill = page.locator('#difficultyFilters button[data-filter="adrs"]');
    await adrsPill.click();
    await page.waitForTimeout(100);

    const decisionsLink = page.locator('#curriculumNav a[href="#decisions"]');
    await expect(decisionsLink).toBeVisible();
    await expect(physicsLabLink).toBeHidden();

    // Reset to "All"
    const allPill = page.locator('#difficultyFilters button[data-filter="all"]');
    await allPill.click();
    await page.waitForTimeout(100);
    await expect(overviewLink).toBeVisible();

    // Non-existent search shows empty state
    await searchInput.fill('xyznonexistentquery999');
    await page.waitForTimeout(100);
    const emptyState = page.locator('#navEmptyState');
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toHaveText('No matching sections found');
  });

  test('chat assistant rail supports keyboard shortcut c, resizer drag/keys, and context sync', async ({ page, isMobile }) => {
    test.skip(isMobile, 'Desktop chat rail and keyboard shortcuts');
    await page.goto('/ARCHITECTURE_AND_DECISIONS.html');
    await page.waitForTimeout(500);

    // 1. Pressing 'c' focuses the chat input
    await page.keyboard.press('c');
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => document.activeElement?.id)).toBe('ltcInput');

    // 2. Rail resizer handles arrow keys to adjust --lt-rail-w
    const handle = page.locator('#ltRailResizer');
    const initialW = await page.evaluate(() => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--lt-rail-w'), 10) || 380);

    await handle.focus();
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(100);
    const expandedW = await page.evaluate(() => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--lt-rail-w'), 10));
    expect(expandedW).toBe(initialW + 32);

    // Double-click resets back to default (380px)
    await handle.dispatchEvent('dblclick');
    await page.waitForTimeout(100);
    const resetW = await page.evaluate(() => parseInt(getComputedStyle(document.documentElement).getPropertyValue('--lt-rail-w'), 10));
    expect(resetW).toBe(380);

    // 3. Scrollspy updates active nav link and crumb
    await page.evaluate(() => {
      const container = document.getElementById('contentContainer');
      const target = document.getElementById('decisions');
      if (container && target) {
        container.scrollTop = target.offsetTop - 50;
      }
    });
    await page.waitForTimeout(300);

    const activeLink = page.locator('#curriculumNav a[aria-current="page"]');
    await expect(activeLink).toHaveAttribute('href', '#decisions');
    await expect(page.locator('#crumbActive')).toContainText('03. 15 Architecture Records (ADRs)');
  });
});


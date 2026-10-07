import { test, expect } from '@playwright/test';

test.describe('Mobile Auto-Hiding Top Bar on Scroll with Fixed Reading Progress', () => {
  test.use({ viewport: { width: 375, height: 667 } }); // Mobile viewport (iPhone SE)

  test('header hides on downward scroll past sweet spot, reveals on upward scroll, and keeps reading progress bar visible', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForSelector('header.glass');
    const header = page.locator('header.glass');
    const progressBar = page.locator('#progressBar');
    const scroller = page.locator('#contentContainer');

    // 1. Initial State at Rest: Header is fully visible at y = 0
    await expect(header).toBeVisible();
    await expect(header).not.toHaveClass(/header-hidden/);
    const initialHeaderBox = await header.boundingBox();
    expect(initialHeaderBox.y).toBe(0);
    expect(initialHeaderBox.height).toBe(56);

    // Reading progress bar is present and anchored at top: 0
    await expect(progressBar).toBeVisible();
    const initialProgressBox = await progressBar.boundingBox();
    expect(initialProgressBox.y).toBe(0);

    // 2. Micro-scroll within top margin (<= 56px sweet spot): Header remains docked
    await scroller.evaluate((el) => { el.scrollTop = 30; });
    await page.waitForTimeout(100);
    await expect(header).not.toHaveClass(/header-hidden/);

    // 3. Scroll DOWN past the sweet spot (> 56px + downward delta):
    // Header must slide up out of view (-100%)
    await scroller.evaluate((el) => { el.scrollTop = 350; });
    await page.waitForTimeout(350); // allow CSS transition
    await expect(header).toHaveClass(/header-hidden/);

    // Verify header has slid offscreen
    const hiddenHeaderBox = await header.boundingBox();
    expect(hiddenHeaderBox.y + hiddenHeaderBox.height).toBeLessThanOrEqual(5);

    // 4. CRITICAL INVARIANT: Reading progress bar remains visible at top: 0
    await expect(progressBar).toBeVisible();
    const scrolledProgressBox = await progressBar.boundingBox();
    expect(scrolledProgressBox.y).toBe(0);
    // Reading progress width has expanded with scroll depth
    const progressWidth = await progressBar.evaluate((el) => parseFloat(el.style.width || '0'));
    expect(progressWidth).toBeGreaterThan(0);

    // 5. Scroll UP (reverse direction):
    // Header must immediately reveal back down into view
    await scroller.evaluate((el) => { el.scrollTop = 280; });
    await page.waitForTimeout(350); // allow CSS transition
    await expect(header).not.toHaveClass(/header-hidden/);
    const revealedHeaderBox = await header.boundingBox();
    expect(revealedHeaderBox.y).toBe(0);

    // 6. Return to Top:
    await scroller.evaluate((el) => { el.scrollTop = 0; });
    await page.waitForTimeout(350);
    await expect(header).not.toHaveClass(/header-hidden/);
    const topHeaderBox = await header.boundingBox();
    expect(topHeaderBox.y).toBe(0);
  });

  test('desktop viewports keep the header sticky and never trigger auto-hide', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/index.html');
    await page.waitForSelector('header.glass');
    const header = page.locator('header.glass');
    const scroller = page.locator('#contentContainer');

    await scroller.evaluate((el) => { el.scrollTop = 500; });
    await page.waitForTimeout(200);
    await expect(header).not.toHaveClass(/header-hidden/);
    const box = await header.boundingBox();
    expect(box.y).toBe(0);
  });
});

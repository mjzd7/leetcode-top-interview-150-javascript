import { test, expect } from '@playwright/test';

/**
 * Helper to calculate relative luminance according to WCAG 2.1 specs
 */
function getLuminance(r, g, b) {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function parseRgb(colorStr) {
  const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return [0, 0, 0];
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function getContrast(rgb1, rgb2) {
  const l1 = getLuminance(...rgb1);
  const l2 = getLuminance(...rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

test.describe('Theme System & Dual Theming (Dark Lime & Monochrome Brutalist)', () => {
  test('cold start honors OS prefers-color-scheme: dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/index.html');
    await page.waitForSelector('#themeToggle');

    const htmlTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    const hasDarkClass = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    const icon = await page.locator('#themeIcon').textContent();

    expect(htmlTheme).toBe('dark');
    expect(hasDarkClass).toBe(true);
    expect(icon).toBe('☀️');
  });

  test('cold start honors OS prefers-color-scheme: light', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/index.html');
    await page.waitForSelector('#themeToggle');

    const htmlTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    const hasDarkClass = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    const icon = await page.locator('#themeIcon').textContent();

    expect(htmlTheme).toBe('light');
    expect(hasDarkClass).toBe(false);
    expect(icon).toBe('🌙');
  });

  test('user toggle flips theme, updates localStorage, and dispatches themechange event', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/index.html');
    await page.waitForSelector('#themeToggle');

    await page.evaluate(() => {
      window.__themeChanges = [];
      window.addEventListener('themechange', (e) => window.__themeChanges.push(e.detail.theme));
    });

    const toggle = page.locator('#themeToggle');
    await toggle.click();

    const lightTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    const lightStorage = await page.evaluate(() => localStorage.getItem('lt150-theme'));
    const lightIcon = await page.locator('#themeIcon').textContent();

    expect(lightTheme).toBe('light');
    expect(lightStorage).toBe('light');
    expect(lightIcon).toBe('🌙');

    // Toggle back
    await toggle.click();
    const darkTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    const darkStorage = await page.evaluate(() => localStorage.getItem('lt150-theme'));
    const darkIcon = await page.locator('#themeIcon').textContent();

    expect(darkTheme).toBe('dark');
    expect(darkStorage).toBe('dark');
    expect(darkIcon).toBe('☀️');

    const changes = await page.evaluate(() => window.__themeChanges);
    expect(changes).toEqual(['light', 'dark']);
  });

  test('user preference in localStorage overrides opposite OS color scheme across reloads', async ({ page }) => {
    // OS is dark, but user explicitly picks light
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/index.html');
    await page.waitForSelector('#themeToggle');

    await page.locator('#themeToggle').click();
    expect(await page.evaluate(() => localStorage.getItem('lt150-theme'))).toBe('light');

    // Reload page
    await page.reload();
    await page.waitForSelector('#themeToggle');

    const reloadedTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    const reloadedHasDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    expect(reloadedTheme).toBe('light');
    expect(reloadedHasDark).toBe(false);
  });

  test('prism theme stylesheet switches dynamically with theme', async ({ page }) => {
    await page.goto('/index.html');
    await page.waitForSelector('#themeToggle');

    // In dark mode
    await page.evaluate(() => {
      localStorage.setItem('lt150-theme', 'dark');
      document.getElementById('themeToggle').click();
      // Click until dark
      if (document.documentElement.getAttribute('data-theme') !== 'dark') {
        document.getElementById('themeToggle').click();
      }
    });

    const darkHref = await page.locator('#prismTheme').getAttribute('href');
    expect(darkHref).toContain('prism-tomorrow.min.css');

    // Switch to light mode
    await page.locator('#themeToggle').click();
    const lightHref = await page.locator('#prismTheme').getAttribute('href');
    expect(lightHref).toContain('prism.min.css');
  });

  test('subpage rate-limiter.html synchronizes theme and supports toggle', async ({ page }) => {
    // Set localStorage to light in index first
    await page.goto('/index.html');
    await page.evaluate(() => localStorage.setItem('lt150-theme', 'light'));

    // Navigate to rate limiter
    await page.goto('/topics/rate-limiter.html');
    await page.waitForSelector('#themeToggle');

    const subpageTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(subpageTheme).toBe('light');

    // Toggle on subpage
    await page.locator('#themeToggle').click();
    const updatedTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    const updatedStorage = await page.evaluate(() => localStorage.getItem('lt150-theme'));
    expect(updatedTheme).toBe('dark');
    expect(updatedStorage).toBe('dark');
  });

  test('light mode satisfies WCAG AA contrast ratio >= 4.5:1 across critical UI elements', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/index.html');
    await page.waitForSelector('#themeToggle');

    // Force light mode
    await page.evaluate(() => {
      localStorage.setItem('lt150-theme', 'light');
      document.documentElement.setAttribute('data-theme', 'light');
      document.documentElement.classList.remove('dark');
    });

    // Check body / canvas contrast
    const bodyColors = await page.evaluate(() => {
      const b = document.body;
      const comp = getComputedStyle(b);
      return { fg: comp.color, bg: comp.backgroundColor };
    });

    const fgRgb = parseRgb(bodyColors.fg);
    const bgRgb = parseRgb(bodyColors.bg);
    const contrast = getContrast(fgRgb, bgRgb);
    expect(contrast, `Body text contrast in light mode: ${contrast.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);

    // Check empty-state privacy note in light mode
    const privacyContrast = await page.evaluate(() => {
      const el = document.querySelector('.ltc-empty-privacy');
      if (!el) return null;
      const elComp = getComputedStyle(el);
      const panel = el.closest('.ltc-panel') || document.getElementById('ltRail') || document.body;
      let bg = getComputedStyle(panel).backgroundColor;
      if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') {
        bg = getComputedStyle(document.body).backgroundColor;
      }
      return {
        fg: elComp.color,
        bg: bg,
      };
    });

    if (privacyContrast) {
      const pFg = parseRgb(privacyContrast.fg);
      const pBg = parseRgb(privacyContrast.bg);
      const pRatio = getContrast(pFg, pBg);
      expect(pRatio, `Privacy note contrast in light mode: ${pRatio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('mobile header maintains 56px and 40px control height without wrapping at 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto('/index.html');
    await page.waitForSelector('#themeToggle');

    const headerBox = await page.locator('header').boundingBox();
    expect(headerBox.height, 'Header height must be exactly 56px').toBe(56);

    const toggleBox = await page.locator('#themeToggle').boundingBox();
    expect(toggleBox.height, 'Theme toggle height must be 40px').toBe(40);
  });

  test('codeboxes across guides display contextual readable heading titles for solutions and pseudocode', async ({ page }) => {
    // Navigate to Jump Game II (guide from user screenshot)
    await page.goto('/index.html#01-array-string_10-jump-game-ii');
    await page.waitForSelector('.code-bar .code-title', { state: 'attached' });

    // Collect all code titles on the page
    const titles = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.code-wrap')).map(wrap => {
        const titleEl = wrap.querySelector('.code-title');
        return titleEl ? titleEl.textContent.trim() : '';
      });
    });

    expect(titles.length).toBeGreaterThan(0);

    // Verify no generic solution.js or raw text titles appear
    expect(titles).not.toContain('solution.js');
    expect(titles).not.toContain('text');

    // Verify Level 1, 2, and 3 readable titles
    expect(titles).toContain('Level 1: Pseudocode');
    expect(titles).toContain('Level 1: Brute Force Approach');
    expect(titles).toContain('Level 2: Pseudocode');
    expect(titles).toContain('Level 2: Optimized Approach');
    expect(titles).toContain('Level 3: Pseudocode');
    expect(titles).toContain('Level 3: Canonical Solution');

    // Verify follow-up and discuss titles
    expect(titles).toContain('Follow-Up 1: Reconstructing the Actual Optimal Jump Path');
    expect(titles).toContain('Discuss: Baseline Pseudocode');
    expect(titles).toContain('Discuss: Pseudocode');
  });
});


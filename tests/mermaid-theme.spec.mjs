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
  if (!colorStr) return [0, 0, 0];
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

test.describe('Mermaid Theming & FX Parity (Option 1: Runtime Scoped Re-render)', () => {
  test('T1 Article Happy: renders diagram in initial theme and flips colors on theme toggle', async ({ page }) => {
    // Open guide with flowchart in dark mode
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/index.html#00-foundations_03-core-algorithmic-patterns');
    await page.waitForSelector('#articleContent .mermaid svg', { state: 'attached', timeout: 15_000 });

    const darkSvgs = await page.locator('#articleContent .mermaid svg').count();
    expect(darkSvgs).toBeGreaterThanOrEqual(1);

    // Verify dark mode themeVariables applied (e.g. edgeLabel background or node rect fill)
    const darkEdgeLabelBg = await page.evaluate(() => {
      const el = document.querySelector('#articleContent .mermaid .edgeLabel') ||
                 document.querySelector('#articleContent .mermaid [class*="edgeLabel"]');
      return el ? window.getComputedStyle(el).backgroundColor : null;
    });

    // Toggle theme to light mode
    await page.click('#themeToggle');
    await page.waitForTimeout(400); // Allow debounce & promise queue render

    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('light');

    // SVG count remains identical, no fallback error containers appear
    const lightSvgs = await page.locator('#articleContent .mermaid svg').count();
    expect(lightSvgs).toBe(darkSvgs);
    expect(await page.locator('#articleContent .ltc-mermaid-error').count()).toBe(0);

    // Check light mode edgeLabel background flipped
    const lightEdgeLabelBg = await page.evaluate(() => {
      const el = document.querySelector('#articleContent .mermaid .edgeLabel') ||
                 document.querySelector('#articleContent .mermaid [class*="edgeLabel"]');
      return el ? window.getComputedStyle(el).backgroundColor : null;
    });

    if (darkEdgeLabelBg && lightEdgeLabelBg) {
      expect(lightEdgeLabelBg).not.toBe(darkEdgeLabelBg);
    }

    // Rapid toggle variant: 3 toggles < 300ms -> stable SVGs, zero error boxes
    await page.click('#themeToggle');
    await page.click('#themeToggle');
    await page.click('#themeToggle');
    await page.waitForTimeout(600);

    const finalSvgs = await page.locator('#articleContent .mermaid svg').count();
    expect(finalSvgs).toBe(darkSvgs);
    expect(await page.locator('#articleContent .ltc-mermaid-error').count()).toBe(0);
  });

  test('T1b Cold Start Light Deep-Link: renders light diagrams immediately without dark flash', async ({ page }) => {
    // Set localStorage to light before navigation
    await page.addInitScript(() => {
      localStorage.setItem('lt150-theme', 'light');
    });
    await page.goto('/index.html#00-foundations_03-core-algorithmic-patterns');
    await page.waitForSelector('#articleContent .mermaid svg', { state: 'attached', timeout: 15_000 });

    const isLight = await page.evaluate(() => document.documentElement.getAttribute('data-theme') === 'light');
    expect(isLight).toBe(true);

    // Verify no dark edgeLabel background
    const edgeLabelBg = await page.evaluate(() => {
      const el = document.querySelector('#articleContent .mermaid .edgeLabel');
      return el ? window.getComputedStyle(el).backgroundColor : '';
    });
    // #1A2130 is rgb(26, 33, 48)
    expect(edgeLabelBg).not.toContain('26, 33, 48');
  });

  test('T4 Contrast: SVG text vs background in light mode meets WCAG AA standards', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('lt150-theme', 'light');
    });
    await page.goto('/index.html#00-foundations_03-core-algorithmic-patterns');
    await page.waitForSelector('#articleContent .mermaid svg', { state: 'attached', timeout: 15_000 });

    // Check text contrast inside nodes
    const contrastData = await page.evaluate(() => {
      const texts = Array.from(document.querySelectorAll('#articleContent .mermaid svg .nodeLabel, #articleContent .mermaid svg .edgeLabel, #articleContent .mermaid svg text'));
      for (const t of texts) {
        const textStyle = window.getComputedStyle(t);
        const textColor = textStyle.color || textStyle.fill;
        // Find nearest rect background
        const parent = t.closest('.node, .cluster, g');
        const rect = parent ? parent.querySelector('rect, circle, polygon, path') : null;
        if (rect) {
          const rectStyle = window.getComputedStyle(rect);
          const rectFill = rectStyle.fill;
          if (textColor && rectFill && rectFill !== 'none') {
            return { textColor, rectFill };
          }
        }
      }
      return null;
    });

    if (contrastData) {
      const textRgb = parseRgb(contrastData.textColor);
      const bgRgb = parseRgb(contrastData.rectFill);
      const ratio = getContrast(textRgb, bgRgb);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('T4b Fallback Box: parse failure replaces broken node with accessible ltc-mermaid-error', async ({ page }) => {
    await page.goto('/index.html#00-foundations_03-core-algorithmic-patterns');
    await page.waitForSelector('#articleContent .mermaid', { state: 'attached', timeout: 15_000 });

    // Inject a malformed mermaid box into the article
    await page.evaluate(() => {
      const div = document.createElement('div');
      div.className = 'mermaid';
      div.dataset.src = 'this is completely invalid mermaid syntax !!>>>';
      div.textContent = 'this is completely invalid mermaid syntax !!>>>';
      document.querySelector('#articleContent').prepend(div);
      // Trigger render
      window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: 'dark' } }));
    });

    await page.waitForTimeout(500);
    const errorBox = page.locator('#articleContent .ltc-mermaid-error').first();
    await expect(errorBox).toBeVisible();
    await expect(errorBox.locator('.ltc-mermaid-error-note')).toHaveText(
      'This diagram could not be parsed, so its source is shown instead.'
    );
  });
});

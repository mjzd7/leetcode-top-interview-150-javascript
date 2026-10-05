import { defineConfig, devices } from '@playwright/test';

/**
 * The portal is a static single-page app in docs/. It needs two things before a
 * test can touch it:
 *   1. `npm run build` — docs/curriculum-data.js is gitignored, so a fresh clone
 *      (and CI) have no curriculum data and the portal renders the
 *      "No curriculum data found" empty state.
 *   2. a static file server — there is no dev server in this project.
 *
 * `npx serve` is used because it is a single, dependency-free-ish binary the
 * README already documents for local study. If it is not on PATH the tests fail
 * loudly rather than silently skipping.
 */
const PORT = Number(process.env.LTC_E2E_PORT || 4173);

export default defineConfig({
  testDir: './tests',
  // The streaming tests wait on real fetch/stream timing; keep them off a
  // too-tight clock but bounded so a hang fails instead of stalling CI.
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],

  webServer: {
    command: `npm run build && npx --yes serve@14 -l ${PORT} docs`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    // NEVER adopt a server that is already listening, locally or in CI.
    //
    // `!process.env.CI` meant that any interrupted run left its `serve` child alive, and the NEXT run
    // silently adopted it — measuring the whole suite against whatever `docs/` that stale process was
    // serving. Measured this session: `curriculum-data.js` 3 091 546 B served against 3 103 743 B on
    // disk, and `tests/dry-run.spec.mjs` reported 126 failed at the PRISTINE baseline commit for that
    // reason alone. Two whole runs (129 connection-refused, then 195 failed) were spent chasing it.
    //
    // `false` makes an occupied port a LOUD failure — Playwright reports the port is in use and stops —
    // which is the correct trade: a stale-but-plausible portal is far more expensive than a red run that
    // names its own cause. Kill port 4173 before running e2e; `npm run verify` no longer hides a stale
    // one from you.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});

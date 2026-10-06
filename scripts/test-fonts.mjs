/**
 * Font-wiring guard. The portal resolves type through three role vars declared in
 * docs/assets/fonts/fonts.css, which scripts/build-fonts.mjs regenerates.
 *
 *   node scripts/test-fonts.mjs
 *
 * This does not police which families are in use — that is a design decision and
 * it changes. It fails only on wiring faults: a page that sets its own stack
 * instead of a role var, a @font-face pointing at a file that is not there, or a
 * role var that went missing so every page silently falls back.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FONTS_DIR = join(ROOT, 'docs/assets/fonts');
const CSS = join(FONTS_DIR, 'fonts.css');

// Every page is scanned; the roles listed are the ones it must actually use, so a
// file that styles no text of its own is not forced to name all three.
const PAGES = [
  'docs/index.html',
  'docs/topics/rate-limiter.html',
  'docs/dryrun/render.js',
  'docs/chat-widget.js',
];
const ROLE_USERS = {
  'docs/index.html': ['--font-display', '--font-body', '--font-mono'],
  'docs/topics/rate-limiter.html': ['--font-display', '--font-body', '--font-mono'],
  'docs/dryrun/render.js': ['--font-mono'],
};

let failures = 0;
const fail = (msg) => { failures++; console.error('  FAIL ' + msg); };
const pass = (msg) => console.log('  ok   ' + msg);

// The role vars live in the generated stylesheet, once. A page that redeclares one
// locally can disagree with it, which is the drift this arrangement prevents.
if (!existsSync(CSS)) {
  fail('docs/assets/fonts/fonts.css missing — run `node scripts/build-fonts.mjs`');
} else {
  const css = readFileSync(CSS, 'utf8');
  for (const role of ['--font-display', '--font-body', '--font-mono']) {
    new RegExp(`^\\s*${role}:`, 'm').test(css)
      ? pass(`fonts.css declares ${role}`)
      : fail(`fonts.css does not declare ${role} — every page would fall back`);
  }

  // A declared @font-face whose file never shipped renders as a silent fallback.
  const srcs = [...css.matchAll(/src:\s*url\(["']?([^"')]+)/g)].map((m) => m[1]);
  const missing = srcs.filter((s) => !existsSync(join(FONTS_DIR, s)));
  missing.length
    ? fail(`fonts.css points at missing files: ${missing.join(', ')}`)
    : pass(`fonts.css: ${srcs.length} @font-face src(s), all present`);

  // Empty is the normal state — the portal ships the Google Fonts stack and this
  // script exists so a self-hosted family is a file drop, not a CSS edit.
  console.log(`  ok   self-hosted faces: ${srcs.length ? srcs.join(', ') : 'none (CDN stack)'}`);
}

for (const rel of PAGES) {
  const src = readFileSync(join(ROOT, rel), 'utf8');

  if (rel.endsWith('.html')) {
    const local = ['--font-display', '--font-body', '--font-mono']
      .filter((r) => new RegExp(`^\\s*${r}:`, 'm').test(src));
    local.length
      ? fail(`${rel} redeclares ${local.join(', ')} — belongs in fonts.css only`)
      : pass(`${rel}: takes its families from the role vars`);
  }

  for (const role of ROLE_USERS[rel] || []) {
    src.includes(role)
      ? pass(`${rel}: uses ${role}`)
      : fail(`${rel}: does not reference ${role}`);
  }
}

const srcDir = join(FONTS_DIR, 'src');
const staged = existsSync(srcDir)
  ? readdirSync(srcDir).filter((f) => /\.(ttf|otf)$/i.test(f))
  : [];
console.log(`  ok   masters staged for the next build: ${staged.length ? staged.join(', ') : 'none'}`);

console.log(failures ? `\ntest-fonts: ${failures} failure(s)` : '\ntest-fonts: ok');
process.exit(failures ? 1 : 0);

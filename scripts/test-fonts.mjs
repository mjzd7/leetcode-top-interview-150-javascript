/**
 * Font-wiring guard. Fails if the portal drifts back to a font that is no longer
 * loaded, or if a self-hosted family is declared but its file never shipped.
 *
 *   node scripts/test-fonts.mjs
 *
 * Adding a font means: drop the file in docs/assets/fonts/src/, run
 * `node scripts/build-fonts.mjs`, then repoint every hardcoded family name at the
 * var() this file checks for. Cheaper than eyeballing 44 call sites.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FONTS_DIR = join(ROOT, 'docs/assets/fonts');
const CSS = join(FONTS_DIR, 'fonts.css');

// Families the site is allowed to reference, in role order.
const ROLES = ['--font-display', '--font-body', '--font-mono'];
// Anything still naming one of these is a leftover from the old theme.
const RETIRED = ['Space Grotesk', 'JetBrains Mono'];
// Every page is scanned for retired names. The second list is narrower: the roles
// a file must use are the ones it actually sets, so chat-widget.js (which styles
// no text of its own and inherits) is not forced to name all three.
const PAGES = [
  'docs/index.html',
  'docs/topics/rate-limiter.html',
  'docs/dryrun/render.js',
  'docs/chat-widget.js',
];
const ROLE_USERS = {
  'docs/index.html': ROLES,
  'docs/topics/rate-limiter.html': ROLES,
  'docs/dryrun/render.js': ['--font-mono'],
};

let failures = 0;
const fail = (msg) => { failures++; console.error('  FAIL ' + msg); };
const pass = (msg) => console.log('  ok   ' + msg);

for (const rel of PAGES) {
  const src = readFileSync(join(ROOT, rel), 'utf8');

  const retired = RETIRED.filter((f) => src.includes(`"${f}"`) || src.includes(`'${f}'`));
  retired.length
    ? fail(`${rel}: still references ${retired.join(', ')}`)
    : pass(`${rel}: no retired family names`);

  for (const role of ROLE_USERS[rel] || []) {
    src.includes(role)
      ? pass(`${rel}: uses ${role}`)
      : fail(`${rel}: does not reference ${role}`);
  }
}

// A family with no shipped file still renders, via the stack's next entry, so the
// only hard failure is a declared @font-face whose file is absent.
if (!existsSync(CSS)) {
  fail('docs/assets/fonts/fonts.css missing — run `node scripts/build-fonts.mjs`');
} else {
  const css = readFileSync(CSS, 'utf8');
  const srcs = [...css.matchAll(/src:\s*url\(["']?([^"')]+)/g)].map((m) => m[1]);
  if (!srcs.length) fail('fonts.css declares no @font-face');
  const missing = srcs.filter((s) => !existsSync(join(FONTS_DIR, s)));
  missing.length
    ? fail(`fonts.css points at missing files: ${missing.join(', ')}`)
    : pass(`fonts.css: all ${srcs.length} src file(s) present`);
}

// woff2 in git, originals out: src/ holds licensed masters we do not commit.
const shipped = existsSync(FONTS_DIR)
  ? readdirSync(FONTS_DIR).filter((f) => f.endsWith('.woff2'))
  : [];
shipped.length
  ? pass(`${shipped.length} woff2 shipped: ${shipped.join(', ')}`)
  : fail('no woff2 in docs/assets/fonts — nothing to render');

console.log(failures ? `\ntest-fonts: ${failures} failure(s)` : '\ntest-fonts: ok');
process.exit(failures ? 1 : 0);

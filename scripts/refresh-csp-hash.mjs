/**
 * Recompute the script-src hashes for docs/index.html. The page pins its inline
 * <script> blocks by hash in vercel.json, so editing either one breaks the
 * policy until the hash is refreshed.
 *
 * Hashes the file's bytes, not the served DOM: an earlier version read the
 * blocks back out of a live page and produced a different answer on alternate
 * runs, because anything that rewrites script text at runtime changes what the
 * DOM holds. The CSP is computed by the browser from the bytes it parsed, so the
 * file is the only stable source of truth.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const WRITE = process.argv.includes('--write');
const html = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (!blocks.length) {
  console.error('no inline <script> blocks found in docs/index.html');
  process.exit(1);
}
const hashes = blocks.map(t => 'sha256-' + createHash('sha256').update(t, 'utf8').digest('base64'));

const path = new URL('../vercel.json', import.meta.url);
let json = readFileSync(path, 'utf8');
// bare hashes, without the surrounding quotes the CSP string uses
const before = [...json.matchAll(/sha256-[A-Za-z0-9+/=]+/g)].map(m => m[0]);
if (!WRITE) {
  console.log('current in vercel.json:', before.join(' '));
  console.log('computed from page:   ', hashes.join(' '));
  process.exit(0);
}
// Every inline block is pinned, in document order, so reconcile them positionally.
// Refreshing only the last one left a stale hash behind whenever an earlier
// block changed — the Tailwind config block is edited whenever the theme moves.
if (before.length !== hashes.length) {
  console.error(`vercel.json pins ${before.length} script hash(es) but the page has ${hashes.length} inline block(s) — fix by hand`);
  process.exit(1);
}
const stale = before.map((h, i) => (h === hashes[i] ? null : `${h} -> ${hashes[i]}`)).filter(Boolean);
if (!stale.length) {
  console.log('already current');
  process.exit(0);
}
let i = 0;
json = json.replace(/sha256-[A-Za-z0-9+/=]+/g, () => hashes[i++]);
writeFileSync(path, json);
const written = readFileSync(path, 'utf8');
console.log(`vercel.json: ${stale.length} hash(es) refreshed\n  ${stale.join('\n  ')}`);
console.log('verify:', hashes.every(h => written.includes(h)) ? 'written' : 'FAILED');


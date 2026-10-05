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
const app = hashes[hashes.length - 1];
const old = before[before.length - 1];
if (old === app) {
  console.log('already current');
  process.exit(0);
}
if (!json.includes(old)) {
  console.error(`vercel.json does not contain ${old} — refusing to guess`);
  process.exit(1);
}
json = json.replace(old, app);
writeFileSync(path, json);
console.log(`vercel.json: ${old}\n         -> ${app}`);
console.log('verify:', readFileSync(path, 'utf8').includes(app) ? 'written' : 'FAILED');
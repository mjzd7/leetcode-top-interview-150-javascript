#!/usr/bin/env node
/**
 * `scripts/gen-doc-traces.mjs` — plan v5 §7 row 16, §4, §9 decisions 3 and 4.
 *
 * Decision 3 settled goldens as static JSON under `docs/`; decision 4 put the server path
 * behind custom input only, which is trigger-gated as **T-a and unfired**. So this file
 * COPIES what row 15 already committed and stops. There is no route here, no fetch handler,
 * no auth, no cache, and no second producer of a trace.
 *
 * ── WHAT SHIPS, AND WHY NOT THE 35 MiB ──────────────────────────────────────────────
 * Measured on this corpus (row 15's 450 goldens):
 *
 *   full goldens   35,982,101 B  (34.3 MiB)  mean 79,960  median 18,045  max 7,456,361
 *   committed heads    564,898 B  (551.7 KiB) mean    1,255  median  1,179  max     2,970
 *
 * Shipping the raw corpus would multiply the portal's heaviest existing asset —
 * `docs/curriculum-data.js` is 3,091,546 B and is loaded on EVERY page view, which is what
 * plan §8 calls "the wall is the portal, not the engine" — by 11x, for data no page loads.
 * The heads are already a committed artifact per E32, already carry `stepCount`, `verdict`,
 * `blockHash` and the first/last step, and are 1.7 % of the corpus.
 *
 * `ponytail:` the ceiling is that a head is a SUMMARY: it paints a stepper's length, verdict
 * and endpoints, it cannot scrub. That is enough for W1, which the player does not read yet
 * (rows 22-24 drive off the AUTHORED dry-run tables, not off traces). The upgrade path is
 * `--full`: copy the 450 raw goldens into `traces/full/` and let the portal fetch ONE file
 * when a reader opens a guide. That is a 12-line change here plus one `fetch` at the player,
 * and it is deliberately NOT built now — 34.3 MiB of deploy weight for a fetch that does not
 * exist yet is the same mistake as v4's route-with-contract-tests (plan §1 H3).
 *
 * ── WHY THE HEADS ARE COPIED, NOT RESYNTHESIZED ──────────────────────────────────────
 * Re-tracing here would make `npm run build` a second producer of a golden: it would need
 * the 16 MB QuickJS sandbox, the instrumented blocks and the authored cases, so the portal
 * build would inherit every row-9/10/15 failure mode and every guide's runtime cost. A copy
 * is byte-identical to the committed source (asserted), which means a stale deployed head is
 * impossible by construction: the bytes in `docs/` are the bytes a reviewer diffs in git.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stringify } from './lib/serialize.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/** Row 15's output. Only the `.head.json` files here are committed (E32); the full
 *  goldens are gitignored CI artifacts and are MEASURED, never copied. */
export const SOURCE_DIR = path.join(ROOT, 'judge', 'traces');

/** The static tree the portal fetches over plain HTTP. */
export const DOC_TRACES_DIR = path.join(ROOT, 'docs', 'traces');
/** Heads live one level down so the index is not a sibling of 450 files. */
export const HEADS_DIR = path.join(DOC_TRACES_DIR, 'heads');
export const INDEX_NAME = 'index.json';

/**
 * Plan §8 invariant 4: "Committed per-problem footprint <= ~2 KB". This is the number that
 * rule names, and it is REPORTED rather than ENFORCED — see `OVER_CAP_NOTE`.
 */
export const HEAD_BYTE_CAP = 2048;

export const OVER_CAP_NOTE =
  'heads over the ~2 KB committed-footprint cap (plan §8 invariant 4) are shipped whole, not trimmed: '
  + 'a trimmed snapshot no longer matches judge/traces/ and would be a golden that lies.';

/** The decision, recorded in the artifact that ships, so the reason travels with the bytes. */
export const DECISION = {
  ships: 'the 450 committed *.head.json summaries, plus this index',
  doesNotShip: 'the 450 full goldens (34.3 MiB), which stay a CI artifact per plan §6 E32',
  why:
    'docs/curriculum-data.js is already 3,091,546 B and is loaded on every page view; plan §8 names '
    + 'the portal as the scale wall. 34.3 MiB of goldens would be 11x the heaviest asset the portal '
    + 'already ships, for data no page loads. The heads are 1.7% of the corpus and already committed.',
  ceiling:
    'a head is a summary — it paints stepCount, verdict, blockHash and the first/last step, but cannot '
    + 'scrub. Upgrade path: --full copies the raw goldens to traces/full/ and the portal fetches ONE '
    + 'file when a reader opens a guide. Not built now: 34.3 MiB of deploy weight for a fetch that '
    + 'does not exist yet is the mistake plan §1 H3 already paid for once.',
  when: 'row 25 teaches the player to replay traces, or the day a reader asks to scrub a step',
};

/**
 * Read every committed head, with the bytes the portal will actually receive.
 *
 * `file` is the PORTAL-relative path (`traces/heads/<name>`), because that is the string the
 * index has to carry and the only one a reader can act on.
 */
export function readHeads(dir = SOURCE_DIR) {
  const names = fs.readdirSync(dir).filter((f) => f.endsWith('.head.json')).sort();
  return names.map((name) => {
    const bytes = fs.readFileSync(path.join(dir, name));
    const head = JSON.parse(bytes.toString('utf-8'));
    return {
      file: `traces/heads/${name}`,
      name,
      bytes: bytes.length,
      head,
    };
  });
}

/** Byte accounting over any size list. `items` is `{file, bytes}`. */
export function summariseSizes(items) {
  const sizes = items.map((i) => i.bytes).sort((a, b) => b - a);
  const total = sizes.reduce((a, b) => a + b, 0);
  return {
    count: sizes.length,
    total,
    max: sizes[0] ?? 0,
    min: sizes[sizes.length - 1] ?? 0,
    mean: sizes.length ? Math.round(total / sizes.length) : 0,
    median: sizes.length ? sizes[sizes.length >> 1] : 0,
    over1Mb: sizes.filter((s) => s > 1024 * 1024).length,
    over100Kb: sizes.filter((s) => s > 100 * 1024).length,
    over10Kb: sizes.filter((s) => s > 10 * 1024).length,
    sizes,
    overCap: items
      .filter((i) => i.bytes > HEAD_BYTE_CAP)
      .map((i) => ({ file: i.file, bytes: i.bytes }))
      .sort((a, b) => b.bytes - a.bytes),
  };
}

/** The goldens E32 keeps out of git. Measured for the record; stat only, never read. */
export function measureRawCorpus(dir = SOURCE_DIR) {
  let total = 0;
  let count = 0;
  let max = 0;
  let over1Mb = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.json') || name.endsWith('.head.json') || name === 'manifest.json') continue;
    const bytes = fs.statSync(path.join(dir, name)).size;
    count++;
    total += bytes;
    if (bytes > max) max = bytes;
    if (bytes > 1024 * 1024) over1Mb++;
  }
  return { count, total, max, over1Mb };
}

/**
 * The index: the ONE file the portal has to know exists.
 *
 * Everything here is derived, and nothing here re-declares a fact: the path, level, fn name,
 * codec, verdict and blockHash all come from the head row 15 wrote, so there is no second
 * source of slug truth (plan §8 invariant 2) and no second chance to disagree with it.
 */
export function buildIndex(heads, { rawCorpus = null } = {}) {
  const traces = heads
    .map(({ file, bytes, head }) => ({
      path: head.path,
      level: head.level,
      file,
      bytes,
      steps: head.stepCount,
      fnName: head.fnName,
      codec: head.codec,
      blockHash: head.blockHash,
      verdict: head.verdict,
      truncated: Boolean(head.error),
    }))
    .sort((a, b) => (a.path === b.path ? a.level - b.level : a.path < b.path ? -1 : 1));

  const headSummary = summariseSizes(heads);
  const raw = rawCorpus ?? measureRawCorpus();

  return {
    v: 1,
    generator: 'scripts/gen-doc-traces.mjs',
    envelopeSchema: 'v1.1',
    source: 'judge/traces/*.head.json',
    /** Where the portal asks for a trace, relative to `docs/`. */
    indexAt: 'traces/index.json',
    counts: {
      traces: traces.length,
      problems: new Set(traces.map((t) => t.path)).size,
      headBytes: headSummary.total,
      indexEntryBytes: Buffer.byteLength(stringify(traces), 'utf-8'),
      overCap: headSummary.overCap.length,
      overCapNote: OVER_CAP_NOTE,
      rawCorpusTraces: raw.count,
      rawCorpusBytes: raw.total,
      rawCorpusLargestBytes: raw.max,
      rawCorpusOver1Mb: raw.over1Mb,
      shippedVsRawPercent: raw.total ? Number(((headSummary.total / raw.total) * 100).toFixed(2)) : 0,
    },
    decision: DECISION,
    traces,
  };
}

/**
 * Remove anything under `dir` this publish did not write. Keeps the deployed tree honest: a
 * guide deleted upstream must not leave a stale trace behind forever.
 */
function prune(dir, keep) {
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    if (keep.has(name)) continue;
    fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  }
}

/**
 * Publish the static trace tree. Safe to call on every build; writes only under
 * `docs/traces/`. Returns the same accounting the CLI prints.
 */
export async function publishDocTraces() {
  const heads = readHeads();
  if (heads.length === 0) {
    throw new Error(
      `No *.head.json under ${SOURCE_DIR}. Row 15 owns those; run \`npm run gen:traces\` first.`,
    );
  }

  fs.mkdirSync(HEADS_DIR, { recursive: true });
  const keep = new Set();
  for (const { name, head } of heads) {
    // Re-serialised through row 6's canonical form rather than copied raw, so the shipped
    // bytes are key-sorted by construction. On this corpus that is a no-op — the source is
    // already canonical — and the test asserts the two are byte-identical, which is what
    // makes "the copy is faithful" a checked fact instead of a claim.
    fs.writeFileSync(path.join(HEADS_DIR, name), `${stringify(head)}\n`, 'utf-8');
    keep.add(name);
  }
  prune(HEADS_DIR, keep);

  const index = buildIndex(heads);
  fs.writeFileSync(path.join(DOC_TRACES_DIR, INDEX_NAME), `${stringify(index)}\n`, 'utf-8');
  prune(DOC_TRACES_DIR, new Set([INDEX_NAME, 'heads']));

  return { written: heads.length, index, bytes: index.counts.headBytes };
}

/* --------------------------------------------------------------------------- */

async function main() {
  const report = await publishDocTraces();
  const { counts } = report.index;
  const summary = summariseSizes(readHeads());
  const kib = (b) => `${(b / 1024).toFixed(1)} KiB`;

  console.log(`\n[gen-doc-traces] ${report.written} heads + ${INDEX_NAME} → docs/traces/ (no server, no route)`);
  console.log(
    `[gen-doc-traces] shipped ${kib(counts.headBytes)} of heads + ${kib(counts.indexEntryBytes)} of index = `
    + `${kib(counts.headBytes + counts.indexEntryBytes)} — ${counts.shippedVsRawPercent}% of the raw corpus`,
  );
  console.log(
    `[gen-doc-traces] raw corpus MEASURED, NOT shipped: ${counts.rawCorpusTraces} files, `
    + `${(counts.rawCorpusBytes / 1024 / 1024).toFixed(2)} MiB, largest `
    + `${(counts.rawCorpusLargestBytes / 1024 / 1024).toFixed(2)} MiB (${counts.rawCorpusOver1Mb} over 1 MiB)`,
  );
  console.log(
    `[gen-doc-traces] head sizes: max ${summary.max}  median ${summary.median}  mean ${summary.mean}  `
    + `>100KB ${summary.over100Kb}  >10KB ${summary.over10Kb}`,
  );
  if (summary.overCap.length) {
    console.log(`\n[gen-doc-traces] ${summary.overCap.length} heads over the ~${HEAD_BYTE_CAP} B cap (${OVER_CAP_NOTE}):`);
    for (const item of summary.overCap) console.log(`   ${item.file} — ${item.bytes} B`);
  } else {
    console.log(`\n[gen-doc-traces] heads over the ~${HEAD_BYTE_CAP} B cap: 0`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
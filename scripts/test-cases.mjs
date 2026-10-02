#!/usr/bin/env node
/**
 * Row 3 tranche-A verifier — plan v5 §7 row 3 ("41 syntax-only -> 0").
 *
 * WHAT THIS IS
 *   Row 3 is the plan's KILL CRITERION. 41 guides have never been executed
 *   (§1 finding U1), so their goldens would be generated from code that may not
 *   work. This script is the adjudication: it executes each covered guide's own
 *   Level 3 canonical block against each AUTHORED case and reports every
 *   disagreement. A disagreement means the guide's prose or its canonical code
 *   is wrong — it is never "fixed" by editing the expected value.
 *
 *   More than 15 of the 41 guides genuinely wrong halts the visual product.
 *
 * INPUT
 *   catalog/cases.json    authored cases, keyed by guide PATH (plan E30 — never slug).
 *   scratch/row3/syntax-only.json   the tranche roster; this tranche is the
 *                          01-array-string/ slice of it, read — never hardcoded.
 *   catalog/problems.json committed registry for the Level 3 fn name
 *                          (build/blocks.json is gitignored, so it is only a
 *                          cross-check when present, never a dependency).
 *
 * OUTPUT
 *   Exit 0 only when every case passes AND coverage is exactly the tranche.
 *   Always prints a mismatch/unverifiable table, even when empty, so the
 *   kill-criterion count is visible rather than inferred from a pass count.
 *
 * SCOPE
 *   This file NEVER writes to the repo, never touches scripts/test-runner.mjs,
 *   and never edits a guide. It writes one temp dir and removes it.
 *
 * Node builtins + scripts/lib/serialize.mjs only. No npm dependency added.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { stringify } from './lib/serialize.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CASES_FILE = path.join(ROOT, 'catalog/cases.json');
const ROSTER_FILE = path.join(ROOT, 'scratch/row3/syntax-only.json');
const CATALOG_FILE = path.join(ROOT, 'catalog/problems.json');
const BLOCKS_FILE = path.join(ROOT, 'build/blocks.json');

/** Tranche A = the guides whose roster path sits in this directory. */
const TRANCHE_PREFIX = '01-array-string/';

const SENTINEL = '__CASES_RESULT__';

/** The test's own assertEq: records instead of exiting, so one bad case does not hide the rest. */
const COLLECTING_PRELUDE = `
const __results = [];
function assertEq(actual, expected, label) {
  let got, ok;
  try { got = JSON.stringify(actual); } catch (e) { got = '<unserialisable: ' + e.message + '>'; }
  const want = JSON.stringify(expected);
  ok = got === want;
  __results.push({ label, ok, got, want });
  return ok;
}
`;

/** Read a guide's Level 1/2/3 blocks the way scripts/test-runner.mjs does. */
function extractJsBlocks(content) {
  return [...content.matchAll(/```javascript([\s\S]*?)```/g)].map((m) => m[1]);
}

// ponytail: "the third fence in the document" is a heuristic, not a spec — it holds
// only because every guide puts its Level 1/2/3 solutions before any other fence.
// The spec-correct predicate is section-scoped (selectSolutionBlocks in
// audit-curriculum.mjs, K7). This harness uses the heuristic on purpose: the code it
// executes must be byte-identical to what test-runner.mjs will execute, since the
// whole point is to verify the block that runner runs. Cross-checked equal to the K7
// Level 3 selection for all 20 guides in this tranche, and blocks.json (row 7) is
// consulted below when present. If a guide ever puts a fence above Level 1, switch
// both this file and test-runner.mjs to selectSolutionBlocks in the same commit.

/** Run one guide's L3 block against its entry; never throws. */
function runGuide(rel, entry, code, fnName) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'row3-cases-'));
  const tmp = path.join(dir, 'run.mjs');
  const absSerialize = new URL('./lib/serialize.mjs', import.meta.url).href;

  let harness;
  if (entry.script !== undefined) {
    // In-place / class APIs (plan codec `ops`, equivalence
    // `ops-terminal-state-and-outputs`) cannot be expressed as a JSON arg list,
    // so they use the repo's existing `script` entry convention. The script text
    // is splice-ready verbatim; only assertEq differs (collecting, not fatal).
    harness = COLLECTING_PRELUDE + entry.script + `\nconsole.log('${SENTINEL}' + JSON.stringify({ kind: 'script', results: __results }));\n`;
  } else {
    const packed = entry.cases.map((c) => ({ name: c.name, argsJson: JSON.stringify(c.args ?? []) }));
    harness = `${COLLECTING_PRELUDE}
import { stringify } from ${JSON.stringify(absSerialize)};
const __fn = ${fnName}; // bare identifier — interpolated, never quoted
const __cases = ${JSON.stringify(packed)};
for (const __c of __cases) {
  try {
    const __got = __fn(...JSON.parse(__c.argsJson));
    __results.push({ label: __c.name, ok: true, text: stringify(__got), json: JSON.stringify(__got), argsJson: __c.argsJson });
  } catch (e) {
    __results.push({ label: __c.name, ok: false, got: 'THREW: ' + (e && e.message ? e.message : String(e)), argsJson: __c.argsJson });
  }
}
console.log('${SENTINEL}' + JSON.stringify({ kind: 'fn', results: __results }));
`;
  }

  fs.writeFileSync(tmp, code + '\n' + harness + '\n', 'utf-8');
  try {
    const out = execFileSync('node', [tmp], { stdio: 'pipe', timeout: 20000, encoding: 'utf-8' });
    const line = out.split('\n').find((l) => l.startsWith(SENTINEL));
    if (!line) return { fatal: 'harness produced no result line' };
    return { payload: JSON.parse(line.slice(SENTINEL.length)) };
  } catch (err) {
    const detail = ((err.stdout?.toString() || '') + (err.stderr?.toString() || err.message)).trim().split('\n').slice(0, 6).join('\n');
    return { fatal: detail || 'non-zero exit with no output' };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function pad(s, n) {
  s = String(s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n);
}

// ---------------------------------------------------------------------------

const problems = fs.existsSync(CATALOG_FILE)
  ? JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf-8')).problems
  : [];
const fnNameOf = (rel) => problems.find((p) => p.path === rel)?.fnName?.L3 ?? null;

// blocks.json is gitignored and regenerable, so it is a CROSS-CHECK, never a
// dependency — a fresh clone must still run this script.
let blocksL3 = null;
if (fs.existsSync(BLOCKS_FILE)) {
  const all = JSON.parse(fs.readFileSync(BLOCKS_FILE, 'utf-8')).blocks;
  blocksL3 = new Map(all.filter((b) => b.level === 3).map((b) => [b.path, b.targetFn]));
}

console.log('🧪 Row 3 tranche-A case verifier (executes each guide\'s Level 3 block)\n');

if (!fs.existsSync(CASES_FILE)) {
  console.error(`❌ [CASES] catalog/cases.json does not exist — nothing to verify.`);
  console.error(`   This is the RED state row 3 starts from: the authored cases are the product.`);
  console.error(`   Guides: 0 | Cases: 0 | Pass: 0 | Fail: 0`);
  console.error(`\nMISMATCH (0)\nUNVERIFIABLE (0)`);
  console.error(`\n========================================`);
  console.error(`Files covered: 0 | Failures: 1`);
  console.error(`========================================\n`);
  process.exit(1);
}

const cases = JSON.parse(fs.readFileSync(CASES_FILE, 'utf-8'));
const roster = JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf-8')).filter((p) => p.startsWith(TRANCHE_PREFIX));
const covered = Object.keys(cases).filter((k) => !k.startsWith('__'));

const extra = covered.filter((p) => !roster.includes(p));
const missing = roster.filter((p) => !covered.includes(p));
const fnNameDrift = covered.filter((p) => blocksL3 && blocksL3.get(p) && fnNameOf(p) && blocksL3.get(p) !== fnNameOf(p));

const mismatch = [];
const unverifiable = [];
const notes = [];
let totalCases = 0;
let pass = 0;
let fail = 0;
let guidesOk = 0;

for (const rel of covered) {
  const entry = cases[rel];
  const guidePath = path.join(ROOT, rel);
  if (!fs.existsSync(guidePath)) {
    unverifiable.push({ rel, label: '(entry)', detail: 'guide markdown not found at ' + rel });
    continue;
  }
  const blocks = extractJsBlocks(fs.readFileSync(guidePath, 'utf-8'));
  const code = blocks[2];
  if (code === undefined) {
    unverifiable.push({ rel, label: '(entry)', detail: 'no third ```javascript fence — no Level 3 block' });
    continue;
  }

  const isScript = entry.script !== undefined;
  if (!isScript && !Array.isArray(entry.cases)) {
    unverifiable.push({ rel, label: '(entry)', detail: 'entry has neither `cases` nor `script`' });
    continue;
  }

  const fnName = fnNameOf(rel);
  if (!isScript && !fnName) {
    unverifiable.push({ rel, label: '(entry)', detail: 'no catalog/problems.json fnName.L3 — cannot resolve the canonical target' });
    continue;
  }
  // A bare identifier is interpolated into the harness source, so it must BE one.
  if (!isScript && !/^[A-Za-z_$][\w$]*$/.test(fnName)) {
    unverifiable.push({ rel, label: '(entry)', detail: 'fnName.L3 is not a bare identifier: ' + JSON.stringify(fnName) });
    continue;
  }

  const n = isScript ? null : entry.cases.length;
  if (n !== null) {
    if (n === 0) {
      unverifiable.push({ rel, label: '(entry)', detail: 'zero cases' });
      continue;
    }
    // Results are matched back to their case by name, so a duplicate or a blank
    // name would silently verify the wrong expectation.
    const names = entry.cases.map((c2) => c2 && c2.name);
    const dupes = names.filter((nm, i) => !nm || names.indexOf(nm) !== i);
    if (dupes.length) {
      unverifiable.push({ rel, label: '(entry)', detail: 'blank or duplicate case name(s): ' + [...new Set(dupes)].join(', ') });
      continue;
    }
    if (entry.cases.some((c2) => !('expect' in c2) || !('args' in c2))) {
      unverifiable.push({ rel, label: '(entry)', detail: 'a case is missing `args` or `expect`' });
      continue;
    }
    totalCases += n;
  }

  const run = runGuide(rel, entry, code, fnName);
  if (run.fatal) {
    fail += n ?? 1;
    // Keep the message, drop the tmp path: only the first 3 lines and no /private/… noise.
    const detail = run.fatal.split('\n').slice(0, 3).map((l) => l.replace(/^.*\/run\.mjs/, 'run.mjs')).join(' | ');
    unverifiable.push({ rel, label: '(entry)', detail: 'Level 3 block did not run: ' + detail });
    continue;
  }

  let bad = 0;
  for (const r of run.payload.results) {
    if (isScript) {
      if (r.ok) pass++;
      else {
        fail++;
        bad++;
        mismatch.push({ rel, label: r.label, args: '(script entry)', guideSays: r.got, expected: r.want });
      }
      totalCases++;
      continue;
    }
    // fn case: the child canonicalised the return value with row 6's serializer,
    // so compare canonical text on both sides. A difference that survives only
    // under the canonical encoding (-0 vs 0, NaN/Infinity vs null) is NOT a
    // behavioural disagreement: scripts/test-runner.mjs compares with
    // JSON.stringify, which erases those distinctions, so the splice passes.
    // Those are reported as notes so the distinction stays visible.
    const authored = entry.cases.find((c) => c.name === r.label);
    const wantText = stringify(authored?.expect);
    const jsonEqual = r.ok && r.json === JSON.stringify(authored?.expect);
    if (r.ok && r.text === wantText) {
      pass++;
    } else if (jsonEqual) {
      pass++;
      notes.push({ rel, label: r.label, args: r.argsJson, codeSays: `canonical form ${r.text}`, plainJson: r.json });
    } else {
      fail++;
      bad++;
      mismatch.push({
        rel,
        label: r.label,
        args: r.argsJson,
        guideSays: r.ok ? `code returns ${r.json}` : r.got,
        expected: `catalog expects ${JSON.stringify(authored?.expect)}`,
      });
    }
  }
  if (bad === 0) guidesOk++;
}

const coverageProblems = [...extra.map((p) => ['EXTRA (not in this tranche)', p]), ...missing.map((p) => ['MISSING (in this tranche)', p])];

console.log(`Roster (${TRANCHE_PREFIX} slice of scratch/row3/syntax-only.json): ${roster.length}`);
console.log(`Covered by catalog/cases.json: ${covered.length}\n`);

console.log('Per-guide results:');
for (const rel of covered) {
  const entry = cases[rel];
  const isScript = entry.script !== undefined;
  console.log(`  ${isScript ? 'script' : String(entry.cases.length).padStart(2) + ' case'}  ${rel}`);
}
console.log('');

console.log(`Guides: ${covered.length} (fully passing: ${guidesOk}) | Cases: ${totalCases} | Pass: ${pass} | Fail: ${fail}`);
if (fnNameDrift.length) console.log(`fnName drift vs build/blocks.json: ${fnNameDrift.length}`);
console.log('');

console.log(`MISMATCH (${mismatch.length + coverageProblems.length})`);
if (!mismatch.length && !coverageProblems.length) {
  console.log('  (none — every authored case agrees with the guide\'s own Level 3 code)');
}
for (const [kind, rel] of coverageProblems) console.log(`  ${pad(kind, 26)} ${rel}`);
console.log('');
if (mismatch.length) {
  console.log('| guide | case | args | canonical code | catalog expects |');
  console.log('|---|---|---|---|---|');
  for (const m of mismatch) {
    console.log(`| ${pad(m.rel, 52)} | ${pad(m.label, 26)} | ${pad(m.args, 34)} | ${pad(m.guideSays, 30)} | ${pad(m.expected, 30)} |`);
  }
  console.log('');
}

console.log(`UNVERIFIABLE (${unverifiable.length})`);
if (!unverifiable.length) console.log('  (none — every entry resolved to a runnable Level 3 block)');
for (const u of unverifiable) console.log(`  ${pad(u.rel, 52)} ${pad(u.label, 20)} ${u.detail}`);
console.log('');

console.log(`NOTES (${notes.length})`);
if (!notes.length) console.log('  (none)');
for (const nt of notes) {
  console.log(`  ${pad(nt.rel, 52)} ${pad(nt.label, 30)} ${pad(nt.args, 30)} ${nt.codeSays}`);
  console.log(`  ${''.padEnd(52)} agrees under JSON.stringify (what test-runner.mjs uses): ${nt.plainJson}`);
}
console.log('');

const failures = mismatch.length + coverageProblems.length + unverifiable.length;
console.log('========================================');
console.log(`Files covered: ${covered.length} | Failures: ${failures}`);
console.log(`Kill-criterion count (mismatches): ${mismatch.length} — plan halts the visual product above 15 of the 41`);
console.log('========================================\n');

if (failures > 0) process.exit(1);
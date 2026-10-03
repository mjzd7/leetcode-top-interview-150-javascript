/**
 * gen-catalog — row 1 / K1-adjacent. The single registry that replaces three
 * re-declarations of the same slug (H1/P3): the guide, `RUNTIME_TESTS` in
 * test-runner.mjs, and `PILOT_SLUGS` in api/_lib/problems.mjs.
 *
 *   node scripts/gen-catalog.mjs            derive catalog/problems.json from the guides
 *   node scripts/gen-catalog.mjs --verify   read the committed file, assert every invariant
 *   node scripts/gen-catalog.mjs --report   histograms only, writes nothing
 *
 * Keyed by PATH, never by slug (plan §8 invariant 1 / E30): two guides may share a
 * title or a slug, so the path is the identity. Everything here is EXTRACTED —
 * re-deriving from the guide markdown is what stops the catalog from rotting when a
 * guide is renamed. A field that cannot be derived is `null`, never a guess
 * (§8 invariant 2): a fabricated fn name or codec is worse than an absent one.
 *
 * Reuses `selectSolutionBlocks` / `listGuides` / `readRuntimeTestRegistry` from
 * audit-curriculum.mjs (row 0 owns those predicates) and the canonical serializer
 * from scripts/lib/serialize.mjs (K6, sorted keys at every level).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listGuides, selectSolutionBlocks, readRuntimeTestRegistry, ROOT_DIR } from './audit-curriculum.mjs';
import { serialize } from './lib/serialize.mjs';

const __filename = fileURLToPath(import.meta.url);
const CATALOG_DIR = path.join(ROOT_DIR, 'catalog');
const CATALOG_PATH = path.join(CATALOG_DIR, 'problems.json');

/** G1 — the five implemented codecs. Row 17 owns the registry and fails CI on a 6th. */
const CODECS = ['graph', 'json', 'list', 'ops', 'tree'];
/** §6 E28 — the six equivalence kinds. */
const EQUIVALENCE = ['exact', 'int-with-tolerance', 'multiset', 'ops-terminal-state-and-outputs', 'order-insensitive', 'shape-only'];
const DIFFICULTIES = ['Easy', 'Hard', 'Medium'];

/** Modules whose problems are graph problems by construction (grid/edge/word graphs). */
const GRAPH_MODULES = new Set(['18-graph-general', '19-graph-bfs']);

/**
 * EQUIVALENCE OVERRIDES — the residue §8 E35 anticipates. Every entry is keyed by
 * PATH and every one cites the guide's own wording; nothing is inherited from a slug.
 * Keep this list small: anything not here is derived from `returnType` (then `codec`).
 */
const EQUIVALENCE_OVERRIDES = {
  '02-two-pointers/05-3sum.md': ['order-insensitive', '§1: "return a sorted list of unique triplets … in any order"'],
  '03-sliding-window/03-substring-with-concatenation-of-all-words.md': ['order-insensitive', '§1: starting indices may be returned "in any order"'],
  '05-hashmap/05-group-anagrams.md': ['multiset', 'groups are a multiset: group order and within-group word order carry no meaning'],
  '05-hashmap/06-two-sum.md': ['order-insensitive', '§1: "You can return the answer in any order."'],
  '06-intervals/02-merge-intervals.md': ['order-insensitive', 'the authored script sorts the result itself (`.sort(byStart)`) precisely because the brute force preserves discovery order, so the order is not the contract'],
  '14-backtracking/01-letter-combinations.md': ['order-insensitive', '§1: "in any order"'],
  '14-backtracking/02-combinations.md': ['order-insensitive', '§1: "in any order"'],
  '14-backtracking/03-permutations.md': ['order-insensitive', '§1: "in any order"'],
  '14-backtracking/04-combination-sum.md': ['order-insensitive', '§1: "in any order"'],
  '14-backtracking/06-generate-parentheses.md': ['order-insensitive', '§1: "in any order"'],
  '20-trie/03-word-search-ii.md': ['order-insensitive', '§1: words may be returned "in any order"'],
};

// ---------------------------------------------------------------------------
// Extraction primitives.

/** `- **Difficulty**: Easy` -> `Easy`. */
function headerValue(content, field) {
  const m = content.match(new RegExp(`\\*\\*${field}\\*\\*:?\\s*(.*)`));
  return m ? m[1].trim().replace(/\s+$/, '') : null;
}

/** `https://leetcode.com/problems/two-sum/` -> `two-sum`. */
function lcSlugFromLink(content) {
  const m = content.match(/\*\*LeetCode Link\*\*:?\s*`([^`]+)`/);
  if (!m) return null;
  const s = m[1].match(/\/problems\/([^/?#]+)/);
  return s ? s[1] : null;
}

/** `/problems/1234/` -> 1234. A slug-form URL carries no id, so it stays null. */
function lcIdFromLink(content) {
  const m = content.match(/\*\*LeetCode Link\*\*:?\s*`([^`]+)`/);
  if (!m) return null;
  const id = m[1].match(/\/problems\/(\d+)\/?$/);
  return id ? Number(id[1]) : null;
}

/** `# 1. Two Sum` -> `Two Sum`. */
function titleFrom(content) {
  const m = content.match(/^#\s+(.*)$/m);
  if (!m) return null;
  return m[1].trim().replace(/^\d+[.)]\s*/, '');
}

/** Top-level declarations of a solution block, in document order. */
function declarations(code) {
  const re = /(?:^|\n)[ \t]*(?:function\s+([A-Za-z_$][\w$]*)\s*\(|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b[^\n]*|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)|class\s+([A-Za-z_$][\w$]*))/g;
  return [...code.matchAll(re)].map((m) => ({ name: m[1] || m[2] || m[3], class: Boolean(m[3]) }));
}

/**
 * Per-level target function name.
 *
 * A guide's canonical name is the one every level builds on: `twoSumBruteForce` /
 * `twoSumTwoPass` / `twoSum`, `searchInsertBruteForce` / `searchInsertRecursive` /
 * `searchInsert`. So the base name is the LONGEST candidate that appears inside some
 * other candidate (case-insensitive), and each level's target is the candidate that
 * contains it — preferring an exact match, then the first in document order (the
 * solution function is written before its helpers). A level with no candidate
 * containing the base gets `null` rather than a guess.
 *
 * ponytail: this is text containment, not a parse — a helper whose name happens to
 * contain the base could win on an unlucky block. Ceiling: 0 disagreements against
 * all 109 RUNTIME_TESTS entries (printed by --verify); row 7's Acorn walk replaces it.
 */
function levelTargets(candidates) {
  const flat = [].concat(...candidates);
  const base = flat
    .filter((c) => flat.some((o) => o.name !== c.name && o.name.toLowerCase().includes(c.name.toLowerCase())))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (!base) return { names: [null, null, null], target: null };
  const key = base.name.toLowerCase();
  const pick = (level) => {
    const hits = level.filter((c) => c.name.toLowerCase().includes(key));
    if (!hits.length) return null;
    return (hits.find((c) => c.name.toLowerCase() === key) || hits[0]).name;
  };
  const names = candidates.map(pick);
  const target = candidates[2].find((c) => c.name.toLowerCase().includes(key)) || null;
  return { names, target };
}

/** The body of `name` inside `code` (brace-matched from its declaration), or null. */
function bodyOf(code, name) {
  const scanner = new RegExp(DECL_SOURCE, 'g');
  let m;
  let start = -1;
  while ((m = scanner.exec(code))) {
    if ((m[1] || m[2] || m[3]) !== name) continue;
    start = scanner.lastIndex;
    break;
  }
  if (start < 0) return null;
  let i = start;
  while (i < code.length && code[i] !== '{' && code[i] !== ';') i++;
  if (code[i] !== '{') return '';
  let depth = 0;
  let j = i;
  for (; j < code.length; j++) {
    if (code[j] === '{') depth++;
    else if (code[j] === '}') {
      depth--;
      if (!depth) break;
    }
  }
  return code.slice(i + 1, j);
}

const DECL_SOURCE = /(?:^|\n)[ \t]*(?:function\s+([A-Za-z_$][\w$]*)\s*\(|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b[^\n]*|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)|class\s+([A-Za-z_$][\w$]*))/g;

/** One `return` expression -> a type label, or `null` when it carries no shape. */
function classifyExpr(expr) {
  const s = String(expr).trim().replace(/;$/, '').trim();
  if (!s) return 'void';
  if (/^(true|false)$/i.test(s)) return 'boolean';
  if (/^(["'`])(?:[\s\S]*)\1$/.test(s)) return 'string';
  if (/^-?\d+$/.test(s)) return 'int';
  if (/^-?\d*\.\d+$/.test(s)) return 'float';
  if (/^\[/.test(s) && /\]$/.test(s)) {
    const inner = s.replace(/^\[/, '').replace(/\]$/, '').trim();
    if (!inner) return 'array';
    const first = inner.split(',')[0].trim().replace(/^[[{(]|["'`]/, '');
    if (/^-?\d/.test(first)) return 'int[]';
    if (/^[A-Za-z_$]/.test(first)) return 'string[]';
    if (/^\[/.test(inner)) return 'int[][]';
    return 'array';
  }
  if (/^[A-Za-z_$][\w$]*\s*=\s*-?\d+$/.test(s)) return 'int'; // "`k = 2`" — the count IS the answer
  if (/^(null|undefined)$/.test(s)) return 'null';
  if (/^new\s+[A-Z]/.test(s) || /^[A-Z][\w$]*$/.test(s)) return 'object';
  return null;
}

/** Most specific label in a bag of labels. `array`, `void` and `null` never win alone. */
function reduceTypes(list) {
  const known = list.filter(Boolean);
  const specific = known.filter((t) => t !== 'array' && t !== 'void' && t !== 'null');
  if (specific.length) {
    const counts = new Map();
    for (const t of specific) counts.set(t, (counts.get(t) || 0) + 1);
    let best = specific[0];
    let bestN = counts.get(best);
    for (const t of specific) if (counts.get(t) > bestN) ((best = t), (bestN = counts.get(t)));
    return best;
  }
  if (known.includes('void')) return 'void';
  if (known.length) return 'array';
  return null;
}

/** `Expected Behavior` / `Expected Output` column of the guide's first edge-case table. */
function edgeMatrixTypes(content) {
  const lines = content.split('\n');
  let sep = -1;
  for (let i = 0; i < lines.length; i++) if (/^\|\s*:?-{2,}/.test(lines[i])) { sep = i; break; }
  if (sep < 0) return [];
  const out = [];
  for (let i = sep + 1; i < lines.length && /^\|/.test(lines[i]); i++) {
    const cell = lines[i].split('|')[3] || '';
    let typed = 0;
    for (const span of cell.matchAll(/`([^`]+)`/g)) {
      const t = classifyExpr(span[1]);
      if (t) out.push(t), typed++;
    }
    // A cell with no value in it at all that reads like `nums = []` is the guide
    // describing MUTATED state. With values present, the values already spoke.
    const bare = cell.replace(/`/g, '').trim();
    if (!typed && /^[A-Za-z_$][\w$]*(\[[^\]]*\])?\s*=[^=]/.test(bare)) out.push('void');
  }
  return out;
}

/** The 3 names a `RUNTIME_TESTS` entry drives: `fns`, or the script's `[a, b, c]`. */
function runtimeNames(entry) {
  if (!entry) return null;
  if (entry.fns && entry.fns.length === 3) return entry.fns.slice();
  const m = /for\s*\([^)]*\bof\s*\[([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\]/.exec(entry.script || '');
  return m ? [m[1], m[2], m[3]] : null;
}

/** Value shape of authored cases, used only to CROSS-CHECK the derived returnType. */
function expectTypes(entry) {
  if (!entry || !entry.cases || !entry.cases.length) return [];
  const out = [];
  for (const c of entry.cases) {
    const v = c.expect;
    if (Array.isArray(v)) {
      if (!v.length) out.push('array');
      else if (v.every((x) => typeof x === 'number')) out.push('int[]');
      else if (v.every((x) => typeof x === 'string')) out.push('string[]');
      else if (v.every((x) => Array.isArray(x))) out.push('int[][]');
      else out.push('array');
    } else if (v === null) out.push('null');
    else if (typeof v === 'number') out.push(Number.isInteger(v) ? 'int' : 'float');
    else if (typeof v === 'object') out.push('object');
    else out.push(typeof v);
  }
  return out;
}

/**
 * Codec suggestion from what the canonical solution manipulates. Priority is fixed so
 * the choice is deterministic: ops > tree > list > graph > json. `ops` only when the
 * canonical target IS a class (a stateful API with mutating methods), never for a
 * helper class a tree guide defines for its nodes.
 */
function codecFor(relPath, code, target) {
  if (target && target.class) return 'ops';
  const codeOnly = code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  if (/\bTreeNode\b|\blevelOrder\b|level-order|arrayToTree|treeToArray/.test(codeOnly)) return 'tree';
  if (/\bListNode\b|\barrayToList\b|\blistToArray\b|\.next\b/.test(codeOnly)) return 'list';
  if (GRAPH_MODULES.has(relPath.split('/')[0])) return 'graph';
  if (/\bunion\s*\(|\bunionFind\b|\badj(?:acency)?\b|\bneighbors\b/.test(codeOnly)) return 'graph';
  return 'json';
}

/** returnType -> equivalence. Everything not listed here is compared exactly. */
function equivalenceFor(returnType, codec) {
  if (returnType === 'float') return 'int-with-tolerance';
  if (returnType === 'void' || returnType === 'class-instance') return 'ops-terminal-state-and-outputs';
  if (returnType === 'array' || returnType === 'object' || returnType === 'null') return 'exact';
  if (returnType === null) return codec === 'ops' ? 'ops-terminal-state-and-outputs' : 'exact';
  return 'exact';
}

// ---------------------------------------------------------------------------
// Build.

export function buildEntry(relPath, runtime) {
  const abs = path.join(ROOT_DIR, relPath);
  const content = fs.readFileSync(abs, 'utf-8');
  const blocks = selectSolutionBlocks(content);
  const byLevel = [1, 2, 3].map((n) => declarations((blocks.find((b) => b.level === n) || { code: '' }).code));
  const { names, target } = levelTargets(byLevel);
  const code = blocks.map((b) => b.code).join('\n');

  const canonical = blocks.find((b) => b.level === 3) || { code: '' };
  // Two derivations, most-specific wins. The canonical body contributes exactly two
  // unambiguous code facts — a class target, and a body with no VALUE-returning `return`
  // which is the in-place-mutation signature. Everything else comes from the guide's own
  // sample-output column, then the authored cases.
  //
  // ponytail: classifying each `return` expression is NOT attempted. A `return res;`
  // carries no shape, and a nesting-aware scan of 150 hand-written blocks is the kind of
  // parse that invents labels. Ceiling: returnType is the observable shape, not a
  // signature — `array` means "an array of unstated element type". Row 15 re-derives it
  // from real executions if a guide ever needs a finer label.
  const body = target ? bodyOf(canonical.code, target.name) : null;
  const fromGuide = reduceTypes(edgeMatrixTypes(content));
  const fromCases = reduceTypes(expectTypes(runtime));
  const UNINFORMATIVE = (t) => t === null || t === 'array';
  const fromProse = UNINFORMATIVE(fromGuide) ? fromCases || fromGuide : fromGuide;
  const noReturn = body !== null && body !== undefined && !/\breturn\b(?!\s*[;}])/.test(body);
  const returnType = target && target.class ? 'class-instance' : noReturn ? 'void' : fromProse;

  const codec = codecFor(relPath, code, target);
  const override = EQUIVALENCE_OVERRIDES[relPath];
  const slug = path.basename(relPath, '.md').replace(/^\d+-/, '');

  return {
    path: relPath,
    slug,
    lcId: lcIdFromLink(content),
    title: titleFrom(content),
    difficulty: headerValue(content, 'Difficulty'),
    patterns: (headerValue(content, 'Pattern Category') || '').split(' / ').map((s) => s.trim()).filter(Boolean),
    codec,
    equivalence: override ? override[0] : equivalenceFor(returnType, codec),
    returnType,
    fnName: { L1: names[0], L2: names[1], L3: names[2] },
    canonicalTargetIsClass: Boolean(target && target.class),
  };
}

export function buildCatalog() {
  const registry = readRuntimeTestRegistry();
  const runtimeByPath = new Map();
  const src = fs.readFileSync(path.join(ROOT_DIR, 'scripts', 'test-runner.mjs'), 'utf-8');
  const marker = 'const RUNTIME_TESTS = ';
  const from = src.indexOf(marker);
  const to = src.indexOf('\n};', from);
  try {
    const table = new Function(`return ${src.slice(from + marker.length, to + 2)}`)();
    for (const [k, v] of Object.entries(table)) runtimeByPath.set(k, v);
  } catch {
    /* the cross-check degrades; --verify reports the dropped coverage */
  }
  const problems = listGuides()
    .map((rel) => buildEntry(rel, runtimeByPath.get(rel) || null))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return {
    generator: 'scripts/gen-catalog.mjs',
    source: 'guide markdown — `**Difficulty**` / `**Pattern Category**` / `**LeetCode Link**` headers, `# ` title, and the K7 solution block per `## N. Level N` heading',
    identity: 'path',
    guideCount: problems.length,
    runtimeTested: registry.entries.filter((e) => runtimeByPath.has(e)).length,
    problems,
  };
}

// ---------------------------------------------------------------------------
// Verify.

function check(results, label, ok, detail = '') {
  results.push({ label, ok, detail });
}

export function verify() {
  const results = [];
  const derived = buildCatalog();

  if (!fs.existsSync(CATALOG_PATH)) {
    check(results, 'catalog/problems.json exists', false, 'not found — run `node scripts/gen-catalog.mjs`');
    return results;
  }
  const raw = fs.readFileSync(CATALOG_PATH, 'utf-8');
  let file;
  try {
    file = JSON.parse(raw);
  } catch (err) {
    check(results, 'catalog/problems.json parses', false, err.message);
    return results;
  }
  check(results, 'catalog/problems.json exists', true, path.relative(ROOT_DIR, CATALOG_PATH));
  check(results, 'JSON parses', true, `${raw.length} bytes`);
  check(results, 'generator provenance present', file.generator === 'scripts/gen-catalog.mjs', `generator=${file.generator}`);
  check(results, 'identity is path', file.identity === 'path', `identity=${file.identity}`);

  const entries = Array.isArray(file.problems) ? file.problems : [];
  check(results, 'exactly 150 entries', entries.length === 150, `measured ${entries.length}`);
  const paths = entries.map((e) => e.path);
  check(results, '150 unique paths (E30)', new Set(paths).size === 150, `measured ${new Set(paths).size} unique of ${paths.length}`);

  const guides = listGuides();
  const guideSet = new Set(guides);
  const missingOnDisk = paths.filter((p) => !fs.existsSync(path.join(ROOT_DIR, p)));
  check(results, 'every path exists on disk', missingOnDisk.length === 0, missingOnDisk.slice(0, 5).join(', ') || '0 missing');
  const notAGuide = paths.filter((p) => !guideSet.has(p));
  const noEntry = guides.filter((g) => !paths.includes(g));
  check(results, 'catalog maps 1:1 onto the guide list', notAGuide.length === 0 && noEntry.length === 0, `${notAGuide.length} unknown, ${noEntry.length} uncovered`);

  const badDifficulty = [];
  const badPatterns = [];
  const badTitle = [];
  const badSlug = [];
  const badCodec = [];
  const badEquiv = [];
  const badLcId = [];
  const missingFn = [];
  const nullFields = {};
  for (const e of entries) {
    const abs = path.join(ROOT_DIR, e.path);
    if (!fs.existsSync(abs)) continue;
    const content = fs.readFileSync(abs, 'utf-8');
    const diff = headerValue(content, 'Difficulty');
    if (e.difficulty !== diff) badDifficulty.push(`${e.path}: catalog=${e.difficulty} guide=${diff}`);
    if (!DIFFICULTIES.includes(e.difficulty)) badDifficulty.push(`${e.path}: not Easy/Medium/Hard (${e.difficulty})`);
    const pattern = headerValue(content, 'Pattern Category');
    if ((e.patterns || []).join(' / ') !== pattern) badPatterns.push(`${e.path}: catalog=${JSON.stringify(e.patterns)} guide=${JSON.stringify(pattern)}`);
    if (e.title !== titleFrom(content)) badTitle.push(`${e.path}: catalog=${e.title} guide=${titleFrom(content)}`);
    if (e.slug !== path.basename(e.path, '.md').replace(/^\d+-/, '')) badSlug.push(`${e.path}: ${e.slug}`);
    if (!CODECS.includes(e.codec)) badCodec.push(`${e.path}: ${e.codec}`);
    if (!EQUIVALENCE.includes(e.equivalence)) badEquiv.push(`${e.path}: ${e.equivalence}`);
    if (e.lcId !== null && !Number.isInteger(e.lcId)) badLcId.push(`${e.path}: ${e.lcId}`);
    for (const lvl of ['L1', 'L2', 'L3']) {
      if (!e.fnName || !e.fnName[lvl]) missingFn.push(`${e.path} ${lvl}`);
      else nullFields[`fnName.${lvl}`] = (nullFields[`fnName.${lvl}`] || 0) + 1;
    }
    for (const f of ['lcId', 'returnType']) if (e[f] === null) nullFields[f] = (nullFields[f] || 0) + 1;
  }
  check(results, 'difficulty matches the guide text', badDifficulty.length === 0, badDifficulty.slice(0, 4).join(' | ') || '150/150 match');
  check(results, 'patterns[] reconstructs the guide\'s Pattern Category', badPatterns.length === 0, badPatterns.slice(0, 4).join(' | ') || '150/150 match');
  check(results, 'title matches the guide H1', badTitle.length === 0, badTitle.slice(0, 4).join(' | ') || '150/150 match');
  check(results, 'slug matches the filename', badSlug.length === 0, badSlug.slice(0, 4).join(' | ') || '150/150 match');
  check(results, `codec ∈ the 5 implemented (${CODECS.join(',')})`, badCodec.length === 0, badCodec.slice(0, 6).join(' | ') || '150/150');
  check(results, `equivalence ∈ the 6 kinds`, badEquiv.length === 0, badEquiv.slice(0, 6).join(' | ') || '150/150');
  check(results, 'lcId is an integer or null', badLcId.length === 0, badLcId.slice(0, 4).join(' | ') || 'ok');
  const undeclared = entries.filter((e) => !e.fnName || ['L1', 'L2', 'L3'].some((l) => !(l in e.fnName)));
  check(
    results,
    'every entry declares fnName.L1/L2/L3 (value or honest null)',
    undeclared.length === 0,
    `${missingFn.length ? missingFn.join(', ') : 'no honest nulls'}`
  );
  check(results, 'entries sorted by path', paths.every((p, i) => i === 0 || paths[i - 1] < p), 'ascending');

  // fnName agrees with RUNTIME_TESTS wherever the runner already knows the answer.
  const registry = readRuntimeTestRegistry();
  let checked = 0;
  const disagree = [];
  const src = fs.readFileSync(path.join(ROOT_DIR, 'scripts', 'test-runner.mjs'), 'utf-8');
  const marker = 'const RUNTIME_TESTS = ';
  const from = src.indexOf(marker);
  const to = src.indexOf('\n};', from);
  let table = {};
  try {
    table = new Function(`return ${src.slice(from + marker.length, to + 2)}`)();
  } catch { /* reported by the registry error below */ }
  for (const e of entries) {
    const names = runtimeNames(table[e.path]);
    if (!names) continue;
    checked++;
    const mine = [e.fnName.L1, e.fnName.L2, e.fnName.L3];
    if (JSON.stringify(mine) !== JSON.stringify(names)) disagree.push(`${e.path}: catalog=${JSON.stringify(mine)} runner=${JSON.stringify(names)}`);
  }
  check(results, 'fnName agrees with RUNTIME_TESTS', disagree.length === 0, `${checked - disagree.length}/${checked} agree${disagree.length ? ' — ' + disagree.slice(0, 3).join(' | ') : ''}`);
  check(results, 'RUNTIME_TESTS entries still resolvable', registry.entries.length === 109, `${registry.entries.length} entries, ${registry.fnsAndCases} fns+cases / ${registry.script} script`);

  // returnType cross-check against authored cases (independent source). The two known
  // divergences are named so a NEW one fails the gate instead of riding the allowance.
  const RETURN_TYPE_DIVERGENCES = {
    '12-binary-search/07-median-of-two-sorted-arrays.md': "guide's own sample output is 2.5 (a true median can be a half-integer); the runner's cases only assert integers",
  };
  let xchecked = 0;
  const xbad = [];
  for (const e of entries) {
    const types = expectTypes(table[e.path]);
    if (!types.length || !e.returnType) continue;
    xchecked++;
    const t = reduceTypes(types);
    if (t !== e.returnType && !RETURN_TYPE_DIVERGENCES[e.path]) xbad.push(`${e.path}: catalog=${e.returnType} cases=${t}`);
  }
  check(
    results,
    'returnType agrees with authored cases (except the named divergences)',
    xbad.length === 0,
    `${xchecked - xbad.length}/${xchecked} agree; named divergence: ${Object.keys(RETURN_TYPE_DIVERGENCES).join(', ') || 'none'}${xbad.length ? ' — NEW: ' + xbad.join(' | ') : ''}`
  );

  // staleness: the committed file must equal a fresh derivation.
  const drift = [];
  for (const key of Object.keys(derived)) {
    if (key === 'problems') continue;
    if (JSON.stringify(derived[key]) !== JSON.stringify(file[key])) drift.push(`${key}: committed=${JSON.stringify(file[key])} derived=${JSON.stringify(derived[key])}`);
  }
  const driftFields = [];
  for (let i = 0; i < entries.length; i++) {
    const a = derived.problems[i];
    const b = entries[i];
    if (!a || a.path !== b.path) { driftFields.push(`order: ${b.path} != ${a && a.path}`); continue; }
    for (const k of Object.keys(a)) {
      if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) driftFields.push(`${a.path}.${k}`);
    }
  }
  check(results, 'committed file equals a fresh derivation (stale detector)', drift.length === 0 && driftFields.length === 0, [...drift, ...driftFields].slice(0, 6).join(' | ') || '0 drift');

  return results;
}

// ---------------------------------------------------------------------------
// Report.

function histogram(entries, key) {
  const out = {};
  for (const e of entries) out[e[key]] = (out[e[key]] || 0) + 1;
  return Object.entries(out).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

function printTable(title, rows, total) {
  const w = Math.max(title.length, ...rows.map((r) => r[0].length));
  console.log(`\n${title}`);
  for (const [k, n] of rows) console.log(`  ${String(k).padEnd(w)}  ${String(n).padStart(3)}  ${((n / total) * 100).toFixed(1)}%`);
}

function printReport(catalog) {
  const entries = catalog.problems;
  const moduleOf = (p) => p.split('/')[0];
  const mods = {};
  for (const e of entries) mods[moduleOf(e.path)] = (mods[moduleOf(e.path)] || 0) + 1;

  printTable('DIFFICULTY', histogram(entries, 'difficulty'), entries.length);
  printTable('MODULE DIRECTORY', Object.entries(mods).sort(), entries.length);
  printTable('CODEC (suggestion; row 17 owns the registry)', histogram(entries, 'codec'), entries.length);
  printTable('EQUIVALENCE', histogram(entries, 'equivalence'), entries.length);
  printTable('RETURN TYPE', histogram(entries, 'returnType'), entries.length);

  const nulls = [];
  for (const e of entries) {
    if (e.lcId === null) nulls.push([e.path, 'lcId']);
    if (e.returnType === null) nulls.push([e.path, 'returnType']);
    for (const l of ['L1', 'L2', 'L3']) if (!e.fnName[l]) nulls.push([e.path, `fnName.${l}`]);
  }
  console.log(`\nNULL FIELDS (${nulls.length})`);
  for (const [p, f] of nulls) console.log(`  ${f.padEnd(11)} ${p}`);

  const byLevel = { L1: 0, L2: 0, L3: 0 };
  const classTargets = [];
  for (const e of entries) {
    for (const l of ['L1', 'L2', 'L3']) if (e.fnName[l]) byLevel[l]++;
    if (e.canonicalTargetIsClass) classTargets.push(e.path);
  }
  console.log(`\nfnName resolved: L1 ${byLevel.L1}/150  L2 ${byLevel.L2}/150  L3 ${byLevel.L3}/150`);
  console.log(`canonical target is a class (${classTargets.length}) — fnName names the class, codec=ops:`);
  for (const p of classTargets) console.log(`  ${p}`);

  console.log(`\nEQUIVALENCE set by hand (${Object.keys(EQUIVALENCE_OVERRIDES).length}); the rest derived from returnType, then codec:`);
  for (const [p, [kind, why]] of Object.entries(EQUIVALENCE_OVERRIDES)) console.log(`  ${kind.padEnd(22)} ${p}\n    ${why}`);
}

// ---------------------------------------------------------------------------

if (process.argv[1] === __filename) {
  const argv = process.argv.slice(2);
  if (argv.includes('--verify')) {
    const results = verify();
    for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.label}${r.detail ? ' — ' + r.detail : ''}`);
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
  }
  const catalog = buildCatalog();
  if (argv.includes('--report')) {
    printReport(catalog);
    process.exit(0);
  }
  fs.mkdirSync(CATALOG_DIR, { recursive: true });
  const text = JSON.stringify(serialize(catalog), null, 2) + '\n';
  fs.writeFileSync(CATALOG_PATH, text);
  console.log(`wrote ${path.relative(ROOT_DIR, CATALOG_PATH)} — ${catalog.problems.length} entries, ${text.length} bytes`);
  printReport(catalog);
}
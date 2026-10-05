/**
 * Solution-block manifest — plan v5 §7 row 7 (decisions K4, K5, K7).
 *
 *   node scripts/gen-blocks.mjs             generate build/blocks.json
 *   node scripts/gen-blocks.mjs --verify    re-derive every hash from the guides on
 *                                           disk and prove the manifest is not stale
 *
 * Block SELECTION is not reimplemented here: `selectSolutionBlocks` is row 0's pinned
 * K7 predicate (the first ```javascript fence inside each `## N. Level 1|2|3` heading)
 * and it is IMPORTED, so the repo keeps exactly one definition of "solution block".
 *
 * Fields, and the downstream row each one exists for:
 *
 *   path            E30 — keyed by path, never by slug: two guides may share a title.
 *   level           1|2|3, the K7 key.
 *   blockHash       K5 — identity is sha256(utf8 block source) prefixed `sha256:`,
 *                   NEVER a line number. U4: a line number moves when any earlier line
 *                   of the guide is edited, which is what made goldens a repo-wide churn
 *                   engine.
 *   blockOffset     K5/U4 concession — WHERE the block sits: a 1-based LINE number of the
 *                   block's first code line in the guide, so a render resolves a step's
 *                   `line: {h, off}` with `guideLine = blockOffset + step.line.off`. It is a
 *                   regenerable HINT, never identity — which is the point of the
 *                   concession: the guide-to-trace link survives an edit because the hash
 *                   finds the block and the offset only places it.
 *   blockLines      envelope v1.1 invariant 1 (`line.off < block.lines`) needs the block's
 *                   line count; emitting it here stops row 9 re-deriving it.
 *   targetFn        K1 — the function/class this level's dry-run is about, derived (it
 *                   replaces `RUNTIME_TESTS.fns`; row 2 drops that duplication).
 *   selfRecursive   U3/E10 — true when the target, or any node in its region, calls itself,
 *                   so row 20's non-vacuity assertion has a machine-readable predicate
 *                   instead of a guess (an entry point that delegates recursion to a
 *                   closure still counts).
 *   codec           G1 — a SUGGESTION from what the code manipulates. Row 17 owns the
 *                   registry and fails CI loudly on an unimplemented codec, so this file
 *                   never invents a 6th codec and never guesses silently.
 *   regionTable     K4 — which function nodes are lexically inside the target.
 *                   depth 0 = the target itself plus every node lexically inside it
 *                   (class methods, object-literal methods, getters, arrow fields, IIFEs,
 *                   callbacks) — E10/E11/E12/E15. depth 1 = a node declared in the same
 *                   block but OUTSIDE the target (`arrayToTree`), suppressed — E13. The
 *                   runtime compares ONE integer; there is no runtime depth accounting,
 *                   because a runtime counter suppresses a recursive target's own body on
 *                   every recursive call and would leave most traces vacuously empty (U3).
 *   watch           D6/A1 — derived identifiers to snapshot: the target's parameters,
 *                   every let/var/const bound inside the target region (which is every
 *                   loop counter and accumulator), and `this.<field>` for a class target.
 *                   Never authored.
 *
 * // ponytail: the region scan, the parameter list, the `watch` bindings and the target
 * heuristic are ONE regex-and-brace pass, not a parse — `acorn` + `acorn-walk` are row
 * 9's declared devDependencies and are deliberately absent here. The ceiling is real: a
 * template literal's `${…}` is read as opaque (a function-like inside an interpolation is
 * missed), a regex literal is resolved by the previous-token rule (`}` counts as
 * expression-position), a computed member key `[Symbol.iterator](…)` is not recognised as
 * a method, an arrow IIFE is recorded as an anonymous `arrow-fn` rather than `iife`
 * (measured 0 IIFEs in the 450 blocks), and a re-binding default (`function f(a, {b = a})`)
 * yields `a` twice, which the dedupe collapses. None of that touches SELECTION or the
 * hash, which belong to row 0 and `crypto`; it bounds only targetFn / regionTable / watch
 * fidelity. Measured on this corpus: 0 named declarations missed by `regionTable`, and
 * `targetFn` agrees with all 168 hand-written `RUNTIME_TESTS.fns` names. Row 9 swaps this
 * pass for an acorn walk and keeps every field name.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

import { selectSolutionBlocks, listGuides, ROOT_DIR } from './audit-curriculum.mjs';
import { stringify } from './lib/serialize.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const OUTPUT_PATH = path.join(ROOT_DIR, 'build', 'blocks.json');
export const GENERATOR = 'scripts/gen-blocks.mjs';
export const SCHEMA_VERSION = 1;

/**
 * K5 identity. The hashed string is exactly `selectSolutionBlocks(...).code` — the
 * fenced body joined with '\n', no trailing newline — so any consumer that re-selects
 * the block with the same predicate reproduces the hash byte for byte.
 */
export function blockHashOf(blockSource) {
  return `sha256:${crypto.createHash('sha256').update(blockSource, 'utf-8').digest('hex')}`;
}

// ---------------------------------------------------------------------------
// Lexical scanner: one pass over a block's source -> function-like nodes with their
// enclosing frame, declared bindings, and call sites. See the ponytail ceiling above.
const KEYWORDS = new Set([
  'function', 'class', 'const', 'let', 'var', 'return', 'if', 'else', 'for', 'while', 'do',
  'switch', 'case', 'break', 'continue', 'new', 'typeof', 'instanceof', 'in', 'of', 'this',
  'try', 'catch', 'finally', 'throw', 'delete', 'void', 'get', 'set', 'static', 'async',
  'await', 'yield', 'extends', 'super', 'true', 'false', 'null', 'undefined',
]);
const ID_START = /[A-Za-z_$]/;
const ID_PART = /[\w$]/;
const IDENT_RE = /^[A-Za-z_$][\w$]*$/;

const idStart = (c) => c !== undefined && ID_START.test(c);
const idPart = (c) => c !== undefined && ID_PART.test(c);

function skipQuoted(src, i) {
  const quote = src[i];
  i += 1;
  while (i < src.length && src[i] !== quote) {
    if (src[i] === '\\') i += 1;
    i += 1;
  }
  return i + 1;
}

// A template literal is opaque, except that `${…}` must not unbalance the brace stack —
// the interpolation depth is counted so a `}` inside one is never read as a block end.
function skipTemplate(src, i) {
  i += 1;
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') i += 2;
    else if (c === '`') return i + 1;
    else if (depth === 0 && c === '$' && src[i + 1] === '{') { depth += 1; i += 2; }
    else if (depth > 0 && c === '{') { depth += 1; i += 1; }
    else if (depth > 0 && c === '}') { depth -= 1; i += 1; }
    else i += 1;
  }
  return i;
}

function skipRegex(src, i) {
  i += 1;
  let inClass = false;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') i += 2;
    else if (c === '[') { inClass = true; i += 1; }
    else if (c === ']') { inClass = false; i += 1; }
    else if (c === '/' && !inClass) return i + 1;
    else if (c === '\n') return i; // unterminated: it was a division sign after all
    else i += 1;
  }
  return i;
}

/** Identifiers BOUND by one destructuring pattern or parameter list; keys and `obj.a` skipped. */
function identifiersIn(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') { i = skipQuoted(text, i); continue; }
    if (!idStart(c) || idPart(text[i - 1])) { i += 1; continue; }
    let j = i;
    while (j < text.length && idPart(text[j])) j += 1;
    const name = text.slice(i, j);
    let k = j;
    while (k < text.length && /\s/.test(text[k])) k += 1;
    const isRest = text.slice(i - 3, i) === '...'; // `...rest` binds, `obj.a` does not
    const isKey = text[k] === ':';
    const isProp = !isRest && (text[i - 1] === '.' || text[j] === '.');
    if (!isKey && !isProp && !KEYWORDS.has(name)) out.push(name);
    i = j;
  }
  return out;
}

/** Split on top-level commas, so `{a, b}` and `(x = [1, 2])` stay one binding each. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') { i = skipQuoted(text, i) - 1; continue; }
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') depth -= 1;
    else if (c === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

const paramsOf = (paramsText) => splitTopLevel(paramsText || '').flatMap(identifiersIn);

/**
 * @param {string} code one solution block's source
 * @returns {{nodes: {name: string|null, kind: string, frame: object, params: string[]}[],
 *            bindings: {name: string, frame: object}[], calls: {name: string, frame: object}[],
 *            root: object}}
 */
export function scanBlock(code) {
  const nodes = [];
  const bindings = [];
  const calls = [];
  const stack = [{ kind: 'block', index: 0, parent: null, virtual: false }];
  const tokens = [];
  const parens = [];
  let pendingFn = null;   // a function-like whose body has not opened yet
  let pendingClass = null;
  let pendingAccessor = null;
  let pendingDecl = null; // const|let|var awaiting its binding name
  let declParamParen = false; // the next `(` is a declaration head, not a call site
  let lastParen = null;   // the most recently closed `( … )`

  const frame = () => stack[stack.length - 1];
  const pushFrame = (kind, extra) => {
    const f = { kind, index: stack.length, parent: frame(), virtual: false, ...extra };
    stack.push(f);
    return f;
  };
  const popTo = (target) => {
    while (stack.length > 1 && stack[stack.length - 1] !== target) stack.pop();
    if (stack.length > 1) stack.pop();
  };
  const popVirtual = (minIndex = 0) => {
    while (stack.length > 1 && frame().virtual && frame().index >= minIndex) stack.pop();
  };
  const tok = (back = 0) => tokens[tokens.length - 1 - back];
  const lastTok = () => tok();
  const afterDot = () => tok(1) === '.';
  const isIdentTok = (t) => typeof t === 'string' && IDENT_RE.test(t);
  const sigOpaque = () => { if (tokens.length) tokens[tokens.length - 1] = '"str"'; };

  let i = 0;
  while (i < code.length) {
    const c = code[i];

    if (c === '\n' || c === '\r' || c === ' ' || c === '\t') { i += 1; continue; }

    if (c === '/' && code[i + 1] === '/') { while (i < code.length && code[i] !== '\n') i += 1; continue; }
    if (c === '/' && code[i + 1] === '*') {
      i += 2;
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'") { i = skipQuoted(code, i); sigOpaque(); continue; }
    if (c === '`') { i = skipTemplate(code, i); sigOpaque(); continue; }
    // `/` opens a regex unless the previous token could end an expression.
    if (c === '/' && (!isIdentTok(lastTok()) || lastTok() === ')' || lastTok() === ']')) {
      i = skipRegex(code, i);
      sigOpaque();
      continue;
    }

    if (idStart(c)) {
      let j = i;
      while (j < code.length && idPart(code[j])) j += 1;
      const word = code.slice(i, j);
      const prev = lastTok();
      const stmtStart = prev === undefined || prev === ';' || prev === '{' || prev === '}' || prev === '=>' || prev === ')';
      i = j;

      if (word === 'function') {
        const named = code.slice(j).match(/^\s*\*?\s*([A-Za-z_$][\w$]*)/);
        tokens.push(word);
        pendingFn = { kind: named ? (named[1] && stmtStart ? 'function-decl' : 'function-expr') : 'iife', name: named ? named[1] : null, paramsText: '' };
        declParamParen = true;
      } else if (word === 'class') {
        const named = code.slice(j).match(/^\s*([A-Za-z_$][\w$]*)/);
        tokens.push(word);
        pendingClass = { name: named ? named[1] : null };
        declParamParen = true;
      } else if (word === 'const' || word === 'let' || word === 'var') {
        pendingDecl = word;
        tokens.push(word);
      } else if (pendingDecl) {
        const pattern = code.slice(j).match(/^\s*([{[])([\s\S]*?)\1/);
        if (pattern) {
          for (const id of identifiersIn(pattern[2])) bindings.push({ name: id, frame: frame() });
          i = j + pattern[0].length;
        } else {
          bindings.push({ name: word, frame: frame() });
        }
        pendingDecl = null;
        tokens.push(word);
      } else {
        // `this.field = …` is instance state a dry-run must snapshot; `obj.field` and a
        // `this.method()` call are not state.
        if (word === 'this') {
          const field = code.slice(j).match(/^\.([A-Za-z_$][\w$]*)\s*=(?!=)/);
          if (field) {
            bindings.push({ name: `this.${field[1]}`, frame: frame() });
            i = j + field[0].length;
            tokens.push('"str"');
            continue;
          }
        }
        // `get`/`set` is an accessor only in `get name(` form — `set(k, v) {` is a plain
        // method. The flag survives the NAME token that follows it.
        if (word === 'get' || word === 'set') {
          pendingAccessor = /^\s+[A-Za-z_$][\w$]*\s*\(/.test(code.slice(j)) ? word : null;
        }
        tokens.push(word);
      }
      continue;
    }

    if (/[0-9]/.test(c)) { while (i < code.length && /[\w.]/.test(code[i])) i += 1; sigOpaque(); continue; }

    // `=>`: the arrow's own frame opens here, with or without a brace body.
    if (c === '=' && code[i + 1] === '>') {
      const owner = frame().kind;
      let paramsText = '';
      const parenthesised = lastTok() === ')' && lastParen;
      if (parenthesised) paramsText = code.slice(lastParen.start + 1, lastParen.end);
      else if (isIdentTok(lastTok())) paramsText = String(lastTok()); // `x => x * 2`

      // The arrow is only BOUND when its `=` is the one it hangs off. `const clone =
      // matrix.map(row => …)` binds `clone` to a call, so the callback stays anonymous —
      // which is why this checks the paren that actually fed the arrow.
      const eq = tokens.lastIndexOf('=');
      const bound = eq >= 0 && (Boolean(lastParen && lastParen.assigned) || (!parenthesised && tokens[eq + 1] === lastTok()));
      let nameAt = eq - 1;
      if (tokens[nameAt] === ':') nameAt -= 1;
      const assignName = bound && isIdentTok(tokens[nameAt])
        && (nameAt <= 1 || ['const', 'let', 'var', ';', ',', '{', '}', '(', ':', '=', 'return'].includes(tokens[nameAt - 1]))
        ? String(tokens[nameAt])
        : null;
      // An object-literal field is keyed, not named: `{ '+': (a, b) => … }`. The key text
      // is only recoverable from the source between this frame's `{` and the `=>`.
      const literalKey = owner === 'object-literal' && frame().bodyStart !== undefined
        ? ((code.slice(frame().bodyStart, i).match(/([A-Za-z_$][\w$]*|(['"`])[^'"`]*\2)\s*:\s*\([^()]*\)\s*$/) || [null, null])[1] || null)
        : null;

      pendingFn = {
        // A parenthesised ANONYMOUS arrow is an IIFE too, but telling `(IIFE)` from
        // `map((x) => …)` needs the call site, not the `=>`; it is recorded as an anonymous
        // `arrow-fn`, which is the same thing to the runtime gate (depth 0). ponytail:
        // measured 0 IIFEs of either form in the 450 blocks; row 9 reads the real kind
        // off the AST.
        kind: owner === 'class-body' ? 'class-arrow-field' : owner === 'object-literal' ? 'object-arrow-field' : 'arrow-fn',
        name: assignName || literalKey,
        paramsText,
      };
      declParamParen = false;
      tokens.push('=>');
      i += 2;
      if (code[i] !== '{') {
        // Expression body: the frame closes at the next `;`, `,` or `)` at this level.
        const f = pushFrame(pendingFn.kind, { virtual: true });
        nodes.push({ name: pendingFn.name, kind: pendingFn.kind, frame: f, params: paramsOf(pendingFn.paramsText), order: nodes.length });
        pendingFn = null;
      }
      continue;
    }

      if (c === '(') {
        const prev = lastTok();
        // A `function name(` / `class name(` head is a DECLARATION, not a call site — and a
        // self-call read off one would make every target look recursive.
        if (isIdentTok(prev) && !KEYWORDS.has(String(prev)) && !declParamParen) calls.push({ name: String(prev), frame: frame() });
        parens.push({ start: i, depth: stack.length, assigned: lastTok() === '=' });
        // An identifier followed by `(` inside a class or object body opens a METHOD body.
        if (isIdentTok(prev) && !afterDot() && (frame().kind === 'class-body' || frame().kind === 'object-literal')) {
          const owner = frame().kind === 'class-body' ? 'class' : 'object';
          const accessor = { get: 'getter', set: 'setter' }[pendingAccessor] || 'method';
          pendingFn = { kind: `${owner}-${accessor}`, name: String(prev), paramsText: '' };
          pendingAccessor = null;
        }
        declParamParen = false;
        tokens.push('(');
        i += 1;
        continue;
      }

    if (c === ')') {
      const open = parens.pop();
      declParamParen = false;
      if (open && pendingFn && pendingFn.paramsText === '') pendingFn.paramsText = code.slice(open.start + 1, i);
      popVirtual(open ? open.depth : 0);
      lastParen = { start: open ? open.start : i, end: i, assigned: Boolean(open && open.assigned) };
      tokens.push(')');
      i += 1;
      continue;
    }

    // `{`: the only place a scope frame opens.
    if (c === '{') {
      declParamParen = false;
      if (pendingFn) {
        const f = pushFrame(pendingFn.kind);
        nodes.push({ name: pendingFn.name, kind: pendingFn.kind, frame: f, params: paramsOf(pendingFn.paramsText), order: nodes.length });
        pendingFn = null;
        pendingAccessor = null;
      } else if (pendingClass) {
        const f = pushFrame('class-body');
        nodes.push({ name: pendingClass.name, kind: 'class', frame: f, params: [], order: nodes.length });
        pendingClass = null;
        pendingAccessor = null;
      } else {
        const prev = lastTok();
        const literal = prev === '=' || prev === '(' || prev === ',' || prev === ':' || prev === '[' || prev === 'return' || prev === '?';
        pushFrame(literal ? 'object-literal' : 'block', literal ? { bodyStart: i + 1 } : undefined);
      }
      tokens.length = 0;
      i += 1;
      continue;
    }

    if (c === '}') { popVirtual(); popTo(frame()); tokens.length = 0; i += 1; continue; }
    if (c === ';') { popVirtual(); pendingDecl = null; tokens.length = 0; i += 1; continue; }
    // A comma ends a declarator (`const a = 1, b = 2`) but NOT a parameter list, where
    // wiping the tokens would lose `const reverse = (left, right) =>`'s binding.
    if (c === ',') { popVirtual(); if (parens.length) tokens.push(','); else tokens.length = 0; i += 1; continue; }

    // `head = new Node()` inside a class body is a field the dry-run must watch.
    if (c === '=' && code[i + 1] !== '=' && frame().kind === 'class-body' && isIdentTok(lastTok()) && !afterDot()
      && !['const', 'let', 'var', 'static', 'get', 'set'].includes(String(lastTok()))) {
      bindings.push({ name: String(lastTok()), frame: frame() });
    }
    tokens.push(c);
    i += 1;
  }

  return { nodes, bindings, calls, root: stack[0] };
}

/** K4: is `nodeFrame` the target frame, or lexically inside it? */
const inside = (nodeFrame, targetFrame) => {
  for (let f = nodeFrame; f; f = f.parent) if (f === targetFrame) return true;
  return false;
};

// The 150 problem guides, and ONLY those: markdown inside a numbered curriculum module
// directory (`01-array-string/` … `23-kadanes-algorithm/`). `listGuides()` is row 0's
// guide predicate and this row composes it, but it is a REPO-WIDE markdown scan whose
// SKIP_DIRS set cannot know about every new markdown directory — `docs/rubrics/
// guide-quality.md` (row 0b) landed mid-row and made it return 151, which failed this
// script's own "every guide selects 3 blocks" gate. A solution-block manifest belongs to
// the curriculum modules, so the module directory is the scope. Row 0 owns SKIP_DIRS and
// should add `docs` there too; this file does not paper over its counts.
const CURRICULUM_MODULE = /^\d\d-[^/]+\//;

/** Repo-relative paths of the guides this manifest covers, sorted, 150 of them. */
export function listProblemGuides() {
  return listGuides().filter((file) => CURRICULUM_MODULE.test(file));
}

// ---------------------------------------------------------------------------
// targetFn (K1). Derived, never authored. STRUCTURE first, text only as tiebreak:
//
//   TOP LEVEL   the target is the block's ENTRY POINT — a function-like whose frame's
//               parent is the module root. A closure nested inside it (`backtrack`,
//               `visit`, `applyTop`) belongs to the target's REGION (K4 depth 0), not to
//               the entry signature, and the dry-run table naming it must not promote it.
//   CALLED?      +5  no OTHER candidate calls it, so it is a ROOT of the block's call graph,
//               and that outranks prose (4). This is what separates a solution from its
//               scaffolding structurally, with no text: `calcEquation` beats the `WeightedUF`
//               class its own pseudocode is written around, and `connectRecursive` beats the
//               `findNextChild` helper it calls. A self-call does NOT count — a recursive
//               target calls itself, and disqualifying that would hand the target to its own
//               helper (U3).
//   prose       4  the level's OWN section prose names it — guides write
//                  `FUNCTION maxDepthBFS(root):` in the pseudocode and repeat the name in
//                  the dry-run table.
//   title       2  the guide's H1 shares a camelCase token with it
//   order       +  fractional document position — the tiebreak that matters, and it is
//                  measured, not guessed: guides declare the scaffolding they demonstrate
//                  (TreeNode, arrayToTree, DLinkedNode) BEFORE the solution.
const nameTokens = (name) =>
  name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !KEYWORDS.has(t));

const mentions = (haystack, name) =>
  new RegExp(`(^|[^\\w$])${name.replace(/\$/g, '\\$')}([^\\w$]|$)`).test(haystack);

/** Method-like shapes are region members, never the block's entry point. */
const isEntryCandidate = (node) => Boolean(node.name) && !/(^|-)(method|getter|setter)$/.test(node.kind);

export function chooseTargetFn(nodes, calls, prose, title, root) {
  const all = nodes.filter(isEntryCandidate);
  if (all.length === 0) return null;
  const top = all.filter((node) => node.frame.parent === root);
  // A block with no top-level function-like still has one entry point; that is the only
  // case where the answer is a guess.
  const candidates = top.length ? top : all;

  // "Called by another candidate" — NOT "called". A recursive target calls ITSELF, which
  // must not disqualify it, so a call only counts when its frame is outside the callee's.
  const byName = new Map(candidates.map((node) => [node.name, node]));
  const calledElsewhere = new Set();
  for (const call of calls) {
    const owner = byName.get(call.name);
    if (owner && !inside(call.frame, owner.frame)) calledElsewhere.add(call.name);
  }

  const titleWords = new Set(title.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  let best = null;
  let bestScore = -1;
  for (const node of candidates) {
    let score = 0;
    if (!calledElsewhere.has(node.name)) score += 5;
    if (mentions(prose, node.name)) score += 4;
    if (nameTokens(node.name).some((t) => titleWords.has(t))) score += 2;
    score += node.order / 10000;
    if (score > bestScore) { bestScore = score; best = node; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// codec (G1). A suggestion read off the block's own code, in priority order; default json.
// ponytail: the signals are deliberately narrow — a bare `Node`, `root` or `edges` word
// is not evidence (a trie has a root, a grid has neighbours, a binary search has "edges"
// of an interval), so those trip nothing and the block stays `json`. Grid-shaped problems
// (islands, sudoku, spiral, game of life) read as `graph` to a human and as a matrix to a
// renderer and this file cannot tell those two apart; where a grid problem trips `graph`
// on a real adjacency word, it is named in the row-7 report rather than reclassified here.
const CODEC_SIGNALS = [
  ['tree', /\bTreeNode\b|\.left\b|\.right\b|levelOrder/],
  ['list', /\bListNode\b|\bdummy\b|\.next\b/],
  ['graph', /\b(adj|adjList|adjacencyList|graph|neighbors|neighbours|numEdges|numCourses|numVertices|indegree|outdegree|edgeList)\b\s*(=[^=]|:|\[)/],
];

/** Parameter names that mean "a tree/node already exists, walk it". */
const NODE_PARAM = /^(root|node|n|tree|cur|current|p|q|top|parent|left|right|a|b)$/i;

/**
 * Parameter names that mean "raw values, from which a structure gets BUILT".
 *
 * This is the discriminator `tree` needs and did not have. `codec: tree` has one meaning to the
 * engine: `api/_lib/problems.mjs`'s driver rewrites the call as
 * `__FN__(__arrayToTree__(t.args[0]))` — the target CONSUMES a level-order array. So
 * `invertTree(root)` is `tree`, but `buildTreeMap(preorder, inorder)` is not: it takes two raw
 * arrays and constructs its own nodes, and marking it `tree` made the driver pass only the
 * first argument, so `inorder` arrived undefined and the trace came back empty.
 */
const RAW_PARAM = /^(nums|arr|vals|values|preorder|inorder|postorder|strs|words|s|t|matrix|grid|intervals|points|numbers)$/i;

/** The parameter list TEXT of `fnName` in `code`, or null when it cannot be found. */
// Named `paramListOf` not `paramsOf`: line 185 already owns that name for a different job
// (paramsText -> identifier list), and two functions with one name in one module is a crash.
export function paramListOf(code, fnName) {
  if (!fnName) return null;
  const esc = fnName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = code.match(new RegExp(`(?:function\\s+${esc}|const\\s+${esc}\\s*=\\s*(?:async\\s*)?(?:function)?\\s*\\*?)\\s*\\(([^)]*)\\)`));
  return m ? m[1] : null;
}

/**
 * Does the target CONSUME a tree, or BUILD one?
 *
 * True when any parameter names a node (`root`, `node`, `p`, `q`, `k`, …). False when every
 * parameter is a raw collection (`nums`, `preorder`, `inorder`, …) — that target reads values
 * and allocates its own nodes, so `json` is the honest codec and the driver must hand it the
 * arguments untouched.
 *
 * Undecidable (no params found, a mixed list, or names nobody recognises) → `true`, i.e. keep
 * the current behaviour. A guess that keeps the existing classification is safer than a guess
 * that reclassifies 60 blocks on a heuristic nobody has read.
 */
export function consumesTree(code, fnName) {
  const raw = paramListOf(code, fnName);
  if (raw === null) return true;
  const params = raw.split(',').map((s) => s.trim().split(/[\s=:]/)[0]).filter(Boolean);
  if (!params.length) return true;
  if (params.some((p) => NODE_PARAM.test(p))) return true;
  if (params.every((p) => RAW_PARAM.test(p))) return false;
  return true;
}


/**
 * `ops` outranks the shape signals on purpose: a class with BEHAVIOUR is a stateful object
 * whose mutation IS the story (the plan renders LRU as `LRU-ops`). A bare
 * `class TreeNode { constructor }` is a polyfill with no behaviour, so a tree or list guide
 * carrying its own node class still falls through to `tree` / `list`.
 */
export function suggestCodec(code, nodes = [], targetFn = null) {
  if (nodes.some((n) => n.kind === 'class-method' && n.name !== 'constructor')) return 'ops';
  for (const [name, re] of CODEC_SIGNALS) {
    if (!re.test(code)) continue;
    // `tree` additionally requires that the target CONSUMES a tree. A guide whose canonical
    // solution builds its own nodes from raw arrays is not a `tree` consumer, and the driver's
    // level-order rewrite would eat all but its first argument.
    if (name === 'tree' && !consumesTree(code, targetFn)) return 'json';
    return name;
  }
  return 'json';
}

// ---------------------------------------------------------------------------
function gitRev() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT_DIR, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null; // no git is not a manifest failure: staleness still fails on blockHash
  }
}

/** Markdown from the enclosing `## N. Level k` heading up to (not incl.) the fence line. */
function levelProse(lines, fenceLine) {
  for (let i = fenceLine - 2; i >= 0; i--) {
    if (/^#{1,6}\s+\d+\.\s+Level\s+[123]\b/.test(lines[i])) return lines.slice(i, fenceLine - 1).join('\n');
  }
  return '';
}

/** The `## N.` section in force at each line — the follow-up-selection check needs it. */
function sectionsByLine(lines) {
  const out = new Array(lines.length).fill(null);
  let current = null;
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^#{1,2}\s+(\d+)\.\s*(.*)$/);
    if (h) current = `${h[1]}. ${h[2]}`;
    out[i] = current;
  }
  return out;
}

const guideTitle = (content) => (content.match(/^#\s+(.*)$/m) || ['', ''])[1];

/** One manifest entry, fully derived. `sel` is a `selectSolutionBlocks` record. */
export function analyzeBlock(sel, prose, title) {
  const { nodes, bindings, calls, root } = scanBlock(sel.code);
  const target = chooseTargetFn(nodes, calls, prose, title, root);

  const regionTable = nodes.map((node) => ({
    name: node.name,
    kind: node.kind,
    depth: target && (node === target || inside(node.frame, target.frame)) ? 0 : 1,
  }));

  // A class's parameters are its constructor's — find that method in the region.
  const ctor = target && target.kind === 'class' ? nodes.find((n) => n.kind === 'class-method' && n.name === 'constructor') : null;

  let watch = [];
  let selfRecursive = false;
  if (target) {
    watch = [
      ...target.params,
      ...(ctor ? ctor.params : []),
      ...bindings.filter((b) => inside(b.frame, target.frame)).map((b) => b.name),
    ];
    watch = [...new Set(watch.filter((w) => w && !KEYWORDS.has(w)))];
    // True when the target — or any node in its REGION — calls itself. Entry points that
    // delegate recursion to a closure (`searchInsertRecursive` → `search`) are the case
    // the entry-point-only reading would miss, and they are exactly what row 20 must not
    // let pass vacuously (U3/E10).
    selfRecursive = nodes.some((node) =>
      inside(node.frame, target.frame)
      && calls.some((call) => call.name === node.name && inside(call.frame, node.frame)));
  }

  return {
    path: null,
    level: sel.level,
    blockHash: blockHashOf(sel.code),
    blockOffset: sel.startLine + 1, // 1-based line of the block's FIRST CODE line
    blockLines: sel.code.split('\n').length,
    targetFn: target ? target.name : null,
    selfRecursive,
    codec: suggestCodec(sel.code, nodes, target ? target.name : null),
    regionTable,
    watch,
  };
}

/** Read every guide; return the manifest plus everything that must fail loudly. */
export function buildManifest() {
  const guides = listProblemGuides();
  const blocks = [];
  const problems = [];
  const followUpSelections = [];
  const nullTargets = [];
  const byLevel = { 1: 0, 2: 0, 3: 0 };
  const byCodec = {};

  for (const file of guides) {
    const content = fs.readFileSync(path.join(ROOT_DIR, file), 'utf-8');
    const lines = content.split('\n');
    const sections = sectionsByLine(lines);
    const title = guideTitle(content);
    const selected = selectSolutionBlocks(content);

    if (selected.length !== 3) {
      problems.push({ path: file, detail: `expected 3 solution blocks, selected ${selected.length} (levels found: [${selected.map((b) => b.level).join(', ')}])` });
    }

    for (const sel of selected) {
      const entry = analyzeBlock(sel, levelProse(lines, sel.startLine), title);
      entry.path = file;
      blocks.push(entry);

      // E13/K4: a selected fence may never sit in a follow-up section (§5 onwards).
      const section = sections[sel.startLine - 1] || '';
      if (/^[5-9]\./.test(section)) followUpSelections.push(`${file} [L${sel.level}] inside "${section}" at line ${sel.startLine}`);
      if (entry.targetFn === null) nullTargets.push(`${file} [L${sel.level}] at line ${sel.startLine}`);

      byLevel[sel.level] = (byLevel[sel.level] || 0) + 1;
      byCodec[entry.codec] = (byCodec[entry.codec] || 0) + 1;
    }
  }

  return {
    manifest: {
      generator: GENERATOR,
      plan: 'DRY_RUN_ENGINE_PLAN_v5.md §7 row 7 (K4, K5, K7)',
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      generatedFrom: gitRev(),
      nodeVersion: process.versions.node,
      guides: guides.length,
      blockCount: blocks.length,
      byLevel: { 1: byLevel[1], 2: byLevel[2], 3: byLevel[3] },
      byCodec,
      blockHashNote: 'sha256: + hex sha256 of the utf-8 bytes of the K7-selected block source. Identity is never a line number (K5/U4).',
      blockOffsetNote: '1-based LINE of the block first code line. Render: guideLine = blockOffset + step.line.off. A regenerable hint, not identity.',
      regionNote: 'depth 0 = the target plus every function node lexically inside it; depth 1 = a same-block sibling, suppressed (E13).',
      selfRecursiveNote: 'true when the target, or any node in its region, calls itself — row 20 non-vacuity (U3/E10).',
      targetFnNull: nullTargets,
      problems,
      followUpSelections,
      blocks,
    },
    guides: guides.length,
    blocks,
    nullTargets,
    problems,
    followUpSelections,
  };
}

// ---------------------------------------------------------------------------
// Verification: re-reads every guide from disk, re-selects with row 0's predicate,
// re-hashes, and compares against the manifest as it sits on disk.
/** Which fields of a fresh entry differ from the one on disk — E19 names the drift. */
function driftedFields(fresh, onDisk) {
  const keys = [...new Set([...Object.keys(fresh), ...Object.keys(onDisk)])].sort();
  return keys.filter((k) => stringify(fresh[k]) !== stringify(onDisk[k]));
}

function verify() {
  const fresh = buildManifest().manifest;
  const failures = [];
  const check = (label, pass, detail = '') => {
    if (!pass) failures.push(label);
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  };

  if (!fs.existsSync(OUTPUT_PATH)) {
    console.error(`FAIL  build/blocks.json is missing — run \`node ${GENERATOR}\` first.`);
    return 1;
  }
  const onDisk = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf-8'));

  check('guides === 150', fresh.guides === 150, `measured ${fresh.guides}`);
  check('blocks === 450', fresh.blockCount === 450, `measured ${fresh.blockCount}`);
  check('every guide selects exactly 3 solution blocks', fresh.problems.length === 0, fresh.problems.map((p) => `${p.path}: ${p.detail}`).join(' | ') || 'no guide deviated');
  check('per level 150 / 150 / 150', fresh.byLevel[1] === 150 && fresh.byLevel[2] === 150 && fresh.byLevel[3] === 150, `measured ${fresh.byLevel[1]} / ${fresh.byLevel[2]} / ${fresh.byLevel[3]}`);
  check('0 blocks selected from a follow-up section (§5-§9)', fresh.followUpSelections.length === 0, `${fresh.followUpSelections.length} of ${fresh.blockCount} — ${fresh.followUpSelections.join(' | ') || 'every selection sits in §2/§3/§4'}`);
  check('manifest on disk has the same block count', onDisk.blockCount === fresh.blockCount, `disk ${onDisk.blockCount} vs re-derived ${fresh.blockCount}`);

  // The proof: source on disk -> K7 predicate -> sha256 -> manifest on disk. Compared with
  // row 6's canonical serializer, so key order cannot fake a mismatch.
  const diskByKey = new Map((onDisk.blocks || []).map((b) => [`${b.path}#${b.level}`, b]));
  let matched = 0;
  const mismatches = [];
  for (const entry of fresh.blocks) {
    const key = `${entry.path}#${entry.level}`;
    const found = diskByKey.get(key);
    if (!found) mismatches.push(`${key} — MISSING from the manifest on disk`);
    else if (stringify(found) === stringify(entry)) matched += 1;
    else mismatches.push(`${key} — stale fields: ${driftedFields(entry, found).join(', ') || '(key order only)'}`);
  }
  check('every entry re-derives from the guide source (blockHash, blockOffset, region, watch)',
    matched === fresh.blockCount && mismatches.length === 0, `${matched}/${fresh.blockCount} identical`);
  check('no entry on disk that the guides do not produce', diskByKey.size === matched, `${diskByKey.size} on disk, ${matched} re-derived`);

  if (mismatches.length) {
    console.log('\nstale entries — the manifest does not match the guides; regenerate it:');
    for (const m of mismatches.slice(0, 20)) console.log(`  ${m}`);
  }
  if (fresh.targetFnNull.length) {
    console.log(`\nWARN  targetFn could not be derived for ${fresh.targetFnNull.length} block(s):`);
    for (const t of fresh.targetFnNull) console.log(`  ${t}`);
  }

  console.log(`\nverify: ${matched}/${fresh.blockCount} hashes re-derived from source · ${fresh.followUpSelections.length} follow-up fences selected · ${failures.length} failure(s)`);
  return failures.length === 0 ? 0 : 1;
}

function main(argv) {
  if (argv.includes('--verify')) process.exit(verify());

  const { manifest, guides, problems, followUpSelections, nullTargets } = buildManifest();
  if (problems.length || followUpSelections.length) {
    console.error('BLOCK SELECTION IS WRONG — refusing to write a manifest.');
    for (const p of problems) console.error(`  ${p.path}: ${p.detail}`);
    for (const f of followUpSelections) console.error(`  follow-up fence selected: ${f}`);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  const text = `${stringify(manifest)}\n`;
  fs.writeFileSync(OUTPUT_PATH, text, 'utf-8');

  console.log(`GEN BLOCKS — ${GENERATOR} — node ${process.versions.node} · git ${manifest.generatedFrom || 'unavailable'}`);
  console.log(`guides: ${guides}`);
  console.log(`blocks: ${manifest.blockCount} (level 1: ${manifest.byLevel[1]} · level 2: ${manifest.byLevel[2]} · level 3: ${manifest.byLevel[3]})`);
  console.log(`codecs: ${Object.entries(manifest.byCodec).sort().map(([k, v]) => `${k} ${v}`).join('  ')}`);
  console.log(`self-recursive targets: ${manifest.blocks.filter((b) => b.selfRecursive).length}`);
  console.log(`targetFn null: ${nullTargets.length}${nullTargets.length ? ` — ${nullTargets.join(', ')}` : ''}`);
  console.log(`follow-up fences selected: ${followUpSelections.length} (must be 0)`);
  console.log(`wrote ${path.relative(ROOT_DIR, OUTPUT_PATH)} — ${(Buffer.byteLength(text) / 1024).toFixed(0)} KB (${(Buffer.byteLength(text) / 1048576).toFixed(2)} MB)`);
}

if (process.argv[1] === __filename) {
  main(process.argv.slice(2));
}

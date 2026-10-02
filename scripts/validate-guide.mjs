import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const REQUIRED_SECTIONS = [
  '# ',
  '## 1. Problem Overview & Edge Case Matrix',
  '## 2. Level 1: Brute Force Approach',
  '## 3. Level 2: Optimized Approach',
  '## 4. Level 3: Most Optimal / Canonical Approach',
  '## 5. JavaScript-Specific Gotchas & V8 Optimizations',
  '## 6. Real-World MAANG Interview Follow-Ups & Extensions'
];

// K7 (plan v5 §3): a "solution block" is the FIRST ```javascript fence inside each
// `## N. Level 1/2/3: ...` heading — selected by section, never by position. Those 450
// blocks (150 × 3) are exactly what the trace instrumenter loads, so they are what
// must stay synchronous. Positional selection is what let the "807 fences vs 450
// blocks" ambiguity stand, and it would also sweep in the follow-up sections, which
// legitimately use async/generator examples (measured today: 149 hits across 72 guides).
// scripts/gen-blocks.mjs (row 7) must copy this predicate textually — one definition.

const LEVEL_HEADING_RE = /^##\s+\d+\.\s+Level\s+([123])\b/;
const SG_RULES = path.join(ROOT_DIR, '.ast-grep', 'rules', 'solution-block-sync.yml');

/**
 * First ```javascript fence of each Level 1/2/3 section, in document order.
 * @returns {{level: number, code: string, line: number}[]} `line` is the fence's 0-based index
 */
export function extractSolutionBlocks(content) {
  const lines = content.split('\n');
  const blocks = [];
  let level = null;
  let fence = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s/.test(line)) {
      const heading = LEVEL_HEADING_RE.exec(line);
      level = heading ? Number(heading[1]) : null;
    }
    if (!fence) {
      if (line.startsWith('```')) fence = { lang: line.slice(3).trim(), start: i, lines: [] };
      continue;
    }
    if (line.startsWith('```')) {
      if (fence.lang === 'javascript' && level !== null && !blocks.some((b) => b.level === level)) {
        blocks.push({ level, code: fence.lines.join('\n'), line: fence.start });
      }
      fence = null;
    } else {
      fence.lines.push(line);
    }
  }
  return blocks;
}

let sgUsable;
function scanIsRunnable() {
  if (sgUsable === undefined) {
    // No default fallback (plan G1): if the scanner cannot run the guide is NOT clean,
    // because a silently skipped sync scan is a vacuous pass.
    sgUsable = false;
    try {
      execFileSync('sg', ['--version'], { stdio: 'ignore' });
      sgUsable = fs.existsSync(SG_RULES);
    } catch { /* sg not on PATH */ }
  }
  return sgUsable;
}

function scanUnavailableError() {
  return `SOLUTION_SCAN_UNAVAILABLE: ast-grep (\`sg\`) or ${path.relative(ROOT_DIR, SG_RULES)} is missing, so the synchronous-solution scan (plan K7) cannot run — refusing to report a clean guide on a skipped scan. Fix: npm i -g @ast-grep/cli`;
}

/**
 * One `sg scan` per guide: the blocks are concatenated so every hit's line maps back to
 * the block that owns it. `sg` exits 1 when it finds diagnostics — that is a result, not
 * a crash, so stderr is dropped and only stdout is parsed.
 * `block.line` is the 0-based index of the fence, so the block's first *code* line is
 * `block.line + 2` (1-based).
 * ponytail: the scan reads the 450 fenced JS solution blocks and nothing else — markdown
 * prose, other-language fences and follow-up snippets are out of scope by design. Raise
 * this ceiling when gen-blocks.mjs loads a second region, or when the trace envelope
 * learns to tolerate async/generator code.
 */
function scanForbiddenConstructs(blocks) {
  const origins = [];
  let source = '';
  let srcLine = 0;
  for (const block of blocks) {
    origins.push({ level: block.level, guideLine: block.line + 2, srcLine });
    source += block.code + '\n';
    // The appended '\n' terminates the block's last line, so the next block starts
    // exactly `len` lines later — not len + 1.
    srcLine += block.code.split('\n').length;
  }

  const tmp = path.join(os.tmpdir(), `sg-solution-${process.pid}.js`);
  fs.writeFileSync(tmp, source, 'utf-8');
  let stdout = '';
  try {
    stdout = execFileSync('sg', ['scan', '--rule', SG_RULES, '--json=stream', tmp], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (err) {
    stdout = err.stdout || '';
  } finally {
    fs.rmSync(tmp, { force: true });
  }

  return stdout
    .split('\n')
    .filter((l) => l.trim().startsWith('{'))
    .map((l) => JSON.parse(l))
    .map((hit) => {
      const origin = origins.filter((o) => o.srcLine <= hit.range.start.line).pop() || origins[0];
      return {
        ruleId: hit.ruleId,
        level: origin.level,
        line: origin.guideLine + (hit.range.start.line - origin.srcLine),
        text: hit.text.split('\n')[0].trim()
      };
    });
}

/**
 * Validates a single markdown problem guide
 */
export function validateProblemGuide(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const errors = [];
  const warnings = [];

  // 1. Check for balanced code fences (avoid truncations)
  const backtickTriples = (content.match(/```/g) || []).length;
  if (backtickTriples % 2 !== 0) {
    errors.push(`Unbalanced code fences detected (total triple backticks: ${backtickTriples}). File might be truncated!`);
  }

  // 2. Check for all required H2 sections
  for (const section of REQUIRED_SECTIONS) {
    if (!content.includes(section)) {
      errors.push(`Missing mandatory section: "${section}"`);
    }
  }

  // 3. Verify the three Level 1/2/3 solution blocks exist *inside their own sections*.
  // Stricter than a positional fence count: three ```javascript fences with none of them
  // under the Level 3 heading is not a three-solution guide.
  const solutionBlocks = extractSolutionBlocks(content);
  for (const level of [1, 2, 3]) {
    if (!solutionBlocks.some((b) => b.level === level)) {
      // REQUIRED_SECTIONS[0] is the title sentinel, so the Level N heading sits at index N + 1.
      errors.push(`MISSING_SOLUTION_BLOCK: no \`\`\`javascript fence inside "${REQUIRED_SECTIONS[level + 1]}" — plan K7 selects solution blocks by section, not by position.`);
    }
  }

  // 4. Reject async/generator/dynamic code inside a solution block (plan K7, E16/E17).
  // The instrumenter traces synchronous execution; an await inside a solution region
  // yields an empty or truncated trace that passes CI vacuously.
  if (!scanIsRunnable()) {
    errors.push(scanUnavailableError());
  } else {
    for (const hit of scanForbiddenConstructs(solutionBlocks)) {
      if (hit.ruleId === 'solution-block-must-parse') {
        errors.push(`SOLUTION_BLOCK_UNPARSABLE [solution-block-must-parse]: the Level ${hit.level} solution block at line ${hit.line} is not parseable JavaScript (\`${hit.text}\`), so the sync scan cannot vouch for it — plan K7.`);
      } else {
        errors.push(`SOLUTION_BLOCK_FORBIDDEN [${hit.ruleId}]: the Level ${hit.level} solution block at line ${hit.line} contains \`${hit.text}\` — solution blocks must stay synchronous and free of dynamic code (plan K7, E16/E17).`);
      }
    }
  }

  // 5. Check for Mermaid or ASCII diagram presence
  const hasMermaid = content.includes('```mermaid');
  if (!hasMermaid) {
    warnings.push('No Mermaid flowchart detected. Ensure visual diagrams are included.');
  }

  // 6. Check for Step-by-Step Dry Run table presence
  const dryRunMatches = content.match(/### Step-by-Step Dry Run/g) || [];
  if (dryRunMatches.length < 3) {
    warnings.push(`Expected 3 dry-run trace tables, found: ${dryRunMatches.length}`);
  }

  // 7. Check for Follow-Up presence
  const followUpCount = (content.match(/### Follow-Up \d+:/g) || []).length;
  if (followUpCount < 2) {
    warnings.push(`Expected at least 2 in-depth follow-ups, found: ${followUpCount}`);
  }

  return {
    file: path.relative(ROOT_DIR, filePath),
    isValid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Scan all markdown files in the repository
 */
export function runFullValidation() {
  console.log('🔍 Starting Anti-Truncation & Completeness Verification...\n');
  const allFiles = [];

  // Fail the whole run once, loudly, rather than stamping 150 identical errors per guide.
  if (!scanIsRunnable()) {
    console.error(`❌ [FAIL] ${scanUnavailableError()}\n`);
    process.exit(1);
  }

  // Study-guide pages (Modern Skills / Fresher / Mid-level roadmaps) follow their own
  // ELI15 + Top-50 template, not the LeetCode problem template — skip them here.
  // NOTE: only the three roadmap landing pages are skipped by name; any future
  // problem-track index.md stays covered by validation.
  // 'scratch' holds agent working notes, and loose root-level .md files are project
  // docs (README/PLAN, already name-skipped) or agent reports — never curriculum.
  // 'test-results' and 'playwright-report' are generated by the E2E run; Playwright
  // writes error-context.md pages into them that are not guides.
  const SKIP_DIRS = new Set(['00-foundations', '24-maang-guides', 'modern-engineer-skills', 'fresher-roadmap', 'mid-level-roadmap', 'scratch', 'test-results', 'playwright-report']);
  const SKIP_FILES = new Set(['_TEMPLATE-subpage.md', '00-INDEX.md']);
  const SKIP_INDEX_PARENTS = new Set(['modern-engineer-skills', 'fresher-roadmap', 'mid-level-roadmap']);

  function scan(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'scripts' || SKIP_DIRS.has(entry.name) || SKIP_FILES.has(entry.name)) continue;
      if (entry.name === 'index.md' && SKIP_INDEX_PARENTS.has(path.basename(dir))) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(fullPath);
      } else if (entry.name.endsWith('.md') && dir !== ROOT_DIR && !entry.name.includes('PLAN') && !entry.name.includes('README')) {
        allFiles.push(fullPath);
      }
    }
  }

  scan(ROOT_DIR);

  let totalErrors = 0;
  let totalWarnings = 0;

  for (const file of allFiles) {
    const res = validateProblemGuide(file);
    if (!res.isValid) {
      console.error(`❌ [FAIL] ${res.file}`);
      res.errors.forEach(e => console.error(`   - Error: ${e}`));
      totalErrors += res.errors.length;
    } else {
      console.log(`✅ [PASS] ${res.file}`);
    }
    if (res.warnings.length > 0) {
      res.warnings.forEach(w => console.warn(`   ⚠️  Warning: ${w}`));
      totalWarnings += res.warnings.length;
    }
  }

  console.log(`\n========================================`);
  console.log(`Scanned: ${allFiles.length} problem files`);
  console.log(`Errors: ${totalErrors} | Warnings: ${totalWarnings}`);
  console.log(`========================================\n`);

  if (totalErrors > 0) {
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runFullValidation();
}

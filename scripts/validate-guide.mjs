import fs from 'fs';
import path from 'path';
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

  // 3. Verify JavaScript code blocks
  const jsBlocks = content.match(/```javascript([\s\S]*?)```/g) || [];
  if (jsBlocks.length < 3) {
    errors.push(`Expected at least 3 JavaScript solution blocks (Brute Force, Optimized, Most Optimal), found: ${jsBlocks.length}`);
  }

  // 4. Check for Mermaid or ASCII diagram presence
  const hasMermaid = content.includes('```mermaid');
  if (!hasMermaid) {
    warnings.push('No Mermaid flowchart detected. Ensure visual diagrams are included.');
  }

  // 5. Check for Step-by-Step Dry Run table presence
  const dryRunMatches = content.match(/### Step-by-Step Dry Run/g) || [];
  if (dryRunMatches.length < 3) {
    warnings.push(`Expected 3 dry-run trace tables, found: ${dryRunMatches.length}`);
  }

  // 6. Check for Follow-Up presence
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

  function scan(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'scripts' || entry.name === '00-foundations') continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(fullPath);
      } else if (entry.name.endsWith('.md') && !entry.name.includes('PLAN') && !entry.name.includes('README')) {
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

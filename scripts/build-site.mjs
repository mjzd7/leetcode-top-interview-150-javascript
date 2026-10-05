import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { splitSections } from '../api/_lib/chat-tokens.mjs';
import { publishDocTraces } from './gen-doc-traces.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(ROOT_DIR, 'docs');

if (!fs.existsSync(DOCS_DIR)) {
  fs.mkdirSync(DOCS_DIR, { recursive: true });
}

console.log('🏗️  Building Static Web Portal for GitHub Pages...');

// Collect all foundations and problem markdown files
const curriculum = [];

// Study-roadmap guides live under docs/ (not root NN-* dirs) and follow their own
// ELI15 + Top-50 template. They render in the portal with Guide badges.
const GUIDE_DIRS = [
  { dir: 'docs/modern-engineer-skills', category: 'MODERN ENGINEER SKILLS', pattern: 'Modern Engineer Skills' },
  { dir: 'docs/fresher-roadmap', category: 'FRESHER ROADMAP', pattern: 'Fresher Roadmap' },
  { dir: 'docs/mid-level-roadmap', category: 'MID-LEVEL ROADMAP', pattern: 'Mid-level Roadmap' },
];
// Portal-internal files inside the guide dirs (never curriculum items).
const GUIDE_SKIP_FILES = new Set(['_TEMPLATE-subpage.md', '00-INDEX.md', '00-IA-PLAN.md']);

function stripFrontmatter(rawContent) {
  return rawContent.replace(/^---\n[\s\S]*?\n---\n/, '');
}

function scanDirectory(dir, categoryName) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const items = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'scripts' && entry.name !== 'docs') {
        const subCatName = entry.name.replace(/^\d+-/, '').replace(/-/g, ' ').toUpperCase();
        scanDirectory(path.join(dir, entry.name), subCatName);
      }
    } else if (entry.name.endsWith('.md') && !entry.name.includes('PLAN') && !entry.name.includes('README') && !GUIDE_SKIP_FILES.has(entry.name)) {
      const filePath = path.join(dir, entry.name);
      const rawContent = stripFrontmatter(fs.readFileSync(filePath, 'utf-8'));
      const titleMatch = rawContent.match(/^#\s+(.+)$/m);
      const title = titleMatch ? titleMatch[1].trim() : entry.name.replace('.md', '');
      
      const difficultyMatch = rawContent.match(/- \*\*Difficulty\*\*:\s*(\w+)/i);
      const isInterviewGuide = dir.includes('24-maang-guides');
      const guideDir = GUIDE_DIRS.find(g => dir.includes(g.dir));
      const difficulty = (isInterviewGuide || guideDir) ? 'Guide' : (difficultyMatch ? difficultyMatch[1] : 'Primer');

      const leetcodeLinkMatch = rawContent.match(/- \*\*LeetCode Link\*\*:\s*`([^`]+)`/i) || rawContent.match(/- \*\*LeetCode Link\*\*:\s*(https?:\/\/[^\s\)]+)/i);
      const leetcodeLink = leetcodeLinkMatch ? leetcodeLinkMatch[1].trim() : null;

      const patternMatch = rawContent.match(/- \*\*Pattern Category\*\*:\s*([^\n]+)/i);
      const pattern = isInterviewGuide ? 'MAANG Guides' : (guideDir ? guideDir.pattern : (patternMatch ? patternMatch[1].trim() : null));

      const relPath = path.relative(ROOT_DIR, filePath);
      items.push({
        id: relPath.replace(/\.md$/, '').replace(/\//g, '_'),
        filename: entry.name,
        relPath,
        title,
        difficulty,
        leetcodeLink,
        pattern,
        content: rawContent
      });
    }
  }

  if (items.length > 0) {
    items.sort((a, b) => a.filename.localeCompare(b.filename));
    curriculum.push({
      category: categoryName,
      items
    });
  }
}

// Auto-discover all category directories
const categoryDirs = fs.readdirSync(ROOT_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory() && /^\d\d-/.test(d.name))
  .sort((a, b) => a.name.localeCompare(b.name));

for (const catDir of categoryDirs) {
  const prettyName = catDir.name.replace(/^\d+-/, '').replace(/-/g, ' ').toUpperCase();
  scanDirectory(path.join(ROOT_DIR, catDir.name), prettyName);
}

// Study-roadmap guides (docs/ parents) join the bundle after the root tracks.
for (const g of GUIDE_DIRS) {
  const full = path.join(ROOT_DIR, g.dir);
  if (fs.existsSync(full)) scanDirectory(full, g.category);
}

// Structured sidebar order: primers first, then MAANG interview guides,
// then study roadmaps, then problem tracks.
const orderKey = (name) => name === 'FOUNDATIONS' ? 0 : name === 'MAANG GUIDES' ? 1 : (name === 'MODERN ENGINEER SKILLS' || name === 'FRESHER ROADMAP' || name === 'MID-LEVEL ROADMAP' ? 2 : 3);
curriculum.sort((a, b) => orderKey(a.category) - orderKey(b.category));

// Write data bundle
const bundleContent = `window.CURRICULUM_DATA = ${JSON.stringify(curriculum, null, 2)};`;
fs.writeFileSync(path.join(DOCS_DIR, 'curriculum-data.js'), bundleContent, 'utf-8');

console.log(`✅ Bundled ${curriculum.reduce((acc, c) => acc + c.items.length, 0)} modules into docs/curriculum-data.js`);

/* ------------------------------------------------------------------ *
 * Guide index — the search_guides() retrieval corpus
 *
 * A separate, compact artifact from curriculum-data.js. That bundle is a 2.9 MB
 * pretty-printed file whose job is to ship every guide to the browser; the chat
 * route needs the same text but only to grep it server-side, and it must not pay
 * to parse pretty-printed JSON on every cold start.
 *
 * Sections are split here with the SAME splitSections() the runtime scores with
 * (imported from api/_lib/chat-tokens.mjs). A second implementation would drift,
 * and retrieval would quietly stop matching the sections it was indexed on.
 * ------------------------------------------------------------------ */

const guideIndex = {
  generated: new Date().toISOString().slice(0, 10),
  guides: [],
};

for (const cat of curriculum) {
  for (const item of cat.items) {
    const sections = splitSections(item.content);
    guideIndex.guides.push({
      id: item.id,
      title: item.title,
      category: cat.category,
      difficulty: item.difficulty,
      leetcodeLink: item.leetcodeLink,
      pattern: item.pattern,
      // Headings are stored separately AND inside each section: scoring reads
      // them, and the heading ships in the retrieved excerpt so the model can
      // cite "Level 3: Canonical" without a second lookup.
      headings: sections ? sections.map((s) => s.text.split('\n', 1)[0].trim()) : [],
      sections: sections
        ? sections.map((s) => s.text.trim())
        : [item.content.trim()],
    });
  }
}

const INDEX_DIR = path.join(ROOT_DIR, 'api', '_lib');
fs.mkdirSync(INDEX_DIR, { recursive: true });
const indexPath = path.join(INDEX_DIR, 'guide-index.json');
// Compact on purpose: this is read at runtime, not read by humans.
fs.writeFileSync(indexPath, JSON.stringify(guideIndex), 'utf-8');

const sectionCount = guideIndex.guides.reduce((acc, g) => acc + g.sections.length, 0);
const indexBytes = fs.statSync(indexPath).size;
console.log(
  `✅ Indexed ${guideIndex.guides.length} guides / ${sectionCount} sections ` +
  `into api/_lib/guide-index.json (${(indexBytes / 1024 / 1024).toFixed(2)} MB)`,
);
if (guideIndex.guides.some((g) => g.sections.length === 0)) {
  console.warn('⚠️  At least one guide produced zero sections — retrieval cannot score it.');
}

/* ------------------------------------------------------------------ *
 * Static traces — the third artefact, and the one that needs no server
 * ------------------------------------------------------------------ */

await publishDocTraces();
console.log(
  '✅ Published docs/traces/ — the portal reads a trace over plain HTTP, so W1 needs no '
  + 'server, no auth and no rate limit (plan §7 row 16, §9 decisions 3 and 4). '
  + 'The full goldens stay a CI artifact: see docs/traces/index.json `decision`.',
);

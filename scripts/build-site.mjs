import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

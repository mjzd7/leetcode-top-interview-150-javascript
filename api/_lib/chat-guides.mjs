/**
 * search_guides() — retrieval over this repo's own corpus of guides.
 *
 * This is what makes the assistant able to discuss a problem the reader is not
 * currently looking at, and to cross-reference two guides from different
 * tracks. It is deliberately the cheapest tool in the box: it touches no network
 * and no third-party quota, so it is always available no matter how the web
 * tools are configured.
 *
 * The corpus is a BUILD artifact (api/_lib/guide-index.json, written by
 * scripts/build-site.mjs) rather than a runtime directory walk. Walking 159
 * markdown files per cold start is slow, and a runtime read also depends on the
 * deploy shipping the markdown, which is a file-tracing assumption. A generated
 * JSON file is one read, and `includeFiles` in vercel.json makes its presence
 * explicit instead of incidental.
 *
 * Ranking weights are tuned for THIS corpus: every guide is titled
 * "NN. Some Problem Name", so a title hit is the strongest possible signal, and
 * a section heading ("Level 3: Canonical", "V8 Gotchas") is a strong second.
 */

import fs from 'node:fs';
import { countTokens, queryTerms, truncateRelevant, MAX_TOOL_RESULT_TOKENS } from './chat-tokens.mjs';

/** Generated at build time; resolved relative to this module so it ships with it. */
const INDEX_URL = new URL('./guide-index.json', import.meta.url);

/** How many guides a single search may return. */
const MAX_GUIDES = 3;

let indexPromise;
let preparedPromise;

/** Test seam: drop the memoised index so a suite can re-read it from disk. */
export function resetGuideIndexCache() {
  indexPromise = undefined;
  preparedPromise = undefined;
}

/**
 * Load the guide index, once per warm instance.
 *
 * A missing or corrupt index degrades to an empty corpus rather than throwing:
 * search_guides then reports "index unavailable", the model loses one tool, and
 * the page-scoped chat it already had keeps working. Failing the whole request
 * because a build artifact is absent would be a much worse trade.
 */
export async function loadGuideIndex() {
  if (indexPromise === undefined) {
    indexPromise = (async () => {
      try {
        const raw = fs.readFileSync(INDEX_URL, 'utf-8');
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.guides)) return { generated: null, guides: [] };
        return parsed;
      } catch {
        return { generated: null, guides: [] };
      }
    })();
  }
  return indexPromise;
}

function countHits(set, terms) {
  let n = 0;
  for (const t of terms) if (set.has(t)) n++;
  return n;
}

/** Precompute per-guide lowercase term sets once, memoised alongside the index. */
function prepare(guide) {
  return {
    ...guide,
    _title: new Set(queryTerms(guide.title)),
    _category: new Set(queryTerms(guide.category)),
    _headings: new Set(queryTerms((guide.headings || []).join(' '))),
  };
}

/** Every guide, with its scoring sets built once per warm instance. */
async function preparedGuides() {
  if (preparedPromise === undefined) {
    preparedPromise = loadGuideIndex().then((ix) => ix.guides.map(prepare));
  }
  return preparedPromise;
}

/**
 * Retrieve the sections of the best-matching guides.
 *
 * Returns { ok, text, hits, tokens, reason }. `ok: false` is a normal outcome
 * ("no guide covers this"), not an error — the caller turns it into a sentence
 * the model can read, so the assistant can say "that isn't in the manual" and
 * fall back to web_search instead of inventing a citation.
 */
export async function searchGuides(query, { maxTokens = MAX_TOOL_RESULT_TOKENS, maxGuides = MAX_GUIDES } = {}) {
  const terms = queryTerms(query);
  if (terms.size === 0) {
    return {
      ok: false, text: '', hits: [], tokens: 0,
      reason: 'query contained no searchable terms — ask a more specific question',
    };
  }

  const guides = await preparedGuides();
  if (guides.length === 0) {
    return {
      ok: false, text: '', hits: [], tokens: 0,
      reason: 'the guide index is unavailable on this deployment (run `npm run build`)',
    };
  }

  // Title weighted highest (a guide is named after its problem), then section
  // headings, then the category. A raw hit count alone would let a long guide
  // with a generic category outrank an exact title match.
  const scored = [];
  for (const g of guides) {
    const titleHits = countHits(g._title, terms);
    const headingHits = countHits(g._headings, terms);
    const categoryHits = countHits(g._category, terms);
    if (titleHits === 0 && headingHits === 0 && categoryHits === 0) continue;
    scored.push({ g, score: titleHits * 4 + headingHits * 2 + categoryHits });
  }

  if (scored.length === 0) {
    return {
      ok: false, text: '', hits: [], tokens: 0,
      reason: `no matching guides for "${String(query).slice(0, 120)}" — answer from web_search or your own knowledge instead`,
    };
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.max(1, maxGuides));

  // Each cited guide gets a guaranteed SHARE of the budget, so a long first hit
  // cannot starve the other two. Relevance trimming then decides which sections
  // of each guide survive — the same Level-3-preserving behaviour the page
  // context already relies on.
  const share = Math.max(120, Math.floor(maxTokens / top.length));
  const blocks = [];
  const hits = [];

  for (const { g } of top) {
    const body = g.sections.join('\n\n');
    const excerpt = await truncateRelevant(body, share, query);
    if (!excerpt) continue;
    const meta = [
      `GUIDE: ${g.title}`,
      `CATEGORY: ${g.category}`,
      g.difficulty ? `DIFFICULTY: ${g.difficulty}` : '',
      g.leetcodeLink ? `LEETCODE: ${g.leetcodeLink}` : '',
    ].filter(Boolean).join(' · ');
    blocks.push(`${meta}\n\n${excerpt}`);
    hits.push({
      id: g.id,
      title: g.title,
      category: g.category,
      difficulty: g.difficulty,
      leetcodeLink: g.leetcodeLink,
    });
  }

  if (blocks.length === 0) {
    return { ok: false, text: '', hits: [], tokens: 0, reason: 'matched guides had no usable text' };
  }

  const text = blocks.join('\n\n---\n\n');
  // Hard final trim. The per-guide shares are a budget *plan*; heading
  // reassembly and marker insertion can both overshoot it slightly.
  const trimmed = (await countTokens(text)) <= maxTokens ? text : await truncateRelevant(text, maxTokens, query);

  return { ok: true, text: trimmed, hits, tokens: await countTokens(trimmed), reason: '' };
}

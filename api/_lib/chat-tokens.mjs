/**
 * Token accounting for /api/chat.
 *
 * Everything here is measured in TOKENS, never characters (characters != tokens;
 * a 10k-char pageContext is ~2.5k tokens but a code-heavy guide can be 4x worse).
 *
 * The tiktoken encoder is WASM and is loaded lazily, exactly once per warm
 * instance. If it ever fails to load (cold-start WASM hiccup, bundle drift,
 * a future runtime that can't do WASM) we fall back to a character heuristic
 * so the budget is still *enforced* — only its precision degrades. A degraded
 * estimate is always safer than an unenforced budget.
 *
 * No OpenAI/network calls happen in this module, so it is directly unit-testable.
 */

/**
 * Total prompt budget (system + context + history).
 *
 * Was 4000, which was sized for "one page of guide text + a short chat". With
 * tool-calling the prompt now also carries retrieved guide sections and fetched
 * web text, so a 4000 ceiling silently squeezed the tool results down to
 * nothing. 12000 is still ~10% of gpt-4o-mini's context window, so this remains
 * a cost ceiling rather than a technical limit.
 */
export const MAX_TOTAL_TOKENS = 12_000;
/** Ceiling for the pageContext slice, so context can't starve the conversation. */
export const MAX_CONTEXT_TOKENS = 2000;
/**
 * Hard cap on completion length — cost control (improvements-doc §6.3).
 *
 * Was 1000 (~750 words), which truncated mid-explanation on exactly the
 * cross-question and follow-up discussion this feature exists to enable.
 */
export const MAX_COMPLETION_TOKENS = 2000;
/** Sliding window: how many conversational turns to retain. */
export const MAX_HISTORY_MESSAGES = 10;

/**
 * Per-result ceiling for ONE tool call. Every tool result is trimmed to this
 * before it re-enters the conversation, so one fat scraped page cannot evict the
 * history or the system prompt.
 */
export const MAX_TOOL_RESULT_TOKENS = 1500;
/** How many tool calls a single user turn may make, in total. */
export const MAX_TOOL_CALLS = 4;
/** How many model<->tool round trips one user turn may take. */
export const MAX_TOOL_ROUNDS = 3;

/** Marker shown to the model where middle content was elided. */
export const ELISION_MARKER = '\n\n[... guide content elided to fit the context budget ...]\n\n';

const VALID_ROLES = new Set(['user', 'assistant']);

let encoderPromise;

/**
 * Resolve the tiktoken encoder for `model`, or null if unavailable.
 * Memoised across calls within an instance.
 */
async function resolveEncoder(model) {
  if (encoderPromise === undefined) {
    encoderPromise = (async () => {
      try {
        const tiktoken = await import('tiktoken');
        // encoding_for_model tracks per-model vocab (gpt-4o* is o200k_base,
        // gpt-3.5/gpt-4 are cl100k_base). Fall back to a known-good encoding
        // if the model string is unknown rather than throwing.
        try {
          return tiktoken.encoding_for_model(model);
        } catch {
          return tiktoken.get_encoding('cl100k_base');
        }
      } catch {
        return null; // encoder unavailable -> heuristic path
      }
    })();
  }
  return encoderPromise;
}

/** Test seam: drop the memoised encoder so a suite can re-resolve it. */
export function resetEncoderCache() {
  encoderPromise = undefined;
}

const utf8 = new TextDecoder('utf-8', { fatal: false });

/**
 * Coerce an encoder result to text.
 *
 * The tiktoken WASM build's `decode()` returns a Uint8Array (js-tiktoken returns
 * a string), so the shape is not guaranteed. Slicing tokens at an arbitrary
 * index can also split a multi-byte character, which decodes to U+FFFD; those
 * are stripped so we never hand the model invalid UTF-8.
 */
function toText(decoded) {
  const s = typeof decoded === 'string' ? decoded : utf8.decode(decoded);
  return s.replace(/�/g, '');
}

/**
 * Character-based fallback. Deliberately conservative (chars/4 undercounts real
 * code, so we round up); the goal is a plausible upper bound, not accuracy.
 */
export function estimateTokens(text) {
  if (typeof text !== 'string' || text.length === 0) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Token count for `text` under `model`. Uses tiktoken when it loads, else the
 * heuristic. Always returns a non-negative integer.
 */
export async function countTokens(text, model = 'gpt-4o-mini') {
  if (typeof text !== 'string' || text.length === 0) return 0;
  const encoder = await resolveEncoder(model);
  if (!encoder) return estimateTokens(text);
  try {
    return encoder.encode(text).length;
  } catch {
    return estimateTokens(text);
  }
}

/** Total token count of an OpenAI `messages` array (per-message framing included). */
export async function countMessagesTokens(messages, model = 'gpt-4o-mini') {
  if (!Array.isArray(messages) || messages.length === 0) return 0;
  // ~4 framing tokens per message for role + delimiters.
  return messages.length * 4 + (await countTokens(messages.map((m) => m.content || '').join('\n'), model));
}

/**
 * Real token cost of ELISION_MARKER, measured rather than guessed.
 *
 * This was a live off-by-N bug: the old code reserved `max(8, 6% of budget)`
 * while the marker actually costs 13 tokens, so a 100-token budget produced a
 * 105-token result. A budget that overshoots is not a budget.
 */
async function markerTokenCost(encoder) {
  if (!encoder) return Math.max(8, estimateTokens(ELISION_MARKER));
  try {
    return Math.max(8, encoder.encode(ELISION_MARKER).length);
  } catch {
    return Math.max(8, estimateTokens(ELISION_MARKER));
  }
}

/**
 * Trim `text` to at most `maxTokens`, keeping the head and the tail and marking
 * the elision explicitly.
 *
 * The marker matters — a silent concatenation would make the model believe the
 * two halves are adjacent. This is the *fallback* strategy: see
 * `truncateRelevant` below, which is what `buildChatRequest` actually uses,
 * because head+tail discards the Level 3 canonical section of every guide.
 */
export async function truncateToTokens(text, maxTokens, model = 'gpt-4o-mini') {
  if (typeof text !== 'string' || text.length === 0) return '';
  if (maxTokens <= 0) return '';
  const encoder = await resolveEncoder(model);
  if (!encoder) return truncateByChars(text, maxTokens);

  let tokens;
  try {
    tokens = encoder.encode(text);
  } catch {
    return truncateByChars(text, maxTokens);
  }
  if (tokens.length <= maxTokens) return text;

  const markerTokens = await markerTokenCost(encoder);
  const usable = Math.max(0, maxTokens - markerTokens);
  const headTokens = Math.ceil(usable * 0.7);
  const tailTokens = usable - headTokens;

  const head = toText(encoder.decode(tokens.slice(0, headTokens)));
  const tail = tailTokens > 0 ? toText(encoder.decode(tokens.slice(tokens.length - tailTokens))) : '';
  return head + ELISION_MARKER + tail;
}

function truncateByChars(text, maxTokens) {
  const maxChars = Math.max(0, maxTokens * 4);
  if (text.length <= maxChars) return text;
  const headChars = Math.ceil(maxChars * 0.7);
  const tailChars = maxChars - headChars;
  return text.slice(0, headChars) + ELISION_MARKER + (tailChars > 0 ? text.slice(text.length - tailChars) : '');
}

/**
 * Words that carry no retrieval signal. Kept short: over-filtering would strip
 * meaningful terms like "pass" or "map" out of a study question.
 */
const QUERY_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'what', 'which', 'how', 'does', 'are', 'was',
  'you', 'can', 'about', 'from', 'into', 'its', 'their', 'there', 'them', 'then', 'than',
  'when', 'where', 'why', 'who', 'would', 'could', 'should', 'have', 'has', 'had', 'been',
  'being', 'but', 'not', 'all', 'any', 'out', 'give', 'show', 'tell', 'explain', 'walk',
  'through', 'please', 'use', 'using', 'via', 'more', 'most', 'some', 'just', 'like', 'does',
]);

/**
 * Locate section headings in either of the two shapes this system actually sees.
 *
 * `## 4. Level 3: Canonical`      — raw markdown, when a caller passes the file.
 * `4. Level 3: Canonical`         — rendered plain text, which is what the
 *   browser sends: `extractPageContext()` takes textContent of the *rendered*
 *   article, so every heading arrives with its `##` already consumed and not one
 *   '#' survives in the payload.
 *
 * Missing the second shape disables relevance selection in production while every
 * markdown-shaped test still passes, so both are recognised here.
 *
 * A numbered heading is told apart from a numbered *list item* by its trailing
 * punctuation: "1. Outer loop picks an index." is prose, "1. Problem Overview" is
 * a title.
 */
export function findHeadings(text) {
  const marks = [];
  let m;
  const markdown = /^##[ \t]+.+$/gm;
  while ((m = markdown.exec(text)) !== null) marks.push(m.index);
  const rendered = /^[0-9]{1,2}\.[ \t]+\S[^\n]{0,90}$/gm;
  while ((m = rendered.exec(text)) !== null) {
    if (/[.,;:]$/.test(m[0])) continue;
    marks.push(m.index);
  }
  return [...new Set(marks)].sort((a, b) => a - b);
}

/**
 * Split on section headings, keeping each heading with its own body.
 *
 * Exported (with `findHeadings` and `words`) so the build-time guide index in
 * scripts/build-site.mjs splits guides with the *same* logic the runtime uses to
 * score them. Two implementations would drift, and retrieval would quietly stop
 * matching the sections it was indexed on.
 */
export function splitSections(text) {
  const marks = findHeadings(text);
  if (marks.length < 2) return null;
  const out = [];
  // Anything before the first heading (a title, usually) is its own chunk so it is
  // never silently dropped.
  if (marks[0] > 0) {
    out.push({ text: text.slice(0, marks[0]).trimEnd() + '\n\n' });
  }
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1] : text.length;
    out.push({ text: text.slice(marks[i], end) });
  }
  return out.length >= 2 ? out : null;
}

export function words(s) {
  return String(s).toLowerCase().match(/[a-z0-9]+/g) || [];
}

/**
 * Query terms worth scoring on: lowercased, stopword-free, length > 2.
 *
 * The same filter `truncateRelevant` applies, exported so guide retrieval ranks
 * guides by exactly the terms that section selection would later keep.
 */
export function queryTerms(query) {
  return new Set(words(query || '').filter((w) => w.length > 2 && !QUERY_STOPWORDS.has(w)));
}

/**
 * Truncate while keeping the sections most likely to answer the question.
 *
 * Head+tail trimming is the wrong shape for this corpus: every guide is
 * *Level 1 brute -> Level 2 optimized -> Level 3 canonical*, so the middle third
 * that head+tail discards is precisely the canonical answer to most questions.
 * This keeps the opening section for orientation, the closing section for
 * follow-ups, and as many query-relevant middle sections as the budget allows,
 * reassembled in document order with every gap marked.
 *
 * Falls back to plain head+tail when there is no query, no usable headings, or
 * when the section math still overruns.
 */
export async function truncateRelevant(text, maxTokens, query, model = 'gpt-4o-mini') {
  if (typeof text !== 'string' || text.length === 0) return '';
  if (maxTokens <= 0) return '';
  if ((await countTokens(text, model)) <= maxTokens) return text;

  const sections = splitSections(text);
  const terms = new Set(words(query || '').filter((w) => w.length > 2 && !QUERY_STOPWORDS.has(w)));
  if (!sections || terms.size === 0) return truncateToTokens(text, maxTokens, model);

  const encoder = await resolveEncoder(model);
  const sizeOf = (s) => {
    if (!encoder) return estimateTokens(s);
    try { return encoder.encode(s).length; } catch { return estimateTokens(s); }
  };

  const scored = sections.map((sec, i) => {
    const seen = new Set(words(sec.text));
    let hits = 0;
    for (const t of terms) if (seen.has(t)) hits++;
    return { i, tokens: sizeOf(sec.text), hits };
  });

  const markerTokens = await markerTokenCost(encoder);
  // Orientation (opening) and follow-ups (closing) are wanted, not required:
  // the answer outranks both when the budget is tight.
  const mandatory = new Set([0, scored.length - 1]);
  const byScore = scored
    .filter((s) => !mandatory.has(s.i))
    .sort((a, b) => b.hits - a.hits || a.i - b.i);

  const keep = new Set();
  let used = markerTokens;
  const fits = (n) => used + n + markerTokens <= maxTokens;

  const top = byScore.find((s) => s.hits > 0);
  if (top && fits(top.tokens)) {
    keep.add(top.i);
    used += top.tokens;
  }
  for (const i of mandatory) {
    if (keep.has(i) || !fits(scored[i].tokens)) continue;
    keep.add(i);
    used += scored[i].tokens;
  }
  for (const s of byScore) {
    if (s.hits === 0 || keep.has(s.i) || !fits(s.tokens)) continue;
    keep.add(s.i);
    used += s.tokens;
  }

  if (keep.size === 0) return truncateToTokens(text, maxTokens, model);
  if (keep.size === scored.length) return text;

  let out = '';
  let prev = -1;
  for (const i of [...keep].sort((a, b) => a - b)) {
    if (prev !== -1 && i !== prev + 1) out += ELISION_MARKER;
    out += sections[i].text.trimEnd() + '\n\n';
    prev = i;
  }
  out = out.trim();

  if ((await countTokens(out, model)) > maxTokens) {
    return truncateToTokens(out, maxTokens, model);
  }
  return out;
}

/**
 * Normalise a client-supplied history array. Unknown roles dropped, non-string
 * content coerced, oversize single messages left for the token budget to trim.
 */
export function normaliseHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter((m) => m && VALID_ROLES.has(m.role) && typeof m.content === 'string' && m.content.trim() !== '')
    .map((m) => ({ role: m.role, content: m.content }));
}

/**
 * Sliding window: keep the system prompt, drop the OLDEST turns, keep the most
 * recent. The final user turn is always retained — it is the actual question.
 *
 * Two invariants worth stating (execution plan Task 2.2 + improvements-doc §3.4):
 *  1. The system prompt (which carries the pageContext) is never windowed away.
 *  2. `pageContext` never enters `history` in the first place — that separation
 *     is enforced in chat-prompt.mjs, not here.
 *
 * Returns { messages, dropped } where `dropped` is a count for logging.
 */
export async function buildWindow(history, {
  model = 'gpt-4o-mini',
  maxHistoryMessages = MAX_HISTORY_MESSAGES,
  reservedTokens = 0,
  maxTotalTokens = MAX_TOTAL_TOKENS,
} = {}) {
  let msgs = normaliseHistory(history);

  // (a) Count-based trim: keep the newest turns until the budget is spent.
  const budget = Math.max(0, maxTotalTokens - reservedTokens);
  while (msgs.length > maxHistoryMessages) msgs = msgs.slice(msgs.length - maxHistoryMessages);
  while (msgs.length > 2 && (await countMessagesTokens(msgs, model)) > budget) {
    msgs = msgs.slice(1);
  }
  // A window that opens on an assistant turn reads as a hallucinated opener.
  while (msgs.length > 1 && msgs[0].role === 'assistant') msgs = msgs.slice(1);

  const dropped = normaliseHistory(history).length - msgs.length;
  return { messages: msgs, dropped: Math.max(0, dropped) };
}

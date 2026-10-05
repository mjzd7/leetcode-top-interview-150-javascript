/**
 * Tool definitions + dispatch for /api/chat.
 *
 * Three tools, in the order the model should prefer them:
 *
 *   search_guides  — this repo's own 175 guides. Free, instant, always available,
 *                    and the RIGHT answer for anything the manual covers.
 *   web_search     — the open internet, for anything it does not.
 *   fetch_page     — one specific URL in full, when a snippet is not enough.
 *
 * The ordering is a prompt instruction, not a code path, but it is the whole
 * cost story: a study question is answered from the corpus on the free tier, and
 * the 1,000/month web quota is spent only on questions the manual cannot answer.
 *
 * Everything a tool returns is UNTRUSTED. Even search_guides output is scrubbed
 * and fenced here, because the corpus is a build artifact over content that will
 * eventually include third-party quotes, and because a single choke point for
 * fencing is the only way to guarantee it is not forgotten when a tool is added.
 */

import { searchGuides } from './chat-guides.mjs';
import { tavilySearch, tavilyScrape, webConfigured } from './chat-web.mjs';
import { sanitizeContext, WEB_OPEN, WEB_CLOSE } from './chat-security.mjs';
import { countTokens, truncateRelevant, MAX_TOOL_RESULT_TOKENS, MAX_TOOL_CALLS } from './chat-tokens.mjs';

const str = (description) => ({ type: 'string', description });

/** OpenAI function-calling schemas. Descriptions are instructions to the model. */
export const TOOL_SCHEMAS = [
  {
    type: 'function',
    function: {
      name: 'search_guides',
      description:
        'Search this manual\'s own 175 study guides (the Top Interview 150 problem guides, the '
        + 'foundations primers, and the MAANG interview guides). Use this FIRST for anything about '
        + 'a LeetCode problem, algorithm, data structure, complexity, JS/V8 behaviour, or interview '
        + 'technique. Returns the matching guide sections verbatim, each labelled with its title and '
        + 'category. Free and instant. Call this instead of web_search whenever the question is '
        + 'about DSA or interviews.',
      parameters: {
        type: 'object',
        properties: {
          query: str('What to look for, in the reader\'s own words. e.g. "reverse a linked list", "L1 vs L3 for 3Sum", "V8 string gotchas".'),
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'Search the open internet. Use this ONLY when the question is outside the manual — current '
        + 'events, a library or framework version, a company\'s interview process, salary or market '
        + 'data, or anything you are genuinely unsure about. Prefer search_guides first; it is free '
        + 'and far more likely to be what the reader wanted. Returns short snippets plus their '
        + 'source URLs, which you MUST cite. Does not return full pages — call fetch_page if you '
        + 'need one specific page in full.',
      parameters: {
        type: 'object',
        properties: {
          query: str('The search query. Be specific; include version numbers, company names, or dates when they matter.'),
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'fetch_page',
      description:
        'Fetch one public web page and return it as markdown. Use after web_search when the '
        + 'snippets are not enough to answer accurately. Rejects private, loopback, and link-local '
        + 'addresses. Slow and metered — do not use it speculatively.',
      parameters: {
        type: 'object',
        properties: {
          url: str('The absolute http(s) URL to fetch, taken from a web_search result.'),
        },
        required: ['url'],
      },
    },
  },
];

/**
 * The tools this deployment can actually serve.
 *
 * search_guides is always offered: it is local, free, and the right answer for
 * most study questions. The web tools are offered ONLY when Tavily is
 * configured, so the model is never handed a tool whose every call is guaranteed
 * to come back "not configured" — which wastes a round trip and, worse, teaches
 * the model that tool results can be ignored.
 */
export function availableTools(env = process.env) {
  if (webConfigured(env)) return TOOL_SCHEMAS;
  return TOOL_SCHEMAS.filter((t) => t.function.name === 'search_guides');
}

/**
 * Per-request tool-call budget.
 *
 * A model that decides to loop must be stopped by something other than its own
 * judgement: one reader turn gets at most MAX_TOOL_CALLS tool calls, no matter
 * how many rounds the model asks for. `spend()` is called once per tool call and
 * returns false once the cap is hit, which the route turns into a final answer
 * with no further tools.
 */
export function createToolBudget({ maxCalls = MAX_TOOL_CALLS } = {}) {
  let calls = 0;
  return {
    spend() {
      if (calls >= maxCalls) return false;
      calls += 1;
      return true;
    },
    get calls() {
      return calls;
    },
    get remaining() {
      return Math.max(0, maxCalls - calls);
    },
  };
}

/** Wrap untrusted tool text so the model cannot mistake it for an instruction. */
function fence(text) {
  return `${WEB_OPEN}\n${text}\n${WEB_CLOSE}`;
}

/** Trim, scrub, then fence — in that order, and always all three. */
function finish(rawText, { maxTokens, model, query }) {
  const clean = sanitizeContext(String(rawText || ''), { maxChars: maxTokens * 8 });
  return fence(clean.text);
}

function failure(label, reason) {
  return {
    ok: false,
    label,
    content: `[${label} did not run] ${reason}. Say this plainly to the reader; do not pretend you looked it up.`,
  };
}

/**
 * Run one tool call.
 *
 * Returns { ok, label, content, sources }. Never throws: a tool that blows up
 * must not take the whole turn down, and the model needs *something* to read so
 * it can tell the reader what happened.
 */
export async function runTool(name, rawArgs, { env = process.env, model, maxTokens = MAX_TOOL_RESULT_TOKENS, query = '', fetchImpl } = {}) {
  const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};

  try {
    if (name === 'search_guides') {
      const q = typeof args.query === 'string' ? args.query.trim() : '';
      if (!q) return failure('search_guides', 'no query was given');
      const r = await searchGuides(q, { maxTokens });
      if (!r.ok) {
        return {
          ok: false,
          label: 'search_guides',
          content: `[search_guides found no match] ${r.reason}`,
          sources: [],
        };
      }
      return {
        ok: true,
        label: 'search_guides',
        content: finish(r.text, { maxTokens, model, query: q }),
        sources: r.hits,
      };
    }

    if (name === 'web_search') {
      const q = typeof args.query === 'string' ? args.query.trim() : '';
      if (!q) return failure('web_search', 'no query was given');
      const r = await tavilySearch(q, { env, fetchImpl });
      if (!r.ok) return { ok: false, label: 'web_search', content: r.text, sources: [] };
      return {
        ok: true,
        label: 'web_search',
        content: finish(r.text, { maxTokens, model, query: q }),
        sources: r.sources,
      };
    }

    if (name === 'fetch_page') {
      const url = typeof args.url === 'string' ? args.url.trim() : '';
      if (!url) return failure('fetch_page', 'no URL was given');
      const r = await tavilyScrape(url, { env, fetchImpl });
      if (!r.ok) return { ok: false, label: 'fetch_page', content: r.text, sources: [] };
      return {
        ok: true,
        label: 'fetch_page',
        content: finish(r.text, { maxTokens, model, query: url }),
        sources: r.sources,
      };
    }

    return {
      ok: false,
      label: String(name).slice(0, 40),
      content: `[unknown tool] There is no tool called "${String(name).slice(0, 80)}". Available tools: search_guides, web_search, fetch_page.`,
      sources: [],
    };
  } catch (e) {
    return failure(String(name).slice(0, 40) || 'tool', `it errored: ${String(e?.message || e).slice(0, 160)}`);
  }
}

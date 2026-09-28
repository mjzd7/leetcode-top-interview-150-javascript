/**
 * Tavily client for the web_search and fetch_page tools.
 *
 * Two responsibilities that must not be separated:
 *
 *   1. Talk to Tavily, cheaply and briefly.
 *   2. Refuse URLs that would turn this serverless function into an SSRF proxy.
 *
 * (2) is not optional hardening. The URL handed to fetch_page is chosen BY THE
 * MODEL, and the model's choice is steerable by whatever text it has read — which
 * now includes attacker-controlled web pages. A guard on user input would prove
 * nothing here; the guard has to sit on the argument, at the last moment, and
 * default to refusing. Hence: scheme allowlist, private/loopback/link-local/
 * CGNAT/multicast rejection, and a no-single-label-hostname rule, all applied to
 * the URL *after* WHATWG normalisation (so http://2130706433/ arrives as
 * 127.0.0.1 and is caught by the ordinary IPv4 rules).
 *
 * Everything here fails SOFT. A public site can be made to exhaust a 1,000/month
 * free quota in a day, and a hard failure there would surface to a reader as a
 * broken assistant. Every error path returns ok:false plus a sentence the model
 * can read and pass on, so it degrades into "the web lookup did not happen"
 * instead of a dead stream.
 */

const TAVILY_BASE = 'https://api.tavily.com';
/** Tavily is a search API, not a slow one. Failing fast keeps the route inside its budget. */
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_RESULTS = 5;

/* ------------------------------------------------------------------ *
 * SSRF guard
 * ------------------------------------------------------------------ */

/**
 * Is this host inside a network the function must never reach?
 *
 * Covers loopback (127/8), the cloud metadata endpoint (169.254/16), RFC1918,
 * CGNAT (100.64/10), this-network-and-beyond (0/8), multicast and reserved
 * (224/4 and up), `.localhost`, and IPv6 outside global unicast (2000::/3) —
 * which is what excludes ::1, fe80:: link-local and fc00:: ULA.
 */
function isPrivateHost(rawHost) {
  const host = String(rawHost).toLowerCase().replace(/^\[|\]$/g, '');

  if (host === '' || host === 'localhost' || host.endsWith('.localhost')) return true;

  if (host.includes(':')) {
    // IPv6: allow only global unicast 2000::/3.
    return !/^[23][0-9a-f]{3}:/.test(host);
  }

  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false; // a real DNS name, resolved by the fetcher, not by us
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

/**
 * Decide whether a URL may be fetched.
 *
 * Returns { ok, reason }. A refusal always carries a reason: this string is what
 * the model sees, so "refused" is strictly worse than "refused: that address is
 * on a private network".
 */
export function isBlockedUrl(input) {
  if (typeof input !== 'string' || !input.trim()) {
    return { ok: false, reason: 'no URL was provided' };
  }
  let u;
  try {
    u = new URL(input.trim());
  } catch {
    return { ok: false, reason: 'not a valid absolute URL' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, reason: `refused scheme "${u.protocol}" — only http and https are allowed` };
  }
  if (u.username || u.password) {
    return { ok: false, reason: 'refused a URL containing embedded credentials' };
  }
  if (isPrivateHost(u.hostname)) {
    return { ok: false, reason: 'refused: that host is on a private, loopback, or link-local network' };
  }
  // A single-label name ("intranet", "metadata") is not a public FQDN; it can only
  // resolve somewhere the deploy's own resolver reaches.
  if (!u.hostname.includes('.')) {
    return { ok: false, reason: 'refused: not a fully-qualified public domain name' };
  }
  return { ok: true, reason: '' };
}

/* ------------------------------------------------------------------ *
 * Client
 * ------------------------------------------------------------------ */

/** Are the web tools available on this deployment? */
export function webConfigured(env = process.env) {
  return !!(env && env.TAVILY_API_KEY);
}

/** Resolve a fetcher: injected for tests, global otherwise. */
function fetcher(fetchImpl) {
  return fetchImpl || globalThis.fetch;
}

function unavailable(reason) {
  // `text` is what the model reads. Keep it a sentence it can pass to the reader.
  return {
    ok: false,
    reason,
    text: `[web tool unavailable] ${reason}. Answer without this tool, and say plainly that the web lookup did not happen.`,
    sources: [],
  };
}

async function post(pathname, body, { env, fetchImpl }) {
  const doFetch = fetcher(fetchImpl);
  if (typeof doFetch !== 'function') return unavailable('no fetch implementation available');

  let res;
  try {
    res = await doFetch(`${TAVILY_BASE}${pathname}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.TAVILY_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    const msg = String(e?.message || e);
    if (/timeout|abort/i.test(msg)) return unavailable('the search provider did not respond in time');
    return unavailable(`the search provider could not be reached (${msg.slice(0, 120)})`);
  }

  if (!res.ok) {
    // 401/403 means the key is wrong; 429/432 means the quota is gone. Both are
    // routine on a free tier and must not read as a crash.
    const what = res.status === 401 || res.status === 403
      ? 'the search provider rejected the API key'
      : res.status === 429 || res.status === 432
        ? 'the search quota for this month is used up'
        : `the search provider returned HTTP ${res.status}`;
    return unavailable(what);
  }

  try {
    return { ok: true, data: await res.json() };
  } catch {
    return unavailable('the search provider returned a response that was not JSON');
  }
}

/**
 * Search the web. Returns { ok, text, sources, reason }.
 *
 * `sources` is what the model cites; `text` is the snippet corpus it reasons
 * over. Snippets only — the model is told to call fetch_page when it needs one
 * specific page in full, which keeps each result small and the quota long.
 */
export async function tavilySearch(query, { env = process.env, fetchImpl } = {}) {
  const q = String(query ?? '').trim();
  if (!q) return unavailable('no search query was provided');
  if (!webConfigured(env)) return unavailable('web search is not configured on this deployment');

  const res = await post('/search', {
    query: q,
    max_results: MAX_RESULTS,
    search_depth: 'basic',
    include_answer: false,
    include_raw_content: false,
  }, { env, fetchImpl });
  if (!res.ok) return res;

  const results = Array.isArray(res.data?.results) ? res.data.results : [];
  if (results.length === 0) return unavailable(`the web search for "${q.slice(0, 100)}" returned no results`);

  const sources = [];
  const lines = [];
  for (const r of results) {
    const url = typeof r?.url === 'string' ? r.url : '';
    if (!url) continue;
    const title = String(r?.title || '').trim();
    const snippet = String(r?.content || '').trim();
    sources.push({ title, url });
    lines.push(`TITLE: ${title}\nURL: ${url}\n${snippet}`.trim());
  }
  if (lines.length === 0) return unavailable('the web search returned results with no usable URLs');

  return { ok: true, reason: '', text: lines.join('\n\n'), sources };
}

/**
 * Fetch one page as markdown. Runs the SSRF guard first, always.
 */
export async function tavilyScrape(url, { env = process.env, fetchImpl } = {}) {
  const target = String(url ?? '').trim();
  if (!target) return unavailable('no URL was provided');

  const verdict = isBlockedUrl(target);
  if (!verdict.ok) return unavailable(verdict.reason);

  if (!webConfigured(env)) return unavailable('page fetching is not configured on this deployment');

  const res = await post('/scrape', { url: target, format: 'markdown' }, { env, fetchImpl });
  if (!res.ok) return res;

  const markdown = typeof res.data?.results?.markdown === 'string' ? res.data.results.markdown : '';
  if (!markdown.trim()) return unavailable(`the page at ${target.slice(0, 120)} returned no readable text`);

  return {
    ok: true,
    reason: '',
    text: `URL: ${target}\n\n${markdown}`,
    sources: [{ title: String(res.data?.results?.title || target), url: target }],
  };
}

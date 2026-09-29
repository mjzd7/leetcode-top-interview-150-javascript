/**
 * Context-aware chat widget for the Top Interview 150 portal.
 *
 * IIFE on purpose (see CHATBOX_PROGRESS.md D-3): docs/index.html relies on real
 * globals from its inline handlers, so a deferred `type="module"` would be a
 * lifecycle hazard here. Encapsulation is still achieved — this file adds
 * exactly one global, `window.LtChat`, which exists as a test/debug seam.
 *
 * Talks to POST /api/chat and reads the SSE response. See
 * CHATBOX_PROGRESS.md for the wire contract and the reasoning behind the
 * security controls; nothing in this file is load-bearing for the server.
 *
 * ── How a reply is painted ────────────────────────────────────────────────
 * The network hands us text in bursts of whatever bytes arrived, which is why
 * the first implementation looked like this: it assigned the whole accumulated
 * buffer to `textContent` on every delta. That is one visible step (SSE frames
 * routinely arrive many-per-read), in plain text, with no markdown — so the
 * reader got an unformatted wall that then snapped into place at the end.
 *
 * The answer is now *revealed*, not *displayed*:
 *   1. `state.reveal` is a cursor into the accumulated text. A rAF pump
 *      (`pumpReveal`) advances it at a human pace, landing on word boundaries.
 *   2. `paintReveal` splits the revealed text at the last block boundary that
 *      cannot still change (`stableSplit`), renders that prefix as real
 *      markdown, and the unfinished remainder as escaped text with a caret.
 *   3. The turn end does a full render, so Mermaid/viz-array/table passes that
 *      are not worth running on every frame still land.
 *
 * The network can outrun the eye, so the pump sprints when its backlog grows
 * and the turn end never leaves the reader waiting for an animation to finish.
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * Config
   * ------------------------------------------------------------------ */

  /** Same-origin by default. Set to an absolute URL to host the API separately. */
  var API_BASE = '';

  /** Client-side cap. The server also truncates by tokens; this is the cheap first pass. */
  var MAX_CONTEXT_CHARS = 40000;

  /** If the provider says nothing for this long, surface a timeout instead of spinning. */
  var FIRST_TOKEN_TIMEOUT_MS = 25000;

  /** Treat "within this many px of the bottom" as still following the stream. */
  var AUTOSCROLL_SLACK = 64;

  /* --- reveal pacing ------------------------------------------------- */

  /** Reveal pace in characters per second (~35 words/s: visibly word-by-word). */
  var REVEAL_CPS = 200;

  /**
   * Backlog above this many chars means the network is far ahead of the eye, so
   * the pump sprints rather than leaving a long silent tail. Deliberately high:
   * a normal paragraph of answer is well under it, and sprinting there is what
   * makes a fast provider look like it dumped the answer.
   */
  var REVEAL_SPRINT_AT = 2500;

  /** Sprint multiplier, so a long answer never leaves a long silent tail. */
  var REVEAL_SPRINT_MULT = 5;

  /** Extra pace once the network is done and the pump is only catching up. */
  var REVEAL_DRAIN_MULT = 1.6;

  /**
   * A single token longer than this is cut mid-word rather than stalled on.
   * Without the escape hatch one 500-char base64 blob would freeze the reveal
   * until the whole word had arrived.
   */
  var REVEAL_HARD_CHARS = 28;

  /** Composer grows with the question up to this height, then scrolls. */
  var COMPOSER_MAX_H = 168;

  var state = {
    articleId: null,
    articleTitle: '',
    messages: [], // { role, content, ts, status }
    open: false,
    streaming: false,
    controller: null,
    firstTokenTimer: null,
    statusOverride: '',
    pinScroll: true,
    lastFocus: null,
    reveal: null,
    animated: Object.create(null),
  };

  var el = {};

  /* ------------------------------------------------------------------ *
   * Small helpers
   * ------------------------------------------------------------------ */

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function $(id) {
    return document.getElementById(id);
  }

  function nowLabel() {
    var d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /* ------------------------------------------------------------------ *
   * Page context
   * ------------------------------------------------------------------ */

  /**
   * Resolve the open guide's record in `window.CURRICULUM_DATA`.
   *
   * The portal keeps the open article in the URL hash and `curriculum-data.js`
   * is already loaded on every page, so this needs no coupling to the portal's
   * internals — the hash is the source of truth, exactly as it is for the
   * article id the widget already tracks.
   *
   * The index is built once and lazily: the file is ~3MB, so walking it on
   * every keystroke-free render would be silly, but so would paying for it on a
   * page that never opens the chat.
   */
  var entryIndex = null;

  function indexCurriculum() {
    if (entryIndex) return entryIndex;
    entryIndex = new Map();
    var data = window.CURRICULUM_DATA;
    if (!Array.isArray(data)) return entryIndex;
    data.forEach(function (cat) {
      if (!cat || !Array.isArray(cat.items)) return;
      cat.items.forEach(function (item) {
        if (item && item.id) entryIndex.set(item.id, { category: cat.category || '', item: item });
      });
    });
    return entryIndex;
  }

  function currentEntry() {
    var id = currentArticleId();
    if (!id || id === '__home__') return null;
    return indexCurriculum().get(id) || null;
  }

  /**
   * Which kind of page the reader is on.
   *
   * The discriminators are facts about the data rather than a hardcoded page
   * list: the 150 problems are exactly the records that carry a LeetCode link,
   * and the foundations primers are the FOUNDATIONS category. Everything else is
   * a long-form guide.
   */
  function pageKind() {
    var entry = currentEntry();
    if (!entry) return 'home';
    if (entry.item.leetcodeLink) return 'problem';
    if (/^FOUNDATIONS/i.test(entry.category)) return 'primer';
    return 'guide';
  }

  /**
   * The headings actually on screen.
   *
   * Read from the DOM rather than the raw markdown on purpose: this is what the
   * reader can see, so a suggestion can only ever name a section that exists in
   * front of them. Home counts too — it renders its own headings.
   *
   * h1 is excluded: it is the page title, which the empty state already shows,
   * and "Explain <the title you are reading>" is a question with no answer.
   */
  function pageHeadings() {
    var root = $('articleContent');
    if (!root) return [];
    return Array.prototype.slice
      .call(root.querySelectorAll('h2, h3'))
      .map(function (h) { return cleanHeading(h.textContent); })
      .filter(function (t) { return t && t.length > 2 && t.length < 110; });
  }

  /** Strip markdown noise and the manual's "4. " section numbering from a heading. */
  function cleanHeading(s) {
    return String(s == null ? '' : s)
      .replace(/[`*_]/g, '')
      .replace(/^\s*#+\s*/, '')
      .replace(/^\d+(\.\d+)*[.)]?\s+/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * A heading reduced to something that fits a chip.
   *
   * Cuts at a clause boundary first (a parenthetical, an "&", a colon, a comma)
   * so a truncation never lands mid-phrase — "JavaScript-Specific Gotchas & V8
   * Optimizations" becomes "JavaScript-Specific Gotchas", not "JavaScript-Specif…".
   */
  function compactHeading(text, max) {
    var t = String(text || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
    if (t.length <= max) return t;
    var m = /^(.*?)(?:\s+&\s+|:\s+|,\s+)/.exec(t);
    if (m && m[1].length >= 18 && m[1].length <= max * 1.4) return m[1].trim();
    var cut = t.slice(0, max);
    var sp = cut.lastIndexOf(' ');
    if (sp > max * 0.6) cut = cut.slice(0, sp);
    return cut.replace(/[\s,;:.\-–—&]+$/, '') + '…';
  }

  /**
   * Headings too generic to be worth a question.
   *
   * "Executive Summary" and "Detailed Analysis" are scaffolding: asking the
   * assistant to explain one produces a question with no anchor.
   */
  var GENERIC_HEADING = /^(executive summary|summary|key findings|detailed analysis|introduction|intro|overview|conclusion|contents|table of contents|appendix|references|notes|background)\b/i;

  function pickHeadings(list, test, count) {
    var out = [];
    for (var i = 0; i < list.length && out.length < count; i++) {
      var h = list[i];
      if (GENERIC_HEADING.test(h)) continue;
      if (test && !test.test(h)) continue;
      out.push(h);
    }
    return out;
  }

  /**
   * Vocabulary that belongs to the problem guides only.
   *
   * Used as a guard, not as a filter for generation: whatever a page's own
   * headings suggest, a primer or a MAANG guide must never be offered
   * "walk me through the dry run", because there is no dry run there to read.
   */
  var PROBLEM_ONLY = /\bbrute force\b|\bdry run\b|\btime complexity\b|\blevel\s*[123]\b|\bcanonical\b|\bleetcode\b|\bheap\b|\btwo pointers?\b|\bsliding window\b/i;

  function notProblemVocabulary(list) {
    return list.filter(function (q) { return !PROBLEM_ONLY.test(q); });
  }

  /**
   * Suggestions for the page in front of the reader.
   *
   * Everything here is assembled from that page's own title, category and
   * headings. The previous implementation returned one constant array of three
   * DSA strings for every page, which is why a foundations primer and a
   * behavioural-interview guide both offered "Explain the brute force in one
   * line" — a question about content those pages do not contain.
   */
  function buildSuggestions() {
    var entry = currentEntry();
    var kind = pageKind();
    var headings = pageHeadings();
    var title = entry ? cleanHeading(entry.item.title) : 'this manual';
    var out = [];

    if (kind === 'problem') {
      // The 150 problem guides share one fixed 6-section schema, so a verified
      // section can be named by its short fixed label instead of quoting the
      // whole heading — "Level 3: Most Optimal / Canonical Approach (Single-Pass
      // Hash Map with Complement Interception)" is not a chip.
      var lv1 = pickHeadings(headings, /level\s*1|brute/i, 1)[0];
      var lv2 = pickHeadings(headings, /level\s*2|optimi[sz]ed/i, 1)[0];
      var lv3 = pickHeadings(headings, /level\s*3|canonical|most optimal/i, 1)[0];
      var gotchas = pickHeadings(headings, /gotcha|v8|javascript-specific|optimi[sz]ation/i, 1)[0];
      var followups = pickHeadings(headings, /follow-?up|extension|real-world/i, 1)[0];

      if (lv3) out.push('Walk me through Level 3: the canonical approach');
      else if (lv1) out.push('Walk me through ' + compactHeading(lv1, 34));
      if (lv2) out.push('Show the dry run for Level 2: the optimized pass');
      if (gotchas) out.push('Ask about ' + compactHeading(gotchas, 34));
      if (followups) out.push('Ask about ' + compactHeading(followups, 34));
      if (!out.length) out.push('Explain this problem like I am about to be interviewed on it');

    } else if (kind === 'primer') {
      pickHeadings(headings, /pitfall|quirk|gotcha|trap/i, 2).forEach(function (h) {
        out.push('Explain ' + compactHeading(h, 38));
      });
      pickHeadings(headings, /checklist|polyfill|pattern|structure/i, 1).forEach(function (h) {
        out.push('Show a runnable example of ' + compactHeading(h, 30));
      });
      out.push('Which of these bite hardest in a real interview?');
      out = notProblemVocabulary(out);

    } else if (kind === 'guide') {
      pickHeadings(headings, null, 3).forEach(function (h) {
        out.push('Explain ' + compactHeading(h, 38));
      });
      out.push('What is the single most important thing here?');
      out.push('Turn this into a 30-day study plan');
      out = notProblemVocabulary(out);

    } else {
      // Home: no guide is open, so orient rather than pretend. Its own headings
      // are the honest source of "what can I ask about this site".
      pickHeadings(headings, /guide|roadmap|how to use|what each/i, 2).forEach(function (h) {
        out.push('Tell me about ' + compactHeading(h, 34));
      });
      out.push('Where should I start, and in what order?');
      out.push('How do I track my progress?');
      out = notProblemVocabulary(out);
    }

    // Dedupe, drop empties, and cap the list. Chips are a starting point, not a menu.
    var seen = {};
    return out
      .map(function (q) { return String(q).replace(/\s+/g, ' ').trim(); })
      .filter(function (q) {
        if (!q || seen[q]) return false;
        seen[q] = true;
        return true;
      })
      .slice(0, 4);
  }

  /**
   * Pull the readable text of the guide currently on screen.
   *
   * Degrades rather than throws: every selector is optional, and a portal with
   * nothing rendered yields ''. The server treats '' honestly ("no guide text was
   * captured") instead of hallucinating context.
   */
  function extractPageContext() {
    var root =
      $('articleContent') ||
      document.querySelector('.prose') ||
      document.querySelector('article') ||
      null;
    if (!root) return '';

    // Clone so we can strip noise without touching the live DOM.
    var clone = root.cloneNode(true);
    var junk = [
      'script', 'style', 'noscript', 'svg', 'button', 'iframe', 'form',
      '.mermaid', '.copy-btn', '.copy-flash', '.chat-code-copy', '.no-context',
      '[aria-hidden="true"]',
    ];
    junk.forEach(function (sel) {
      clone.querySelectorAll(sel).forEach(function (n) { n.remove(); });
    });

    // Text nodes carry the guide; attributes carry the noise (long hrefs, ids).
    var text = clone.textContent || '';
    text = text
      .replace(/ /g, ' ')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    if (text.length > MAX_CONTEXT_CHARS) {
      var head = Math.ceil(MAX_CONTEXT_CHARS * 0.7);
      var tail = MAX_CONTEXT_CHARS - head;
      text = text.slice(0, head) + '\n\n[... content elided by the browser ...]\n\n' + text.slice(text.length - tail);
    }
    return text;
  }

  /** Title of the open guide, for the API payload and the panel header. */
  function currentTitle() {
    // The curriculum record is the same string the sidebar shows, so the header
    // and the nav never disagree. Falls back to the DOM for pages it does not
    // know about.
    var entry = currentEntry();
    if (entry && entry.item.title) return String(entry.item.title).trim();
    var h1 = document.querySelector('#articleContent h1');
    if (h1 && h1.textContent.trim()) return h1.textContent.trim();
    var crumbs = $('crumbRow');
    if (crumbs) {
      var t = crumbs.textContent.replace(/\s*\/\s*/g, ' · ').trim();
      if (t) return t;
    }
    return document.title || 'this page';
  }

  function currentCategory() {
    var entry = currentEntry();
    if (entry && entry.category) return entry.category;
    var crumbs = $('crumbRow');
    if (!crumbs) return '';
    var first = crumbs.querySelector('span');
    return first ? first.textContent.trim() : '';
  }

  function currentArticleId() {
    // The portal keeps the open article in the URL hash, and history.replaceState
    // writes it on every openArticle(), so this is always current — including for
    // the home landing view, where the hash is cleared.
    var h = (location.hash || '').replace(/^#/, '');
    return h || '__home__';
  }

  /* ------------------------------------------------------------------ *
   * Persistence
   * ------------------------------------------------------------------ *
   * `localStorage`, not `sessionStorage`, and not IndexedDB.
   *
   * sessionStorage was the actual defect: it is per-tab, so a thread died with
   * the tab. IndexedDB would fix that too, but it makes every read a promise, and
   * messageNode(), clearCurrent() and the per-guide thread swap are all built on
   * readStore() being SYNCHRONOUS. localStorage fixes the defect for free and
   * keeps that ordering. Same key as before, so nothing else had to change.
   *
   * The cost of the fix is a privacy one, and it is real: history that outlives
   * the tab is readable by anyone at the same browser profile. Retention is the
   * mitigation, so it is bounded three ways — a byte cap with oldest-first
   * eviction, a 30-day TTL, and a control that erases every thread at once.
   */

  /** Per-article chat history, so switching guides keeps separate threads. */
  var STORAGE_KEY = 'lt150-chat-v1';

  /**
   * Consecutive-429 counter, stored beside the store rather than inside it.
   *
   * It is not a thread, and `lt150-chat-v1` is a flat {articleId: entry} map that
   * the cap and the TTL both walk. A magic key inside it would have to be special
   * -cased in three places to avoid being treated as a 30-day-old conversation.
   */
  var GATE_KEY = STORAGE_KEY + ':gate';

  /**
   * Retention window. 30 days matches the session cookie's own 30-day expiry, so
   * a signed-in reader's history does not outlive their session by much.
   */
  var STORE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

  /**
   * Byte budget for the whole store.
   *
   * Measured, not guessed (2026-09-28). Built from this manual's own guide
   * markdown as a stand-in for model output — same LaTeX, same fenced code, same
   * dry-run tables — at the shape the widget actually keeps, `slice(-40)` of
   * ~5 KB answers:
   *
   *   p50 per message   5,226 B      p99 5,340 B      max 5,348 B
   *   one full thread    107,271 B    (40 messages)
   *   20 such threads    2,147,153 B
   *
   * 1 MiB therefore holds ~10 maxed-out threads. It is a fifth of the 5 MiB
   * origin quota, which is shared with this portal's progress, judge-draft, rail
   * and nav keys, and a setItem that overruns throws — and a throw here would
   * cost the reader persistence for the WHOLE origin, not just chat. Headroom is
   * the point; a tighter cap would start evicting threads a reader still wants.
   */
  var STORE_MAX_BYTES = 1048576;

  /** Messages kept per guide. */
  var MAX_MESSAGES = 40;

  /* --- 429 soft gate (D-10) ------------------------------------------ */

  /** A session RAISES the rate limit; it never gates chat. Offer it from here. */
  var GATE_AFTER = 3;

  /** Ceiling on the counter, so a long outage cannot nag a reader indefinitely. */
  var GATE_MAX = 5;

  /**
   * Two 429s an hour apart are not a burst. Without this window a reader who hit
   * the limit once last week would be "offered a sign-in" on their next single 429
   * today, which is nagging rather than a remedy.
   */
  var GATE_WINDOW_MS = 15 * 60 * 1000;

  /** UTF-8 byte length, because the localStorage quota is accounted in bytes. */
  function byteLength(s) {
    try { return new Blob([s]).size; } catch (e) { return s.length; }
  }

  function loadStore() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function writeStore(store) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (e) {
      /* private mode / quota — chat still works for this session */
    }
  }

  /**
   * Adopt threads written by the previous sessionStorage build.
   *
   * A reader who was mid-conversation when this shipped has their history only
   * in sessionStorage, and losing it on deploy is a real regression. localStorage
   * wins on conflict (it is the newer medium), the session copy is then dropped
   * so it cannot come back or be counted twice, and a malformed value is
   * discarded rather than retried on every read.
   */
  function migrateFromSession(store) {
    var raw;
    try { raw = sessionStorage.getItem(STORAGE_KEY); } catch (e) { return false; }
    if (!raw) return false;
    try {
      var old = JSON.parse(raw);
      if (old && typeof old === 'object' && !Array.isArray(old)) {
        Object.keys(old).forEach(function (id) {
          if (!store[id]) store[id] = old[id];
        });
      }
    } catch (e) { /* malformed: drop it below rather than re-parsing forever */ }
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    return true;
  }

  /**
   * Apply the TTL, then the byte cap, oldest first.
   *
   * Returns true if anything was removed, so the caller knows to persist. Done on
   * READ as well as write: a reader who has stopped chatting should still have
   * their store shrink, and it makes "the store never exceeds the cap" hold
   * without depending on a future write.
   */
  function pruneStore(store) {
    var now = Date.now();
    var changed = false;

    Object.keys(store).forEach(function (id) {
      var entry = store[id];
      if (!entry || typeof entry !== 'object' || typeof entry.updatedAt !== 'number'
          || now - entry.updatedAt > STORE_TTL_MS) {
        delete store[id];
        changed = true;
      }
    });

    while (byteLength(JSON.stringify(store)) > STORE_MAX_BYTES) {
      var oldestId = null;
      var oldest = Infinity;
      Object.keys(store).forEach(function (id) {
        var at = store[id] && store[id].updatedAt;
        if (typeof at === 'number' && at < oldest) { oldest = at; oldestId = id; }
      });
      // A single thread bigger than the whole budget is kept: deleting the
      // conversation the reader is currently in is worse than a setItem that
      // may throw, and the old code already degraded to "unsaved" in that case.
      if (oldestId === null) break;
      delete store[oldestId];
      changed = true;
    }
    return changed;
  }

  /**
   * The store, pruned and migrated.
   *
   * Synchronous by contract: the init path, the per-guide swap and clearCurrent()
   * all call this and immediately use the result.
   */
  function readStore() {
    var store = loadStore();
    var migrated = migrateFromSession(store);
    var pruned = pruneStore(store);
    if (migrated || pruned) writeStore(store);
    return store;
  }

  function saveStore() {
    var store = readStore();
    store[state.articleId] = {
      updatedAt: Date.now(),
      messages: state.messages.slice(-MAX_MESSAGES),
    };
    pruneStore(store);
    writeStore(store);
  }

  function loadForArticle(id) {
    var entry = readStore()[id];
    state.messages = entry && Array.isArray(entry.messages)
      ? entry.messages.filter(function (m) { return m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'; })
      : [];
    // A restored thread has already been read, so nothing in it re-animates.
    state.animated = Object.create(null);
  }

  function clearCurrent() {
    state.messages = [];
    state.animated = Object.create(null);
    var store = readStore();
    delete store[state.articleId];
    writeStore(store);
    renderLog();
    el.input.focus();
  }

  /**
   * Erase every guide's thread, not just the open one.
   *
   * Separate from clearCurrent because the two have very different consequences
   * and only one of them is obvious from its label: this one has no undo, and it
   * takes every conversation on the device with it. The gate counter goes too —
   * it is part of this widget's local state, and leaving it behind would mean
   * "clear all chats" did not.
   */
  function clearAllChats() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    try { localStorage.removeItem(GATE_KEY); } catch (e) { /* ignore */ }
    state.messages = [];
    state.animated = Object.create(null);
    renderLog();
    el.input.focus();
  }

  /* --- 429 soft gate ------------------------------------------------- */

  function readGate() {
    try {
      var raw = localStorage.getItem(GATE_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed.count === 'number' ? parsed : { count: 0, at: 0 };
    } catch (e) {
      return { count: 0, at: 0 };
    }
  }

  function writeGate(gate) {
    try { localStorage.setItem(GATE_KEY, JSON.stringify(gate)); } catch (e) { /* ignore */ }
  }

  /** Record a rate-limited attempt; true from the third of a burst onward. */
  function noteRateLimited() {
    var gate = readGate();
    var now = Date.now();
    var carried = gate.at && now - gate.at <= GATE_WINDOW_MS ? gate.count : 0;
    var count = Math.min(carried + 1, GATE_MAX);
    writeGate({ count: count, at: now });
    return count >= GATE_AFTER;
  }

  /** Any turn that got through the limiter ends the streak. */
  function noteTurnAllowed() {
    if (readGate().count) writeGate({ count: 0, at: 0 });
  }

  /* ------------------------------------------------------------------ *
   * Markdown rendering
   * ------------------------------------------------------------------ */

  /**
   * Render any Mermaid diagrams inside `scope`, and only those.
   *
   * `mermaid.initialize` is GLOBAL state, not per-call, and the portal's
   * openArticle() re-initialises it to `securityLevel: 'loose'` before an
   * unscoped `mermaid.run()`. So initialize() is called before *every* run here,
   * not once: a one-way "already initialised" latch left every chat diagram after
   * the reader opened a guide rendering under the article's 'loose'. The
   * consequence is not cosmetic — Mermaid binds a `click`/`href` directive into a
   * live `<a xlink:href>` only at 'loose', so a model-authored `click A
   * "javascript:…"` became a clickable javascript: URL in the chat bubble, and
   * `fetch_page` lets a stranger's page influence what the model emits.
   *
   * The run stays scoped to `scope`, which keeps the chat's own diagrams out of
   * the article's page-wide pass. The source is already DOMPurify'd and escaped
   * by the renderer, so a parse failure can only cost the picture, never the
   * message — hence the fallback to a plain <pre>.
   */
  async function renderMermaid(scope) {
    if (!window.mermaid) return;
    var nodes = Array.prototype.slice.call(scope.querySelectorAll('.ltc-mermaid'));
    if (!nodes.length) return;

    // Captured before run(): Mermaid overwrites the node's contents with an
    // <svg>, so the source is only readable up to this point.
    var sources = nodes.map(function (n) { return n.textContent; });

    try {
      // Re-asserted on every render, immediately before the run: the portal's
      // openArticle() can (and does) reset this global to 'loose' at any time.
      window.mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        securityLevel: 'strict',
        themeVariables: { primaryTextColor: '#E9EDF4', edgeLabelBackground: '#1A2130' },
      });
      await window.mermaid.run({ nodes: nodes });
    } catch (e) { /* handled by the check below, which covers both cases */ }

    // A parse failure is NOT always a throw: Mermaid injects an <svg> tagged
    // aria-roledescription="error" that collapses to zero height. Checking only
    // for a missing <svg> therefore left a blank box in the bubble, so the
    // error marker is what decides a fallback to the source.
    nodes.forEach(function (n, i) {
      if (n.parentNode === null) return; // already replaced, or detached by a re-render
      var failed = n.querySelector('[aria-roledescription="error"]') || !n.querySelector('svg');
      if (!failed) return;
      var pre = document.createElement('pre');
      pre.className = 'ltc-mermaid-error';
      // A bare <pre> of source is indistinguishable from a broken box: the
      // reader cannot tell a diagram was attempted, or that what they are
      // looking at is meant to be readable. The label is a real element rather
      // than a CSS ::before so a screen reader announces it and so a test can
      // assert it — a generated-content label is neither.
      var note = document.createElement('span');
      note.className = 'ltc-mermaid-error-note';
      note.textContent = 'This diagram could not be parsed, so its source is shown instead.';
      pre.appendChild(note);
      pre.appendChild(document.createTextNode(sources[i]));
      n.replaceWith(pre);
    });
  }

  var VIZ_LANGS = ['viz-array'];

  /**
   * Build the HTML for a `~~~viz-array` block: an array drawn as real cells,
   * with pointer markers, a Map row and a Set row.
   *
   * Returns null for anything unusable so the caller can fall back to an ordinary
   * code block. That fallback is the point: a malformed payload must degrade to
   * "here is the JSON the model produced", never to an empty box.
   *
   * Everything interpolated goes through esc(). The only value that becomes part
   * of an attribute is `grid-column`, and that is a Number() that has been clamped
   * to the cell count, so it cannot carry CSS.
   */
  function renderViz(source) {
    var data;
    try { data = JSON.parse(source); } catch (e) { return null; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

    var cells = Array.isArray(data.cells) ? data.cells : [];
    if (!cells.length || cells.length > 40) return null;

    var out = '<div class="viz-array">';
    if (data.title != null) out += '<div class="viz-title">' + esc(data.title) + '</div>';

    // One grid for cells AND pointers. Two separate grids with the same
    // grid-column values silently drift apart, because each sizes its own tracks
    // from its own content (the cell row is max-content wide, the pointer row is
    // not), so a pointer labelled for index 1 lands under a different cell.
    out += '<div class="viz-grid" style="--viz-cols:' + cells.length + '">';
    cells.forEach(function (c, i) {
      var isObj = c && typeof c === 'object';
      var v = isObj ? c.v : c;
      var state = isObj && c.state != null ? String(c.state) : '';
      // Constrained so the class name can never be attacker-chosen markup.
      var safe = /^[a-z-]{1,12}$/i.test(state) ? ' is-' + state : '';
      out += '<div class="viz-cell' + safe + '" style="grid-area:1/' + (i + 1) + '">' + esc(v) + '</div>';
    });

    var pointers = Array.isArray(data.pointers) ? data.pointers : [];
    pointers.forEach(function (p) {
      var i = Number(p && p.i);
      if (!isFinite(i) || i < 0) return;
      // data-at stays 0-based so it matches the `i` in the payload and ordinary
      // array indexing; the row/column placement above is 1-based CSS.
      var col = Math.min(Math.floor(i), cells.length - 1) + 1;
      out += '<div class="viz-pointer-slot" style="grid-area:2/' + col + '">'
        + '<span class="viz-pointer" data-at="' + Math.floor(i) + '">' + esc(p.label == null ? i : p.label) + '</span>'
        + '</div>';
    });
    out += '</div>';

    if (Array.isArray(data.map) && data.map.length) {
      out += '<div class="viz-row viz-map"><span class="viz-row-label">Map</span>';
      data.map.forEach(function (pair) {
        var isPair = Array.isArray(pair);
        out += '<span class="viz-pair"><span class="viz-k">' + esc(isPair ? pair[0] : pair) + '</span>'
          + '<span class="viz-arrow">→</span>' + esc(isPair ? pair[1] : '') + '</span>';
      });
      out += '</div>';
    }

    if (Array.isArray(data.set) && data.set.length) {
      out += '<div class="viz-row viz-set"><span class="viz-row-label">Set</span>';
      data.set.forEach(function (v) { out += '<span class="viz-item">' + esc(v) + '</span>'; });
      out += '</div>';
    }

    return out + '</div>';
  }

  /**
   * A marked renderer that bakes a copy button into every fenced code block.
   *
   * marked changed this signature: v15+ passes a single token object
   * ({ text, lang, escaped }) while v12-v14 passed (code, infostring). The CDN
   * script is pinned to an exact version, so only one shape is live — the shim
   * is kept anyway, so a deliberate version bump cannot silently turn every
   * code block in a chat answer into a blank box. `code` is escaped here because
   * a custom renderer returns raw HTML that marked will not re-escape.
   */
  function makeRenderer() {
    var renderer = new marked.Renderer();
    renderer.code = function (a, b) {
      var code = a && typeof a === 'object' ? a.text : a;
      var langRaw = a && typeof a === 'object' ? a.lang : b;
      var lang = String(langRaw || '').split(/\s+/)[0];

      // A diagram is a picture, not source: no copy button, and it needs the
      // Mermaid pass rather than a <pre>. Falls back to a normal code block if
      // the CDN never loaded, so the source is still readable.
      if (lang === 'mermaid' && window.mermaid) {
        return '<div class="mermaid ltc-mermaid">' + esc(code) + '</div>';
      }

      // Structured visualisations: try the rich form, else show the raw payload.
      if (VIZ_LANGS.indexOf(lang) !== -1) {
        var viz = renderViz(code);
        if (viz) return viz;
      }

      var cls = lang ? ' class="language-' + esc(lang) + '"' : '';
      return (
        '<div class="chat-code">' +
        '<button class="chat-code-copy" type="button" data-copy aria-label="Copy code to clipboard">Copy</button>' +
        '<pre><code' + cls + '>' + esc(code) + '</code></pre>' +
        '</div>'
      );
    };
    return renderer;
  }

  var renderer = null;
  function getRenderer() {
    if (!renderer && window.marked && window.marked.Renderer) renderer = makeRenderer();
    return renderer;
  }

  /**
   * Render assistant markdown safely.
   *
   * The renderer must be passed per call — a `marked.Renderer` that is merely
   * constructed is never consulted. marked parses, then DOMPurify sanitises;
   * DOMPurify is the authority, not marked. Its defaults already allow
   * <button>/class, so the copy button survives sanitisation.
   */
  function renderMarkdown(src) {
    if (!(window.marked && window.marked.parse)) return '<pre>' + esc(src) + '</pre>';
    var md = window.marked.parse(String(src || ''), { renderer: getRenderer() });
    if (window.DOMPurify && window.DOMPurify.sanitize) {
      return window.DOMPurify.sanitize(md, { USE_PROFILES: { html: true } });
    }
    // No sanitiser available: show the source rather than inject untrusted HTML.
    return '<pre>' + esc(src) + '</pre>';
  }

  /**
   * Typeset the `$…$` / `$$…$$` inside `scope`, with the portal's own options.
   *
   * The option object is copied verbatim from `docs/index.html`'s openArticle()
   * rather than invented, and every key of it earns its place — all four were
   * measured against KaTeX 0.16.9 rather than assumed:
   *
   *   - `delimiters` is load-bearing. auto-render's *defaults* are `$$…$$`,
   *     `\(…\)` and `\[…\]`; `$…$` is not among them, so omitting this key
   *     silently renders no math at all rather than failing loudly.
   *   - `ignoredTags` is what stops a JS template literal being typeset. The
   *     hazard is a list that is WRONG, not one that is absent (KaTeX's own
   *     default already includes pre/code), but it is real: against a widget
   *     code block holding `` `${x}` `` and `$r$`, an `ignoredTags` list without
   *     pre/code produces one `.katex` and rewrites the source to
   *     "const key = `x'lets={nums[i]}`;".
   *   - `throwOnError: false` keeps malformed LaTeX as the literal text the
   *     model wrote instead of blanking the paragraph.
   *   - There is deliberately no `trust` key. Math runs AFTER DOMPurify, so
   *     KaTeX's output is never sanitised; `\href{javascript:…}` and
   *     `\htmlClass{<img onerror=…>}` are refused precisely because trust is
   *     off, and both were probed to produce 0 anchors and 0 images.
   */
  function renderMath(scope) {
    if (!scope || !window.renderMathInElement) return;
    try {
      window.renderMathInElement(scope, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false }
        ],
        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
        throwOnError: false
      });
    } catch (e) { /* leave the literal text rather than lose the answer */ }
  }

  /**
   * Wrap every table in a horizontal-scroll container.
   *
   * Dry-run traces are naturally wide, and a bare <table> inside a fixed-width
   * rail either stretches the rail or forces the whole bubble to scroll. The
   * wrapper confines the overflow to the table so the message stays put.
   *
   * Done as a DOM pass after sanitisation rather than a marked table renderer:
   * the article already wraps tables this way (`.table-scroll` in
   * `enhanceCodeBlocks`), and this also catches raw <table> HTML that the model
   * emitted directly, which DOMPurify legitimately allows through.
   */
  function enhanceTables(root) {
    root.querySelectorAll('table').forEach(function (tbl) {
      if (tbl.parentElement && tbl.parentElement.classList.contains('ltc-table-scroll')) return;
      var box = document.createElement('div');
      box.className = 'ltc-table-scroll';
      tbl.replaceWith(box);
      box.appendChild(tbl);
    });
  }

  /* ------------------------------------------------------------------ *
   * Message rendering
   * ------------------------------------------------------------------ */

  /** Inline mark for the assistant, used as the role affordance on every message. */
  var AI_MARK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z"/>'
    + '<path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z"/></svg>';

  var COPY_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<rect x="9" y="9" width="11" height="11" rx="2.5"/>'
    + '<path d="M5 15V6a2 2 0 012-2h8"/></svg>';

  function roleLabel(role) {
    return role === 'user' ? 'You asked' : 'Assistant answered';
  }

  function messageNode(m, index, animate) {
    var wrap = document.createElement('div');
    // `ltc-enter` is always on the element — it is the hook the design system
    // and the tests read — but the animation itself runs once. renderLog()
    // rebuilds the log from state on every turn, and a freshly built element
    // replays its CSS animation, so a message the reader has already watched
    // arrive would otherwise re-animate each time anything re-rendered.
    var key = m.role + ':' + index + ':' + (m.ts || '') + ':' + (m.content || '').length;
    wrap.className = 'ltc-msg ltc-msg--' + m.role + ' ltc-enter'
      + (state.animated[key] ? ' ltc-settled' : '');
    if (animate) state.animated[key] = true;
    wrap.setAttribute('data-role', m.role);
    // The visible chrome used to print "YOU 12:34" / "ASSISTANT 12:34" above
    // every message, which reads like a debug log. Roles are conveyed by
    // alignment and the mark; the label stays for assistive tech.
    wrap.setAttribute('aria-label', roleLabel(m.role) + (m.ts ? ' at ' + m.ts : ''));

    var head = document.createElement('div');
    head.className = 'ltc-msg-head';
    head.setAttribute('aria-hidden', 'true');
    // Only the assistant gets a mark. A right-aligned pill is already an
    // unambiguous "this is yours"; a second avatar beside it is just noise.
    if (m.role === 'assistant') head.innerHTML = '<span class="ltc-mark">' + AI_MARK + '</span>';

    var body = document.createElement('div');
    body.className = 'ltc-msg-body';
    // Assistant markdown is sanitised; user text is always escaped.
    body.innerHTML = m.role === 'assistant' ? renderMarkdown(m.content) : esc(m.content);
    enhanceTables(body);
    // Math for a settled message: a restored thread, or the turn the reveal has
    // just handed back. User turns are skipped on purpose — their text is
    // escaped rather than markdown, and KaTeX would rewrite a reader's own words
    // ("$5 and $10") into a formula.
    if (m.role === 'assistant') renderMath(body);
    // Fire-and-forget: Mermaid replaces the node's contents with an <svg> once
    // it resolves, so nothing downstream depends on this having finished.
    renderMermaid(body);

    wrap.appendChild(head);
    wrap.appendChild(body);

    if (m.role === 'assistant' && m.content) {
      var actions = document.createElement('div');
      actions.className = 'ltc-msg-actions';
      var copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'ltc-msg-copy';
      copy.setAttribute('data-copy-msg', '');
      copy.setAttribute('aria-label', 'Copy this answer');
      copy.innerHTML = COPY_ICON;
      actions.appendChild(copy);
      wrap.appendChild(actions);
    }

    // A failed turn can still hold real text, so the reason is its own line
    // rather than overwriting the answer.
    if (m.error) {
      var err = document.createElement('div');
      err.className = 'ltc-msg-error';
      err.textContent = m.error;
      wrap.appendChild(err);
    }

    // The soft gate: a third consecutive 429 adds a way to raise the limit. It is
    // an ordinary line in the thread — no modal, no redirect, no disabled input —
    // because waiting out the Retry-After remains a complete answer, and a reader
    // who is never required to log in must never be treated as if they were.
    if (m.gate) {
      var gate = document.createElement('div');
      gate.className = 'ltc-gate';
      var gateText = document.createElement('span');
      gateText.textContent = 'Rate-limited three times running. Waiting a minute works too, or ';
      var gateLink = document.createElement('a');
      gateLink.href = '/api/auth/login';
      gateLink.textContent = 'sign in with GitHub';
      var gateTail = document.createElement('span');
      // The surrounding spaces are load-bearing: these are three sibling inline
      // nodes, so nothing separates them but their own text. Without them the
      // reader gets "too;sign in with GitHubfor a higher limit".
      gateTail.textContent = ' for a higher limit.';
      gate.appendChild(gateText);
      gate.appendChild(gateLink);
      gate.appendChild(gateTail);
      wrap.appendChild(gate);
    }

    // The provider hit its output cap, so the answer ends mid-sentence. A quiet
    // subordinate line, deliberately NOT the error treatment: nothing failed and
    // the answer above is real and copyable, it is only unfinished.
    if (m.truncated) {
      var cut = document.createElement('p');
      cut.className = 'ltc-truncated';
      cut.textContent = 'This answer was cut off — ask me to continue.';
      wrap.appendChild(cut);
    }

    if (m.status === 'error') {
      var retry = document.createElement('button');
      retry.className = 'ltc-retry';
      retry.type = 'button';
      retry.textContent = 'Retry';
      retry.setAttribute('aria-label', 'Ask this question again');
      retry.addEventListener('click', function () { retryLast(index); });
      wrap.appendChild(retry);
    }
    return wrap;
  }

  /**
   * The live assistant bubble, built to be painted into rather than re-rendered.
   *
   * `.ltc-msg-md` holds markdown that is finished and cannot change;
   * `.ltc-msg-tail` holds the sentence currently being typed, as escaped text.
   * Splitting them is what makes a *formatted* answer appear progressively
   * instead of a plain-text wall that snaps into markdown at the end.
   */
  function streamingNode() {
    var wrap = document.createElement('div');
    wrap.className = 'ltc-msg ltc-msg--assistant is-streaming';
    wrap.setAttribute('data-role', 'assistant');
    wrap.setAttribute('aria-label', 'Assistant is answering');

    var head = document.createElement('div');
    head.className = 'ltc-msg-head';
    head.setAttribute('aria-hidden', 'true');
    head.innerHTML = '<span class="ltc-mark ltc-mark--busy">' + AI_MARK + '</span>';

    var body = document.createElement('div');
    body.className = 'ltc-msg-body';
    body.innerHTML =
      '<div class="ltc-msg-md"></div><div class="ltc-msg-tail"></div>'
      + '<span class="ltc-caret" aria-hidden="true"></span>';

    wrap.appendChild(head);
    wrap.appendChild(body);
    return wrap;
  }

  function typingNode() {
    var typing = document.createElement('div');
    typing.className = 'ltc-typing';
    typing.setAttribute('data-typing', '');
    typing.setAttribute('aria-label', 'Thinking');
    typing.innerHTML = '<span></span><span></span><span></span>';
    return typing;
  }

  function emptyState() {
    var entry = currentEntry();
    var kind = pageKind();
    var title = entry ? cleanHeading(entry.item.title) : 'Top Interview 150';

    var badge = '';
    if (entry) {
      var meta = [entry.item.difficulty, entry.category].filter(Boolean).join(' · ');
      badge = '<div class="ltc-empty-badge">' + esc(meta) + '</div>';
    }

    // Per-kind framing. The old copy promised "the algorithm, the complexity, the
    // dry run" on every page, including the behavioural-interview guide where
    // none of those exist.
    var KIND_COPY = {
      problem: 'I have this guide open — ask about any approach, level, or follow-up in it, or point me at another problem.',
      primer: 'I have this primer open — ask me to explain a pitfall or show working JavaScript, or pull up a different topic.',
      guide: 'I have this guide open — ask me to explain a section or turn it into a plan.',
      home: 'Ask me how this manual is organised, what to study first, or anything else.',
    };

    var chips = buildSuggestions()
      .map(function (q) {
        return '<button type="button" class="ltc-chip" data-q="' + esc(q) + '">' + esc(q) + '</button>';
      })
      .join('');

    var empty = document.createElement('div');
    empty.className = 'ltc-empty';
    empty.innerHTML =
      '<div class="ltc-empty-mark" aria-hidden="true">' + AI_MARK + '</div>' +
      '<h2 class="ltc-empty-title">Ask anything</h2>' +
      '<p class="ltc-empty-page">' + esc(title) + '</p>' +
      badge +
      '<p class="ltc-empty-sub">' + esc(KIND_COPY[kind] || KIND_COPY.guide) + '</p>' +
      (chips ? '<div class="ltc-suggestions">' + chips + '</div>' : '');
    return empty;
  }

  /**
   * @param {number} [animateIdx] message index to play the entry animation on.
   *   Undefined everywhere except the moment a question is sent — otherwise a
   *   re-render (thread swap, clear, turn end) would replay the animation on
   *   messages the reader has already read.
   */
  function renderLog(animateIdx) {
    endReveal();
    el.log.textContent = '';

    if (!state.messages.length) {
      el.log.appendChild(emptyState());
      if (state.pinScroll) el.log.scrollTop = el.log.scrollHeight;
      return;
    }

    state.messages.forEach(function (m, i) {
      el.log.appendChild(messageNode(m, i, i === animateIdx));
    });
    if (state.streaming) {
      if (state.reveal && state.reveal.node) {
        // A re-render mid-turn: rebuild the live bubble in place so the reveal
        // continues instead of the answer freezing half-typed.
        var node = streamingNode();
        el.log.appendChild(node);
        armReveal(node.querySelector('.ltc-msg-body'));
      } else {
        el.log.appendChild(typingNode());
      }
    }
    if (state.pinScroll) el.log.scrollTop = el.log.scrollHeight;
  }

  /* ------------------------------------------------------------------ *
   * Reveal engine
   * ------------------------------------------------------------------ */

  /**
   * How much of the revealed text is safe to hand to the markdown renderer.
   *
   * A blank line only ends a block when it is not inside a fenced region: a
   * ``` opened on line 3 and closed on line 20 makes every blank line between
   * them a lie, and rendering there would reflow a code block on every frame.
   * Counting fence markers is cheap and exact, so the renderer is only ever
   * given text whose block structure is settled.
   *
   * Returns the index just past the last settled blank line, or -1 when no block
   * has closed yet.
   */
  function stableSplit(text) {
    var best = -1;
    var fence = null;
    var i = 0;
    while (i < text.length) {
      var nl = text.indexOf('\n', i);
      var line = nl === -1 ? text.slice(i) : text.slice(i, nl);
      var m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (m) {
        var ch = m[1].charAt(0);
        if (fence === null) fence = ch;
        else if (ch === fence) fence = null;
      }
      if (fence === null && nl !== -1 && text.charAt(nl + 1) === '\n') best = nl + 2;
      if (nl === -1) break;
      i = nl + 1;
    }
    return best;
  }

  /**
   * Advance the reveal cursor by at most `budget` chars, preferring a word edge.
   *
   * Landing just past a space is what makes this read as word-by-word rather
   * than as a character cursor chewing through text. The hard cap stops one
   * pathological token from stalling the whole reveal.
   */
  function advance(text, from, budget) {
    if (from >= text.length) return text.length;
    var end = from + budget;
    if (end >= text.length) return text.length;
    var sp = text.indexOf(' ', end);
    if (sp === -1) return text.length;
    if (sp - from > REVEAL_HARD_CHARS) return end;
    return sp + 1;
  }

  /** Bind the live bubble's parts into the reveal state. Idempotent. */
  function armReveal(body) {
    var r = state.reveal || (state.reveal = newReveal());
    if (!body) { r.node = null; return r; }
    r.node = body;
    r.md = body.querySelector('.ltc-msg-md');
    r.tail = body.querySelector('.ltc-msg-tail');
    r.stable = -1; // force the prefix to be rendered on the next paint
    return r;
  }

  function newReveal() {
    return {
      raf: null, last: 0, shown: 0, stable: -1,
      node: null, md: null, tail: null,
      done: false, running: false, onComplete: null, settled: false,
    };
  }

  /**
   * Paint one frame of the reveal.
   *
   * The prefix is re-rendered only when the settled boundary actually moves,
   * which is once per paragraph rather than once per frame; the tail is a single
   * textContent write of a few hundred characters. Returns false when the live
   * bubble has gone (thread cleared, guide switched), which stops the pump
   * instead of painting into a detached node.
   */
  function paintReveal() {
    var last = state.messages[state.messages.length - 1];
    if (!last || last.role !== 'assistant') return false;
    var r = state.reveal;
    if (!r || !r.node || !r.node.isConnected) return false;

    var text = last.content.slice(0, r.shown);
    var split = stableSplit(text);
    if (split !== r.stable) {
      r.stable = split;
      var prefix = split > 0 ? text.slice(0, split) : '';
      r.md.innerHTML = renderMarkdown(prefix);
      enhanceTables(r.md);
      // Math on the PREFIX ONLY, never the tail. This is the whole reason the
      // reveal splits where it does: stableSplit is fence-aware, so a `$…$` pair
      // inside the prefix is already closed and typesets once with nothing left
      // to change — no snap. The tail is escaped text, so a half-typed `$a+b`
      // never reaches KaTeX at all. Deferring math to messageNode() instead was
      // measured to be worse: the prefix re-renders once per paragraph, so
      // every paragraph holding math would show raw LaTeX and snap at turn end.
      renderMath(r.md);
    }
    r.tail.textContent = text.slice(r.stable > 0 ? r.stable : 0);
    if (state.pinScroll) el.log.scrollTop = el.log.scrollHeight;
    return true;
  }

  /**
   * The rAF pump.
   *
   * Idles (unhooks itself) the moment the cursor catches up, so an open chat
   * panel costs nothing between turns; the next delta restarts it.
   *
   * `done` means the network is finished but the reveal is not — that is the
   * normal case for a fast provider, which delivers every frame in a single
   * read. The pump then speeds up to swallow the backlog and calls
   * `onComplete` when it is done, instead of the turn ending and dumping the
   * remainder. That is the whole difference between "typed out" and "here is
   * your answer".
   */
  function pumpReveal() {
    var r = state.reveal;
    if (!r || r.running) return;
    r.running = true;
    r.last = 0;

    var step = function (ts) {
      r.raf = null;
      var last = state.messages[state.messages.length - 1];
      if (!last || last.role !== 'assistant') { r.running = false; return; }

      if (r.shown >= last.content.length) {
        r.running = false;
        // Caught up. Only a finished stream has work left to close out.
        if (r.done && !r.settled) { r.settled = true; if (r.onComplete) r.onComplete(); }
        return;
      }

      if (!r.last) r.last = ts;
      var dt = ts - r.last;
      r.last = ts;

      var budget;
      if (reducedMotion()) {
        budget = last.content.length;
      } else {
        budget = REVEAL_CPS * (dt / 1000);
        // The network can be ahead of the eye: the provider was fast (r.done)
        // or the backlog itself got long. Both sprint, or the tail is a long wait.
        if (r.done) budget *= REVEAL_DRAIN_MULT;
        if (last.content.length - r.shown > REVEAL_SPRINT_AT) budget *= REVEAL_SPRINT_MULT;
        if (budget < 1) budget = 1;
      }
      r.shown = advance(last.content, r.shown, budget);

      if (!paintReveal()) { r.running = false; return; }
      r.raf = requestAnimationFrame(step);
    };

    r.raf = requestAnimationFrame(step);
  }

  /**
   * Hand the turn over to the reveal, and let the reveal hand back the thread.
   *
   * Returns true when the finish was deferred (there is still text to type out),
   * so the caller knows not to render yet.
   */
  function handOffToReveal(finish) {
    var r = state.reveal;
    if (!r || !r.node || r.shown >= state.messages[state.messages.length - 1].content.length) {
      finish();
      return false;
    }
    r.done = true;
    r.onComplete = finish;
    r.settled = false;
    pumpReveal();
    return true;
  }

  /** Stop button during the catch-up phase: skip the rest of the animation. */
  function finishPendingDrain() {
    var r = state.reveal;
    if (!r || r.settled || !r.onComplete) return;
    var last = state.messages[state.messages.length - 1];
    if (last && last.role === 'assistant') {
      r.shown = last.content.length;
      paintReveal();
    }
    r.settled = true;
    var finish = r.onComplete;
    r.onComplete = null;
    finish();
  }

  function endReveal() {
    var r = state.reveal;
    if (!r) return;
    if (r.raf) cancelAnimationFrame(r.raf);
    r.raf = null;
    r.running = false;
    r.node = null;
    r.md = null;
    r.tail = null;
    r.onComplete = null;
    r.settled = true;
  }

  /* ------------------------------------------------------------------ *
   * Streaming client
   * ------------------------------------------------------------------ */

  /**
   * Read an SSE body and hand each `data:` payload to onDelta.
   *
   * Network chunks do not align with SSE frames, so a partial tail is held in
   * `buffer` until its blank-line terminator arrives. The provider may also
   * interleave `: comment` heartbeats, which are ignored by design.
   *
   * `onStatus` receives the route's progress frames ({"status":"..."}). These
   * matter more than they look: a tool round can spend real time in retrieval
   * with no content to show, and the first-token watchdog would otherwise treat
   * that silence as a hang and abort a working request.
   *
   * `onTruncated` receives the route's `{"truncated":true}` frame, which it
   * emits after the last content delta and before [DONE] when the provider
   * stopped on finish_reason === 'length'. The frame is a fact about the turn,
   * not text: it carries no content and must never reach the transcript as any.
   */
  async function readSse(res, onDelta, onDone, onError, onStatus, onTruncated) {
    if (!res.body) {
      onError('This browser cannot read the response stream.');
      return;
    }
    var reader = res.body.getReader();
    var decoder = new TextDecoder('utf-8');
    var buffer = '';
    var sawError = null;

    try {
      for (;;) {
        var step = await reader.read();
        if (step.done) break;
        buffer += decoder.decode(step.value, { stream: true });

        var idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          var frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);

          var dataLines = frame.split('\n').filter(function (l) { return l.indexOf('data:') === 0; });
          if (!dataLines.length) continue; // comment / heartbeat
          var payload = dataLines.map(function (l) { return l.slice(5).trim(); }).join('\n');
          if (payload === '[DONE]') { onDone(sawError); return; }

          var obj;
          try {
            obj = JSON.parse(payload);
          } catch (e) {
            continue; // not JSON — ignore rather than kill the stream
          }
          if (obj && obj.error) { sawError = String(obj.error); continue; }
          if (obj && obj.status) { if (onStatus) onStatus(String(obj.status)); continue; }
          // Before the delta branch, so the flag is read off the frame rather
          // than inferred from a stream that happened to end.
          if (obj && obj.truncated) { if (onTruncated) onTruncated(); continue; }
          var delta = obj && obj.choices && obj.choices[0] && obj.choices[0].delta;
          if (delta && typeof delta.content === 'string' && delta.content) onDelta(delta.content);
        }
      }
      onDone(sawError);
    } catch (e) {
      if (e && e.name === 'AbortError') { onDone(sawError || 'stopped'); return; }
      onError('The connection dropped before the answer finished.');
    }
  }

  function setStreaming(on) {
    state.streaming = on;
    el.input.disabled = on;
    el.send.disabled = on || !el.input.value.trim();
    el.send.setAttribute('data-busy', on ? 'true' : 'false');
    el.send.setAttribute('aria-label', on ? 'Sending' : 'Send message');
    el.stop.hidden = !on;
    el.panel.setAttribute('data-streaming', on ? 'true' : 'false');
    // Driven from JS rather than swapped with a CSS ::after: a visibility:hidden
    // label keeps its box, which stretched the pill across the whole header.
    if (el.statusTxt) el.statusTxt.textContent = on ? (state.statusOverride || 'Thinking') : 'Ready';
    // aria-live + aria-busy is the combination that keeps a screen reader from
    // announcing a word-by-word reveal one word at a time; the finished message
    // is announced when the log leaves the busy state.
    el.log.setAttribute('aria-busy', on ? 'true' : 'false');
    if (!on) {
      state.statusOverride = '';
      endReveal();
    }
  }

  function showStatus(text) {
    state.statusOverride = text;
    if (el.statusTxt) el.statusTxt.textContent = text;
  }

  function failTurn(message, rateLimited) {
    var last = state.messages[state.messages.length - 1];
    if (last && last.role === 'assistant') {
      last.status = 'error';
      last.error = message;
      if (rateLimited) last.gate = true;
    } else {
      var failed = { role: 'assistant', content: '', error: message, ts: nowLabel(), status: 'error' };
      if (rateLimited) failed.gate = true;
      state.messages.push(failed);
    }
    saveStore();
    renderLog();
  }

  /** Swap the "thinking" dots for the live assistant bubble. */
  function mountStreamingBubble() {
    var typing = el.log.querySelector('[data-typing]');
    var node = streamingNode();
    if (typing) el.log.replaceChild(node, typing);
    else el.log.appendChild(node);
    state.reveal = newReveal();
    armReveal(node.querySelector('.ltc-msg-body'));
    if (state.pinScroll) el.log.scrollTop = el.log.scrollHeight;
  }

  async function send(text) {
    var userText = String(text == null ? el.input.value : text).trim();
    if (!userText || state.streaming) return;

    clearTimeout(state.firstTokenTimer);

    state.messages.push({ role: 'user', content: userText, ts: nowLabel() });
    var userIndex = state.messages.length - 1;
    el.input.value = '';
    autoGrow();
    setStreaming(true);
    state.reveal = newReveal();
    renderLog(userIndex);
    if (state.pinScroll) el.log.scrollTop = el.log.scrollHeight;

    var assistantMsg = { role: 'assistant', content: '', ts: nowLabel() };
    state.messages.push(assistantMsg);

    state.controller = new AbortController();

    // First-token watchdog: distinguishes "slow model" from "hung connection".
    state.firstTokenTimer = setTimeout(function () {
      if (!assistantMsg.content) {
        try { state.controller.abort(); } catch (e) { /* ignore */ }
        setStreaming(false);
        failTurn('The assistant did not respond in time. Please try again.');
      }
    }, FIRST_TOKEN_TIMEOUT_MS);

    // Snapshot the outgoing history BEFORE the assistant placeholder is pushed.
    // Including that empty turn would make it the last message, and the route
    // requires the final message to be a non-empty user turn.
    var outgoing = state.messages
      .filter(function (m) {
        return m.status !== 'error' && typeof m.content === 'string' && m.content.trim() !== '';
      })
      .map(function (m) { return { role: m.role, content: m.content }; });

    var payload = {
      messages: outgoing,
      pageContext: extractPageContext(),
      pageTitle: state.articleTitle,
      pageCategory: currentCategory(),
    };

    try {
      var res = await fetch(API_BASE + '/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload),
        signal: state.controller.signal,
      });

      if (!res.ok) {
        var detail = null;
        try { detail = (await res.json()) || {}; } catch (e) { /* non-JSON error body */ }
        if (res.status === 429) {
          // The message is unchanged and still the primary response. The sign-in
          // line is an *addition* from the third 429 of a burst onward, because a
          // session raises the limit rather than unlocking anything (D-10).
          var limited = new Error('You are sending messages too quickly. Wait a moment and retry.');
          limited.rateLimited = noteRateLimited();
          throw limited;
        }
        if (res.status === 403) throw new Error('This assistant is not available from this origin.');
        if (res.status === 503) throw new Error('The assistant is not configured on this deployment.');
        throw new Error((detail && detail.error) || 'The assistant is unavailable (HTTP ' + res.status + ').');
      }

      // This turn got past the limiter, so any rate-limit streak is over.
      noteTurnAllowed();

      var first = true;
      var wasTruncated = false;
      await readSse(
        res,
        function (chunk) {
          if (first) { first = false; clearTimeout(state.firstTokenTimer); }
          assistantMsg.content += chunk;
          // The bubble appears with the first token, not before it: no empty
          // card sitting there pretending to be an answer.
          if (!state.reveal.node) mountStreamingBubble();
          if (reducedMotion()) {
            state.reveal.shown = assistantMsg.content.length;
            state.reveal.done = true;
            paintReveal();
          } else {
            pumpReveal();
          }
        },
        function (streamError) {
          clearTimeout(state.firstTokenTimer);
          if (streamError === 'stopped') {
            // User pressed Stop. Keep whatever arrived, drop the empty turn.
            if (!assistantMsg.content) state.messages.pop();
          } else if (streamError) {
            setStreaming(false);
            failTurn(streamError);
            return;
          } else if (!assistantMsg.content) {
            state.messages.pop();
            setStreaming(false);
            failTurn('The assistant returned an empty answer.');
            return;
          }
          // The turn is not over until the text has been read out. Handing the
          // finish to the reveal is what keeps a fast provider from collapsing
          // the answer into a single jump at [DONE].
          handOffToReveal(function () {
            // Set here rather than on the frame, so a turn that errored or was
            // stopped never grows the flag, and so it is on the message before
            // saveStore() — the restore path has nothing special to do for it.
            if (wasTruncated) assistantMsg.truncated = true;
            setStreaming(false);
            saveStore();
            renderLog();
          });
        },
        function (message) {
          clearTimeout(state.firstTokenTimer);
          setStreaming(false);
          failTurn(message);
        },
        function (status) {
          // A tool is running. This is proof the request is alive, so stand the
          // watchdog down — otherwise a slow retrieval reads as a hang and we
          // abort a request that was about to succeed.
          clearTimeout(state.firstTokenTimer);
          state.firstTokenTimer = null;
          showStatus(status);
        },
        function () {
          // Latched, not rendered: the bubble is still the live streaming one,
          // and the notice belongs on the settled message the reveal hands back.
          wasTruncated = true;
        },
      );
    } catch (e) {
      clearTimeout(state.firstTokenTimer);
      var aborted = e && e.name === 'AbortError';
      if (aborted) {
        // Stop was pressed while the request was still in flight, so the
        // rejection arrives here instead of inside readSse. The UI must still
        // be released, and an empty turn must not linger.
        if (!assistantMsg.content) state.messages.pop();
        setStreaming(false);
        saveStore();
        renderLog();
      } else if (assistantMsg.content) {
        assistantMsg.status = 'error';
        assistantMsg.error = e && e.message ? e.message : 'The response stream was interrupted.';
        setStreaming(false);
        saveStore();
        renderLog();
      } else {
        setStreaming(false);
        failTurn(e && e.message ? e.message : 'Could not reach the assistant.', !!(e && e.rateLimited));
      }
    } finally {
      state.controller = null;
      el.input.focus();
    }
  }

  function stop() {
    if (state.controller) {
      clearTimeout(state.firstTokenTimer);
      try { state.controller.abort(); } catch (e) { /* ignore */ }
      return;
    }
    // No request in flight, so the stream is already complete and the pump is
    // only catching up on the reveal. Stop means "show me the rest".
    finishPendingDrain();
  }

  /** Re-send the question that produced the last errored turn. */
  function retryLast(errorIndex) {
    for (var i = errorIndex - 1; i >= 0; i--) {
      if (state.messages[i] && state.messages[i].role === 'user') {
        var q = state.messages[i].content;
        state.messages = state.messages.slice(0, i);
        renderLog();
        send(q);
        return;
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * Open / close
   * ------------------------------------------------------------------ */

  function isSheet() {
    return window.matchMedia('(max-width: 1023px)').matches;
  }

  function open() {
    if (state.open) return;
    state.lastFocus = document.activeElement;
    syncArticle(true);
    state.open = true;
    state.pinScroll = true;
    el.panel.classList.add('is-open');
    el.panel.removeAttribute('aria-hidden');
    el.fab.setAttribute('aria-expanded', 'true');
    el.fab.classList.add('is-tucked');
    el.fab.setAttribute('aria-hidden', 'true');
    if (el.backdrop) el.backdrop.classList.add('is-open');
    renderLog();
    el.input.focus();
  }

  function close() {
    if (!state.open) return;
    state.open = false;
    el.panel.classList.remove('is-open');
    el.panel.setAttribute('aria-hidden', 'true');
    el.fab.setAttribute('aria-expanded', 'false');
    el.fab.classList.remove('is-tucked');
    el.fab.removeAttribute('aria-hidden');
    if (el.backdrop) el.backdrop.classList.remove('is-open');
    if (state.lastFocus && state.lastFocus.focus) state.lastFocus.focus();
  }

  function toggle() {
    if (state.open) close();
    else open();
  }

  /**
   * Keep the thread, the header label and the suggestions in step with the open
   * article. `force` reloads from storage; otherwise we only switch when the id
   * changed.
   */
  function syncArticle(force) {
    var id = currentArticleId();
    if (!force && id === state.articleId) return;
    var wasStreaming = state.streaming;
    if (wasStreaming) stop();
    state.articleId = id;
    state.articleTitle = currentTitle();
    if (el.panelTitle) el.panelTitle.textContent = state.articleTitle;
    if (el.panel) el.panel.setAttribute('data-context', id);
    loadForArticle(id);
    // Unconditional: on desktop the panel is permanently visible and `open()`
    // never runs, so gating this on state.open would leave the previous
    // guide's thread on screen after navigating.
    renderLog();
  }

  /** Tab cycling stays inside the sheet while it is a modal surface. */
  function trapFocus(e) {
    if (e.key !== 'Tab' || !isSheet() || !state.open) return;
    var focusables = el.panel.querySelectorAll(
      'a[href]:not([hidden]), button:not([disabled]):not([hidden]), '
      + 'textarea:not([disabled]):not([hidden]), input:not([disabled]):not([hidden]), '
      + '[tabindex]:not([tabindex="-1"]):not([hidden])',
    );
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /* ------------------------------------------------------------------ *
   * Composer
   * ------------------------------------------------------------------ */

  /** Grow the textarea with the question, up to a cap, then scroll. */
  function autoGrow() {
    var box = el.input;
    box.style.height = 'auto';
    box.style.height = Math.min(box.scrollHeight, COMPOSER_MAX_H) + 'px';
    box.style.overflowY = box.scrollHeight > COMPOSER_MAX_H ? 'auto' : 'hidden';
  }

  function updateScrollDown() {
    if (!el.scrollDown) return;
    var gap = el.log.scrollHeight - el.log.scrollTop - el.log.clientHeight;
    el.scrollDown.classList.toggle('is-shown', gap > AUTOSCROLL_SLACK * 4);
  }

  /* ------------------------------------------------------------------ *
   * Wiring
   * ------------------------------------------------------------------ */

  function init() {
    el.panel = $('ltcPanel');
    el.fab = $('ltcFab');
    el.backdrop = $('ltcBackdrop');
    el.log = $('ltcLog');
    el.form = $('ltcForm');
    el.input = $('ltcInput');
    el.send = $('ltcSend');
    el.stop = $('ltcStop');
    el.panelTitle = $('ltcPanelTitle');
    el.statusTxt = $('ltcStatusTxt');
    el.scrollDown = $('ltcScrollDown');
    el.clearAll = $('ltcClearAll');
    if (!el.panel || !el.fab || !el.log || !el.form || !el.input || !el.send) return;

    // On desktop the panel is always visible, so `open()` never runs there. The
    // initial render has to happen here or the log would sit empty until the
    // reader resized the window down and back.
    state.articleId = currentArticleId();
    state.articleTitle = currentTitle();
    el.panelTitle.textContent = state.articleTitle;
    el.panel.setAttribute('data-context', state.articleId);
    loadForArticle(state.articleId);
    renderLog();

    el.fab.addEventListener('click', toggle);
    $('ltcClose').addEventListener('click', close);
    $('ltcClear').addEventListener('click', clearCurrent);
    if (el.clearAll) el.clearAll.addEventListener('click', clearAllChats);
    el.stop.addEventListener('click', stop);
    if (el.backdrop) el.backdrop.addEventListener('click', close);
    if (el.scrollDown) {
      el.scrollDown.addEventListener('click', function () {
        state.pinScroll = true;
        el.log.scrollTo({ top: el.log.scrollHeight, behavior: reducedMotion() ? 'auto' : 'smooth' });
        updateScrollDown();
      });
    }

    el.form.addEventListener('submit', function (e) {
      e.preventDefault();
      send();
    });

    el.input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });

    el.input.addEventListener('input', function () {
      el.send.disabled = state.streaming || !el.input.value.trim();
      autoGrow();
    });

    // Escape belongs to the chat while it is open, so stop it reaching the
    // portal's own palette/sidebar Escape handler on the same document.
    el.panel.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (!isSheet()) return;
        e.stopPropagation();
        if (state.streaming) stop();
        close();
        return;
      }
      trapFocus(e);
    });

    // Delegated: copy buttons, empty-state suggestions, and retry all live
    // inside log markup, so per-node listeners would be lost on re-render.
    el.log.addEventListener('click', async function (e) {
      var chip = e.target.closest('[data-q]');
      if (chip) {
        open();
        send(chip.getAttribute('data-q'));
        return;
      }
      var copy = e.target.closest('[data-copy]');
      if (copy) {
        var pre = copy.parentElement && copy.parentElement.querySelector('code');
        if (!pre) return;
        var ok = await copyText(pre.textContent);
        flash(copy, ok ? 'Copied' : 'Failed');
        return;
      }
      var copyMsg = e.target.closest('[data-copy-msg]');
      if (copyMsg) {
        var wrap = copyMsg.closest('.ltc-msg');
        var body = wrap && wrap.querySelector('.ltc-msg-body');
        if (!body) return;
        var okMsg = await copyText(body.innerText.trim());
        flash(copyMsg, okMsg ? 'Copied' : 'Failed');
      }
    });

    // Stop following the stream when the reader scrolls up to re-read something.
    el.log.addEventListener('scroll', function () {
      var gap = el.log.scrollHeight - el.log.scrollTop - el.log.clientHeight;
      state.pinScroll = gap < AUTOSCROLL_SLACK;
      updateScrollDown();
    }, { passive: true });

    // The portal dispatches this from openArticle(); DOM re-read is the source of
    // truth, so a missed event only costs a stale header label.
    document.addEventListener('lt150:article', function () { syncArticle(false); });

    // The portal reads location.hash only at boot, so a hash-only URL change
    // (pasted link, hand-edited address bar, back/forward between articles)
    // navigates nothing. Listening anyway costs one line and keeps this
    // widget's promise — suggestions drawn from the page in front of you —
    // true the moment the portal does catch up.
    window.addEventListener('hashchange', function () { syncArticle(false); });

    // Shrinking from desktop panel to mobile sheet: drop the trap, not the state.
    window.addEventListener('resize', function () { if (!isSheet()) el.input.blur(); });

    el.send.disabled = true;
    autoGrow();
    el.panel.setAttribute('aria-hidden', 'true');
  }

  /** Swap an icon button to a text confirmation, then back. */
  function flash(btn, label) {
    var icon = btn.innerHTML;
    btn.textContent = label;
    btn.classList.add('is-done');
    setTimeout(function () {
      btn.innerHTML = icon;
      btn.classList.remove('is-done');
    }, 1400);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        ta.remove();
        return ok;
      } catch (e2) {
        return false;
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /** Single deliberate global — the seam tests and the console use. */
  window.LtChat = {
    open: open,
    close: close,
    toggle: toggle,
    clear: clearCurrent,
    clearAll: clearAllChats,
    send: send,
    stop: stop,
    extractPageContext: extractPageContext,
    currentArticleId: currentArticleId,
    // Exposed only so tests can drive it with a synthetic ReadableStream:
    // Playwright's route mocks fulfil in one shot and cannot fragment a
    // response, so this is the only way to reach the chunk-boundary handling.
    readSse: readSse,
    // Reveal internals, for the pacing tests. `stableSplit` in particular is a
    // pure function worth asserting directly: it is what keeps a half-written
    // code fence from reflowing on every frame.
    stableSplit: stableSplit,
    advance: advance,
    suggestions: buildSuggestions,
    pageKind: pageKind,
    state: state,
  };
})();

/**
 * POST /api/chat — context-aware streaming chat proxy.
 *
 * The browser never sees OPENAI_API_KEY. This route is the only place the
 * provider is called, and it enforces, in order:
 *
 *   405  method guard
 *   403  origin / referer allowlist
 *   429  rate limit (Upstash sliding window + in-memory floor)
 *   400  malformed body, oversized payload, or no question to answer
 *   503  provider not configured
 *   502  provider refused or returned non-2xx
 *   504  provider timed out before the first byte
 *   200  text/event-stream — upstream OpenAI SSE forwarded byte-for-byte
 *
 * Stream contract: after the SSE headers are written, the ONLY thing that can
 * follow is SSE. A mid-stream failure emits a synthetic
 * `data: {"error": "..."}` frame and then `data: [DONE]` — never a bare JSON
 * body, which would corrupt the client's parser (improvements-doc §3.3).
 */

import { buildChatRequest, DEFAULT_MODEL } from './_lib/chat-prompt.mjs';
import { checkOrigin, rateLimit, clientIp, allowedOrigins, SIGNED_IN_RATE_LIMIT, DAILY_RATE_LIMIT, DAILY_RATE_WINDOW_MS, DAY_PREFIX } from './_lib/chat-security.mjs';
import { MAX_COMPLETION_TOKENS, MAX_TOOL_ROUNDS, MAX_TOOL_RESULT_TOKENS, completionParams, unknownModelHint } from './_lib/chat-tokens.mjs';
import { availableTools, createToolBudget, runTool } from './_lib/chat-tools.mjs';
import { getSession } from './_lib/session.mjs';

/** Vercel platform limit for this function. Streaming needs headroom. */
export const maxDuration = 60;

/** Hard ceiling on the request body. Guides can be long; this is generous. */
const MAX_BODY_BYTES = 256 * 1024;
/** Default provider endpoint (overridable for OpenAI-compatible providers). */
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
/** Total wall-clock guard, kept under maxDuration so we can still write a tail frame. */
const TOTAL_BUDGET_MS = (maxDuration - 8) * 1000;
/** How often to emit an SSE comment while the provider is silent (keeps proxies from cutting us). */
const HEARTBEAT_MS = 10_000;
/**
 * Wall-clock to keep in reserve before starting another tool round.
 *
 * A tool round costs one model turn plus the tool itself — and web_search can
 * spend 8s alone. Starting a round that cannot finish inside maxDuration means
 * the reader gets "Response exceeded the time limit" instead of an answer, which
 * is the worst possible outcome: they lose the answer AND the wait. The model
 * cannot see the remaining budget, so the route has to refuse on its behalf and
 * spend what is left on prose. Overridable for tests, and read per request
 * rather than at import so a test can set it after this module is loaded.
 */
function toolRoundReserveMs() {
  const n = Number.parseInt(String(process.env.CHAT_TOOL_RESERVE_MS ?? ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : 15_000;
}

/**
 * Wall-clock to wait for a turn's FIRST upstream payload before declaring the
 * draw a loss.
 *
 * AI_MODEL=auto rotates per request, so a retry is a fresh sample of the pool:
 * a slow model is a model to abandon, not a fault to report. The provider client
 * allows one call 30s, more than half the total budget, so a single unlucky draw
 * used to end the turn with "Response exceeded the time limit" while the model
 * was still working — the reader lost both the answer and the wait. Bounding the
 * wait for the FIRST payload instead makes a bad draw cost ~10s and a retry ~3s.
 *
 * Only the first payload: once a turn is streaming, a long generation is the
 * point rather than a fault. Read per request, like the tool reserve above.
 */
function firstTokenMs() {
  const n = Number.parseInt(String(process.env.CHAT_FIRST_TOKEN_MS ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 10_000;
}

/**
 * How many extra draws to spend re-rolling a slow model.
 *
 * One. A second retry means two slow draws in a row, and a prompt "please retry"
 * beats a third wait. The allowance is only ever spent by turns that were
 * actually slow, so a turn that answers promptly never touches it.
 */
function slowRetries() {
  const n = Number.parseInt(String(process.env.CHAT_SLOW_RETRIES ?? ''), 10);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

/**
 * Identity of a tool call, for recognising one the model has already had served.
 *
 * Keys are sorted so `{"query":"x","limit":3}` and `{"limit":3,"query":"x"}` are
 * the same call — a model re-issuing a lookup rarely reproduces key order, and a
 * guard that missed on ordering alone would not catch the case it exists for.
 * Values are left exactly as sent: two genuinely different queries that differ
 * only in case are two lookups, and quietly merging them would hide a source.
 */
export function toolSignature(name, args) {
  const stable = (v) => {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === 'object') {
      return Object.keys(v).sort().reduce((out, k) => { out[k] = stable(v[k]); return out; }, {});
    }
    return v;
  };
  try {
    return `${name}:${JSON.stringify(stable(args))}`;
  } catch {
    // A circular or otherwise unserialisable argument set cannot be compared, so
    // it is treated as its own call rather than guessed at.
    return `${name}:${String(args)}`;
  }
}

let clientPromise;

function providerClient() {
  if (clientPromise === undefined) {
    clientPromise = (async () => {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return null;
      const { default: OpenAI } = await import('openai');
      return new OpenAI({
        apiKey,
        baseURL: process.env.AI_BASE_URL || DEFAULT_BASE_URL,
        maxRetries: 1,
        timeout: 30_000,
      });
    })().catch(() => null);
  }
  return clientPromise;
}

/**
 * Test seam: drop the memoised provider client.
 *
 * The memo is correct in production (env is immutable per instance) but it would
 * otherwise let one request's client outlive a change to OPENAI_API_KEY, which
 * makes the 503-unconfigured path untestable.
 */
export function resetProviderClient() {
  clientPromise = undefined;
}

function readBody(req) {
  const body = req.body;
  if (typeof body === 'string') {
    try {
      return { ok: true, value: JSON.parse(body) };
    } catch {
      return { ok: false };
    }
  }
  if (body && typeof body === 'object') return { ok: true, value: body };
  return { ok: false };
}

/** Single-line JSON log — Vercel's log viewer renders these cleanly. */
function log(event, fields) {
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...fields }));
}

/** Write one SSE frame. */
function sse(res, obj) {
  if (res.writableEnded) return;
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

/**
 * Get a byte stream of SSE payload lines out of the provider's `Stream`.
 *
 * `openai@7` returns a `Stream` — it is async-iterable but has no `.body`.
 * `toReadableStream()` is the byte-level path, which is what we need: the
 * async-iterator path yields already-parsed objects and would give up the
 * ability to emit a heartbeat while the provider is silent.
 *
 * The generator fallback keeps this working if the SDK's shape changes, so a
 * version bump degrades to a slower path rather than a crash.
 */
function payloadStream(upstream) {
  if (typeof upstream?.toReadableStream === 'function') return upstream.toReadableStream();
  const enc = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of upstream) {
          controller.enqueue(enc.encode(`${JSON.stringify(chunk)}\n`));
        }
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });
}

// Note: upstream frames are forwarded byte-for-byte (the client parses deltas),
// so there is deliberately no server-side SSE parser here. Mid-stream failures
// are the only frames this function synthesises.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const originCheck = checkOrigin(req, { allowlist: allowedOrigins() });
  if (!originCheck.ok) {
    log('chat.origin_rejected', { origin: originCheck.origin });
    return res.status(403).json({ error: 'Forbidden' });
  }

  const ip = clientIp(req);
  const startedAt = Date.now();
  // A session RAISES the limit, it never gates it (D-6 amends abuse handling
  // only). There is deliberately no 401 path: getSession returns null for an
  // anonymous caller — or whenever SESSION_SECRET is unset — and such a
  // request is metered exactly as it was before this existed.
  const session = getSession(req);
  const ipLimit = await rateLimit(`chat:${ip}`);
  // The daily budget is a per-IP COST bound, so it applies to everyone — a
  // session raises the per-minute allowance, it does not buy unlimited spend.
  // It is charged before the per-minute decision so a reader who is out of
  // daily budget is told so, and it shares the 429 contract exactly.
  const dayLimit = await rateLimit(`chat:${ip}`, {
    limit: DAILY_RATE_LIMIT,
    windowMs: DAILY_RATE_WINDOW_MS,
    prefix: DAY_PREFIX,
  });
  // Always consumed, even when it does not decide, so toggling the cookie
  // cannot hand out a fresh per-IP budget.
  const userLimit = session
    ? await rateLimit(`chat:u:${session.githubId}`, { limit: SIGNED_IN_RATE_LIMIT })
    : null;
  // Which bucket DECIDES. With an identity, the identity decides the per-minute
  // question: that is the whole point, since everyone behind one NAT otherwise
  // shares a single 5/min budget and one reader's rate is everyone else's
  // outage. The daily budget is NOT overridable by an identity — it is the
  // provider-spend bound. Without an identity, the IP bucket decides,
  // byte-for-byte as before.
  const tripped = !dayLimit.ok
    ? { ...dayLimit, bucket: 'day' }
    : session
      ? (userLimit && !userLimit.ok ? { ...userLimit, bucket: 'user' } : null)
      : (!ipLimit.ok ? { ...ipLimit, bucket: 'ip' } : null);
  if (tripped) {
    const retryAfter = Math.max(1, Math.ceil((tripped.reset - Date.now()) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    log('chat.rate_limited', {
      ip,
      scope: tripped.scope,
      bucket: tripped.bucket,
      login: session?.login || null,
    });
    return res.status(429).json({ error: 'Too many requests. Please slow down.' });
  }

  const raw = readBody(req);
  if (!raw.ok) return res.status(400).json({ error: 'Invalid JSON body' });
  if (Buffer.byteLength(JSON.stringify(raw.value ?? {}), 'utf8') > MAX_BODY_BYTES) {
    return res.status(400).json({ error: 'Request body too large' });
  }

  const { messages, pageContext, pageTitle, pageCategory } = raw.value || {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages must be a non-empty array' });
  }
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user' || typeof last.content !== 'string' || !last.content.trim()) {
    return res.status(400).json({ error: 'Last message must be a non-empty user message' });
  }

  const model = process.env.AI_MODEL || DEFAULT_MODEL;
  const client = await providerClient();
  if (!client) {
    log('chat.unconfigured', { ip });
    return res.status(503).json({ error: 'Chat is not configured' });
  }

  let prepared;
  const tools = availableTools();
  try {
    prepared = await buildChatRequest({
      context: typeof pageContext === 'string' ? pageContext : '',
      title: typeof pageTitle === 'string' ? pageTitle : '',
      category: typeof pageCategory === 'string' ? pageCategory : '',
      history: messages,
      model,
      tools,
    });
  } catch (e) {
    log('chat.prompt_build_failed', { ip, error: String(e?.message || e) });
    return res.status(400).json({ error: 'Could not assemble the request' });
  }

  // Stream is authoritative only from here on: no JSON responses past this line.
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // Nginx (Vercel front proxy) buffers by default, which would defeat streaming.
  res.setHeader('X-Accel-Buffering', 'no');
  res.status(200);
  res.flushHeaders?.();

  const upstreamAbort = new AbortController();
  // If the client walks away (Stop button, tab close), don't keep paying for it.
  req.on?.('close', () => upstreamAbort.abort());

  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const budget = createToolBudget();
  /**
   * Signatures of the lookups that have already produced a result for THIS
   * question.
   *
   * Scoped to the request, so the next question searches freely. A model that
   * re-issues a lookup it already has is not making new information appear — it
   * is spending a real search and a slice of the round budget to fetch a result
   * that is already in its context, and on a rotating pool that is also a fresh
   * chance to draw a slow model. Observed doing exactly this: two identical
   * `search_guides` calls in one turn, which is how a turn reached 57s and died.
   */
  const servedTools = new Set();
  // The conversation is mutable across rounds: system + history, then assistant
  // tool_calls turns and tool results appended as they happen. The system prompt
  // stays at index 0 for the whole exchange, so page scope is retained no matter
  // how many tools run.
  const conversation = [{ role: 'system', content: prepared.system }, ...prepared.messages];
  const stats = { rounds: 0, toolCalls: 0, toolsUsed: [], finishReason: null };
  let lastBeat = Date.now();
  // Whether the reader's FINAL answer is incomplete. Owned by the loop rather
  // than by a turn, because it must describe the last round only: a tool round
  // that ended on `tool_calls` must not leave a stale flag behind.
  let truncatedAnswer = false;

  /**
   * Read one upstream turn to completion.
   *
   * The subtle part is what reaches the browser. Upstream frames are forwarded
   * byte-for-byte (the client parses deltas), but a tool-call turn must leak
   * NOTHING: its frames are the model deciding to call a tool, which is internal
   * machinery, and the arguments are half-written JSON mid-stream. So each
   * payload is inspected before forwarding:
   *
   *   - a `delta.tool_calls` payload is accumulated and never forwarded;
   *   - a `delta.content` payload releases the turn, then is forwarded verbatim;
   *   - anything else is forwarded only once the turn is already released.
   *
   * A pure tool turn therefore emits no content at all, and the tool loop can
   * run without the browser ever seeing a fragment of it.
   */
  /**
   * Read one upstream turn, under a signal that dies with THIS attempt.
   *
   * `upstreamAbort` means "the reader went away" and cancelling it would end the
   * turn for everyone, so a slow draw needs its own controller: linked to the
   * global so a disconnect still cancels, but independently cancellable so the
   * caller can re-roll. Linked by hand rather than AbortSignal.any, which is
   * Node 20.3+ while this project's floor is Node 20.
   */
  async function runTurn({ toolChoice }) {
    const attemptAbort = new AbortController();
    const onReaderGone = () => attemptAbort.abort();
    upstreamAbort.signal.addEventListener('abort', onReaderGone, { once: true });
    try {
      return await streamTurn(toolChoice, attemptAbort);
    } finally {
      upstreamAbort.signal.removeEventListener('abort', onReaderGone);
    }
  }

  async function streamTurn(toolChoice, attemptAbort) {
    const turnStartedAt = Date.now();
    /** Set by the first upstream payload of any kind; arms the first-token clock off. */
    let sawPayload = false;
    let upstream;
    try {
      upstream = await client.chat.completions.create(
        {
          model,
          ...completionParams(model),
          stream: true,
          messages: conversation,
          ...(tools.length ? { tools, tool_choice: toolChoice } : {}),
        },
        { signal: attemptAbort.signal },
      );
    } catch (e) {
      const aborted = upstreamAbort.signal.aborted || e?.name === 'AbortError';
      // The client is gone: nothing to write to.
      if (aborted) return { gone: true };
      const timedOut = e?.code === 'ETIMEDOUT' || /timeout/i.test(String(e?.message || ''));
      // A 400 here is almost always a parameter the chosen model does not accept,
      // not a transient fault. The reason goes to the log — never to the reader —
      // because "unsupported parameter: max_tokens" names the env var to change;
      // the reader only needs to be told to retry.
      log('chat.upstream_failed', {
        ip,
        round: stats.rounds + 1,
        error: String(e?.message || e),
        timedOut,
        ...(e?.status === 400 ? { hint: unknownModelHint(model) } : {}),
      });
      sse(res, { error: timedOut ? 'The assistant took too long to respond. Please retry.' : 'The assistant is unavailable right now. Please retry.' });
      res.write('data: [DONE]\n\n');
      res.end();
      return { gone: true };
    }

    /** index -> { id, name, args } accumulated across deltas. */
    const calls = new Map();
    let released = false;
    // Upstream says how a turn ended on its LAST payload line. `length` means the
    // model hit the completion ceiling mid-sentence — the text is good, it just
    // stops. Unread, that is indistinguishable from a finished answer, both to
    // the reader and to us: no affordance, no log field, no measurable rate.
    let finishReason = null;

    try {
      const reader = payloadStream(upstream).getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      // read-with-heartbeat: while the provider is silent we must still be able
      // to emit an SSE comment and notice our own deadline, so race the read
      // against a timer rather than blocking on read() indefinitely.
      for (;;) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          sse(res, { error: 'Response exceeded the time limit.' });
          return { gone: false, cut: true, calls };
        }
        // The read is raced against a heartbeat timer so a silent provider can
        // still be pinged and our own deadline noticed. While the first payload
        // is still outstanding the race also has to wake no later than the
        // first-token window, or a slow draw is noticed a whole beat late; after
        // that it is a plain heartbeat, because a long stream is the point.
        // Promise.race awaits ONE side, so the loser's timer is left armed — one
        // per chunk, hundreds per stream, each holding the event loop open long
        // after res.end(). Bind the handle and drop it on every way out of the
        // body: read wins, timeout wins, break, return, or throw.
        const waitMs = sawPayload
          ? HEARTBEAT_MS
          : Math.max(250, Math.min(HEARTBEAT_MS, firstTokenMs() - (Date.now() - turnStartedAt)));
        let step;
        let beat = null;
        try {
          step = await Promise.race([
            reader.read(),
            new Promise((r) => { beat = setTimeout(() => r({ timeout: true }), waitMs); }),
          ]);
        } finally {
          clearTimeout(beat);
        }

        if (step.timeout) {
          if (Date.now() - lastBeat >= HEARTBEAT_MS) {
            if (!res.writableEnded) res.write(': ping\n\n');
            lastBeat = Date.now();
          }
          // First-token window spent with nothing upstream: this draw is slow,
          // so hand control back and let the caller re-roll. A retry is safe
          // here precisely because nothing was forwarded — a tool-call turn
          // leaks nothing by contract, and a content turn has not produced its
          // first delta — so the replacement cannot duplicate a single byte.
          if (!sawPayload && Date.now() - turnStartedAt >= firstTokenMs()) {
            attemptAbort.abort();
            return { gone: false, slow: true, waitedMs: Date.now() - turnStartedAt };
          }
          continue;
        }

        if (step.done) break;
        if (upstreamAbort.signal.aborted) return { gone: true, calls };
        sawPayload = true;

        buffer += decoder.decode(step.value, { stream: true });
        // The SDK hands us newline-terminated SSE *payload* lines with the `data:`
        // prefix already stripped and [DONE] consumed, so re-frame each complete
        // line. A partial trailing line stays buffered until its newline arrives.
        let nl;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (line === '' || res.writableEnded) continue;

          if (line.startsWith(':')) { res.write(`${line}\n\n`); continue; }

          let parsed = null;
          try { parsed = JSON.parse(line); } catch { parsed = null; }
          const choice = parsed?.choices?.[0];
          // Last writer wins: the terminal chunk is the one that carries it.
          if (typeof choice?.finish_reason === 'string' && choice.finish_reason) {
            finishReason = choice.finish_reason;
          }
          const delta = choice?.delta;

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const i = Number.isInteger(tc.index) ? tc.index : 0;
              const slot = calls.get(i) || { id: null, name: '', args: '' };
              if (tc.id) slot.id = tc.id;
              if (tc.function?.name) slot.name = tc.function.name;
              if (typeof tc.function?.arguments === 'string') slot.args += tc.function.arguments;
              calls.set(i, slot);
            }
            continue; // never forwarded
          }

          if (typeof delta?.content === 'string' && delta.content) released = true;
          if (released) res.write(`data: ${line}\n\n`);
        }
      }
    } catch (e) {
      // An attempt-scoped abort while the reader is still attached is a slow
      // draw that lost the race to its own deadline, not a broken stream. It
      // must reach the caller as `slow` so the turn can be re-rolled; reporting
      // it as an interruption would spend the reader's turn on a model that was
      // merely slow.
      if (attemptAbort.signal.aborted && !upstreamAbort.signal.aborted) {
        return { gone: false, slow: true, waitedMs: Date.now() - turnStartedAt };
      }
      if (!upstreamAbort.signal.aborted) {
        log('chat.stream_error', { ip, error: String(e?.message || e) });
        sse(res, { error: 'The response stream was interrupted.' });
        return { gone: false, cut: true, calls };
      }
      return { gone: true, calls };
    }

    return {
      gone: false,
      cut: false,
      // NOT the same thing as `cut`, which is the internal deadline flag. A
      // length-truncated turn is a real answer that ran out of room; a cut turn
      // got the "exceeded the time limit" error frame and is not the reader's
      // to continue. Conflating them would tell a reader to "ask me to continue"
      // for a turn that was already refused.
      truncated: finishReason === 'length',
      finishReason,
      calls: [...calls.values()].filter((c) => c.name),
    };
  }

  try {
    let slowDraws = 0;
    for (;;) {
      let turn = await runTurn({ toolChoice: 'auto' });
      // A slow draw is a model to abandon, not a turn to report. With
      // AI_MODEL=auto rotating per request the next call is a different model,
      // so re-roll while there is still budget to spend on one. Counted only
      // once a turn has actually been slow, so a turn that answers promptly
      // never touches the allowance.
      while (turn.slow) {
        slowDraws++;
        log('chat.slow_draw', {
          ip,
          draw: slowDraws,
          waitedMs: turn.waitedMs,
          msLeft: deadline - Date.now(),
        });
        if (slowDraws > slowRetries() || deadline - Date.now() < toolRoundReserveMs()) {
          // The same reserve the tool loop uses: a re-roll needs room for a
          // first token plus a generation, and a reader is better served by a
          // prompt retry than by a wait we already know will not land.
          truncatedAnswer = false;
          sse(res, { error: 'The assistant took too long to respond. Please retry.' });
          return;
        }
        turn = await runTurn({ toolChoice: 'auto' });
      }
      if (turn.gone) return;
      if (turn.cut) return;
      // Only a turn that actually reached the reader sets these; `gone` and
      // `cut` return above, so a refused turn can never claim truncation.
      truncatedAnswer = turn.truncated === true;
      stats.finishReason = turn.finishReason;
      stats.rounds++;

      const pending = turn.calls || [];
      if (pending.length === 0) return; // a real answer, already streamed

      // A tool turn we are not allowed to serve, or cannot afford to serve.
      // Either way the reader is better served by prose from what is already in
      // hand than by a timeout, so make one final call that forbids tools.
      if (stats.rounds > MAX_TOOL_ROUNDS || deadline - Date.now() < toolRoundReserveMs()) {
        log('chat.tool_loop_capped', {
          ip,
          rounds: stats.rounds,
          calls: stats.toolCalls,
          reason: stats.rounds > MAX_TOOL_ROUNDS ? 'round cap' : 'time reserve',
          msLeft: deadline - Date.now(),
        });
        conversation.push({
          role: 'assistant',
          content: 'I have already used my lookup budget for this question; answer from what you have.',
        });
        const final = await runTurn({ toolChoice: 'none' });
        if (!final.gone && !final.cut) {
          truncatedAnswer = final.truncated === true;
          stats.finishReason = final.finishReason;
        }
        return;
      }

      conversation.push({
        role: 'assistant',
        content: null,
        tool_calls: pending.map((c) => ({
          id: c.id || `call_${stats.toolCalls}_${Math.random().toString(36).slice(2, 8)}`,
          type: 'function',
          function: { name: c.name, arguments: c.args || '{}' },
        })),
      });

      for (const call of pending) {
        let args = {};
        try { args = JSON.parse(call.args || '{}'); } catch { args = {}; }
        const signature = toolSignature(call.name, args);

        // Checked before the budget is spent, so a repeat costs neither a search
        // nor a slot in MAX_TOOL_CALLS. The tool message is still mandatory —
        // the assistant turn above declared this tool_call, and the API requires
        // a response per declared call — so the loop keeps its shape and the
        // model gets told plainly why there is nothing new.
        if (servedTools.has(signature)) {
          conversation.push({
            role: 'tool',
            tool_call_id: call.id,
            content: '[duplicate call] This exact lookup already ran earlier in this turn and its result is above. '
              + 'Do not call it again — answer now from the results you already have.',
          });
          log('chat.tool_duplicate', { ip, tool: call.name, rounds: stats.rounds });
          continue;
        }

        if (!budget.spend()) {
          conversation.push({
            role: 'tool',
            tool_call_id: call.id,
            content: '[tool budget exhausted] No further lookups this turn. Answer now from the results above and your own knowledge.',
          });
          continue;
        }

        sse(res, { status: `Looking up ${call.name}…` });
        lastBeat = Date.now();
        stats.toolCalls++;

        const result = await runTool(call.name, args, { env: process.env, model, maxTokens: MAX_TOOL_RESULT_TOKENS });
        // Only a call that actually produced something arms the guard: a repeat
        // after a failure is a legitimate retry, and short-circuiting it would
        // turn a transient error into a permanently empty answer.
        if (result.ok) servedTools.add(signature);
        if (result.ok) {
          stats.toolsUsed.push(result.label);
          log('chat.tool_used', { ip, tool: result.label, ok: true, sources: result.sources?.length || 0 });
        } else {
          stats.toolsUsed.push(`${result.label}!`);
          log('chat.tool_failed', { ip, tool: result.label, reason: result.label });
        }

        conversation.push({
          role: 'tool',
          tool_call_id: call.id,
          content: result.content,
        });
      }
    }
  } finally {
    if (!res.writableEnded) {
      // Truncation notice, then the terminator — in that order, so the client
      // has seen it before the stream closes. The frame body is pinned by
      // contract with the widget's readSse handler: exactly `{"truncated":true}`,
      // no spaces, no extra fields, no nesting. `sse()` writes `data: ` + the
      // JSON.stringify'd object + a blank line, and JSON.stringify adds no
      // space, so this renders the agreed bytes. A missing frame means "not
      // truncated", so this is only ever emitted when it is true.
      if (truncatedAnswer) sse(res, { truncated: true });
      res.write('data: [DONE]\n\n');
      res.end();
    }
    log('chat.completed', {
      ip,
      scope: ipLimit.scope,
      model,
      latencyMs: Date.now() - startedAt,
      tools: tools.map((t) => t.function.name).join(','),
      rounds: stats.rounds,
      toolCalls: stats.toolCalls,
      toolsUsed: stats.toolsUsed.join(','),
      finishReason: stats.finishReason,
      ...prepared.meta,
    });
  }
}

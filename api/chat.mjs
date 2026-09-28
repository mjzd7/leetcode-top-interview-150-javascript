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
import { checkOrigin, rateLimit, clientIp, allowedOrigins } from './_lib/chat-security.mjs';
import { MAX_COMPLETION_TOKENS, MAX_TOOL_ROUNDS, MAX_TOOL_RESULT_TOKENS } from './_lib/chat-tokens.mjs';
import { availableTools, createToolBudget, runTool } from './_lib/chat-tools.mjs';

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
  const limit = await rateLimit(`chat:${ip}`);
  if (!limit.ok) {
    const retryAfter = Math.max(1, Math.ceil((limit.reset - Date.now()) / 1000));
    res.setHeader('Retry-After', String(retryAfter));
    log('chat.rate_limited', { ip, scope: limit.scope });
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
  // The conversation is mutable across rounds: system + history, then assistant
  // tool_calls turns and tool results appended as they happen. The system prompt
  // stays at index 0 for the whole exchange, so page scope is retained no matter
  // how many tools run.
  const conversation = [{ role: 'system', content: prepared.system }, ...prepared.messages];
  const stats = { rounds: 0, toolCalls: 0, toolsUsed: [] };
  let lastBeat = Date.now();

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
  async function runTurn({ toolChoice }) {
    let upstream;
    try {
      upstream = await client.chat.completions.create(
        {
          model,
          temperature: 0.2, // low: coding answers should be reproducible, not creative
          max_tokens: MAX_COMPLETION_TOKENS, // cost control (improvements-doc §6.3)
          stream: true,
          messages: conversation,
          ...(tools.length ? { tools, tool_choice: toolChoice } : {}),
        },
        { signal: upstreamAbort.signal },
      );
    } catch (e) {
      const aborted = upstreamAbort.signal.aborted || e?.name === 'AbortError';
      // The client is gone: nothing to write to.
      if (aborted) return { gone: true };
      const timedOut = e?.code === 'ETIMEDOUT' || /timeout/i.test(String(e?.message || ''));
      log('chat.upstream_failed', { ip, round: stats.rounds + 1, error: String(e?.message || e), timedOut });
      sse(res, { error: timedOut ? 'The assistant took too long to respond. Please retry.' : 'The assistant is unavailable right now. Please retry.' });
      res.write('data: [DONE]\n\n');
      res.end();
      return { gone: true };
    }

    /** index -> { id, name, args } accumulated across deltas. */
    const calls = new Map();
    let released = false;

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
        const step = await Promise.race([
          reader.read(),
          new Promise((r) => setTimeout(() => r({ timeout: true }), HEARTBEAT_MS)),
        ]);

        if (step.timeout) {
          if (Date.now() - lastBeat >= HEARTBEAT_MS) {
            if (!res.writableEnded) res.write(': ping\n\n');
            lastBeat = Date.now();
          }
          continue;
        }

        if (step.done) break;
        if (upstreamAbort.signal.aborted) return { gone: true, calls };

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
          const delta = parsed?.choices?.[0]?.delta;

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
      if (!upstreamAbort.signal.aborted) {
        log('chat.stream_error', { ip, error: String(e?.message || e) });
        sse(res, { error: 'The response stream was interrupted.' });
        return { gone: false, cut: true, calls };
      }
      return { gone: true, calls };
    }

    return { gone: false, cut: false, calls: [...calls.values()].filter((c) => c.name) };
  }

  try {
    for (;;) {
      const turn = await runTurn({ toolChoice: 'auto' });
      if (turn.gone) return;
      if (turn.cut) return;
      stats.rounds++;

      const pending = turn.calls || [];
      if (pending.length === 0) return; // a real answer, already streamed

      // A tool turn we are not allowed to serve. Rather than leaving the reader
      // with an empty bubble, make one final call that forbids tools so the
      // model has to answer in prose from what it already has.
      if (stats.rounds > MAX_TOOL_ROUNDS) {
        log('chat.tool_loop_capped', { ip, rounds: stats.rounds - 1, calls: stats.toolCalls });
        conversation.push({
          role: 'assistant',
          content: 'I have already used my lookup budget for this question; answer from what you have.',
        });
        await runTurn({ toolChoice: 'none' });
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
        if (!budget.spend()) {
          conversation.push({
            role: 'tool',
            tool_call_id: call.id,
            content: '[tool budget exhausted] No further lookups this turn. Answer now from the results above and your own knowledge.',
          });
          continue;
        }
        let args = {};
        try { args = JSON.parse(call.args || '{}'); } catch { args = {}; }

        sse(res, { status: `Looking up ${call.name}…` });
        lastBeat = Date.now();
        stats.toolCalls++;

        const result = await runTool(call.name, args, { env: process.env, model, maxTokens: MAX_TOOL_RESULT_TOKENS });
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
      res.write('data: [DONE]\n\n');
      res.end();
    }
    log('chat.completed', {
      ip,
      scope: limit.scope,
      model,
      latencyMs: Date.now() - startedAt,
      tools: tools.map((t) => t.function.name).join(','),
      rounds: stats.rounds,
      toolCalls: stats.toolCalls,
      toolsUsed: stats.toolsUsed.join(','),
      ...prepared.meta,
    });
  }
}

import { getQuickJS, shouldInterruptAfterDeadline, isSuccess } from 'quickjs-emscripten';

let modulePromise = null;

function getModule() {
  if (!modulePromise) modulePromise = getQuickJS();
  return modulePromise;
}

export const ENVELOPE_PREFIX = '__VERDICT__';
const ENVELOPE_MAX_CHARS = 1024 * 1024; // 1MB: verdicts beyond this are a protocol error

function readStringProp(ctx, errHandle, prop) {
  let handle = null;
  try {
    handle = ctx.getProp(errHandle, prop);
    const dumped = ctx.dump(handle);
    return typeof dumped === 'string' ? dumped : '';
  } catch {
    return '';
  } finally {
    try {
      if (handle) handle.dispose();
    } catch {
      // ignore disposal errors
    }
  }
}

function extractErrorMessage(ctx, errHandle) {
  // ctx.dump() is inconsistent across error shapes (sometimes the object,
  // sometimes just the stack string), so read name/message/stack directly.
  const name = readStringProp(ctx, errHandle, 'name') || 'Error';
  const message = readStringProp(ctx, errHandle, 'message');
  const stack = readStringProp(ctx, errHandle, 'stack');
  const head = message ? `${name}: ${message}` : name;
  if (stack) return stack.includes(head) ? stack : `${head}\n${stack}`;
  if (message) return head;
  // Thrown primitives have no name/message/stack: dump the value itself.
  try {
    const dumped = ctx.dump(errHandle);
    if (typeof dumped === 'string' && dumped) return dumped;
  } catch {
    // fall through to head
  }
  return head;
}

/**
 * Parse a verdict envelope from the dedicated slot or a log scan.
 * Returns the envelope object or null.
 */
export function parseVerdictEnvelope(envelopeRaw, logs = []) {
  const candidates = [];
  if (typeof envelopeRaw === 'string' && envelopeRaw.startsWith(ENVELOPE_PREFIX)) {
    candidates.push(envelopeRaw.slice(ENVELOPE_PREFIX.length));
  }
  for (let i = logs.length - 1; i >= 0; i--) {
    const line = logs[i];
    if (typeof line === 'string' && line.startsWith(ENVELOPE_PREFIX)) {
      candidates.push(line.slice(ENVELOPE_PREFIX.length));
    }
  }
  for (const raw of candidates) {
    try {
      const parsed = JSON.parse(raw);
      if (
        parsed &&
        typeof parsed.passed === 'number' &&
        typeof parsed.failed === 'number' &&
        Array.isArray(parsed.tests)
      ) {
        return parsed;
      }
    } catch {
      // Malformed envelope: try the next candidate.
    }
  }
  return null;
}

/**
 * Execute untrusted JS in a QuickJS sandbox.
 *
 * Guarantees:
 * - No network, no fs, no process: the context exposes only a logging console.
 * - Timeout via interrupt handler: infinite loops surface as `timedOut: true`.
 * - Bounded memory via runtime.setMemoryLimit (breach -> error verdict).
 * - Stdout captured with a char cap; overflow sets `truncated: true`.
 *
 * Returns { ok, logs, truncated, error?, timedOut? }.
 * - ok=true: code ran; verdict envelope (if any) is in `logs`.
 * - ok=false, timedOut=true: interrupt fired (infinite loop / extreme compute).
 * - ok=false, error set: syntax error, thrown error, or OOM.
 */
export async function executeUserCode(
  source,
  { timeoutMs = 3000, memoryLimitBytes = 16 * 1024 * 1024, maxLogChars = 100000 } = {},
) {
  const QuickJS = await getModule();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(memoryLimitBytes);
  const deadline = Date.now() + timeoutMs;
  // shouldInterruptAfterDeadline(deadline) IS the predicate: pass it directly.
  // (Wrapping it in another arrow returns the predicate itself — truthy —
  // and interrupts instantly. Do not wrap.)
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(deadline));
  const ctx = runtime.newContext();

  const logs = [];
  let loggedChars = 0;
  let truncated = false;
  let envelopeRaw = null;
  const appendLog = (line) => {
    // The verdict envelope bypasses the spam cap (separate slot): truncation
    // must never eat the verdict itself.
    if (line.startsWith(ENVELOPE_PREFIX)) {
      if (line.length > ENVELOPE_MAX_CHARS) {
        truncated = true;
        return;
      }
      envelopeRaw = line;
      return;
    }
    if (loggedChars + line.length > maxLogChars) {
      truncated = true;
      const room = Math.max(0, maxLogChars - loggedChars);
      if (room > 0) {
        logs.push(line.slice(0, room));
        loggedChars = maxLogChars;
      }
      return;
    }
    logs.push(line);
    loggedChars += line.length;
  };
  const sink = (...args) => {
    appendLog(
      args
        .map((a) => {
          try {
            const d = ctx.dump(a);
            return typeof d === 'string' ? d : JSON.stringify(d);
          } catch {
            return '[unserializable]';
          }
        })
        .join(' '),
    );
  };

  const logFn = ctx.newFunction('log', sink);
  const errFn = ctx.newFunction('error', sink);
  const warnFn = ctx.newFunction('warn', sink);
  const consoleObj = ctx.newObject();
  ctx.setProp(consoleObj, 'log', logFn);
  ctx.setProp(consoleObj, 'error', errFn);
  ctx.setProp(consoleObj, 'warn', warnFn);
  ctx.setProp(ctx.global, 'console', consoleObj);
  logFn.dispose();
  errFn.dispose();
  warnFn.dispose();
  consoleObj.dispose();

  let outcome;
  try {
    const result = ctx.evalCode(source, 'submission.mjs');
    if (isSuccess(result)) {
      result.value.dispose();
      outcome = { ok: true };
    } else {
      const message = extractErrorMessage(ctx, result.error);
      result.error.dispose();
      const interrupted = /interrupted/i.test(message);
      const oom = /out of memory|memory limit/i.test(message);
      outcome = {
        ok: false,
        error: interrupted ? 'Time Limit Exceeded' : oom ? 'Memory Limit Exceeded' : message,
        timedOut: interrupted,
      };
    }
  } finally {
    ctx.dispose();
    runtime.dispose();
  }

  return { ...outcome, logs, truncated, envelopeRaw };
}

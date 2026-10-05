/**
 * E18 — a step that THROWS. Plan §6 E18 / §3 G3: the thrown step flushes the partial trace
 * with `error` set, and the VERDICT still comes from an uninstrumented run (invariant I2).
 *
 * `readAt` guards its index, so the throw is an ordinary `throw` step the instrumenter sees
 * coming — and the run after it never happens, which is exactly the case that used to
 * silently truncate a trace.
 */
function readAt(values, index) {
  const n = values.length;
  if (index < 0 || index >= n) {
    throw new Error('index out of range: ' + index);
  }
  return values[index];
}

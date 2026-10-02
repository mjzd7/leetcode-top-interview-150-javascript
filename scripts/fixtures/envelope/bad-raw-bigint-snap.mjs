/**
 * Bad envelope #6 of 6 — defends invariant I6 (every `snap` value round-trips through
 * the canonical serializer; plan v5 §5 invariant 6, §3 K6, ledger §6 E1–E4).
 *
 * WHY A `.mjs` FIXTURE AND NOT `.json`: the defect IS a raw `BigInt`, and no JSON document
 * can hold one. `JSON.stringify({ mask: 2n ** 70n })` throws `TypeError: Do not know how
 * to serialize a BigInt` — the exact sandbox-killing bug E4 pins, and the reason
 * `scripts/lib/serialize.mjs` exists. A `.json` fixture could only carry the canonical
 * token `{"__bi":"…"}`, which is the CORRECT form and passes validation. So the live value
 * has to be minted in JS to be expressible at all.
 *
 * PROVENANCE, measured not assumed: `block` is the real Level 3 block of
 * `22-bit-manipulation/02-reverse-bits.md` (startLine 175, 15 lines, sha256 of its source).
 * Measured 2026-10-02: ZERO of the 150 Level 3 solution blocks contains a BigInt literal —
 * the E4 risk lives in the guides' gotcha sections, not in any traced block yet. So this is
 * the FORWARD guard, not a replay of a recorded run: the first guide that puts a BigInt (or
 * a NaN, a -0, a Map) in its canonical block is exactly the trace this validator must not
 * let through mangled.
 *
 * What plain `JSON.stringify` does to this snap, and why the validator may not use it alone:
 *   the raw BigInt  -> THROWS, killing the whole run
 *   a raw `NaN`     -> silently becomes null
 *   a raw `-0`       -> silently prints as 0
 *   a raw `undefined`-> the key silently vanishes
 * The canonical serializer tokenises all four, and I6 compares the two forms, so every one
 * of them is caught by name.
 */

// The same four cases `JSON.stringify` mangles — three silently, one fatally.
export default {
  v: 1,
  path: '22-bit-manipulation/02-reverse-bits.md',
  level: 3,
  fnName: 'reverseBits',
  codec: 'json',
  block: {
    hash: 'sha256:bdb2b349137481913c1ed593e1e58978df17e1dbff054ac3e4c4d92b30e84c48',
    startLine: 175,
    lines: 15,
  },
  watch: ['n', 'mask', 'ratio', 'bit', 'result'],
  steps: [
    {
      n: 1,
      line: { h: 'sha256:bdb2b349137481913c1ed593e1e58978df17e1dbff054ac3e4c4d92b30e84c48', off: 8 },
      type: 'assign',
      text: 'n = (((n >>> 1) & 0x55555555) | ((n & 0x55555555) << 1)) >>> 0;',
      operands: { n: 43261596 },
      cond: null,
      // The defect: these are LIVE values, not the canonical tokens the envelope carries.
      snap: {
        mask: 2n ** 70n, // E4 — JSON.stringify THROWS on this one
        ratio: NaN, // E2 — JSON.stringify degrades this to null, silently
        bit: -0, // E3 — JSON.stringify prints this as 0, silently
        missing: undefined, // E1 — JSON.stringify DROPS the key, silently
        result: 0,
      },
      delta: [],
      out: 'Step 1: odd/even bits swap. `>>> 0` after every step, because an intermediate `<<` can set bit 31 and trap to a negative number.',
      override: null,
    },
  ],
  result: 964176192,
  verdict: { passed: 3, failed: 0 },
  truncated: { execution: false, display: false, trace: false },
  budget: { bytes: 903, mode: 'full', chunks: 1 },
  stepCount: 1,
  error: null,
};
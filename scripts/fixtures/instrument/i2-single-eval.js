/**
 * I2 — a probe must not evaluate a condition TWICE.
 *
 * A probe reports the condition it observed, so the naive shape (`__T(…); if (cond) {…}`)
 * reads `cond` a second time. For a pure comparison that is free; for a condition carrying a
 * CALL it runs the call twice, and 21 of the 450 solution blocks have one — a traced run would
 * then compute something the uninstrumented run never did, which is exactly what invariant I2
 * exists to prevent.
 *
 * So the condition is evaluated once into a temp, the probe reads the temp, and the construct
 * branches on the same temp. This fixture makes that OBSERVABLE rather than asserted: `probes`
 * counts how many times `alwaysTrue()` ran, and it is returned. If the instrumenter read the
 * condition twice, the traced run would report a larger count than the raw one — and the two
 * results would differ. The test asserts they are byte-identical.
 */
let calls = 0;

function alwaysTrue() {
  calls++;
  return true;
}

function countUp(limit) {
  let n = 0;
  while (alwaysTrue() && n < limit) {
    n++;
  }
  return [n, calls];
}

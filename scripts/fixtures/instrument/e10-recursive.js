/**
 * E10 — a RECURSIVE target. Plan §6 E10: `regionTable` marks the target depth 0, so its own
 * body MUST still emit on every self-call.
 *
 * This is the fixture that kills a runtime depth counter. `depthBelow` calls itself twice
 * per frame, so a counter would report depth 1, 2, 3 … and suppress everything after the
 * first frame — an EMPTY trace that passes V11 vacuously (plan §1 U3).
 */
function depthBelow(node) {
  if (node === null) return 0;
  let best = depthBelow(node.left);
  const right = depthBelow(node.right);
  if (right > best) best = right;
  return 1 + best;
}

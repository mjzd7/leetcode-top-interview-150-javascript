/**
 * E14, helper half — a helper that LIVES IN ANOTHER BLOCK. Instrumented on its own it traces
 * its own body (depth 0 relative to itself), which is the proof that the region gate is
 * per-block and not global: nothing about `e14-target.js` suppresses it.
 */
function buildTree(level) {
  const root = { val: level[0], left: null, right: null };
  let i = 1;
  while (i < level.length) {
    root.left = { val: level[i], left: null, right: null };
    i++;
  }
  return root;
}

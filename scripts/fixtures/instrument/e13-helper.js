/**
 * E13 — a helper declared in the SAME BLOCK but OUTSIDE the target. Plan §6 E13.
 *
 * `arrayToTree` is a sibling of `twoSum` at the same lexical level, so the region table marks
 * it depth 1 and the runtime must suppress every step inside it. Its probes are still EMITTED
 * (baked with the integer 1) — the gate is a comparison, not a compile-time omission, which
 * is what makes the decision visible in the generated source.
 */
function arrayToTree(level) {
  if (level.length === 0) return null;
  const treeNode = { val: level[0], left: null, right: null };
  treeNode.left = arrayToTree(level.slice(1));
  return treeNode;
}

function twoSum(level, target, tree) {
  const seen = new Map();
  let left = 0;
  while (left < level.length) {
    const complement = target - level[left];
    if (seen.has(complement)) {
      return [seen.get(complement), left];
    }
    seen.set(level[left], left);
    left++;
  }
  return tree === null ? [] : [];
}

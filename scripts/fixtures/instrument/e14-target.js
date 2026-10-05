/**
 * E14, target half — the block under test. It does NOT contain `buildTree`; that helper lives
 * in `e14-other-block.js`. Plan §6 E14: the lexical region test is PER BLOCK, so a helper in
 * another block is suppressed simply because it is not in this block's AST at all.
 */
function twoSum(level, target) {
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
  return [];
}

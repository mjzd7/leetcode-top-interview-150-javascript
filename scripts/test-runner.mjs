import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import { validateProblemGuide } from './validate-guide.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Runtime test registry.
//
// Key: problem file path relative to repo root.
// Value: either
//   { fns: [level1Name, level2Name, level3Name],
//     cases: [{ args: [...jsonValues], expect: jsonValue }] }
//     — each listed function is called with a fresh deep clone of args and
//       its return value must deep-equal expect, or
//   { script: `raw JS appended after the Level 1-3 blocks` }
//     — for class-based / in-place-mutating APIs. Use assertEq(actual,
//       expected, label) and end with console.log('ASSERT-OK n').
// Files with no entry get syntax checks only (reported as SYNTAX-ONLY).
// To extend coverage, add one entry per file following the examples below.
// ---------------------------------------------------------------------------
const RUNTIME_TESTS = {
  '07-stack/03-min-stack.md': {
    script: `
for (const C of [MinStackBruteForce, MinStackOptimized, MinStack]) {
  const m = new C();
  m.push(-2); m.push(0); m.push(-3);
  assertEq(m.getMin(), -3, 'getMin after pushes');
  m.pop();
  assertEq(m.top(), 0, 'top after pop');
  assertEq(m.getMin(), -2, 'getMin after pop');
}
console.log('ASSERT-OK 9');`,
  },
  '07-stack/04-evaluate-reverse-polish-notation.md': {
    fns: ['evalRPNBruteForce', 'evalRPNOptimized', 'evalRPN'],
    cases: [
      { args: [['2', '1', '+', '3', '*']], expect: 9 },
      { args: [['4', '13', '5', '/', '+']], expect: 6 },
      { args: [['18']], expect: 18 },
    ],
  },
  '07-stack/05-basic-calculator.md': {
    fns: ['calculateBruteForce', 'calculateOptimized', 'calculate'],
    cases: [
      { args: ['1 + 1'], expect: 2 },
      { args: [' 2-1 + 2 '], expect: 3 },
      { args: ['(1+(4+5+2)-3)+(6+8)'], expect: 23 },
    ],
  },
  '07-stack/01-valid-parentheses.md': {
    fns: ['isValidBruteForce', 'isValidStack', 'isValid'],
    cases: [
      { args: ['()[]{}'], expect: true },
      { args: ['(]'], expect: false },
      { args: ['([)]'], expect: false },
    ],
  },
  '02-two-pointers/01-valid-palindrome.md': {
    fns: ['isPalindromeBruteForce', 'isPalindromeOptimized', 'isPalindrome'],
    cases: [
      { args: ['A man, a plan, a canal: Panama'], expect: true },
      { args: ['race a car'], expect: false },
    ],
  },
  '02-two-pointers/04-container-with-most-water.md': {
    fns: ['maxAreaBruteForce', 'maxAreaPruned', 'maxArea'],
    cases: [
      { args: [[1, 8, 6, 2, 5, 4, 8, 3, 7]], expect: 49 },
      { args: [[1, 1]], expect: 1 },
    ],
  },
  '05-hashmap/06-two-sum.md': {
    fns: ['twoSumBruteForce', 'twoSumTwoPass', 'twoSum'],
    cases: [
      { args: [[2, 7, 11, 15], 9], expect: [0, 1] },
      { args: [[3, 2, 4], 6], expect: [1, 2] },
    ],
  },
  '05-hashmap/04-valid-anagram.md': {
    fns: ['isAnagramSort', 'isAnagramMap', 'isAnagram'],
    cases: [
      { args: ['anagram', 'nagaram'], expect: true },
      { args: ['rat', 'car'], expect: false },
    ],
  },
  '05-hashmap/09-longest-consecutive-sequence.md': {
    fns: ['longestConsecutiveBruteForce', 'longestConsecutiveSorted', 'longestConsecutive'],
    cases: [
      { args: [[100, 4, 200, 1, 3, 2]], expect: 4 },
      { args: [[0]], expect: 1 },
    ],
  },
  '01-array-string/19-length-of-last-word.md': {
    fns: ['lengthOfLastWordBruteForce', 'lengthOfLastWordRegex', 'lengthOfLastWord'],
    cases: [
      { args: ['Hello World'], expect: 5 },
      { args: ['   fly me   to   the moon  '], expect: 4 },
    ],
  },
  '01-array-string/17-roman-to-integer.md': {
    fns: ['romanToIntBruteForce', 'romanToIntOptimized', 'romanToInt'],
    cases: [
      { args: ['III'], expect: 3 },
      { args: ['LVIII'], expect: 58 },
      { args: ['MCMXCIV'], expect: 1994 },
    ],
  },
  '01-array-string/07-best-time-to-buy-and-sell-stock.md': {
    fns: ['maxProfitBruteForce', 'maxProfitOptimized', 'maxProfit'],
    cases: [
      { args: [[7, 1, 5, 3, 6, 4]], expect: 5 },
      { args: [[7, 6, 4, 3, 1]], expect: 0 },
    ],
  },
  '01-array-string/16-trapping-rain-water.md': {
    fns: ['trapBruteForce', 'trapDP', 'trap'],
    cases: [
      { args: [[0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1]], expect: 6 },
    ],
  },
  '03-sliding-window/02-longest-substring-without-repeating-characters.md': {
    fns: ['lengthOfLongestSubstringBruteForce', 'lengthOfLongestSubstringSet', 'lengthOfLongestSubstring'],
    cases: [
      { args: ['abcabcbb'], expect: 3 },
      { args: ['bbbbb'], expect: 1 },
    ],
  },
  '06-intervals/02-merge-intervals.md': {
    // Brute force preserves discovery order, so compare order-insensitively.
    script: `
const byStart = (a, b) => a[0] - b[0] || a[1] - b[1];
for (const fn of [mergeBruteForce, mergeOptimized, merge]) {
  const input = [[1, 3], [2, 6], [8, 10], [15, 18]];
  assertEq(fn(input.map((p) => p.slice())).sort(byStart), [[1, 6], [8, 10], [15, 18]], 'merge intervals');
}
console.log('ASSERT-OK 3');`,
  },
  '08-linked-list/01-linked-list-cycle.md': {
    script: `
function cyclicList() {
  const n1 = new ListNode(3), n2 = new ListNode(2), n3 = new ListNode(0), n4 = new ListNode(-4);
  n1.next = n2; n2.next = n3; n3.next = n4; n4.next = n2;
  return n1;
}
for (const fn of [hasCycleBruteForce, hasCycleFloyd, hasCycle]) {
  assertEq(fn(cyclicList()), true, 'cycle detected');
  assertEq(fn(new ListNode(1)), false, 'single node acyclic');
  assertEq(fn(null), false, 'empty list');
}
console.log('ASSERT-OK 9');`,
  },
  '08-linked-list/02-add-two-numbers.md': {
    script: `
for (const fn of [addTwoNumbersBruteForce, addTwoNumbersRecursive, addTwoNumbers]) {
  assertEq(listToArray(fn(arrayToList([2, 4, 3]), arrayToList([5, 6, 4]))), [7, 0, 8], '342 + 465');
  assertEq(listToArray(fn(arrayToList([9, 9, 9, 9, 9, 9, 9]), arrayToList([9, 9, 9, 9]))), [8, 9, 9, 9, 0, 0, 0, 1], 'long carry chain');
}
console.log('ASSERT-OK 6');`,
  },
  '08-linked-list/03-merge-two-sorted-lists.md': {
    script: `
for (const fn of [mergeTwoListsBruteForce, mergeTwoListsRecursive, mergeTwoLists]) {
  assertEq(listToArray(fn(arrayToList([1, 2, 4]), arrayToList([1, 3, 4]))), [1, 1, 2, 3, 4, 4], 'basic merge');
  assertEq(listToArray(fn(null, arrayToList([0]))), [0], 'empty + [0]');
}
console.log('ASSERT-OK 6');`,
  },
  '08-linked-list/04-copy-list-with-random-pointer.md': {
    // Node comes from the Level 1 block; helpers live here in the harness.
    script: `
function buildRandom(pairs) {
  const nodes = pairs.map(([v]) => new Node(v));
  nodes.forEach((n, i) => {
    n.next = nodes[i + 1] ?? null;
    n.random = pairs[i][1] === null ? null : nodes[pairs[i][1]];
  });
  return nodes[0] ?? null;
}
function snapshot(head) {
  const nodes = [];
  for (let c = head; c; c = c.next) nodes.push(c);
  return nodes.map((n) => [n.val, n.random ? nodes.indexOf(n.random) : null]);
}
const SPEC = [[7, null], [13, 0], [11, 4], [10, 2], [1, 0]];
for (const fn of [copyRandomListBruteForce, copyRandomListRecursive, copyRandomList]) {
  const orig = buildRandom(SPEC);
  const before = JSON.stringify(snapshot(orig));
  const copy = fn(orig);
  assertEq(snapshot(copy), JSON.parse(before), 'copy topology matches');
  assertEq(copy !== orig && copy.next !== orig.next, true, 'deep copy, no shared nodes');
  assertEq(JSON.stringify(snapshot(orig)), before, 'original untouched');
}
assertEq(copyRandomListBruteForce(null), null, 'null input');
console.log('ASSERT-OK 10');`,
  },
  '08-linked-list/05-reverse-linked-list-ii.md': {
    script: `
for (const fn of [reverseBetweenBruteForce, reverseBetweenHeadInsert, reverseBetween]) {
  assertEq(listToArray(fn(arrayToList([1, 2, 3, 4, 5]), 2, 4)), [1, 4, 3, 2, 5], 'middle segment');
  assertEq(listToArray(fn(arrayToList([1, 2, 3, 4, 5]), 1, 5)), [5, 4, 3, 2, 1], 'full reversal');
  assertEq(listToArray(fn(arrayToList([5]), 1, 1)), [5], 'single node no-op');
}
console.log('ASSERT-OK 9');`,
  },
  '08-linked-list/06-reverse-nodes-in-k-group.md': {
    script: `
for (const fn of [reverseKGroupBruteForce, reverseKGroupRecursive, reverseKGroup]) {
  assertEq(listToArray(fn(arrayToList([1, 2, 3, 4, 5]), 2)), [2, 1, 4, 3, 5], 'k=2');
  assertEq(listToArray(fn(arrayToList([1, 2, 3, 4, 5]), 3)), [3, 2, 1, 4, 5], 'k=3 short tail kept');
}
console.log('ASSERT-OK 6');`,
  },
  '08-linked-list/07-remove-nth-node-from-end.md': {
    script: `
for (const fn of [removeNthFromEndBruteForce, removeNthFromEndOnePass, removeNthFromEnd]) {
  assertEq(listToArray(fn(arrayToList([1, 2, 3, 4, 5]), 2)), [1, 2, 3, 5], 'remove 4');
  assertEq(listToArray(fn(arrayToList([1, 2, 3, 4, 5]), 5)), [2, 3, 4, 5], 'remove head');
  assertEq(listToArray(fn(arrayToList([1]), 1)), [], 'single node');
}
console.log('ASSERT-OK 9');`,
  },
  '08-linked-list/08-remove-duplicates-from-sorted-list-ii.md': {
    script: `
for (const fn of [deleteDuplicatesBruteForce, deleteDuplicatesRecursive, deleteDuplicates]) {
  assertEq(listToArray(fn(arrayToList([1, 2, 3, 3, 4, 4, 5]))), [1, 2, 5], 'runs removed');
  assertEq(listToArray(fn(arrayToList([1, 1, 1, 2, 3]))), [2, 3], 'head run');
  assertEq(listToArray(fn(arrayToList([1, 1, 1]))), [], 'all duplicates');
}
console.log('ASSERT-OK 9');`,
  },
  '08-linked-list/09-rotate-list.md': {
    script: `
for (const fn of [rotateRightBruteForce, rotateRightArray, rotateRight]) {
  assertEq(listToArray(fn(arrayToList([1, 2, 3, 4, 5]), 2)), [4, 5, 1, 2, 3], 'k=2');
  assertEq(listToArray(fn(arrayToList([0, 1, 2]), 4)), [2, 0, 1], 'k > n');
  assertEq(listToArray(fn(arrayToList([1, 2, 3]), 3)), [1, 2, 3], 'full cycle no-op');
}
console.log('ASSERT-OK 9');`,
  },
  '08-linked-list/10-partition-list.md': {
    script: `
for (const fn of [partitionBruteForce, partitionCopy, partition]) {
  assertEq(listToArray(fn(arrayToList([1, 4, 3, 2, 5, 2]), 3)), [1, 2, 2, 4, 3, 5], 'stable split');
  assertEq(listToArray(fn(arrayToList([2, 1]), 2)), [1, 2], 'pivot at head');
}
console.log('ASSERT-OK 6');`,
  },
  '08-linked-list/11-lru-cache.md': {
    script: `
function exerciseCache(C) {
  const c = new C(2);
  const out = [];
  c.put(1, 1); c.put(2, 2);
  out.push(c.get(1)); // 1
  c.put(3, 3); // evicts 2
  out.push(c.get(2)); // -1
  c.put(4, 4); // evicts 1
  out.push(c.get(1)); // -1
  out.push(c.get(3)); // 3
  out.push(c.get(4)); // 4
  return out;
}
const EXPECTED = [1, -1, -1, 3, 4];
for (const C of [LRUCacheBruteForce, LRUCacheOrderedMap, LRUCache]) {
  assertEq(exerciseCache(C), EXPECTED, 'lru sequence');
}
console.log('ASSERT-OK 3');`,
  },
  '09-binary-tree-general/01-maximum-depth.md': {
    // arrayToTree comes from the Level 1 block.
    script: `
for (const fn of [maxDepthBFS, maxDepthIterative, maxDepth]) {
  assertEq(fn(arrayToTree([3, 9, 20, null, null, 15, 7])), 3, 'balanced depth 3');
  assertEq(fn(arrayToTree([1, null, 2])), 2, 'right-leaning');
  assertEq(fn(arrayToTree([])), 0, 'empty tree');
}
console.log('ASSERT-OK 9');`,
  },
  '09-binary-tree-general/02-same-tree.md': {
    script: `
for (const fn of [isSameTreeBruteForce, isSameTreeIterative, isSameTree]) {
  assertEq(fn(arrayToTree([1, 2, 3]), arrayToTree([1, 2, 3])), true, 'identical');
  assertEq(fn(arrayToTree([1, 2]), arrayToTree([1, null, 2])), false, 'shape differs');
  assertEq(fn(arrayToTree([1, 2, 1]), arrayToTree([1, 1, 2])), false, 'values differ');
}
console.log('ASSERT-OK 9');`,
  },
  '09-binary-tree-general/03-invert-binary-tree.md': {
    // treeToArray comes from the Level 1 block.
    script: `
for (const fn of [invertTreeCopy, invertTreeBFS, invertTree]) {
  assertEq(treeToArray(fn(arrayToTree([4, 2, 7, 1, 3, 6, 9]))), [4, 7, 2, 9, 6, 3, 1], 'full mirror');
  assertEq(treeToArray(fn(arrayToTree([2, 1, 3]))), [2, 3, 1], 'small mirror');
  assertEq(treeToArray(fn(arrayToTree([]))), [], 'empty tree');
}
console.log('ASSERT-OK 9');`,
  },
  '09-binary-tree-general/04-symmetric-tree.md': {
    script: `
for (const fn of [isSymmetricBruteForce, isSymmetricIterative, isSymmetric]) {
  assertEq(fn(arrayToTree([1, 2, 2, 3, 4, 4, 3])), true, 'symmetric');
  assertEq(fn(arrayToTree([1, 2, 2, null, 3, null, 3])), false, 'asymmetric shape');
  assertEq(fn(arrayToTree([])), true, 'empty tree');
}
console.log('ASSERT-OK 9');`,
  },
  '09-binary-tree-general/05-construct-from-preorder-inorder.md': {
    // treeToArray comes from the Level 1 block.
    script: `
for (const fn of [buildTreeBruteForce, buildTreeMap, buildTree]) {
  assertEq(treeToArray(fn([3, 9, 20, 15, 7], [9, 3, 15, 20, 7])), [3, 9, 20, null, null, 15, 7], 'example 1');
  assertEq(treeToArray(fn([-1], [-1])), [-1], 'single node');
  assertEq(treeToArray(fn([], [])), [], 'empty input');
}
console.log('ASSERT-OK 9');`,
  },
  '09-binary-tree-general/06-construct-from-inorder-postorder.md': {
    script: `
for (const fn of [buildTreeBruteForce, buildTreeMap, buildTree]) {
  assertEq(treeToArray(fn([9, 3, 15, 20, 7], [9, 15, 7, 20, 3])), [3, 9, 20, null, null, 15, 7], 'example 1');
  assertEq(treeToArray(fn([-1], [-1])), [-1], 'single node');
  assertEq(treeToArray(fn([], [])), [], 'empty input');
}
console.log('ASSERT-OK 9');`,
  },
  '09-binary-tree-general/07-flatten-binary-tree.md': {
    // collectRightChain comes from the Level 1 block; flatten fns mutate in place.
    script: `
for (const fn of [flattenBruteForce, flattenRecursive, flatten]) {
  const t1 = arrayToTree([1, 2, 5, 3, 4, null, 6]);
  fn(t1);
  assertEq(collectRightChain(t1), [1, 2, 3, 4, 5, 6], 'example 1 flattened');
  const t2 = arrayToTree([]);
  fn(t2); // must not throw on null
  assertEq(t2, null, 'empty tree no-op');
}
console.log('ASSERT-OK 6');`,
  },
  '09-binary-tree-general/08-path-sum.md': {
    script: `
const T = () => arrayToTree([5, 4, 8, 11, null, 13, 4, 7, 2, null, null, null, 1]);
for (const fn of [hasPathSumBruteForce, hasPathSumIterative, hasPathSum]) {
  assertEq(fn(T(), 22), true, 'example 1');
  assertEq(fn(arrayToTree([1, 2, 3]), 5), false, 'no path');
  assertEq(fn(arrayToTree([]), 0), false, 'empty tree never matches');
}
console.log('ASSERT-OK 9');`,
  },
  '09-binary-tree-general/09-sum-root-to-leaf-numbers.md': {
    script: `
for (const fn of [sumNumbersBruteForce, sumNumbersIterative, sumNumbers]) {
  assertEq(fn(arrayToTree([1, 2, 3])), 25, 'example 1');
  assertEq(fn(arrayToTree([4, 9, 0, 5, 1])), 1026, 'example 2');
  assertEq(fn(arrayToTree([])), 0, 'empty tree');
}
console.log('ASSERT-OK 9');`,
  },
  '09-binary-tree-general/10-lowest-common-ancestor.md': {
    // findNode comes from the Level 1 block; LCA matched by node identity.
    script: `
for (const fn of [lowestCommonAncestorBruteForce, lowestCommonAncestorParentMap, lowestCommonAncestor]) {
  const t1 = arrayToTree([3, 5, 1, 6, 2, 0, 8, null, null, 7, 4]);
  assertEq(fn(t1, findNode(t1, 5), findNode(t1, 1)).val, 3, 'diverging paths');
  const t2 = arrayToTree([3, 5, 1, 6, 2, 0, 8, null, null, 7, 4]);
  assertEq(fn(t2, findNode(t2, 5), findNode(t2, 4)).val, 5, 'ancestor case');
}
console.log('ASSERT-OK 6');`,
  },
  '09-binary-tree-general/11-maximum-path-sum.md': {
    script: `
for (const fn of [maxPathSumBruteForce, maxPathSumMemo, maxPathSum]) {
  assertEq(fn(arrayToTree([1, 2, 3])), 6, 'through root');
  assertEq(fn(arrayToTree([-10, 9, 20, null, null, 15, 7])), 42, 'inside subtree');
  assertEq(fn(arrayToTree([-3])), -3, 'single negative');
}
console.log('ASSERT-OK 9');`,
  },
  '09-binary-tree-general/12-bst-iterator.md': {
    script: `
function exerciseIterator(C) {
  const it = new C(arrayToTree([7, 3, 15, null, null, 9, 20]));
  return [it.next(), it.next(), it.hasNext(), it.next(), it.hasNext(), it.next(), it.hasNext()];
}
const EXPECTED_IT = [3, 7, true, 9, true, 15, true];
for (const C of [BSTIteratorArray, BSTIteratorStack, BSTIterator]) {
  assertEq(exerciseIterator(C), EXPECTED_IT, 'inorder sequence');
}
console.log('ASSERT-OK 3');`,
  },
  '09-binary-tree-general/13-count-complete-tree-nodes.md': {
    script: `
for (const fn of [countNodesBruteForce, countNodesHeight, countNodes]) {
  assertEq(fn(arrayToTree([1, 2, 3, 4, 5, 6])), 6, 'example 1');
  assertEq(fn(arrayToTree([1, 2, 3, 4, 5])), 5, 'missing rightmost leaf');
  assertEq(fn(arrayToTree([])), 0, 'empty tree');
  assertEq(fn(arrayToTree([1])), 1, 'single node');
}
console.log('ASSERT-OK 12');`,
  },
  '09-binary-tree-general/14-next-right-pointers-ii.md': {    // arrayToNextTree (Node-based) comes from the Level 1 block.
    script: `
function levelsViaNext(root) {
  const out = [];
  let row = root;
  while (row) {
    const vals = [];
    for (let c = row; c; c = c.next) vals.push(c.val);
    out.push(vals);
    let next = null;
    for (let c = row; c && !next; c = c.next) next = c.left ?? c.right;
    row = next;
  }
  return out;
}
for (const fn of [connectBruteForce, connectRecursive, connect]) {
  assertEq(levelsViaNext(fn(arrayToNextTree([1, 2, 3, 4, 5, null, 7]))), [[1], [2, 3], [4, 5, 7]], 'cross-subtree link');
  assertEq(levelsViaNext(fn(arrayToNextTree([]))), [], 'empty tree');
  assertEq(levelsViaNext(fn(arrayToNextTree([1]))), [[1]], 'single node');
}
console.log('ASSERT-OK 9');`,
  },
  '10-binary-tree-bfs/01-right-side-view.md': {
    script: `
for (const fn of [rightSideViewBruteForce, rightSideViewDFS, rightSideView]) {
  assertEq(fn(arrayToTree([1, 2, 3, null, 5, null, 4])), [1, 3, 4], 'example 1');
  assertEq(fn(arrayToTree([1, null, 3])), [1, 3], 'right-leaning');
  assertEq(fn(arrayToTree([])), [], 'empty tree');
}
console.log('ASSERT-OK 9');`,
  },
  '10-binary-tree-bfs/02-average-of-levels.md': {
    script: `
for (const fn of [averageOfLevelsBruteForce, averageOfLevelsDFS, averageOfLevels]) {
  assertEq(fn(arrayToTree([3, 9, 20, null, null, 15, 7])), [3, 14.5, 11], 'example 1');
  assertEq(fn(arrayToTree([])), [], 'empty tree');
}
console.log('ASSERT-OK 6');`,
  },
  '10-binary-tree-bfs/03-level-order-traversal.md': {
    script: `
for (const fn of [levelOrderRecursive, levelOrderBFS, levelOrder]) {
  assertEq(fn(arrayToTree([3, 9, 20, null, null, 15, 7])), [[3], [9, 20], [15, 7]], 'example 1');
  assertEq(fn(arrayToTree([1])), [[1]], 'single node');
  assertEq(fn(arrayToTree([])), [], 'empty tree');
}
console.log('ASSERT-OK 9');`,
  },
  '10-binary-tree-bfs/04-zigzag-level-order.md': {
    script: `
for (const fn of [zigzagLevelOrderBruteForce, zigzagLevelOrderDFS, zigzagLevelOrder]) {
  assertEq(fn(arrayToTree([3, 9, 20, null, null, 15, 7])), [[3], [20, 9], [15, 7]], 'example 1');
  assertEq(fn(arrayToTree([1])), [[1]], 'single node');
  assertEq(fn(arrayToTree([])), [], 'empty tree');
}
console.log('ASSERT-OK 9');`,
  },
  '11-binary-search-tree/01-validate-bst.md': {
    script: `
for (const fn of [isValidBSTBruteForce, isValidBSTInorder, isValidBST]) {
  assertEq(fn(arrayToTree([2, 1, 3])), true, 'valid');
  assertEq(fn(arrayToTree([5, 1, 4, null, null, 3, 6])), false, 'deep violation');
  assertEq(fn(arrayToTree([1, 1])), false, 'duplicate rejects');
  assertEq(fn(arrayToTree([])), true, 'empty tree');
}
console.log('ASSERT-OK 12');`,
  },
  '11-binary-search-tree/02-kth-smallest-element.md': {
    script: `
for (const fn of [kthSmallestBruteForce, kthSmallestIterative, kthSmallest]) {
  assertEq(fn(arrayToTree([3, 1, 4, null, 2]), 1), 1, 'k=1');
  assertEq(fn(arrayToTree([5, 3, 6, 2, 4, null, null, 1]), 3), 3, 'k=3');
}
console.log('ASSERT-OK 6');`,
  },
  '11-binary-search-tree/03-minimum-absolute-difference.md': {
    script: `
for (const fn of [getMinimumDifferenceBruteForce, getMinimumDifferenceIterative, getMinimumDifference]) {
  assertEq(fn(arrayToTree([4, 2, 6, 1, 3])), 1, 'example 1');
  assertEq(fn(arrayToTree([1, 0, 48, null, null, 12, 49])), 1, 'example 2');
}
console.log('ASSERT-OK 6');`,
  },
  '12-binary-search/01-search-insert-position.md': {
    fns: ['searchInsertBruteForce', 'searchInsertRecursive', 'searchInsert'],
    cases: [
      { args: [[1, 3, 5, 6], 5], expect: 2 },
      { args: [[1, 3, 5, 6], 2], expect: 1 },
      { args: [[1, 3, 5, 6], 7], expect: 4 },
    ],
  },
  '12-binary-search/02-search-2d-matrix.md': {
    fns: ['searchMatrixBruteForce', 'searchMatrixStaircase', 'searchMatrix'],
    cases: [
      { args: [[[1, 3, 5, 7], [10, 11, 16, 20], [23, 30, 34, 60]], 3], expect: true },
      { args: [[[1, 3, 5, 7], [10, 11, 16, 20], [23, 30, 34, 60]], 13], expect: false },
    ],
  },
  '12-binary-search/03-find-peak-element.md': {    // Multiple valid peaks: assert peak-ness, not a specific index.
    script: `
function isPeakIndex(arr, i) {
  const l = i === 0 ? -Infinity : arr[i - 1];
  const r = i === arr.length - 1 ? -Infinity : arr[i + 1];
  return arr[i] > l && arr[i] > r;
}
for (const fn of [findPeakElementBruteForce, findPeakElementRecursive, findPeakElement]) {
  assertEq(isPeakIndex([1, 2, 3, 1], fn([1, 2, 3, 1])), true, 'peak of [1,2,3,1]');
  assertEq(isPeakIndex([1, 2, 1, 3, 5, 6, 4], fn([1, 2, 1, 3, 5, 6, 4])), true, 'peak of multi-peak');
  assertEq(isPeakIndex([5], fn([5])), true, 'single element');
}
console.log('ASSERT-OK 9');`,
  },
  '12-binary-search/04-search-rotated-sorted-array.md': {
    fns: ['rotatedSearchBruteForce', 'rotatedSearchPivot', 'search'],
    cases: [
      { args: [[4, 5, 6, 7, 0, 1, 2], 0], expect: 4 },
      { args: [[4, 5, 6, 7, 0, 1, 2], 3], expect: -1 },
      { args: [[1], 0], expect: -1 },
    ],
  },
  '12-binary-search/05-first-and-last-position.md': {
    fns: ['searchRangeBruteForce', 'searchRangeExpand', 'searchRange'],
    cases: [
      { args: [[5, 7, 7, 8, 8, 10], 8], expect: [3, 4] },
      { args: [[5, 7, 7, 8, 8, 10], 6], expect: [-1, -1] },
      { args: [[], 0], expect: [-1, -1] },
    ],
  },
  '12-binary-search/06-find-minimum-rotated.md': {
    fns: ['findMinBruteForce', 'findMinRecursive', 'findMin'],
    cases: [
      { args: [[3, 4, 5, 1, 2]], expect: 1 },
      { args: [[4, 5, 6, 7, 0, 1, 2]], expect: 0 },
      { args: [[11, 13, 15, 17]], expect: 11 },
    ],
  },
  '12-binary-search/07-median-of-two-sorted-arrays.md': {
    fns: ['findMedianSortedArraysBruteForce', 'findMedianSortedArraysKth', 'findMedianSortedArrays'],
    cases: [
      { args: [[1, 3], [2]], expect: 2 },
      { args: [[1, 2], [3, 4]], expect: 2.5 },
      { args: [[], [1]], expect: 1 },
    ],
  },
  '13-heap/01-kth-largest-element.md': {
    fns: ['findKthLargestBruteForce', 'findKthLargestHeap', 'findKthLargest'],
    cases: [
      { args: [[3, 2, 1, 5, 6, 4], 2], expect: 5 },
      { args: [[3, 2, 3, 1, 2, 4, 5, 5, 6], 4], expect: 4 },
    ],
  },
  '13-heap/02-ipo.md': {
    fns: ['findMaximizedCapitalBruteForce', 'findMaximizedCapitalSorted', 'findMaximizedCapital'],
    cases: [
      { args: [2, 0, [1, 2, 3], [0, 1, 1]], expect: 4 },
      { args: [3, 0, [1, 2, 3], [0, 1, 2]], expect: 6 },
    ],
  },
  '13-heap/03-k-pairs-smallest-sums.md': {
    fns: ['kSmallestPairsBruteForce', 'kSmallestPairsHeap', 'kSmallestPairs'],
    cases: [
      { args: [[1, 7, 11], [2, 4, 6], 3], expect: [[1, 2], [1, 4], [1, 6]] },
      { args: [[1, 1, 2], [1, 2, 3], 2], expect: [[1, 1], [1, 1]] },
    ],
  },
  '13-heap/04-median-finder.md': {    script: `
function exerciseMedian(C) {
  const m = new C();
  const out = [];
  m.addNum(1); m.addNum(2);
  out.push(m.findMedian());
  m.addNum(3);
  out.push(m.findMedian());
  m.addNum(6); m.addNum(5); m.addNum(4);
  out.push(m.findMedian());
  return out;
}
for (const C of [MedianFinderBruteForce, MedianFinderSorted, MedianFinder]) {
  assertEq(exerciseMedian(C), [1.5, 2, 3.5], 'running medians');
}
console.log('ASSERT-OK 3');`,
  },
  '14-backtracking/01-letter-combinations.md': {
    // PHONE_MAP comes from the Level 1 block.
    fns: ['letterCombinationsBruteForce', 'letterCombinationsRecursive', 'letterCombinations'],
    cases: [
      { args: ['23'], expect: ['ad', 'ae', 'af', 'bd', 'be', 'bf', 'cd', 'ce', 'cf'] },
      { args: ['2'], expect: ['a', 'b', 'c'] },
      { args: [''], expect: [] },
    ],
  },
  '14-backtracking/02-combinations.md': {
    // Levels emit different orders (bitmask vs lex): compare as sets.
    script: `
const normCombos = (lists) => lists.map((c) => c.join(',')).sort();
const EXPECTED_COMBOS = normCombos([[1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4]]);
for (const fn of [combineBruteForce, combineBinaryChoice, combine]) {
  assertEq(normCombos(fn(4, 2)), EXPECTED_COMBOS, 'six combos');
  assertEq(normCombos(fn(1, 1)), normCombos([[1]]), 'single combo');
}
console.log('ASSERT-OK 6');`,
  },
  '14-backtracking/03-permutations.md': {    // Levels emit different orders: compare order-insensitively.
    script: `
const normPerms = (lists) => lists.map((p) => p.join(',')).sort();
const EXPECTED_PERMS = normPerms([[1, 2, 3], [1, 3, 2], [2, 1, 3], [2, 3, 1], [3, 1, 2], [3, 2, 1]]);
for (const fn of [permuteBruteForce, permuteUsedArray, permute]) {
  assertEq(normPerms(fn([1, 2, 3])), EXPECTED_PERMS, 'six permutations');
  assertEq(normPerms(fn([0, 1])), normPerms([[0, 1], [1, 0]]), 'two permutations');
}
console.log('ASSERT-OK 6');`,
  },
  '14-backtracking/04-combination-sum.md': {
    // Levels emit different orders: compare as multisets of sorted combos.
    script: `
const normCombos = (lists) => lists.map((c) => [...c].sort((a, b) => a - b).join(',')).sort();
const EXPECTED_CS = normCombos([[2, 2, 3], [7]]);
for (const fn of [combinationSumBruteForce, combinationSumReuse, combinationSum]) {
  assertEq(normCombos(fn([2, 3, 6, 7], 7)), EXPECTED_CS, 'example 1');
  assertEq(normCombos(fn([2], 1)), [], 'no solution');
}
console.log('ASSERT-OK 6');`,
  },
  '14-backtracking/05-n-queens-ii.md': {
    fns: ['totalNQueensBruteForce', 'totalNQueensSets', 'totalNQueens'],
    cases: [
      { args: [4], expect: 2 },
      { args: [1], expect: 1 },
      { args: [2], expect: 0 },
    ],
  },
  '14-backtracking/06-generate-parentheses.md': {
    // Levels emit different orders: compare as sorted sets.
    script: `
const normParens = (lists) => [...lists].sort();
const EXPECTED_P3 = normParens(['((()))', '(()())', '(())()', '()(())', '()()()']);
for (const fn of [generateParenthesisBruteForce, generateParenthesisBacktrack, generateParenthesis]) {
  assertEq(normParens(fn(3)), EXPECTED_P3, 'five strings');
  assertEq(normParens(fn(1)), ['()'], 'single pair');
}
console.log('ASSERT-OK 6');`,
  },
  '14-backtracking/07-word-search.md': {
    // In-place levels mutate the board: fresh deep clone per call.
    fns: ['existBruteForce', 'existInPlace', 'exist'],
    cases: [
      {
        args: [[['A', 'B', 'C', 'E'], ['S', 'F', 'C', 'S'], ['A', 'D', 'E', 'E']], 'ABCCED'],
        expect: true,
      },
      {
        args: [[['A', 'B', 'C', 'E'], ['S', 'F', 'C', 'S'], ['A', 'D', 'E', 'E']], 'SEE'],
        expect: true,
      },
      {
        args: [[['A', 'B', 'C', 'E'], ['S', 'F', 'C', 'S'], ['A', 'D', 'E', 'E']], 'ABCB'],
        expect: false,
      },
    ],
  },
  '15-math/01-palindrome-number.md': {
    fns: ['isPalindromeBruteForce', 'isPalindromeReversed', 'isPalindrome'],
    cases: [
      { args: [121], expect: true },
      { args: [-121], expect: false },
      { args: [10], expect: false },
    ],
  },
  '15-math/02-plus-one.md': {
    fns: ['plusOneBruteForce', 'plusOneCarry', 'plusOne'],
    cases: [
      { args: [[1, 2, 3]], expect: [1, 2, 4] },
      { args: [[4, 3, 2, 1]], expect: [4, 3, 2, 2] },
      { args: [[9]], expect: [1, 0] },
    ],
  },
  '15-math/03-factorial-trailing-zeroes.md': {
    fns: ['trailingZeroesBruteForce', 'trailingZeroesFactorCount', 'trailingZeroes'],
    cases: [
      { args: [3], expect: 0 },
      { args: [5], expect: 1 },
      { args: [25], expect: 6 },
    ],
  },
  '15-math/04-sqrtx.md': {
    fns: ['mySqrtBruteForce', 'mySqrtBinarySearch', 'mySqrt'],
    cases: [
      { args: [4], expect: 2 },
      { args: [8], expect: 2 },
      { args: [0], expect: 0 },
      { args: [1], expect: 1 },
    ],
  },
  '15-math/05-powx-n.md': {
    // Float results: tolerance comparison, never === (see guide §5).
    script: `
for (const fn of [myPowBruteForce, myPowRecursive, myPow]) {
  assertEq(fn(2, 10), 1024, 'integer power');
  assertEq(fn(2, -2), 0.25, 'negative exponent');
  assertEq(fn(2, 0), 1, 'zero exponent');
  const got = fn(2.1, 3);
  if (Math.abs(got - 9.261) > 1e-9) {
    console.error('FAIL float power: got ' + got + ', expected ~9.261');
    process.exit(1);
  }
}
console.log('ASSERT-OK 12');`,
  },
  '15-math/06-max-points-on-a-line.md': {
    fns: ['maxPointsBruteForce', 'maxPointsSlopes', 'maxPoints'],
    cases: [
      { args: [[[1, 1], [2, 2], [3, 3]]], expect: 3 },
      {
        args: [[[1, 1], [3, 2], [5, 3], [4, 1], [2, 3], [1, 4]]],
        expect: 4,
      },
    ],
  },
  '16-one-dp/01-climbing-stairs.md': {
    fns: ['climbStairsBruteForce', 'climbStairsMemo', 'climbStairs'],
    cases: [
      { args: [2], expect: 2 },
      { args: [3], expect: 3 },
      { args: [5], expect: 8 },
    ],
  },
  '16-one-dp/02-house-robber.md': {
    fns: ['robBruteForce', 'robMemo', 'rob'],
    cases: [
      { args: [[1, 2, 3, 1]], expect: 4 },
      { args: [[2, 7, 9, 3, 1]], expect: 12 },
    ],
  },
  '16-one-dp/03-word-break.md': {
    fns: ['wordBreakBruteForce', 'wordBreakMemo', 'wordBreak'],
    cases: [
      { args: ['leetcode', ['leet', 'code']], expect: true },
      { args: ['applepenapple', ['apple', 'pen']], expect: true },
      {
        args: ['catsandog', ['cats', 'dog', 'sand', 'and', 'cat']],
        expect: false,
      },
    ],
  },
  '16-one-dp/04-coin-change.md': {
    fns: ['coinChangeBruteForce', 'coinChangeMemo', 'coinChange'],
    cases: [
      { args: [[1, 2, 5], 11], expect: 3 },
      { args: [[2], 3], expect: -1 },
      { args: [[1], 0], expect: 0 },
    ],
  },
  '16-one-dp/05-longest-increasing-subsequence.md': {
    fns: ['lengthOfLISBruteForce', 'lengthOfLISDP', 'lengthOfLIS'],
    cases: [
      { args: [[10, 9, 2, 5, 3, 7, 101, 18]], expect: 4 },
      { args: [[0, 1, 0, 3, 2, 3]], expect: 4 },
      { args: [[7, 7, 7, 7, 7, 7, 7]], expect: 1 },
    ],
  },
  '17-multi-dp/01-triangle.md': {
    fns: ['minimumTotalBruteForce', 'minimumTotalMemo', 'minimumTotal'],
    cases: [
      { args: [[[2], [3, 4], [6, 5, 7], [4, 1, 8, 3]]], expect: 11 },
      { args: [[[-10]]], expect: -10 },
    ],
  },
  '17-multi-dp/02-minimum-path-sum.md': {
    fns: ['minPathSumBruteForce', 'minPathSumMemo', 'minPathSum'],
    cases: [
      { args: [[[1, 3, 1], [1, 5, 1], [4, 2, 1]]], expect: 7 },
      { args: [[[1, 2, 3], [4, 5, 6]]], expect: 12 },
    ],
  },
  '17-multi-dp/03-unique-paths-ii.md': {
    fns: [
      'uniquePathsWithObstaclesBruteForce',
      'uniquePathsWithObstaclesMemo',
      'uniquePathsWithObstacles',
    ],
    cases: [
      { args: [[[0, 0, 0], [0, 1, 0], [0, 0, 0]]], expect: 2 },
      { args: [[[0, 1], [0, 0]]], expect: 1 },
    ],
  },
  '17-multi-dp/04-longest-palindromic-substring.md': {
    // Multiple valid answers ("bab" vs "aba"): assert length + palindromicity.
    script: `
const isPalStr = (str) => str === [...str].reverse().join('');
for (const fn of [longestPalindromeBruteForce, longestPalindromeExpand, longestPalindrome]) {
  const r1 = fn('babad');
  assertEq(r1.length === 3 && isPalStr(r1), true, 'babad longest pal');
  assertEq(fn('cbbd'), 'bb', 'even pal');
  assertEq(fn('a'), 'a', 'single char');
}
console.log('ASSERT-OK 9');`,
  },
  '17-multi-dp/05-edit-distance.md': {
    fns: ['minDistanceBruteForce', 'minDistanceMemo', 'minDistance'],
    cases: [
      { args: ['horse', 'ros'], expect: 3 },
      { args: ['intention', 'execution'], expect: 5 },
    ],
  },
  '17-multi-dp/06-interleaving-string.md': {
    fns: ['isInterleaveBruteForce', 'isInterleaveMemo', 'isInterleave'],
    cases: [
      { args: ['aabcc', 'dbbca', 'aadbbcbcac'], expect: true },
      { args: ['aabcc', 'dbbca', 'aadbbbaccc'], expect: false },
      { args: ['', '', ''], expect: true },
    ],
  },
  '17-multi-dp/07-stock-iii.md': {
    fns: ['maxProfitBruteForce', 'maxProfitMemo', 'maxProfit'],
    cases: [
      { args: [[3, 3, 5, 0, 0, 3, 1, 4]], expect: 6 },
      { args: [[1, 2, 3, 4, 5]], expect: 4 },
      { args: [[7, 6, 4, 3, 1]], expect: 0 },
    ],
  },
  '17-multi-dp/08-stock-iv.md': {
    fns: ['maxProfitBruteForce', 'maxProfitMemo', 'maxProfit'],
    cases: [
      { args: [2, [2, 4, 1]], expect: 2 },
      { args: [2, [3, 2, 6, 5, 0, 3]], expect: 7 },
    ],
  },
  '17-multi-dp/09-maximal-square.md': {
    fns: ['maximalSquareBruteForce', 'maximalSquareMemo', 'maximalSquare'],
    cases: [
      {
        args: [[['1', '0', '1', '0', '0'], ['1', '0', '1', '1', '1'], ['1', '1', '1', '1', '1'], ['1', '0', '0', '1', '0']]],
        expect: 4,
      },
      { args: [[['0']]], expect: 0 },
      { args: [[['1']]], expect: 1 },
    ],
  },
  '18-graph-general/01-number-of-islands.md': {
    // Sink levels mutate the grid: fresh deep clone per call (harness clones).
    fns: ['numIslandsBruteForce', 'numIslandsSink', 'numIslands'],
    cases: [
      {
        args: [[['1', '1', '1', '1', '0'], ['1', '1', '0', '1', '0'], ['1', '1', '0', '0', '0'], ['0', '0', '0', '0', '0']]],
        expect: 1,
      },
      {
        args: [[['1', '1', '0', '0', '0'], ['1', '1', '0', '0', '0'], ['0', '0', '1', '0', '0'], ['0', '0', '0', '1', '1']]],
        expect: 3,
      },
    ],
  },
  '18-graph-general/02-surrounded-regions.md': {
    // All levels mutate the board in place: compare the board, not a return.
    script: `
const INPUT_SR = [['X', 'X', 'X', 'X'], ['X', 'O', 'O', 'X'], ['X', 'X', 'O', 'X'], ['X', 'O', 'X', 'X']];
const EXPECTED_SR = [['X', 'X', 'X', 'X'], ['X', 'X', 'X', 'X'], ['X', 'X', 'X', 'X'], ['X', 'O', 'X', 'X']];
for (const fn of [solveBruteForce, solveBorderDFS, solve]) {
  const board = INPUT_SR.map((row) => [...row]);
  fn(board);
  assertEq(board, EXPECTED_SR, 'captured board');
}
const singleX = [['X']];
solve(singleX);
assertEq(singleX, [['X']], 'single cell');
console.log('ASSERT-OK 4');`,
  },
  '18-graph-general/03-clone-graph.md': {
    // buildGraph/graphToAdj come from the Level 1 block.
    script: `
function collectNodes(start) {
  const out = [];
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const cur = queue.shift();
    out.push(cur);
    for (const nb of cur.neighbors) {
      if (!seen.has(nb)) {
        seen.add(nb);
        queue.push(nb);
      }
    }
  }
  return out;
}
const ADJ1 = [[2, 4], [1, 3], [2, 4], [1, 3]];
for (const fn of [cloneGraphBruteForce, cloneGraphDFS, cloneGraph]) {
  const orig = buildGraph(ADJ1);
  const copy = fn(orig);
  assertEq(graphToAdj(copy), ADJ1, 'cycle topology');
  const oNodes = collectNodes(orig);
  const cNodes = collectNodes(copy);
  assertEq(cNodes.length, oNodes.length, 'same node count');
  assertEq(
    cNodes.every((n, i) => n !== oNodes[i] && n.val === oNodes[i].val),
    true,
    'deep copy, no shared nodes',
  );
}
assertEq(cloneGraph(null), null, 'null graph');
assertEq(graphToAdj(cloneGraph(buildGraph([[]]))), [[]], 'isolated node');
console.log('ASSERT-OK 11');`,
  },
  '18-graph-general/04-evaluate-division.md': {
    // Float results: tolerance comparison, never === (see guide §5).
    script: `
function approxArr(got, exp, label) {
  const ok =
    got.length === exp.length &&
    got.every((v, i) => (v === -1 && exp[i] === -1) || Math.abs(v - exp[i]) < 1e-9);
  if (!ok) {
    console.error('FAIL ' + label + ': got ' + JSON.stringify(got));
    process.exit(1);
  }
}
const EQ = [['a', 'b'], ['b', 'c']];
const VALS = [2.0, 3.0];
const QQ = [['a', 'c'], ['b', 'a'], ['a', 'e'], ['a', 'a'], ['x', 'x']];
const EXP_DIV = [6, 0.5, -1, 1, -1];
for (const fn of [calcEquationBruteForce, calcEquationBFS, calcEquation]) {
  approxArr(fn(EQ, VALS, QQ), EXP_DIV, 'division queries');
}
console.log('ASSERT-OK 3');`,
  },
  '18-graph-general/05-course-schedule.md': {
    fns: ['canFinishBruteForce', 'canFinishDFS', 'canFinish'],
    cases: [
      { args: [2, [[1, 0]]], expect: true },
      { args: [2, [[1, 0], [0, 1]]], expect: false },
    ],
  },
  '18-graph-general/06-course-schedule-ii.md': {
    // Multiple valid orders: validate topological correctness, not exact sequence.
    script: `
function validTopo(order, n, prereqs) {
  if (!Array.isArray(order) || order.length !== n) return false;
  const pos = new Map(order.map((v, i) => [v, i]));
  if (pos.size !== n) return false;
  return prereqs.every(([a, b]) => pos.get(b) < pos.get(a));
}
const PR2 = [[1, 0], [2, 0], [3, 1], [3, 2]];
for (const fn of [findOrderBruteForce, findOrderDFS, findOrder]) {
  assertEq(validTopo(fn(2, [[1, 0]]), 2, [[1, 0]]), true, 'simple order');
  assertEq(validTopo(fn(4, PR2), 4, PR2), true, 'diamond order');
  assertEq(fn(1, []), [0], 'single course');
  assertEq(fn(2, [[1, 0], [0, 1]]), [], 'cycle impossibility');
}
console.log('ASSERT-OK 12');`,
  },
  '19-graph-bfs/01-snakes-and-ladders.md': {
    fns: ['snakesAndLaddersBruteForce', 'snakesAndLaddersBFS', 'snakesAndLadders'],
    cases: [
      {
        args: [[[-1, -1, -1, -1, -1, -1], [-1, -1, -1, -1, -1, -1], [-1, -1, -1, -1, -1, -1], [-1, 35, -1, -1, 13, -1], [-1, -1, -1, -1, -1, -1], [-1, 15, -1, -1, -1, -1]]],
        expect: 4,
      },
      { args: [[[-1, -1], [-1, 3]]], expect: 1 },
    ],
  },
  '19-graph-bfs/02-minimum-genetic-mutation.md': {
    fns: ['minMutationBruteForce', 'minMutationBFS', 'minMutation'],
    cases: [
      { args: ['AACCGGTT', 'AACCGGTA', ['AACCGGTA']], expect: 1 },
      {
        args: ['AACCGGTT', 'AAACGGTA', ['AACCGGTA', 'AACCGCTA', 'AAACGGTA']],
        expect: 2,
      },
      { args: ['AACCGGTT', 'AACCGGTA', []], expect: -1 },
    ],
  },
  '19-graph-bfs/03-word-ladder.md': {
    fns: ['ladderLengthBruteForce', 'ladderLengthBFS', 'ladderLength'],
    cases: [
      {
        args: ['hit', 'cog', ['hot', 'dot', 'dog', 'lot', 'log', 'cog']],
        expect: 5,
      },
      { args: ['hit', 'cog', ['hot', 'dot', 'dog', 'lot', 'log']], expect: 0 },
    ],
  },
  '20-trie/01-implement-trie.md': {
    // Class APIs: exercise the LeetCode op sequence per level.
    script: `
function exerciseTrie(C) {
  const t = new C();
  const out = [];
  t.insert('apple');
  out.push(t.search('apple'));
  out.push(t.search('app'));
  out.push(t.startsWith('app'));
  t.insert('app');
  out.push(t.search('app'));
  return out;
}
const EXPECTED_TRIE = [true, false, true, true];
for (const C of [TrieBruteForce, TrieObject, Trie]) {
  assertEq(exerciseTrie(C), EXPECTED_TRIE, 'trie op sequence');
}
console.log('ASSERT-OK 3');`,
  },
  '20-trie/02-add-and-search-words.md': {
    script: `
function exerciseWD(C) {
  const d = new C();
  d.addWord('bad');
  d.addWord('dad');
  d.addWord('mad');
  return [d.search('pad'), d.search('bad'), d.search('.ad'), d.search('b..')];
}
const EXPECTED_WD = [false, true, true, true];
for (const C of [WordDictionaryBruteForce, WordDictionaryRecursive, WordDictionary]) {
  assertEq(exerciseWD(C), EXPECTED_WD, 'wildcard sequence');
}
console.log('ASSERT-OK 3');`,
  },
  '20-trie/03-word-search-ii.md': {
    // Levels emit different orders: compare as sorted sets. Boards restored.
    script: `
const normWords = (lists) => [...lists].sort();
const BOARD_WS2 = [['o', 'a', 'a', 'n'], ['e', 't', 'a', 'e'], ['i', 'h', 'k', 'r'], ['i', 'f', 'l', 'v']];
const WORDS_WS2 = ['oath', 'pea', 'eat', 'rain'];
const EXPECTED_WS2 = normWords(['eat', 'oath']);
for (const fn of [findWordsBruteForce, findWordsTrie, findWords]) {
  const board = BOARD_WS2.map((row) => [...row]);
  assertEq(normWords(fn(board, WORDS_WS2)), EXPECTED_WS2, 'found words');
  assertEq(board.every((row, r) => row.every((ch, c) => ch === BOARD_WS2[r][c])), true, 'board restored');
}
console.log('ASSERT-OK 6');`,
  },
  '21-divide-conquer/01-sorted-array-to-bst.md': {
    // inorderVals/treeHeight come from the Level 1 block. Any balanced shape accepted.
    script: `
for (const fn of [sortedArrayToBSTBruteForce, sortedArrayToBSTSliced, sortedArrayToBST]) {
  const t = fn([-10, -3, 0, 5, 9]);
  assertEq(inorderVals(t), [-10, -3, 0, 5, 9], 'bst inorder = input');
}
for (const fn of [sortedArrayToBSTSliced, sortedArrayToBST]) {
  assertEq(treeHeight(fn([-10, -3, 0, 5, 9])) <= 3, true, 'balanced height');
  assertEq(inorderVals(fn([])), [], 'empty input');
}
console.log('ASSERT-OK 8');`,
  },
  '21-divide-conquer/02-sort-list.md': {
    // arrayToList/listToArray come from the Level 1 block.
    script: `
for (const fn of [sortListBruteForce, sortListMergeSort, sortList]) {
  assertEq(listToArray(fn(arrayToList([4, 2, 1, 3]))), [1, 2, 3, 4], 'basic sort');
  assertEq(listToArray(fn(arrayToList([-1, 5, 3, 4, 0]))), [-1, 0, 3, 4, 5], 'signed sort');
  assertEq(fn(arrayToList([])), null, 'empty list');
}
console.log('ASSERT-OK 9');`,
  },
  '21-divide-conquer/03-construct-quad-tree.md': {
    // quadToGrid comes from the Level 1 block: any valid tree expands to input.
    script: `
const QT1 = [[0, 1], [1, 0]];
const QT2 = [[1, 1, 1, 1, 0, 0, 0, 0], [1, 1, 1, 1, 0, 0, 0, 0], [1, 1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 0, 0, 0, 0], [1, 1, 1, 1, 0, 0, 0, 0], [1, 1, 1, 1, 0, 0, 0, 0], [1, 1, 1, 1, 0, 0, 0, 0]];
for (const fn of [constructBruteForce, constructPrefixSum, construct]) {
  assertEq(quadToGrid(fn(QT1), 2), QT1, 'checkerboard round-trip');
  assertEq(quadToGrid(fn(QT2), 8), QT2, 'example 2 round-trip');
}
console.log('ASSERT-OK 6');`,
  },
  '21-divide-conquer/04-merge-k-sorted-lists.md': {
    // arrayToList/listToArray come from the Level 1 block.
    script: `
const KL1 = [[1, 4, 5], [1, 3, 4], [2, 6]];
const EXPECTED_KL1 = [1, 1, 2, 3, 4, 4, 5, 6];
for (const fn of [mergeKListsBruteForce, mergeKListsDivideConquer, mergeKLists]) {
  assertEq(listToArray(fn(KL1.map(arrayToList))), EXPECTED_KL1, 'merged order');
  assertEq(fn([]), null, 'empty array');
  assertEq(fn([null]), null, 'null heads');
}
console.log('ASSERT-OK 9');`,
  },
  '22-bit-manipulation/01-add-binary.md': {
    fns: ['addBinaryBruteForce', 'addBinaryPrepend', 'addBinary'],
    cases: [
      { args: ['11', '1'], expect: '100' },
      { args: ['1010', '1011'], expect: '10101' },
      { args: ['0', '0'], expect: '0' },
    ],
  },
  '22-bit-manipulation/02-reverse-bits.md': {
    fns: ['reverseBitsBruteForce', 'reverseBitsLoop', 'reverseBits'],
    cases: [
      { args: [43261596], expect: 964176192 },
      { args: [4294967293], expect: 3221225471 },
    ],
  },
  '22-bit-manipulation/03-number-of-1-bits.md': {
    fns: ['hammingWeightBruteForce', 'hammingWeightLoop', 'hammingWeight'],
    cases: [
      { args: [11], expect: 3 },
      { args: [128], expect: 1 },
      { args: [4294967293], expect: 31 },
    ],
  },
  '22-bit-manipulation/04-single-number.md': {
    fns: ['singleNumberBruteForce', 'singleNumberSet', 'singleNumber'],
    cases: [
      { args: [[2, 2, 1]], expect: 1 },
      { args: [[4, 1, 2, 1, 2]], expect: 4 },
      { args: [[1]], expect: 1 },
    ],
  },
  '22-bit-manipulation/05-single-number-ii.md': {
    fns: ['singleNumberIIBruteForce', 'singleNumberIIMap', 'singleNumberII'],
    cases: [
      { args: [[2, 2, 3, 2]], expect: 3 },
      { args: [[0, 1, 0, 1, 0, 1, 99]], expect: 99 },
    ],
  },
  '22-bit-manipulation/06-bitwise-and-range.md': {
    fns: ['rangeBitwiseAndBruteForce', 'rangeBitwiseAndShifts', 'rangeBitwiseAnd'],
    cases: [
      { args: [5, 7], expect: 4 },
      { args: [0, 0], expect: 0 },
      { args: [1, 1], expect: 1 },
      { args: [10, 11], expect: 10 },
    ],
  },
  '23-kadanes-algorithm/01-maximum-subarray.md': {
    fns: ['maxSubArrayBruteForce', 'maxSubArrayDivideConquer', 'maxSubArray'],
    cases: [
      { args: [[-2, 1, -3, 4, -1, 2, 1, -5, 4]], expect: 6 },
      { args: [[1]], expect: 1 },
      { args: [[5, 4, -1, 7, 8]], expect: 23 },
    ],
  },
  '23-kadanes-algorithm/02-maximum-sum-circular-subarray.md': {
    fns: [
      'maxSubarraySumCircularBruteForce',
      'maxSubarraySumCircularTwoPass',
      'maxSubarraySumCircular',
    ],
    cases: [
      { args: [[1, -2, 3, -2]], expect: 3 },
      { args: [[5, -3, 5]], expect: 10 },
      { args: [[-3, -2, -3]], expect: -2 },
    ],
  },
};
const ASSERT_PRELUDE = `
function assertEq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error('FAIL ' + label + ': got ' + a + ', expected ' + e);
    process.exit(1);
  }
}
`;

function buildFnHarness(fns, cases) {
  const fnMap = fns.map((n) => `  ${JSON.stringify(n)}: ${n}`).join(',\n');
  const caseSrc = cases
    .map((c) => `    { argsJson: ${JSON.stringify(JSON.stringify(c.args))}, expect: ${JSON.stringify(c.expect)} }`)
    .join(',\n');
  return `${ASSERT_PRELUDE}
const __fns = {
${fnMap}
};
const __cases = [
${caseSrc}
];
let __n = 0;
for (const [__fname, __fn] of Object.entries(__fns)) {
  for (const __c of __cases) {
    const __args = JSON.parse(__c.argsJson);
    const __got = __fn(...__args);
    __n++;
    if (JSON.stringify(__got) !== JSON.stringify(__c.expect)) {
      console.error('FAIL ' + __fname + '(' + __c.argsJson + '): got ' + JSON.stringify(__got) + ', expected ' + JSON.stringify(__c.expect));
      process.exit(1);
    }
  }
}
console.log('ASSERT-OK ' + __n);`;
}

function extractJsBlocks(content) {
  return [...content.matchAll(/```javascript([\s\S]*?)```/g)].map((m) => m[1]);
}

function collectProblemFiles() {
  const files = [];
  function scan(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'scripts' || entry.name === '00-foundations') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(full);
      else if (entry.name.endsWith('.md') && !entry.name.includes('PLAN') && !entry.name.includes('README')) files.push(full);
    }
  }
  scan(ROOT_DIR);
  return files.sort();
}

function checkSyntax(code, label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc150-'));
  const tmp = path.join(dir, 'snippet.mjs');
  fs.writeFileSync(tmp, code, 'utf-8');
  try {
    execFileSync('node', ['--check', tmp], { stdio: 'pipe', timeout: 15000 });
  } catch (err) {
    const detail = (err.stderr?.toString() || err.message).trim().split('\n').slice(0, 5).join('\n');
    throw new Error(`syntax error in ${label}:\n${detail}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function runRuntimeHarness(levelBlocks, harness, label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc150-'));
  const tmp = path.join(dir, 'runtest.mjs');
  fs.writeFileSync(tmp, levelBlocks.join('\n') + '\n' + harness + '\n', 'utf-8');
  try {
    const out = execFileSync('node', [tmp], { stdio: 'pipe', timeout: 20000, encoding: 'utf-8' });
    const m = out.match(/ASSERT-OK (\d+)/);
    return m ? Number(m[1]) : 0;
  } catch (err) {
    const detail = ((err.stdout?.toString() || '') + (err.stderr?.toString() || err.message)).trim().split('\n').slice(0, 8).join('\n');
    throw new Error(`runtime failure in ${label}:\n${detail}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function runFullTests(filter = null) {
  console.log('🧪 Starting Executable Code Verification (syntax + runtime)...\n');
  const files = collectProblemFiles().filter((f) => !filter || f.includes(filter));

  let syntaxChecked = 0;
  let runtimeFiles = 0;
  let syntaxOnlyFiles = 0;
  let assertions = 0;
  let failures = 0;

  for (const file of files) {
    const rel = path.relative(ROOT_DIR, file);
    const content = fs.readFileSync(file, 'utf-8');

    // Phase 1: structural gate (same invariants as validate-guide.mjs).
    const structural = validateProblemGuide(file);
    if (!structural.isValid) {
      console.error(`❌ [STRUCT] ${rel}`);
      structural.errors.forEach((e) => console.error(`   - ${e}`));
      failures++;
      continue;
    }

    // Phase 2: node --check on Level 1-3 blocks (must be standalone-parseable).
    const blocks = extractJsBlocks(content);
    const levelBlocks = blocks.slice(0, 3);
    if (levelBlocks.length < 3) {
      console.error(`❌ [SYNTAX] ${rel} — fewer than 3 JS blocks`);
      failures++;
      continue;
    }
    try {
      levelBlocks.forEach((b, i) => checkSyntax(b, `${rel} level ${i + 1}`));
      syntaxChecked += levelBlocks.length;
    } catch (err) {
      console.error(`❌ [SYNTAX] ${rel}\n   ${err.message.split('\n').join('\n   ')}`);
      failures++;
      continue;
    }

    // Phase 3: runtime LeetCode-sample assertions (registry entries only).
    const entry = RUNTIME_TESTS[rel];
    if (!entry) {
      console.log(`⚪ [SYNTAX-ONLY] ${rel} — no runtime entry yet`);
      syntaxOnlyFiles++;
      continue;
    }
    try {
      const harness = entry.script
        ? ASSERT_PRELUDE + entry.script
        : buildFnHarness(entry.fns, entry.cases);
      const n = runRuntimeHarness(levelBlocks, harness, rel);
      assertions += n;
      runtimeFiles++;
      console.log(`✅ [PASS] ${rel} (${n} assertions)`);
    } catch (err) {
      console.error(`❌ [RUNTIME] ${rel}\n   ${err.message.split('\n').join('\n   ')}`);
      failures++;
    }
  }

  console.log(`\n========================================`);
  console.log(`Files: ${files.length} (runtime-tested: ${runtimeFiles}, syntax-only: ${syntaxOnlyFiles})`);
  console.log(`Syntax blocks checked: ${syntaxChecked} | Runtime assertions: ${assertions}`);
  console.log(`Failures: ${failures}`);
  console.log(`========================================\n`);

  if (failures > 0) process.exit(1);
}

const cliFilter = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : null;
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runFullTests(cliFilter);
}

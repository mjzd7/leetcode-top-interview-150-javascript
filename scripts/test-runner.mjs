import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { fileURLToPath, pathToFileURL } from 'url';
import { validateProblemGuide } from './validate-guide.mjs';
// The differential phase reuses row 6's canonical serializer and row 17's
// equivalence comparators under these exact names. The sandbox imports the same
// two modules under the same two names, which is what lets every function below
// be shipped into the sandbox by `.toString()` instead of being written twice.
import { serialize, stringify as canonText } from './lib/serialize.mjs';
import { equivalent as equivKind } from '../api/_lib/codecs.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Runtime test registry.
//
// Key: problem file path relative to repo root.
// Value: either
//   { cases: [{ args: [...jsonValues], expect: jsonValue }] }
//     — the guide's Level 1, 2 and 3 functions are each called with a fresh deep
//       clone of args and their return value must deep-equal expect, or
//   { script: `raw JS appended after the Level 1-3 blocks` }
//     — for class-based / in-place-mutating APIs. Use assertEq(actual,
//       expected, label) and end with console.log('ASSERT-OK n').
// Files with no entry get syntax checks only (reported as SYNTAX-ONLY).
// To extend coverage, add one entry per file following the examples below.
//
// Function NAMES are not declared here. They live once, in the guide's own
// Level 1-3 blocks, and gen-blocks.mjs publishes them in build/blocks.json as
// each block's `targetFn` — see loadTargetFns(). Re-declaring them here made one
// fact live in three places (guide, registry, manifest); plan invariant 2 says
// nothing re-declares a slug or fn name. .ast-grep/rules/no-runtime-tests-fns.yml
// fails the build if an `fns` key ever comes back.
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
    cases: [
      { args: [['2', '1', '+', '3', '*']], expect: 9 },
      { args: [['4', '13', '5', '/', '+']], expect: 6 },
      { args: [['18']], expect: 18 },
    ],
  },
  '07-stack/05-basic-calculator.md': {
    cases: [
      { args: ['1 + 1'], expect: 2 },
      { args: [' 2-1 + 2 '], expect: 3 },
      { args: ['(1+(4+5+2)-3)+(6+8)'], expect: 23 },
    ],
  },
  '07-stack/01-valid-parentheses.md': {
    cases: [
      { args: ['()[]{}'], expect: true },
      { args: ['(]'], expect: false },
      { args: ['([)]'], expect: false },
    ],
  },
  '02-two-pointers/01-valid-palindrome.md': {
    cases: [
      { args: ['A man, a plan, a canal: Panama'], expect: true },
      { args: ['race a car'], expect: false },
    ],
  },
  '02-two-pointers/04-container-with-most-water.md': {
    cases: [
      { args: [[1, 8, 6, 2, 5, 4, 8, 3, 7]], expect: 49 },
      { args: [[1, 1]], expect: 1 },
    ],
  },
  '05-hashmap/06-two-sum.md': {
    cases: [
      { args: [[2, 7, 11, 15], 9], expect: [0, 1] },
      { args: [[3, 2, 4], 6], expect: [1, 2] },
    ],
  },
  '05-hashmap/04-valid-anagram.md': {
    cases: [
      { args: ['anagram', 'nagaram'], expect: true },
      { args: ['rat', 'car'], expect: false },
    ],
  },
  '05-hashmap/09-longest-consecutive-sequence.md': {
    cases: [
      { args: [[100, 4, 200, 1, 3, 2]], expect: 4 },
      { args: [[0]], expect: 1 },
    ],
  },
  '01-array-string/19-length-of-last-word.md': {
    cases: [
      { args: ['Hello World'], expect: 5 },
      { args: ['   fly me   to   the moon  '], expect: 4 },
    ],
  },
  '01-array-string/17-roman-to-integer.md': {
    cases: [
      { args: ['III'], expect: 3 },
      { args: ['LVIII'], expect: 58 },
      { args: ['MCMXCIV'], expect: 1994 },
    ],
  },
  '01-array-string/07-best-time-to-buy-and-sell-stock.md': {
    cases: [
      { args: [[7, 1, 5, 3, 6, 4]], expect: 5 },
      { args: [[7, 6, 4, 3, 1]], expect: 0 },
    ],
  },
  '01-array-string/16-trapping-rain-water.md': {
    cases: [
      { args: [[0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1]], expect: 6 },
    ],
  },
  '03-sliding-window/02-longest-substring-without-repeating-characters.md': {
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
    cases: [
      { args: [[1, 3, 5, 6], 5], expect: 2 },
      { args: [[1, 3, 5, 6], 2], expect: 1 },
      { args: [[1, 3, 5, 6], 7], expect: 4 },
    ],
  },
  '12-binary-search/02-search-2d-matrix.md': {
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
    cases: [
      { args: [[4, 5, 6, 7, 0, 1, 2], 0], expect: 4 },
      { args: [[4, 5, 6, 7, 0, 1, 2], 3], expect: -1 },
      { args: [[1], 0], expect: -1 },
    ],
  },
  '12-binary-search/05-first-and-last-position.md': {
    cases: [
      { args: [[5, 7, 7, 8, 8, 10], 8], expect: [3, 4] },
      { args: [[5, 7, 7, 8, 8, 10], 6], expect: [-1, -1] },
      { args: [[], 0], expect: [-1, -1] },
    ],
  },
  '12-binary-search/06-find-minimum-rotated.md': {
    cases: [
      { args: [[3, 4, 5, 1, 2]], expect: 1 },
      { args: [[4, 5, 6, 7, 0, 1, 2]], expect: 0 },
      { args: [[11, 13, 15, 17]], expect: 11 },
    ],
  },
  '12-binary-search/07-median-of-two-sorted-arrays.md': {
    cases: [
      { args: [[1, 3], [2]], expect: 2 },
      { args: [[1, 2], [3, 4]], expect: 2.5 },
      { args: [[], [1]], expect: 1 },
    ],
  },
  '13-heap/01-kth-largest-element.md': {
    cases: [
      { args: [[3, 2, 1, 5, 6, 4], 2], expect: 5 },
      { args: [[3, 2, 3, 1, 2, 4, 5, 5, 6], 4], expect: 4 },
    ],
  },
  '13-heap/02-ipo.md': {
    cases: [
      { args: [2, 0, [1, 2, 3], [0, 1, 1]], expect: 4 },
      { args: [3, 0, [1, 2, 3], [0, 1, 2]], expect: 6 },
    ],
  },
  '13-heap/03-k-pairs-smallest-sums.md': {
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
    cases: [
      { args: [121], expect: true },
      { args: [-121], expect: false },
      { args: [10], expect: false },
    ],
  },
  '15-math/02-plus-one.md': {
    cases: [
      { args: [[1, 2, 3]], expect: [1, 2, 4] },
      { args: [[4, 3, 2, 1]], expect: [4, 3, 2, 2] },
      { args: [[9]], expect: [1, 0] },
    ],
  },
  '15-math/03-factorial-trailing-zeroes.md': {
    cases: [
      { args: [3], expect: 0 },
      { args: [5], expect: 1 },
      { args: [25], expect: 6 },
    ],
  },
  '15-math/04-sqrtx.md': {
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
    cases: [
      { args: [[[1, 1], [2, 2], [3, 3]]], expect: 3 },
      {
        args: [[[1, 1], [3, 2], [5, 3], [4, 1], [2, 3], [1, 4]]],
        expect: 4,
      },
    ],
  },
  '16-one-dp/01-climbing-stairs.md': {
    cases: [
      { args: [2], expect: 2 },
      { args: [3], expect: 3 },
      { args: [5], expect: 8 },
    ],
  },
  '16-one-dp/02-house-robber.md': {
    cases: [
      { args: [[1, 2, 3, 1]], expect: 4 },
      { args: [[2, 7, 9, 3, 1]], expect: 12 },
    ],
  },
  '16-one-dp/03-word-break.md': {
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
    cases: [
      { args: [[1, 2, 5], 11], expect: 3 },
      { args: [[2], 3], expect: -1 },
      { args: [[1], 0], expect: 0 },
    ],
  },
  '16-one-dp/05-longest-increasing-subsequence.md': {
    cases: [
      { args: [[10, 9, 2, 5, 3, 7, 101, 18]], expect: 4 },
      { args: [[0, 1, 0, 3, 2, 3]], expect: 4 },
      { args: [[7, 7, 7, 7, 7, 7, 7]], expect: 1 },
    ],
  },
  '17-multi-dp/01-triangle.md': {
    cases: [
      { args: [[[2], [3, 4], [6, 5, 7], [4, 1, 8, 3]]], expect: 11 },
      { args: [[[-10]]], expect: -10 },
    ],
  },
  '17-multi-dp/02-minimum-path-sum.md': {
    cases: [
      { args: [[[1, 3, 1], [1, 5, 1], [4, 2, 1]]], expect: 7 },
      { args: [[[1, 2, 3], [4, 5, 6]]], expect: 12 },
    ],
  },
  '17-multi-dp/03-unique-paths-ii.md': {
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
    cases: [
      { args: ['horse', 'ros'], expect: 3 },
      { args: ['intention', 'execution'], expect: 5 },
    ],
  },
  '17-multi-dp/06-interleaving-string.md': {
    cases: [
      { args: ['aabcc', 'dbbca', 'aadbbcbcac'], expect: true },
      { args: ['aabcc', 'dbbca', 'aadbbbaccc'], expect: false },
      { args: ['', '', ''], expect: true },
    ],
  },
  '17-multi-dp/07-stock-iii.md': {
    cases: [
      { args: [[3, 3, 5, 0, 0, 3, 1, 4]], expect: 6 },
      { args: [[1, 2, 3, 4, 5]], expect: 4 },
      { args: [[7, 6, 4, 3, 1]], expect: 0 },
    ],
  },
  '17-multi-dp/08-stock-iv.md': {
    cases: [
      { args: [2, [2, 4, 1]], expect: 2 },
      { args: [2, [3, 2, 6, 5, 0, 3]], expect: 7 },
    ],
  },
  '17-multi-dp/09-maximal-square.md': {
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
    cases: [
      {
        args: [[[-1, -1, -1, -1, -1, -1], [-1, -1, -1, -1, -1, -1], [-1, -1, -1, -1, -1, -1], [-1, 35, -1, -1, 13, -1], [-1, -1, -1, -1, -1, -1], [-1, 15, -1, -1, -1, -1]]],
        expect: 4,
      },
      { args: [[[-1, -1], [-1, 3]]], expect: 1 },
    ],
  },
  '19-graph-bfs/02-minimum-genetic-mutation.md': {
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
    cases: [
      { args: ['11', '1'], expect: '100' },
      { args: ['1010', '1011'], expect: '10101' },
      { args: ['0', '0'], expect: '0' },
    ],
  },
  '22-bit-manipulation/02-reverse-bits.md': {
    cases: [
      { args: [43261596], expect: 964176192 },
      { args: [4294967293], expect: 3221225471 },
    ],
  },
  '22-bit-manipulation/03-number-of-1-bits.md': {
    cases: [
      { args: [11], expect: 3 },
      { args: [128], expect: 1 },
      { args: [4294967293], expect: 31 },
    ],
  },
  '22-bit-manipulation/04-single-number.md': {
    cases: [
      { args: [[2, 2, 1]], expect: 1 },
      { args: [[4, 1, 2, 1, 2]], expect: 4 },
      { args: [[1]], expect: 1 },
    ],
  },
  '22-bit-manipulation/05-single-number-ii.md': {
    cases: [
      { args: [[2, 2, 3, 2]], expect: 3 },
      { args: [[0, 1, 0, 1, 0, 1, 99]], expect: 99 },
    ],
  },
  '22-bit-manipulation/06-bitwise-and-range.md': {
    cases: [
      { args: [5, 7], expect: 4 },
      { args: [0, 0], expect: 0 },
      { args: [1, 1], expect: 1 },
      { args: [10, 11], expect: 10 },
    ],
  },
  '23-kadanes-algorithm/01-maximum-subarray.md': {
    cases: [
      { args: [[-2, 1, -3, 4, -1, 2, 1, -5, 4]], expect: 6 },
      { args: [[1]], expect: 1 },
      { args: [[5, 4, -1, 7, 8]], expect: 23 },
    ],
  },
  '23-kadanes-algorithm/02-maximum-sum-circular-subarray.md': {
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

const MANIFEST_PATH = path.join(ROOT_DIR, 'build', 'blocks.json');
const REGEN_HINT = 'regenerate it with: node scripts/gen-blocks.mjs';
const CASES_PATH = path.join(ROOT_DIR, 'catalog', 'cases.json');
const PROBLEMS_PATH = path.join(ROOT_DIR, 'catalog', 'problems.json');

// ===========================================================================
// V4 differential phase (plan v5 §7 row 19, §6 E28, §3 D14/F7, §6 E33).
//
// The oracle that decides whether 150 guides' three solutions agree. It is
// seeded (D14: a differential run that changes every time cannot be a CI gate),
// it compares by the guide's DECLARED equivalence kind (E28), and it shrinks a
// divergence to a minimal input instead of printing 200 lines of array.
//
// Every function in this block is pure and dependency-free on purpose: the
// sandbox gets them by `.toString()`, so one implementation serves both the
// fixtures below and the 150 real guides. A second copy would be a second
// answer to "does L1 agree with L3".
// ===========================================================================

/**
 * Plan E33's tiered exec counts. The default is the cheapest tier because this
 * phase runs inside `npm test`; F7's whole point is that the expensive tiers are
 * opt-in, not the thing every PR pays for.
 *
 * ponytail: a flat per-problem count, not a wall-clock budget or a per-module
 * table. F7 asked for a reduced count on two modules (`15-math`,
 * `22-bit-manipulation`) because a single slow guide ate the budget; the real
 * problem there was per-exec cost, which a per-problem cap cannot express and a
 * timing-based cap would make CI non-reproducible. Upgrade path: an optional
 * `reducedPerProblem` on the catalog entry once a module is measurably slow
 * (median wall time over 20 runs), not before.
 */
const DIFF_TIERS = Object.freeze({ pr: 5, module: 50, nightly: 200, full: 2000 });

// ponytail: one wall-clock cap for the whole per-guide run, not a cap per exec.
// A per-exec cap needs a worker or a subprocess per attempt (435 of them at the
// cheap tier); the guide-level cap buys the same protection for 87 spawns. Its
// ceiling: a guide slow enough to eat 20s of legitimate work is reported as a
// timeout instead of finishing. Upgrade path: per-exec only if the nightly tier
// ever shows a guide at the boundary — measured, not speculative.
const DIFF_SANDBOX_TIMEOUT_MS = 20_000;

// Named so the fixture can assert the default without reading the ambient
// environment: `DIFF_TIER=nightly npm test` is a legitimate invocation, and a
// check that demanded `pr` there would fail the one run that asked for more.
const DIFF_DEFAULT_TIER = 'pr';

/** `--differential-tier=<name>`, else `DIFF_TIER`, else the cheap tier. */
function differentialTierEnv() {
  const flag = process.argv.find((a) => a.startsWith('--differential-tier='));
  return (flag ? flag.slice('--differential-tier='.length) : process.env.DIFF_TIER) || DIFF_DEFAULT_TIER;
}

function differentialTier(name) {
  const perProblem = DIFF_TIERS[name];
  if (!perProblem) {
    throw new Error(`unknown differential tier "${name}". Known tiers: ${Object.keys(DIFF_TIERS).join(', ')}`);
  }
  return { name, perProblem };
}

/**
 * FNV-1a over `path#caseIndex`. Seed from the guide path so a CI failure names
 * the guide that produced it and re-runs identically on the next machine.
 * `Math.random()` here would make the whole phase unrepeatable.
 */
function diffSeedFor(rel, caseIndex) {
  let h = 0x811c9dc5;
  for (const ch of `${rel}#${caseIndex}`) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * mulberry32 — 5 lines, no dependency, and its state is a single uint32 so a
 * seed is the whole reproducibility story. ponytail: uniform-enough, not
 * cryptographic; this generates test inputs, never keys.
 */
function diffMulberry32(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.int = (lo, hi) => lo + Math.floor(next() * (hi - lo + 1));
  return next;
}

/** Seeded stream for one guide. `ints(n, lo, hi)` is the only draw it needs. */
function seededRandom(rel, caseIndex) {
  const rng = diffMulberry32(diffSeedFor(rel, caseIndex));
  return {
    rng,
    ints: (n, lo, hi) => Array.from({ length: n }, () => rng.int(lo, hi)),
  };
}

/**
 * One input perturbation: scalars are REDRAWN IN PLACE, structure is untouched.
 *
 * Shape-preserving is the whole design. A generator that could insert a null or
 * change an argument's arity would spend most of its budget on inputs no LeetCode
 * problem admits, and every "divergence" it found would be an invalid instance
 * rather than a wrong solution — noise wearing a bug's clothes. Changing only
 * leaf values keeps arity, null placement, matrix rank and tree topology exactly
 * as the guide's own authored case declared them.
 *
 * The one structural rule: a run of numbers that was already non-decreasing
 * stays non-decreasing after perturbation. Sortedness is the single most common
 * LeetCode precondition, and it is invisible in the JSON — but
 * `median-of-two-sorted-arrays`'s canonical literally `throw`s on unsorted input,
 * so without this the phase would report that guide as divergent on garbage.
 * Repairing monotonicity costs one sort and is stated as a property of the
 * already-sorted input, not guessed per problem.
 *
 * ponytail: perturbs leaves only. It never inserts, deletes or reorders, never
 * invents a string of a different length, and it knows nothing about a problem's
 * actual constraints (`n <= 10^5`, `1 <= target`, target must occur in nums).
 * Upgrade path: a per-catalog `perturb` hint if a guide class proves untunable
 * here — measured, not speculative.
 */
function diffPerturb(value, rng, domain) {
  if (Array.isArray(value)) {
    // Monotonicity is read off the ORIGINAL, then imposed on the perturbed copy.
    // Reading it off the perturbed copy was wrong in a way that showed up
    // immediately: `remove-duplicates-from-sorted-array` was handed `[2,0,2]`,
    // which is not sorted, so two implementations of a sorted-input problem
    // legitimately disagreed and the oracle called it a divergence.
    const wasMonotonic = value.every((n, i) => i === 0 || typeof n !== 'number' || n >= value[i - 1]);
    const out = value.map((v) => diffPerturb(v, rng, domain));
    if (wasMonotonic) out.sort((a, b) => a - b);
    return out;
  }
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) out[k] = diffPerturb(value[k], rng, domain);
    return out;
  }
  if (typeof value === 'number') {
    // Drawn from the range the guide's own cases already used, not from a fixed
    // window. `plus-one` digits are 0-9; drawing from [-12,12] produced `[-2]`,
    // which no LeetCode statement admits, and the differential dutifully reported
    // L1 and L3 disagreeing about a negative number.
    return domain ? rng.int(domain.lo, domain.hi) : rng.int(-12, 12);
  }
  if (typeof value === 'string') {
    // Declared INSIDE the function on purpose: this block is shipped to the
    // sandbox by `.toString()`, so a module-level const here would be one more
    // name the prelude has to remember to copy.
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    return [...value].map(() => alphabet[rng.int(0, alphabet.length - 1)]).join('');
  }
  if (typeof value === 'boolean') return rng.int(0, 1) === 1;
  return value;
}

/**
 * THE comparator. Runs L1 and L3 on the same fresh arguments and answers "do
 * they disagree?" under the guide's declared kind.
 *
 * Three decisions worth naming:
 *
 * 1. `equivKind` is row 17's comparator, not a local copy. It throws on an
 *    unknown kind, which is the only reason a mistyped `equivalence` cannot
 *    quietly become "everything agrees".
 * 2. BOTH throwing is NOT a divergence. It means the input is outside the
 *    problem's domain — neither level claims to handle it — so it carries no
 *    information about whether the solutions agree.
 * 3. ONE throwing IS a divergence. Brute force is by construction the more
 *    permissive level, so a canonical that throws where its own brute force
 *    returns is a real defect and is reported, not skipped.
 *
 * For `ops-terminal-state-and-outputs` (F6) the compared value is the TERMINAL
 * state: the arguments as the call left them, plus the emitted outputs sequence.
 * The in-place canonicals return `undefined`, so comparing return values alone
 * would compare `undefined` to `undefined` and pass everything.
 */
function differentialDiverges(kind, l1, l3, args) {
  const a = structuredClone(args);
  const b = structuredClone(args);
  let ra;
  let rb;
  try {
    ra = { ok: l1(...a) };
  } catch (err) {
    ra = { threw: err };
  }
  try {
    rb = { ok: l3(...b) };
  } catch (err) {
    rb = { threw: err };
  }
  if (ra.threw && rb.threw) return false;
  if (ra.threw || rb.threw) return true;
  if (kind === 'ops-terminal-state-and-outputs') {
    return !equivKind(kind, { state: a, outputs: [ra.ok] }, { state: b, outputs: [rb.ok] });
  }
  return !equivKind(kind, ra.ok, rb.ok);
}

/** Every number in a value — the domain the guide's own cases already declared legal. */
function diffNumbersIn(value, out = []) {
  if (Array.isArray(value)) {
    for (const v of value) diffNumbersIn(v, out);
  } else if (value !== null && typeof value === 'object') {
    for (const k of Object.keys(value)) diffNumbersIn(value[k], out);
  } else if (typeof value === 'number') {
    out.push(value);
  }
  return out;
}

/**
 * Single-step reductions of one node, inside the base case's value domain.
 *
 * Both rules exist because an unconstrained shrinker leaves the problem's domain
 * and reports the exit as a bug. Measured on this catalog, an unconstrained
 * shrinker produced 92 divergences and all but a handful were artefacts of the
 * shape LeetCode excludes: `[]` for `majority-element`, `[-2]` for `plus-one`
 * (digits are 0-9), `[0,0]` for `jump-game-ii` (you can always reach the end),
 * `[[],[]]` for `arrows-to-burst-balloons`. A diagnostic that cannot tell a wrong
 * solution from an illegal input is not a diagnostic.
 *
 * So: numbers shrink toward the range the authored cases already used, and a
 * non-empty array never shrinks to `[]`. Both are derived from the guide's own
 * cases, not from a hand-written constraint table — the plan's argument against
 * a second source of truth applies to validity rules too.
 *
 * ponytail: a VALUE RANGE and a NON-EMPTY FLOOR, not a validator. It cannot
 * express the preconditions that are structural rather than numeric — a rotated
 * array must be a rotation of a sorted one, a path must start with `/` — so a
 * handful of findings below are illegal inputs the oracle cannot recognise.
 * Those are plan E29's V7 pre-execution validator, which this row does not own.
 */
function diffLocalShrinks(node, domain) {
  if (Array.isArray(node)) {
    const out = [];
    for (let i = 0; i < node.length; i++) out.push(node.filter((_, k) => k !== i));
    return out;
  }
  if (typeof node === 'number') {
    const out = [];
    if (node > 0) out.push(0, Math.trunc(node / 2));
    else if (node < 0) out.push(0, Math.ceil(node / 2));
    return domain ? out.filter((n) => n >= domain.lo && n <= domain.hi) : out;
  }
  if (typeof node === 'string') {
    // No `''`: an empty string is not a legal input to any guide here, and
    // `add-binary` reached `BigInt` conversion on it.
    return node.length > 1 ? [node.slice(0, Math.floor(node.length / 2)), node.slice(0, 1)] : [];
  }
  if (typeof node === 'boolean') return [!node];
  return [];
}

function diffChildEntries(node) {
  if (Array.isArray(node)) return node.map((v, i) => [i, v]);
  if (node !== null && typeof node === 'object') return Object.keys(node).map((k) => [k, node[k]]);
  return [];
}

function diffSetChild(node, key, value) {
  if (Array.isArray(node)) {
    const out = node.slice();
    out[key] = value;
    return out;
  }
  return { ...node, [key]: value };
}

function diffPathText(path) {
  return path.length ? path.join('.') : '<root>';
}

/**
 * Pre-order DFS over every single-node reduction of the whole tree; return the
 * first one that keeps diverging. First-fit, restart-on-success — a greedy
 * fixpoint, so it terminates because each accepted step strictly reduces size or
 * magnitude.
 *
 * Every candidate is tested as a WHOLE input (`diverges(next)`), never as a
 * detached subtree. An earlier draft tested children alone and shrank `[4,5,6]`
 * to `[]` by "shrinking" an element into something the surrounding predicate
 * never saw.
 *
 * ponytail: shrinks scalars, strings and array elements. It does not shrink
 * object graphs structurally (no key deletion, no node unlinking), does not do
 * delta-debugging over element SUBSETS (only single-element deletion), and
 * first-fit is not minimal — the result is a small input, not a provably
 * smallest one. Upgrade path: a real delta-debugging implementation, only if a
 * reported minimal input ever turns out to be too large to read.
 */
function shrinkInput(input, diverges, domain, rootIsArgs) {
  const trace = [];
  if (!diffSafeDiff(input, diverges)) return { minimal: input, trace };
  const noMove = { why: 'no-move' };
  let cur = input;
  // ponytail: 400 passes. Every accepted step removes an element or halves a
  // magnitude, so 400 is unreachable for any real input; it only stops a
  // pathological `diverges` from hanging CI.
  for (let pass = 0; pass < 400; pass++) {
    let moved = null;
    outer: for (const [at, node] of diffAllNodes(cur)) {
      // When the root is an ARGUMENT LIST its length is the call's arity, and
      // dropping an element does not shrink an input — it changes the call.
      // That is how `first-and-last-position` was reduced to `[0]` and
      // `course-schedule` to `[]`, with one implementation reading
      // `prerequisites` as undefined. A fixture whose root is a bare value is
      // not an argument list and stays fully shrinkable.
      if (rootIsArgs && !at.length) continue;
      for (const cand of diffLocalShrinks(node, domain)) {
        // Dropping elements one at a time still reaches `[]`, so the floor is
        // enforced on the candidate, not by withholding the "drop all" step.
        if (Array.isArray(cand) && cand.length === 0) continue;
        if (canonText(cand) === canonText(node)) continue;
        const next = diffReplaceAt(cur, at, cand, noMove);
        if (next === noMove) continue;
        if (diffSafeDiff(next, diverges)) {
          moved = next;
          trace.push(`${diffPathText(at)} -> ${canonText(cand)}`);
          break outer;
        }
      }
    }
    if (moved === null) break;
    cur = moved;
  }
  return { minimal: cur, trace };
}

function diffSafeDiff(candidate, diverges) {
  try {
    return diverges(candidate);
  } catch {
    // A shrink candidate the predicate cannot even evaluate is not evidence.
    return false;
  }
}

function diffAllNodes(value, path = [], out = []) {
  out.push([path, value]);
  for (const [key, child] of diffChildEntries(value)) {
    diffAllNodes(child, [...path, key], out);
  }
  return out;
}

/**
 * Replace the node at `path` with `next`, or `noMove` if the path is stale.
 *
 * `noMove` is passed in rather than read off a module-level sentinel: this block
 * is shipped into the sandbox by `.toString()`, and a `Symbol` constant would be
 * a name the sandbox never sees — the shrinker would throw `DIFF_NO_MOVE is not
 * defined` on its very first reduction, which is exactly what happened before
 * this argument existed. Only values a function can rebuild from its own source
 * survive the trip.
 */
function diffReplaceAt(root, path, next, noMove) {
  if (!path.length) return next;
  const [key, ...rest] = path;
  const children = diffChildEntries(root);
  if (!children.some(([k]) => k === key)) return noMove;
  const child = children.find(([k]) => k === key)[1];
  const newChild = diffReplaceAt(child, rest, next, noMove);
  if (newChild === noMove) return noMove;
  return diffSetChild(root, key, newChild);
}

/**
 * One guide's seeded differential. Lives here, not in the sandbox source, so the
 * fixtures and the real run are literally the same loop.
 *
 * `cases` is the guide's own authored corpus — the differential draws BASE inputs
 * from the cases a human already reviewed against the problem statement, and the
 * seed decides which perturbation of which base it uses for attempt `i`. The
 * unperturbed base is NOT re-run: phase 3 already asserted it against `expect`,
 * so running it twice would buy nothing.
 */
function runSeededDiff(rel, l1, l3, kind, cases, count) {
  const divergences = [];
  let execs = 0;
  // The domain every shrink for this guide must stay inside. Taken from the
  // authored cases, which a human already checked against the problem statement.
  const seen = diffNumbersIn(cases);
  const domain = seen.length ? { lo: Math.min(...seen), hi: Math.max(...seen) } : null;
  for (let i = 0; i < count; i++) {
    const base = cases[i % cases.length];
    const rng = diffMulberry32(diffSeedFor(rel, i));
    const args = diffPerturb(structuredClone(base), rng, domain);
    // Two markers per attempt, because a guide can die in three different places
    // and the report has to say which: evaluating L1/L3, or SHRINKING a
    // divergence it just found. One marker at the end of the loop attributed a
    // shrinker hang to the next attempt, which is how
    // `15-math/06-max-points-on-a-line` was first reported against the wrong seed.
    console.log('DIFF-EXEC ' + i);
    execs++;
    if (!diffSafeDiff(args, (a) => differentialDiverges(kind, l1, l3, a))) continue;
    console.log('DIFF-SHRINK ' + i);
    const { minimal, trace } = shrinkInput(args, (a) => differentialDiverges(kind, l1, l3, a), domain, true);
    divergences.push({
      attempt: i,
      kind,
      seed: diffSeedFor(rel, i),
      input: canonText(minimal),
      trace,
      l1: diffOutcome(l1, minimal),
      l3: diffOutcome(l3, minimal),
    });
  }
  return { execs, divergences };
}

/** What one level did on the minimal input — the half of a divergence report that says WHICH side. */
function diffOutcome(fn, args) {
  try {
    return canonText(fn(...structuredClone(args)));
  } catch (err) {
    return `THREW ${String(err && err.message ? err.message : err).slice(0, 80)}`;
  }
}

// ===========================================================================
// E28: the twelve fixtures, run in-process. 6 kinds x (pass, mutant) + 3 shrink
// cases + 2 self-checks = 17 assertions, counted here rather than emitted by a
// sandbox so a fixture can never be silently skipped.
// ===========================================================================

/**
 * E28's twelve fixtures, as source strings.
 *
 * `args` is a JSON literal; `l1`/`l3`/`mutant` are arrow functions over that one
 * argument. `mutant` is `l3` with exactly one thing changed — the smallest edit
 * that must break the equivalence. Each pair is written so the passing case is
 * genuinely non-trivial: `order-insensitive` agrees across a REVERSED iteration
 * order, `multiset` agrees across regrouped keys, `shape-only` agrees across
 * different values of the same shape, `int-with-tolerance` agrees across a
 * different float accumulation order. A fixture where both sides are literally
 * the same expression would pass for the wrong reason.
 */
const EQUIVALENCE_FIXTURES = [
  {
    kind: 'exact',
    label: 'sorted copy vs sorted copy',
    args: '[[3, 1, 2]]',
    l1: '(xs) => xs.slice().sort()',
    l3: '(xs) => [...xs].sort()',
    mutant: '(xs) => xs.slice().sort().reverse()',
  },
  {
    kind: 'order-insensitive',
    label: 'same pair set, reversed scan order',
    args: '[[1, 3, 2, 2]]',
    l1: `(xs) => { const out = []; for (let i = 0; i < xs.length; i++)
      for (let j = i + 1; j < xs.length; j++) if (xs[i] + xs[j] === 4) out.push([i, j]); return out; }`,
    l3: `(xs) => { const out = []; for (let i = xs.length - 1; i >= 0; i--)
      for (let j = xs.length - 1; j > i; j--) if (xs[i] + xs[j] === 4) out.push([i, j]); return out; }`,
    mutant: `(xs) => { const out = []; for (let i = xs.length - 1; i >= 0; i--)
      for (let j = xs.length - 1; j > i; j--) if (xs[i] + xs[j] === 4 && i > 0) out.push([i, j]); return out; }`,
  },
  {
    kind: 'multiset',
    label: 'same leaves regrouped under other keys',
    args: '[[1, 2, 3, 4]]',
    l1: '(ns) => ({ even: ns.filter((n) => n % 2 === 0), odd: ns.filter((n) => n % 2) })',
    l3: '(ns) => ({ odd: [...ns].filter((n) => n % 2).reverse(), even: [...ns].filter((n) => n % 2 === 0).reverse() })',
    mutant: '(ns) => ({ odd: [...ns].filter((n) => n % 2).reverse(), even: [...ns].filter((n) => n % 2 === 0).slice(1) })',
  },
  {
    kind: 'shape-only',
    label: 'different values, identical array shape',
    args: '[[[1, 2], [3]]]',
    l1: '(g) => g.map((row) => row.map((c) => c + 1))',
    l3: '(g) => g.map((row) => row.map(() => 0))',
    mutant: '(g) => g.slice(0, 1).map((row) => row.map(() => 0))',
  },
  {
    kind: 'int-with-tolerance',
    label: 'mean by sum-then-divide vs divide-then-sum',
    args: '[[0.1, 0.2, 0.3]]',
    l1: '(ns) => ns.reduce((s, n) => s + n, 0) / ns.length',
    l3: '(ns) => { let m = 0; for (const n of ns) m += n / ns.length; return m; }',
    mutant: '(ns) => { let m = 0; for (const n of ns) m += n / ns.length; return m + 0.01; }',
  },
  {
    kind: 'ops-terminal-state-and-outputs',
    label: 'same terminal state + outputs, different loop form',
    args: '[["b", "a", "b", "c"]]',
    l1: `(ws) => { const seen = new Set(); const outputs = [];
      for (let i = 0; i < ws.length; i++) if (!seen.has(ws[i])) { seen.add(ws[i]); outputs.push(ws[i]); }
      return { state: { size: seen.size, keys: [...seen].sort() }, outputs }; }`,
    l3: `(ws) => { const seen = new Set(); const outputs = [];
      ws.forEach((w) => { if (!seen.has(w)) { seen.add(w); outputs.push(w); } });
      return { state: { keys: [...seen].sort(), size: seen.size }, outputs }; }`,
    mutant: `(ws) => { const seen = new Set(); const outputs = [];
      [...ws].sort().forEach((w) => { if (!seen.has(w)) { seen.add(w); outputs.push(w); } });
      return { state: { keys: [...seen].sort(), size: seen.size }, outputs }; }`,
  },
];

/**
 * Shrink fixtures. `diverges` is a predicate over the (single) argument and
 * `minimal` is the input the shrinker MUST land on. `minimal` is spelled out
 * because "it shrank to something" is not an assertion — an empty trace would
 * satisfy a weaker check and hide a shrinker that silently did nothing.
 */
const SHRINK_FIXTURES = [
  {
    label: 'scalar shrinks toward the predicate boundary',
    input: '7',
    diverges: '(v) => v > 2',
    minimal: '3',
  },
  {
    label: 'array shrinks to one zero, never to empty',
    input: '[4, 5, 6]',
    diverges: '(a) => a.length > 0',
    minimal: '[0]',
  },
  {
    label: 'agreeing input is not shrunk at all',
    input: '[1, 2, 3]',
    diverges: '(a) => a.length > 99',
    minimal: '[1,2,3]',
  },
];

/**
 * Phase 4a — the fixtures, run in-process. 6 kinds x (pass, mutant) + 3 shrink
 * cases + 4 self-checks = 19 assertions, and they are counted here rather than
 * emitted by a sandbox so a fixture can never be silently skipped.
 */
function runDifferentialFixtures() {
  let n = 0;
  const fail = (msg) => {
    throw new Error(`differential fixture: ${msg}`);
  };

  // --- E28: every kind passes its pair and REJECTS its mutant -----------------
  for (const fx of EQUIVALENCE_FIXTURES) {
    const args = JSON.parse(fx.args);
    const l1 = eval(`(${fx.l1})`);
    const l3 = eval(`(${fx.l3})`);
    const mutant = eval(`(${fx.mutant})`);
    if (differentialDiverges(fx.kind, l1, l3, args)) {
      fail(`${fx.kind}: L1 and L3 disagree on the PASSING fixture (${fx.label}) — the comparator is too strict`);
    }
    n++;
    if (!differentialDiverges(fx.kind, l1, mutant, args)) {
      fail(`${fx.kind}: the MUTANT was ACCEPTED (${fx.label}) — a comparator that cannot fail is not a comparator`);
    }
    n++;
  }

  // An unknown kind must THROW, never default: a defaulted comparator reports a
  // real divergence as a pass, which is the silent-wrong class plan §1 U2 calls
  // the worst failure mode in this engine.
  let threw = false;
  try {
    differentialDiverges('not-a-kind', () => 1, () => 1, []);
  } catch {
    threw = true;
  }
  if (!threw) fail('an unknown equivalence kind did not throw — it silently defaulted');
  n++;

  // --- the shrinker must actually move, and must stop when it agrees ---------
  for (const fx of SHRINK_FIXTURES) {
    const { minimal, trace } = shrinkInput(JSON.parse(fx.input), eval(`(${fx.diverges})`));
    const got = canonText(minimal);
    if (got !== fx.minimal) {
      fail(`${fx.label}: shrank to ${got}, expected ${fx.minimal} (trace: ${trace.join(' > ') || 'none'})`);
    }
    n++;
  }

  // --- seeded PRNG: same path ⇒ same stream; different path ⇒ different stream
  const a1 = seededRandom('05-hashmap/06-two-sum.md', 0).ints(5, 1, 9);
  const a2 = seededRandom('05-hashmap/06-two-sum.md', 0).ints(5, 1, 9);
  const b1 = seededRandom('05-hashmap/07-happy-number.md', 0).ints(5, 1, 9);
  if (a1.join() !== a2.join()) fail(`seeded PRNG is not reproducible: ${a1} vs ${a2}`);
  if (a1.join() === b1.join()) fail(`two different guides drew the same stream — the seed does not depend on the path`);
  n++;

  // --- tiers: plan E33's counts, and the default is the cheap one -------------
  const tiers = differentialTier('pr');
  if (tiers.perProblem !== 5 || differentialTier('module').perProblem !== 50 || differentialTier('nightly').perProblem !== 200) {
    fail(`tier table drifted from E33 (pr 5 / module 50 / nightly 200): ${JSON.stringify(tiers)}`);
  }
  if (differentialTier(DIFF_DEFAULT_TIER).perProblem !== 5) {
    fail(`the default tier is not the cheap one: ${DIFF_DEFAULT_TIER}`);
  }
  n++;

  // --- E3, the reason this phase carries the canonical serializer: ------------
  // `productExceptSelf([-1,1,0,-3,3])` is canonically `[-0,0,3,-0,0]` and
  // `JSON.stringify`s to `[0,0,3,0,0]` — identical text for two different
  // answers. An `exact` comparator built on JSON.stringify cannot see this, so
  // this assertion states the fact rather than assuming it.
  const negZero = differentialDiverges(
    'exact',
    (xs) => xs[0].slice().map((v) => v * 1),
    (xs) => xs[0].slice().map((v) => -v * 0),
    [[[-1, 1, 0, -3, 3]]]
  );
  if (!negZero) {
    fail('the differential comparator cannot tell -0 from 0 — it is comparing with JSON.stringify somewhere');
  }
  n++;

  return n;
}

// ---------------------------------------------------------------------------
// Phase 4b: the 150-guide run.
//
// The oracle above is proved in-process; the guides run in a sandbox because
// their code lives in markdown and can only be executed by concatenation. The
// sandbox imports the SAME two modules under the SAME two names, and receives
// the oracle by `.toString()`, so there is exactly one implementation of
// "diverge", "shrink" and "perturb" in this repository.
// ---------------------------------------------------------------------------

const DIFF_SANDBOX_IMPORTS = [
  `import { serialize, stringify as canonText } from ${JSON.stringify(
    pathToFileURL(path.join(__dirname, 'lib', 'serialize.mjs')).href
  )};`,
  `import { equivalent as equivKind } from ${JSON.stringify(
    pathToFileURL(path.join(__dirname, '..', 'api', '_lib', 'codecs.mjs')).href
  )};`,
].join('\n');

/** The oracle, verbatim. Order matters only for readability, not for hoisting. */
function diffSandboxPrelude() {
  return [
    differentialDiverges,
    diffOutcome,
    diffNumbersIn,
    diffLocalShrinks,
    diffChildEntries,
    diffSetChild,
    diffPathText,
    diffReplaceAt,
    diffAllNodes,
    diffSafeDiff,
    shrinkInput,
    diffMulberry32,
    diffSeedFor,
    diffPerturb,
    runSeededDiff,
  ]
    .map((f) => f.toString())
    .join('\n\n');
}

/**
 * The per-guide program. Prints one `DIFF-OK <execs>` (the assertion count) and
 * one `DIFF-DIVERGENCE <json>` per divergence. A divergence is REPORTED, not
 * fatal, by default: `npm test` must stay green for the 1453 phase-3
 * assertions, and turning a finding into a red build is a policy decision, not
 * something this row gets to make unilaterally. `--strict-differential` (or
 * `--differential-tier=nightly`) turns any divergence into a non-zero exit.
 */
function buildDiffHarness(rel, [l1Name, l3Name], kind, cases, count) {
  return `${DIFF_SANDBOX_IMPORTS}
${diffSandboxPrelude()}
const __rel = ${JSON.stringify(rel)};
const __res = runSeededDiff(__rel, ${l1Name}, ${l3Name}, ${JSON.stringify(kind)}, ${JSON.stringify(cases)}, ${count});
console.log('DIFF-OK ' + __res.execs);
for (const d of __res.divergences) console.log('DIFF-DIVERGENCE ' + JSON.stringify(d));`;
}

/**
 * Run one sandbox and hand back its stdout. Deliberately NOT `runRuntimeHarness`:
 * that function throws on any non-zero exit and returns an ASSERT-OK count, and
 * this phase needs the opposite — stdout, with a divergence as data rather than
 * as a crash. Six lines of mkdtemp/exec/rm duplicated beats refactoring the
 * function 150 phase-3 assertions depend on.
 */
function execSandbox(levelBlocks, harness, label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc150-diff-'));
  const tmp = path.join(dir, 'diff.mjs');
  fs.writeFileSync(tmp, levelBlocks.join('\n') + '\n' + harness + '\n', 'utf-8');
  try {
    const out = execFileSync('node', [tmp], { stdio: 'pipe', timeout: DIFF_SANDBOX_TIMEOUT_MS, encoding: 'utf-8' });
    return { out, timedOut: false };
  } catch (err) {
    const out = (err.stdout?.toString() || '') + (err.stderr?.toString() || '');
    if (err.killed || err.signal) {
      // An L3 that never returns is plan E24's `truncated.execution`, and in this
      // phase it is a FINDING about the guide, not a failure of the harness.
      // Throwing here would turn one non-terminating canonical into a red build
      // with no minimal input and no seed, which is strictly less information
      // than reporting it.
      return { out, timedOut: true };
    }
    throw new Error(
      `differential sandbox crash in ${label}:\n${(out || err.message).trim().split('\n').slice(0, 8).join('\n')}`
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

let problemsCache = null;

/** catalog/problems.json, keyed by guide path (plan E30: never by slug). */
function loadProblems() {
  if (problemsCache) return problemsCache;
  if (!fs.existsSync(PROBLEMS_PATH)) {
    throw new Error(
      `${path.relative(ROOT_DIR, PROBLEMS_PATH)} missing — the differential phase reads each guide's ` +
        'declared `equivalence` kind from there. It is committed; restore it from git.'
    );
  }
  const parsed = JSON.parse(fs.readFileSync(PROBLEMS_PATH, 'utf-8'));
  if (!Array.isArray(parsed.problems)) {
    throw new Error(`${path.relative(ROOT_DIR, PROBLEMS_PATH)} has no \`problems\` array`);
  }
  problemsCache = new Map(parsed.problems.map((p) => [p.path, p]));
  return problemsCache;
}

/**
 * Run every eligible guide. Returns the assertion count plus everything needed
 * to report a finding without re-running anything.
 *
 * ponytail: eligible means "has machine-readable `args`". The 63 `script`
 * entries hide their inputs inside raw JS text, so there is nothing to perturb;
 * they are counted and named in the summary instead of being silently dropped.
 * Extracting inputs out of script text is a parser, not a regex, and 63 more
 * hand-written generators would be a second corpus that rots — the plan's own
 * argument against a second source of truth. Upgrade path: a `differential:` block
 * on those registry entries, once a guide needs one.
 */
function runDifferentialPhase(files, manifestFns) {
  const tier = differentialTier(differentialTierEnv());
  const problems = loadProblems();
  const divergences = [];
  const skipped = [];
  let execs = 0;
  let guides = 0;

  for (const file of files) {
    const rel = path.relative(ROOT_DIR, file);
    const entry = runtimeEntryFor(rel);
    if (!entry || !entry.cases) {
      skipped.push(rel);
      continue;
    }
    const problem = problems.get(rel);
    if (!problem) {
      throw new Error(`${rel} has a runtime entry but no catalog/problems.json row — the differential has no equivalence kind for it`);
    }
    const [l1Name, , l3Name] = targetFnsFor(rel, manifestFns);
    const levelBlocks = extractJsBlocks(fs.readFileSync(file, 'utf-8')).slice(0, 3);
    // `cases` holds {args, expect}; the differential needs the ARGUMENT LIST only.
    // Passing the case object spreads `{args, expect}` into the call, both levels
    // throw on a non-iterable, and every exec reports agreement vacuously.
    const argLists = entry.cases.map((c) => c.args);
    const { out, timedOut } = execSandbox(
      levelBlocks,
      buildDiffHarness(rel, [l1Name, l3Name], problem.equivalence, argLists, tier.perProblem),
      rel
    );
    guides++;
    let evaluating = -1;
    let shrinking = -1;
    for (const line of out.split('\n')) {
      if (line.startsWith('DIFF-EXEC ')) evaluating = Number(line.slice('DIFF-EXEC '.length));
      else if (line.startsWith('DIFF-SHRINK ')) shrinking = Number(line.slice('DIFF-SHRINK '.length));
      else if (line.startsWith('DIFF-DIVERGENCE ')) {
        divergences.push({ path: rel, ...JSON.parse(line.slice('DIFF-DIVERGENCE '.length)) });
      }
    }
    // `DIFF-EXEC i` is printed when attempt i STARTS, so on a clean run the last
    // index seen is count-1 and every attempt finished; on a kill, that same index
    // is the attempt still in flight and it decided nothing.
    execs += timedOut ? Math.max(0, evaluating) : evaluating + 1;
    if (timedOut) {
      const phase = shrinking === evaluating ? 'while shrinking a divergence it had just found' : 'while evaluating L1 vs L3';
      divergences.push({
        path: rel,
        attempt: evaluating,
        kind: 'non-termination',
        seed: diffSeedFor(rel, evaluating),
        input: '(not shrunk — nothing returned to shrink)',
        trace: [],
        l1: phase === 'while evaluating L1 vs L3' ? `${l1Name} or ${l3Name}` : `${l1Name} or ${l3Name}, ${phase}`,
        l3: `no answer within ${DIFF_SANDBOX_TIMEOUT_MS / 1000}s`,
      });
    }
  }

  return { tier, execs, guides, divergences, skipped: skipped.length };
}

// ponytail: the whole 450-block manifest is parsed on every run (~190 KB, ~10ms)
// and cached for the process. Cache it once `npm test` starts paying for
// gen-blocks on fresh clones; until then a per-entry read would be pure cost.
let targetFnCache = null;

/**
 * Row 3: the 41 guides that had no RUNTIME_TESTS entry, merged in from
 * catalog/cases.json at load rather than pasted in as 41 more object literals.
 *
 * Two reasons it is a merge and not an edit. A hand-pasted entry rots the moment a guide is
 * renamed, which is the exact rot this file has been shedding all project — the `fns` keys row
 * 2 deleted were the same disease. And the cases are *authored*, so they live in their own
 * reviewable file instead of being buried in a 130 KB literal.
 *
 * An explicit RUNTIME_TESTS entry still wins: a guide listed in both gets the inline one, so
 * this can never silently override a hand-tuned case.
 */
let authoredCasesCache = null;
function loadAuthoredCases() {
  if (authoredCasesCache) return authoredCasesCache;
  if (!fs.existsSync(CASES_PATH)) {
    throw new Error(
      `${path.relative(ROOT_DIR, CASES_PATH)} missing — row 3's authored cases live there. ` +
        'Restore it from git (it is committed); regenerate coverage with: node scripts/test-cases.mjs'
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(CASES_PATH, 'utf-8'));
  } catch (err) {
    throw new Error(`unreadable ${path.relative(ROOT_DIR, CASES_PATH)}\n${err.message}`);
  }
  const { __meta, ...entries } = parsed;
  if (!__meta?.roster) {
    throw new Error(
      `${path.relative(ROOT_DIR, CASES_PATH)} has no __meta.roster — without it nothing checks that ` +
        'the 41 syntax-only guides stay covered. Regenerate with: node scripts/test-cases.mjs'
    );
  }
  authoredCasesCache = entries;
  return authoredCasesCache;
}

/** RUNTIME_TESTS plus row 3's authored cases, keyed by guide path. */
function runtimeEntryFor(rel) {
  return RUNTIME_TESTS[rel] || loadAuthoredCases()[rel] || null;
}

/** guide path -> [level1Name, level2Name, level3Name], from build/blocks.json. */
function loadTargetFns() {
  if (targetFnCache) return targetFnCache;

  if (!fs.existsSync(MANIFEST_PATH)) {
    // build/ is gitignored, so a fresh clone has no manifest and `npm test` is
    // the only thing that would ever build it. Regenerate instead of failing
    // bare: the alternative is an ENOENT that tells nobody what to run. Never
    // fall back to "no fns" — that would silently run 399 of 828 assertions and
    // still print Failures: 0.
    console.log(`📦 ${path.relative(ROOT_DIR, MANIFEST_PATH)} missing — building it (${REGEN_HINT})`);
    try {
      execFileSync('node', [path.join(__dirname, 'gen-blocks.mjs')], { stdio: 'inherit' });
    } catch (err) {
      throw new Error(
        `missing ${path.relative(ROOT_DIR, MANIFEST_PATH)} and scripts/gen-blocks.mjs could not build it — ${REGEN_HINT}\n` +
          `${(err.stderr?.toString() || err.message).trim()}`
      );
    }
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  } catch (err) {
    throw new Error(`unreadable ${path.relative(ROOT_DIR, MANIFEST_PATH)} — ${REGEN_HINT}\n${err.message}`);
  }
  if (!Array.isArray(manifest?.blocks)) {
    throw new Error(`${path.relative(ROOT_DIR, MANIFEST_PATH)} has no \`blocks\` array — ${REGEN_HINT}`);
  }

  const byPath = new Map();
  for (const block of manifest.blocks) {
    if (!byPath.has(block.path)) byPath.set(block.path, {});
    byPath.get(block.path)[block.level] = block.targetFn;
  }
  targetFnCache = byPath;
  return byPath;
}

/** The three functions to exercise for `rel`, or a hard error naming the fix. */
function targetFnsFor(rel, byPath) {
  const levels = byPath.get(rel);
  if (!levels) {
    throw new Error(`no block manifest entry for ${rel} — ${REGEN_HINT}`);
  }
  const fns = [levels[1], levels[2], levels[3]];
  const missing = fns.map((n, i) => (n ? null : `level ${i + 1}`)).filter(Boolean);
  if (missing.length) {
    throw new Error(`manifest has no targetFn for ${rel} (${missing.join(', ')}) — ${REGEN_HINT}`);
  }
  return fns;
}

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
  // Keep in sync with validate-guide.mjs: study-roadmap guides use their own
  // template (only their 3 landing pages are skipped by name; any future
  // problem-track index.md stays covered). 'scratch' and loose root-level .md
  // files are agent artifacts, not curriculum; 'test-results' and
  // 'playwright-report' are generated by the E2E run and contain Playwright's
  // own error-context.md pages. 'docs' is the portal, not the curriculum: it
  // needed no entry while every markdown file in it matched a skip name — the
  // walk passed by luck, and the guide-quality rubric is a real document that is
  // not a guide.
  const SKIP_DIRS = new Set(['00-foundations', '24-maang-guides', 'modern-engineer-skills', 'fresher-roadmap', 'mid-level-roadmap', 'scratch', 'test-results', 'playwright-report', 'docs']);
  const SKIP_FILES = new Set(['_TEMPLATE-subpage.md', '00-INDEX.md']);
  const SKIP_INDEX_PARENTS = new Set(['modern-engineer-skills', 'fresher-roadmap', 'mid-level-roadmap']);
  function scan(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'scripts' || SKIP_DIRS.has(entry.name) || SKIP_FILES.has(entry.name)) continue;
      if (entry.name === 'index.md' && SKIP_INDEX_PARENTS.has(path.basename(dir))) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(full);
      else if (entry.name.endsWith('.md') && dir !== ROOT_DIR && !entry.name.includes('PLAN') && !entry.name.includes('README')) files.push(full);
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

  // Resolved once, up front, and fatally: the 56 `cases` entries need their
  // function names from build/blocks.json, and a runner that cannot name them
  // must say so rather than quietly assert less.
  const manifestFns = loadTargetFns();

  let syntaxChecked = 0;
  let runtimeFiles = 0;
  let syntaxOnlyFiles = 0;
  let assertions = 0;
  let failures = 0;

  // Phase 4 opens with the fixtures, before a single guide is executed: if the
  // oracle itself is broken, every divergence it reports afterwards is
  // meaningless, so the oracle is proved first.
  assertions += runDifferentialFixtures();

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
    const entry = runtimeEntryFor(rel);
    if (!entry) {
      console.log(`⚪ [SYNTAX-ONLY] ${rel} — no runtime entry yet`);
      syntaxOnlyFiles++;
      continue;
    }
    try {
      const harness = entry.script
        ? ASSERT_PRELUDE + entry.script
        : buildFnHarness(targetFnsFor(rel, manifestFns), entry.cases);
      const n = runRuntimeHarness(levelBlocks, harness, rel);
      assertions += n;
      runtimeFiles++;
      console.log(`✅ [PASS] ${rel} (${n} assertions)`);
    } catch (err) {
      console.error(`❌ [RUNTIME] ${rel}\n   ${err.message.split('\n').join('\n   ')}`);
      failures++;
    }
  }

  // Phase 4: V4 differential, L1 (brute) vs L3 (canonical) on seeded inputs,
  // compared by each guide's declared equivalence kind. Its oracle was proved
  // above; this is the run.
  const diff = runDifferentialPhase(files, manifestFns);
  assertions += diff.execs;
  for (const d of diff.divergences) {
    console.error(`\n⚠️  DIVERGENCE ${d.path}`);
    console.error(`   kind: ${d.kind}   seed: ${d.seed}   attempt: ${d.attempt}`);
    console.error(`   minimal input: ${d.input}`);
    console.error(`   L1: ${d.l1}`);
    console.error(`   L3: ${d.l3}`);
    console.error(`   shrink trace: ${d.trace.length ? d.trace.join(' > ') : 'none (already minimal)'}`);
  }

  console.log(`\n========================================`);
  console.log(`Files: ${files.length} (runtime-tested: ${runtimeFiles}, syntax-only: ${syntaxOnlyFiles})`);
  console.log(`Syntax blocks checked: ${syntaxChecked} | Runtime assertions: ${assertions}`);
  console.log(
    `Differential (V4): tier=${diff.tier.name} (${diff.tier.perProblem}/guide) | guides: ${diff.guides} | ` +
      `L1~L3 execs COMPLETED: ${diff.execs} | divergences: ${diff.divergences.length} | ` +
      `skipped (no machine-readable args): ${diff.skipped}`
  );
  console.log(
    '  execs that never returned are counted as divergences, not assertions: a run that hangs ' +
      'decides nothing, so billing it as a passing assertion would be the one lie this phase must not tell.'
  );
  console.log(`Failures: ${failures}`);
  console.log(`========================================\n`);

  if (failures > 0) process.exit(1);
  // Report-only by default, so a finding in a guide this row may not edit cannot
  // turn the suite red behind someone's back. `--strict-differential` is how CI
  // makes a divergence a build break once the backlog is triaged.
  if (diff.divergences.length && process.argv.includes('--strict-differential')) {
    console.error(`❌ ${diff.divergences.length} differential divergence(s) and --strict-differential is set.\n`);
    process.exit(1);
  }
}

const cliFilter = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : null;
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // A missing/unusable manifest is a setup problem, not a bug to debug: print the
  // message and the fix, not a stack trace through loadTargetFns.
  try {
    runFullTests(cliFilter);
  } catch (err) {
    console.error(`\n❌ ${err.message.split('\n').join('\n   ')}\n`);
    process.exit(1);
  }
}

# 98. Validate Binary Search Tree

- **LeetCode Link**: `https://leetcode.com/problems/validate-binary-search-tree/`
- **Difficulty**: Medium
- **Pattern Category**: BST / Bounds Propagation
- **Prerequisite Primer**: `00-foundations/03-core-algorithmic-patterns.md`

---

## 1. Problem Overview & Edge Case Matrix

### Problem Statement
Given the `root` of a binary tree, determine if it is a valid binary search tree (BST). A valid BST has: the left subtree of a node contains only nodes with keys less than the node's key; the right subtree only nodes with keys greater than the node's key; and both subtrees are valid BSTs.

```
Example 1:
Input: root = [2,1,3]
Output: true

Example 2:
Input: root = [5,1,4,null,null,3,6]
Output: false
Explanation: The root's value is 5 but its right child's value is 4.
```

### Visual Problem Representation
```
valid:       2                  invalid:     5
            / \                            / \
           1   3                          1   4
                                                / \
                                               3   6   (3 < 5 in RIGHT subtree)
```

### Upfront Edge Case Matrix
| Edge Case Category | Specific Input Scenario | Expected Behavior | Pitfall / Risk |
| :--- | :--- | :--- | :--- |
| Empty / Nil | `root = null` | Return `true` | Vacuous truth mishandled |
| Single Element | `[1]` | Return `true` | Bound initialization |
| Duplicates | `[2,2,2]` / `[1,1]` | Return `false` (strict) | `<=` vs `<` on bounds |
| Deep violation | `[5,1,4,null,null,3,6]` | Return `false` | Checking only parent-child pairs |
| Extreme values | `[−2³¹, null, 2³¹−1]` | Return `true` | `±Infinity` vs int-bound sentinels |

---

## 2. Level 1: Brute Force Approach

### Intuition & Visual Idea
Inorder traversal of a BST yields strictly increasing values — collect them all, then verify the array is strictly sorted. The property does the work; two phases and $O(N)$ storage do the cost.

```mermaid
flowchart TD
    Walk["inorder values -> arr"] --> Check["for i: arr[i] > arr[i-1] else false"]
    Check --> Ret["return true"]
```

### Pseudocode
```text
FUNCTION isValidBSTBruteForce(root):
    vals = INORDER(root)   // iterative or recursive collection
    FOR i = 1 .. vals.LENGTH - 1:
        IF vals[i] <= vals[i-1]: RETURN false
    RETURN true
```

### Step-by-Step Dry Run (Visual Trace)
| Step | Iteration / Pointer ($i, j$) | Current Value | State / Sub-array | Action Taken |
| :--- | :--- | :--- | :--- | :--- |
| 0 | inorder `[2,1,3]` | `[1,2,3]` | Full walk | Collect |
| 1 | `1 < 2 < 3` | strictly increasing | — | Return `true` |
| 2 | inorder `[5,1,4,3,6]` | `[1,5,3,4,6]` | `5 > 3` at `i=2` | Return `false` |

### Modern JavaScript Implementation
```javascript
/**
 * Shared backbone: LeetCode provides TreeNode; defined once here so every
 * level below is locally runnable when concatenated (Level 1 + 2 + 3).
 * Time Complexity:  n/a (scaffolding)
 * Space Complexity: n/a (scaffolding)
 */
class TreeNode {
  constructor(val, left = null, right = null) {
    this.val = val;
    this.left = left;
    this.right = right;
  }
}

function arrayToTree(arr) {
  if (arr.length === 0 || arr[0] === null || arr[0] === undefined) return null;
  const root = new TreeNode(arr[0]);
  const queue = [root];
  let i = 1;
  while (i < arr.length) {
    const node = queue.shift();
    if (i < arr.length && arr[i] !== null && arr[i] !== undefined) {
      node.left = new TreeNode(arr[i]);
      queue.push(node.left);
    }
    i++;
    if (i < arr.length && arr[i] !== null && arr[i] !== undefined) {
      node.right = new TreeNode(arr[i]);
      queue.push(node.right);
    }
    i++;
  }
  return root;
}

/**
 * Level 1: Brute Force (inorder array + sortedness check)
 * Time Complexity:  O(N) — full walk plus linear scan
 * Space Complexity: O(N) — value array
 */
function isValidBSTBruteForce(root) {
  const vals = [];
  const stack = [];
  let cur = root;
  // Iterative inorder: no recursion, but the full array is still stored.
  while (cur !== null || stack.length > 0) {
    while (cur !== null) {
      stack.push(cur);
      cur = cur.left;
    }
    cur = stack.pop();
    vals.push(cur.val);
    cur = cur.right;
  }
  // STRICT increase: duplicates invalidate a BST.
  for (let i = 1; i < vals.length; i++) {
    if (vals[i] <= vals[i - 1]) return false;
  }
  return true;
}
```

### Complexity Breakdown
- **Time Complexity**: $O(N)$ — always walks everything, even when the root already violates.
- **Space Complexity**: $O(N)$ — value array; order checking needs one previous value, not all.

---

## 3. Level 2: Optimized Approach

### Intuition & Visual Bottleneck Elimination
Track only the previous value during iterative inorder: compare on the fly and bail at the first inversion. No array — $O(H)$ stack with early exit.

```mermaid
flowchart TD
    Walk["iterative inorder"] --> Each["pop node: prev !== null && node.val <= prev?"]
    Each -->|"Yes"| False["return false"]
    Each -->|"No"| Update["prev = node.val; continue"]
    Update --> Done["exhausted => return true"]
```

### Pseudocode
```text
FUNCTION isValidBSTInorder(root):
    stack = []; cur = root; prev = NULL
    WHILE cur NOT NULL OR stack NOT EMPTY:
        WHILE cur NOT NULL: stack.PUSH(cur); cur = cur.left
        cur = stack.POP()
        IF prev NOT NULL AND cur.val <= prev: RETURN false
        prev = cur.val; cur = cur.right
    RETURN true
```

### Step-by-Step Dry Run (Visual Trace)
| Step | Pointers / Window | Hash Map / Auxiliary State | Decision Logic | Output Accumulator |
| :--- | :--- | :--- | :--- | :--- |
| 0 | visit `1` | `prev = null` | First value, no check | `prev = 1` |
| 1 | visit `5` | `5 > 1` | OK | `prev = 5` |
| 2 | visit `3` | `3 <= 5` | Inversion! | Return `false` immediately |

### Modern JavaScript Implementation
```javascript
/**
 * Level 2: Optimized (streaming inorder with previous-value check)
 * Time Complexity:  O(N) worst case — exits at the first inversion
 * Space Complexity: O(H) — explicit stack only
 */
// TreeNode shared from Level 1.
function isValidBSTInorder(root) {
  const stack = [];
  let cur = root;
  let prev = null; // null = "no previous": first value always passes
  while (cur !== null || stack.length > 0) {
    while (cur !== null) {
      stack.push(cur);
      cur = cur.left;
    }
    cur = stack.pop();
    // Strictly greater required: <= catches duplicates AND inversions.
    if (prev !== null && cur.val <= prev) return false;
    prev = cur.val;
    cur = cur.right;
  }
  return true;
}
```

### Complexity Breakdown
- **Time Complexity**: $O(N)$ worst case — typically far less via early exit.
- **Space Complexity**: $O(H)$ — explicit stack; no value storage.

---

## 4. Level 3: Most Optimal / Canonical Approach

### Intuition & Mathematical / Invariant Proof
Bounds propagation: each node must lie in `(low, high)`, tightened as recursion descends (left child caps `high` at the parent's value; right child floors `low`). This catches DEEP violations that parent-child checks miss — the actual BST definition, enforced structurally. Invariant: at every call, all values in the current subtree must satisfy `low < val < high`, which is exactly validity of that subtree in context.

```
validate(4-subtree, low=5, high=inf): 4 <= 5? wait 4 < 5 violates low bound
  -> node 4 with (5, inf): 4 <= 5 => false. Correct: 4 sits right of 5.
```

### Pseudocode
```text
FUNCTION isValidBST(node, low = -Infinity, high = Infinity):
    IF node NULL: RETURN true
    IF node.val <= low OR node.val >= high: RETURN false
    RETURN isValidBST(node.left, low, node.val)
       AND isValidBST(node.right, node.val, high)
```

### Step-by-Step Dry Run (Visual Trace)
| Step | Pointer $L$ | Pointer $R$ | Invariant Checked | In-Place State |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `(5, -inf, +inf)` | in bounds | Recurse `(1, -inf, 5)`, `(4, 5, +inf)` | Continue |
| 2 | `(1, -inf, 5)` | valid leaf-side | Returns `true` | Left OK |
| 3 | `(4, 5, +inf)` | `4 <= 5` violates LOW | Deep violation caught | Return `false` |
| 4 | `&&` short-circuits | — | No further visits | Return `false` |

### Modern JavaScript Implementation
```javascript
/**
 * Level 3: Most Optimal / Canonical (recursive bounds propagation)
 * Time Complexity:  O(N) worst case — short-circuits on first violation
 * Space Complexity: O(H) — call stack depth equals height
 */
// TreeNode shared from Level 1.
function isValidBST(root, low = -Infinity, high = Infinity) {
  if (root === null) return true; // empty subtree is vacuously valid
  // STRICT bounds: equality on either side invalidates (no duplicates).
  if (root.val <= low || root.val >= high) return false;
  // Left subtree caps high at this value; right floors low. Both must hold.
  return isValidBST(root.left, low, root.val)
    && isValidBST(root.right, root.val, high);
}
```

### Complexity Breakdown
- **Time Complexity**: $O(N)$ worst case — optimal with short-circuit; violations near the root end the walk instantly.
- **Space Complexity**: $O(H)$ — implicit stack; `-Infinity`/`Infinity` defaults cover the full integer range.

---

## 5. JavaScript-Specific Gotchas & V8 Optimizations
- **GC Pressure**: Avoid allocating objects inside tight loops ($O(N)$ closures). Level 1's $N$-value array is the pressure removed — Levels 2–3 carry one `prev` number or two bound numbers per frame.
- **Type Coercion / Sorting**: Default bounds MUST be `±Infinity`, not `Number.MIN_SAFE_INTEGER`/`MAX_SAFE_INTEGER` — spec values reach $\pm 2^{31}$ and custom tests may push past $2^{53}$; `<=`/`>=` strictness (not `<`/`>`) is what rejects duplicates.
- **Index Bounds**: The classic trap is validating parent-child pairs only (`left.val < node.val`) — ex.2's `3` passes its parent (`3 < 4`) while violating the root. Bounds propagation exists precisely to catch depth-2+ violations.

---

## 6. Real-World MAANG Interview Follow-Ups & Extensions

### Follow-Up 1: Recover a BST with two swapped nodes
- **Scenario**: Exactly two nodes' values are swapped (LeetCode 99); fix in place.
- **Solution Strategy**: Level 2's streaming inorder finds both inversions (first: `prev` holder; second: current) in one walk; swap their values after. $O(H)$ space, no array.
- **JS Code / Implementation Pattern**:
```javascript
function recoverTree(root) {
  let prev = null, first = null, second = null;
  function inorder(node) {
    if (!node) return;
    inorder(node.left);
    if (prev && node.val < prev.val) {
      if (!first) first = prev;
      second = node;
    }
    prev = node;
    inorder(node.right);
  }
  inorder(root);
  [first.val, second.val] = [second.val, first.val];
}
```

### Follow-Up 2: Largest BST subtree / count of BST subtrees
- **Scenario**: Find the biggest valid-BST subtree (or count them) in an arbitrary binary tree.
- **Solution Strategy**: Level 3's bounds walk returns richer info per subtree: `{ valid, size, min, max }` — combine bottom-up, tracking the max valid size. One pass, $O(H)$ space.
- **JS Code / Implementation Pattern**:
```javascript
function largestBSTSubtree(root) {
  let best = 0;
  function info(node) {
    if (!node) return { valid: true, size: 0, lo: Infinity, hi: -Infinity };
    const l = info(node.left), r = info(node.right);
    const ok = l.valid && r.valid && node.val > l.hi && node.val < r.lo;
    if (ok) best = Math.max(best, 1 + l.size + r.size);
    return {
      valid: ok,
      size: 1 + l.size + r.size,
      lo: Math.min(node.val, l.lo),
      hi: Math.max(node.val, r.hi),
    };
  }
  info(root);
  return best;
}
```

### Follow-Up 3: Online BST validation under inserts
- **Scenario & In-Depth Solution**: Values insert over time; revalidating per insert is $O(N)$. Maintain the inorder predecessor/successor structure (balanced BST or sorted array of boundary keys): each insert checks only its immediate neighbors — $O(\log N)$ per insert, validity preserved inductively from a valid start.
```javascript
function insertValidated(sortedKeys, val) {
  const i = lowerBound(sortedKeys, val);
  if (sortedKeys[i] === val) throw new Error('duplicate rejects BST');
  sortedKeys.splice(i, 0, val); // neighbor check suffices given valid history
  return true;
}
```

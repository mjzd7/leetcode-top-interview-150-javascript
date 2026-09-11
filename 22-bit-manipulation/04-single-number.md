# 136. Single Number

- **LeetCode Link**: `https://leetcode.com/problems/single-number/`
- **Difficulty**: Easy
- **Pattern Category**: Bit Manipulation / XOR Cancellation
- **Prerequisite Primer**: `00-foundations/01-js-interview-runtime-quirks.md`

---

## 1. Problem Overview & Edge Case Matrix

### Problem Statement
Given a non-empty array of integers `nums`, every element appears twice except for one. Find that single one. Follow-up: implement with linear runtime and constant extra space.

```
Example 1:
Input: nums = [2,2,1]
Output: 1

Example 2:
Input: nums = [4,1,2,1,2]
Output: 4

Example 3:
Input: nums = [1]
Output: 1
```

### Visual Problem Representation
```
[4,1,2,1,2]:  4 ^ 1 ^ 2 ^ 1 ^ 2 = 4 ^ (1^1) ^ (2^2) = 4 ^ 0 ^ 0 = 4
               pairs annihilate under XOR; the singleton survives
```

### Upfront Edge Case Matrix
| Edge Case Category | Specific Input Scenario | Expected Behavior | Pitfall / Risk |
| :--- | :--- | :--- | :--- |
| Single Element | `[1]` | Return `1` | Loop needing pairs |
| Singleton first/last | `[4,…]` / `[…,4]` | Found regardless of position | Early-exit logic |
| Negatives | `[-1,-1,-2]` | Return `-2` | XOR sign-bit handling (works: two's complement) |
| Zero singleton | `[0,1,1]` / `[2,2,0]` | Return `0` | Falsy-value short-circuits |
| Large values | Near $\pm 2^{31}$ | Exact | 32-bit XOR truncation beyond int32 |

---

## 2. Level 1: Brute Force Approach

### Intuition & Visual Idea
Sort a copy, then walk pairs: the first element differing from its partner is the singleton. $O(N \log N)$ — pairing made visible through order.

```mermaid
flowchart TD
    Sort["sorted = copy sorted"] --> I["i = 0, step 2"]
    I --> Cmp{"sorted[i] == sorted[i+1]?"}
    Cmp -->|"Yes"| Next["i += 2"]
    Next --> I
    Cmp -->|"No"| Ret["return sorted[i]"]
```

### Pseudocode
```text
FUNCTION singleNumberBruteForce(nums):
    sorted = SORTED-COPY(nums)
    FOR i IN 0, 2, 4, ... < sorted.LENGTH:
        IF sorted[i] != sorted[i+1]: RETURN sorted[i]
```

### Step-by-Step Dry Run (Visual Trace)
| Step | Iteration / Pointer ($i, j$) | Current Value | State / Sub-array | Action Taken |
| :--- | :--- | :--- | :--- | :--- |
| 0 | sort `[4,1,2,1,2]` | `[1,1,2,2,4]` | Ordered pairs | — |
| 1 | `i = 0` | `1 == 1` | Pair, skip | `i = 2` |
| 2 | `i = 2` | `2 == 2` | Pair, skip | `i = 4` |
| 3 | `i = 4` | `4 != undefined` | Unpaired | Return `4` |

### Modern JavaScript Implementation
```javascript
/**
 * Level 1: Brute Force (sort + pair scan)
 * Time Complexity:  O(N log N) — sort dominates
 * Space Complexity: O(N) — sorted copy
 */
function singleNumberBruteForce(nums) {
  // Copy first: the caller's order is none of our business.
  const sorted = [...nums].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i += 2) {
    // Pairs agree; the singleton disagrees with its (missing) partner.
    // At the tail, sorted[i+1] is undefined !== any number: still correct.
    if (sorted[i] !== sorted[i + 1]) return sorted[i];
  }
}
```

### Complexity Breakdown
- **Time Complexity**: $O(N \log N)$ — sort dominates.
- **Space Complexity**: $O(N)$ — the copy; counting needs no order at all.

---

## 3. Level 2: Optimized Approach

### Intuition & Visual Bottleneck Elimination
Toggle-set: add unseen values, delete seen ones — pairs annihilate, leaving exactly the singleton. $O(N)$ time, $O(N)$ space — the follow-up's time bound without its space bound.

```mermaid
flowchart TD
    Each["for v in nums"] --> Seen{"seen.has(v)?"}
    Seen -->|"Yes"| Del["delete (pair completed)"]
    Seen -->|"No"| Add["add (awaiting partner)"]
    Done["exhausted"] --> One["return the sole remaining element"]
```

### Pseudocode
```text
FUNCTION singleNumberSet(nums):
    seen = EMPTY SET
    FOR v IN nums:
        IF seen HAS v: seen.DELETE(v)
        ELSE: seen.ADD(v)
    RETURN THE ONLY ELEMENT OF seen
```

### Step-by-Step Dry Run (Visual Trace)
| Step | Pointers / Window | Hash Map / Auxiliary State | Decision Logic | Output Accumulator |
| :--- | :--- | :--- | :--- | :--- |
| 0 | `4` | unseen → add | `{4}` | — |
| 1 | `1` | unseen → add | `{4,1}` | — |
| 2 | `2` | unseen → add | `{4,1,2}` | — |
| 3 | `1` | seen → delete | `{4,2}` | — |
| 4 | `2` | seen → delete | `{4}` | Return `4` |

### Modern JavaScript Implementation
```javascript
/**
 * Level 2: Optimized (toggle-set annihilation)
 * Time Complexity:  O(N) — one pass, O(1) set ops
 * Space Complexity: O(N) — up to N/2 unpaired values retained
 */
function singleNumberSet(nums) {
  const seen = new Set();
  for (const v of nums) {
    // Pairs annihilate: second sighting deletes instead of counting.
    if (seen.has(v)) seen.delete(v);
    else seen.add(v);
  }
  // Exactly one value survives (spec guarantee).
  return [...seen][0];
}
```

### Complexity Breakdown
- **Time Complexity**: $O(N)$ — single pass; meets the time follow-up.
- **Space Complexity**: $O(N)$ — the set; the space follow-up needs bit tricks.

---

## 4. Level 3: Most Optimal / Canonical Approach

### Intuition & Mathematical / Invariant Proof
XOR fold: `a ^ a = 0` (self-annihilation), `a ^ 0 = a` (identity), associativity + commutativity (order-free). Every pair XORs to 0 regardless of position; the singleton XORs with 0 to itself. One accumulator, one pass, $O(1)$ space. Invariant: after processing any prefix, `acc` equals the XOR of elements appearing an odd number of times so far — at the end, exactly the singleton. This works for negatives too (two's complement is XOR-transparent).

```
4^1^2^1^2 = 4^(1^1)^(2^2) = 4^0^0 = 4   ( regroup freely: commutes )
```

### Pseudocode
```text
FUNCTION singleNumber(nums):
    acc = 0
    FOR v IN nums: acc ^= v
    RETURN acc
```

### Step-by-Step Dry Run (Visual Trace)
| Step | Pointer $L$ | Pointer $R$ | Invariant Checked | In-Place State |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `v = 4` | `acc = 0^4 = 4` | Odd-count set `{4}` | — |
| 2 | `v = 1, 2` | `acc = 4^1^2` | Odd-count `{4,1,2}` | — |
| 3 | `v = 1` | `acc ^= 1` cancels | Odd-count `{4,2}` | — |
| 4 | `v = 2` | `acc ^= 2` cancels | Odd-count `{4}` | Return `4` |

### Modern JavaScript Implementation
```javascript
/**
 * Level 3: Most Optimal / Canonical (XOR annihilation)
 * Time Complexity:  O(N) — single pass, optimal lower bound
 * Space Complexity: O(1) auxiliary — one accumulator
 */
function singleNumber(nums) {
  // 0 is the XOR identity: pairs vanish (a^a=0), the singleton survives.
  // Order-free by commutativity/associativity: no sorting, no sets.
  let acc = 0;
  for (const v of nums) acc ^= v;
  return acc;
}
```

### Complexity Breakdown
- **Time Complexity**: $O(N)$ — optimal lower bound; every element folded once.
- **Space Complexity**: $O(1)$ auxiliary — one number; meets the full follow-up.

---

## 5. JavaScript-Specific Gotchas & V8 Optimizations
- **GC Pressure**: Avoid allocating objects inside tight loops ($O(N)$ closures). Level 1's sorted copy plus Level 2's `Set` (boxed entries) are the pressure Level 3 removes — one number, zero allocation.
- **Type Coercion / Sorting**: JS `^` coerces via ToInt32 — values past $\pm 2^{31}$ WRAP SILENTLY (spec range is int32, so exact here; validate at the boundary otherwise). `[...seen][0]` spread-allocates to read one survivor — `seen.values().next().value` avoids it.
- **Index Bounds**: The pair-step `i += 2` with `sorted[i+1]` possibly `undefined` is INTENTIONAL (tail singleton) — but only because `undefined` never `===` a number; with `NaN` inputs the logic inverts (everything mismatches). Validate numeric input.

---

## 6. Real-World MAANG Interview Follow-Ups & Extensions

### Follow-Up 1: Two single numbers (all others paired)
- **Scenario**: Exactly TWO singletons among pairs (LeetCode 260, Medium).
- **Solution Strategy**: XOR all → `xor = a^b` (nonzero); split by any set bit of `xor` (the singletons differ there) into two groups; XOR each group. Same kernel, one partition.
- **JS Code / Implementation Pattern**:
```javascript
function singleNumberIII(nums) {
  const xor = nums.reduce((a, v) => a ^ v, 0);
  const bit = xor & -xor; // lowest differing bit: separates the singletons
  let a = 0;
  for (const v of nums) if (v & bit) a ^= v;
  return [a, a ^ xor];
}
```

### Follow-Up 2: K-duplicates generalization (Single Number II/III family)
- **Scenario**: Elements appear $K$ times except one (LeetCode 137, next guide).
- **Solution Strategy**: Per-bit counting mod $K$ (or ones/twos state machines for $K = 3$) — XOR is the $K = 2$ special case of modular bit arithmetic.
- **JS Code / Implementation Pattern**:
```javascript
function singleNumberK(nums, K) {
  return perBitModK(nums, K); // next guide's generalization
}
```

### Follow-Up 3: $10^9$-element stream with $O(1)$ RAM (checksums)
- **Scenario & In-Depth Solution**: Values stream once; only the accumulator fits. Level 3 IS the streaming answer (XOR is order-free AND incremental) — this is also how RAID/parity and Fletcher checksums work at scale. No other level adapts.
```javascript
async function streamSingleNumber(numberStream) {
  let acc = 0;
  for await (const v of numberStream) acc ^= v;
  return acc;
}
```

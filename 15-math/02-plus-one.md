# 66. Plus One

- **LeetCode Link**: `https://leetcode.com/problems/plus-one/`
- **Difficulty**: Easy
- **Pattern Category**: Math / Carry Propagation
- **Prerequisite Primer**: `00-foundations/01-js-interview-runtime-quirks.md`

---

## 1. Problem Overview & Edge Case Matrix

### Problem Statement
You are given a large integer represented as an integer array `digits`, where each `digits[i]` is the `i`-th digit of the integer. The digits are ordered from most significant to least significant in left-to-right order. Increment the large integer by one and return the resulting array of digits.

```
Example 1:
Input: digits = [1,2,3]
Output: [1,2,4]

Example 2:
Input: digits = [4,3,2,1]
Output: [4,3,2,2]

Example 3:
Input: digits = [9]
Output: [1,0]
```

### Visual Problem Representation
```
[1,2,3] + 1:  3 < 9 -> set 4, done.        [1,2,4]
[9,9,9] + 1:  all cascade -> new array.    [1,0,0,0]
```

### Upfront Edge Case Matrix
| Edge Case Category | Specific Input Scenario | Expected Behavior | Pitfall / Risk |
| :--- | :--- | :--- | :--- |
| Single Element | `[9]` / `[5]` | `[1,0]` / `[6]` | Length-changing vs in-place paths |
| All nines | `[9,9,9]` | `[1,0,0,0]` (longer!) | Forgetting the extra digit |
| No carry | `[1,2,3]` | Early exit at last digit | Full right-to-left walk anyway (fine, but say so) |
| Huge input | 100 digits | Exact (no float math) | `Number()` overflow past $2^{53}$ |
| Leading zeros | Not per spec (no leading 0s) | N/A | BigInt/string conversion dropping them |

---

## 2. Level 1: Brute Force Approach

### Intuition & Visual Idea
Convert digits to a `BigInt`, add one, split back into digits. Exact at any length (BigInt, not Number) — one expression of intent, $O(N)$ conversions each way.

```mermaid
flowchart TD
    Join["n = BigInt(digits.join(''))"] --> Add["n + 1n"]
    Add --> Split["String(n).split('').map(Number)"]
```

### Pseudocode
```text
FUNCTION plusOneBruteForce(digits):
    n = BIGINT(JOIN(digits, ""))
    RETURN DIGITS-OF(n + 1)
```

### Step-by-Step Dry Run (Visual Trace)
| Step | Iteration / Pointer ($i, j$) | Current Value | State / Sub-array | Action Taken |
| :--- | :--- | :--- | :--- | :--- |
| 0 | join `[1,2,3]` | `"123"` → `123n` | Convert | Parse |
| 1 | add | `124n` | Native bignum add | Increment |
| 2 | split | `"124"` → `[1,2,4]` | Convert back | Return |

### Modern JavaScript Implementation
```javascript
/**
 * Level 1: Brute Force (BigInt round-trip)
 * Time Complexity:  O(N) — join, convert, split (big constants)
 * Space Complexity: O(N) — intermediate strings and BigInt digits
 */
function plusOneBruteForce(digits) {
  // BigInt (NOT Number): exact past 2^53 for 100-digit inputs.
  const n = BigInt(digits.join('')) + 1n;
  return String(n).split('').map(Number);
}
```

### Complexity Breakdown
- **Time Complexity**: $O(N)$ — linear, but with bignum conversion constants dwarfing digit work.
- **Space Complexity**: $O(N)$ — strings plus the BigInt; carry needs $O(1)$.

---

## 3. Level 2: Optimized Approach

### Intuition & Visual Bottleneck Elimination
Right-to-left carry into a COPY: bump trailing 9s to 0 moving left; the first non-9 increments and the scan stops. Caller's array untouched; all-9s returns a fresh longer array.

```mermaid
flowchart TD
    Copy["out = copy(digits); i = end"] --> Nine{"out[i] == 9?"}
    Nine -->|"Yes"| Zero["out[i] = 0; i--"]
    Zero --> Nine
    Nine -->|"No"| Inc["out[i]++; return out"]
    Nine -->|"ran out"| New["return [1, ...zeros]"]
```

### Pseudocode
```text
FUNCTION plusOneCarry(digits):
    out = COPY(digits)
    FOR i FROM END DOWNTO 0:
        IF out[i] < 9: out[i]++; RETURN out
        out[i] = 0
    RETURN [1] + out   // all nines: out is all zeros now
```

### Step-by-Step Dry Run (Visual Trace)
| Step | Pointers / Window | Hash Map / Auxiliary State | Decision Logic | Output Accumulator |
| :--- | :--- | :--- | :--- | :--- |
| 0 | `i = 2`, `out = [1,2,3]` | `3 < 9` | Increment, return | `[1,2,4]` |
| 1 | `[9]`: `i = 0` | `9 → 0` | Cascade off the front | `[1, 0]` via prepend |
| 2 | `[4,3,2,1]` | last `< 9` | Increment | `[4,3,2,2]` |

### Modern JavaScript Implementation
```javascript
/**
 * Level 2: Optimized (carry into a copy)
 * Time Complexity:  O(N) — single right-to-left pass, early exit
 * Space Complexity: O(N) — the output copy
 */
function plusOneCarry(digits) {
  const out = digits.slice(); // caller's array never touched
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] < 9) {
      out[i]++; // first non-9 absorbs the carry: done
      return out;
    }
    out[i] = 0; // 9 + 1 = 0, carry leftward
  }
  // Fell off the front: all nines (out is all zeros) — prepend the 1.
  return [1, ...out];
}
```

### Complexity Breakdown
- **Time Complexity**: $O(N)$ — one pass with early exit on the common path.
- **Space Complexity**: $O(N)$ — the copy; Level 3 reuses the input instead.

---

## 4. Level 3: Most Optimal / Canonical Approach

### Intuition & Mathematical / Invariant Proof
Same carry loop, in place: the input array IS the output (spec-legal — return type is the array). Only the all-9s case allocates (unavoidable: length grows). Invariant: suffix right of `i` is already finalized (zeros from cascaded 9s); the first non-9 from the right absorbs the carry and everything left is untouched.

```
[9,9,8,9]: i=3: 9->0; i=2: 8->9, return [9,9,9,9]... wait:
  [9,9,8,9]: i=3 is 9 -> 0; i=2 is 8 < 9 -> 9, return [9,9,9,0]. ✓
```

### Pseudocode
```text
FUNCTION plusOne(digits):
    FOR i FROM END DOWNTO 0:
        IF digits[i] < 9: digits[i]++; RETURN digits
        digits[i] = 0
    digits.UNSHIFT(1)   // all nines became zeros; length grows by one
    RETURN digits
```

### Step-by-Step Dry Run (Visual Trace)
| Step | Pointer $L$ | Pointer $R$ | Invariant Checked | In-Place State |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `i = 2`, `[1,2,3]` | `3 < 9` | Absorb, return same ref | `[1,2,4]` |
| 2 | `[9]`: `i = 0` | `9 → 0`, loop ends | All-nines path | `unshift(1)` → `[1,0]` |
| 3 | return | — | — | Same array reference |

### Modern JavaScript Implementation
```javascript
/**
 * Level 3: Most Optimal / Canonical (in-place carry)
 * Time Complexity:  O(N) — single pass, optimal lower bound
 * Space Complexity: O(1) auxiliary — output excluded (all-9s growth excepted)
 */
function plusOne(digits) {
  for (let i = digits.length - 1; i >= 0; i--) {
    if (digits[i] < 9) {
      digits[i]++; // carry absorbed here; prefix untouched
      return digits;
    }
    digits[i] = 0; // 9 cascades leftward
  }
  // All nines (now all zeros): length must grow — the only allocation.
  digits.unshift(1);
  return digits;
}
```

### Complexity Breakdown
- **Time Complexity**: $O(N)$ — optimal lower bound; every digit inspected at most once.
- **Space Complexity**: $O(1)$ auxiliary — in-place; the all-9s prepend is required output growth.

---

## 5. JavaScript-Specific Gotchas & V8 Optimizations
- **GC Pressure**: Avoid allocating objects inside tight loops ($O(N)$ closures). Level 1's join/BigInt/split/map chain allocates ~4× the input per call — Level 3 allocates zero on the common path.
- **Type Coercion / Sorting**: `BigInt(digits.join(''))` (Level 1) is exact; `Number(...)` or `parseInt` overflows past $2^{53}-1$ (100-digit spec max!) — never float-convert digit arrays. `.map(Number)` (not `parseInt`) avoids radix pitfalls.
- **Index Bounds**: `unshift(1)` on the all-9s path is $O(N)$ memmove — acceptable once per call, but never `unshift` inside the loop. In-place mutation (Level 3) surprises callers holding the old reference — document it; Level 2's copy is the polite variant.

---

## 6. Real-World MAANG Interview Follow-Ups & Extensions

### Follow-Up 1: Plus K / add arbitrary digit arrays
- **Scenario**: Add `k` (or a second digit array) instead of one.
- **Solution Strategy**: Same right-to-left loop with a running `carry` seeded from `k % 10` digits (`k` decomposed per position); loop while `i >= 0 || carry > 0`, prepending as needed.
- **JS Code / Implementation Pattern**:
```javascript
function plusK(digits, k) {
  const out = digits.slice();
  let i = out.length - 1;
  let carry = k;
  while (i >= 0 || carry > 0) {
    const sum = (i >= 0 ? out[i] : 0) + carry;
    if (i >= 0) out[i] = sum % 10;
    else out.unshift(sum % 10); // k outgrows the array: prepend
    carry = Math.floor(sum / 10);
    i--;
  }
  return out;
}
```

### Follow-Up 2: $10^9$-digit counter with $O(1)$ amortized increments
- **Scenario**: A persistent odometer incremented constantly; $O(N)$ per increment is too slow.
- **Solution Strategy**: Same loop — amortized analysis: each increment flips a run of trailing 9s (rare) plus one digit (always) — $O(1)$ amortized per increment over a counting sequence. State the amortization explicitly.
- **JS Code / Implementation Pattern**:
```javascript
function amortizedIncrement(counter) {
  return plusOne(counter); // O(1) amortized across 0..10^N sequences
}
```

### Follow-Up 3: Concurrent increments (distributed counter)
- **Scenario & In-Depth Solution**: Writers race `plusOne` on shared digits — read-modify-write tears. Shard by digit ranges with carry propagation messages, or serialize increments through a single owner (actor model). Optimistic CAS on the digit array retries on version mismatch.
```javascript
function casIncrement(shared, versionOf) {
  const stamp = versionOf(shared);
  const result = plusOne(shared.slice());
  if (versionOf(shared) !== stamp) return casIncrement(shared, versionOf);
  return publish(shared, result);
}
```

---

## 7. What LeetCode Discuss Says (Language-Independent)

Source: top-voted post by niits —
`https://leetcode.com/problems/plus-one/solutions/5564037/video-iterate-through-the-array-from-the-7h3q/`
— 150.2K views.
Language-independent summary. No new JS here.

### A. Optimal way from Discuss (Reverse Scan with In-Place Carry Absorption)

Avoid string conversion and numerical parsing by directly propagating addition from the least-significant digit:

1. **Reverse Scan Invariant:**
   - Iterate index $i$ backwards from $N - 1$ down to $0$:
     - If `digits[i] < 9`: increment `digits[i]` by 1 and return `digits` immediately. The addition is fully absorbed without affecting higher digits.
     - Else (`digits[i] == 9`): set `digits[i] = 0` and continue leftward, carrying 1 into the next position.
2. **All-Nines Overflow Handling:**
   - If the loop terminates without returning, every digit was 9 (e.g., `[9, 9, 9]` became `[0, 0, 0]`).
   - Create a new array of size $N + 1$ with leading element `1` followed by zeros (or prepend `1` to `digits`): return `[1, 0, 0, ..., 0]`.

```text
FUNCTION plusOne(digits):
    n = length(digits)

    FOR i FROM n - 1 DOWNTO 0:
        IF digits[i] < 9:
            digits[i] = digits[i] + 1
            RETURN digits

        digits[i] = 0

    // Reached only when all digits were 9
    newDigits = ARRAY OF SIZE (n + 1) FILLED WITH 0
    newDigits[0] = 1
    RETURN newDigits
```

- Time: O(N) worst-case (all 9s), O(1) expected time (90% of integers terminate on the first step).
- Space: O(1) auxiliary space when modifying in-place; O(N) only in the all-nines edge case to allocate the resized array.

```mermaid
flowchart TD
    Start["Iterate i from n - 1 down to 0"] --> Check{"digits[i] < 9?"}
    Check -->|"Yes"| Add["digits[i] += 1"]
    Add --> RetFast["RETURN digits (Carry absorbed)"]
    Check -->|"No (digit == 9)"| Zero["digits[i] = 0"]
    Zero --> LoopCheck{"i > 0?"}
    LoopCheck -->|"Yes"| Decr["i--"] --> Check
    LoopCheck -->|"No"| Prepend["Allocate [1, 0, ..., 0]<br>size n + 1"] --> RetOverflow["RETURN new array"]
```

### B. Dry run on LeetCode Example 1 and All-9s Boundary Case

- **Example 1 (`digits = [1, 2, 3]`):**
  - $i = 2$: `digits[2] = 3 < 9` -> increment to 4.
  - Return `[1, 2, 4]` immediately.
- **Edge Case (`digits = [9, 9]`):**
  - $i = 1$: `digits[1] = 9` -> set to 0. Current: `[9, 0]`.
  - $i = 0$: `digits[0] = 9` -> set to 0. Current: `[0, 0]`.
  - Loop exhausts. All digits were 9.
  - Allocate new array of size 3: `[1, 0, 0]`.

Final result: `[1, 0, 0]`.

### C. Why Direct Iteration Outperforms Parsing to Integers

- Parsing the digits into a number (e.g. `parseInt(digits.join(''))`) causes integer overflow for large inputs exceeding IEEE 754 float limits ($2^{53} - 1 \approx 9 \times 10^{15}$).
- Direct array iteration performs addition in $O(1)$ expected time with zero string serialization overhead.

### D. Pitfalls from comments

- **Integer Precision Overflow:** Converting to number primitives (`Number(digits.join(''))`) causes precision loss for inputs with dozens of digits.
- **Memory Reallocations:** Reallocating a new array on every carry propagation step creates $O(N^2)$ memory churn. Mutating `digits[i]` directly in-place runs in $O(1)$ space.

### E. Companies

- Discuss post itself names none.
  Companies tab on LeetCode is premium-locked.
- External source:
  `https://github.com/liquidslr/leetcode-company-wise-problems`
  (LeetCode company tags, updated June 2025).
- All-time (13): Accenture, Amazon, Bloomberg, Capgemini, Google, IBM, Intuit, Meta, Microsoft, tcs, TikTok, Visa, Zoho.
- Recent: 30 days — Google, Meta.
- Recent: 3 months — Amazon, Bloomberg, Google, Meta.

# 228. Summary Ranges

- **LeetCode Link**: `https://leetcode.com/problems/summary-ranges/`
- **Difficulty**: Easy
- **Pattern Category**: Intervals / Two Pointers / Linear State Machine
- **Prerequisite Primer**: `00-foundations/01-js-interview-runtime-quirks.md`

---

## 1. Problem Overview & Edge Case Matrix

### Problem Statement
You are given a **sorted unique** integer array `nums`.

A **range** `[a, b]` is the set of all integers from `a` to `b`, inclusive.

Return the smallest sorted list of ranges that **cover all the numbers in the array exactly**. That is, each element of `nums` is covered by exactly one of the ranges, and there is no integer `x` such that `x` is in one of the ranges but not in `nums`.

Each range `[a, b]` in the list should be formatted as:
- `"a->b"` if $a \neq b$
- `"a"` if $a == b$

```
Example 1:
nums = [0, 1, 2, 4, 5, 7]
Output: ["0->2", "4->5", "7"]
Explanation:
Ranges are:
[0, 2] --> "0->2"
[4, 5] --> "4->5"
[7, 7] --> "7"

Example 2:
nums = [0, 2, 3, 4, 6, 8, 9]
Output: ["0", "2->4", "6", "8->9"]
```

### Upfront Edge Case Matrix

| Edge Case Scenario | Inputs | Expected Output | Pitfall / Failure Mode |
| :--- | :--- | :--- | :--- |
| Empty Array | `nums = []` | `[]` | Accessing `nums[0]` out-of-bounds |
| Single Element | `nums = [42]` | `["42"]` | Missing terminal range flush |
| All Elements Consecutive | `nums = [1, 2, 3, 4]` | `["1->4"]` | Splitting into individual numbers |
| Completely Disjoint Numbers | `nums = [1, 3, 5, 7]` | `["1", "3", "5", "7"]` | Adding incorrect `"->"` transitions |
| 32-bit Integer Boundaries | `nums = [-2147483648, 2147483647]` | `["-2147483648", "2147483647"]` | Integer subtraction overflow if using `nums[i+1] - nums[i]` |

---

## 2. Level 1: Brute Force Approach (Nested Lookahead Traversal)

### Intuition & Visual Idea
For each index $i$, record `start = nums[i]`. Use an inner pointer $j$ that advances as long as the next element equals the current element plus one (`nums[j + 1] === nums[j] + 1`). When the streak breaks, format the range, push it to the results, and advance $i$ to $j$.

```mermaid
flowchart TD
    A["Set i = 0"] --> B{"i < n ?"}
    B -->|"No"| Ret["Return result"]
    B -->|"Yes"| Start["start = nums[i]; j = i"]
    Start --> Lookahead{"j + 1 < n AND nums[j+1] === nums[j] + 1 ?"}
    Lookahead -->|"Yes"| Advance["j++"]
    Advance --> Lookahead
    Lookahead -->|"No"| Format{"start === nums[j] ?"}
    Format -->|"Yes"| PushSingle["result.push(start.toString())"]
    Format -->|"No"| PushRange["result.push(start + '->' + nums[j])"]
    PushSingle --> NextI["i = j + 1"]
    PushRange --> NextI
    NextI --> B
```

### Pseudocode
```text
FUNCTION summaryRangesBruteForce(nums):
    result = []
    i = 0
    n = nums.length
    
    WHILE i < n:
        start = nums[i]
        j = i
        
        WHILE j + 1 < n AND nums[j + 1] == nums[j] + 1:
            j = j + 1
            
        IF start == nums[j]:
            result.append(STRING(start))
        ELSE:
            result.append(STRING(start) + "->" + STRING(nums[j]))
            
        i = j + 1
        
    RETURN result
```

### Step-by-Step Dry Run
`nums = [0, 1, 2, 4, 5, 7]`

| `i` | `start = nums[i]` | `j` advances to | Streak broken at | Pushed String | Next `i` |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | 0 | 2 (`nums[2]=2`) | 4 $\neq 2 + 1$ | `"0->2"` | 3 |
| 3 | 4 | 4 (`nums[4]=5`) | 7 $\neq 5 + 1$ | `"4->5"` | 5 |
| 5 | 7 | 5 (`nums[5]=7`) | End of array | `"7"` | 6 (Exit) |

### Modern JavaScript Implementation
```javascript
/**
 * Level 1: Nested Lookahead Traversal
 * Time Complexity:  O(N)
 * Space Complexity: O(1) Auxiliary Space
 */
function summaryRangesBruteForce(nums) {
  const result = [];
  const n = nums.length;
  let i = 0;

  while (i < n) {
    const start = nums[i];
    let j = i;

    // Scan forward while numbers are strictly consecutive
    while (j + 1 < n && nums[j + 1] === nums[j] + 1) {
      j++;
    }

    if (start === nums[j]) {
      result.push(String(start));
    } else {
      result.push(`${start}->${nums[j]}`);
    }

    // Skip all visited consecutive elements
    i = j + 1;
  }

  return result;
}
```

### Complexity Breakdown
- **Time Complexity**: $O(N)$ — Although there are nested loops, pointer $j$ strictly advances and $i$ jumps to $j + 1$. Each element is visited at most twice.
- **Space Complexity**: $O(1)$ auxiliary space (ignoring the output list).

#### 🎙️ How to Explain to Interviewer
> *"We maintain a `start` variable at the beginning of each contiguous run and advance a secondary pointer $j$ while `nums[j + 1] === nums[j] + 1`. Once continuity breaks, we format the range and advance the outer pointer to $j + 1$. Because each element is scanned at most twice, this runs in linear $O(N)$ time."*

---

## 3. Level 2: Optimized Approach (Explicit Two Pointers Framework)

### Intuition & Visual Bottleneck Elimination
We can structure the solution using a standard **Two Pointers** interval expansion pattern:
- `left` points to the start of the current range.
- `right` traverses the array.
Whenever `nums[right] + 1 !== nums[right + 1]`, the interval bounded by `[nums[left], nums[right]]` is complete. We record the interval, and move `left = right + 1`.

```mermaid
flowchart TD
    Init["left = 0"] --> Loop["Iterate right from 0 to n-1"]
    Loop --> Check{"right === n - 1 OR nums[right] + 1 !== nums[right + 1]?"}
    Check -->|"No"| NextR["right++"]
    Check -->|"Yes"| Flush{"left === right ?"}
    Flush -->|"Yes"| AddOne["result.push(`${nums[left]}`)"]
    Flush -->|"No"| AddRange["result.push(`${nums[left]}->${nums[right]}`)"]
    AddOne --> MoveLeft["left = right + 1"]
    AddRange --> MoveLeft
    MoveLeft --> NextR
    NextR --> Loop
```

### Pseudocode
```text
FUNCTION summaryRangesTwoPointers(nums):
    result = []
    n = nums.length
    left = 0
    
    FOR right FROM 0 TO n - 1:
        // Boundary condition: last element or discontinuity ahead
        IF right == n - 1 OR nums[right] + 1 != nums[right + 1]:
            IF left == right:
                result.append(STRING(nums[left]))
            ELSE:
                result.append(STRING(nums[left]) + "->" + STRING(nums[right]))
            left = right + 1
            
    RETURN result
```

### Step-by-Step Dry Run
`nums = [0, 2, 3]`

| `right` | `nums[right]` | `left` | Discontinuity Condition? | Result Array After Action | `left` After Action |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | 0 | 0 | $0 + 1 \neq 2$ (Discontinuity) | `["0"]` | 1 |
| 1 | 2 | 1 | $2 + 1 == 3$ (Continuous) | `["0"]` | 1 |
| 2 | 3 | 1 | `right == n - 1` (End of array) | `["0", "2->3"]` | 3 |

### Modern JavaScript Implementation
```javascript
/**
 * Level 2: Two Pointers Sliding Boundary
 * Time Complexity:  O(N)
 * Space Complexity: O(1) Auxiliary Space
 */
function summaryRangesTwoPointers(nums) {
  const result = [];
  const n = nums.length;
  let left = 0;

  for (let right = 0; right < n; right++) {
    // Check if right is the end of the current contiguous block
    if (right === n - 1 || nums[right] + 1 !== nums[right + 1]) {
      if (left === right) {
        result.push(`${nums[left]}`);
      } else {
        result.push(`${nums[left]}->${nums[right]}`);
      }
      left = right + 1;
    }
  }

  return result;
}
```

### Complexity Breakdown
- **Time Complexity**: $O(N)$ — Single forward pass from $0$ to $n - 1$.
- **Space Complexity**: $O(1)$ auxiliary space.

#### 🎙️ How to Explain to Interviewer
> *"By formalizing the problem with two pointers, `right` scans forward while `left` anchors the interval head. An interval boundary occurs if and only if `right === n - 1` or the continuity check `nums[right] + 1 !== nums[right + 1]` triggers. This eliminates nested loop pointer tracking and results in clean, idiomatic code."*

---

## 4. Level 3: Most Optimal / Canonical Approach (Single-Pass State Machine with Zero Allocation Tracking)

### Intuition & Mathematical Proof
We can view range generation as a **finite state machine** that consumes integers one by one:
- State variable: `rangeStart` (the numeric starting value of the active sequence).
- On each index $i$:
  - If $i === n - 1$ or $nums[i + 1] \neq nums[i] + 1$, the active range terminates at $nums[i]$.
  - Emit the formatted string into the output array.
  - If not at the end of the array, transition to the next state: `rangeStart = nums[i + 1]`.

**Arithmetic Safety Guard**:
Never write `nums[i + 1] - nums[i] !== 1`!
If `nums[i + 1] = 2147483647` and `nums[i] = -2147483648`, the subtraction produces $4294967295$. While JavaScript numbers are 64-bit double precision floats (safe up to $2^{53} - 1$), in low-level languages or when typed arrays are involved, integer subtraction overflows. Always write `nums[i + 1] !== nums[i] + 1`.

```
nums:       [  0  ,  1  ,  2  ,  4  ,  5  ,  7  ]
i:             0     1     2     3     4     5
rangeStart:    0     0     0     4     4     7
Action:                    ^                 ^
                     Flush "0->2"        Flush "7"
```

```mermaid
flowchart TD
    EmptyCheck{"nums.length === 0 ?"} -->|"Yes"| Empty["Return []"]
    EmptyCheck -->|"No"| Init["rangeStart = nums[0]; result = []"]
    Init --> Loop["Iterate i from 0 to n-1"]
    Loop --> Check{"i === n - 1 OR nums[i + 1] !== nums[i] + 1 ?"}
    Check -->|"No"| NextI["i++"]
    Check -->|"Yes"| Emit{"rangeStart === nums[i] ?"}
    Emit -->|"Yes"| PushS["result.push(rangeStart.toString())"]
    Emit -->|"No"| PushR["result.push(`${rangeStart}->${nums[i]}`)"]
    PushS --> NextState{"i < n - 1 ?"}
    PushR --> NextState
    NextState -->|"Yes"| Update["rangeStart = nums[i + 1]"]
    NextState -->|"No"| Done["Loop ends"]
    Update --> NextI
    NextI --> Loop
    Done --> Final["Return result"]
```

### Pseudocode
```text
FUNCTION summaryRanges(nums):
    IF nums.length == 0: RETURN []
    result = []
    rangeStart = nums[0]
    
    FOR i FROM 0 TO nums.length - 1:
        IF i == nums.length - 1 OR nums[i + 1] != nums[i] + 1:
            IF rangeStart == nums[i]:
                result.append(STRING(rangeStart))
            ELSE:
                result.append(rangeStart + "->" + nums[i])
            IF i + 1 < nums.length:
                rangeStart = nums[i + 1]
                
    RETURN result
```

### Step-by-Step Dry Run
`nums = [-1, 0, 1, 3]`

| `i` | `nums[i]` | `rangeStart` | Terminal Condition Met? | String Produced | Next `rangeStart` |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | -1 | -1 | No ($0 == -1 + 1$) | - | -1 |
| 1 | 0 | -1 | No ($1 == 0 + 1$) | - | -1 |
| 2 | 1 | -1 | Yes ($3 \neq 1 + 1$) | `"-1->1"` | 3 |
| 3 | 3 | 3 | Yes ($i == n - 1$) | `"3"` | - |
| End | - | - | - | **`["-1->1", "3"]`** | - |

### Modern JavaScript Implementation
```javascript
/**
 * Level 3: Canonical State Machine with Safe Addition Invariant
 * Time Complexity:  O(N)
 * Space Complexity: O(1) Auxiliary Space
 */
function summaryRanges(nums) {
  const n = nums.length;
  if (n === 0) return [];

  const result = [];
  let rangeStart = nums[0];

  for (let i = 0; i < n; i++) {
    // Trigger range flush if last element or next element is non-consecutive
    if (i === n - 1 || nums[i + 1] !== nums[i] + 1) {
      if (rangeStart === nums[i]) {
        result.push(String(rangeStart));
      } else {
        result.push(`${rangeStart}->${nums[i]}`);
      }

      // Transition to next range start
      if (i < n - 1) {
        rangeStart = nums[i + 1];
      }
    }
  }

  return result;
}
```

### Complexity Breakdown
- **Time Complexity**: $O(N)$ — Exactly one linear scan of length $N$.
- **Space Complexity**: $O(1)$ auxiliary space — Only two scalar trackers (`rangeStart`, `i`).

#### 🎙️ How to Explain to Interviewer
> *"We maintain `rangeStart` as state. As we iterate through `nums`, we test whether the current element terminates the range (either because it is the final array index or because `nums[i + 1] !== nums[i] + 1`). When the boundary is hit, we push the formatted string and set `rangeStart = nums[i + 1]`. Using addition instead of subtraction avoids numeric overflow edge cases."*

---

## 5. JavaScript-Specific Gotchas & V8 Optimizations
- **String Template vs String Concatenation**: In V8, `` `${a}->${b}` `` is compiled directly into a specialized string builder runtime call, outperforming multiple `+` string concatenations.
- **Handling Single Numbers**: `String(rangeStart)` or `` `${rangeStart}` `` avoids boxing numeric values into Number wrapper objects.

---

## 6. Real-World MAANG Interview Follow-Ups & Extensions

### Follow-Up 1: Missing Ranges (LeetCode 163)
- **Scenario**: Given a sorted unique integer array `nums` and an inclusive interval `[lower, upper]`, return the missing ranges that cover all missing numbers.
- **Solution Strategy**: Compare against previous element starting with `lower - 1`. If `curr - prev >= 2`, emit missing range between `prev + 1` and `curr - 1`.
- **JS Code**:
```javascript
function findMissingRanges(nums, lower, upper) {
  const result = [];
  let prev = lower - 1;

  for (let i = 0; i <= nums.length; i++) {
    const curr = i < nums.length ? nums[i] : upper + 1;

    if (curr - prev >= 2) {
      const start = prev + 1;
      const end = curr - 1;
      result.push(start === end ? `${start}` : `${start}->${end}`);
    }

    prev = curr;
  }

  return result;
}
```

### Follow-Up 2: Dynamic Data Stream Range Aggregator (LeetCode 352)
- **Scenario**: Integers arrive dynamically from a stream. Maintain and query the current list of disjoint summary ranges efficiently.
- **Solution Strategy**: Maintain a Map or Balanced BST of intervals. When $x$ arrives, check if it merges with interval ending at $x - 1$ and/or interval starting at $x + 1$.
- **JS Code**:
```javascript
class SummaryRangesStream {
  constructor() {
    this.nums = new Set();
  }

  addNum(value) {
    this.nums.add(value);
  }

  getIntervals() {
    const sorted = Array.from(this.nums).sort((a, b) => a - b);
    const intervals = [];
    if (sorted.length === 0) return intervals;

    let start = sorted[0];
    let end = sorted[0];

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === end + 1) {
        end = sorted[i];
      } else {
        intervals.push([start, end]);
        start = end = sorted[i];
      }
    }
    intervals.push([start, end]);
    return intervals;
  }
}
```

---

## 7. What LeetCode Discuss Says (Language-Independent)

Source: top-voted post by Aryant Tripathi —
`https://leetcode.com/problems/summary-ranges/solutions/1805583/c-detailed-explanation-w-dry-run-faster-z6tx6/`
— 315 votes / 42.1K views / 28 comments.
Language-independent summary. No new JS here.

### A. Post's way: expected-number scan

Sorted input is the gift: each step
expects previous + 1. A mismatch
closes the range. Single numbers
print bare, spans print a->b.

```text
FUNCTION rangesOptimal(nums):
    IF EMPTY: RETURN []
    out = []
    start = nums[0]
    FOR i FROM 1 TO n - 1:
        IF nums[i] != nums[i-1] + 1:
            PUSH FORMAT(start, nums[i-1])
            start = nums[i]
    PUSH FORMAT(start, nums[n-1])
    RETURN out
FUNCTION FORMAT(a, b):
    RETURN a == b ? "a" : "a->b"
```

- Time: O(n)
- Space: O(1) extra

```mermaid
flowchart TD
    Init["start=nums[0]"] --> Loop{"i<n?"}
    Loop -->|"Yes"| Gap{"nums[i]!=prev+1?"}
    Gap -->|Yes| Flush["push format, start=nums[i]"]
    Gap -->|No| Next["i++"]
    Flush --> Next
    Next --> Loop
    Loop -->|"No"| Last["push final range"]
```

### B. Dry run on LeetCode Example 1

`nums = [0, 1, 2, 4, 5, 7]`

| i | nums[i] | Expected? | Action |
| :--- | :--- | :--- | :--- |
| 1 | 1 | Yes | - |
| 2 | 2 | Yes | - |
| 3 | 4 | No (3) | Push 0->2 |
| 4 | 5 | Yes | - |
| 5 | 7 | No (6) | Push 4->5 |
| end | - | - | Push 7 |

### C. Why this is enough

- Sorted order removes all search.
- One comparison per element.
- Format rule is the only branch.

### D. Pitfalls from comments

- Empty array: return [] first.
- Single-element range prints
  bare ("7", not "7->7").
- Last range flushes AFTER
  the loop, not inside.
- Two-liner variants exist (4)
  but hide the format rule.

### E. Companies

- Discuss post itself names none.
- External source:
  `https://github.com/liquidslr/leetcode-company-wise-problems`
  (LeetCode company tags, updated June 2025).
- All-time (9): Amazon, Bloomberg,
  Google, Meta, Microsoft, Netflix,
  Tinkoff, VK, Yandex.
- Recent: 30 days — none.
- Recent: 3 months — Amazon,
  Google, Yandex.

---

## 7. What LeetCode Discuss Says (Language-Independent)

Source: top-voted post by Pradhuman Gupta —
`https://leetcode.com/problems/summary-ranges/solutions/3990812/beats-100-two-pointers-explanation-java-c-python-javascript/`
— 20.1K views / 114 votes / 6 comments.
Language-independent summary. No new JS here.

### A. Optimal way from Discuss (Two Pointers)

The optimal and most straightforward way to solve this is using a simple **Two-Pointer** approach (or a start/end index tracker) with a single pass through the array. 
Because the input array is already sorted and contains unique integers, consecutive sequences are perfectly adjacent. We can maintain a `start` pointer. As we iterate through with an `end` pointer, we check if the next number `nums[i]` is exactly `nums[i-1] + 1`. If it is, we extend the range. If it is not, the sequence is broken, and we format the range from `start` to `end-1` into the result list, and reset `start` to `end`.

```text
FUNCTION summaryRanges(nums):
    result = empty List
    n = length(nums)
    
    IF n == 0:
        RETURN result
        
    start = nums[0]
    
    FOR i = 1 TO n:
        // If we reach the end OR the sequence breaks
        IF i == n OR nums[i] != nums[i - 1] + 1:
            // Format the current range
            IF start == nums[i - 1]:
                result.add(String(start))
            ELSE:
                result.add(String(start) + "->" + String(nums[i - 1]))
                
            // Reset start for the next range
            IF i < n:
                start = nums[i]
                
    RETURN result
```

- Time: O(N) where N is the length of `nums`. We traverse the array exactly once. String formatting is proportional to the number of output strings, bounded by $N$.
- Space: O(1) auxiliary space (excluding the space needed for the output list of strings).

```mermaid
flowchart TD
    Init["result = [], start = nums[0]"] --> CheckEmpty{"len(nums) == 0?"}
    CheckEmpty -->|"Yes"| ReturnEmpty["Return result"]
    CheckEmpty -->|"No"| Loop{"For i = 1 to N"}
    Loop -->|"Next i"| CheckBreak{"i == N OR<br>nums[i] != nums[i-1] + 1?"}
    CheckBreak -->|"No (Sequence continues)"| Loop
    CheckBreak -->|"Yes (Sequence breaks)"| FormatRange{"start == nums[i-1]?"}
    FormatRange -->|"Yes"| AddSingle["result.push(str(start))"]
    FormatRange -->|"No"| AddRange["result.push(str(start) + '->' + str(nums[i-1]))"]
    AddSingle --> ResetStart{"i < N?"}
    AddRange --> ResetStart
    ResetStart -->|"Yes"| DoReset["start = nums[i]"]
    ResetStart -->|"No"| Loop
    DoReset --> Loop
    Loop -->|"Done"| Return["Return result"]
```

### B. Dry run on LeetCode Example 1 (nums = [0,1,2,4,5,7])

`n` = 6. `start` = 0.

| `i` | `nums[i]` | Condition `nums[i] != nums[i-1] + 1` | Action | `result` list |
| :--- | :--- | :--- | :--- | :--- |
| 1 | 1 | 1 != 0 + 1 (False) | Continue | `[]` |
| 2 | 2 | 2 != 1 + 1 (False) | Continue | `[]` |
| 3 | 4 | 4 != 2 + 1 **(True)** | Break! Range: `0` to `2`. Reset `start` to 4. | `["0->2"]` |
| 4 | 5 | 5 != 4 + 1 (False) | Continue | `["0->2"]` |
| 5 | 7 | 7 != 5 + 1 **(True)** | Break! Range: `4` to `5`. Reset `start` to 7. | `["0->2", "4->5"]` |
| 6 | - | `i == n` **(True)** | Break! Range: `7` to `7`. | `["0->2", "4->5", "7"]` |

Final Result: `["0->2", "4->5", "7"]`.

### C. Pitfalls from comments

- **The Last Element Edge Case:** A very common bug in string-building loops is forgetting to add the final accumulated range when the loop finishes. Many developers write a loop from `1` to `N-1`, and then manually write duplicate logic outside the loop to handle the final sequence. By letting the loop run to `i == n` (and checking `i == n` inside the loop), you gracefully handle the final element without duplicating the string formatting logic.
- **Integer Overflow:** The problem guarantees `-2^31 <= nums[i] <= 2^31 - 1`. Therefore, checking `nums[i] == nums[i-1] + 1` could technically cause integer overflow in languages with fixed-size 32-bit integers if `nums[i-1]` is exactly $2^{31}-1$. Fortunately, `nums[i]` cannot be greater than $2^{31}-1$, so the only way `nums[i-1]` is $2^{31}-1$ is if it's the absolute maximum possible element, meaning there is no `nums[i]` after it, so the comparison doesn't evaluate anyway. Still, strict static analyzers sometimes flag `nums[i-1] + 1`. A safer check is `nums[i] - nums[i-1] == 1` (though `nums[i] - nums[i-1]` can *also* overflow if `nums[i-1]` is negative, so `long` casting is preferred in Java/C++).
- **Python grouping shortcut:** In Python, the `itertools.groupby` function can elegantly solve this by grouping on `n - i` (value minus index). Since the array is sorted, `n - i` remains constant for contiguous sequences. While elegant ("Two lines of code for this task"), an interviewer will still ask you to implement the raw pointer logic without library tricks.

### D. Companies

- Discuss post itself names none.
  Companies tab on LeetCode is premium-locked.
- External source:
  `https://github.com/liquidslr/leetcode-company-wise-problems`
  (LeetCode company tags, updated June 2025).
- All-time (9): Amazon, Bloomberg, Google, Meta, Microsoft, Netflix, Tinkoff, VK, Yandex.
- Recent: 30 days — (None listed).
- Recent: 3 months — Amazon, Google, Yandex.

# 56. Merge Intervals

- **LeetCode Link**: `https://leetcode.com/problems/merge-intervals/`
- **Difficulty**: Medium
- **Pattern Category**: Intervals / Sorting / Greedy Overlap Reduction
- **Prerequisite Primer**: `00-foundations/01-js-interview-runtime-quirks.md`

---

## 1. Problem Overview & Edge Case Matrix

### Problem Statement
Given an array of `intervals` where `intervals[i] = [start_i, end_i]`, merge all overlapping intervals, and return an array of the **non-overlapping intervals** that cover all the intervals in the input.

```
Example 1:
Input: intervals = [[1, 3], [2, 6], [8, 10], [15, 18]]
Output: [[1, 6], [8, 10], [15, 18]]
Explanation: Since intervals [1, 3] and [2, 6] overlap, merge them into [1, 6].

Example 2:
Input: intervals = [[1, 4], [4, 5]]
Output: [[1, 5]]
Explanation: Intervals [1, 4] and [4, 5] are considered overlapping at point 4.
```

### Overlap Condition
For two intervals $A = [s_A, e_A]$ and $B = [s_B, e_B]$ sorted such that $s_A \le s_B$:
$$\text{Overlap occurs if and only if } s_B \le e_A$$
When merged, the combined interval becomes:
$$\left[ s_A, \max(e_A, e_B) \right]$$

### Upfront Edge Case Matrix

| Edge Case Scenario | Inputs | Expected Output | Pitfall / Failure Mode |
| :--- | :--- | :--- | :--- |
| Empty Input | `intervals = []` | `[]` | Accessing `intervals[0]` |
| Single Interval | `intervals = [[1, 4]]` | `[[1, 4]]` | Loop indexing out-of-bounds |
| Fully Contained Interval | `intervals = [[1, 5], [2, 3]]` | `[[1, 5]]` | Truncating end to `3` instead of $\max(5, 3)$ |
| Touching Endpoints | `intervals = [[1, 2], [2, 3]]` | `[[1, 3]]` | Strict inequality check (`<` instead of `<=`) |
| Unsorted Reverse Input | `intervals = [[5, 6], [1, 3], [2, 4]]` | `[[1, 4], [5, 6]]` | Forgetting upfront sorting step |

---

## 2. Level 1: Brute Force Approach (Iterative Pairwise Consolidation)

### Intuition & Visual Idea
Until no two intervals overlap, repeatedly scan the array for any pair of intervals $(i, j)$ that overlap. When an overlapping pair is found, replace the two with their union $[\min(s_i, s_j), \max(e_i, e_j)]$ and restart the search.

```mermaid
flowchart TD
    Start["active = [...intervals]"] --> FindPair{"Find overlapping pair (i, j) ?"}
    FindPair -->|"Yes"| Merge["merged = [min(s_i, s_j), max(e_i, e_j)]; delete i and j; push merged"]
    Merge --> FindPair
    FindPair -->|"No (all disjoint)"| Done["Return active"]
```

### Pseudocode
```text
FUNCTION mergeBruteForce(intervals):
    IF intervals.length <= 1: RETURN intervals
    active = COPY(intervals)
    changed = true
    
    WHILE changed:
        changed = false
        FOR i FROM 0 TO active.length - 1:
            FOR j FROM i + 1 TO active.length - 1:
                IF OVERLAPS(active[i], active[j]):
                    merged = [MIN(active[i][0], active[j][0]), MAX(active[i][1], active[j][1])]
                    active.REMOVE(j)
                    active.REMOVE(i)
                    active.APPEND(merged)
                    changed = true
                    BREAK
            IF changed: BREAK
            
    RETURN active
```

### Step-by-Step Dry Run
`intervals = [[2, 6], [1, 3], [8, 10]]`

| Pass | Pair Checked | Overlap? | Action | Active List |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `[2, 6]` and `[1, 3]` | Yes ($1 \le 6$ and $2 \le 3$) | Merge $\to [1, 6]$ | `[[8, 10], [1, 6]]` |
| 2 | `[8, 10]` and `[1, 6]` | No | No change | `[[8, 10], [1, 6]]` |
| End | No overlapping pairs | - | Complete | `[[8, 10], [1, 6]]` |

### Modern JavaScript Implementation
```javascript
/**
 * Level 1: Iterative Pairwise Consolidation
 * Time Complexity:  O(N^3) in worst case (N reductions * N^2 pair scans)
 * Space Complexity: O(N) auxiliary space
 */
function mergeBruteForce(intervals) {
  if (intervals.length <= 1) return intervals;

  const list = intervals.map(int => [...int]);
  let changed = true;

  while (changed) {
    changed = false;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [s1, e1] = list[i];
        const [s2, e2] = list[j];

        // Overlap condition for arbitrary unsorted intervals
        if (Math.max(s1, s2) <= Math.min(e1, e2)) {
          const merged = [Math.min(s1, s2), Math.max(e1, e2)];
          list.splice(j, 1);
          list.splice(i, 1);
          list.push(merged);
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }

  return list;
}
```

### Complexity Breakdown
- **Time Complexity**: $O(N^3)$ — In the worst case, $N$ merges occur, each requiring an $O(N^2)$ search followed by $O(N)$ `splice()` operations.
- **Space Complexity**: $O(N)$ — Storing working array copy.

#### 🎙️ How to Explain to Interviewer
> *"The naive approach models intervals without sorting by repeatedly hunting for overlapping pairs, replacing them with their unified interval until no overlaps remain. While correct, repeated pairwise array mutations lead to cubic $O(N^3)$ runtime."*

---

## 3. Level 2: Optimized Approach (Sorting by Start Time + Auxiliary Merged Array)

### Intuition & Visual Bottleneck Elimination
The fundamental bottleneck in Level 1 is the lack of ordering: an interval could overlap with any arbitrary element.
**Solution**: Sort all intervals ascending by their start time:
`intervals.sort((a, b) => a[0] - b[0])`

Once sorted, any interval can **only overlap with the immediately preceding merged interval**!
1. Initialize `merged = [intervals[0]]`.
2. For each subsequent interval `curr`:
   - If `curr[0] <= merged[merged.length - 1][1]`: Overlap! Extend the last merged interval:
     `merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], curr[1])`.
   - Otherwise: No overlap! Push `curr` as a new disjoint interval into `merged`.

```mermaid
flowchart TD
    Sort["Sort intervals: a[0] - b[0]"] --> Init["merged = [intervals[0]]"]
    Init --> Loop["For i from 1 to n-1:"]
    Loop --> OverlapCheck{"intervals[i][0] <= merged.at(-1)[1] ?"}
    OverlapCheck -->|"Yes (Overlap)"| Extend["merged.at(-1)[1] = max(merged.at(-1)[1], intervals[i][1])"]
    OverlapCheck -->|"No (Disjoint)"| Append["merged.push(intervals[i])"]
    Extend --> Next["Next interval"]
    Append --> Next
    Next --> Loop
    Loop -->|"Done"| Return["Return merged"]
```

### Pseudocode
```text
FUNCTION mergeOptimized(intervals):
    IF intervals.length <= 1: RETURN intervals
    SORT intervals ASCENDING BY start_time
    
    merged = [intervals[0]]
    
    FOR i FROM 1 TO intervals.length - 1:
        curr = intervals[i]
        last = merged[merged.length - 1]
        
        IF curr[0] <= last[1]:
            last[1] = MAX(last[1], curr[1])
        ELSE:
            merged.APPEND(curr)
            
    RETURN merged
```

### Step-by-Step Dry Run
`intervals = [[1, 3], [2, 6], [8, 10], [15, 18]]`

| `i` | Current `[s, e]` | Last Merged `[ms, me]` | Overlap? ($s \le me$) | Action | `merged` After Step |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Init | - | - | - | Initialize with `intervals[0]` | `[[1, 3]]` |
| 1 | `[2, 6]` | `[1, 3]` | $2 \le 3$ (Yes) | Update `me = max(3, 6) = 6` | `[[1, 6]]` |
| 2 | `[8, 10]` | `[1, 6]` | $8 \le 6$ (No) | Push `[8, 10]` | `[[1, 6], [8, 10]]` |
| 3 | `[15, 18]` | `[8, 10]` | $15 \le 10$ (No) | Push `[15, 18]` | `[[1, 6], [8, 10], [15, 18]]` |

### Modern JavaScript Implementation
```javascript
/**
 * Level 2: Sorting by Start Time + Auxiliary Merged List
 * Time Complexity:  O(N log N)
 * Space Complexity: O(N)
 */
function mergeOptimized(intervals) {
  if (intervals.length <= 1) return intervals;

  // Sort ascending by start coordinate
  intervals.sort((a, b) => a[0] - b[0]);

  const merged = [intervals[0]];

  for (let i = 1; i < intervals.length; i++) {
    const current = intervals[i];
    const lastMerged = merged[merged.length - 1];

    if (current[0] <= lastMerged[1]) {
      // Overlapping: absorb current interval
      lastMerged[1] = Math.max(lastMerged[1], current[1]);
    } else {
      // Disjoint: begin new interval sequence
      merged.push(current);
    }
  }

  return merged;
}
```

### Complexity Breakdown
- **Time Complexity**: $O(N \log N)$ — Sorting $N$ intervals takes $O(N \log N)$; linear scan takes $O(N)$.
- **Space Complexity**: $O(N)$ — Auxiliary `merged` array holds up to $N$ intervals.

#### 🎙️ How to Explain to Interviewer
> *"Sorting by start time guarantees that any overlap can only occur with the most recently merged interval. In a single pass, we compare the current interval's start against the tail interval's end. If they overlap, we stretch the tail's end; otherwise, we append the new interval. This runs in $O(N \log N)$ time."*

---

## 4. Level 3: Most Optimal / Canonical Approach (In-Place Array Compaction with Write Pointer)

### Intuition & Mathematical Proof
Can we merge intervals in-place with **$O(1)$ auxiliary space** without allocating a new array?
**Yes!** We use an in-place **Read/Write Pointer (Fast/Slow Pointer)** pattern:
- Sort `intervals` in-place.
- `writeIdx = 0` tracks the index of the latest merged interval in the array.
- `readIdx` scans from $1$ to $N - 1$:
  - If `intervals[readIdx][0] <= intervals[writeIdx][1]`:
    Extend: `intervals[writeIdx][1] = Math.max(intervals[writeIdx][1], intervals[readIdx][1])`.
  - Else:
    Advance write pointer: `writeIdx++`.
    Write: `intervals[writeIdx] = intervals[readIdx]`.
- Finally, truncate the array in-place: `intervals.length = writeIdx + 1`.

This achieves zero auxiliary array allocations, maximized CPU cache locality, and minimal V8 GC pressure.

```
Initial sorted:  [ [1,3] , [2,6] , [8,10] , [15,18] ]
                    ^       ^
                 write     read

Step 1: 2 <= 3 -> extend write[1] to max(3,6) = 6
Array:           [ [1,6] , [2,6] , [8,10] , [15,18] ]
                    ^
                 write

Step 2: 8 > 6  -> write++ -> write = 1 -> intervals[1] = [8,10]
Array:           [ [1,6] , [8,10] , [8,10] , [15,18] ]
                             ^        ^
                           write     read

Step 3: 15 > 10 -> write++ -> write = 2 -> intervals[2] = [15,18]
Array:           [ [1,6] , [8,10] , [15,18] , [15,18] ]
                                      ^
                                    write
Truncate: intervals.length = 3
Result:   [ [1,6] , [8,10] , [15,18] ]
```

```mermaid
flowchart TD
    Sort["In-place sort: intervals.sort((a,b) => a[0] - b[0])"] --> Init["writeIdx = 0"]
    Init --> Loop["For readIdx from 1 to n-1:"]
    Loop --> Check{"intervals[readIdx][0] <= intervals[writeIdx][1] ?"}
    Check -->|"Yes (Merge)"| Merge["intervals[writeIdx][1] = max(intervals[writeIdx][1], intervals[readIdx][1])"]
    Check -->|"No (Disjoint)"| Advance["writeIdx++; intervals[writeIdx] = intervals[readIdx]"]
    Merge --> Next["readIdx++"]
    Advance --> Next
    Next --> Loop
    Loop -->|"Done"| Trunc["intervals.length = writeIdx + 1"]
    Trunc --> Ret["Return intervals"]
```

### Pseudocode
```text
FUNCTION merge(intervals):
    IF intervals.length <= 1: RETURN intervals
    SORT intervals IN-PLACE BY start_time
    
    writeIdx = 0
    
    FOR readIdx FROM 1 TO intervals.length - 1:
        IF intervals[readIdx][0] <= intervals[writeIdx][1]:
            intervals[writeIdx][1] = MAX(intervals[writeIdx][1], intervals[readIdx][1])
        ELSE:
            writeIdx = writeIdx + 1
            intervals[writeIdx] = intervals[readIdx]
            
    intervals.LENGTH = writeIdx + 1
    RETURN intervals
```

### Step-by-Step Dry Run
`intervals = [[1, 4], [0, 4]]` $\to$ after sort: `[[0, 4], [1, 4]]`

| `readIdx` | `intervals[readIdx]` | `writeIdx` | `intervals[writeIdx]` | Overlap? | Action |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Start | - | 0 | `[0, 4]` | - | - |
| 1 | `[1, 4]` | 0 | `[0, 4]` | $1 \le 4$ (Yes) | `intervals[0][1] = max(4, 4) = 4` |
| End | Loop terminates | 0 | - | - | `intervals.length = 0 + 1 = 1` |
| Output | `[[0, 4]]` | - | - | - | - |

### Modern JavaScript Implementation
```javascript
/**
 * Level 3: Canonical In-Place Compaction with Write Pointer
 * Time Complexity:  O(N log N)
 * Space Complexity: O(1) Auxiliary Space (ignoring V8 TimSort stack)
 */
function merge(intervals) {
  const n = intervals.length;
  if (n <= 1) return intervals;

  // In-place sort by start coordinate
  intervals.sort((a, b) => a[0] - b[0]);

  let writeIdx = 0;

  for (let readIdx = 1; readIdx < n; readIdx++) {
    // Check if current interval overlaps with active merged interval
    if (intervals[readIdx][0] <= intervals[writeIdx][1]) {
      intervals[writeIdx][1] = Math.max(
        intervals[writeIdx][1],
        intervals[readIdx][1]
      );
    } else {
      // Move write pointer forward and copy disjoint interval
      writeIdx++;
      intervals[writeIdx] = intervals[readIdx];
    }
  }

  // Truncate array in-place to merged size
  intervals.length = writeIdx + 1;
  return intervals;
}
```

### Complexity Breakdown
- **Time Complexity**: $O(N \log N)$ — Dominated by in-place TimSort. The linear traversal and in-place copy takes $O(N)$.
- **Space Complexity**: $O(1)$ auxiliary space — Mutates and truncates the existing array without allocating a secondary results array.

#### 🎙️ How to Explain to Interviewer
> *"By sorting the input array in-place, we can merge intervals directly into the existing buffer using a read/write pointer compaction pattern. If an interval overlaps with `intervals[writeIdx]`, we update its end boundary in-place; if not, we advance `writeIdx` and copy the reference over. Finally, resetting `intervals.length = writeIdx + 1` truncates trailing garbage with $O(1)$ auxiliary memory."*

---

## 5. JavaScript-Specific Gotchas & V8 Optimizations
- **In-Place Array Truncation (`intervals.length = writeIdx + 1`)**: In V8, setting `.length` on a JavaScript array directly updates the internal array backing store pointer and immediately makes trailing elements eligible for garbage collection.
- **Reference Sharing Caution**: In Level 3, `intervals[writeIdx] = intervals[readIdx]` copies the array reference. If callers require immutable data, Level 2 should be used. In competitive programming and high-performance engines, Level 3 is strictly preferred.

---

## 6. Real-World MAANG Interview Follow-Ups & Extensions

### Follow-Up 1: Streaming Interval Ingestion (Segment Tree / Interval Tree)
- **Scenario**: Intervals arrive dynamically in a real-time stream. How to maintain merged intervals and query total covered length in $O(\log N)$ per operation?
- **Solution Strategy**: Interval Tree or Segment Tree with dynamic coordinate compression.
- **JS Code**:
```javascript
class IntervalNode {
  constructor(start, end) {
    this.start = start;
    this.end = end;
    this.left = null;
    this.right = null;
  }
}

class StreamingIntervals {
  constructor() {
    this.root = null;
  }

  add(start, end) {
    // Insert and re-balance interval tree node
    this.root = this._insert(this.root, start, end);
  }

  _insert(node, start, end) {
    if (!node) return new IntervalNode(start, end);
    if (end < node.start) {
      node.left = this._insert(node.left, start, end);
    } else if (start > node.end) {
      node.right = this._insert(node.right, start, end);
    } else {
      // Overlap: merge into current node
      node.start = Math.min(node.start, start);
      node.end = Math.max(node.end, end);
    }
    return node;
  }
}
```

### Follow-Up 2: Parallel Divide-and-Conquer Merge
- **Scenario**: Given $10^8$ intervals that exceed single-core sorting performance, how do you merge them across multiple CPU threads?
- **Solution Strategy**: Partition intervals across worker chunks, sort each chunk, and merge chunk boundaries using a k-way heap merge.
- **JS Code**:
```javascript
function mergeParallelChunks(chunks) {
  // Each worker returns pre-sorted, merged local chunks
  // Perform k-way merge of sorted chunk boundaries
  const allIntervals = chunks.flat().sort((a, b) => a[0] - b[0]);
  return merge(allIntervals);
}
```

---

## 7. What LeetCode Discuss Says (Language-Independent)

Source: top-voted post by brubru777 —
`https://leetcode.com/problems/merge-intervals/solutions/21222/a-simple-java-solution-by-brubru777-83sh/`
— 840 votes / 268.8K views / 124 comments.
Language-independent summary. No new JS here.

### A. Naive way (baseline context)

Compare every pair, merge any
overlap, repeat until stable.
Correct, wasteful.

```text
FUNCTION mergeNaive(intervals):
    REPEAT:
        changed = False
        FOR each pair (a, b):
            IF OVERLAP(a, b):
                MERGE into one
                changed = True
    UNTIL NOT changed
```

- Time: O(n cubed)
- Space: O(n)

### B. Post's way: sort, then sweep once

Sorted starts turn overlap into a
local check: next start past the
running end means a clean break.
Otherwise stretch the end.

```text
FUNCTION mergeOptimal(intervals):
    SORT BY start
    out = [intervals[0]]
    FOR [s, e] IN intervals[1:]:
        IF s <= out[TAIL][1]:
            out[TAIL][1] = MAX(out[TAIL][1], e)
        ELSE:
            PUSH [s, e]
    RETURN out
```

- Time: O(n log n)
- Space: O(n) output

```mermaid
flowchart TD
    S["Sort by start"] --> Loop{"more [s,e]?"}
    Loop -->|"Yes"| Over{"s<=tail end?"}
    Over -->|Yes| Stretch["tail end=max"]
    Over -->|No| Push["push new"]
    Stretch --> Loop
    Push --> Loop
    Loop -->|"No"| Done["Return out"]
```

### C. Dry run on LeetCode Example 1

`[[1,3],[2,6],[8,10],[15,18]]`

| [s,e] | Tail | Action | out |
| :--- | :--- | :--- | :--- |
| [1,3] | - | Seed | [[1,3]] |
| [2,6] | [1,3] | 2<=3, end=6 | [[1,6]] |
| [8,10] | [1,6] | 8>6, push | [[1,6],[8,10]] |
| [15,18] | [8,10] | 15>10, push | +[15,18] |

### D. Why B wins

- Sorting buys the single pass:
  overlap is always adjacent.
- Running end absorbs chains
  ([1,3],[2,6] swallow more).
- Post kept it readable: lambda
  sort + for-each, no tricks.

### E. Pitfalls from comments

- Sibling drills in one thread
  (396): 252, 253, 435 Non-overlap
  differs by ~3 lines — do all four.
- Sort by START; end order only
  breaks ties.
- Touching edges ([1,4],[4,5])
  DO overlap — use <=, not <.
- Signature changed 2019 (arrays
  not lists) — old copies break.

### F. Companies

- Discuss post itself names none.
- External source:
  `https://github.com/liquidslr/leetcode-company-wise-problems`
  (LeetCode company tags, updated June 2025).
- All-time (101): Accenture, Adobe,
  Amazon, AMD, American Express,
  Anduril, Apple, Applied Intuition,
  athenahealth, Atlassian, Autodesk,
  Bloomberg, ByteDance, Capital One,
  Chewy, Cisco, Citadel, Coupang,
  CrowdStrike, Darwinbox, Databricks,
  Deloitte, Disney, Docusign,
  DoorDash, Dropbox, EarnIn, eBay,
  EPAM Systems, Expedia, Flipkart,
  Geico, General Motors, GoDaddy,
  Goldman Sachs, Google, Grammarly,
  Grubhub, Hubspot, IBM, Infosys,
  Intuit, IXL, Juspay, LinkedIn,
  MakeMyTrip, Meta, Microsoft,
  Millennium, MongoDB, Morgan Stanley,
  Moveworks, Netflix, Nextdoor,
  Nutanix, Nvidia, Okta, Oracle,
  Ozon, Palo Alto Networks, Patreon,
  PayPal, PhonePe, Pinterest,
  razorpay, Remitly, Ripple,
  Rippling, Roblox, Salesforce,
  Samsung, SAP, ServiceNow, Siemens,
  Sigmoid, Snap, Squarespace, Stripe,
  Swiggy, TCS, Tesco, Tesla, TikTok,
  Turing, Twitch, Uber, Verkada,
  Visa, VK, Walmart Labs,
  Wells Fargo, Wipro, Wix, X,
  Yandex, Yelp, Zalando, Zepto,
  Zeta, Zoho, Zomato.
- Recent: 30 days — Amazon,
  Bloomberg, Google, Infosys,
  Meta, Microsoft,
  Palo Alto Networks.
- Recent: 3 months — Amazon, Apple,
  Atlassian, Bloomberg, Coupang,
  Goldman Sachs, Google, IBM,
  Infosys, Meta, Microsoft,
  MongoDB, Palo Alto Networks,
  Salesforce, Visa, Yandex.

---

## 7. What LeetCode Discuss Says (Language-Independent)

Source: top-voted post by Pradhuman Gupta —
`https://leetcode.com/problems/merge-intervals/solutions/5248107/beats-97-95-beginner-friendly-explanation-java-python-c-javascript/`
— 48.4K views / 221 votes / 8 comments.
Language-independent summary. No new JS here.

### A. Optimal way from Discuss (Sort First, Merge in One Pass)

The foundational trick to almost all interval problems is **sorting the intervals by their start time**. 
Once the intervals are sorted by their start times, any intervals that can be merged must be adjacent to each other in the sorted list. This allows us to merge everything in a single pass.
We maintain a `prev` interval (or just look at the last interval in our `result` list). For each interval, we check if its start time overlaps with the `prev` interval's end time. If it does, we merge them by extending the `prev` interval's end time to the maximum of both end times. If it doesn't overlap, we push the interval to our `result` list and it becomes our new `prev`.

```text
FUNCTION merge(intervals):
    IF length(intervals) <= 1:
        RETURN intervals
        
    // Sort intervals by their start time
    SORT intervals BY intervals[i][0]
    
    result = empty List
    // Add the first interval to start comparing
    result.add(intervals[0])
    
    FOR i = 1 TO length(intervals) - 1:
        currentInterval = intervals[i]
        lastMergedInterval = result.getLast()
        
        // Check for overlap: does current start BEFORE or AT last merged end?
        IF currentInterval[0] <= lastMergedInterval[1]:
            // Merge them: update the end time to the maximum
            lastMergedInterval[1] = MAX(lastMergedInterval[1], currentInterval[1])
        ELSE:
            // No overlap, add to result
            result.add(currentInterval)
            
    RETURN result
```

- Time: O(N log N) dominated by the sorting step. The subsequent pass takes $O(N)$ time.
- Space: O(N) or O(log N) depending on the sorting algorithm's auxiliary space, plus $O(N)$ for the result list.

```mermaid
flowchart TD
    Init["Sort intervals by start time<br>result = [intervals[0]]"] --> Loop{"For i = 1 to N-1"}
    Loop -->|"Next i"| CheckOverlap{"intervals[i][0] <= result.last()[1]?"}
    CheckOverlap -->|"Yes (Overlap)"| Merge["result.last()[1] = max(result.last()[1], intervals[i][1])"]
    CheckOverlap -->|"No (Disjoint)"| AddNew["result.push(intervals[i])"]
    Merge --> Loop
    AddNew --> Loop
    Loop -->|"Done"| Return["Return result"]
```

### B. Dry run on LeetCode Example 1 (intervals = [[1,3],[2,6],[8,10],[15,18]])

The input is already sorted by start time.
`result` initialized to `[[1,3]]`.

| `i` | `current` | `lastMerged` | Overlap (`curr[0] <= last[1]`)? | Action | `result` state |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `[2,6]` | `[1,3]` | 2 <= 3 (**True**) | Merge. `last[1] = max(3, 6) = 6`. | `[[1,6]]` |
| 2 | `[8,10]` | `[1,6]` | 8 <= 6 (False) | Add `[8,10]` to result. | `[[1,6], [8,10]]` |
| 3 | `[15,18]`| `[8,10]` | 15 <= 10 (False) | Add `[15,18]` to result. | `[[1,6], [8,10], [15,18]]` |

Result: `[[1,6],[8,10],[15,18]]`.

### C. Pitfalls from comments

- **Sorting by End Time?** Some people try to sort by end time instead of start time. While sorting by end time is useful for finding the maximum number of *non-overlapping* intervals (like in problem 435. Non-overlapping Intervals), it makes merging adjacent intervals much harder because a later interval with an early start time could stretch back and swallow multiple previous intervals. Always sort by **start time** for merging.
- **Forgetting `Math.max` on the end time:** A common mistake when merging is writing `lastMergedInterval[1] = currentInterval[1]`. This fails when an interval completely swallows another, e.g., `[[1, 5], [2, 4]]`. The correct logic is `lastMergedInterval[1] = Math.max(lastMergedInterval[1], currentInterval[1])` to retain the `5`.
- **In-place merging:** A commenter notes that "In C++ creating a new vector is less efficient than editing the same vector". You *can* do this in-place by maintaining a `writeIndex` and modifying the input array, then truncating it at the end to save $O(N)$ space. However, modifying inputs is generally frowned upon in functional paradigms, and creating a new result list is the most standard, readable approach.

### D. Companies

- Discuss post itself names none.
  Companies tab on LeetCode is premium-locked.
- External source:
  `https://github.com/liquidslr/leetcode-company-wise-problems`
  (LeetCode company tags, updated June 2025).
- All-time (101): Accenture, Adobe, Amazon, AMD, American Express, Anduril, Apple, Applied Intuition, athenahealth, Atlassian, Bloomberg, ByteDance, Capital One, Chewy, Cisco, Citadel, Coupang, CrowdStrike, Darwinbox, Databricks, Deloitte, Disney, Docusign, DoorDash, Dropbox, EarnIn, eBay, EPAM Systems, Expedia, Flipkart, Geico, General Motors, GoDaddy, Goldman Sachs, Google, Grammarly, Grubhub, Hubspot, IBM, Infosys, Intuit, IXL, Juspay, LinkedIn, MakeMyTrip, Meta, Microsoft, Millennium, MongoDB, Morgan Stanley, Moveworks, Netflix, Nextdoor, Nutanix, Nvidia, Okta, Oracle, Ozon, Palo Alto Networks, Patreon, PayPal, PhonePe, Pinterest, razorpay, Remitly, Ripple, Rippling, Roblox, Salesforce, Samsung, SAP, ServiceNow, Siemens, Sigmoid, Snap, Squarespace, Stripe, Swiggy, TCS, Tesco, Tesla, TikTok, Turing, Twitch, Uber, Verkada, Visa, VK, Walmart Labs, Wells Fargo, Wipro, Wix, X, Yandex, Yelp, Zalando, Zepto, Zeta, Zoho, Zomato.
- Recent: 30 days — Amazon, Bloomberg, Google, Infosys, Meta, Microsoft, Palo Alto Networks.
- Recent: 3 months — Amazon, Apple, Atlassian, Bloomberg, Coupang, Goldman Sachs, Google, IBM, Infosys, Meta, Microsoft, MongoDB, Palo Alto Networks, Salesforce, Visa, Yandex.

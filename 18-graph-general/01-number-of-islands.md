# 200. Number of Islands

- **LeetCode Link**: `https://leetcode.com/problems/number-of-islands/`
- **Difficulty**: Medium
- **Pattern Category**: Graph / Connected Components (Flood Fill)
- **Prerequisite Primer**: `00-foundations/03-core-algorithmic-patterns.md`

---

## 1. Problem Overview & Edge Case Matrix

### Problem Statement
Given an `m x n` 2D binary grid representing land (`'1'`) and water (`'0'`), return the number of islands. An island is surrounded by water and formed by connecting adjacent lands horizontally or vertically. All four edges are surrounded by water. Assume all four edges of the grid are surrounded by water.

```
Example 1:
Input: grid = [["1","1","1","1","0"],["1","1","0","1","0"],["1","1","0","0","0"],["0","0","0","0","0"]]
Output: 1

Example 2:
Input: grid = [["1","1","0","0","0"],["1","1","0","0","0"],["0","0","1","0","0"],["0","0","0","1","1"]]
Output: 3
```

### Visual Problem Representation
```
1 1 0 0 0      island A: top-left block (4 cells)
1 1 0 0 0      island B: single (2,2)
0 0 1 0 0      island C: bottom-right pair
0 0 0 1 1      diagonal touch ≠ connected (4-directional only!)
```

### Upfront Edge Case Matrix
| Edge Case Category | Specific Input Scenario | Expected Behavior | Pitfall / Risk |
| :--- | :--- | :--- | :--- |
| All water | Zero `'1'` cells | Return `0` | Counter seeded at 1 |
| All land | Full `'1'` grid | Return `1` | Stack depth on huge component |
| Diagonal adjacency | `[[1,0],[0,1]]` | Return `2` (not connected!) | 8-directional flood |
| Single cell | `[["1"]]` / `[["0"]]` | `1` / `0` | Neighbor loop on 1×1 |
| Checkerboard | Alternating cells | Each land its own island | Visited marking omitted (infinite loop) |

---

## 2. Level 1: Brute Force Approach

### Intuition & Visual Idea
DFS flood fill with an explicit visited SET of `"r,c"` string keys — the board is never mutated. Each unvisited land cell starts a flood (count++); floods never cross water or visited cells. Correct — with per-cell string allocation as the tax.

```mermaid
flowchart TD
    Each["for each cell: land && !visited?"] -->|"Yes"| Flood["count++; dfs flood with visited set"]
    Each -->|"No"| Next["continue"]
    Flood --> Each
```

### Pseudocode
```text
FUNCTION numIslandsBruteForce(grid):
    m = ROWS; n = COLS; visited = EMPTY SET; count = 0
    DEFINE flood(r, c):
        IF OOB OR grid[r][c] == "0" OR visited HAS "r,c": RETURN
        visited.ADD("r,c")
        flood(4 NEIGHBORS)
    FOR EACH cell:
        IF grid[r][c] == "1" AND NOT visited HAS "r,c":
            count++; flood(r, c)
    RETURN count
```

### Step-by-Step Dry Run (Visual Trace)
| Step | Iteration / Pointer ($i, j$) | Current Value | State / Sub-array | Action Taken |
| :--- | :--- | :--- | :--- | :--- |
| 0 | cell `(0,0)` | unvisited land | `count = 1`, flood A | 4-cell flood |
| 1 | cells `(0,1)…` | visited / water | Skip | Continue scan |
| 2 | cell `(2,2)` | unvisited land | `count = 2`, flood B | Single-cell flood |
| 3 | cell `(3,3)` | unvisited land | `count = 3`, flood C | Return `3` |

### Modern JavaScript Implementation
```javascript
/**
 * Level 1: Brute Force (visited-set flood fill)
 * Time Complexity:  O(m·n) — each cell visited once
 * Space Complexity: O(m·n) — string-keyed visited set plus O(mn) stack
 */
function numIslandsBruteForce(grid) {
  const m = grid.length;
  if (m === 0) return 0;
  const n = grid[0].length;
  const visited = new Set();
  function flood(r, c) {
    // Water, walls, and seen cells all terminate the flood.
    if (r < 0 || r >= m || c < 0 || c >= n) return;
    if (grid[r][c] !== '1' || visited.has(r + ',' + c)) return;
    visited.add(r + ',' + c); // mark BEFORE recursing (else infinite loops)
    flood(r + 1, c);
    flood(r - 1, c);
    flood(r, c + 1);
    flood(r, c - 1);
  }
  let count = 0;
  for (let r = 0; r < m; r++) {
    for (let c = 0; c < n; c++) {
      // Unvisited land = a new island: count it, then flood it whole.
      if (grid[r][c] === '1' && !visited.has(r + ',' + c)) {
        count++;
        flood(r, c);
      }
    }
  }
  return count;
}
```

### Complexity Breakdown
- **Time Complexity**: $O(m·n)$ — each cell processed once.
- **Space Complexity**: $O(m·n)$ — string keys per land cell plus recursion depth.

---

## 3. Level 2: Optimized Approach

### Intuition & Visual Bottleneck Elimination
Sink islands in place: flood by flipping `'1'` → `'0'` directly on the board — the grid IS the visited set. No strings, no set, same $O(m·n)$ visits. (Mutates input: clone at the boundary if callers reuse the grid.)

```mermaid
flowchart TD
    Each["for each cell: '1'?"] -->|"Yes"| Sink["count++; dfs flip to '0'"]
    Each -->|"No"| Next["continue"]
    Sink --> Each
```

### Pseudocode
```text
FUNCTION numIslandsSink(grid):
    IF EMPTY: RETURN 0
    count = 0
    DEFINE sink(r, c):
        IF OOB OR grid[r][c] != "1": RETURN
        grid[r][c] = "0"     // sink: visited by destruction
        sink(4 NEIGHBORS)
    FOR EACH cell:
        IF grid[r][c] == "1": count++; sink(r, c)
    RETURN count
```

### Step-by-Step Dry Run (Visual Trace)
| Step | Pointers / Window | Hash Map / Auxiliary State | Decision Logic | Output Accumulator |
| :--- | :--- | :--- | :--- | :--- |
| 0 | `(0,0)` land | `count = 1` | Sink 4 cells to `'0'` | Island A gone |
| 1 | scan to `(2,2)` | land | `count = 2`, sink single | Island B gone |
| 2 | scan to `(3,3)` | land | `count = 3`, sink pair | Island C gone |
| 3 | end of grid | — | — | Return `3` |

### Modern JavaScript Implementation
```javascript
/**
 * Level 2: Optimized (in-place sinking flood fill)
 * Time Complexity:  O(m·n) — each cell flipped at most once
 * Space Complexity: O(m·n) — call stack worst case (all-land grid)
 */
function numIslandsSink(grid) {
  const m = grid.length;
  if (m === 0) return 0;
  const n = grid[0].length;
  function sink(r, c) {
    if (r < 0 || r >= m || c < 0 || c >= n || grid[r][c] !== '1') return;
    grid[r][c] = '0'; // sink on entry: the board remembers for us
    sink(r + 1, c);
    sink(r - 1, c);
    sink(r, c + 1);
    sink(r, c - 1);
  }
  let count = 0;
  for (let r = 0; r < m; r++) {
    for (let c = 0; c < n; c++) {
      if (grid[r][c] === '1') {
        count++;
        sink(r, c);
      }
    }
  }
  return count;
}
```

### Complexity Breakdown
- **Time Complexity**: $O(m·n)$ — each cell flipped once.
- **Space Complexity**: $O(m·n)$ worst-case stack (all-land grid recurses deep); no heap allocation.

---

## 4. Level 3: Most Optimal / Canonical Approach

### Intuition & Mathematical / Invariant Proof
Iterative sinking with an explicit stack: identical flood semantics, zero recursion — immune to V8's $\sim 10^4$-frame limit on huge components ($300×300$ all-land = 90k depth vs recursion). Invariant: every pushed cell is land-or-unknown; every popped land cell is sunk exactly once. Same $O(m·n)$ visits, $O(m·n)$ worst-case stack memory (explicit, not call frames), $O(\min)$ typical.

```
(0,0) land -> count=1, stack=[(0,0)]: pop, sink, push live land neighbors...
  component A drains through the stack; scan continues at the next unvisited cell
```

### Pseudocode
```text
FUNCTION numIslands(grid):
    IF EMPTY: RETURN 0
    m = ROWS; n = COLS; count = 0
    FOR EACH cell:
        IF grid[r][c] != "1": CONTINUE
        count++
        stack = [[r, c]]
        WHILE stack NOT EMPTY:
            [cr, cc] = stack.POP()
            IF OOB OR grid[cr][cc] != "1": CONTINUE
            grid[cr][cc] = "0"
            PUSH 4 NEIGHBORS
    RETURN count
```

### Step-by-Step Dry Run (Visual Trace)
| Step | Pointer $L$ | Pointer $R$ | Invariant Checked | In-Place State |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `(0,0)` land | `count = 1` | Stack `[(0,0)]` | Flood A iteratively |
| 2 | pop `(1,0)`… | land → sink, push neighbors | Each land sunk once | A drains |
| 3 | `(2,2)` land | `count = 2` | Single-cell flood | B drains |
| 4 | `(3,3)` land | `count = 3` | Pair flood | Return `3` |

### Modern JavaScript Implementation
```javascript
/**
 * Level 3: Most Optimal / Canonical (iterative in-place flood fill)
 * Time Complexity:  O(m·n) — each cell sunk once, optimal lower bound
 * Space Complexity: O(m·n) worst case — explicit stack (never call frames)
 */
function numIslands(grid) {
  const m = grid.length;
  if (m === 0) return 0;
  const n = grid[0].length;
  let count = 0;
  for (let r = 0; r < m; r++) {
    for (let c = 0; c < n; c++) {
      if (grid[r][c] !== '1') continue;
      count++; // unvisited land: a new island begins here
      const stack = [[r, c]];
      while (stack.length > 0) {
        const [cr, cc] = stack.pop();
        // Re-check on pop (not push): duplicates in the stack die here.
        if (cr < 0 || cr >= m || cc < 0 || cc >= n || grid[cr][cc] !== '1') continue;
        grid[cr][cc] = '0'; // sink exactly once
        stack.push([cr + 1, cc], [cr - 1, cc], [cr, cc + 1], [cr, cc - 1]);
      }
    }
  }
  return count;
}
```

### Complexity Breakdown
- **Time Complexity**: $O(m·n)$ — optimal lower bound; every cell inspected, land sunk once.
- **Space Complexity**: $O(m·n)$ worst case — explicit stack; production-safe at any depth.

---

## 5. JavaScript-Specific Gotchas & V8 Optimizations
- **GC Pressure**: Avoid allocating objects inside tight loops ($O(N)$ closures). Level 1's `"r,c"` string keys ($m·n$ of them) are the pressure removed — Levels 2–3 write chars; Level 3's `[r, c]` pair arrays are bounded by the frontier (still cheaper than key strings).
- **Type Coercion / Sorting**: Cells are `"1"`/`"0"` STRINGS — `=== '1'` strict (truthy checks pass `"0"` too!). The sink writes `"0"` (string), never `0` (number) — mixed types corrupt later strict reads.
- **Index Bounds**: Mark-on-POP (check after pop) tolerates duplicate pushes — mark-on-push needs the check before pushing (both correct if consistent; mixing them double-processes or skips). Recursion depth $> 10^4$ overflows V8 — Level 2 on all-land $300×300$ crashes where Level 3 survives.

---

## 6. Real-World MAANG Interview Follow-Ups & Extensions

### Follow-Up 1: Island area / perimeter / count with sizes
- **Scenario**: Return max area (LeetCode 695), perimeters, or labeled components.
- **Solution Strategy**: Level 3's flood already visits every cell — accumulate area (counter), perimeter (+1 per water/edge side), or write labels into a parallel grid. Same walk, richer fold.
- **JS Code / Implementation Pattern**:
```javascript
function maxAreaOfIsland(grid) {
  return maxFloodMetric(grid, (cell) => 1); // count cells per flood
}
```

### Follow-Up 2: Dynamic islands (Number of Islands II)
- **Scenario**: Land added incrementally; report island count after each addition (LeetCode 305, Hard).
- **Solution Strategy**: Disjoint-set union: each addition starts its own set, merging with live land neighbors (count drops per successful union). $O(\alpha)$ amortized per op — floods are the wrong tool online.
- **JS Code / Implementation Pattern**:
```javascript
function numIslandsII(m, n, positions) {
  return incrementalDSU(m, n, positions); // union with live neighbors
}
```

### Follow-Up 3: $10^9$-cell grid with sparse land (paged flood)
- **Scenario & In-Depth Solution**: The grid never fits in RAM; land is sparse. Store land cells in a hash set (or spatial index); flood over SET membership instead of array reads — work scales with land count, not grid size. Page set shards from disk as the flood crosses them.
```javascript
function sparseNumIslands(landSet) {
  return floodOverSet(landSet); // same kernel, Set-has instead of grid-read
}
```

---

## 7. What LeetCode Discuss Says (Language-Independent)

Source: top-voted post by girikuncoro —
`https://leetcode.com/problems/number-of-islands/solutions/56340/python-simple-dfs-solution-by-girikuncor-7dwm/`
— 265.7K views.
Language-independent summary. No new JS here.

### A. Optimal way from Discuss (In-Place Island Sinking via DFS/BFS Traversal)

Treat the binary grid as an implicit undirected graph where each connected component of adjacent `'1'`s constitutes an island:

1. **Component Discovery:**
   - Iterate through every coordinate $(r, c)$ in the $M \times N$ matrix.
   - When encountering an unvisited land cell (`grid[r][c] == '1'`), a new component has been identified: increment the island counter.
2. **Sinking Subroutine:**
   - Immediately launch a flood fill (DFS or BFS) starting from $(r, c)$.
   - Mutate the cell to `'0'` (sink the land to water) to neutralize it from triggering future component counts.
   - Recursively / iteratively visit all four cardinal neighbors $(r+1, c), (r-1, c), (r, c+1), (r, c-1)$, halting whenever bounds are exceeded or water (`'0'`) is reached.
3. **Termination:**
   - Once the entire grid has been scanned, return the component count.

```text
FUNCTION numIslands(grid):
    IF grid IS EMPTY:
        RETURN 0

    m = NUM_ROWS(grid)
    n = NUM_COLS(grid)
    islandCount = 0

    FUNCTION sink(r, c):
        IF r < 0 OR r >= m OR c < 0 OR c >= n OR grid[r][c] != '1':
            RETURN
        grid[r][c] = '0'  // sink visited land cell
        sink(r + 1, c)
        sink(r - 1, c)
        sink(r, c + 1)
        sink(r, c - 1)

    FOR r FROM 0 TO m - 1:
        FOR c FROM 0 TO n - 1:
            IF grid[r][c] == '1':
                islandCount = islandCount + 1
                sink(r, c)

    RETURN islandCount
```

- Time: O(M * N) — each cell is visited at most 5 times (once by the outer loop, and at most 4 times by neighbor queries).
- Space: O(M * N) worst-case recursion stack (e.g. grid completely filled with land) or O(min(M, N)) with BFS.

```mermaid
flowchart TD
    Scan["Scan grid cell (r, c)"] --> CheckLand{"grid[r][c] == '1'?"}
    CheckLand -->|"No"| NextCell["Advance to next cell"]
    CheckLand -->|"Yes"| Inc["islandCount += 1"]
    Inc --> Flood["Launch sink(r, c):<br>Mutate cell to '0'<br>Recursively sink 4 neighbors"]
    Flood --> NextCell
    NextCell --> MoreCells{"More cells to scan?"}
    MoreCells -->|"Yes"| Scan
    MoreCells -->|"No"| Ret["RETURN islandCount"]
```

### B. Dry run on LeetCode Example 1 (`grid = [["1","1","1","1","0"],["1","1","0","1","0"],["1","1","0","0","0"],["0","0","0","0","0"]]`)

- Scan reaches $(0, 0) = \text{'1'}$.
- `islandCount` increments to 1.
- `sink(0, 0)` is invoked:
  - $(0, 0)$ is set to `'0'`.
  - Traversal sinks all connected land cells: $(0,1), (0,2), (0,3), (1,0), (1,1), (1,3), (2,0), (2,1)$.
  - All connected land becomes `'0'`.
- Outer loop resumes scanning from $(0, 1)$ onwards:
  - Every remaining coordinate now contains `'0'`.
- Scan completes.
- Final result: `1`.

### C. Why In-Place Sinking Beats Visited Hash Sets

- Storing visited coordinates in a hash set introduces string serializations (`"${r},${c}"`) and dynamic hash allocations for up to $M \times N$ elements.
- Mutating land cells to `'0'` directly eliminates secondary tracking collections and enforces cache-friendly memory operations.

### D. Pitfalls from comments

- **Call Stack Exhaustion on Deep Grids:** On an adversarial $300 \times 300$ grid of contiguous land, recursion depth reaches 90,000 frames, triggering a stack overflow in standard runtimes. Using an explicit stack or BFS queue guarantees safety.
- **Type Inconsistencies:** LeetCode passes characters (`"1"` and `"0"`), not numbers. Checking `grid[r][c] === 1` fails in JavaScript/TypeScript because string `"1"` does not strictly equal number `1`.

### E. Companies

- Discuss post itself names none.
  Companies tab on LeetCode is premium-locked.
- External source:
  `https://github.com/liquidslr/leetcode-company-wise-problems`
  (LeetCode company tags, updated June 2025).
- All-time (81): Accenture, Adobe, Amazon, AMD, Anduril, Aon, Apple, Aurora, Autodesk, Barclays, BitGo, BlackRock, Bloomberg, ByteDance, Capital One, Cisco, Citadel, Cloudflare, Comcast, Coupang, CrowdStrike, DE Shaw, Docusign, DoorDash, eBay, Expedia, Flipkart, Goldman Sachs, Google, Grammarly, HashedIn, Hive, Huawei, IBM, Infosys, Intel, Intuit, LinkedIn, Lucid, Meesho, Meta, Microsoft, Moloco, Nvidia, OKX, Oracle, PayPal, PhonePe, Pinterest, Qualcomm, Rippling, Rivian, Salesforce, Samsung, SAP, ServiceNow, Siemens, Sigmoid, Snap, Snowflake, SoFi, Splunk, Squarepoint Capital, tcs, Tesla, TikTok, Tinkoff, Turing, Two Sigma, Uber, Visa, Walmart Labs, Waymo, Wells Fargo, Whatnot, Wix, Yandex, Zenefits, Zepto, Zoho, Zomato.
- Recent: 30 days — Amazon, Anduril, Apple, Bloomberg, Google, Ola Cabs.
- Recent: 3 months — Amazon, Anduril, Apple, Bloomberg, Google, Infosys, Meta, Microsoft, Qualcomm, tcs, TikTok, Uber.

# 212. Word Search II

- **LeetCode Link**: `https://leetcode.com/problems/word-search-ii/`
- **Difficulty**: Hard
- **Pattern Category**: Trie / Board-Pruned Multi-Search
- **Prerequisite Primer**: `00-foundations/02-data-structure-polyfills.md`

---

## 1. Problem Overview & Edge Case Matrix

### Problem Statement
Given an `m x n` `board` of characters and a list of strings `words`, return all words on the board. Each word must be constructed from letters of sequentially adjacent cells (horizontal/vertical), with no cell reused within one word.

```
Example 1:
Input: board = [["o","a","a","n"],["e","t","a","e"],["i","h","k","r"],["i","f","l","v"]],
       words = ["oath","pea","eat","rain"]
Output: ["eat","oath"] (any order)

Example 2:
Input: board = [["a","b"],["c","d"]], words = ["abcb"]
Output: []
```

### Visual Problem Representation
```
o a a n      "oath": (0,0)->(0,1)->(1,1)->(2,1) ✓
e t a e      "eat": (1,3)->(1,2)->(1,1) = e-a-t ✓
i h k r      "pea": 'p' absent everywhere ✗
i f l v      "rain": 'r'(2,3) neighbors e,k — no 'a' adjacent ✗
```

### Upfront Edge Case Matrix
| Edge Case Category | Specific Input Scenario | Expected Behavior | Pitfall / Risk |
| :--- | :--- | :--- | :--- |
| No matches | `["abcb"]` on 2×2 | Return `[]` | Partial-path emission |
| Single cell | `[["a"]]`, `["a","b"]` | Return `["a"]` | Depth-0 terminal check |
| Duplicate words | `["eat","eat"]` in list | Return `"eat"` ONCE | Duplicate emission |
| Board mutation | Caller reuses board | Unchanged (tombstones restored) | Leaked `'#'` markers |
| Order freedom | Any order accepted | Any complete set | Test asserting exact sequence |

---

## 2. Level 1: Brute Force Approach

### Intuition & Visual Idea
Run Word Search I (tombstone DFS) independently per word from every cell. No shared work between words — $O(W·m·n·3^L)$ with common prefixes re-searched per word.

```mermaid
flowchart TD
    W["for each word"] --> S["for each cell: tombstone DFS for word"]
    S --> Hit{"found?"} -->|"Yes"| Keep["push word; next word"]
    Hit -->|"No"| S
```

### Pseudocode
```text
FUNCTION findWordsBruteForce(board, words):
    out = []
    DEFINE existsFrom(r, c, word, i):
        IF i == word.LENGTH: RETURN true
        IF OOB OR board[r][c] != word[i]: RETURN false
        saved = board[r][c]; board[r][c] = "#"
        found = existsFrom(4 NEIGHBORS, i+1) ANY
        board[r][c] = saved
        RETURN found
    DEFINE exists(word):
        FOR EACH cell: IF existsFrom(r, c, word, 0): RETURN true
        RETURN false
    FOR w IN words:
        IF exists(w) AND NOT out.INCLUDES(w): out.PUSH(w)
    RETURN out
```

### Step-by-Step Dry Run (Visual Trace)
| Step | Iteration / Pointer ($i, j$) | Current Value | State / Sub-array | Action Taken |
| :--- | :--- | :--- | :--- | :--- |
| 0 | word `"oath"` | full-board DFS | Found via `(0,0)→(0,1)→(1,1)→(2,1)` | Keep |
| 1 | word `"pea"` | `p` absent everywhere | Immediate fail | Skip |
| 2 | word `"eat"` | DFS finds `(1,3)→(1,2)→(1,1)` | Found | Keep |
| 3 | word `"rain"` | `r` at `(2,3)`, then `a`? neighbors of `(2,3)`: `(1,3)=e,(2,2)=k` | No `a` adjacent | Skip |

### Modern JavaScript Implementation
```javascript
/**
 * Level 1: Brute Force (Word Search I per word)
 * Time Complexity:  O(W·m·n·3^L) — full board search per word
 * Space Complexity: O(L) — DFS stack (board restored after each word)
 */
function existsFrom(board, r, c, word, i) {
  // Shared helper: Word Search I core (tombstone + restore).
  const m = board.length;
  const n = board[0].length;
  if (i === word.length) return true;
  if (r < 0 || r >= m || c < 0 || c >= n || board[r][c] !== word[i]) return false;
  const saved = board[r][c];
  board[r][c] = '#'; // tombstone: blocks cell reuse within this path
  const found =
    existsFrom(board, r + 1, c, word, i + 1) ||
    existsFrom(board, r - 1, c, word, i + 1) ||
    existsFrom(board, r, c + 1, word, i + 1) ||
    existsFrom(board, r, c - 1, word, i + 1);
  board[r][c] = saved; // restore ALWAYS: board clean for the next word
  return found;
}

function findWordsBruteForce(board, words) {
  const out = [];
  const seen = new Set(); // dedupe: identical list words emit once
  for (const w of words) {
    if (seen.has(w)) continue;
    seen.add(w);
    let found = false;
    for (let r = 0; r < board.length && !found; r++) {
      for (let c = 0; c < board[0].length && !found; c++) {
        if (existsFrom(board, r, c, w, 0)) found = true;
      }
    }
    if (found) out.push(w);
  }
  return out;
}
```

### Complexity Breakdown
- **Time Complexity**: $O(W·m·n·3^L)$ — independent board search per word; shared prefixes (`oath`/`oat`) re-walked.
- **Space Complexity**: $O(L)$ — DFS stack; board restored between words.

---

## 3. Level 2: Optimized Approach

### Intuition & Visual Bottleneck Elimination
 ONE board walk guided by a trie of ALL words: DFS from each cell follows trie edges (dead prefixes die immediately — no per-word restarts), emitting on terminal nodes. Shared prefixes searched once — $O(m·n·3^L)$ total regardless of word count.

```mermaid
flowchart TD
    T["build trie (children + word-at-terminal)"] --> S["for each cell: dfs(r, c, root)"]
    S --> Step["ch = board; child = node.children.get(ch)?"]
    Step -->|"No"| Dead["return (prefix absent from ALL words)"]
    Step -->|"Yes"| Term{"child.word?"} -->|"Yes"| Emit["found.add(word)"]
    Term --> Tomb["tombstone; recurse 4; restore"]
```

### Pseudocode
```text
FUNCTION findWordsTrie(board, words):
    root = BUILD-TRIE(words)   // Map children; terminal nodes store the word
    found = EMPTY SET
    DEFINE dfs(r, c, node):
        IF OOB OR board[r][c] == "#": RETURN
        child = node.children.GET(board[r][c])
        IF NOT child: RETURN
        IF child.word NOT NULL: found.ADD(child.word)
        tombstone board[r][c]; dfs(4 NEIGHBORS, child); restore
    FOR EACH cell: dfs(r, c, root)
    RETURN [...found]
```

### Step-by-Step Dry Run (Visual Trace)
| Step | Pointers / Window | Hash Map / Auxiliary State | Decision Logic | Output Accumulator |
| :--- | :--- | :--- | :--- | :--- |
| 0 | trie built | `oath, pea, eat, rain` paths | Shared `e-a` prefix once | — |
| 1 | `dfs` from `(0,0)` | `o → a → t → h` chain | Terminal `oath` | `found = {oath}` |
| 2 | `dfs` from `(1,3)` | `e → a → t` chain | Terminal `eat` | `found = {oath, eat}` |
| 3 | dead prefixes | `p…` absent from trie root | Immediate return | `pea`, `rain` never match |

### Modern JavaScript Implementation
```javascript
/**
 * Level 2: Optimized (trie-guided single board walk)
 * Time Complexity:  O(m·n·3^L) — one walk; word count factored out
 * Space Complexity: O(W·L) — trie plus O(L) stack
 */
function buildWordTrie(words) {
  // Shared helper: Map-trie with terminal word pointers.
  const root = { children: new Map(), word: null };
  for (const w of words) {
    let node = root;
    for (const ch of w) {
      if (!node.children.has(ch)) {
        node.children.set(ch, { children: new Map(), word: null });
      }
      node = node.children.get(ch);
    }
    node.word = w; // terminal stores the full word (dedupes naturally)
  }
  return root;
}

function findWordsTrie(board, words) {
  const root = buildWordTrie(words);
  const m = board.length;
  const n = board[0].length;
  const found = new Set(); // Set dedupes repeat visits to the same terminal
  function dfs(r, c, node) {
    if (r < 0 || r >= m || c < 0 || c >= n || board[r][c] === '#') return;
    const child = node.children.get(board[r][c]);
    // Absent edge: NO word in the list continues this way — prune the subtree.
    if (!child) return;
    if (child.word !== null) found.add(child.word);
    const saved = board[r][c];
    board[r][c] = '#';
    dfs(r + 1, c, child);
    dfs(r - 1, c, child);
    dfs(r, c + 1, child);
    dfs(r, c - 1, child);
    board[r][c] = saved;
  }
  for (let r = 0; r < m; r++) {
    for (let c = 0; c < n; c++) {
      dfs(r, c, root);
    }
  }
  return [...found];
}
```

### Complexity Breakdown
- **Time Complexity**: $O(m·n·3^L)$ — one walk; $W$ factored out (shared prefixes searched once).
- **Space Complexity**: $O(W·L)$ — trie; Set dedupes repeat terminal hits.

---

## 4. Level 3: Most Optimal / Canonical Approach

### Intuition & Mathematical / Invariant Proof
Level 2 plus terminal nulling and dead-leaf pruning: once a word is found, clear its terminal (`word = null` — repeat visits match nothing, Set lookups vanish); after DFS returns, drop childless wordless nodes from the parent (`children.delete`), shrinking the trie live. Invariant: pruned nodes can never participate in an unfound word (their subtree held exactly the found word) — answers never change, but the search tree shrinks as words complete. Same worst case, dramatically faster typical runs (the accepted production form).

```
"eat" found at (1,1)-terminal: null the pointer; leaf 't' (childless, wordless)
  pruned from 'a'; chain shortens for later cells' walks.
```

### Pseudocode
```text
FUNCTION findWords(board, words):
    root = BUILD-TRIE(words); out = []
    DEFINE dfs(r, c, node):
        IF OOB OR tombstoned: RETURN
        child = node.children.GET(board[r][c])
        IF NOT child: RETURN
        IF child.word NOT NULL:
            out.PUSH(child.word); child.word = NULL   // emit once, disarm
        tombstone; dfs(4 NEIGHBORS, child); restore
        IF child.children EMPTY AND child.word NULL:
            node.children.DELETE(board[r][c])          // prune dead leaf
    FOR EACH cell: dfs(r, c, root)
    RETURN out
```

### Step-by-Step Dry Run (Visual Trace)
| Step | Pointer $L$ | Pointer $R$ | Invariant Checked | In-Place State |
| :--- | :--- | :--- | :--- | :--- |
| 1 | terminal `oath` hit | emit + null | Never re-emitted | `out = ["oath"]` |
| 2 | unwind `h` leaf | childless + wordless | Pruned from `t` | Trie shrinks |
| 3 | terminal `eat` hit | emit + null | `out = ["oath","eat"]` | Prune chain |
| 4 | later cells | pruned edges die fast | No repeat work | Return both |

### Modern JavaScript Implementation
```javascript
/**
 * Level 3: Most Optimal / Canonical (trie + terminal/leaf pruning)
 * Time Complexity:  O(m·n·3^L) worst case — far less in practice
 * Space Complexity: O(W·L) — trie that SHRINKS as words complete
 */
function findWords(board, words) {
  const root = buildWordTrie(words); // shared builder from Level 2
  const m = board.length;
  const n = board[0].length;
  const out = [];
  function dfs(r, c, node) {
    if (r < 0 || r >= m || c < 0 || c >= n || board[r][c] === '#') return;
    const ch = board[r][c];
    const child = node.children.get(ch);
    if (!child) return;
    // Emit once then disarm: repeat visits match nothing (no Set needed).
    if (child.word !== null) {
      out.push(child.word);
      child.word = null;
    }
    board[r][c] = '#';
    dfs(r + 1, c, child);
    dfs(r - 1, c, child);
    dfs(r, c + 1, child);
    dfs(r, c - 1, child);
    board[r][c] = ch; // restore ALWAYS (ch saved before tombstoning)
    // Prune dead leaves: wordless + childless can never complete a word.
    if (child.word === null && child.children.size === 0) {
      node.children.delete(ch);
    }
  }
  for (let r = 0; r < m; r++) {
    for (let c = 0; c < n; c++) {
      dfs(r, c, root);
    }
  }
  return out;
}
```

### Complexity Breakdown
- **Time Complexity**: $O(m·n·3^L)$ worst case — optimal exact-search shape; pruning wins typical cases.
- **Space Complexity**: $O(W·L)$ shrinking live — the trie pays for itself, then deletes itself.

---

## 5. JavaScript-Specific Gotchas & V8 Optimizations
- **GC Pressure**: Avoid allocating objects inside tight loops ($O(N)$ closures). Level 1's per-word full-board search is the pressure removed — Levels 2–3 allocate one trie total; Level 3's pruning even frees during the run.
- **Type Coercion / Sorting**: `child.word !== null` (not truthiness) — empty-string words (`""`) are falsy but legitimate terminals; `board[r][c] = ch` restores the SAVED char (not a re-read — the cell holds `'#'` by then).
- **Index Bounds**: Prune check placement AFTER restore+recursion (post-order): pruning before exploring orphans live paths. Deleting from `node.children` DURING parent iteration is safe here (the DFS holds no live iterator over that exact map — recursion went through `child`, and the delete targets the parent's entry, visited once).

---

## 6. Real-World MAANG Interview Follow-Ups & Extensions

### Follow-Up 1: Boggle scoring with Qu cubes and prefixes
- **Scenario**: Score all valid words (length-weighted), `Qu` single cubes, prefix-bonus rules.
- **Solution Strategy**: Level 3's skeleton with scoring on emit (`word.length` tiers) and `Qu`-aware edge matching (consume two letters per cube). Same walk, richer emit.
- **JS Code / Implementation Pattern**:
```javascript
function boggleScore(board, words) {
  return scoredWalk(board, words); // Level 3 + length-tier scoring
}
```

### Follow-Up 2: $10^9$-cell board with tiled streaming
- **Scenario**: The board never fits in RAM; tiles stream with word-length overlap.
- **Solution Strategy**: Tile with $L_{max}$-overlap margins (any word fits inside some tile — same argument as Word Search I's follow-up); run Level 3 per tile; union emits. Overlap cost scales with max word length.
- **JS Code / Implementation Pattern**:
```javascript
async function findWordsTiled(boardTiles, words, maxLen) {
  const out = new Set();
  for await (const tile of boardTiles.withOverlap(maxLen - 1)) {
    for (const w of findWords(tile.grid, words)) out.add(w);
  }
  return [...out];
}
```

### Follow-Up 3: Dynamic dictionary (words added live)
- **Scenario & In-Depth Solution**: Words insert during the search session (live autocomplete-game). Insert into the LIVE trie (Level 3's pruned structure accepts inserts at any time — pruned branches rebuild on demand); re-walk only cells that can reach the new word's prefixes (dirty-region tracking), not the whole board.
```javascript
function liveAddWord(trie, board, word) {
  insertIntoTrie(trie, word); // pruned nodes rebuilt as needed
  return rewalkDirtyRegions(board, trie, word); // new matches only
}
```

---

## 7. What LeetCode Discuss Says (Language-Independent)

Source: top-voted post by yavinci —
`https://leetcode.com/problems/word-search-ii/solutions/59780/java-15ms-easiest-solution-10000-by-yavi-b0zj/`
— 233.3K views.
Language-independent summary. No new JS here.

### A. Optimal way from Discuss (Trie-Directed Board Backtracking with In-Place Visited Inoculation & Word Nullification)

Simultaneously search all dictionary words across the grid using a unified Prefix Tree guide:

1. **Simultaneous Prefix Pruning via Trie:**
   - Searching each word independently yields $O(K \cdot M \cdot N \cdot 4^L)$, which exceeds execution limits.
   - Inserting all target words into a Prefix Trie allows a single board walk from cell $(r, c)$ to explore all viable candidate prefixes concurrently, cutting dead ends at the earliest mismatched letter.
2. **Terminal Word Caching (Zero String Allocation):**
   - Store the complete string reference `node.word = word` directly at each terminal node rather than maintaining an accumulator string during DFS.
   - When a match is encountered, push `node.word` directly into the results collection.
3. **Word Nullification for Automatic De-duplication:**
   - After emitting a found word, set `node.word = NULL`.
   - If alternative board paths discover the same word later, `node.word` evaluates to null and prevents duplicate emission without requiring an external hash set.
4. **In-Place Board Inoculation:**
   - Mark the current cell `board[r][c] = '#'` to denote visited status during the active recursion path.
   - Restore `board[r][c] = origChar` upon backtrack, requiring zero extra space for visited matrices.

```text
CLASS TrieNode:
    children = MAP() // char -> TrieNode
    word = NULL

FUNCTION findWords(board, words):
    root = NEW TrieNode()
    FOR EACH w IN words:
        cur = root
        FOR EACH ch IN w:
            IF ch NOT IN cur.children:
                cur.children[ch] = NEW TrieNode()
            cur = cur.children[ch]
        cur.word = w

    m = LENGTH(board)
    n = LENGTH(board[0])
    result = []

    FUNCTION dfs(r, c, parentNode):
        ch = board[r][c]
        IF ch == '#' OR ch NOT IN parentNode.children:
            RETURN

        node = parentNode.children[ch]

        IF node.word != NULL:
            result.APPEND(node.word)
            node.word = NULL // prevent duplicates

        board[r][c] = '#' // mark visited

        FOR EACH (dr, dc) IN [(-1, 0), (1, 0), (0, -1), (0, 1)]:
            nr = r + dr
            nc = c + dc
            IF nr >= 0 AND nr < m AND nc >= 0 AND nc < n:
                dfs(nr, nc, node)

        board[r][c] = ch // backtrack restore

    FOR r FROM 0 TO m - 1:
        FOR c FROM 0 TO n - 1:
            dfs(r, c, root)

    RETURN result
```

- Time: O(M * N * 4 * 3^(L - 1)) worst-case grid exploration, heavily pruned by prefix branching.
- Space: O(Sum(len(words))) to construct the Trie, plus $O(L)$ recursion stack depth.

```mermaid
flowchart TD
    Build["Build Trie with words<br>Store full word at terminal node"] --> GridLoop["For each cell (r, c) on board:<br>dfs(r, c, root)"]
    GridLoop --> CheckValid{"ch == '#' OR<br>ch not in node.children?"}
    CheckValid -->|"Yes"| Ret["RETURN (Prune branch)"]
    CheckValid -->|"No"| StepChild["node = node.children[ch]"]
    StepChild --> CheckWord{"node.word != null?"}
    CheckWord -->|"Yes"| Emit["result.append(node.word)<br>node.word = null (Deduplicate)"]
    CheckWord -->|"No"| Inoculate["board[r][c] = '#' (Mark visited)"]
    Emit --> Inoculate
    Inoculate --> Explore["Recurse 4 directions: dfs(nr, nc, node)"]
    Explore --> Restore["board[r][c] = ch (Restore cell)"]
```

### B. Dry run on LeetCode Example 1 (`board = [["o","a","a","n"],["e","t","a","e"],["i","h","k","r"],["i","f","l","v"]], words = ["oath","pea","eat","rain"]`)

- Trie holds `"oath"`, `"pea"`, `"eat"`, `"rain"`.
- At $(0, 0)$ cell `'o'`:
  - `'o'` matches root child $\to$ advance.
  - Branch $(0, 1)$ cell `'a'` matches $\to$ advance.
  - Branch $(1, 1)$ cell `'t'` matches $\to$ advance.
  - Branch $(2, 1)$ cell `'h'` matches $\to$ advance.
  - `node.word` is `"oath"` $\implies$ emitted! `node.word = null`.
- Backtrack unwinds, cell characters restored.
- Cell $(1, 0)$ `'e'` traverses `'e' -> 'a' -> 't'`, discovers `"eat"` $\implies$ emitted!
- Result: `["oath", "eat"]`.

### C. Why Trie-Guided DFS Outperforms Individual Word Searches

- Independent searches duplicate prefix walks (e.g. `"cat"` and `"cater"` repeat identical traversals for `'c'`, `'a'`, `'t'`).
- The Trie integrates all target words into a single search graph, terminating traversal the moment a prefix fails to exist anywhere in the dictionary.

### D. Pitfalls from comments

- **Duplicate Path Emission:** A word can often be formed through multiple distinct paths across the board; nullifying `node.word` upon first discovery cleanly eliminates duplicates without hash set overhead.
- **Board Corruption:** Failing to restore `board[r][c] = ch` leaves the board permanently altered, invalidating subsequent searches from neighboring origin cells.

### E. Companies

- Discuss post itself names none.
  Companies tab on LeetCode is premium-locked.
- External source:
  `https://github.com/liquidslr/leetcode-company-wise-problems`
  (LeetCode company tags, updated June 2025).
- All-time (19): Airbnb, Amazon, Apple, Aurora, Bloomberg, Cisco, DoorDash, Google, Meta, Microsoft, Oracle, Snap, Snowflake, TikTok, Two Sigma, Uber, Visa, Wix, Zoom.
- Recent: 30 days — None.
- Recent: 3 months — Amazon.

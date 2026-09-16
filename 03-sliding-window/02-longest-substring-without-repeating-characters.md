# 3. Longest Substring Without Repeating Characters

- **LeetCode Link**: `https://leetcode.com/problems/longest-substring-without-repeating-characters/`
- **Difficulty**: Medium
- **Pattern Category**: Sliding Window / Hash Table
- **Prerequisite Primer**: `00-foundations/01-two-pointers.md`

---

## 1. Problem Overview & Edge Case Matrix

### Problem Statement
Given a string `s`, find the length of the **longest substring** without duplicate characters.

```
s = "abcabcbb"
Longest substring without repeating characters is "abc" -> Length: 3

s = "bbbbb"
Longest substring is "b" -> Length: 1

s = "pwwkew"
Longest substring is "wke" -> Length: 3 (Notice "pwke" is a subsequence, not substring)
```

### Upfront Edge Case Matrix

| Edge Case Scenario | Inputs | Expected Output | Pitfall / Failure Mode |
| :--- | :--- | :--- | :--- |
| Empty String | `s = ""` | `0` | Returning 1 or array index error |
| Single Character | `s = "a"` | `1` | Failure to register 1-length window |
| All Identical Characters | `s = "bbbbb"` | `1` | Failure to contract window repeatedly |
| All Unique Characters | `s = "abcdef"` | `6` | Unnecessary shrinkage |
| Symbols, Spaces, and Digits | `s = "a b c a b c"` | `3` (`"a b"`, `" b "`) | Forgetting that space `' '` is a valid character |

---

## 2. Level 1: Brute Force Approach (All Substrings with Set Check)

### Intuition & Visual Idea
Generate every possible substring $s[i \dots j]$. For each substring, use a `Set` to check if all characters are unique. Track the maximum length among all valid substrings.

```mermaid
flowchart TD
    A["Iterate start index i from 0 to n - 1"] --> B["Iterate end index j from i to n - 1"]
    B --> C["Check if substring s[i..j] contains duplicates via Set"]
    C --> Valid{"All unique?"}
    Valid -->|"Yes"| D["maxLen = max(maxLen, j - i + 1)"]
    Valid -->|"No"| NextI["Break (duplicates will persist for larger j)"]
    D --> B
    NextI --> A
```

### Pseudocode
```text
FUNCTION lengthOfLongestSubstringBruteForce(s):
    n = s.length
    maxLen = 0
    FOR i FROM 0 TO n - 1:
        seen = new Set()
        FOR j FROM i TO n - 1:
            IF seen.has(s[j]):
                BREAK
            seen.add(s[j])
            maxLen = MAX(maxLen, j - i + 1)
    RETURN maxLen
```

### Step-by-Step Dry Run
`s = "pwwkew"`

| `i` | `j` | `s[j]` | `seen` Set | Valid? | `maxLen` |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | 0 | `'p'` | `{'p'}` | Yes | 1 |
| 0 | 1 | `'w'` | `{'p', 'w'}` | Yes | 2 |
| 0 | 2 | `'w'` | Duplicate `'w'` | **No (Break)** | 2 |
| 1 | 1 | `'w'` | `{'w'}` | Yes | 2 |
| 2 | 2..4 | `'w','k','e'` | `{'w','k','e'}` | Yes | **3** |

### Modern JavaScript Implementation
```javascript
/**
 * Level 1: Brute Force All Substrings
 * Time Complexity:  O(N^2)
 * Space Complexity: O(min(N, Sigma))
 */
function lengthOfLongestSubstringBruteForce(s) {
  const n = s.length;
  let maxLen = 0;

  for (let i = 0; i < n; i++) {
    const seen = new Set();
    for (let j = i; j < n; j++) {
      if (seen.has(s[j])) {
        break;
      }
      seen.add(s[j]);
      maxLen = Math.max(maxLen, j - i + 1);
    }
  }

  return maxLen;
}
```

### Complexity Breakdown
- **Time Complexity**: $O(N^2)$ — Two nested loops examining substrings.
- **Space Complexity**: $O(\min(N, \Sigma))$ — `seen` Set stores unique characters (where $\Sigma$ is character alphabet size).

#### 🎙️ How to Explain to Interviewer (Verbatim Script)
> *"This brute-force approach evaluates all possible substrings starting at index $i$. As soon as a duplicate character is encountered, we break the inner loop since extending the substring further cannot eliminate the duplicate. The worst-case runtime is $O(N^2)$ with $O(\min(N, \Sigma))$ space."*

---

## 3. Level 2: Optimized Approach (Sliding Window with Set Shrinkage)

### Intuition & Visual Bottleneck Elimination
Maintain a dynamic sliding window `[left, right]` using a `Set`:
- If `s[right]` is not in the set, add it and update `maxLen = max(maxLen, right - left + 1)`.
- If `s[right]` is already in the set, repeatedly delete `s[left]` from the set and advance `left++` until the duplicate is evicted.

```
s: [ a , b , c , a , b , c , b , b ]
Window: [a, b, c] -> right sees 'a'
Evict s[left] ('a') from Set, left++ -> Window becomes [b, c, a]
```

```mermaid
flowchart TD
    Init["left = 0, right = 0, seen = new Set(), maxLen = 0"] --> Loop{"right < s.length?"}
    Loop -->|"Yes"| HasDup{"seen.has(s[right])?"}
    HasDup -->|"Yes (Duplicate)"| Evict["seen.delete(s[left]); left++"]
    Evict --> HasDup
    HasDup -->|"No (Clean Window)"| Add["seen.add(s[right]); maxLen = max(maxLen, right - left + 1); right++"]
    Add --> Loop
    Loop -->|"No"| Ret["Return maxLen"]
```

### Pseudocode
```text
FUNCTION lengthOfLongestSubstringSet(s):
    seen = new Set()
    left = 0, maxLen = 0
    FOR right FROM 0 TO s.length - 1:
        WHILE seen.has(s[right]):
            seen.delete(s[left])
            left++
        seen.add(s[right])
        maxLen = MAX(maxLen, right - left + 1)
    RETURN maxLen
```

### Step-by-Step Dry Run
`s = "abcabcbb"`

| `right` | `s[right]` | Action | `left` | Window in Set | `maxLen` |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | `'a'` | Add `'a'` | 0 | `{'a'}` | 1 |
| 1 | `'b'` | Add `'b'` | 0 | `{'a', 'b'}` | 2 |
| 2 | `'c'` | Add `'c'` | 0 | `{'a', 'b', 'c'}` | **3** |
| 3 | `'a'` | Evict `'a'`, `left=1`, Add `'a'` | 1 | `{'b', 'c', 'a'}` | 3 |
| 4 | `'b'` | Evict `'b'`, `left=2`, Add `'b'` | 2 | `{'c', 'a', 'b'}` | 3 |

### Modern JavaScript Implementation
```javascript
/**
 * Level 2: Sliding Window with Hash Set
 * Time Complexity:  O(2N) = O(N)
 * Space Complexity: O(min(N, Sigma))
 */
function lengthOfLongestSubstringSet(s) {
  const seen = new Set();
  let left = 0;
  let maxLen = 0;

  for (let right = 0; right < s.length; right++) {
    while (seen.has(s[right])) {
      seen.delete(s[left]);
      left++;
    }
    seen.add(s[right]);
    maxLen = Math.max(maxLen, right - left + 1);
  }

  return maxLen;
}
```

### Complexity Breakdown
- **Time Complexity**: $O(2N) = O(N)$ — Each character is visited once by `right` and deleted at most once by `left`.
- **Space Complexity**: $O(\min(N, \Sigma))$ — Hash set stores at most $\Sigma$ unique characters.

#### 🎙️ How to Explain to Interviewer (Verbatim Script)
> *"For **Time Complexity**, this runs in $O(N)$ time. We maintain a dynamic sliding window using a hash set. When a duplicate character is encountered, the left pointer shrinks the window character by character until the duplicate is evicted. Each character is added to and removed from the set at most once, taking $2N$ operations.
>
> For **Space Complexity**, it takes $O(\min(N, \Sigma))$ auxiliary space where $\Sigma$ is the alphabet size."*

---

## 4. Level 3: Most Optimal / Canonical Approach (Optimized Map with Direct Left Pointer Jump)

### Intuition & Invariant Proof
Instead of evicting characters from `left` one-by-one, store each character's **most recent index**: `Map<char, lastSeenIndex>`.
When `s[right]` is encountered:
- If `s[right]` was seen previously at `prevIndex`:
- We can **instantly teleport** `left` to `prevIndex + 1`!
- **Critical Guard**: We must ensure `left` never moves backward: `left = Math.max(left, prevIndex + 1)`.
- Update `map.set(s[right], right)` and `maxLen = Math.max(maxLen, right - left + 1)`.

```
s: [ a , b , c , a , b , c ]
     0   1   2   3   4   5
right = 3 ('a'):
'a' was last seen at index 0.
Instantly jump left = max(0, 0 + 1) = 1 in O(1) step!
```

```mermaid
flowchart TD
    Init["map = new Map(), left = 0, maxLen = 0"] --> Loop{"right < s.length?"}
    Loop -->|"Yes"| CheckMap{"map.has(s[right])?"}
    CheckMap -->|"Yes"| Jump["left = Math.max(left, map.get(s[right]) + 1)"]
    CheckMap -->|"No"| Update
    Jump --> Update["map.set(s[right], right); maxLen = Math.max(maxLen, right - left + 1); right++"]
    Update --> Loop
    Loop -->|"No"| Ret["Return maxLen (Single Pass O(N))"]
```

### Pseudocode
```text
FUNCTION lengthOfLongestSubstring(s):
    lastSeen = new Map()
    left = 0
    maxLen = 0
    
    FOR right FROM 0 TO s.length - 1:
        char = s[right]
        IF lastSeen.has(char):
            left = MAX(left, lastSeen.get(char) + 1)
        lastSeen.set(char, right)
        maxLen = MAX(maxLen, right - left + 1)
        
    RETURN maxLen
```

### Step-by-Step Dry Run
`s = "abba"`

| `right` | `s[right]` | `lastSeen` Lookup | `left` Before | `left` Calculation | `left` After | Window Length | `maxLen` |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | `'a'` | None | 0 | - | 0 | $0 - 0 + 1 = 1$ | 1 |
| 1 | `'b'` | None | 0 | - | 0 | $1 - 0 + 1 = 2$ | 2 |
| 2 | `'b'` | Index 1 | 0 | $\max(0, 1 + 1)$ | 2 | $2 - 2 + 1 = 1$ | 2 |
| 3 | `'a'` | Index 0 | 2 | $\max(2, 0 + 1)$ | **2** (Guarded!) | $3 - 2 + 1 = 2$ | **2** |

### Modern JavaScript Implementation
```javascript
/**
 * Level 3: Direct Index Jump Sliding Window (Canonical Optimal)
 * Time Complexity:  O(N) Strictly Single Pass
 * Space Complexity: O(min(N, Sigma))
 */
function lengthOfLongestSubstring(s) {
  const lastSeen = new Map();
  let left = 0;
  let maxLen = 0;

  for (let right = 0; right < s.length; right++) {
    const char = s[right];

    if (lastSeen.has(char)) {
      // Jump left pointer forward past the last occurrence
      left = Math.max(left, lastSeen.get(char) + 1);
    }

    lastSeen.set(char, right);
    maxLen = Math.max(maxLen, right - left + 1);
  }

  return maxLen;
}
```

### Complexity Breakdown
- **Time Complexity**: $O(N)$ strictly single pass — The loop runs exactly $N$ iterations without any nested while loops.
- **Space Complexity**: $O(\min(N, \Sigma))$ — Hash Map stores at most $\Sigma$ characters (e.g. 128 for ASCII, 256 for extended ASCII).

#### 🎙️ How to Explain to Interviewer (Verbatim Script)
> *"For **Time Complexity**, this is strictly $O(N)$ in a single forward pass. Instead of evicting characters one by one with a nested while loop, we store the most recent index of every character in a hash map. When a repeated character is encountered, we jump the `left` pointer directly to `lastSeenIndex + 1` in $O(1)$ time, taking `Math.max(left, ...)` to ensure the pointer never regresses.
>
> For **Space Complexity**, it takes $O(\min(N, \Sigma))$ auxiliary space bounded by the distinct character set size $\Sigma$."*

---

## 5. JavaScript-Specific Gotchas & V8 Optimizations
- **The `abba` Trap**: In `s = "abba"`, at index 3 (`'a'`), `'a'` was seen at index 0. If you write `left = lastSeen.get(char) + 1`, `left` would jump backwards from 2 to 1! Using `Math.max(left, lastSeen.get(char) + 1)` is required to prevent backward pointer regression.

---

## 6. Real-World MAANG Interview Follow-Ups & Extensions

### Follow-Up 1: Longest Substring with at Most $K$ Distinct Characters (LeetCode 340)
- **Scenario**: Allow up to $K$ distinct characters in the window.
- **Solution Strategy**: Maintain a frequency `Map`. When `map.size > k`, shrink `left` until a key's count drops to 0 and is deleted.

### Follow-Up 2: Substring with Fixed ASCII Table (Zero GC)
- **Scenario**: When $s$ contains only 128 standard ASCII characters, eliminate Map allocation entirely.
- **JS Code**:
```javascript
function lengthOfLongestSubstringASCII(s) {
  const lastSeen = new Int32Array(128).fill(-1);
  let left = 0, maxLen = 0;

  for (let right = 0; right < s.length; right++) {
    const code = s.charCodeAt(right);
    if (lastSeen[code] >= left) {
      left = lastSeen[code] + 1;
    }
    lastSeen[code] = right;
    maxLen = Math.max(maxLen, right - left + 1);
  }
  return maxLen;
}
```

---

## 7. What LeetCode Discuss Says (Language-Independent)

Source: top-voted post by Rahul Varma —
`https://leetcode.com/problems/longest-substring-without-repeating-characters/solutions/3655186/3-method-s-c-java-python-beginner-friendly/`
— 727.5K views / 2.7K votes / 93 comments.
Language-independent summary. No new JS here.

### A. Optimal way from Discuss (Sliding Window + Hash Map)

The problem asks for the longest substring without *repeating characters*. We can use a Sliding Window approach. We maintain a `left` pointer, a `right` pointer, and a Hash Map (or array) storing the *most recent index* of each character we've seen. 
As we move `right`, if we see a character that is already in our map **and** its recorded index is $\ge$ `left`, we know there's a repeat inside our current window. We must instantly jump `left` to `last_seen_index + 1`.

```text
FUNCTION lengthOfLongestSubstring(s):
    charMap = empty Hash Map  // maps character -> its most recent index
    left = 0
    maxLength = 0
    
    FOR right = 0 TO length(s) - 1:
        currentChar = s[right]
        
        IF currentChar IN charMap AND charMap[currentChar] >= left:
            // Jump left pointer right past the previous occurrence
            left = charMap[currentChar] + 1
            
        charMap[currentChar] = right
        
        currentLength = right - left + 1
        maxLength = max(maxLength, currentLength)
        
    RETURN maxLength
```

- Time: O(N) where N is the length of string `s`. Both pointers only move forward.
- Space: O(min(M, N)) where M is the character set size (e.g., 128 for ASCII or 26 for letters).

```mermaid
flowchart TD
    Init["left = 0, maxLen = 0, map = {}"] --> Loop{"right < len(s)?"}
    Loop -->|"Yes"| GetChar["char = s[right]"]
    GetChar --> CheckMap{"char in map AND map[char] >= left?"}
    CheckMap -->|"Yes"| UpdateLeft["left = map[char] + 1"]
    UpdateLeft --> UpdateMap["map[char] = right"]
    CheckMap -->|"No"| UpdateMap
    UpdateMap --> CalcLen["maxLen = max(maxLen, right - left + 1)"]
    CalcLen --> IncRight["right++"]
    IncRight --> Loop
    Loop -->|"No"| Return["Return maxLen"]
```

### B. Dry run on LeetCode Example 1 ("abcabcbb")

| `right` | `char` | `map` before | `map[char] >= left`? | `left` new | `map` updated | Window | `maxLen` |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 0 | 'a' | {} | No | 0 | `{'a':0}` | "a" | 1 |
| 1 | 'b' | `{'a':0}` | No | 0 | `{'a':0, 'b':1}` | "ab" | 2 |
| 2 | 'c' | `{'a':0, 'b':1}` | No | 0 | `{'a':0, 'b':1, 'c':2}` | "abc" | 3 |
| 3 | 'a' | `{a:0, b:1, c:2}` | Yes (0 $\ge$ 0) | 0 + 1 = 1 | `{a:3, b:1, c:2}` | "bca" | 3 |
| 4 | 'b' | `{a:3, b:1, c:2}` | Yes (1 $\ge$ 1) | 1 + 1 = 2 | `{a:3, b:4, c:2}` | "cab" | 3 |
| 5 | 'c' | `{a:3, b:4, c:2}` | Yes (2 $\ge$ 2) | 2 + 1 = 3 | `{a:3, b:4, c:5}` | "abc" | 3 |
| 6 | 'b' | `{a:3, b:4, c:5}` | Yes (4 $\ge$ 3) | 4 + 1 = 5 | `{a:3, b:6, c:5}` | "cb" | 3 |
| 7 | 'b' | `{a:3, b:6, c:5}` | Yes (6 $\ge$ 5) | 6 + 1 = 7 | `{a:3, b:7, c:5}` | "b" | 3 |

### C. Pitfalls from comments

- **The `map[char] >= left` check:** The most common bug in this problem is updating `left` without checking if the previous occurrence of `char` is *actually inside* the current window. If you see a character that appeared way back before the `left` pointer, it is outside your current window and therefore doesn't count as a repeat. You must only jump `left` if `charMap[currentChar] >= left`.
- **Set vs Map (O(2N) vs O(N)):** You can solve this using a Hash Set by moving `left` one step at a time and deleting elements from the set until the duplicate is gone. However, the Hash Map approach is an optimized $O(N)$ because it instantly jumps `left` past the duplicate in one step, rather than inching forward.
- **Using arrays instead of maps:** Since the input constraints specify English letters, digits, symbols, and spaces, the character set is just the standard ASCII table. Using a fixed integer array of size 128 (e.g., `int[128]`) is significantly faster than a Hash Map structure because array lookups are instant.

### D. Companies

- Discuss post itself names none.
  Companies tab on LeetCode is premium-locked.
- External source:
  `https://github.com/liquidslr/leetcode-company-wise-problems`
  (LeetCode company tags, updated June 2025).
- All-time (97): Accenture, Accolite, Adobe, Agoda, Airtel, Akamai, Amazon, AMD, American Express, Apple, Arista Networks, athenahealth, Atlassian, BitGo, Bloomberg, BNY Mellon, Capgemini, Cisco, Citigroup, Cognizant, Comcast, Coupang, DE Shaw, Dell, Deloitte, Docusign, DP world, Dream11, eBay, EPAM Systems, Expedia, Flipkart, Freecharge, FreshWorks, Goldman Sachs, Google, HashedIn, HCL, IBM, Infosys, Intel, Juspay, LinkedIn, Lyft, MakeMyTrip, MAQ Software, Media.net, Meta, Microsoft, Morgan Stanley, Myntra, Nagarro, NetApp, Netflix, Netskope, Nike, Nutanix, Nvidia, Optum, Oracle, Ozon, Palo Alto Networks, PayPal, Paytm, persistent systems, PornHub, Publicis Sapient, Qualcomm, Rippling, Roblox, Salesforce, SAP, ServiceNow, Snap, Splunk, Spotify, Swiggy, TCS, Tekion, Tesla, TikTok, Tinkoff, Turing, Twilio, Uber, Virtusa, Visa, VK, Walmart Labs, Wipro, Wissen Technology, Yandex, Yelp, Zepto, Zeta, Zoho, Zomato.
- Recent: 30 days — Amazon, Bloomberg, Google, Meta, Microsoft, Ola Cabs, TCS, Visa.
- Recent: 3 months — Amazon, Apple, Bloomberg, Cognizant, Deloitte, Goldman Sachs, Google, Infosys, Meta, Microsoft, Optum, Spotify, TCS, Visa.

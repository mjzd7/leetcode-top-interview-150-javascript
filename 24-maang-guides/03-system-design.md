# System Design for MAANG SDE Interviews

> Researched with Firecrawl CLI. Study after Core CS.
> Raw data: `.firecrawl/system-design/search-hld-top50.json`, `search-lld-top50.json` + earlier `.firecrawl/maang-sde/search-system-design.json` (GFG Top-10 94k, IGotAnOffer 50+ 99k, Gagan93 LLD guide).

---

## How the round works (level-gated)

- **SDE-I / L3 / E3 (0–2y):** usually NO full HLD. Expect OOP + small LLD (classes for Parking Lot) + concurrency basics.
- **SDE-II / L4 / E4 (2–5y):** 1 HLD (URL shortener / rate limiter / Instagram) + possibly 1 LLD. Must drive requirements + tradeoffs.
- **Senior+ (L5/E5/SDE-III and above):** HLD carries max weight + deep dives (consistency, scaling, cost). LLD still appears at Amazon/Meta.
- Format: 45–60 min, open-ended, no single answer. You narrate: clarify → estimate → API → data model → components → scale → bottlenecks.

## HLD Framework (use every time)

1. **Requirements:** functional (what) + non-functional (scale, latency, consistency, availability). Ask scope: read/write ratio, DAU, retention.
2. **Back-of-envelope:** QPS = DAU × actions / 86400; storage = objects × size × retention × replication; bandwidth; cache sizing (80/20).
3. **API design:** REST endpoints, idempotency keys for writes.
4. **Data model:** SQL (transactions/joins) vs NoSQL (scale/flexible) vs blob (S3) vs graph. Shard key choice.
5. **Components:** LB (L4/L7) → app → cache (Redis/CDN) → DB (primary/replica) → queue (Kafka) → workers → search (Elastic) → monitoring.
6. **Deep dives:** consistent hashing, replication (sync/async), partitioning, CAP, rate limiting, auth, pagination, WebSockets.
7. **Bottlenecks + scale:** single points of failure, hot shards, thundering herd, cost.

---

## PART A — HLD Top-50 (grouped by tier)

Per DesignGurus 2026 bank (Easy → Medium → Hard) + GFG Top-10 + IGotAnOffer 50+:

**Tier 1 — Easy / Foundational (all levels, do first)**
1. URL shortener (TinyURL) — hashing (MD5/Base62), redirect 301/302, KGS vs hash, cache hot URLs, analytics
2. Rate limiter — token bucket vs leaky vs sliding window; Redis + Lua; per-user vs per-IP; 429 + Retry-After
3. Key-value store (Redis-like) —consistent hashing, replication, hinted handoff
4. Pastebin / file share — blob store (S3), expiry, presigned URLs
5. Unique ID generator (Snowflake) — timestamp + machine + seq; clock skew
6. Notify / pub-sub — topics, push vs pull, at-least-once + dedup
7. Cache (LRU/TTL) — write-through/behind/aside, stampede (jitter + coalesce)
8. Autocomplete / typeahead — trie + frequency, debounced API
9. Poll / voting — counters, sharded writes
10. Blog / CMS — CRUD + CDN + search

**Tier 2 — Medium (SDE-II core)**
11. Instagram / photo feed — upload fan-out (push vs pull), feed ranking, stories TTL, CDN
12. WhatsApp / chat — WebSockets, presence, message ordering, receipts, offline queue
13. Twitter timeline — fan-out bottleneck (celebrity problem), hybrid push/pull
14. YouTube / video upload — chunked upload, transcoding pipeline, HLS/DASH, CDN edge
15. Netflix watch / streaming — Open Connect, adaptive bitrate
16. Uber (location) — geohash/quadtree, matching, surge, ETA
17. Food delivery (Swiggy/Zomato) — order state machine, dispatch, tracking
18. E-commerce cart + checkout — inventory oversell (atomic decrement), payments idempotency
19. Search (web/typeahead at scale) — crawler, inverted index, PageRank-ish
20. News feed ranking — relevance vs recency
21. File sync (Dropbox/Drive) — delta sync, block dedup, conflicts
22. Parking / booking (BookMyShow) — seat hold TTL, concurrency (SELECT FOR UPDATE)
23. ATM / payments ledger — double-entry, exactly-once
24. Notification service (SMS/email/push) — priority, retries, templates, provider failover
25. Metrics / logging pipeline — high-write ingestion (Kafka → ClickHouse), downsampling
26. URL analytics / counters — sharded counters, HyperLogLog
27. Q&A (Quora/StackOverflow) — votes, ranking, spam
28. Job scheduler (cron at scale) — Quartz-like, delayed queues
29. Web crawler — politeness, dedup (Bloom), frontier
30. Proximity / maps ETA — Dijkstra/A* + live traffic

**Tier 3 — Hard / Senior (L5+, distributed deep)**
31. Distributed message queue (Kafka-lite) — partitions, offsets, ISR, ordering
32. Distributed lock / consensus — Paxos/Raft, fencing tokens, Redlock limits
33. Distributed cache (Memcached cluster) — consistent hashing + virtual nodes
34. Time-series DB ingestion — sharding by time, retention
35. Ad click aggregator — exactly-once vs at-least-once, fraud dedup
36. Multiplayer game state — tick rate, lag compensation, authoritative server
37. Stock exchange matching — order book, FIFO price-time priority
38. Distributed file system (GFS/HDFS-lite) — chunking, master/chunkservers
39. CDN from scratch — PoPs, cache hierarchy, purging
40. Service mesh / API gateway — auth, throttling, retries, circuit breaker
41. Workflow engine (Temporal-lite) — durable execution, sagas
42. Feature flag + config rollout — gradual %, kill switch
43. Ride pricing surge — geo aggregation windows
44. Fraud detection stream — windowing (Flink-like)
45. Global DB (Spanner-lite) — TrueTime, 2PC, externally consistent reads
46. Elevator at city scale (IoT) — MQTT, state sync
47. Live comments (sport stream) — fan-out 1M viewers, sharded WS
48. Email at scale — spam, queues, bounces
49. Permissions (Google Zanzibar-lite) — tuple checks, caching
50. Cost-aware design: given $X/mo, where do you cut? — CDN vs compute vs retention tradeoffs (senior filter)

**Must-practice 10 if short on time:** URL shortener, rate limiter, Instagram, WhatsApp, YouTube, Uber, BookMyShow, notification service, Dropbox sync, Kafka-lite.

---

## PART B — LLD Top-50 style (patterns + machines)

Core expectation: runnable classes, SOLID, patterns, thread-safety. From AlgoMaster LLD (80-item track: OOP 9 + principles 10 + patterns + UML) + MindMajix 2026 LLD Qs + Parking Lot FAANG walkthrough.

**B1. LLD process (45 min)**
Requirements → use cases → classes (nouns) → relationships (is-a/has-a) → SOLID check → patterns → concurrency → extensibility questions.

**B2. Top machines to code (priority order)**
1. Parking Lot — slots, tickets, pricing strategy, levels; most-asked #1
2. Elevator — state (idle/moving/door), dispatch (SCAN/LOOK), multi-lift controller
3. Splitwise — debts, simplify (min-cash-flow), groups
4. Library / BookMyShow — holds, waitlist, search
5. ATM — states, cash dispense (greedy + limited notes), PIN retries
6. Vending machine — classic state pattern
7. Tic-Tac-Toe / Chess / Snake & Ladder — game loop, win check O(1)
8. Logging framework (Log4J-lite) — levels, appenders, async queue
9. Rate limiter (LLD) — bucket objects, thread-safe refill
10. Cache LRU/LFU — HashMap + DLL, O(1); LFU freq map
11. Pub-sub / message bus — subscribe, ordering, backpressure
12. File system (in-memory) — composite pattern
13. Car rental / hotel booking — availability calendar, overlapping intervals
14. Auction / bidding — timers, highest-bid concurrency
15. Snake game / Battleship — board + observer

**B3. Pattern → problem map (memorize)**
- Singleton — config, connection pool (enum/DCL; note testability cost)
- Factory/Abstract Factory — notification senders, DB drivers
- Builder — complex request objects (telescoping fix)
- Prototype — expensive templates
- Adapter — third-party payment SDK mismatch
- Decorator — pizza/coffee pricing, Java I/O
- Observer — auction bids, stock ticks (weak-ref to avoid leaks)
- Strategy — pricing/surge, sorting, rate-limit algos + factory registry (kills if-else)
- State — elevator/ATM/vending (transitions table)
- Template Method — data pipeline skeleton
- Command + Memento — undo/redo editor
- Facade — checkout orchestrator
- Proxy — lazy image, auth guard, caching
- Composite — file system, org chart
- Chain of Responsibility — middleware, log levels, ATM dispense chain

**B4. Concurrency in LLD (asked explicitly)**
- synchronized vs ReentrantLock vs ReadWriteLock vs StampedLock
- ConcurrentHashMap internals (segments/CAS), CopyOnWriteArrayList when reads dominate
- Producer-consumer (BlockingQueue), dining philosophers fix, deadlock-free lock ordering
- Double-checked locking with volatile; immutable value objects

**B5. UML on demand**
- Class: association (uses) vs aggregation (has, independent lifecycle) vs composition (owns)
- Sequence: login/checkout flow; State diagram for elevator/ATM

---

## Estimation cheat-sheet

- 1 char = 1 B; 1M DAU × 100 req/day ≈ 1.2k QPS avg, ×3–5 peak
- Storage: 1M photos/day × 2 MB × 365 ≈ 730 TB/yr before replication
- Latency budgets: cache ~1 ms, DB ~5–20 ms, cross-region ~100 ms
- Availability: 99.9 = 8.8h/yr downtime; 99.99 = 53m
- Back-of-envelope lines to speak aloud — interviewers grade reasoning, not arithmetic.

## Sources (Firecrawl)

**HLD**
- https://designgurus.substack.com/p/50-system-design-questions-asked (38k md — 50 Q bank by difficulty 2026)
- https://medium.com/@iam-abdulmoiz/system-design-interview-2-interviews-estimations-and-rate-limiters-91b38cb9ca84 (48k md — estimations + rate limiter)
- https://algomaster.io/learn/system-design-interviews/question-types (21k md — question taxonomy)
- https://www.geeksforgeeks.org/system-design/top-10-system-design-interview-questions-and-answers/ (94k md from prior sweep)
- https://igotanoffer.com/blogs/tech/system-design-interviews (99k md, 50+ Q)

**LLD**
- https://algomaster.io/learn/lld (9k md — 80-item OOP/principles/patterns/UML track)
- https://www.youtube.com/watch?v=HRmq9eiJJ_4 (33k md — LLD Qs 2026)
- https://www.youtube.com/watch?v=7kRUmKzyNpE (64k md — Parking Lot FAANG walkthrough)
- https://gagan93.me/blog/2024/05/17/low-level-design-interviews.html (16k md)

## Rerun Inputs
workflow: firecrawl-system-design
depth: HLD top-50 + LLD top-50 (2 searches, 10 sources + 4 carried over)
output: system-design.md

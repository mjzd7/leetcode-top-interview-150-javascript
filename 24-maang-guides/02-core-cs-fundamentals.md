# Core CS Fundamentals for MAANG SDE Interviews

> Researched with Firecrawl CLI. Study after DSA, before System Design.
> Study order (one by one): **OS → DBMS → CN → OOP**. Each section = definitions first, then top-50 style Q&A grouped by subtopic.
> Raw Firecrawl data: `.firecrawl/core-cs/search-os-top50.json`, `search-dbms-top50.json`, `search-cn-top50.json`, `search-oop-top50.json` + `scrape-oop-gfg.md`

---

## How Core CS is asked (level-gated) — same format as System Design file

- **SDE-I / L3 / E3 fresher + India off-campus:** Heavy. Expect dedicated OS/DBMS/CN/OOP rounds or 15–20 min grilling inside coding rounds + 40-min project deep-dive (architecture, complexity, tradeoffs, future scope). SQL hands-on + OS theory are reject filters here.
- **SDE-II / L4 / E4 (2–5y):** Medium. Less rote theory, more applied: indexing choice for your schema, TCP tuning for your service, lock design for your cache, SOLID in your LLD round. Interviewers map your answers to HLD/LLD readiness.
- **Senior+ (L5/E5 and above):** Light on definitions, heavy on tradeoffs: isolation level vs throughput, sharding key vs hot partitions, consistency vs latency, pattern choice vs over-engineering. They grade judgment, not recall.
- Format: 45-min theory round or 10-min probes inside coding/HLD. No single answer — you narrate definition → mechanism → tradeoff → example from your project.

## Core CS Answer Framework (use every time) — same format as HLD framework / STAR

1. **Define in one line:** crisp textbook definition first (shows signal).
2. **Mechanism:** how it works internally (page fault steps, B+ tree lookup, TCP handshake, vtable dispatch).
3. **Tradeoff:** when it wins vs loses (paging vs segmentation, index vs write cost, TCP vs UDP, inheritance vs composition).
4. **Numbers/code:** formula, query, diagram, or 5-line code (EAT, RANK vs DENSE_RANK, CIDR math, Singleton DCL).
5. **Project link:** "In my project I chose X because…" — converts theory into hiring-bar evidence.

---

## PART 1 — Operating Systems (OS)

### 1.1 Definitions (must know cold)

| Concept | One-line definition | Interview one-liner |
|---|---|---|
| Process | Running instance of a program with its own address space, PCB | Isolated, heavy, IPC needed to communicate |
| Thread | Lightweight unit of execution inside a process, shares address space | Cheap context switch, shared memory, needs sync |
| PCB / Process Table | Kernel data structure storing PID, state, PC, registers, open files | Answers "what is process table?" |
| Multithreading benefits | Responsiveness, resource sharing, economy, parallelism | Server handles 10k conns without 10k processes |
| Scheduling | Order in which ready processes get CPU | FCFS, SJF, SRTF, RR, Priority, MLFQ |
| Deadlock | 4 Coffman conditions hold simultaneously: mutual exclusion, hold-and-wait, no preemption, circular wait | Detect (wait-for graph), prevent (break one condition), avoid (Banker's), recover (kill/rollback) |
| Paging | Fixed-size pages → frames, eliminates external fragmentation, uses page table + TLB | Page fault → trap → load from disk |
| Segmentation | Variable-size logical segments (code/data/stack) | Internal frag less, external frag more vs paging |
| Virtual memory | Illusion of large memory via paging + disk swap | Thrashing = excessive paging, CPU wasted on swap |
| Thrashing | Process spends more time paging than executing | Fix: working-set model, add RAM, reduce multiprogramming |
| Mutex vs Semaphore | Mutex = binary ownership lock; Semaphore = counting signal (binary or counting) | Mutex has ownership, no signal loss; semaphore for resource pools |
| Race condition / Critical section | Code accessing shared state must be atomic | Protect with locks, atomic ops, lock-free structures |

### 1.2 Top-50 OS Q&A (grouped)

**A. Processes & Threads (Q1–Q12)**
1. What is a process? What is PCB? — Running program; PCB holds PID/state/PC/registers/files.
2. Process states? — New → Ready → Running → Waiting/Blocked → Terminated (+ Suspend).
3. What is a thread? User vs kernel threads? — User (managed by lib, cheap, blocks whole process on syscall) vs kernel (OS-managed, true parallelism).
4. Process vs thread (7 differences)? — Memory isolation, creation cost, context-switch cost, communication (IPC vs shared), crash blast radius, scheduling unit, security.
5. Benefits of multithreading? — Responsiveness, sharing, economy, scalability on multicore.
6. What is context switching? Cost? — Save/restore PCB; TLB flush + cache pollution = cost. Threads cheaper.
7. Fork vs exec vs clone? — fork copies address space (CoW), exec replaces image, clone fine-grained sharing (basis of threads in Linux).
8. Zombie vs orphan? — Zombie = terminated but parent hasn't wait()ed; orphan = parent dead, reaped by init/systemd.
9. IPC mechanisms? — Pipes, FIFOs, message queues, shared memory (+sem), sockets, signals, mmap.
10. Shared memory vs message passing? — Fast but needs sync vs safe but copy overhead.
11. What is thrashing? Causes/fixes? — Over-paging; fix with working set, local replacement, more frames.
12. Daemon process? — Background, no TTY, e.g. systemd children.

**B. CPU Scheduling (Q13–Q20)**
13. FCFS / SJF / SRTF / RR / Priority? — Know Gantt + avg waiting/turnaround + starvation tradeoffs.
14. Why SJF optimal but impractical? — Needs future burst prediction; SRTF preemptive version.
15. Round Robin quantum tradeoff? — Too small = many switches; too large = FCFS.
16. Priority inversion + solution? — Low-prio holds lock needed by high-prio; fix with priority inheritance/ceiling.
17. MLFQ? — Multiple queues, aging, feedback; used in practice (e.g. Linux CFS-ish ideas).
18. CFS (Linux)? — vruntime-based fair scheduling with red-black tree.
19. Convoy effect? — Slow process blocks fast ones in FCFS.
20. Starvation vs aging? — Aging gradually boosts priority.

**C. Synchronization & Deadlock (Q21–Q30)**
21. Critical section + 3 requirements? — Mutual exclusion, progress, bounded waiting.
22. Mutex vs semaphore vs spinlock vs monitor? — Ownership/binary vs counting vs busy-wait vs language construct.
23. Binary vs counting semaphore? — 0/1 vs N resources.
24. Producer-consumer with semaphore? — empty/full/mutex trio; classic code expected.
25. Readers-writers problem? — R-preference vs W-preference vs fair.
26. Dining philosophers? — Break symmetry (odd/even pickup order) or arbitrator.
27. Deadlock 4 conditions? — Memorize Coffman; give real example (two locks opposite order).
28. Prevention vs avoidance vs detection? — Break a condition vs Banker's safe-state check vs wait-for graph + recovery.
29. Banker's algorithm? — Safe sequence simulation; O(n²·m), impractical but asked.
30. Livelock vs starvation vs deadlock? — Active retry loop vs never scheduled vs circular wait.

**D. Memory Management (Q31–Q42)**
31. Paging vs segmentation vs paged segmentation? — Fixed vs variable vs combined (x86).
32. Page table structures? — Hierarchical, hashed, inverted; TLB to speed translation.
33. TLB hit/miss + effective access time? — EAT = h·(TLB+mem) + (1-h)·(TLB+2·mem).
34. Page fault steps? — Trap → validate → find free frame (replace if needed) → disk I/O → update table → restart instr.
35. Page replacement: FIFO / LRU / Optimal / Clock? — Belady's anomaly only in FIFO; LRU stack impl; Clock = second-chance.
36. Belady's anomaly? — More frames → more faults (FIFO).
37. Internal vs external fragmentation? — Wasted inside block vs wasted between blocks; paging kills external, compaction fixes external.
38. Buddy system vs slab? — Power-of-two splits vs object caches (Linux slab/SLUB).
39. Virtual memory + demand paging? — Lazy load on fault; valid-invalid bit.
40. Copy-on-write? — fork shares pages read-only until write.
41. Working set model? — Locality window; prevents thrashing.
42. 32-bit addressable memory? — 2³² B = 4 GiB; page offset bits math (e.g. 4 KiB page → 12 offset bits).

**E. File Systems & Misc (Q43–Q50)**
43. EXT4 vs NTFS vs FAT? — Journaling, extents, permissions.
44. Inode? — Metadata + block pointers; hard vs soft links (inode refcount vs path).
45. Journaling? — Write-ahead log for crash consistency.
46. RAID 0/1/5/10? — Stripe vs mirror vs parity tradeoffs.
47. Spooling vs buffering vs caching? — Overlap I/O, temp hold, reuse.
48. System call flow? — Trap, mode switch user→kernel, dispatch via syscall table.
49. Microkernel vs monolithic? — IPC overhead vs speed; Linux monolithic, Minix micro.
50. How OS boots? — BIOS/UEFI → bootloader → kernel → init (PID 1).

---

## PART 2 — DBMS + SQL

### 2.1 Definitions

| Concept | Definition |
|---|---|
| DBMS / RDBMS | Software managing structured data; RDBMS = tables + relations + ACID |
| Normalization (1NF–BCNF, 4NF/5NF) | Remove redundancy; 1NF atomic, 2NF no partial dep, 3NF no transitive dep, BCNF every determinant is key |
| Denormalization | Intentional redundancy for read speed (analytics, leaderboards) |
| Index (B+ tree default) | Ordered structure → O(log n) lookups; clustered (1/table, reorders rows) vs non-clustered |
| ACID | Atomicity, Consistency, Isolation, Durability |
| Isolation levels | Read Uncommitted < Read Committed < Repeatable Read < Serializable; fixes dirty/non-repeatable/phantom reads |
| JOINs | INNER / LEFT / RIGHT / FULL / CROSS / SELF |
| View / Materialized view | Saved query vs precomputed snapshot |
| Sharding vs replication vs partitioning | Horizontal split across DBs vs copies for HA vs split inside one DB |
| CAP | Consistency / Availability / Partition tolerance — pick 2 in failure |

### 2.2 Top-50 DBMS Q&A (grouped)

**A. Basics & Normalization (Q1–Q10)**
1. DBMS vs RDBMS vs NoSQL? — Examples: MySQL/Postgres vs Mongo/Cassandra/Redis.
2. File system vs DBMS? — Data independence, concurrency, recovery, security.
3. 1NF/2NF/3NF/BCNF with violations? — Be able to normalize a bad table live.
4. When to denormalize? — Read-heavy, join pain, warehouse.
5. Keys: super/candidate/primary/foreign/composite/surrogate? — FK enforces referential integrity (cascade/restrict).
6. Entity vs attribute vs relationship? — ER diagram reading.
7. DDL/DML/DCL/TCL? — CREATE/ALTER vs SELECT/INSERT vs GRANT vs COMMIT/ROLLBACK.
8. Delete vs truncate vs drop? — Logged + where vs deallocates pages vs removes schema.
9. Constraints? — NOT NULL/UNIQUE/CHECK/DEFAULT/PK/FK.
10. Stored procedure vs function vs trigger? — Side-effects + transaction control differences.

**B. Indexing & Query Perf (Q11–Q20)**
11. How does B+ tree index work? — Fan-out, height ~3–4 for millions of rows.
12. Clustered vs non-clustered? — One clustered; PK usually clustered in InnoDB.
13. When does index hurt? — Writes, low-cardinality (gender flag), small tables.
14. Composite index + leftmost prefix? — (a,b,c) serves a, a+b, a+b+c — not b alone.
15. Covering index / index-only scan? — SELECT cols ⊆ index → no heap fetch.
16. EXPLAIN output? — type (ALL→index→range→ref→const), key, rows, Extra (Using filesort/temporary = bad).
17. N+1 query problem? — ORM lazy loads; fix with JOIN/eager load.
18. Slow query debug steps? — EXPLAIN → missing index → rewrite → cache → shard.
19. Full-text vs LIKE '%x%'? — Inverted index vs full scan.
20. Partitioning types? — Range/list/hash; partition pruning.

**C. Transactions & Concurrency (Q21–Q32)**
21. ACID with real example? — Bank transfer: debit+credit atomic.
22. Dirty / non-repeatable / phantom reads? — Map each to isolation level that fixes it.
23. Each isolation level + anomaly table? — Draw 4×3 matrix from memory.
24. Optimistic vs pessimistic locking? — Version check vs SELECT FOR UPDATE.
25. Deadlock in DB? — Two txns lock rows opposite order; DB picks victim.
26. MVCC? — Postgres/InnoDB keep row versions; readers don't block writers.
27. WAL / redo / undo? — Durability + rollback.
28. COMMIT / ROLLBACK / SAVEPOINT? — Partial rollback demo.
29. Lost update? — Read-modify-write race; fix with atomic UPDATE or version.
30. Serializable vs snapshot isolation? — SSI anomalies awareness.
31. 2PC? — Prepare + commit; blocking problem → 3PC/Paxos.
32. Idempotency key? — Retry-safe payments.

**D. SQL Hands-on (Q33–Q42)**
33. 2nd highest salary (no LIMIT)? — Correlated subquery / DENSE_RANK.
34. DENSE_RANK vs RANK vs ROW_NUMBER? — Ties handling.
35. Top-N per group? — PARTITION BY + ROW_NUMBER.
36. JOIN all types with NULL behavior? — LEFT keeps left NULLs.
37. GROUP BY + HAVING vs WHERE? — Filter before vs after aggregation.
38. EXISTS vs IN vs JOIN? — NULL semantics + perf.
39. Self-join (manager-employee)? — Classic.
40. Running total / moving avg? — Window SUM() OVER (ORDER BY …).
41. Delete duplicates keeping one? — ROW_NUMBER or self-join.
42. Pivot rows→cols? — CASE + GROUP BY.

**E. Scaling (Q43–Q50)**
43. SQL vs NoSQL when? — Transactions/joins vs scale-out flexible schema.
44. Vertical vs horizontal scaling? — Bigger box vs sharding.
45. Sharding key choice? — High-cardinality, even, query-aligned (user_id); hot shard danger.
46. Replication: master-slave vs multi-master? — Lag vs conflicts.
47. Eventual consistency example? — Dynamo-style; read repair, quorum (R+W>N).
48. Caching layers? — App → Redis → DB; cache-aside vs write-through vs write-behind.
49. Connection pooling? — PgBouncer; thundering herd.
50. Hot partition / cache stampede fixes? — Jittered TTL, request coalescing, rate limits.

---

## PART 3 — Computer Networks (CN)

### 3.1 Definitions

| Concept | Definition |
|---|---|
| OSI 7 vs TCP/IP 4 | Physical/DataLink/Network/Transport/Session/Presentation/App vs Link/Internet/Transport/App |
| TCP 3-way handshake | SYN → SYN-ACK → ACK; sequence numbers sync |
| TCP vs UDP | Reliable ordered stream vs fire-and-forget datagrams |
| DNS | Hierarchical resolution: recursive → root → TLD → authoritative; cached |
| HTTP/1.1 vs H2 vs H3 | Textual + HoL blocking → multiplexed binary → QUIC/UDP |
| HTTPS/TLS handshake | Asymmetric key exchange → symmetric session; certs verify identity |
| Load balancer (L4 vs L7) | Distribute traffic; L4 TCP/UDP vs L7 HTTP-aware routing |
| Forward vs reverse proxy / CDN | Client-side hide vs server-side + edge cache |
| NAT / Subnet / CIDR | Private→public mapping; /24 = 256 IPs |
| WebSocket vs SSE vs polling | Full-duplex vs server-push vs client-pull |

### 3.2 Top-50 CN Q&A (grouped)

**A. Fundamentals & Models (Q1–Q8)**
1. OSI layers with devices/protocols per layer? — Hub L1, switch L2, router L3.
2. TCP/IP vs OSI? — Practical 4-layer mapping.
3. What happens when you type google.com + Enter? — Full chain: DNS → TCP+TLS → HTTP → render; expected 2-min answer.
4. Circuit vs packet switching? — Reserved path vs statistical multiplexing.
5. Unicast/multicast/broadcast/anycast? — CDN anycast example.
6. IPv4 vs IPv6? — 32 vs 128 bit, header simplification, no NAT need.
7. Subnetting / CIDR math? — 192.168.1.0/24 → range + broadcast.
8. MAC vs IP? — L2 burned-in vs L3 routable.

**B. Transport: TCP/UDP (Q9–Q20)**
9. 3-way handshake + why 3, not 2/4? — Prevent stale duplicates; SYN flood = half-open exhaustion + SYN cookies fix.
10. 4-way teardown (FIN)? — Half-close support.
11. Sequence/ACK numbers? — Cumulative ACK, retransmission on timeout/dup-ACK.
12. Flow control (sliding window) vs congestion control? — Receiver window vs slow-start / AIMD / fast retransmit.
13. Slow start / ssthresh / Reno vs Cubic vs BBR? — Loss-based vs model-based.
14. TCP HoL blocking? — One lost packet stalls stream; H2 still TCP-bound, H3/QUIC fixes per-stream.
15. UDP use cases? — DNS, gaming, VoIP, QUIC itself; reliability built above.
16. When TCP over UDP breaks? — VPN TCP-meltdown.
17. Keepalive vs heartbeat? — Idle detection.
18. Nagle + delayed ACK? — Small-packet batching vs latency tradeoff.
19. TIME_WAIT why 2MSL? — Last ACK safety + old duplicates drain.
20. Port numbers: 80/443/53/22/25/3306/6379/5432? — Rote list.

**C. Application Layer (Q21–Q34)**
21. HTTP GET vs POST vs PUT vs PATCH vs DELETE vs HEAD? — Safety + idempotency matrix.
22. HTTP status codes groups? — 1xx/2xx/3xx/4xx/5xx with 10+ examples (200/201/204/301/302/304/400/401/403/404/429/500/502/503).
23. Cookies vs sessions vs JWT vs OAuth2? — Storage, scale, revocation tradeoffs.
24. Stateful vs stateless? — LB stickiness need.
25. HTTP/1.1 keep-alive + pipelining? — Persistent conn; pipelining broken → H2 multiplexing.
26. H2 vs H3? — Binary frames + HPACK/QPACK; QUIC 0-RTT.
27. TLS 1.2 vs 1.3 handshake steps? — Fewer round trips, forward secrecy.
28. Cert chain + CA? — Root → intermediate → leaf; expiry debugging.
29. DNS recursion steps + record types? — A/AAAA/CNAME/MX/TXT/NS/SOA; TTL caching.
30. DNS over HTTPS? — Privacy vs enterprise visibility.
31. WebSocket handshake? — Upgrade: 101 + persistent frames.
32. Long-polling vs SSE vs WS? — Latency/complexity matrix.
33. REST vs gRPC vs GraphQL vs SOAP? — When each wins.
34. API idempotency + retries? — POST unsafe; exponential backoff + jitter.

**D. Scaling & Infra (Q35–Q50)**
35. L4 vs L7 LB + algos? — Round-robin/least-conn/IP-hash/weighted; health checks.
36. Reverse proxy (Nginx) vs CDN? — Origin shield + edge PoPs, cache HIT/MISS, TTL.
37. Cache headers? — Cache-Control, ETag/If-None-Match, Last-Modified, Vary.
38. Consistent hashing? — Minimal remap on node change; virtual nodes.
39. Rate limiting algos? — Token/leaky bucket, fixed/sliding window; 429 + Retry-After.
40. Circuit breaker + bulkhead? — Fail fast, isolate pools.
41. NAT types? — Static/dynamic/PAT; CGNAT.
42. DHCP DORA? — Discover/Offer/Request/ACK.
43. ARP? — IP→MAC; spoofing danger.
44. ICMP/ping/traceroute? — TTL trick.
45. VPN / tunneling? — WireGuard/IPsec.
46. Firewall stateful vs stateless? — Connection tracking.
47. DDoS layers + mitigations? — SYN flood, amplification, L7 flood; scrubbing, anycast, WAF.
48. Zero-trust basics? — mTLS, short-lived certs.
49. QUIC 0-RTT replay risk? — Idempotent-only early data.
50. Debug slow page load? — DNS → TCP/TLS → TTFB → content → render; curl -w, devtools waterfall.

---

## PART 4 — OOP + SOLID + Design Patterns

### 4.1 Definitions

| Concept | Definition |
|---|---|
| 4 pillars | Encapsulation, Abstraction, Inheritance, Polymorphism (compile-time overloading vs runtime overriding) |
| SOLID | S: single responsibility; O: open/closed; L: Liskov substitution; I: interface segregation; D: dependency inversion |
| DRY / YAGNI / KISS | Don't repeat, ain't gonna need it, keep simple |
| Abstract class vs interface | State + partial impl + single inheritance vs pure contract + multiple (Java 8 default methods nuance) |
| Composition over inheritance | Has-a beats is-a for flexibility; decorator/strategy rely on it |
| Key patterns | Singleton, Factory/Abstract-Factory, Builder, Prototype, Adapter, Decorator, Observer, Strategy, State, Template Method, Command, Facade, Proxy |

### 4.2 Top-50 OOP Q&A (grouped)

**A. Pillars (Q1–Q12)**
1. Encapsulation example + why getters/setters aren't enough? — Invariants, immutability.
2. Abstraction vs encapsulation? — What vs how-hidden.
3. Inheritance pros/cons? — Reuse vs fragile base class; diamond problem (C++ virtual, Java interfaces, Python MRO).
4. Polymorphism: overloading vs overriding? — Static bind vs vtable dispatch; rules (covariant return, no narrowing throws in Java).
5. Virtual functions + vtable cost? — Indirection + no inlining.
6. Abstract vs interface (Java/C++/Python ABC)? — When to use which.
7. Multiple inheritance issues? — Ambiguity; solve with interfaces/mixins.
8. Composition example? — Engine in Car vs Car extends Engine (wrong).
9. Immutable class design? — final, private finals, defensive copies, no setters.
10. Copy ctor vs clone vs move (C++)? — Rule of 3/5/0.
11. super/this, static vs instance? — Binding + init order.
12. Cohesion vs coupling? — High cohesion, low coupling goal.

**B. SOLID (Q13–Q25)**
13–17. Each SOLID letter with violation + fix? — Prepare 5 two-min stories (e.g. God class → split; switch-on-type → polymorphism).
18. Liskov classic violations? — Square extends Rectangle (setWidth breaks height), Penguin extends Bird{fly()}.
19. Open/closed without modifying? — Plugin via interface.
20. DI: constructor vs setter vs field? — Constructor wins for testability; frameworks (Spring) recap.
21. Interface segregation example? — Fat Worker vs Workable/Eatable split.
22. SOLID over-engineering? — YAGNI; when NOT to abstract.
23. DRY vs abstraction cost? — Rule of three.
24. Law of Demeter? — train.getCar().getEngine() smell → tell-don't-ask.
25. GRASP basics? — Information expert, creator, controller.

**C. Patterns (Q26–Q45)**
26. Singleton: eager vs lazy vs DCL vs enum (Java)? — Volatile + double-checked; Enum best; testability downside.
27. Why Singleton is controversial? — Global state, hidden deps; prefer DI container single scope.
28. Factory vs Abstract Factory vs Builder? — Object family vs step-by-step (telescoping ctor fix).
29. Builder fluent example? — Effective-Java style.
30. Prototype vs clone? — Costly creation reuse.
31. Adapter vs Facade vs Decorator vs Proxy? — 2×2 matrix: interface change vs simplify vs add behavior vs control access.
32. Observer (pub-sub) example? — Event bus, pitfalls (leaks, ordering).
33. Strategy vs State vs Template? — Interchangeable algos vs lifecycle transitions vs skeleton + hooks.
34. Command + undo? — Encapsulate request; Memento for state.
35. State machine for elevator/parking? — Draw transitions.
36. Decorator (Java I/O, Python @)? — Wrapping without subclass explosion.
37. Proxy types? — Virtual/lazy, protection, remote, caching.
38. MVC/MVP/MVVM? — UI separation; data binding differences.
39. Repository/Unit-of-Work? — Persistence abstraction.
40. Dependency Injection container? — Wiring + lifetimes (transient/scoped/singleton).
41. Pattern for rate limiter / parser? — Token bucket + strategy.
42. Anti-patterns: God object, anemic model, shotgun surgery? — Name + fix.
43. Pattern to remove if-else chains? — Strategy + factory registry.
44. Observer memory leak fix? — Weak refs / unsubscribe.
45. Real codebase pattern you used? — Must-have story.

**D. Language/LLD bridge (Q46–Q50)**
46. Virtual destructor (C++) / equals-hashCode contract (Java)? — Rote but asked.
47. Interface default methods conflict (Java)? — Explicit override rule.
48. Python MRO + super()? — C3 linearization.
49. Design Splitwise/Parking Lot classes? — Leads into LLD file.
50. UML: association/aggregation/composition + sequence diagram? — Read/draw on demand.

---

## Quick Revision Cheat-Sheet — ADDED (same format as System Design estimations)

- OS: PCB fields, 5-state diagram, thread vs process table, Coffman 4, Banker's safe sequence, EAT formula, LRU vs Clock, CoW, thrashing fix.
- DBMS: 1NF→BCNF one-line each, clustered vs non-clustered, leftmost prefix, isolation anomaly matrix (draw 4×3), RANK trio, sharding key rules.
- CN: OSI 7 in order, handshake 3 + teardown 4, TCP vs UDP table, status code groups, cookie/session/JWT table, L4 vs L7, DORA, CIDR /24 math.
- OOP: 4 pillars one-liners, SOLID 5 expansions, pattern map (creational/structural/behavioral), composition-over-inheritance example, immutable class recipe.
- Speak-aloud drills: type google.com flow (2 min), Bank transfer ACID (1 min), deadlock example with two locks (1 min), URL shortener DB choice (2 min).

## Prep Plan (1–2 weeks) — ADDED (same format as Behavioral prep plan)

- Day 1–2: OS definitions + A–C groups aloud, write Banker's + producer-consumer once each.
- Day 3–4: DBMS normalization drill on one bad table + 10 SQL queries (window functions, joins, dedup) runnable.
- Day 5–6: CN chain (DNS→TCP→TLS→HTTP) + handshake diagram + status codes + LB/proxy/CDN table.
- Day 7: OOP pillars + SOLID 5 stories + pattern matrix; code Singleton DCL + Strategy registry.
- Day 8–10: 2 mocks (1 theory, 1 project deep-dive 40 min: architecture, complexity, tradeoffs, future scope).
- Bar check: every answer follows Define → Mechanism → Tradeoff → Numbers/code → Project link. No definition without tradeoff ships.

---

## Sources (Firecrawl)

**OS**
- https://www.geeksforgeeks.org/operating-systems/operating-systems-interview-questions/ (71k md — Q1–Q6 process/thread/thrashing verbiage)
- https://leetcode.com/discuss/interview-question/operating-system/5873921/Part-3%3A-Top-17-OS-interview-questions-with-answers/
- https://www.scribd.com/document/871574111/Give-Me-All-the-Question-With-Answer-With-Are-Aske
- https://web2.aabu.edu.jo/tool/course_file/901332_Operating%20systems%20interview%20questions(1).pdf

**DBMS**
- https://www.geeksforgeeks.org/dbms/commonly-asked-dbms-interview-questions/
- https://www.interviewbit.com/dbms-interview-questions/ (67k md, 75+ Q 2026)
- https://www.youtube.com/watch?v=bs4Q7NcjWgE

**CN**
- https://www.interviewbit.com/networking-interview-questions/ (57k md, 70+ Q 2026)
- https://perfectnotes.org/interview-questions/computer-networks
- https://unstop.com/blog/networking-interview-questions (73k md, Top 100 2026)

**OOP**
- https://www.geeksforgeeks.org/interview-prep/oops-interview-questions/ (32k scrape)
- https://bytebytego.com/courses/object-oriented-design-interview/what-is-an-object-oriented-design-interview
- https://www.youtube.com/watch?v=NZwxmcUY_Lo (Java OOP + SOLID + patterns)

## Rerun Inputs
workflow: firecrawl-core-cs
depth: 4 topics × top-50 (OS ok, DBMS ok, CN ok, OOP lite+scrape after 2 timeouts) + v2 format expansion (no content removed)
output: core-cs-fundamentals.md

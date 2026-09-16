---
title: "Master Index — Study Order, Weeks, Projects"
description: "Week-by-week path through Modern Skills, Fresher JS, Mid-level, with project checklist and search."
keywords: ["study plan", "week by week", "projects", "checklist", "modern engineer", "fresher", "mid-level"]
tags: ["index"]
sidebar_position: 0
---

# Master Index — 00-INDEX

> Order: Modern Skills (think) → Fresher JS (build) → Mid-level (scale). Every subpage: ELI15 + JS + flowchart + whiteboard SVG + official Firecrawl + Top-50 (50 links each, 650 total verified).

## Parents
- [Modern Engineer Skills](./modern-engineer-skills/index.md): [A1](./modern-engineer-skills/01-prompt-engineering-constraints.md) → [A2](./modern-engineer-skills/02-agentic-thinking.md) → [A3](./modern-engineer-skills/03-auditing-ai-strategic-bigo.md) → [A4](./modern-engineer-skills/04-architectural-communication-hld.md)
- [Fresher Roadmap](./fresher-roadmap/index.md): [F1](./fresher-roadmap/f1-js-oop.md) → [F2](./fresher-roadmap/f2-dsa-150-patterns-js.md) → [F3](./fresher-roadmap/f3-postgres-rest-auth.md) → [F4](./fresher-roadmap/f4-docker-aws-actions.md) → [F5](./fresher-roadmap/f5-openai-langchain-js.md)
- [Mid-level Roadmap](./mid-level-roadmap/index.md): [M1](./mid-level-roadmap/m1-advanced-system-design.md) → [M2](./mid-level-roadmap/m2-distributed-systems.md) → [M3](./mid-level-roadmap/m3-applied-agentics-rag.md) → [M4](./mid-level-roadmap/m4-ai-security.md)

## Week-by-week (12 weeks, JS-only)
- W1: A1 + F1 — constraints + OOP. Project: JSON invoice parser class.
- W2: A3 + F2 start — Big-O + TwoPtr/Slide. Project: timed O(n) vs O(n²) demo.
- W3: F2 trees/graphs — BFS/DFS. Project: islands + level order.
- W4: F2 DP + A2 ReAct — memo + tool loop. Project: robber + 1 tool agent.
- W5: F3 — Postgres + REST + JWT. Project: todos CRUD + `$1` + cursor page.
- W6: F4 — Docker + EC2 + Actions. Project: deployed URL + green run + STOP instance.
- W7: A4 + F5 — HLD narrate + first Responses call. Project: supportbot HLD + unicorn JSON.
- W8: M1 — LB + sharding + hash router. Project: 4-shard router in JS.
- W9: M2 — Redis + Kafka + K8s. Project: cached route + 1 topic flow.
- W10: M3 — RAG pipeline + eval. Project: PDF → chunks → top-4 → cited answer.
- W11: M4 — injection guards + SelfCheck. Project: delimited + canary + IDK demo.
- W12: Mock week — debug AI files live, 50-Q drills per page, polish search.

## Project checklist (must-ship)
- [ ] JSON-only prompt with evals (A1)
- [ ] Triage handoff + ReAct MAX_STEPS (A2)
- [ ] Audit 1 AI file: O(n²)→O(n) + regression (A3)
- [ ] HLD whiteboard + race fix narrated (A4)
- [ ] Person tree with # + static (F1)
- [ ] 150 DSA by pattern, not count (F2)
- [ ] CRUD + JOIN + index + EXPLAIN (F3)
- [ ] EC2 deployed + Actions green + stopped (F4)
- [ ] 1 E2E task agent + trace (F5)
- [ ] Shard router + LB pick (M1)
- [ ] Cache + topic + Helm chart (M2)
- [ ] RAG eval split logged (M3)
- [ ] Injection + hallucination guards (M4)

## Verification (Final, Sep 16 2026)
- 13 subpages × 50 answer links = 650 verified via `grep -c "Answer]("` — all 50 each
- 13 whiteboard SVGs in `docs/assets/diagrams/`
- 26 Firecrawl raw captures in `.firecrawl/raw/`, all `wc -l -c` verified, no stdout truncation
- Credits: started 1270, ended 1244 — 26 used (2 per subpage avg). Fallback: free websearch/webfetch for discovery + cross-verify throughout.
- Search: `docs/search-index.json` (titles + keywords + H2s). Search any phrase to find its subpage.

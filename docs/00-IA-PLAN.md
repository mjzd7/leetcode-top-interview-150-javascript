# Website Information Architecture — Modern Engineer Skills Guide (JS-only)

> Phase 0 design doc. ELI15 throughout. Searchable static docs.

## Parents + subpages

### Parent 1: Modern Engineer Skills → `docs/modern-engineer-skills/`
- `index.md` — landing, video thesis, map A1-A4
- `01-prompt-engineering-constraints.md` — A1
- `02-agentic-thinking.md` — A2
- `03-auditing-ai-strategic-bigo.md` — A3
- `04-architectural-communication-hld.md` — A4

### Parent 2: Fresher Roadmap (JS-only) → `docs/fresher-roadmap/`
- `index.md` — Phase 1-5 order, week-by-week
- `f1-js-oop.md` — JS + OOP, no Python
- `f2-dsa-150-patterns-js.md` — arrays, trees, graphs, DP in JS
- `f3-postgres-rest-auth.md` — Postgres + REST + Auth with JS `pg` + `fetch`/`express`
- `f4-docker-aws-actions.md` — Docker + AWS Free Tier + GitHub Actions
- `f5-openai-langchain-js.md` — OpenAI API + LangChain.js agents

### Parent 3: Mid-level Roadmap → `docs/mid-level-roadmap/`
- `index.md` — Domain 1-4 order, prerequisites (finish Fresher first)
- `m1-advanced-system-design.md` — LB, sharding, LLD
- `m2-distributed-systems.md` — microservices, Redis, Kafka, K8s
- `m3-applied-agentics-rag.md` — enterprise RAG, multi-agent
- `m4-ai-security.md` — prompt injection, hallucinations

## Searchable requirements (every subpage)
Frontmatter:
```yaml
---
title: "..."
description: "...15yo summary..."
keywords: ["...", "..."]
tags: ["modern-engineer-skills" | "fresher-roadmap" | "mid-level-roadmap", "<topic>"]
sidebar_position: N
---
```
- H2/H3 headers must be literal searchable phrases (e.g. `## What is prompt drift in simple words`)
- First 100 words = plain-English definition for search excerpt
- `docs/search-index.json` generated in Final from title + description + keywords + H2s
- Cross-links: every page links Prev/Next + related pages

## Per-subpage mandatory sections (same format)
1. TL;DR ELI15 + analogy
2. Why companies care (from video thesis)
3. Core concepts in simple words
4. Detailed JS examples (runnable, good vs bad AI output where relevant)
5. Flowchart (Mermaid `flowchart TD`)
6. Whiteboard diagram (in-depth SVG in `docs/assets/diagrams/<slug>.svg`, sketch style, embedded via `![...](../assets/diagrams/...)`)
7. Official notes — Firecrawl full-capture (see policy below), with source URLs
8. Cross-verify table — official vs second source, conflicts noted
9. Top-50 interview questions — table `# | Question | Why asked | Answer link`, all links verified, no bare URLs without context
10. Quiz (5 Qs) + project checklist + Next steps

## Firecrawl full-capture policy (no truncation)
- NEVER rely on terminal stdout preview — always `-o .firecrawl/raw/<slug>-<source>.md` (or `.json` for search)
- Commands:
  - `firecrawl scrape "<url>" -o .firecrawl/raw/<slug>-official.md`
  - `firecrawl search "<query>" --scrape --limit 5 -o .firecrawl/raw/<slug>-search.json --json`
- After each fetch: `wc -l` + `wc -c` to confirm full write, then read file incrementally via Read with offset/limit + Grep, never `head` alone as evidence
- If output looks cut (ends mid-sentence, 0 bytes, `...truncated...`), re-scrape with `--format markdown` explicitly, or `map` to find canonical URL then re-scrape
- Keep raw files; final notes in `docs/` only contain synthesized ELI15 + citations, never paste entire raw dump
- `.firecrawl/` is gitignored, `docs/` is the website

## Credit-saving fallback policy (1270 credits at start)
- Firecrawl (paid) ONLY for: official docs pages + 2-3 high-value Top-50 answer pages per topic
- Everything else (discovery, Top-50 list building, quick facts): use free `websearch` / `webfetch` first
- Order per topic:
  1. `websearch` to find official URL + Top-50 lists (free)
  2. `firecrawl scrape` official URL to file (paid, 1 credit-ish)
  3. `webfetch`/`websearch` to cross-verify (free)
  4. Only if page is JS-heavy / blocked → `firecrawl scrape` verify URL
- If credits < 200: stop all Firecrawl search, use only `websearch` + single `firecrawl scrape` per remaining topic, and flag in Final
- Check `firecrawl credit-usage` before each block

## Language rule
- JS-only. No Python snippets. Node 18+ `fetch`, classes, `async/await`. Where backend needs DB/queue, use JS clients (`pg`, `ioredis`, `kafkajs`, `langchain` JS).

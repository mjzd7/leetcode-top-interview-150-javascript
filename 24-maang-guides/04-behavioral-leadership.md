# Behavioral & Leadership Interviews for MAANG SDE

> Researched with Firecrawl CLI. Study after System Design.
> Raw data: `.firecrawl/maang-sde/search-behavioral.json` (Exponent 39k, interviewing.io 55k, IGotAnOffer 106k) + `.firecrawl/behavioral/search-googleyness-meta.json`, `search-lp-bank.json`, `scrape-star-samples.md` (28k).

---

## Why this round rejects strong coders

- Google: `Googleyness` eliminates perfect-coding candidates (FinalRoundAI 2025 guide).
- Amazon: LP questions appear in **every** round, not just one behavioral round.
- Meta: signals-based scoring (collaboration, impact, growth).
- Hiring committee reads behavioral signals for leveling — L5+ needs influence without authority.

## STAR Method (only format that passes)

**S**ituation (15%) → **T**ask (15%) → **A**ction (50%, "I" not "we") → **R**esult (20%, metric + learning).
Rules: 2–3 min per story, metric in every story, failure + learning in 2 stories, never blame, never say "we decided" without your role.

---

## PART A — Amazon 16 Leadership Principles (question bank + what they test)

1. **Customer Obsession** — "Tell me about a time you went above and beyond for a customer (internal dev counts)." Tests: working backwards, disagreeing with PM to protect user.
2. **Ownership** — "Tell me about a time you took on something outside your role." Tests: long-term fixes vs quick hacks, never saying "not my job."
3. **Invent & Simplify** — "Tell me about your most innovative solution." Tests: simplification that removed code/process.
4. **Are Right, A Lot** — "Tell me about a time you were wrong / made a bad call." Tests: judgment + course correction, data over gut.
5. **Learn & Be Curious** — "Tell me about a time you taught yourself a new stack under deadline." Tests: growth slope.
6. **Hire & Develop the Best** — "Tell me about mentoring someone who struggled." Tests: raising bar, actionable feedback. (Asked even of SDE-I.)
7. **Insist on the Highest Standards** — "Tell me about a time you refused to ship." Tests: quality bar under pressure.
8. **Think Big** — "Tell me about a bold bet / 10x idea." Tests: vision beyond ticket.
9. **Bias for Action** — "Tell me about a decision with incomplete data." Tests: speed vs analysis paralysis, reversibility logic.
10. **Frugality** — "Accomplish more with less." Tests: constraints breed invention (asked heavily in India loops).
11. **Earn Trust** — "Tell me about a conflict with a teammate/manager." Tests: directness + delivery.
12. **Dive Deep** — "Tell me about a bug where metrics lied." Tests: instrumentation, root-cause over symptoms.
13. **Have Backbone; Disagree & Commit** — "Tell me about disagreeing with your manager and what happened." Tests: pushback + commit once decided.
14. **Deliver Results** — "Tell me about a tight deadline you hit/missed." Tests: prioritization, escalation timing.
15. **Strive to be Earth's Best Employer** — "How do you make your team inclusive/productive?" Tests: culture add.
16. **Success & Scale Bring Responsibility** — "Tell me about considering broader impact (privacy/safety/community)." Newer, asked at senior+.

**Follow-ups interviewers use:** "What would you do differently?", "What did your manager say?", "How big was the impact in numbers?", "What broke?"

## PART B — 8 stories that cover all 16 (build these)

| # | Story spine | Covers |
|---|---|---|
| 1 | Production outage you debugged end-to-end (metrics → root cause → fix → postmortem) | Dive Deep, Ownership, Deliver Results |
| 2 | Shipped under tight deadline with tradeoff you escalated | Bias for Action, Are Right A Lot, Earn Trust |
| 3 | Simplification that deleted code/process (script, refactor, automation) | Invent & Simplify, Frugality, Think Big |
| 4 | Conflict with teammate/PM over design; data settled it | Earn Trust, Have Backbone, Customer Obsession |
| 5 | Biggest failure/missed deadline + learning + prevention | Are Right A Lot, Learn & Curious, Insist Standards |
| 6 | Mentored junior/intern from struggling to shipping | Hire & Develop, Best Employer |
| 7 | Disagreed with manager, committed, result (good or bad) | Have Backbone, Ownership |
| 8 | Cross-team project where you had no authority but drove outcome | Think Big, Deliver Results, Scale/Responsibility |

Each story: write 150-word STAR bullet + metric (latency %, cost $, users, time saved) + 1-line learning.

## PART C — Googleyness (Google)

Traits: collaboration over heroics, humility, learning from failure, user focus, comfort with ambiguity.
Most-asked (LeetCode Googlyness FAQ + Reddit curated list):
- Tell me about a time you failed and what you learned.
- Tell me about working with a difficult teammate across time zones.
- Tell me about ambiguous requirements — how did you clarify?
- Tell me about going beyond role to help team ship.
- Why Google? (team/product specificity wins over generic praise.)
Format: Googleyness + Leadership is often 1 round; sometimes 2. Prepare 5 stories overlapping Amazon bank but framed collaboratively.

## PART D — Meta signals

Signals: collaboration, impact/complexity, growth, communication. Meta behavioral bank (Exponent 2026): conflict, feedback you received, project you drove, mistake, cross-functional influence.
Meta tip: concise + data-first; ex-Meta/Amazon manager breakdown (YouTube CAda15Tawlg) stresses "scope + metric in first 30 seconds."

## PART E — Top-50 behavioral Q&A (rapid-fire bank)

Conflict/teamwork (1–10): difficult teammate, disagreement with lead, giving hard feedback, receiving hard feedback, working with underperformer, cross-team dependency slipped, persuading without authority, remote miscommunication, credit dispute, helping struggling peer.
Ownership/delivery (11–20): tight deadline, de-scoped to hit date, production bug on your watch, on-call horror, missed deadline, prioritized 3 competing asks, unowned problem you picked up, saved launch, rollback call, postmortem you led.
Growth/failure (21–30): biggest failure, wrong technical call, skill you learned in weeks, feedback that stung, performance review surprise, side project that taught system thinking, interview rejection learning, production lesson that changed habits, mentorship received, career goal 2y.
Leadership/influence (31–40): mentored junior, raised hiring bar, said no to manager, convinced PM with data, drove adoption of new tool, led without title, handled low performer, built inclusive review culture, scaled onboarding docs, resolved team process fight.
Customer/impact (41–50): went beyond for user/dev-customer, pushed back on feature hurting users, privacy/safety tradeoff, cost vs experience call, accessibility fix, latency complaint deep-dive, support ticket → systemic fix, internal tool users hated → redesign, metric you moved + how, proudest launch.

## Prep plan (1 week)

- Day 1: draft 8 stories in STAR bullets with metrics.
- Day 2: map each story to 2–3 LPs; fill gaps (usually Frugality + Best Employer missing).
- Day 3: speak aloud 2 min each, record, cut "we" → "I did X."
- Day 4: 1 mock (peer or Exponent/interviewing.io), fix rambling.
- Day 5: Googleyness/Meta reframing of same 8 stories.
- Bar check: every story has metric + learning + conflict or tradeoff. No story without numbers ships.

## Sources (Firecrawl)

- https://www.tryexponent.com/blog/how-to-nail-amazons-behavioral-interview-questions (39k)
- https://interviewing.io/guides/amazon-leadership-principles (55k)
- https://igotanoffer.com/blogs/tech/amazon-behavioral-interview (106k)
- https://igotanoffer.com/en/advice/amazon-leadership-principles (LP bank)
- https://mentorcruise.com/blog/amazon-star-method-sample-answers-6dc3e/ (28k scrape — STAR samples)
- https://www.scarletink.com/how-to-pass-amazon-behavioral-leadership-principles-interview
- https://leetcode.com/discuss/post/5963463/googlyness-frequently-asked-questions-by-55sh/ (Googlyness FAQ)
- https://www.reddit.com/r/datacenter/comments/1tpnkpl/curated_list_of_mostasked_googlyness_google/
- https://www.tryexponent.com/questions?company=meta-facebook&type=behavioral (Meta bank 2026)
- https://www.youtube.com/watch?v=CAda15Tawlg (ex-Meta/Amazon managers breakdown)
- https://www.reddit.com/r/leetcode/comments/1gs1guc/how_i_used_star_methodology_to_crack_amazon/ (STAR crack story)

## Rerun Inputs
workflow: firecrawl-behavioral
depth: Amazon LP bank + Googleyness/Meta + STAR samples (3 searches/scrapes, 11 sources, 1 timeout retried lite)
output: behavioral-leadership.md

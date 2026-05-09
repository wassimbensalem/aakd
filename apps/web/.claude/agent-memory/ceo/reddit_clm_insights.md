---
name: Reddit CLM User Research — Real Buyer Insights
description: Synthesized insights from 5 Reddit threads (r/procurement, r/projectmanagement, r/legaltech) about CLM pain points, buying behavior, and tool preferences. Directly informs ClauseFlow positioning and roadmap.
type: project
---

## Source threads (collected 2026-05-09)
> Raw threads saved at: `research/reddit-threads-raw.md`

1. r/procurement — "Looking to learn from people who have used CLM tools"
2. r/procurement — "What CLM software is everyone actually using these days?"
3. r/projectmanagement — "How your contract lifecycle management works?"
4. r/legaltech — CLM for 1200-employee company on Salesforce Revenue Cloud
5. r/legaltech — GC Jennifer: ContractPodAI vs Ironclad vs Sirion vs Icertis
6. r/legaltech — "I built a CLM tool — looking for marketing advice"
7/8. r/procurement — "CLM systems that actually work, AI that moves the needle" (EU Fintech, MCP-aware buyer)
9. r/smallbusiness — "Contract lifecycle management for a 2-person studio"
10. r/legaltech — "Build vs. Buy for CLM — we tried vendor, thinking about building in-house"

---

## Key insights (prioritized)

### 1. Metadata is 95% of the value — not the interface
> "The value of any CLM is the file metadata. That's 95% of the value."

AI extraction → human review → structured metadata is the right architecture. Lead with this in marketing, not the editor. The editor is a nice-to-have; metadata is the product.

**How to apply:** Feature AI extraction prominently on landing page and demos. "Your contracts, automatically understood."

### 2. BYOK + self-hosting kills the #1 enterprise security objection
> "I'm using OpenAI API but I will change that — it's not safe for confidential data."
> "Security is the first thing procurement and IT will ask about."

No competitor offers self-hosting. ClauseFlow's BYOK + Ollama = contracts never leave your infrastructure. This is the answer to enterprise's #1 objection before it's even raised.

**How to apply:** Make "Your data never leaves your infrastructure" the lead positioning pillar for open source. Explicitly position against SaaS CLMs that send your contracts to third-party AI.

### 3. Contract Q&A across the portfolio is a dream feature nobody has
> "The best AI feature is chatting with data across all contracts and identifying problematic clauses." (describing Ivalua as premium feature)

ClauseFlow already has this (M3 — RAG citations). No competitor offers it. This should be the hero demo feature, not buried.

**How to apply:** Lead every demo with "Ask any question across your entire contract portfolio." This is unique. Shout it.

### 4. Renewal management is broken even in paid tools — we do it better
> "Gatekeeper renewal management is absolute dogshit. Manual date calculation, spits out a zillion email notifications, easy to miss renewals."

ClauseFlow has renewal alerts built (M1). Gatekeeper customers are paying for broken renewal management. Direct positioning opportunity.

**How to apply:** Explicitly position against Gatekeeper on renewal management. "Renewal alerts that actually work — not 20 emails a day."

### 5. Ecosystem integration wins deals
> "Summize — native integrations to Salesforce, Slack, Outlook, Gmail, Teams. Anyone in Sales, Legal, Procurement, Finance can self-serve without leaving the tools they already use."

This was the most compelling reason people chose a specific tool. It's not about features — it's about meeting users where they already work.

**How to apply:** M6 (ecosystem notifications) and M8 (CRM) are revenue-critical milestones, not nice-to-haves. Positioning: "ClauseFlow meets you where you already work."

### 6. Lawyers don't trust CLM workflows — they want Word
> "No lawyer ever trusts [clause approval workflows]. Let lawyers use MS Word track changes the way they want."

The browser-native editor (M5) is NOT for legal counsel doing redlines. It's for ops teams creating contracts from templates. Lawyers will want Word round-trip.

**How to apply:** M5 editor targets ops/sales users drafting from templates. Word import/export should be in M5 scope. Redlining (M10) stays deferred — lawyers will use Word for that anyway.

### 7. Ironclad is beatable and replaceable
> "Our firm just replaced Ironclad with a vibe coded tool."

Ironclad is the default recommendation but not beloved. UX and simplicity can beat brand recognition.

**How to apply:** Ironclad is a direct competitor to position against. Their weakness: complex, heavy, expensive. Our angle: open source, simple, BYOK.

### 8. The real buying trigger is chaos + missed renewals
Every thread starts the same way: contracts scattered across email/Notion/Slack/Drive + missed renewals + no audit trail. This is the pain. The solution they want is simple: one place + renewal reminders + who approved what.

**How to apply:** Lead with the pain in all marketing copy. "Stop losing contracts. Stop missing renewals. Stop wondering who approved what."

### 9. Small teams are underserved
Thread 2 shows 6-person teams avoiding CLMs because they feel like overkill. Lightweight tools (Agrello, License Logic) win here. ClauseFlow's free self-hosted tier + simple UX can own this segment.

**How to apply:** Free self-hosted tier is a genuine acquisition channel. Don't price small teams out.

### 10. Selling to legal is hard — warm network is the path
> "Every single paying user is a former colleague."
> "Legal buyers are extremely risk averse. Legal team budgets are minuscule compared to other departments."

**How to apply:** Open source launch strategy (LinkedIn + communities + developer network) is the right go-to-market. Don't do cold outreach. Let the community come to us.

---

## Competitor notes from these threads

| Tool | Mentioned for | Sentiment |
|---|---|---|
| Ironclad | Workflow, integration | Mixed — beatable |
| Gatekeeper | Metadata, org | Renewal management "dogshit" |
| Ivalua | AI, S2P suite | Positive for enterprise |
| Summize | Ecosystem integrations | Very positive |
| Icertis | SAP orgs, enterprise | "Do not recommend" (one user) |
| ContractPodAI | AI | $3k for custom clause — hard no |
| Ariba | S2P suite | Positive but enterprise-only |
| Zycus | Procurement | "Dogshit, support worse" |
| Malbek | Mid-market | Positive (Salesforce integration) |
| Agrello | Small teams | Positive for lightweight use |

---

## What this adds to the roadmap (updated 2026-05-09 after full 10-thread re-read)

### Roadmap order changes confirmed:
- **M5 = Ecosystem Notifications** (was Authoring) — ecosystem wins deals, Summize model confirmed
- **M6 = Authoring** (was Notifications) — editor is table stakes, not differentiator
- **M7 = Obligation Tracking** (moved up from M9) — becoming table stakes, indie builders already shipping it
- **M8 = Analytics** (was M7)
- **M9 = CRM** (was M8)
- **Outlook + Gmail added to M5 scope** — the Summize model that wins deals includes all of: Slack, Teams, Outlook, Gmail, Salesforce

### New positioning angles from threads 6–10:
- **Build-vs-Buy GTM channel** (Thread 10): frustrated SharePoint/PowerApps builders are actively searching for alternatives — ClauseFlow is the pre-built open source answer
- **MCP/agent-ready positioning** (Thread 7/8): a buyer segment that knows MCPs, vibe coding, agents exists and has zero CLM vendor speaking their language — our MCP server is already built
- **Per-contract pricing pain** (Thread 1): competitors charge per-contract for storage — self-hosted ClauseFlow has zero per-contract pricing
- **Small team segment** (Thread 9, 179 upvotes): 2-10 person teams are deeply underserved — free self-hosted tier captures this

### Confirmed from new threads:
- **BYOK/self-hosting kills #1 security objection** — builder in Thread 6 says "OpenAI API is not safe for confidential data" — self-hosting is the answer without needing ISO 27001
- **Warm network is the only GTM path** (Thread 6): "every single paying user is a former colleague" — LinkedIn + dev community is correct, cold outreach is waste
- **Ironclad is beatable** (Thread 6): "our firm just replaced Ironclad with a vibe coded tool"
- **Word import/export** in M6 scope (lawyers want Word)

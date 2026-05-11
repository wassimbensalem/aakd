# ClauseFlow — Agent Roadmap Research
> Compiled: 2026-05-10
> Sources: YC legaltech list, goHeather, Pramata, ChatFin, Sirion, Dioptra, Spellbook, Common Paper, LegalOn, Gatekeeper, Tonkean, Agentman, V7 Go
> Related file: research/icp-pain-points-agent-opportunities.md

---

## The core finding

The contract AI market has split into two camps with a gap in the middle:

| Camp | Who | Price | Serves |
|---|---|---|---|
| Enterprise CLM | Ironclad, Icertis, Agiloft, Sirion | Custom $$$$ | Large companies with dedicated legal teams |
| Lawyer tools | Spellbook, LegalOn (~$350/user/mo), Luminance | $$$ | Lawyers and in-house counsel |
| **The gap** | Almost nobody | — | Founders, sales, ops, finance — non-lawyers at SMBs |

**goHeather** ($99/mo) tries to bridge this but is still positioned for small legal teams.
**Common Paper** (YC W2023) standardizes outgoing startup contracts but doesn't review incoming ones.
**Nobody is building agents for the non-lawyer business operator.** That is ClauseFlow's lane.

---

## Competitive landscape

| Tool | ICP | Price | What they do | Gap they leave |
|---|---|---|---|---|
| **LegalOn** | In-house legal | ~$350/user/mo | Contract review in Word, legal playbook | Legal teams only, no SMB non-lawyer |
| **Spellbook** | Transactional lawyers | ~$350/user/mo | AI drafting + review in Word | Lawyers only |
| **Ironclad** | Enterprise legal | Custom $$$$ | Full CLM platform | Too expensive, legal-team-only |
| **Lexion** | Cross-functional | Mid-market | Auto-extracts terms, search, alerts | Still leans legal, not ops/sales/finance |
| **Docsum** (YC S2023) | Legal + finance | Unknown | Contract intelligence, renewal alerts | Early stage, small team |
| **Common Paper** (YC W2023) | Startups (seller) | Low/free | Standardized open-source contracts | Only outgoing paper, not incoming review |
| **Ontra** | Private equity | Enterprise | NDA automation for deal flow | PE-specific, not general SMB |
| **Pramata** | Enterprise procurement | Custom | Vendor contract management | Enterprise only |
| **goHeather** | Small legal teams | $99/mo | Democratizing AI review | Still for legal, not ops/sales/finance |
| **Dioptra** | Legal teams | Unknown | Bulk NDA review, 97% accuracy | Legal audience, not non-lawyers |
| **Gatekeeper** | Mid-market ops/legal | Mid-market | Renewal alerts, compliance monitoring | Mid-market+ only |
| **Tonkean** | Enterprise ops | Enterprise | Procurement + legal agent workflows | Enterprise only |

---

## The 5 agents — full specs

### Agent 1 — "Never get surprised"
**ICP:** Finance controller · Procurement manager · Ops lead
**When to build:** First — lowest complexity, infrastructure already exists, biggest validated pain

#### The problem
Contracts auto-renew silently. A $50K SaaS tool nobody uses renews for another year.
A vendor auto-renews at a 15% price increase. Nobody knew until the invoice landed.

#### Hard numbers (sourced)
- Average annual loss from unwanted auto-renewals: **$2.3M** per organization (Sirion)
- **88%** of businesses struggle with renewal management
- **8.6–9%** of total contract value leaks from poor post-execution management
- Organizations save **15–25%** on renewed contracts when renegotiating proactively vs. auto-renewing (Gatekeeper)

#### What the agent does
1. Monitors all contracts in the repository continuously
2. **90 days before renewal:** alert + recommendation (renew / renegotiate / cancel) with reasoning from contract terms
3. **30 days out:** drafts the renewal notice or cancellation letter, ready to send with one click
4. Flags contracts where vendor has both auto-renewal + price escalation clauses (double risk)
5. Weekly digest: "3 contracts renewing in the next 90 days — here's what to do"

#### Competitive gap
Gatekeeper, Tonkean, Sirion do this for enterprise. Tropic does it for SaaS spend only.
**Zero tools serve the ops lead at a 50-person company managing mixed vendor contracts.**

#### Build complexity: VERY LOW
ClauseFlow already has: renewal date extraction (M1), alerts system (M1), obligation tracking (M7), email notifications (M5). This is mostly orchestration + a drafting step on existing infrastructure.

---

### Agent 2 — "What am I signing?"
**ICP:** Founder / CEO · Early-stage startup · Anyone signing without a lawyer
**When to build:** Second — clearest gap, no direct competitor, low complexity

#### The problem
Founder gets a contract from a partner, investor, or vendor. Not a lawyer.
Outside counsel costs $400/hr for a 30-minute review call.
They need to know: is this normal? What's the risk? What should I push back on?

#### What the agent does
1. Upload any contract (PDF or DOCX)
2. Returns in plain English:
   - **Summary:** what this contract actually says in 5 bullet points
   - **Top risks:** the 3–5 things that could hurt you, explained in plain language
   - **Non-standard flags:** anything unusual vs. market norms for this contract type
   - **Risk score:** low / medium / high overall
   - **Suggested questions:** what to ask the counterparty before signing
3. No legal training required. Jargon-free output.

#### Competitive gap
- Clerky (YC S2011): proved founders pay for legal help on formation docs
- Common Paper (YC W2023): proved startups want pre-approved standard contracts (63% close in 24hrs)
- **Zero tools review incoming third-party contracts for non-lawyer founders.** Uncontested ground.

#### Build complexity: LOW
Extraction + Q&A + clause identification already exists from M1–M3. Output needs to be
reframed for non-lawyers (plain English, not legal analysis format).

---

### Agent 3 — "What are we on the hook for?"
**ICP:** Ops manager · Chief of Staff · Anyone who owns "everything else"
**When to build:** Third — M7 infrastructure already there, just needs AI extraction front-end

#### The problem
Obligations across vendor contracts live in a folder somewhere.
SLA commitments. Reporting deadlines. Exclusivity windows. Notice periods. IP assignments.
Something always slips. The ops lead finds out when it's already a problem.

#### What the agent does
1. Ingests all contracts in the repository
2. Extracts every obligation:
   - Payment dates and amounts
   - SLA commitments (uptime, response time, delivery windows)
   - Reporting deadlines (monthly reports, audits, certifications)
   - Exclusivity windows (can't use a competitor for X months)
   - Notice requirements (must give 90 days notice to cancel)
   - IP assignments and licensing restrictions
3. Builds a live obligations dashboard: obligation → owner → due date → status → risk level
4. Sends proactive nudges as obligations approach (7 days out, 1 day out)
5. Flags conflicts across contracts (two vendors with exclusivity in the same category)

#### Competitive gap
Agiloft launched AI obligation management in Dec 2025. Sirion has it. Both enterprise only.
**No affordable equivalent for lean ops teams at SMBs.**

#### Build complexity: LOW
M7 already built ContractObligation model, CRUD API, daily cron for overdue, reminder notifications.
Agent is the AI extraction front-end on existing infrastructure — the hard part is already done.

---

### Agent 4 — "Unblock my deal"
**ICP:** Sales rep / AE · RevOps · Sales manager
**When to build:** Fourth — biggest business impact, needs playbook config + CRM integration

#### The problem
Sales sends an NDA or MSA to a prospect. It goes into legal's queue.
Legal queue is 3 days. Deal goes cold. Sales hates legal. Legal hates being called a bottleneck. Both are right.

#### What the agent does
1. Incoming customer NDA or MSA triggers the agent (via CRM webhook or email)
2. Agent reviews against pre-configured playbook (your standard acceptable terms)
3. **Clean (80% of cases):** auto-approve, push to DocuSeal for signature immediately
4. **Issues (20% of cases):** flag exact clause, suggest redline in plain language, escalate only exceptions to human
5. Legal only reviews the exceptions. Sales doesn't wait for the routine ones.
6. Full audit trail of every decision for compliance

#### Validated benchmarks (sourced)
- Demandbase: NDA review 2–3 days → **1–2 hours** with AI
- V7 Go: full NDA redline generated in **60 seconds**
- Sirion: **60% faster** contract review cycles across their customer base
- 71% of in-house teams cite version control and redlining as their highest-friction task

#### ClauseFlow unique angle
CRM integrations already exist (HubSpot, Salesforce, Pipedrive from M9).
An agent sitting inside the CRM deal flow — contract submitted from CRM, reviewed, approved or redlined, pushed back to CRM — is a closed loop no competitor offers at this price point for SMBs.

#### Build complexity: MEDIUM
Needs: playbook configuration UI (what terms are acceptable), CRM webhook to trigger on new contract,
DocuSeal integration for auto-send (already exists from M2). The AI review part is existing infrastructure.

---

### Agent 5 — "Is their paper acceptable?"
**ICP:** Procurement manager · Ops lead · Anyone who receives vendor contracts
**When to build:** Fifth — highest per-use value, needs playbook engine built first (shared with Agent 4)

#### The problem
Vendor sends their own contract (their terms, not yours).
Procurement needs to know: is this standard? What are they trying to sneak in?
Routing to legal takes a week. Signing without reviewing is a risk.

#### 2025-specific risks appearing in vendor contracts right now (sourced: Morgan Lewis, Bird & Bird)
- Broad vendor rights to use customer data for AI model training (unless contract says otherwise)
- Liability disclaimers for AI-generated outputs
- IP ownership of AI outputs buried in boilerplate
- Monitoring obligations falling on the buyer, not the vendor
- Restrictions on how AI-generated outputs can be used or disclosed

#### What the agent does
1. Upload vendor's contract (PDF or DOCX)
2. Compares every clause against your configured standard terms / approved playbook
3. Flags deviations with risk score: low / medium / high
4. For each flag: explains the risk in plain language + suggests counter-language
5. Produces a one-page summary: **accept as-is / push back on these 3 things / escalate to legal**
6. Procurement decides in minutes instead of waiting a week

#### Competitive gap
Pramata does this for enterprise procurement. Spellbook does it for lawyers.
**No affordable option for the procurement manager at a 100-person company.**

#### Build complexity: MEDIUM
Needs: playbook comparison engine + structured redline output.
Extraction infrastructure exists. Playbook engine shared with Agent 4 (build once, use for both).

---

## Build order summary

| # | Agent | ICP | Complexity | Why this order |
|---|---|---|---|---|
| 1 | "Never get surprised" | Finance / Procurement | Very Low | Existing infra, $2.3M pain, clearest ROI |
| 2 | "What am I signing?" | Founder / CEO | Low | No competitor, existing Q&A infra |
| 3 | "What are we on the hook for?" | Ops / CoS | Low | M7 infra already there |
| 4 | "Unblock my deal" | Sales / RevOps | Medium | Biggest impact, needs playbook UI |
| 5 | "Is their paper acceptable?" | Procurement | Medium | Shares playbook engine with Agent 4 |

---

## Pricing model recommendation

### Outcome-based (preferred — Service as a Software)
- Per contract reviewed: **$5–15**
- Per renewal caught / actioned: **$10–20**
- Per obligation dashboard (per month): **$30–50**

### Flat monthly per agent (alternative)
- Each agent: **$49–149/month**
- Bundle (all 5): **$299–499/month**

### Why not per-seat?
Per-seat pricing made sense when you sold software. Agents do work.
Price them like the work they replace: compare to $400/hr outside counsel, not to $30/seat SaaS.

### Competitor context
- goHeather: $99/month for the whole platform (underpriced for what it does)
- LegalOn / Spellbook: ~$350/user/month (for lawyers, not our audience)
- At $5–15/contract for non-lawyers, ClauseFlow looks like a steal vs. any alternative

---

## Phase 2 — legal team agents (keep on map, build later)

Once the platform has traction with business operators, legal teams will appear as users.
At that point, build:

**First-pass contract review for lawyers**
Review incoming third-party paper against legal playbook. Produce redline-ready summary.
Saves lawyers time on routine work so they focus on judgment. (This is what Spellbook/LegalOn do — but you'll have cheaper pricing and better integration.)

**Compliance evidence collection agent**
Pull evidence from connected systems (contracts, obligations, activities), assemble audit-ready reports.
Replaces 60–70% of compliance cycle time currently spent on manual evidence gathering. (Sourced: Agentman)

---

## What's still unknown — needs validation

- [ ] Would a founder pay $5–15/contract for the "what am I signing?" agent? Or do they expect this free?
- [ ] Does sales / RevOps have budget authority to buy this, or does it need to go through legal/ops?
- [ ] What does "playbook configuration" look like for a non-technical procurement manager? (UX risk)
- [ ] On-premise agent demand: how many self-hosters specifically need agents that don't leave their infra?
- [ ] Competitive timing: Docsum (YC S2023) is 4 people — are they moving fast toward this gap?

---

## Sources

- [YC Legaltech Companies](https://www.ycombinator.com/companies/industry/legaltech)
- [goHeather — Best AI Contract Review Tools 2026](https://www.goheather.io/post/the-9-best-ai-contract-review-tools-for-2026)
- [Pramata — AI for Procurement](https://www.pramata.com/roles/procurement/)
- [ChatFin — Contract Obligation Tracking for Finance 2026](https://chatfin.ai/blog/contract-obligation-tracking-best-ai-tools-for-finance-operations-2026/)
- [Sirion — Renewal & Expiration Management](https://www.sirion.ai/library/contract-insights/contract-renewal-and-expiration-management-with-ai/)
- [Sirion — 9% Contract Value Leakage](https://www.sirion.ai/library/contract-insights/closing-contract-value-leakage-gap-ai-native-clm/)
- [Tonkean — AI Contract Renewal Agent](https://www.tonkean.com/usecases/ai-contract-renewal-agent)
- [Dioptra — Automated NDA Review](https://www.dioptra.ai/resources/best-automated-contract-review-for-bulk-ndas-dioptra-vs-competitors-2025)
- [Agentman — Agent Skills for Legal Teams](https://agentman.ai/blog/agent-skills-legal-teams-contract-review-compliance)
- [V7 Go — AI NDA Processing Agent](https://www.v7labs.com/agents/ai-nda-processing-agent)
- [Morgan Lewis — AI Vendor Contract Risks 2026](https://www.morganlewis.com/blogs/sourcingatmorganlewis/2026/04/negotiating-ai-provisions-in-commercial-and-technology-contracts-where-the-market-is-heading)
- [Spellbook — Vendor Contract Review](https://spellbook.com/learn/review-vendor-contract-using-ai)
- [Legal On Tech — Best AI Contract Review Tools](https://www.legalontech.com/post/best-ai-contract-review-tools)

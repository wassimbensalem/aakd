---
name: ClauseFlow — Finalized Milestone Plan
description: Full roadmap split into Open Source track (ship first) and Cloud/SaaS track (after solid open source product). Agreed 2026-05-09.
type: project
---

## Strategy (locked)

**Open Core + Cloud — sequential, not parallel.**

1. Build complete, solid open source product (M4–M10)
2. Open source launch (LinkedIn + communities, BYOK self-hosters)
3. Then build clauseflow.com hosted product (C1–C5)

**Why sequential:** Wassim wants a solid product before launching the hosted SaaS. Community + credibility first, then monetize.

---

## Track 1 — Open Source Core

What every self-hoster gets. All features, BYOK, AGPL-3.0.

| Milestone | Name | Scope |
|---|---|---|
| M4 | Launch Prep ✅ | Self-hosting docs, API reference, v1.0.0 tag + changelog |
| M5 | Ecosystem: Notifications | Full Slack/Teams/Outlook/Gmail event coverage (approvals, signing, expiry), user-configurable outbound webhooks, Zapier/Make connector |
| M6 | Authoring | Browser-native contract editor + template library, Word import/export |
| M7 | Obligation Tracking | Post-signature deliverables, SLAs, milestones, pass/fail status |
| M8 | Analytics | Portfolio dashboard — KPIs, renewal timeline, status breakdown, contract health |
| M9 | Ecosystem: CRM | HubSpot, Salesforce, Pipedrive — link contracts to deals, auto-create from CRM |
| M10 | Redlining | Tracked changes, version comparison |
| 🚀 | **Open Source Launch** | Publish repo publicly, LinkedIn, developer communities |

**Ordering rationale (2026-05-09 Reddit research):**
- Ecosystem (notifications + CRM) wins deals — confirmed by Summize case study (Thread 4/5): "native integrations to Salesforce, Slack, Outlook, Gmail, Teams — anyone self-serves without leaving their tools"
- Editor is table stakes but "nice-to-have" — metadata is 95% of the value (Thread 2)
- Obligations moved before Analytics: becoming table stakes, competitors already shipping it (Thread 6 indie builder)
- Outlook + Gmail added to M5 scope: the full Summize model requires it

**Note on M10:** Redlining is complex and not ICP-critical. May defer to post-launch v1.1 — confirm with Wassim before starting M10.

### What's already built (no re-build)
- Slack webhook: renewal alerts only — needs expansion in M5
- Teams webhook: renewal alerts only — needs expansion in M5
- Email: Nodemailer, approval + invitation — foundation for more in M5
- DocuSeal: signing + callback webhook ✅
- API + API keys ✅
- MCP server ✅

---

## Track 2 — Cloud / Hosted SaaS (clauseflow.com)

Starts AFTER open source launch. This is the monetization engine.

| Milestone | Name | Scope |
|---|---|---|
| C1 | Cloud Infra | Multi-tenant deployment, clauseflow.com, env isolation per org |
| C2 | Billing | Stripe subscriptions, plan enforcement, usage tracking, upgrade/downgrade |
| C3 | Managed AI | We host Anthropic/OpenAI keys, usage metering, per-org quotas |
| C4 | AI Agents | Renewal Agent, Review Agent, Intake Agent (cloud-only, powered by managed AI) |
| C5 | Enterprise | SSO/SAML (Okta, Azure AD), Google Drive/SharePoint import, dedicated infra, commercial license (AGPL escape) |

### AI Agents (C4 detail)
| Agent | What it does |
|---|---|
| Renewal Agent | Monitors portfolio proactively, alerts before deals expire, suggests action |
| Review Agent | Reviews contracts against playbook, flags deviations, suggests edits |
| Intake Agent | Chat/form interface — "I need an NDA with Acme" → drafts + routes for approval |

### Pricing model (locked)
- Free: Self-hosted, full core, BYOK
- Cloud: ~$19–39/user/mo (inspired by Fynk's transparent pricing)
- AI Add-on: Managed AI usage-based or bundled
- Enterprise: SSO/SAML, advanced analytics, commercial license

---

## ICP (locked)
- Primary: Legal ops / ops leads at 20–200 person B2B SaaS, managing contracts in Google Drive + Notion + email
- Secondary: Sales ops / RevOps (NDAs, MSAs blocking deals)

---

## ClauseFlow Unique Advantages (no competitor has these)
1. Self-hostable
2. BYOK + open weights (Ollama)
3. Contract Q&A with RAG citations
4. MCP server

## Feature Gaps vs Competitors (as of 2026-05-09)
- Table stakes missing: contract editor, template library (→ M5)
- Ecosystem missing: full Slack/Teams, webhooks, CRM (→ M6, M8)
- Analytics missing (→ M7)
- Obligations missing (→ M9)
- Redlining missing (→ M10, maybe post-launch)

## Competitors researched
Juro, Fynk, SpotDraft, HyperStart, ContractSafe — full matrix in session-handoff.md
Design inspiration: Fynk (UI/UX — clean, white bg, orange+blue gradient, sans-serif)

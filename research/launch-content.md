# Aaked — Launch Content
> Ready-to-paste copy for each channel. Written using real Reddit pain quotes as source material.
> Dates are approximate — adjust to actual launch day.

---

## 1. Show HN — Main OSS Launch

**Title:**
```
Show HN: Aaked – open-source contract lifecycle management with self-hosted AI
```

**Body:**
```
I built Aaked because I kept seeing the same thing on Reddit: people losing hundreds of dollars a month to auto-renewals buried in contracts they'd signed and forgotten, or spending 97 days watching a deal stall in legal.

The existing CLM tools are priced for enterprise. DocuSign Insight starts at $X00/seat/month. Everything else is either a spreadsheet or a $50k/year platform. There was nothing self-hostable, open source, or remotely affordable for smaller teams.

What Aaked does:
- Contract repository with full-text + semantic (pgvector) search
- AI metadata extraction: parties, dates, renewal clauses, obligations — extracted from PDF/DOCX with source citations and confidence scores
- Renewal tracking with email/Slack/Teams alerts before deadlines
- Approval workflows + e-signatures via DocuSeal (intentional: I didn't build signing from scratch)
- Contract Q&A: ask questions about any contract, get answers grounded in the actual text
- Obligation tracking: sub-tasks, due dates, auto-overdue detection
- MCP server: your AI agents (Claude, Cursor) can read and query contracts directly
- Multi-tenant from day one: every query is org-scoped, no data bleeds between orgs
- Full i18n: EN / FR / DE / ES / AR (RTL)

Stack: Next.js 14 App Router, TypeScript, Tailwind, Prisma, PostgreSQL + pgvector, BullMQ + Redis, Better Auth, S3-compatible storage.

Self-host with Docker in 5 minutes: docker-compose up

Live hosted version if you want to try it without the infra: https://web-wassimbensalems-projects.vercel.app

What I intentionally did NOT build:
- Signing from scratch (DocuSeal handles this better than I could)
- A contract editor (v2)
- A negotiation portal (v3)
- Anything requiring a lawyer to operate

The AI extraction never auto-populates fields. Every AI result goes through a human review queue first. The confidence score and source quote are always shown — you decide what to trust.

Repo: https://github.com/aaked-app/aakd
License: AGPL-3.0

Happy to answer questions about the stack, the self-hosting setup, or the AI extraction approach.
```

---

## 2. Show HN — MCP Angle (Week 3, after main launch settles)

**Title:**
```
Show HN: We added MCP to our open-source CLM so Claude/Cursor can query your contracts
```

**Body:**
```
Three weeks ago I posted Aaked, an open-source CLM. The most surprising feedback was how many people wanted to connect their contracts to Claude or Cursor.

So I added an MCP server.

What it does: your AI assistant can now call into Aaked and answer questions about any contract in your organization.

Real examples from testing:
- "What does our vendor contract with Acme say about SLA penalties?" → answer grounded in the actual contract text, with the exact clause cited
- "Which of our contracts auto-renew before December?" → pulls all contracts with renewal clauses before that date
- "What are the outstanding obligations for the Stripe agreement?" → lists open tasks with due dates

The MCP endpoint is part of the self-hosted stack — no data leaves your infrastructure.

Three reasons I think this matters:
1. Contracts are the canonical source of truth for commitments, but they sit in a folder nobody opens
2. LLMs are good at reading contracts but bad at knowing which contracts exist or which clauses are relevant
3. Connecting the two with MCP means you can ask in natural language and get an answer rooted in the actual signed document — not hallucinated

Setup: add the MCP endpoint to your Claude/Cursor config, authenticate with an API key, and your AI assistant can see your contracts.

Repo: https://github.com/aaked-app/aakd
Docs: [link to MCP docs section]

The main HN post for context: [link to first Show HN]

Curious if others have built similar things — document stores connected to LLMs via MCP. What's worked?
```

---

## 3. LinkedIn Launch Post

**Option A — Pain-first (recommended)**
```
A business owner posted on Reddit that his waste management contract started at $160/month.

Then 20% increases every year.

By the time he noticed, he was paying $450/month. A competitor quoted him $140.

"The contract was designed so I couldn't notice."

401 people upvoted that post. Not because it was unique — because everyone recognized it.

I spent the last several months building Aaked to solve exactly this.

Aaked is an open-source contract management platform with self-hosted AI. It tracks renewal dates, extracts key terms automatically, and alerts you before deadlines — so you don't find out you're paying $450 after you've already been paying $450 for a year.

It's built for teams that can't afford $50k/year enterprise CLM tools and don't trust their Google Drive folder to protect them.

Open source. Self-hostable in 5 minutes with Docker.

→ GitHub: github.com/aaked-app/aakd
→ Try the hosted version: https://web-wassimbensalems-projects.vercel.app

If contract sprawl is eating your company quietly, this is for you.
```

**Option B — Build-in-public angle**
```
I shipped something today that I've been building for a few months.

It's called Aaked — open-source contract lifecycle management.

The honest version of what I was seeing:

A r/sales post with 4,270 upvotes about a deal that "sat at legal" for 97 days. A r/smallbusiness post about an auto-renewal trap — $160 → $450/month, "designed so I couldn't notice." A design studio owner on Reddit saying their contract questions get answered by "digging through old inbox threads, Slack messages, and random attachments."

These aren't edge cases. They're the default.

Existing CLM tools are built for GC offices and enterprise procurement teams. Nothing was built for the people actually signing contracts: founders, ops leads, small business owners — people who don't have a legal team to call.

So I built it.

What's in the box:
✓ Contract repository with AI-powered search (pgvector)
✓ Automatic extraction: parties, dates, renewal clauses, obligations
✓ Deadline alerts before you need them
✓ Contract Q&A — ask any question, get an answer from the actual text
✓ E-signatures via DocuSeal
✓ MCP server — ask Claude or Cursor about any contract
✓ Full multi-tenant from day one
✓ Internationalized: EN / FR / DE / ES / AR

Self-hostable with Docker. Full source on GitHub (AGPL).

I'm doing this in public. Here's what I know so far: the problem is real, the incumbents are too expensive, and there's a gap between "spreadsheet + calendar reminder" and "$50,000/year."

I'm trying to fill it.

→ github.com/aaked-app/aakd
→ Try it: https://web-wassimbensalems-projects.vercel.app

If you've ever gotten burned by a contract clause you didn't notice — this is for you.
```

---

## 4. GitHub Discussions Pinned Threads (set up on launch day)

### Thread 1: Roadmap
**Title:** Aaked Roadmap — vote on what we build next

```
Here's where we stand and what's coming.

**Shipped (open source)**
- Contract repository + CRUD
- AI metadata extraction (Claude / OpenAI / Ollama)
- Renewal tracking + alerts (email, Slack, Teams, webhooks)
- Approval workflows
- E-signatures (DocuSeal)
- Contract Q&A (RAG over your contracts)
- Obligation tracking
- Analytics dashboard
- CRM integrations (HubSpot, Salesforce, Pipedrive)
- Migration tools (PandaDoc, ContractBook, DocuSign CLM, Google Drive, CSV)
- Internationalization (EN/FR/DE/ES/AR)
- MCP server

**In progress**
- Tracked changes / redlining (M12)

**Considering next**
- Counterparty negotiation portal
- Browser-native contract editor
- Template & clause library
- AI redlining with playbook enforcement

Vote by reacting 👍 to this post, or reply with what you need most. What's blocking you?
```

### Thread 2: Self-hosting Help
**Title:** Self-hosting Aaked — ask your setup questions here

```
Running Aaked on your own infrastructure? This is the right place.

Quick start:
git clone https://github.com/aaked-app/aakd
cp .env.example .env
# fill in your DATABASE_URL, BETTER_AUTH_SECRET, STORAGE_*, REDIS_URL
docker-compose up

The app runs without AI and email configured — those features degrade gracefully.

Common questions:
- **Storage**: any S3-compatible provider works (AWS S3, Cloudflare R2, MinIO). Set STORAGE_ENDPOINT empty for AWS, or to your MinIO/R2 URL.
- **AI**: set ANTHROPIC_API_KEY for extraction, OPENAI_API_KEY for embeddings. Or use Ollama for fully local AI.
- **Email**: Nodemailer-compatible. Any SMTP works.

Reply here with what you're running on and any issues you hit. We'll build a self-hosting FAQ from the real questions.
```

### Thread 3: Show & Tell
**Title:** Show & tell — what are you building with Aaked?

```
Using Aaked for something interesting? Self-hosting it in a weird place? Connected it to your stack in a way we didn't expect?

Share it here.

We'll feature the best setups in the README. Anonymized if you prefer.

This is also the right place to share screenshots, demos, or integrations.
```

---

## 5. Copy Snippets (for DMs, replies, cold outreach)

**One-liner:**
> Aaked is open-source contract management with self-hosted AI — renewal alerts, AI extraction, contract Q&A, and an MCP server so Claude can read your contracts directly. Five-minute Docker deploy.

**When someone says "we use spreadsheets":**
> That works until it doesn't — usually right before a renewal you missed or a clause that auto-committed you to something. Aaked sits on top of your existing files and adds extraction, alerts, and search. It's open source, self-hostable, and free if you run your own infra.

**When someone asks "how is this different from DocuSign?":**
> DocuSign manages the signing ceremony. Aaked manages everything that happens before and after — tracking, extraction, alerts, Q&A, and obligations. It integrates with DocuSeal for signing rather than trying to compete with DocuSign on e-signature.

**When a developer asks about the stack:**
> Next.js 14 App Router, TypeScript, Prisma + PostgreSQL with pgvector for semantic search, BullMQ + Redis for background jobs, Better Auth, S3-compatible storage, Docker for self-hosting. AGPL-3.0.

---

*All Reddit quotes are verbatim from public posts. Sources documented in `research/reddit-community-voice.md`.*

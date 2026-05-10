# ClauseFlow — CLAUDE.md
> Single source of truth for every agent and developer working in this repo.
> Read this fully before touching any code.

---

## What this is

ClauseFlow is an **open source, self-hostable Contract Lifecycle Management (CLM) platform**.
Stack: Next.js 14 App Router · TypeScript · Tailwind CSS · Prisma · PostgreSQL + pgvector · Better Auth · BullMQ + Redis · S3-compatible storage (MinIO / AWS S3).

---

## Locked decisions — do not revisit

| Decision | Choice |
|---|---|
| Framework | Next.js 14 App Router — no Pages Router |
| Auth | Better Auth (email/password + org plugin) — not NextAuth, not Clerk |
| Database | PostgreSQL 16 + pgvector extension |
| ORM | Prisma — with org-scope middleware (see below) |
| Background jobs | BullMQ + Redis — no inline async hacks |
| File storage | S3-compatible via abstracted client — never import AWS SDK directly |
| Styling | Tailwind CSS only — no CSS modules, no styled-components |
| E-signature | DocuSeal API integration — never build signing from scratch |
| AI extraction | Anthropic Claude (default) — via ExtractionProvider abstraction |
| AI embeddings | OpenAI text-embedding-3-small (cloud) / Ollama 1536-dim embedding model such as mxbai-embed-large (self-host) — via EmbeddingProvider abstraction |
| Embedding dimension | Fixed at 1536 — never change this without a migration plan |
| License | AGPL-3.0 |

---

## Project structure

```
apps/
  web/                        # Next.js app
    app/
      (auth)/                 # login, register — public routes
      (app)/                  # authenticated routes — all require session or API key
        dashboard/
        contracts/
        contracts/[id]/
        settings/
          api-keys/           # API key management UI
      api/
        contracts/            # contract CRUD
        org/                  # org settings, members, api-keys
        search/               # full-text + semantic search
        alerts/               # renewal alerts
        webhooks/             # DocuSeal / Documenso callbacks
        mcp/                  # MCP server endpoint
    components/               # shared React components
    lib/
      auth/                   # resolveAuth() — two-path: session + Bearer
      db/                     # Prisma client + org-scope middleware
      storage/                # S3-compatible storage client
      ai/                     # provider abstraction (ExtractionProvider, EmbeddingProvider)
      jobs/                   # BullMQ queue definitions + job handlers
      email/                  # Nodemailer email sender
    prisma/
      schema.prisma
      migrations/
packages/
  ai/                         # ExtractionProvider + EmbeddingProvider interfaces + implementations
  storage/                    # S3 client abstraction
  email/                      # email templates + sender
worker/                       # BullMQ worker process (standalone Node.js)
docker-compose.yml            # self-hosting entrypoint
docker-compose.dev.yml        # dev overrides
.env.example                  # all env vars documented
```

---

## Multi-tenancy — the most important rule

**Every database query MUST be org-scoped.** This is enforced via Prisma middleware — not per-route manually.

```typescript
// lib/db/middleware.ts — this runs on EVERY query automatically
// organizationId is injected from AsyncLocalStorage (set by resolveAuth)
```

**Never** write a raw Prisma query that fetches contracts, files, activities, tags, folders, or API keys without the middleware being active.

**The isolation test must pass before every M0 merge:**
- Create contract in org A
- Attempt to read it as org B user via API
- Must return 404 (not 403 — don't leak resource existence)

---

## Auth — two paths, one middleware

```typescript
// resolveAuth(req) returns AuthContext | null
// Path 1: Better Auth session cookie (browser users)
// Path 2: Authorization: Bearer cf_live_... (agents + API clients)
```

API keys are scoped to an org. Every agent authenticates with a Bearer token.
API key format: `cf_live_` prefix + 32 random bytes (hex).
Storage: SHA-256 `lookupHash` for fast DB lookup + bcrypt `keyHash` for secure compare.
**Never store raw API keys in the database.**

---

## AI providers — two separate abstractions

```typescript
// ExtractionProvider — answers questions, extracts metadata
//   Implementations: AnthropicExtractor | OpenAIExtractor | OllamaExtractor

// EmbeddingProvider — turns text into vectors
//   Implementations: OpenAIEmbedder | OllamaEmbedder
//   Anthropic has NO embedding model — do not try to use it for embeddings
```

**Every AI output must include:**
- `sourceText`: exact quote from the contract
- `sourcePage`: page number
- `confidence`: 0–1 score
- `extractedBy`: "ai" | "user"

**AI results go into a human review queue first — never auto-populate canonical fields.**

---

## Background jobs (BullMQ)

All async work goes through named queues. Never do heavy work inline in an API route.

| Queue | Purpose |
|---|---|
| `contract.extract` | PDF/DOCX text extraction after upload |
| `contract.embed` | Generate pgvector embeddings after text extraction |
| `contract.ai_extract` | Run AI metadata extraction after embedding |
| `alerts.check` | Daily cron: fire renewal alerts |
| `signing.sync` | Sync DocuSeal signing status |
| `email.send` | Send queued email notifications |

Job handlers live in `worker/` — not in `apps/web/`.

---

## File uploads

- Accept: PDF and DOCX only. Validate by magic bytes, not MIME header.
- Max size: 50 MB per file.
- Storage: always via the abstracted storage client — never import `@aws-sdk` directly in app code.
- After upload: enqueue `contract.extract` job. Never parse inline.
- Security: sanitize filenames. Reject files that cause pdf-parse to throw.

---

## API conventions

- All routes under `(app)/` require auth. Call `resolveAuth(req)` first — return 401 if null.
- Soft-delete only — set `status: ARCHIVED`, never hard-delete contracts.
- Write to the `Activity` table on every contract state change. This is the audit trail.
- Return 404 (not 403) when a resource exists but belongs to another org.
- Validate request bodies with Zod before touching the database.

---

## What NOT to build (v1 scope — do not add these)

These are intentionally deferred to later milestones. Do not implement in M0–M4.

- Tracked changes / redlining → v3
- Counterparty negotiation portal → v3
- Browser-native contract editor → v2
- Template + clause library → v2
- Obligation tracking → v2
- Analytics / reporting dashboard → v2
- Guided contracting / legal playbooks → v3
- AI redlining with playbook enforcement → v3
- SSO / SAML → v4 Enterprise
- CRM-native contract generation (Salesforce/HubSpot CPQ→contract) → v4 Enterprise
- Mobile app → v4 Enterprise

If a task seems to require any of these, stop and ask.

---

## Key commands

```bash
# Development
pnpm dev                    # start Next.js dev server
pnpm worker:dev             # start BullMQ worker in watch mode
pnpm db:migrate             # prisma migrate dev
pnpm db:studio              # prisma studio

# Testing
pnpm test                   # vitest unit + integration
pnpm test:e2e               # playwright e2e
pnpm test:isolation         # org-scope isolation test (must pass before every merge)

# Docker
docker-compose up           # full self-hosted stack
docker-compose -f docker-compose.dev.yml up   # dev with hot reload

# Type checking
pnpm typecheck              # tsc --noEmit across all packages
```

---

## Environment variables

See `.env.example` for the full list. Minimum required to run:
```
DATABASE_URL
BETTER_AUTH_SECRET
BETTER_AUTH_URL
STORAGE_ENDPOINT (empty for AWS S3, set for MinIO)
STORAGE_BUCKET
STORAGE_ACCESS_KEY
STORAGE_SECRET_KEY
REDIS_URL
```

AI and email are optional — the app runs without them (AI features degrade gracefully).

---

## Milestones

### Open Source Track (ship first)

| Milestone | Status | Scope |
|---|---|---|
| M0 — Contract Repository | ✅ Complete | CRUD, upload, RBAC, API keys, Docker |
| M1 — Renewal Tracking | ✅ Complete | AI extraction, alerts, email, full-text + semantic search |
| M2 — Workflow + Signing | ✅ Complete | Approvals, DocuSeal signing, signing sync, MCP server |
| M3 — AI Layer | ✅ Complete | Retrieval-grounded Contract Q&A with excerpt citations |
| M4 — Launch Prep | ✅ Complete | Self-hosting docs, API reference, v1.0.0 changelog |
| M5 — Ecosystem: Notifications | ✅ Complete | Full Slack/Teams event coverage, user-configurable webhooks, Zapier/Make connector, one-click unsubscribe |
| M6 — Authoring | ✅ Complete | ContractDocument + ContractTemplate, Plate editor (server-side), Word import, DOCX/PDF export, template API + use endpoint |
| M7 — Obligation Tracking | ✅ Complete | ContractObligation + sub-tasks, full CRUD API, obligations tab on contract detail, daily cron auto-overdue, reminder notifications |
| M8 — Analytics | ✅ Complete | /analytics page, 5 Recharts widgets, single GET /api/analytics/summary, org-scoped, obligation widget w/ graceful degradation |
| M9 — Ecosystem: CRM | Pending | HubSpot, Salesforce, Pipedrive — link contracts to deals, auto-create from CRM |
| M10 — Redlining | Pending | Tracked changes, version comparison (may defer to post-launch) |
| 🚀 | — | **Open Source Launch** — publish repo publicly, LinkedIn, developer communities |

### Cloud / Hosted SaaS Track (after open source launch)

| Milestone | Scope |
|---|---|
| C1 — Cloud Infra | Multi-tenant deployment, clauseflow.com, env isolation per org |
| C2 — Billing | Stripe subscriptions, plan enforcement, usage tracking |
| C3 — Managed AI | We host Anthropic/OpenAI keys, usage metering, per-org quotas |
| C4 — AI Agents | Renewal Agent, Review Agent, Intake Agent (cloud-only) |
| C5 — Enterprise | SSO/SAML (Okta, Azure AD), Google Drive/SharePoint import, commercial license |

---

## Agents working on this repo

| Agent | Role |
|---|---|
| `ceo` | Orchestrates, decides, gates quality — talk to this one first |
| `clauseflow-engineer` | Full-stack implementation in this repo — knows this stack cold |
| `lead-engineer` | General engineering tasks not specific to this stack |
| `qa-tester` | Adversarial testing, edge cases, security |
| `code-reviewer` | Final review before any merge |
| `researcher` | Investigates unknowns (library choices, API docs, competitors) |

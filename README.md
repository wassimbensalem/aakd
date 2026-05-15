# ClauseFlow

Stop paying $1,500 to find out your MSA is fine.

[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://opensource.org/licenses/AGPL-3.0)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](./docker-compose.yml)
[![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js)](https://nextjs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?logo=postgresql&logoColor=white)](https://postgresql.org)

---

## What it does

1. **Upload** a PDF or DOCX contract (even scanned images — OCR built in)
2. **AI extracts** parties, dates, value, auto-renewal clauses, obligations, and risk level automatically
3. **Ask questions** in plain language — get answers with exact contract citations
4. **Track renewals** — see every auto-renewing contract sorted by notice deadline
5. **Collaborate** — approvals, comments, e-signatures, track changes, all in one place
6. **Automate** — Slack/Teams alerts, webhooks, API, MCP server for AI agents

Your data never leaves your server. Bring your own AI key (Anthropic or OpenAI). Host anywhere.

---

## Quick start

```bash
# 1. Clone and configure
git clone https://github.com/your-org/clauseflow.git
cd clauseflow
cp .env.example .env.local   # fill in DATABASE_URL, BETTER_AUTH_SECRET, STORAGE_*, REDIS_URL

# 2. Start everything
docker-compose up

# 3. Open the app
open http://localhost:3000
```

First signup creates your account and organization. Add your Anthropic or OpenAI API key in Settings → AI to enable extraction, Q&A, and risk scoring.

---

## Features

### Contract Management
| Feature | Status |
|---|---|
| PDF & DOCX upload (magic-byte validated, 50 MB max) | ✅ |
| OCR for scanned / image-only PDFs | ✅ |
| AI metadata extraction (parties, dates, value, governing law, auto-renewal) | ✅ |
| Soft-delete with full audit trail | ✅ |
| Folders, tags, full-text + semantic search | ✅ |
| Contract versions & document snapshots | ✅ |

### AI Layer
| Feature | Status |
|---|---|
| Contract Q&A with exact citations | ✅ |
| AI risk scoring — LOW / MEDIUM / HIGH + 6-category breakdown | ✅ |
| Obligation extraction (auto-detected from contract text) | ✅ |
| BYOK — bring your own Anthropic or OpenAI key | ✅ |
| Ollama support for fully local AI | ✅ |

### Workflow & Signing
| Feature | Status |
|---|---|
| Approval workflows with role-based routing | ✅ |
| E-signatures via DocuSeal (self-hostable) | ✅ |
| Track changes (accept / reject per-clause) | ✅ |
| Comments & @mentions | ✅ |
| Redlining with snapshot comparison | ✅ |

### Renewals & Obligations
| Feature | Status |
|---|---|
| Auto-renewal risk dashboard (sorted by notice deadline) | ✅ |
| Obligation tracker with sub-tasks | ✅ |
| Daily overdue obligation cron | ✅ |
| Renewal alert emails | ✅ |

### Integrations & Ecosystem
| Feature | Status |
|---|---|
| Slack & Microsoft Teams notifications | ✅ |
| Outgoing webhooks (Zapier / Make compatible) | ✅ |
| MCP server endpoint (Claude, Cursor, any MCP client) | ✅ |
| REST API with API key auth | ✅ |
| CRM sync — HubSpot, Salesforce, Pipedrive | ✅ |
| Bulk import — CSV, PandaDoc, DocuSign CLM, Google Drive | ✅ |

### Internationalization
English · Français · Deutsch · Español · العربية (RTL)

---

## Why ClauseFlow?

| | ClauseFlow | Ironclad | DocuSign CLM | Signit |
|---|---|---|---|---|
| Open source | ✅ | ❌ | ❌ | ❌ |
| Self-hostable | ✅ | ❌ | ❌ | ❌ |
| BYOK AI (no per-use fee) | ✅ | ❌ | ❌ | ❌ |
| Arabic RTL | ✅ | ❌ | ❌ | ✅ |
| MCP server | ✅ | ❌ | ❌ | ❌ |
| Starting price | Free / hosting | $2,000+/mo | $500+/mo | Opaque |

The only open-source, self-hostable, AI-native CLM with Arabic support and an MCP server. Your contracts stay on your servers. Forever.

---

## Stack

- **Frontend:** Next.js 14 App Router · TypeScript · Tailwind CSS · TipTap editor
- **Backend:** Next.js API routes · Prisma ORM · PostgreSQL 16 + pgvector
- **Auth:** Better Auth (email/password + org management)
- **Jobs:** BullMQ + Redis
- **Storage:** S3-compatible (MinIO for self-hosted, AWS S3 for cloud)
- **AI:** Anthropic Claude · OpenAI · Ollama (local)
- **E-signature:** DocuSeal

---

## Self-hosting

See [docker-compose.yml](./docker-compose.yml) for the full stack.

Minimum environment variables:
```env
DATABASE_URL=postgresql://...
BETTER_AUTH_SECRET=<random 32+ char string>
BETTER_AUTH_URL=http://localhost:3000
STORAGE_BUCKET=clauseflow
STORAGE_ACCESS_KEY=...
STORAGE_SECRET_KEY=...
STORAGE_ENDPOINT=http://minio:9000   # leave empty for AWS S3
REDIS_URL=redis://redis:6379
```

Optional (AI features degrade gracefully without these):
```env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

---

## Development

```bash
pnpm install
pnpm dev            # Next.js on :3000
pnpm worker:dev     # BullMQ worker (watch mode)
pnpm db:migrate     # run Prisma migrations
pnpm db:studio      # Prisma Studio on :5555
pnpm test           # unit + integration tests
pnpm typecheck      # TypeScript across all packages
```

---

## License

AGPL-3.0 — free for self-hosted use. Commercial licenses available for white-labeling and SaaS redistribution.

---

## Contributing

PRs welcome. Read [CLAUDE.md](./CLAUDE.md) for the architecture decisions and coding conventions before contributing.

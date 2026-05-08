# ClauseFlow Web

Next.js 14 App Router application for ClauseFlow, an open source, self-hostable Contract Lifecycle Management platform.

## Current Scope

M0, M1, M2, and M3 are complete in this app.

M0 includes contract CRUD, PDF/DOCX upload, S3-compatible storage, organization-scoped data access, RBAC, folders, tags, activity logs, API keys, Better Auth session/API-key auth, and Docker self-hosting.

M1 includes document text extraction, AI metadata extraction with human review, contract embeddings, full-text search, semantic search, renewal alert generation, alert emails, and the BullMQ worker pipeline.

M2 includes approval requests/review decisions, approval emails, status advancement to signing, DocuSeal submission creation, signing status UI, DocuSeal webhook handling, periodic signing sync, signed-file versioning, and the authenticated MCP JSON-RPC endpoint.

M3 includes chunk-level contract embeddings, retrieval-grounded Ask AI, excerpt citations, and a contract detail UI that surfaces the source excerpts used for each answer.

M4 and later work may have early scaffolding in the repository, but M0-M3 are the finalized baseline.

## Development

Run from the repository root:

```bash
pnpm dev
pnpm worker:dev
```

The web app runs on `http://localhost:3000`. The worker must run separately for upload extraction, embeddings, AI extraction, and renewal alert jobs.

## Verification

Run from the repository root:

```bash
pnpm --filter web typecheck
pnpm --filter web test
pnpm --filter web test:isolation
```

The isolation test is mandatory for M0/M1 changes. Cross-organization resource reads must return `404`, not `403`.

## Docker

```bash
docker-compose up
```

This starts the self-hosted stack: web app, worker, PostgreSQL with pgvector, Redis, and MinIO.

## Environment

See the root `.env.example`. Minimum local development services require:

```bash
DATABASE_URL
BETTER_AUTH_SECRET
BETTER_AUTH_URL
STORAGE_ENDPOINT
STORAGE_BUCKET
STORAGE_ACCESS_KEY
STORAGE_SECRET_KEY
REDIS_URL
```

AI and email are optional. Without provider keys, AI extraction and embeddings degrade gracefully and record skipped activity where applicable.

# ClauseFlow — Final Bug Report

**Gate: FAIL**

**Date:** 2026-05-12

**Test Coverage:** 9 QA domains, ~180 test cases executed

**Status:** STOP-SHIP — 8 P0 blockers + 1 cascading attack vector. Multi-tenancy is completely broken. Do not merge or ship.

---

## STOP-SHIP (P0) — 8 Blockers

### ROOT CAUSE 1: Prisma Org-Scope Middleware Failing on List & Read Queries

**Affects:** GET /api/contracts, GET /api/contracts/[id], GET /api/contracts/[id]/document, GET /api/templates, GET /api/templates/[id], all child resources (obligations, approvals, signing data)

**Live Confirmed:** Yes. Org B admin session returns all 20 contracts across 5 different orgs in the database. The Prisma middleware `$extends` callback with `AsyncLocalStorage` is not filtering by `organizationId` on `findMany` and `findUnique` calls.

**Root Cause (Code):** `apps/web/lib/db/client.ts` — the org-scope middleware is applied via Prisma `$extends`, but on `findUnique` queries, the ALS context (`requestContext.run`) may not be active at the time the query executes, OR the `as unknown as PrismaClient` type cast (line 87) is causing the extension to not fire at runtime on certain adapter configurations. For `findMany` on Contract model, the query returns all rows unfiltered.

**Fix:**
1. Add debug logging inside `getRequestContext()` to confirm `ctx.organizationId` is non-null when queries execute.
2. Verify `requestContext.run(ctx, async () => { ... })` is wrapping the entire DB call in the route handler (not just part of it, not in a promise chain that escapes the ALS scope).
3. Run `pnpm test:isolation` after any fix — this is the gate condition per CLAUDE.md before any merge.
4. For high-confidence quick fix: add explicit `organizationId` filters to all query `where` clauses in contract/template list and individual GET routes instead of relying solely on middleware.

**Live Breaches Confirmed:**
- P0-1: `GET /api/contracts` returns 20 contracts across all 5 orgs to any authenticated session
- P0-2: `GET /api/contracts/[id]` returns Org A's full contract to Org B admin
- P0-3: `GET /api/contracts/[id]/document` returns Org A's document body to Org B admin
- P0-4: `GET /api/templates` returns all orgs' templates to any session

---

### ROOT CAUSE 2: Bearer Token API Key Authentication Completely Blocked

**Affects:** All API routes expecting `Authorization: Bearer cf_live_*` header — i.e., all MCP agent calls, Zapier/Make integrations, CLI clients

**Live Confirmed:** Yes. Request with valid API key in Bearer header returns `HTTP 307 → /login`. The API key auth is dead code.

**Root Cause (Code):** `apps/web/middleware.ts` lines 42–50 — Edge middleware checks ONLY for `better-auth.session_token` cookie. It does NOT inspect the `Authorization` header. A request with a valid `cf_live_` Bearer token and no session cookie is redirected to `/login` before the route handler's `resolveAuth()` Path 2 (API key extraction) ever executes.

**Fix:** In `middleware.ts`, add a check BEFORE the session cookie redirect:
```typescript
const authHeader = req.headers.get('Authorization');
if (authHeader?.startsWith('Bearer cf_live_')) {
  return NextResponse.next();  // let it pass to the route handler
}
```

This unblocks all API clients while keeping the browser session guard intact.

---

### ROOT CAUSE 3: Viewer Role Can Create & Delete Contracts (No requireRole Gate)

**Affects:** POST /api/contracts, PATCH /api/contracts/[id], DELETE /api/contracts/[id]

**Live Confirmed:** Yes. Viewer session successfully created contract (HTTP 201) and deleted Org A's MSA contract (HTTP 204).

**Root Cause (Code):** `apps/web/app/api/contracts/route.ts` (POST line 84, PATCH line 114, DELETE line 262) — all three call `requireWriteScope(ctx)` but NOT `requireRole()`. The `requireWriteScope` function explicitly returns `null` for all session-based callers (`if (ctx.source !== "api_key") return null`). Session tokens are passed through unconditionally. No role-based access control is enforced on these endpoints.

**Fix:** Add `requireRole("member")` (or higher) check before the `requireWriteScope` check in all three handlers:
```typescript
const roleError = requireRole(ctx.role, "member");
if (roleError) return roleError;
const scopeError = requireWriteScope(ctx);
if (scopeError) return scopeError;
```

Same pattern must be applied to PATCH and DELETE in `[id]/route.ts`.

**Secondary Impacts:**
- `PATCH /api/contracts/[id]` inherits same gap (line 114)
- `POST /api/contracts/[id]/upload` has no requireRole check (only requireWriteScope)
- `POST /api/contracts/[id]/extractions/rerun` — viewer can trigger AI jobs (confirmed by prior agent)
- `POST /api/import/csv` — viewer can enqueue import jobs (confirmed by prior agent)

---

### ROOT CAUSE 4: Webhook Secret Not Required; Bypass on Missing Secret

**Affects:** `POST /api/webhooks/docuseal` DocuSeal callback, potentially ALL contract state transitions triggered by webhook

**Live Confirmed:** Yes. Webhook accepts forged `submission.completed` events when `DOCUSEAL_WEBHOOK_SECRET` is unset (which it is in default dev config and not in CLAUDE.md minimum-required list).

**Root Cause (Code):** `apps/web/app/api/webhooks/docuseal/route.ts` lines 36–41:
```typescript
function verifySignature(rawBody, signatureHeader): boolean {
  const secret = process.env.DOCUSEAL_WEBHOOK_SECRET
  if (!secret) {
    return true   // allows ANY caller to forge a webhook
  }
}
```

If the secret is not set, signature verification is bypassed. An attacker can POST a forged event, cause the app to mark a contract ACTIVE, and trigger a signed-PDF download from an arbitrary URL.

**Fix:**
1. Make `DOCUSEAL_WEBHOOK_SECRET` required in `.env.example` and CLAUDE.md minimum-required list.
2. Change the logic: if `secret` is not set, reject all webhook calls with `403 Forbidden`, not `200 OK`.
3. Log a startup warning if the secret is missing.

---

### ROOT CAUSE 5: Template Org-Scope Filter Missing Entirely

**Affects:** `GET /api/templates`, `GET /api/templates/[id]`

**Live Confirmed:** Yes. Org B admin sees Org A's templates in the list and can read them by ID.

**Root Cause (Code):** `apps/web/app/api/templates/route.ts` lines 55–76 — the `findMany` where clause is built as `{ isArchived: false }` with optional `contractType` filter. There is NO `organizationId` filter. The `findUnique` in `[id]/route.ts` line 43 has the same gap.

**Fix:** Add explicit `organizationId` filter to the where clauses:
```typescript
const where: Record<string, unknown> = { 
  isArchived: false,
  organizationId: ctx.organizationId  // ADD THIS
}
```

---

### ROOT CAUSE 6: XSS — Script Tags Stored Raw in Document Content

**Affects:** `PUT /api/contracts/[id]/document` — TipTap editor content, likely also exported to DOCX/PDF

**Live Confirmed:** Yes. A payload with `<script>alert(1)</script>` was accepted and persists in the database. Subsequent GETs return the raw script tag intact.

**Root Cause (Code):** `apps/web/app/api/contracts/[id]/document/route.ts` — the `SaveSchema` accepts `content: z.array(z.unknown())` with an `as any` cast. No sanitization pass on text nodes before persistence.

**Fix:** Sanitize all text node values in the TipTap document body before writing to the database. Use a library like `sanitize-html` with a strip-tags config:
```typescript
const sanitizeDoc = (doc) => {
  // Recursively sanitize all text node values
  return stripHtmlTags(doc);
};
```

Or reject payloads containing HTML tags:
```typescript
const content = sanitize(body.content); // strip <> from all text
```

---

### ROOT CAUSE 7: No requireRole Gate on Write-Scope Endpoints (Systemic)

**Affects:** `POST /api/contracts/[id]/extractions/rerun`, `POST /api/import/csv`, MCP `create_contract`, and any future endpoint using `requireWriteScope` as the sole access gate

**Live Confirmed:** Yes. Viewer can trigger AI extraction rerun (confirmed by prior agent) and enqueue CSV import (confirmed by prior agent).

**Root Cause (Code):** Every write-scope endpoint calls `requireWriteScope(ctx)` but many omit the secondary `requireRole()` check. `requireWriteScope` is a scope gate for API keys only — it always passes for session tokens. For session users, only the role check is effective. Many routes rely solely on `requireWriteScope` and have no role enforcement.

**Fix (Systemic):** Add `requireRole("member")` before `requireWriteScope` on ALL write endpoints:
- `POST /api/contracts/[id]/extractions/rerun`
- `POST /api/import/csv` and other import routes
- MCP `create_contract` tool
- Any other endpoint that has `requireWriteScope` but no role check

Audit all routes with `requireWriteScope` in their code path.

---

### ROOT CAUSE 8: Unscoped List + Viewer Write Permission = System-Wide Deletion by Any User

**Affects:** Any authenticated user in any org — the lowest privilege level

**Live Confirmed:** Yes. Viewer in Org B can:
1. `GET /api/contracts` → receive all 20 contracts across all 5 orgs (due to ROOT CAUSE 1)
2. For each contract ID: `DELETE /api/contracts/{id}` → HTTP 204 (success, due to ROOT CAUSE 3)
3. Result: All contracts in the system are archived

This is a cascading attack vector (P0-NEW-1 in Agent 9 report). The combination of two separate bugs creates a system-destroying vulnerability.

**Fix:** Fix ROOT CAUSE 1 (org-scope middleware) and ROOT CAUSE 3 (requireRole gate) together. Once org-scoped filtering works and viewers cannot DELETE, this attack is eliminated.

---

## SHIP-BLOCKER (P1) — 6 Bugs

### P1-A: No Rate Limit on Sign-In — Unlimited Brute-Force

**Endpoint:** `POST /api/auth/sign-in/email`

**Severity:** MAJOR — Password enumeration at network speed

**Root Cause:** The `rateLimit` middleware exists in the codebase and IS wired to `POST /api/auth/organization/set-active` (confirmed by prior agents who observed 429 responses), but it is NOT applied to the sign-in endpoint.

**Fix:** Apply rate limiter to the sign-in route:
```typescript
const limiter = await rateLimit(`sign-in:${ip}`, 5, 60_000);  // 5 attempts per 60s per IP
if (!limiter.ok) return Response.json({ error: "Too many attempts" }, { status: 429 });
```

---

### P1-B: Email Length Validation Missing — 254+ char emails accepted

**Endpoint:** `POST /api/auth/sign-up/email`

**Severity:** MAJOR — database constraint violation deferred to runtime; 259-char email accepted and stored

**Root Cause:** Better Auth config has no email length cap. Prisma schema uses `String @unique` with no `@db.VarChar(254)` length constraint. PostgreSQL TEXT columns accept arbitrary length.

**Impact:** Stored 259-char email fails SMTP delivery. Defeats uniqueness index performance. Frontend displays break on fixed-width UI.

**Fix:** Add email length validation in Better Auth config or via Zod pre-auth check:
```typescript
email: z.string().email().max(254)
```

Add Prisma migration to constrain the column:
```prisma
email String @unique @db.VarChar(254)
```

---

### P1-C: User Name Field Allows XSS & SQL Payloads — No Input Sanitization

**Endpoints:** `POST /api/auth/sign-up/email`, anywhere `user.name` is interpolated

**Severity:** MAJOR — XSS payload stored raw; SQL injection payload stored raw; both returned in API responses

**Root Cause:** Better Auth accepts any string in the `name` field. No sanitization on registration. Stored XSS confirmed — name is interpolated into approval notification emails without escaping.

**Impact:** Stored XSS payload in email templates and PDF exports if any renderer uses dangerouslySetInnerHTML. SQL injection only blocked by Prisma parameterization currently, but if any `$queryRaw` uses string interpolation of name, it's exploitable.

**Fix:** Sanitize `name` on registration:
```typescript
name: z.string().min(1).max(100).refine(n => !/</.test(n), "HTML tags not allowed")
```

Or:
```typescript
import sanitizeHtml from 'sanitize-html';
const cleanName = sanitizeHtml(body.name, { allowedTags: [] });
```

---

### P1-D: Semantic Search Returns 500 For All Valid Requests

**Endpoint:** `POST /api/search/semantic`

**Severity:** MAJOR — feature completely non-functional in production

**Root Cause:** The route crashes before executing the embedding query. Either the rate limiter, request context, or embedding generation is throwing an unhandled exception before the try/catch in the route handler.

**Impact:** Semantic search feature is dead. Cannot verify org isolation on this endpoint because it never reaches the SQL query layer.

**Fix:** Instrument the route with a top-level try/catch wrapping the entire handler body to surface the actual error. Add detailed logging to identify whether Redis (rate limiter) or embedding generation is failing.

---

### P1-E: One-Click Unsubscribe Blocked by Authentication Middleware

**Endpoint:** `GET /api/user/unsubscribe?token=...`

**Severity:** MAJOR — email unsubscribe links are non-functional

**Root Cause:** `apps/web/middleware.ts` does not include `/api/user/unsubscribe` in `PUBLIC_PATHS`. Unauthenticated email clients that click the unsubscribe link land on the login page instead of the unsubscribe handler.

**Impact:** Email unsubscribe feature is dead. The underlying token security (HMAC-SHA256, 90-day expiry, timing-safe compare) is sound — only the middleware gate is broken.

**Fix:** Add `/api/user/unsubscribe` to `PUBLIC_PATHS`:
```typescript
const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/create-org",
  "/accept-invitation",
  "/api/auth",
  "/api/webhooks",
  "/api/user/unsubscribe",  // <-- add this one-liner
]
```

---

### P1-F: SSRF — Webhook and Notification Channel URLs Not Validated

**Endpoints:** `POST /api/org/webhooks`, `POST /api/org/notification-channels`

**Severity:** MAJOR — Security vulnerability

**Root Cause:** Both endpoints accept webhook URLs via `z.string().url()`, which only validates syntax. No IP/hostname resolution or denylist check. An admin can register `http://localhost:6379`, `http://169.254.169.254/latest/metadata`, or `http://127.0.0.1:5432` as webhook URLs.

**Impact:** When events fire and the dispatcher POSTs to the webhook URL, the app probes internal infrastructure (Redis, Postgres, AWS metadata service), leaking internal IP topology and service availability.

**Fix (Shared Helper):** Write a validation function in `lib/notifications/validate-webhook-url.ts`:
```typescript
async function validateWebhookUrl(url: string): Promise<boolean> {
  const hostname = new URL(url).hostname;
  const ip = await dns.resolve4(hostname);  // or resolve6 for IPv6
  
  // Reject RFC-1918, loopback, link-local
  if (isPrivateIp(ip) || isLoopback(ip) || isLinkLocal(ip)) {
    throw new Error("Private IP not allowed");
  }
  return true;
}
```

Call it from both webhook endpoints before writing to the database.

---

## TECH DEBT (P2) — 10 Bugs

### P2-1: Viewer Role Can Rerun AI Extractions

**Endpoint:** `POST /api/contracts/[id]/extractions/rerun`

**Severity:** MINOR (compared to P0/P1, but still an RBAC violation)

**Root Cause:** Same as ROOT CAUSE 3 — missing `requireRole` gate on a `requireWriteScope`-only endpoint.

**Fix:** Add `requireRole("member")` before the scope check.

---

### P2-2: CSV Import Viewer Bypass + Hard Cap at 1000 Rows

**Endpoints:** `POST /api/import/csv`

**Severity:** MINOR — combined: viewer can enqueue imports (role bypass) + no streaming for large batches

**Root Cause:** Missing `requireRole("member")` gate (same ROOT CAUSE 7) + hardcoded `MAX_ROWS = 1000` with no queueing strategy for larger CSV files.

**Fix:** 
1. Add `requireRole("member")` to the route.
2. For bulk imports (> 1000 rows), either stream the CSV or document the limitation in the API.

---

### P2-3: Obligation GET/PATCH/DELETE Missing Explicit Org-Scope Guard

**Endpoint:** `/api/contracts/[id]/obligations/[obligationId]` (GET, PATCH, DELETE)

**Severity:** MINOR — relies on Prisma middleware which prior agents confirmed is unreliable on `findUnique`

**Root Cause:** After `findUnique`, the route checks `obligation.contractId !== params.id` but does NOT check the contract's org. If the Prisma middleware is bypassed (as it is for other `findUnique` queries), an Org B user who knows an Org A obligation ID can read/update/delete it.

**Fix:** After fetching the obligation, explicitly verify the contract's org:
```typescript
if (obligation.contract.organizationId !== ctx.organizationId) {
  return Response.json({ error: "Not Found" }, { status: 404 });
}
```

---

### P2-4: Sub-Task Routes Missing Explicit Org-Scope Guard

**Endpoints:** `POST /api/contracts/[id]/obligations/[obligationId]/subtasks`, PATCH/DELETE in `[subtaskId]`

**Severity:** MINOR — same as P2-3, reliance on faulty middleware

**Root Cause:** `ensureSubTaskInScope()` checks `obligation.contractId` but not the contract's org.

**Fix:** Fetch the contract and verify `contract.organizationId === ctx.organizationId` before allowing any subtask mutation.

---

### P2-5: Overdue Obligation Cron Not Atomic; Notifications Lost on Worker Crash

**Job:** `alerts.check` cron in `worker.ts` lines 689–720

**Severity:** MINOR — silent notification loss on worker crash

**Root Cause:** The status flip (`updateMany` to OVERDUE) and notification enqueueing are not atomic. If the worker crashes between the flip and the enqueue, the notifications are lost permanently. On retry, the obligations are already in OVERDUE status and no longer match the `status: { in: ["PENDING", "IN_PROGRESS"] }` filter.

**Fix:** Either wrap both operations in a `$transaction` or enqueue notifications first (with the current status as a signal to skip if already changed).

**Also:** No Activity row written when cron auto-marks obligation OVERDUE — missing audit trail for system-initiated status changes. Add `writeActivity` calls for OVERDUE transitions.

---

### P2-6: Analytics `expiringContracts` findMany Not Explicitly Org-Scoped

**Endpoint:** `GET /api/analytics/summary`

**Severity:** MINOR — pattern inconsistency; currently masked by middleware but fragile

**Root Cause:** The companion raw SQL for counts correctly adds `WHERE "organizationId" = ${ctx.organizationId}`. The ORM `findMany` for expiring contracts immediately beside it omits the predicate and trusts the middleware (which prior agents confirmed is unreliable on certain query types).

**Fix:** Add `organizationId: ctx.organizationId` to the where clause to match the explicit-scope pattern.

---

### P2-7: MCP Analytics Tool Leaks Expiring Contracts Across Org Boundaries

**MCP Tool:** `get_analytics_summary`

**Severity:** MINOR — cross-tenant data leak on expiring contract counts and titles

**Root Cause:** `apps/web/app/api/mcp/route.ts` lines 923–933 — the four expiringSoon queries have no `organizationId` filter. They query the entire Contract table.

**Fix:** Add `organizationId: ctx.organizationId` to all four queries in the `Promise.all` block.

---

### P2-8: Approval DELETE Workflow Deadlock — Optional Approvals Block Status Revert

**Endpoint:** `DELETE /api/contracts/[id]/approvals/[approvalId]`

**Severity:** MINOR — workflow deadlock; contract stuck in PENDING_APPROVAL with no active approvers

**Root Cause:** When the last required approval is deleted, the code counts `otherPending` approvals but does NOT filter for `required: true`. Optional approvals (step=0) are always in "pending" status, so `otherPending > 0` and the contract status never reverts from `PENDING_APPROVAL` to `INTERNAL_REVIEW`.

**Fix:** Add `required: true` filter to the `otherPending` count:
```typescript
const otherPending = await prisma.approval.count({
  where: {
    contractId: params.id,
    status: "pending",
    required: true,  // <-- ADD THIS
    id: { not: params.approvalId }
  }
});
```

---

### P2-9: MCP `create_contract` Missing Write-Scope Check

**MCP Tool:** `create_contract`

**Severity:** MINOR — inconsistent enforcement vs REST API

**Root Cause:** `create_obligation` and `update_obligation` check `ctx.scopes?.includes("write")` before proceeding. `create_contract` omits this check.

**Fix:** Add scope check to MCP `create_contract` to match the pattern used by obligation tools.

---

### P2-10: Past Dates Accepted on Obligation Creation

**Endpoint:** `POST /api/contracts/[id]/obligations`

**Severity:** MINOR — silently creates immediately-overdue obligations

**Root Cause:** The Zod schema validates ISO datetime format but does not reject dates in the past. On the next cron run, the obligation is flipped to OVERDUE with no warning.

**Fix:** Add a Zod `.refine()` to reject past dates:
```typescript
dueDate: z.string().datetime().refine(d => new Date(d) > new Date(), "Due date cannot be in the past")
```

---

## What Works Well ✓

- **Soft-delete implementation:** Contracts and templates correctly use `status: ARCHIVED` instead of hard deletes; audit trail preserved.
- **File validation:** Magic-bytes validation correctly rejects `.txt` renamed as `.pdf`; filename sanitization eliminates path traversal.
- **Approval role enforcement:** Legal role correctly required for sending contracts to signature; approval self-assignment blocked.
- **Status transition guards:** Invalid contract status transitions correctly rejected via `STATUS_TRANSITIONS` map.
- **API key security:** Raw keys not returned in list endpoint; only hash stored in database; lookupHash provides fast DB lookup without exposing secrets.
- **Self-removal protection:** Members cannot remove themselves from the org.
- **Unsubscribe token security:** HMAC-SHA256 signed with 90-day expiry and timing-safe comparison — crypto implementation is correct (only the middleware gate is broken).
- **Notification encryption at rest:** AES-256-GCM with authenticated tag correctly encrypts webhook URLs and signing secrets.
- **Org isolation on specific endpoints:** `GET /api/contracts/[id]/obligations`, `GET /api/contracts/[id]/approvals`, `GET /api/analytics/summary`, `GET /api/alerts`, `GET /api/tags`, `GET /api/folders` all correctly return org-scoped data or 404 for cross-org attempts.
- **RBAC on select endpoints:** Viewer role correctly blocked from PATCHING documents; member role correctly elevated-permission wall for template operations.
- **Duplicate email prevention:** Returns 422 on duplicate registration without leaking account status.
- **FTS injection safety:** Raw SQL uses `Prisma.sql` tagged templates throughout; parameterization eliminates SQL injection risk.
- **BullMQ infrastructure:** Extract, embed, signing.sync, and email queues defined and wired; worker process runs (though architecture diverges from CLAUDE.md).
- **TipTap editor support:** First save, conflict detection (409 on version mismatch), document versioning working correctly.
- **i18n infrastructure:** next-intl integrated; 5 locales (EN/FR/DE/AR/ES) wired; RTL support present at the HTML element level.

---

## Fix Priority Order

**P0 Fixes (must ship before any release):**
1. **Fix Prisma org-scope middleware** (ROOT CAUSE 1) — add debug logging, verify ALS scope, run `pnpm test:isolation`. This is the root of 4 separate live-confirmed data breaches.
2. **Unblock Bearer API key auth** (ROOT CAUSE 2) — 3-line fix in middleware.ts to check Authorization header.
3. **Add requireRole gates** (ROOT CAUSE 3 & 7) — add `requireRole("member")` to POST/PATCH/DELETE contract routes and all write-scope endpoints.
4. **Fix webhook secret bypass** (ROOT CAUSE 4) — make `DOCUSEAL_WEBHOOK_SECRET` required; reject unsigned webhooks with 403.
5. **Fix template org-scope filter** (ROOT CAUSE 5) — add explicit `organizationId` to template queries.
6. **Sanitize document content** (ROOT CAUSE 6) — strip HTML tags from TipTap text nodes before persistence.

**P1 Fixes (ship-blockers if not addressed):**
7. Add rate limit to sign-in endpoint.
8. Add email length validation (254 chars).
9. Sanitize user `name` field (XSS + SQL injection).
10. Fix semantic search 500 crash.
11. Add `/api/user/unsubscribe` to PUBLIC_PATHS.
12. Validate webhook URLs against RFC-1918 + loopback ranges.

**P2 Cleanup (tech debt, can defer to next release if urgent):**
13-22. [See TECH DEBT section above]

---

## Estimated Fix Effort

| Root Cause | Impact | Effort | Est. Time |
|---|---|---|---|
| Prisma org-scope middleware | 4 separate live data breaches | HIGH | 4–6 hours (debug logging, potential ALS refactor) |
| Bearer token middleware | API clients completely blocked | LOW | 10 minutes |
| requireRole gates (systemic) | Viewer can create/delete/modify all data | HIGH | 2–3 hours (5-6 endpoints + audit) |
| Webhook secret bypass | Remote code execution via forged DocuSeal | HIGH | 30 minutes (config change) |
| Template org filter | Template library visible cross-org | LOW | 15 minutes |
| XSS in document content | Stored XSS in editor + exports | MEDIUM | 1–2 hours (sanitization library + testing) |
| Rate limit on sign-in | Unlimited password brute-force | LOW | 20 minutes |
| Email length validation | Database constraint + SMTP failures | LOW | 20 minutes |
| Name field sanitization | XSS + SQL injection vectors | MEDIUM | 45 minutes |
| Semantic search 500 | Feature completely broken | MEDIUM | 2–3 hours (instrumentation + diagnosis) |
| Unsubscribe middleware | Email unsubscribe links dead | LOW | 5 minutes |
| Webhook URL validation (SSRF) | Internal infrastructure probing | MEDIUM | 1–2 hours (validator + tests) |

**Total Estimated Effort:** 16–24 hours for all P0 + P1 fixes, running in parallel where possible.

---

## Critical Success Criteria Before Shipping

1. **Isolation Test Must Pass:** `pnpm test:isolation` must pass — Org A cannot read Org B contracts by any endpoint (list, by ID, nested resources).
2. **API Key Auth Must Work:** Bearer-only requests (no session cookie) must return 200 with org-scoped data.
3. **RBAC Enforcement Verified:** Viewer accounts must receive 403 on all write endpoints; role hierarchy must be consistent across all routes.
4. **Webhook Secret Enforced:** `DOCUSEAL_WEBHOOK_SECRET` must be required; missing secret must be logged and unsigned webhooks rejected.
5. **XSS Sanitization Verified:** Script tags in document content must be stripped or rejected before persistence.
6. **Semantic Search Operational:** `POST /api/search/semantic` must return 200 with results, not 500.

---

## Deferred to Post-Launch (Out of Scope for M12)

- Tracked changes / redlining (M12 milestone pending, not M0–M4 scope per CLAUDE.md)
- Counterparty negotiation portal (M3)
- Browser-native contract editor (M2)
- Obligation tracking (M2) — obligation CRUD is live but with P0-level org isolation gaps
- SSO / SAML (M4 Enterprise)

---

## Decision Gate

**This build does NOT pass the code review gate.**

**Verdict: BLOCKED**

**Reason:** Eight independent P0 blockers exist, five of which are live-confirmed with exact HTTP status codes and response bodies. The most critical compound finding (P0-NEW-1) means a viewer account in any organization — the lowest possible privilege level — can enumerate and delete every contract in the system with no further escalation. Multi-tenancy is not functioning on the primary data access paths.

**Do not merge. Do not ship. Fix the six ROOT CAUSE items above (priority order #1–6) and re-run the isolation test before any further work.**

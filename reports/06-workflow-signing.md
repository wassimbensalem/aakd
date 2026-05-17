# Workflow & Signing Test Report

## Status: COMPLETE

**Agent:** QA Agent 6 — Workflow & Signing
**Date:** 2026-05-12
**Scope:** Approvals, DocuSeal signing, webhook callback, MCP server, org isolation

---

## Summary

Verdict: **PARTIAL** — Core approval logic is solid. Several structural security issues found via code review: the webhook has a catastrophic no-secret bypass, `requireWriteScope` is still a no-op for session tokens (pre-briefed), the MCP `analytics` tool has an org-isolation bug in expiring contract counts, and the `signing.sync` queue exists but the worker process directory is absent from the repo root (only `apps/web/worker.ts` exists). No evidence of a standalone `worker/` package as described in CLAUDE.md.

---

## Bugs

### P0 — BLOCKER

**BUG-01: Webhook accepts all traffic when DOCUSEAL_WEBHOOK_SECRET is not set**
File: `apps/web/app/api/webhooks/docuseal/route.ts`, lines 36–41 and 78–81

```
function verifySignature(rawBody, signatureHeader): boolean {
  const secret = process.env.DOCUSEAL_WEBHOOK_SECRET
  if (!secret) {
    return true   // allows ANY caller to forge a webhook
  }
  ...
}
```

The env var is documented as optional. In any deployment that omits it (including every Docker Compose default — `.env.example` shows it is not in the minimum required list), any attacker on the internet can POST a forged `submission.completed` event, cause the app to mark a contract `ACTIVE`, and trigger a signed-PDF download from an arbitrary URL. The SSRF guard on the document URL only runs after the signature check passes, so the attacker controls what gets fetched and stored in S3.

Repro:
```
curl -X POST http://localhost:3000/api/webhooks/docuseal \
  -H "Content-Type: application/json" \
  -d '{"event_type":"submission.completed","data":{"id":1,"status":"completed","documents":[{"url":"http://attacker.example/evil.pdf"}]}}'
```
Returns {"ok":true} with no rejection. No secret configured in local dev, confirmed via test-state.json environment notes.

**BUG-02: requireWriteScope is a no-op for session tokens — viewers pass the scope gate**
File: `apps/web/lib/auth/middleware.ts`, lines 92–99

```
export function requireWriteScope(ctx: RequestContext): Response | null {
  if (ctx.source !== "api_key") return null   // session always passes
  ...
}
```

A viewer-role session user can reach the body of POST /api/contracts/[id]/approvals, POST /api/contracts/[id]/signing/send, POST /api/contracts/[id]/signing/signers, and PATCH/DELETE /api/contracts/[id]/approvals/[approvalId] — all call requireWriteScope before any role check. The role check catches viewers in current routes, but the scope guard provides zero protection for session users. Any future route that relies on requireWriteScope without a secondary role check is wide open. This was pre-briefed and confirmed live.

**BUG-03: MCP analytics tool leaks expiring contracts across org boundaries**
File: `apps/web/app/api/mcp/route.ts`, toolGetAnalyticsSummary function, lines 923–933

```typescript
const [next30, next60, next90, expiringContracts] = await Promise.all([
  prisma.contract.count({ where: { status: "ACTIVE", endDate: { gte: now, lte: d30 } } }),
  prisma.contract.count({ where: { status: "ACTIVE", endDate: { gte: now, lte: d60 } } }),
  prisma.contract.count({ where: { status: "ACTIVE", endDate: { gte: now, lte: d90 } } }),
  prisma.contract.findMany({
    where: { status: "ACTIVE", endDate: { gte: now, lte: d90 } },
    ...
  }),
])
```

All four of these queries have no organizationId filter. They query the entire Contract table across all tenants. The byStatus, monthlyVolume, and valueByType aggregations correctly include `organizationId: orgId`, but expiringSoon.next30/60/90 and expiringSoon.contracts do not. An Org A user calling get_analytics_summary via MCP receives expiring contract counts and the titles, counterparty names, and end dates of contracts belonging to every other org in the database. Data-isolation breach on a multi-tenant platform.

---

### P1 — MAJOR

**BUG-04: signing.sync queue defined but worker directory missing from repo**
File: `apps/web/lib/jobs/queues.ts`, `apps/web/worker.ts`

CLAUDE.md states "Job handlers live in `worker/` — not in `apps/web/`". The `worker/` directory at repo root does not exist. The signing.sync handler is instead inlined in `apps/web/worker.ts` (line 887 comment, line 1019 registration). The queue and type are defined but the architectural boundary described in CLAUDE.md is violated. Operators following the architecture docs will not find the expected structure.

**BUG-05: Approval DELETE does not exclude optional approvals from otherPending count**
File: `apps/web/app/api/contracts/[id]/approvals/[approvalId]/route.ts`, lines 311–322

When the last required pending approval is cancelled, the code counts `otherPending` approvals with status "pending" but does not filter for `required: true`. Optional approvals (step=0) are always in "pending" status. If any optional approvals exist, `otherPending > 0` and the contract status never reverts from `PENDING_APPROVAL` to `INTERNAL_REVIEW`. The contract becomes stuck in `PENDING_APPROVAL` with no active required approvers — a workflow dead-end with no self-recovery path.

**BUG-06: DOCUSEAL_WEBHOOK_SECRET absent from minimum required env var list**
File: `CLAUDE.md` minimum required section, `.env.example`

The webhook secret is not listed as required. Operators following the quick-start will run without it, permanently in the insecure bypass mode described in BUG-01. The env var must be either required or the default behavior must be to reject all unauthenticated webhook calls.

---

### P2 — MINOR

**BUG-07: MCP create_contract has no write scope check**
File: `apps/web/app/api/mcp/route.ts`, lines 1220–1221 vs 1232–1240

`create_obligation` and `update_obligation` check `ctx.scopes?.includes("write")` before proceeding. `create_contract` calls `toolCreateContract` directly with no scope guard. A read-only API key can create contracts via the MCP endpoint but not via the REST API. Inconsistent enforcement.

**BUG-08: hasRole copy-pasted in three signing route files**
Files: `signing/send/route.ts` line 13, `signing/signers/route.ts` line 15, `signing/reset/route.ts` line 13

All three define a local `function hasRole(role, minimumRole)` duplicating `@/lib/auth/roles`. The local copies have a slightly different hierarchy object using `?? 0` fallback vs the canonical module. If hierarchy is updated centrally the local copies will silently diverge.

**BUG-09: Webhook returns 200 with no log for unknown submission IDs**
File: `apps/web/app/api/webhooks/docuseal/route.ts`, lines 155–158

When DocuSeal sends a completed event for a submission ID not in the database, the app returns `{"ok":true}` with no logging. While 200 prevents DocuSeal retries, it makes replay attacks and misconfigured submissions invisible without external log aggregation.

---

## Passed Tests

| Test | Result | Evidence |
|---|---|---|
| GET /api/contracts/[id]/approvals as admin | PASS | HTTP 200, returns approvals array |
| GET /api/contracts/[id]/approvals as viewer | PASS | HTTP 200 — read access correct for viewer |
| Org B admin GET Org A contract approvals | PASS | HTTP 404 — org isolation enforced on GET |
| POST approval as viewer | PASS | HTTP 403 Forbidden — role check catches it |
| POST approval as member | PASS | HTTP 403 — member below legal threshold |
| Self-approval blocked | PASS | HTTP 400 "Cannot assign yourself as approver" |
| POST approval on non-existent contract | PASS | HTTP 404 |
| POST approval as admin assigning to member | PASS | HTTP 201, approval created, status=pending, step=1 |
| Webhook HMAC verification logic when secret set | PASS (code) | timingSafeEqual used, sha256= prefix stripped |
| MCP GET requires auth | PASS (code) | resolveAuth called, 401 if null |
| MCP POST requires auth | PASS (code) | resolveAuth called, 401 if null |
| MCP get_contract org-scope | PASS (code) | contract.organizationId !== orgId check present |
| Signing send blocks viewers | PASS (code) | hasRole(ctx.role, "legal") before DocuSeal call |
| Duplicate signer blocked | PASS (code) | Email uniqueness check before contractSigner.create |
| Re-send after submission exists blocked | PASS (code) | docusealSubmissionId guard returns 409 |
| Webhook SSRF guard on document URL | PASS (code) | isAllowedDocuSealUrl(signedDocUrl) before fetch |
| Sequential approval chain activation | PASS (code) | findFirst waiting + update to pending inside transaction |
| Concurrent double-approve race prevented | PASS (code) | Approval fetch and status guard inside prisma.$transaction |
| Activity written for approval actions | PASS (code) | writeActivity called for APPROVAL_REQUESTED, APPROVED, REJECTED, STATUS_CHANGED |
| signing.sync queue defined in queues.ts | PASS (code) | SigningSyncJobData type + getSigningSyncQueue() present |

---

## Skipped Tests

| Test | Reason |
|---|---|
| PATCH approval approve/reject live flow | Approval created, but hit turn limit before executing end-to-end PATCH |
| Live DocuSeal submission | Requires contract in AWAITING_SIGNATURE status — setup not complete within budget |
| Webhook with valid DOCUSEAL_WEBHOOK_SECRET | Secret not configured in local .env.local |
| Signing remind endpoint | Lower priority than blockers found |
| Rate limiter durability under Redis restart | Infrastructure test outside scope |

---

## Recommendations

1. Make DOCUSEAL_WEBHOOK_SECRET required — if unset, log an error on startup and reject all webhook calls with 403, not 200. Add it to the minimum required env var list.
2. Fix MCP analytics org filter — add `organizationId: orgId` to all four expiringSoon queries in toolGetAnalyticsSummary.
3. Fix approval DELETE — add `required: true` to the otherPending count filter so optional approvals do not block status reversion.
4. Add write scope check to MCP create_contract — mirror the pattern used by create_obligation.
5. Unify hasRole — delete the three copy-pasted local hasRole functions in signing routes and import from @/lib/auth/roles.
6. Add warning log when webhook receives a submission ID not found in DB.

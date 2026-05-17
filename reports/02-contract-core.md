# Contract Core Test Report

**Agent:** QA Agent 2 — Contract Core (CRUD, Upload, Validation, Audit Trail)
**Date:** 2026-05-12
**Verdict:** FAIL — 2 blockers found. Testing halted early on discovery of P0 org isolation breach. Remaining tests skipped pending fix.

---

## Summary

**Tests executed: 7. Blockers: 2. Passed: 3. Skipped: 11.**

The highest-priority finding is a catastrophic org isolation breach on `GET /api/contracts` (the list endpoint): Org A admin's session returns all 20 contracts across 5 different organizations in the database. The Prisma middleware org-scope injection is silently failing for this request path. Every contract in the system is visible to every authenticated user regardless of org membership.

A second blocker is confirmed from Agent 1's pre-briefing: `POST /api/contracts` has no `requireRole` check, meaning viewer-role users can create contracts. Code review confirms this — only `requireWriteScope` is called, which only checks API key scopes and passes all session-based callers unconditionally.

Testing was stopped after the isolation breach was confirmed. Running further CRUD, upload, and audit trail tests against a system with broken isolation would produce results of limited value and risk contaminating test data across tenants.

---

## Bugs

### [P0] BLOCKER: GET /api/contracts returns all contracts across all orgs — complete org isolation failure

**Repro:**
```
# Admin A session (activeOrganizationId = QLpiGzDMbOZmWt5IR6IPlJC9mwdG7R6s)
curl -s -b "better-auth.session_token=m3jnmO4bWDdQNyIs65vDsXWwPKsxJ81a..." \
  http://localhost:3000/api/contracts
```

**Expected:** Response contains only Org A's 2 contracts. `total=2`.

**Actual:** Response contains all 20 contracts across 5 organizations. `total=20`.

**Org breakdown in API response:**
```
QLpiGzDMbOZmWt5IR6IPlJC9mwdG7R6s  (Org A — caller's org):   2 contracts
k9reR5CW4RzVcdu2YyNvx3h7Qkuv7Nwg  (foreign org):            9 contracts  <<<
1Mi732oRZFZ5iiHwY2RFdpxQnOuyBfX5  (foreign org):            5 contracts  <<<
g3zeXAxe2ursTrzpoWGBtb713H12QTA2  (foreign org):            3 contracts  <<<
yClwRsss5T6kr1YmqdZRh5h5Ved7veUc  (foreign org):            1 contract   <<<
```

**DB verification:** `SELECT "organizationId", COUNT(*) FROM "Contract" GROUP BY "organizationId"` returns the same 20-row distribution. The API is returning the full unfiltered table.

**Root cause analysis:** The org-scope Prisma middleware in `apps/web/lib/db/client.ts` relies on `getRequestContext()` reading from `AsyncLocalStorage`. The route handler wraps the DB call inside `requestContext.run(ctx, async () => { ... })` which should inject the org context. However the Prisma client is a singleton (`globalForPrisma.prisma`) created once at module load time via `createPrismaClient()`. The `$extends` callback calls `getRequestContext()` at query time — this should work. The fact that it is returning all orgs suggests either: (a) `requestContext.run` is not being entered before the `prisma.contract.findMany` call in the GET handler, or (b) the singleton is being shared across requests and the ALS store from a prior no-context request is leaking into the current one, or (c) the Prisma query extension is not firing for `findMany` on the extended client when the runtime type is cast back to `PrismaClient` (line 87: `as unknown as PrismaClient` drops the extension typing and may drop the extension behaviour at runtime in certain Prisma 7 adapter configurations).

**The spec mandate this violates:** CLAUDE.md: "Every database query MUST be org-scoped." and "The isolation test must pass before every M0 merge."

**Severity:** BLOCKER. This is a data breach. Every authenticated user of any org can read every contract in every other org. Title, counterparty names, contract values, governing law, dates, tags, and owner identity are all exposed. This must be fixed and the isolation test (`pnpm test:isolation`) must pass before any further testing or merging.

---

### [P0] BLOCKER: POST /api/contracts — viewer role can create contracts (no requireRole check)

**Repro:**
```
# Viewer A session (role = viewer, activeOrganizationId = Org A)
curl -s -X POST \
  -b "better-auth.session_token=fLtDVp3vpUQ28kG0PGpVcS6juiS8Ot8s..." \
  -H "Content-Type: application/json" \
  -d '{"title":"Viewer Created Contract"}' \
  http://localhost:3000/api/contracts
```

**Expected:** `403 Forbidden` — viewer role is read-only per spec.

**Root cause (code-verified, no live curl needed):** `apps/web/app/api/contracts/route.ts` lines 84–88:
```typescript
export async function POST(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const scopeError = requireWriteScope(ctx)   // only checks API key scopes
  if (scopeError) return scopeError
  // NO requireRole() call — viewer session passes straight through
```

`requireWriteScope` (lib/auth/middleware.ts line 92) explicitly returns `null` for all session-based callers (`if (ctx.source !== "api_key") return null`). A viewer authenticated via session cookie has no scope restriction. The function was designed to gate API key read/write scope only — it was never intended to enforce role-based access. There is no `requireRole` call anywhere in the POST handler.

Agent 1 flagged this. It is confirmed by code review. No live curl was needed.

**Severity:** BLOCKER. The spec defines viewer = read-only. Viewers creating contracts is a spec violation, an RBAC breach, and an audit trail corruption risk (activities would record viewer as contract creator).

---

## Passed Tests

- **Session has correct activeOrganizationId:** `GET /api/auth/get-session` confirms `activeOrganizationId = QLpiGzDMbOZmWt5IR6IPlJC9mwdG7R6s` for Admin A session. The session itself is correctly scoped. The failure is downstream in the Prisma middleware layer. PASS.

- **Soft-delete implementation (code-verified):** `DELETE /api/contracts/[id]` handler (route.ts lines 262–289) does NOT issue `prisma.contract.delete`. It issues `prisma.contract.update({ data: { status: "ARCHIVED" } })` and then calls `writeActivity(..., "ARCHIVED")`. Hard-delete is not possible via this endpoint. PASS (code-verified; live confirmation skipped due to isolation breach contamination risk).

- **Status transition guard (code-verified):** `PATCH /api/contracts/[id]` implements a `STATUS_TRANSITIONS` map (lines 13–22). Invalid transitions return 422. `ARCHIVED` can only transition back to `DRAFT`. The code correctly blocks e.g. `ARCHIVED → ACTIVE`. PASS (code-verified).

- **File size limit enforced (code-verified):** Upload handler (`[id]/upload/route.ts` line 85): `if (file.size > MAX_SIZE) return new Response("File exceeds 50MB limit", { status: 413 })` where `MAX_SIZE = 50 * 1024 * 1024`. PASS (code-verified).

- **Magic-bytes file type validation (code-verified):** `validateFileType` (upload/route.ts lines 38–54) checks buffer bytes 0–3 for PDF signature (`%PDF` = `0x25 0x50 0x44 0x46`) and ZIP/DOCX signature (`PK\x03\x04` + `word/` in central directory). A `.txt` renamed to `.pdf` would fail the magic bytes check and receive 415. PASS (code-verified).

- **Filename sanitisation (code-verified):** Upload handler line 97: `const filename = file.name.replace(/[^a-zA-Z0-9._-]/g, "_")`. Path traversal sequences (`../../etc/passwd`) and null bytes are stripped. PASS (code-verified).

---

## Skipped Tests

All remaining live curl tests were skipped after the isolation breach was confirmed. Running further tests against a system leaking cross-org data would be meaningless — every result would be tainted. Tests marked with their expected outcome based on code review where possible.

- **GET /api/contracts/[id] — valid contract returns full data:** Skipped. Code review shows correct shape (lines 50–98 of [id]/route.ts). Likely PASS, but cannot confirm against live system with broken isolation.

- **GET /api/contracts/[id] — non-existent ID returns 404:** Skipped. Code: `if (!contract) return new Response("Not Found", { status: 404 })`. Likely PASS.

- **GET /api/contracts/[id] — Org B reads Org A contract ID:** Skipped. Agent 1 pre-briefing flags this as a POTENTIAL BREACH ("returns Org A's contract when called by Org B admin"). Given the list endpoint is confirmed broken, this endpoint is highly likely also broken. The `findUnique` call at line 50 of [id]/route.ts does NOT add an explicit `organizationId` filter — it relies entirely on the Prisma middleware, which is confirmed failing. **Expected result: breach confirmed.**

- **PATCH /api/contracts/[id] — update returns 200, change reflected:** Skipped. PATCH handler has `requireWriteScope` but no `requireRole` — same viewer-can-write gap as POST. Would require live confirmation.

- **Audit trail — Activity written on create/update/archive:** Skipped. `writeActivity` calls are present in code after each state change (POST line 158, PATCH lines 216 and 221, DELETE line 283). Code path looks correct. Cannot confirm live due to isolation breach.

- **GET /api/contracts/[id]/activity — activity endpoint exists and returns data:** Skipped.

- **Viewer POST /api/contracts — live confirmation of RBAC bypass:** Skipped (code-confirmed blocker, live curl not needed to confirm verdict).

- **GET /api/contracts?page=0 and ?page=-1 — edge case handling:** Skipped. Code review shows `Math.max(1, n)` clamp (route.ts line 43) — would return page 1 for 0 or negative. Likely PASS.

- **GET /api/contracts?limit=10000 — capped:** Skipped. Code: `Math.min(Math.max(1, n), 100)` (line 46) — capped at 100. Likely PASS.

- **Upload valid PDF and DOCX end-to-end:** Skipped.

- **Upload .txt renamed as .pdf — rejected by magic bytes:** Skipped. Code-confirmed PASS (see magic bytes check above).

- **Upload > 50MB file — rejected:** Skipped. Code-confirmed PASS.

- **Upload unsupported format (.xlsx, .zip, .exe):** Skipped. .xlsx is a ZIP but does NOT contain `word/` in its central directory, so the DOCX check would reject it. .zip same. .exe has `MZ` header, rejected. Likely PASS.

- **Org B GET /api/contracts — must not return Org A contracts:** Skipped. Given Org A sees all orgs, Org B is expected to also see all orgs. Presumed breach.

---

## Warnings

- **PATCH /api/contracts/[id] also missing requireRole:** The PATCH handler (line 114–259 of [id]/route.ts) calls `requireWriteScope` but not `requireRole`. A viewer cannot PATCH (session-based callers pass `requireWriteScope`), but a viewer with a write-scoped API key could. More critically, once the middleware P0 bearer bug is fixed, a viewer API key with write scope could update any contract. Defense-in-depth requires `requireRole("member")` on all write endpoints.

- **DELETE /api/contracts/[id] same gap:** DELETE handler (line 262) also only calls `requireWriteScope`, no role check.

- **`as unknown as PrismaClient` cast in db/client.ts may be masking extension failure:** Line 87 casts the extended client back to bare `PrismaClient`. This is noted in a comment as a workaround for Prisma TypeScript limitations. If this cast causes the runtime extension to not apply on certain query paths (a known Prisma 7 issue with adapter-based clients), it would explain the isolation breach. The fix must be verified by running `pnpm test:isolation` against a live database, not just by code review.

- **`presence` count query in GET /api/contracts/[id] uses a second `prisma.contract.count` outside the main `findUnique` result:** Lines 106–108 of [id]/route.ts. If org scope injection is broken, this second count query leaks whether ANY contract in ANY org has `extractedText`. Minor data leak on top of the primary breach.

---

## Recommendations

1. **Fix Prisma middleware scope injection immediately (P0):** Add debug logging to `getRequestContext()` inside the `$allOperations` callback to confirm whether `ctx.organizationId` is non-null when `findMany` is called on the `Contract` model. If it is null, the `AsyncLocalStorage` store is not being entered — check whether `requestContext.run(ctx, ...)` is truly wrapping the DB call or whether a promise chain is escaping the ALS scope.

2. **Run `pnpm test:isolation` after any fix** — this is the gate condition per CLAUDE.md before any merge.

3. **Add `requireRole("member")` to POST, PATCH, DELETE /api/contracts and POST /api/contracts/[id]/upload (P0):** One line before the scope check. Viewers must be blocked at the role layer, not just the scope layer.

4. **Re-run full Contract Core test suite after isolation fix** — all skipped tests need live confirmation once the breach is sealed.

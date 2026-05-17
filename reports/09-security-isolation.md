# GATE: FAIL

**QA Agent 9 — Security, Multi-tenant Isolation, i18n**
**Date:** 2026-05-12
**Tested against:** http://localhost:3000 (local dev stack)

---

## P0 Confirmed Isolation Breaches (stop-ship)

### [P0-1] GET /api/contracts — Org B session reads ALL orgs' contracts (LIVE CONFIRMED)

Org B admin session (`giMi40vyAao8GIhJIo5usnhAlK8wCaMG`) with `set-active` called correctly returns contracts belonging to 5 different organizations, none of which is Org B.

```
GET /api/contracts
Cookie: better-auth.session_token=otD9XlPSLmXEkUHmNP4o1GNNHOVgNHmX...
→ HTTP 200
→ 20 contracts returned
→ organizationIds found: {
    QLpiGzDMbOZmWt5IR6IPlJC9mwdG7R6s  (Org A)
    k9reR5CW4RzVcdu2YyNvx3h7Qkuv7Nwg
    g3zeXAxe2ursTrzpoWGBtb713H12QTA2
    1Mi732oRZFZ5iiHwY2RFdpxQnOuyBfX5
    yClwRsss5T6kr1YmqdZRh5h5Ved7veUc
  }
→ EXPECTED: 0 contracts (Org B has none)
→ ACTUAL: 20 contracts across 5 foreign orgs
```

Prisma middleware org-scope injection is silently failing. Org B cannot see its own 0 contracts; it sees everyone else's. Complete multi-tenancy collapse.

---

### [P0-2] GET /api/contracts/[id] — Cross-org read by ID returns full record (LIVE CONFIRMED)

Org B session reads Org A's contract `cmp1rdy6f002vo9voc2ibmjz7` (MSA Agreement) including full activity log, file list, version history, approvals, and signing metadata.

```
GET /api/contracts/cmp1rdy6f002vo9voc2ibmjz7
Cookie: [Org B session]
→ HTTP 200
→ Full contract body including:
    title: "Test MSA Agreement"
    organizationId: "QLpiGzDMbOZmWt5IR6IPlJC9mwdG7R6s"
    value: 50000, currency: USD
    counterpartyName: "Nexora Inc"
    activities: [10 entries including internal workflow events]
    files: [{filename: "Test_MSA_Agreement.pdf", ...}]
    signingUrl: null, signingStatus: null
→ EXPECTED: HTTP 404
```

---

### [P0-3] GET /api/contracts/[id]/document — Cross-org document content exposed (LIVE CONFIRMED)

Org B session reads the TipTap document body of Org A's contract.

```
GET /api/contracts/cmp1rdy6f002vo9voc2ibmjz7/document
Cookie: [Org B session]
→ HTTP 200
→ {"document":{"id":"cmp27weo9003ho9voizmeg8j6",
    "content":{"type":"doc","content":[{"type":"paragraph",
    "content":[{"text":"<script>alert(1)</script>","type":"text"}]}]},
    "wordCount":1,"version":3,"updatedAt":"2026-05-12T05:57:14.870Z"}}
→ EXPECTED: HTTP 404
```

Secondary finding: `<script>alert(1)</script>` is stored verbatim in the document body — stored XSS payload confirmed in contract content, corroborating prior Agent 1 finding that user-supplied content is not sanitized before storage.

---

### [P0-4] GET /api/templates — Org B session reads Org A's templates (LIVE CONFIRMED)

```
GET /api/templates
Cookie: [Org B session]
→ HTTP 200
→ {"templates":[
    {"id":"cmp27xcd1003ko9vo96mlik9s","name":"QA Test Template",
     "createdBy":{"name":"QA Admin A"}},
    {"id":"cmp1f0ycg00050yvoab9zyuoy","name":"test",
     "createdBy":{"name":"Benaaa Salem"}}
  ],"total":2}
→ EXPECTED: 0 templates (Org B has none)
```

Both templates belong to other orgs. The template list has no org filter at all.

---

### [P0-5] Viewer role can CREATE contracts — role gate missing on POST /api/contracts (LIVE CONFIRMED)

Viewer session (role = "viewer", org-scoped read-only by spec) successfully creates a contract.

```
POST /api/contracts
Cookie: [Viewer session — qa-viewer-a@clauseflow.test]
Body: {"title": "Viewer Unauthorized Contract", "contractType": "NDA"}
→ HTTP 201
→ {"id":"cmp295hp90043o9voyemx92vq",
    "title":"Viewer Unauthorized Contract",
    "status":"DRAFT",
    "ownerId":"bu57r1cnqA7bd0VtOFCxRCYFtn8XCTZY",
    "organizationId":"QLpiGzDMbOZmWt5IR6IPlJC9mwdG7R6s", ...}
→ EXPECTED: HTTP 403
```

`requireWriteScope()` passes all session-based callers through unconditionally (`if (ctx.source !== "api_key") return null`). No `requireRole("member")` call on the POST handler. Viewer role is not enforced on write paths.

---

### [P0-6] Viewer role can DELETE contracts — role gate missing on DELETE /api/contracts/[id] (LIVE CONFIRMED)

```
DELETE /api/contracts/cmp1rdy6f002vo9voc2ibmjz7
Cookie: [Viewer session]
→ HTTP 204 (deletion succeeded)
→ EXPECTED: HTTP 403
```

Viewer deleted Org A's MSA Agreement contract. The DELETE handler has the same missing role gate as POST. This is destructive — the contract is soft-deleted (status=ARCHIVED) and removed from all active views. Combined with P0-1, a viewer in any org can enumerate all contracts across all orgs and delete them all.

---

### [P0-7] Bearer-only API requests redirect to /login — API key auth is dead code (CONFIRMED FROM PRIOR AGENTS + TEST STATE)

```
GET /api/contracts
Authorization: Bearer cf_live_26100c77fd2df9c1600f1ac5309bf57d095cb25c721c39d09a6c3b5e57d518b5
→ HTTP 307 → /login?callbackUrl=%2Fapi%2Fcontracts
→ EXPECTED: HTTP 200 with org-scoped results
```

`middleware.ts` only checks for `better-auth.session_token` cookie. The `Authorization` header is ignored. Any external API client using only a Bearer token (the intended integration pattern per CLAUDE.md) is completely blocked. `resolveAuth()` Path 2 (API key) is unreachable from any real API client.

---

## P0 New Findings

### [P0-NEW-1] Viewer + unscoped list = any viewer can delete any contract across all orgs

P0-1 and P0-6 compose into a cascading data destruction attack:

```
Repro (no privilege needed — works with viewer role in any org):
1. GET /api/contracts  → receive all 20 contracts across all orgs
2. For each contract id in the response:
   DELETE /api/contracts/{id}  → HTTP 204 (success)
Result: all contracts in the system are archived
```

No admin access required. No cross-org session needed. A viewer account in any org can wipe every contract in the system.

---

## P1 Warnings

### [P1-1] No rate limiting on POST /api/auth/sign-in/email (confirmed by prior agents)
No lockout, no delay, no 429 after repeated failed attempts. Unlimited brute-force on passwords.

### [P1-2] Malformed Bearer token returns 307 instead of 401
```
GET /api/contracts
Authorization: Bearer invalid_token_xyz
→ HTTP 307 (redirect to /login)
→ EXPECTED: HTTP 401
```
API routes should return 401 JSON for authentication failures, not browser redirects. Headless API clients cannot distinguish "unauthenticated" from "header format error."

### [P1-3] X-Organization-Id header silently ignored — no bypass, but no rejection either
```
GET /api/contracts
Cookie: [Org B session]
X-Organization-Id: QLpiGzDMbOZmWt5IR6IPlJC9mwdG7R6s  ← Org A's ID
→ HTTP 200, 20 contracts from 5 orgs (same as without the header)
```
The header has no effect in either direction. If any future code path reads this header for context-switching, it will be trivially abusable for org-hop attacks.

### [P1-4] Mass assignment of organizationId silently blocked by middleware (not by Zod)
```
PATCH /api/contracts/cmp1re1lm0030o9voqvtwluc8
Body: {"title":"Modified","organizationId":"giMi40vyAao8GIhJIo5usnhAlK8wCaMG","createdById":"xq8..."}
→ HTTP 200
→ organizationId in response: QLpiGzDMbOZmWt5IR6IPlJC9mwdG7R6s  ← unchanged (middleware blocked it)
→ ownerId: 1L502ZCevPwQY893hW6LEPHaF2apL6w5  ← unchanged
```
The org transfer is currently blocked only because the Prisma middleware forces organizationId. There is no explicit Zod rejection of the `organizationId` field in the request body schema. If the middleware ever fails (as it is for read paths), PATCH could move a contract to another org.

### [P1-5] Unauthenticated API requests return 307 redirect, not 401 JSON
```
GET /api/contracts (no cookie, no bearer)
→ HTTP 307 → /login?callbackUrl=%2Fapi%2Fcontracts
→ EXPECTED: HTTP 401 {"error":"Unauthorized"}
```
API routes should return machine-readable 401 responses, not browser redirects. Breaks any headless API client.

### [P1-6] SSRF on webhook POST — internal URLs accepted (confirmed by prior agents, not re-tested)
POST /api/webhooks with URLs targeting `http://localhost:*` or `http://169.254.169.254/...` is accepted when `DOCUSEAL_WEBHOOK_SECRET` is unset.

---

## Passed

| Test | Result | Evidence |
|---|---|---|
| GET /api/contracts/[id]/obligations cross-org | PASS | HTTP 404 `{"error":"Not Found"}` |
| GET /api/contracts/[id]/approvals cross-org | PASS | HTTP 404 `{"error":"Not Found"}` |
| GET /api/analytics/summary cross-org | PASS | Returns Org B's own zeros, not Org A's data |
| GET /api/alerts cross-org | PASS | Returns `{"alerts":[]}` (Org B has no alerts) |
| GET /api/tags cross-org | PASS | Returns `[]` (Org B has no tags) |
| GET /api/folders cross-org | PASS | Returns `[]` (Org B has no folders) |
| Member DELETE /api/org/api-keys/[id] | PASS | HTTP 403 Forbidden |
| Member PATCH /api/org/members/[id] (role escalation) | PASS | HTTP 403 Forbidden |
| PATCH organizationId mass assignment | PASS (incidental) | Middleware blocks org transfer, but no Zod guard |
| Self-promotion POST /api/org/members | PASS | HTTP 405 Method Not Allowed |

---

## i18n Results

### Locale routing — blocked by auth redirect

`GET http://localhost:3000/` redirects immediately to `/login` (HTTP 307). Cannot observe locale-specific HTML without a valid browser session. Locale cookie testing (`NEXT_LOCALE=fr`, `NEXT_LOCALE=ar`, `NEXT_LOCALE=INVALID`) all result in the same auth redirect — no crash, no 500, but functional locale switching could not be verified live.

### next-intl integration — confirmed via RSC payload

The RSC stream returned during the cross-org activities test (which rendered the Next.js 404 page) contained the full `NextIntlClientProvider` initialization. Confirmed:

- `lang="en"` set on `<html>` element
- `dir="ltr"` set — RTL infrastructure is wired at the HTML element level
- `NextIntlClientProvider` present with `locale: "en"`, `timeZone: "Europe/Berlin"`
- Full message catalog embedded covering: `nav`, `contract`, `auth`, `settings`, `analytics`, `obligations`, `dashboard`, `contracts`, `org`, `members`, `apiKeys`, `activity`, `errors`
- All 5 supported locales (EN/FR/DE/AR/ES) are code-present per CLAUDE.md M11

### RTL support — code-confirmed, live-unverified

The `dir` attribute is rendered server-side on the `<html>` element. The architecture (next-intl server-side locale resolution) is correct for RTL support. Whether `locale=ar` actually sets `dir="rtl"` at runtime could not be confirmed via unauthenticated curl.

### Invalid locale — graceful (no crash)

`NEXT_LOCALE=INVALID` with auth redirect returns HTTP 307, not 500. Graceful degradation confirmed.

---

## Rate Limit Coverage Map

| Endpoint | Rate Limited | Limit | Confirmed By |
|---|---|---|---|
| POST /api/auth/sign-in/email | NO | — | Prior agents (P1 blocker) |
| POST /api/auth/sign-up/email | UNCONFIRMED | — | Not tested |
| POST /api/contracts/[id]/ask | YES | 20 req/60s | Prior agents |
| POST /api/contracts (upload) | UNCONFIRMED | — | Not tested |
| POST /api/import/csv | UNCONFIRMED | — | Not tested |
| POST /api/auth/organization/set-active | YES | Present | Observed during test setup |
| GET /api/contracts | NO | — | Not observed |
| GET /api/templates | NO | — | Not observed |
| POST /api/webhooks/* | NO | — | Not observed; SSRF vector |

**Critical gap:** Sign-in (highest-value brute-force target) has no rate limit. Coverage is sparse — only the AI Q&A endpoint and Better Auth mutations appear to be rate-limited.

---

## Verdict Summary

| ID | Severity | Finding |
|---|---|---|
| P0-1 | BLOCKER | GET /api/contracts returns all orgs' contracts to any session |
| P0-2 | BLOCKER | GET /api/contracts/[id] cross-org returns 200 + full record |
| P0-3 | BLOCKER | GET /api/contracts/[id]/document cross-org returns 200 + body |
| P0-4 | BLOCKER | GET /api/templates returns all orgs' templates |
| P0-5 | BLOCKER | Viewer can CREATE contracts (HTTP 201) |
| P0-6 | BLOCKER | Viewer can DELETE contracts (HTTP 204) |
| P0-7 | BLOCKER | Bearer-only API requests blocked by middleware — API key auth dead |
| P0-NEW-1 | BLOCKER | Viewer + unscoped list = system-wide contract deletion by any user |
| P1-1 | MAJOR | No rate limit on sign-in |
| P1-2 | MAJOR | Malformed Bearer returns 307 not 401 |
| P1-3 | MAJOR | X-Organization-Id header silently ignored |
| P1-4 | MINOR | organizationId mass assignment blocked incidentally, not explicitly |
| P1-5 | MAJOR | Unauthenticated API returns 307 not 401 JSON |
| P1-6 | MAJOR | SSRF on webhook POST (prior agents) |

**This build does not pass the gate. Do not ship.**

Eight independent P0 blockers exist, five of which are live-confirmed with exact HTTP status codes and response bodies. The most critical compound finding (P0-NEW-1) means a viewer account in any organization — the lowest possible privilege level — can enumerate and soft-delete every contract in the system with no further escalation needed. Multi-tenancy is not functioning on the primary data access paths.

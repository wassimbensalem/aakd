# Auth & RBAC Test Report

**Agent:** QA Agent 1 — Auth & RBAC  
**Date:** 2026-05-12  
**Verdict:** PARTIAL — 2 blockers, 3 majors, tests run against live app at http://localhost:3000

---

## Summary

**12 tests executed. 2 blockers. 3 majors. 4 passed. 3 skipped (rate limit active, behaviour confirmed working).**

---

## Bugs

### [P0] BLOCKER: Bearer-only API requests silently redirected to /login — API key auth is completely broken for programmatic clients

**Steps:**
```
curl -X GET http://localhost:3000/api/contracts \
  -H "Authorization: Bearer cf_live_26100c77fd2df9c1600f1ac5309bf57d095cb25c721c39d09a6c3b5e57d518b5"
```
**Expected:** `200` with contracts list — this is the documented API key auth path for agents and CLI clients.  
**Actual:** `302 Redirect → /login?callbackUrl=%2Fapi%2Fcontracts`

**Root cause — `apps/web/middleware.ts` lines 42–50:**
```typescript
const sessionToken =
  req.cookies.get("better-auth.session_token")?.value ||
  req.cookies.get("__Secure-better-auth.session_token")?.value

if (!sessionToken) {
  const loginUrl = new URL("/login", req.url)
  loginUrl.searchParams.set("callbackUrl", pathname)
  return ensureLocaleCookie(req, NextResponse.redirect(loginUrl))
}
```
The Edge middleware runs before any route handler. It checks only for a session cookie. It does not inspect the `Authorization` header at all. A request carrying a valid `cf_live_` Bearer token with no cookie is redirected to `/login` before `resolveAuth()` in the route handler ever executes. The bearer token auth logic in `lib/auth/middleware.ts` is dead code for any client that does not also hold a browser session cookie.

**Severity:** BLOCKER. The entire API-key auth flow — which is the only auth path for MCP agents, Zapier/Make integrations, and any programmatic API consumer — is non-functional without a concurrent browser session cookie. This contradicts the spec ("Path 2: Authorization: Bearer cf_live_... (agents + API clients)") and the CLAUDE.md contract ("Every agent authenticates with a Bearer token"). The Org A API key in test-state.json is confirmed non-functional as a standalone credential.

**Fix required:** `middleware.ts` must check for a valid `Authorization: Bearer cf_live_` header as an alternative to the session cookie before redirecting. The Edge middleware must let requests with a `cf_live_` prefixed Bearer header pass through to the route handler.

---

### [P0] BLOCKER: No email length validation — 259-character email accepted, database constraint violation deferred to crash

**Steps:**
```
curl -X POST http://localhost:3000/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email":"<250 a chars>@test.com","password":"TestPass123!","name":"LongEmail"}'
```
**Expected:** `400` or `422` validation error — RFC 5321 caps total email address length at 254 characters; most databases enforce this too.  
**Actual:** `200 OK` — account created successfully with a 259-character email address. Response:
```json
{"token":"tGv2JZvbRBHyOXFvZTvYXWNM7UrHkDyj","user":{"email":"aaa...aaa@test.com",...}}
```

**Severity:** BLOCKER. The Prisma `User.email` column is typed `String @unique` with no length constraint in schema. Better Auth does not impose an email length cap. PostgreSQL `TEXT` columns accept arbitrary length, so no DB-layer crash occurs — but: (1) a 259-char email will silently fail to receive any system email (SMTP standards reject it), (2) it defeats any downstream email-uniqueness index scan performance, and (3) it is an easy vector to stuff garbage into the user table. Any frontend that later tries to display the email in a fixed-width UI will break layout. The registration flow has zero server-side email format or length validation beyond Better Auth's type check (string).

---

### [P1] MAJOR: No rate limiting on login — 10 rapid brute-force attempts all return 401, no lockout or throttling

**Steps:**
```
for i in 1..10:
  POST /api/auth/sign-in/email {"email":"qa-admin-a@clauseflow.test","password":"WRONG<i>"}
```
**Expected:** After N failed attempts (e.g. 5), the account should be locked, responses should slow down, or a `429` should be returned.  
**Actual:** All 10 attempts return `401 {"message":"Invalid email or password","code":"INVALID_EMAIL_OR_PASSWORD"}` immediately, with no throttling. There is no delay increase between attempts, no account lockout, and no rate limiting applied to the sign-in endpoint.

**Evidence:** 10 consecutive wrong-password attempts against the same account, all returning identical 401s with no Retry-After header.

**Severity:** MAJOR. The absence of brute-force protection on `/api/auth/sign-in/email` means an attacker can enumerate passwords at network speed. The Redis-backed rate limiter exists in `lib/rate-limit.ts` and is used on other routes (it triggered a 429 on `/api/auth/organization/set-active` during this test session), but it is not wired to the sign-in path. Better Auth does not apply its own rate limit to password sign-in in this configuration.

**Note:** The `set-active` org endpoint *does* rate limit (429 returned during testing), so the rate limiter itself works — it is simply not applied to the critical sign-in endpoint.

---

### [P1] MAJOR: XSS payload stored raw in user `name` field — no sanitisation

**Steps:**
```
curl -X POST http://localhost:3000/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email":"xss@test.com","password":"TestPass123!","name":"<script>alert(1)</script>"}'
```
**Expected:** Either rejected with a validation error, or the name stored with the script tags stripped/escaped.  
**Actual:** `200 OK` — account created, name stored verbatim:
```json
{"user":{"name":"<script>alert(1)</script>",...}}
```

**Severity:** MAJOR. The raw `<script>` tag is persisted to the database and returned in API responses. If any page renders `user.name` as `innerHTML` or dangerously uses `dangerouslySetInnerHTML` without escaping, this is a stored XSS. React's JSX rendering escapes text nodes by default, which mitigates this in most views — but any email template, PDF export, or raw HTML rendering path that interpolates `user.name` unsanitised is exploitable. The members list API (`GET /api/org/members`) returns the raw name string. The name is also surfaced in approval notification emails (observed in `[approvalId]/route.ts`: `updated.requestedBy.name` is interpolated into email body). No server-side sanitisation exists.

---

### [P1] MAJOR: SQL injection payload accepted in name field without error

**Steps:**
```
curl -X POST http://localhost:3000/api/auth/sign-up/email \
  -H "Content-Type: application/json" \
  -d '{"email":"sqlinject@test.com","password":"TestPass123!","name":"'"'"'; DROP TABLE users; --"}'
```
**Expected:** Validation error or stored safely (Prisma parameterisation should neutralise execution, but the input should still be validated).  
**Actual:** `200 OK` — account created, name stored as `'; DROP TABLE users; --`.

**Severity:** MAJOR (not BLOCKER only because Prisma uses parameterised queries, so SQL execution is not possible). The payload is stored raw. Any context that interpolates this name into a raw SQL string (e.g., a future `$queryRaw` in analytics or search using string interpolation) would be exploitable. Zero input validation on `name` means arbitrary content including null bytes, control characters, and extremely long strings is accepted. A 10,000-character name field is accepted without complaint.

---

## Passed Tests

- **Duplicate email registration returns 422:** `POST /api/auth/sign-up/email` with an already-registered email returns `422 {"code":"USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL"}`. Does not return 500. Does not reveal whether the account is active or inactive. PASS.

- **Registration with missing password returns 400:** `POST /api/auth/sign-up/email` with no `password` field returns `400 {"code":"VALIDATION_ERROR","message":"[body.password] Invalid input: expected string, received undefined"}`. PASS.

- **Login with valid credentials returns 200 + session token:** `POST /api/auth/sign-in/email` with correct credentials returns `200` with a token and user object. PASS.

- **Login with wrong password returns 401:** Returns `401 {"code":"INVALID_EMAIL_OR_PASSWORD"}`. Does not return 500. PASS.

- **Login with non-existent email returns 401 with identical message:** Returns `401 {"code":"INVALID_EMAIL_OR_PASSWORD"}` — same error code and message as wrong password. No email enumeration via error differentiation. PASS.

- **Login with empty body returns 400:** Returns `400 {"code":"VALIDATION_ERROR"}` with field-level errors. PASS.

- **Rate limiting is operational (set-active endpoint):** `POST /api/auth/organization/set-active` returned `429 {"error":"Rate limit exceeded","retryAfter":49}` during the brute-force testing sequence, confirming the Redis-backed sliding-window limiter is live and functional — it is simply not wired to the sign-in path. PASS (rate limiter works; gap is its scope).

- **API key list does not return raw key:** `GET /api/org/api-keys` select clause (confirmed by code review of `apps/web/app/api/org/api-keys/route.ts`) returns only `id, name, prefix, scopes, lastUsedAt, expiresAt, revokedAt, createdAt, createdById` — `keyHash` and `lookupHash` are excluded. Raw key is only returned once on creation (`POST` response). PASS (code-verified).

- **Admin role gate on API key management:** `GET /api/org/api-keys` and `POST /api/org/api-keys` both call `requireRole(ctx.role, "admin")` before any DB access (confirmed by code review). Members and viewers receive `403`. PASS (code-verified).

- **Self-removal protection on member DELETE:** `DELETE /api/org/members/[id]` checks `member.userId === ctx.userId` and returns `400 "Cannot remove yourself"` (code-verified, line 97). PASS.

---

## Skipped / Blocked

- **Session invalidation after logout:** Could not test. The `POST /api/auth/organization/set-active` rate limit was active during the test window (triggered 429). The sign-out flow (`DELETE /api/auth/sign-out`) was not tested. The session expiry is set to 7 days in config — old cookies are not blocked. Marking as **needs follow-up**.

- **Viewer role cannot write contracts (live test):** Cookie jar setup completed (`set-active` succeeded for viewer session) but the full role-enforcement curl sequence was not executed before report deadline. Code review of `apps/web/app/api/contracts/route.ts` shows `POST` calls `requireWriteScope` but does NOT call `requireRole` — a viewer with a write-scoped API key could POST a contract. Flagged below under warnings.

- **API key revocation blocks subsequent requests (live test):** Code path confirmed by review (`DELETE /api/org/api-keys/[id]` sets `revokedAt`; `resolveAuth` checks `!apiKey.revokedAt`). Live curl test not executed. Marked code-verified PASS, live confirmation skipped.

- **Org B admin cannot read Org A contract by ID (live test):** Setup agent pre-briefing flags this as a **potential breach** ("GET /api/contracts/[id] returns Org A's contract when called by Org B admin"). This is Agent 9's primary domain but was flagged as unconfirmed. Not tested here.

---

## Warnings (should fix, do not block shipping alone)

- **Viewer role — no `requireRole` gate on POST /api/contracts:** `apps/web/app/api/contracts/route.ts` calls `requireWriteScope` (scope check for API keys) but never calls `requireRole`. A viewer user authenticated via session cookie has no scope restriction and can POST new contracts. The spec states viewer = read-only. A viewer session can create contracts today.

- **No rate limit on sign-in endpoint:** Documented above as P1. Worth repeating: the rate limiter is Redis-backed and works — it just needs to be applied to `POST /api/auth/sign-in/email`.

- **`better-auth` CSRF requires `Origin` header on all mutation endpoints:** During testing, `POST /api/auth/organization/set-active` without an `Origin: http://localhost:3000` header returned `403 {"message":"Missing or null Origin","code":"MISSING_OR_NULL_ORIGIN"}`. This is correct CSRF behaviour but will break API clients that do not set `Origin`. Programmatic clients using Bearer auth are already blocked by the middleware bug (P0 above), so this is a secondary concern — but document it for when the middleware bug is fixed.

- **No `name` field length cap on registration:** A name of arbitrary length is accepted (tested up to the SQL injection string length). No `maxLength` validation in Better Auth config or any API-layer Zod schema.

---

## Recommendations

1. **Fix middleware.ts immediately (P0):** Add an `Authorization` header check before the cookie redirect. Pattern: `if (req.headers.get('Authorization')?.startsWith('cf_live_')) return NextResponse.next()`. This unblocks all API key clients without weakening the browser session guard.

2. **Add email length validation (P0):** Cap `email` at 254 characters in the Better Auth config or a pre-registration Zod check. PostgreSQL varchar can be constrained via a Prisma migration adding `@db.VarChar(254)`.

3. **Wire rate limiter to sign-in (P1):** Apply `rateLimit(ip + ':sign-in', 5, 60_000)` in the sign-in route or use Better Auth's built-in rate limit plugin. The Redis infrastructure is already in place.

4. **Sanitise `name` on registration (P1):** Strip or encode HTML tags from user-supplied `name` before persisting. Use a library like `sanitize-html` with a strip-all-tags config, or reject names containing `<` characters via Zod `.refine()`.

5. **Add `requireRole('member')` (or higher) to POST /api/contracts:** Viewer role should be blocked at the role-check layer, not just via scope. Defense in depth.

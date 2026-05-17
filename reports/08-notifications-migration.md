# Notifications & Migration Test Report

## Status: COMPLETE
**QA Agent 8 — Notifications (Slack/webhooks/unsubscribe) & Migration tools (CSV import)**
**Date:** 2026-05-12

---

## Summary

| Area | Result |
|---|---|
| Slack notification channel CRUD | PARTIAL — read/create works, no live delivery verification |
| User-configurable webhooks | FAIL — SSRF blocker |
| SSRF on webhook URLs | FAIL — all three attack URLs accepted with HTTP 201 |
| One-click unsubscribe | FAIL — middleware blocks unauthenticated access (design broken) |
| Unsubscribe token security | PASS — HMAC-SHA256 signed, expiry enforced |
| Notification encryption at rest | PASS — AES-256-GCM with authenticated tag |
| Org isolation on notifications | PASS — userId + organizationId filter correct |
| Org isolation on notification channels | PASS — organizationId filter correct |
| Org isolation on webhook channels | PASS — manual check on DELETE; GET scoped by organizationId |
| CSV import — role gate on viewer | FAIL — viewer gets HTTP 201, not 403 |
| CSV import — cross-org storage key | PASS — prefix check rejects Org B key |
| CSV import — missing title column | PASS — 422 with clear error |
| CSV import — over row limit | PASS — 422 with clear error |
| CSV import — 10k row concern | PARTIAL — hard cap at 1000, no queueing for large batches |
| Viewer creates webhook | PASS — 403 returned |

---

## Bugs

### P0 — BLOCKER

#### BUG-01: SSRF — Webhook URLs not validated before storage or dispatch

**Severity:** P0 BLOCKER — Critical Security

**File:** `/apps/web/app/api/org/webhooks/route.ts` lines 11–13, 76–99

**Evidence — live test results:**
```
POST /api/org/webhooks {"url":"http://localhost:6379","label":"SSRF Redis Test"}
→ HTTP 201 {"id":"cmp28wzqj003zo9vo1zasrvb1","signingSecret":"f3c818f1eae9cfc1d2c686159fa7ba57"}

POST /api/org/webhooks {"url":"http://169.254.169.254/latest/metadata","label":"SSRF Metadata Test"}
→ HTTP 201 {"id":"cmp28wzsb0040o9vo71kbjev8","signingSecret":"76d5dfb7373869b5a8ab7a3235462de7"}

POST /api/org/webhooks {"url":"http://127.0.0.1:5432","label":"SSRF Postgres Test"}
→ HTTP 201 {"id":"cmp28wztq0041o9vo8i5pl5o1","signingSecret":"6d46226393fd6ef3046a47f640230ffc"}
```

**Root cause:** The `CreateWebhookSchema` uses `z.string().url()` which passes all three malicious URLs because they are syntactically valid URLs. There is zero IP/hostname allowlist or denylist applied before the URL is accepted and stored. When a contract event fires and the worker dispatches to registered webhooks, it will issue HTTP requests to these internal addresses — giving any org admin the ability to probe internal infrastructure (Redis on 6379, Postgres on 5432, AWS IMDS on 169.254.169.254).

**Fix required:** Before accepting a webhook URL, resolve the hostname and reject:
- Loopback addresses (127.0.0.0/8, ::1)
- Link-local addresses (169.254.0.0/16, fe80::/10)
- RFC-1918 private ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
- The literal hostnames `localhost`, `metadata.google.internal`, etc.

Also note: the same SSRF risk applies to `POST /api/org/notification-channels` (Slack/Teams webhook URLs), which uses the same pattern with `encrypt(parsed.data.webhookUrl)` and no URL validation beyond `z.string().url()`.

---

#### BUG-02: One-click unsubscribe blocked by authentication middleware

**Severity:** P0 BLOCKER — Broken Feature (unsubscribe links in emails are non-functional)

**File:** `/apps/web/middleware.ts` — PUBLIC_PATHS does not include `/api/user/unsubscribe`

**Evidence — live test results:**
```
GET /api/user/unsubscribe                         → HTTP 307 /login?callbackUrl=...
GET /api/user/unsubscribe?token=invalid_garbage   → HTTP 307 /login?callbackUrl=...
GET /api/user/unsubscribe?token=<expired>         → HTTP 307 /login?callbackUrl=...
```

**Root cause:** The Next.js middleware at `/apps/web/middleware.ts` redirects every request that lacks a `better-auth.session_token` cookie to `/login`. The unsubscribe endpoint `/api/user/unsubscribe` is not in `PUBLIC_PATHS`. Email clients follow the unsubscribe link without any cookie — they land on the login page, not the unsubscribe handler. The feature is dead for its intended use case.

The underlying token implementation in `/apps/web/lib/notifications/unsubscribe-token.ts` is correctly designed (HMAC-SHA256, 90-day expiry, timing-safe compare) — the token security is sound. The only problem is the middleware gate.

**Fix required:** Add `/api/user/unsubscribe` to the `PUBLIC_PATHS` array in `middleware.ts`. The route itself verifies the token cryptographically so no auth cookie is needed for safety.

```ts
const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/create-org",
  "/accept-invitation",
  "/api/auth",
  "/api/webhooks",
  "/api/user/unsubscribe",   // <-- add this
]
```

---

### P1 — MAJOR

#### BUG-03: CSV import — viewer role bypasses write scope gate

**Severity:** P1 MAJOR — Authorization violation

**File:** `/apps/web/app/api/import/csv/route.ts` lines 13–17

**Evidence — live test result:**
```
POST /api/import/csv (Viewer session, valid payload with Org A storageKey prefix)
→ HTTP 201 {"jobId":"cmp28y71j0042o9vopl9qvhd4","totalRows":1}
```

**Root cause:** The route calls `requireWriteScope(ctx)` but, as documented in the pre-briefed findings, `requireWriteScope` is a no-op for session tokens — it only rejects API keys that have read-only scope. Viewer session tokens pass through. There is no `requireRole(ctx.role, "member")` or higher gate. The result is that a viewer can enqueue a CSV import job, which will create contracts in the org if the storage key is valid.

Contrast with `POST /api/org/webhooks` which adds `requireRole(ctx.role, "admin")` after the `requireWriteScope` call — that pattern correctly blocks viewers. The CSV import route omits the role check entirely.

**Fix required:** Add `requireRole(ctx.role, "member")` (or "admin") after the `requireWriteScope` call in `/apps/web/app/api/import/csv/route.ts`.

---

#### BUG-04: SSRF risk on Slack/Teams notification channel URLs

**Severity:** P1 MAJOR — Security (same class as BUG-01, slightly lower impact since Slack/Teams URLs are less likely to be pointed at internal hosts than generic webhooks)

**File:** `/apps/web/app/api/org/notification-channels/route.ts` lines 10–13

**Evidence — code review:**
```ts
const CreateChannelSchema = z.object({
  channelType: z.enum(["slack", "teams"]),
  webhookUrl: z.string().url().max(2048),   // no IP/hostname validation
  label: z.string().min(1).max(100),
})
```

The `webhookUrl` field accepts any syntactically valid URL. An admin can register `http://localhost:6379` as a Slack webhook URL. When a contract event fires and the notification dispatcher POSTs to this channel, it will probe internal services. Same class of bug as BUG-01 but on the notification channel endpoint.

---

### P2 — MINOR

#### BUG-05: CSV hard cap at 1000 rows with no queueing path for larger imports

**Severity:** P2 MINOR — Functional limitation

**File:** `/apps/web/app/api/import/csv/preview/route.ts` line 7 (`MAX_ROWS = 1000`); `/apps/web/app/api/import/csv/route.ts` line 10 (`totalRows` schema `.max(1000)`)

The import system hard-rejects CSV files with more than 1000 rows at the preview stage. There is no streaming or chunked queue path. For an enterprise migration scenario this is a significant limitation. The 10k-row case from the test plan is silently rejected as `csv_too_large`. This is not a crash, but the spec context (M10 — Migration Tools) implies bulk import support.

---

#### BUG-06: Key rotation renders existing encrypted notification channels unreadable

**Severity:** P2 MINOR — Operational risk

**File:** `/apps/web/lib/notifications/crypto.ts`

The encryption scheme is AES-256-GCM with a single static key read from `NOTIFICATION_ENCRYPTION_KEY`. There is no key versioning or envelope. If the key is rotated (e.g., after a security incident), every stored `webhookUrl` and `signingSecret` in `OutboundWebhook` and `OrgNotificationChannel` becomes permanently undecryptable — the `decrypt()` call will throw "unsupported state or unable to authenticate data". The GET handler in `/api/org/webhooks/route.ts` already handles this gracefully (catches the error, returns `"(decryption error)"`), but the actual dispatch path in the worker presumably calls `decrypt()` without that safety net, causing silent delivery failures after rotation.

---

## Passed

- **GET /api/notifications** — returns correct `userId + organizationId` scoped data; unread count accurate (HTTP 200)
- **Org isolation on notifications** — Org B admin sees empty notifications list, not Org A's (HTTP 200, `[]`)
- **Org isolation on notification channels** — Org B admin sees empty channels list (HTTP 200, `[]`)
- **GET /api/org/notification-channels** — lists Org A's Slack channel correctly; encrypted URL not exposed in response
- **Unsubscribe token implementation** — HMAC-SHA256 signed with `BETTER_AUTH_SECRET`; 90-day TTL; timing-safe compare; expired/malformed tokens return null (code-verified in `/apps/web/lib/notifications/unsubscribe-token.ts`)
- **Encryption at rest** — AES-256-GCM (IV_LEN=12, TAG_LEN=16); authenticated encryption; `webhookUrl` and `signingSecret` encrypted before DB write (code-verified in `/apps/web/lib/notifications/crypto.ts`)
- **Viewer creates webhook — blocked** (HTTP 403)
- **CSV import — cross-org storage key** — prefix check `imports/${ctx.organizationId}/` correctly rejects Org B key (HTTP 422 `invalid_storage_key`)
- **CSV import — missing title column** — HTTP 422 `title_not_mapped`
- **CSV import — over row limit** — HTTP 422 with `maxRows: 1000`
- **CSV import — Zod schema validation** — invalid JSON and bad types properly rejected
- **GET /api/import/[jobId]** — org isolation code-verified: `job.organizationId !== ctx.organizationId` → 404
- **Webhook DELETE org isolation** — code-verified: `existing.organizationId !== ctx.organizationId` → 404

---

## Skipped

- **Live Slack delivery test** — cannot observe Slack API response from this environment; code path to the dispatcher not traced end-to-end through the worker
- **Webhook retry / exponential backoff** — worker dispatch logic not tested live; out of scope for this session
- **CSV import with actual file upload** — MinIO running; preview endpoint requires multipart; focused on the downstream `/api/import/csv` route validation
- **Notification preference PATCH/DELETE** — `/api/org/notification-channels/[id]` update endpoint not tested (time constraint)
- **Import from PandaDoc / Google Drive / CLM export** — separate import routes; only CSV path covered

---

## Recommendations

1. **Fix BUG-01 and BUG-04 together** — write a shared `validateWebhookUrl(url: string): boolean` helper in `lib/notifications/` that resolves the hostname and blocks RFC-1918, loopback, and link-local. Call it from both `POST /api/org/webhooks` and `POST /api/org/notification-channels`.

2. **Fix BUG-02 immediately** — one-line change in `middleware.ts`; unblocks the entire email unsubscribe feature with no security risk since the route self-verifies its token.

3. **Fix BUG-03** — add `requireRole(ctx.role, "member")` to `/api/import/csv/route.ts`. Audit the other import routes (pandadoc, gdrive, clm-export) for the same missing role check; they likely share the pattern.

4. **Document key rotation procedure** — even if not fixing BUG-06 pre-launch, add a runbook: how to re-encrypt stored secrets after a key rotation. Without it, any key change causes silent notification delivery failures with no user-visible error.

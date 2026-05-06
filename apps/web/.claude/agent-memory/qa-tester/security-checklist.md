---
name: ClauseFlow M0 security checklist
description: Project-specific security items to always verify in ClauseFlow
type: feedback
---

## Org isolation (CRITICAL)

Every route that returns or mutates data must run inside `requestContext.run(ctx, ...)`. The Prisma middleware injects `organizationId` from AsyncLocalStorage — without this wrapper, no org-scoping happens.

Verified M0 routes: all 14 routes correctly call `resolveAuth` AND `requestContext.run`.

## API key material never in GET response

`GET /api/org/api-keys` must never return `keyHash` or `lookupHash`. The select clause in the route explicitly excludes them. Verify on any new key-related query.

## Cross-org manual check (not just middleware)

For operations on named resources (member, apiKey), routes do a manual `organizationId !== ctx.organizationId` check AFTER the middleware scope. This is defense-in-depth. Both must be present.

## File upload magic bytes

The upload route validates magic bytes (PDF: `%PDF` = 25 50 44 46; DOCX: `PK` = 50 4B). It does NOT trust the mimeType header. Any new file type support must add a magic byte check.

## Bearer token prefix guard

`resolveAuth` checks `bearer?.startsWith("cf_live_")` before doing a DB lookup. This prevents any non-prefixed string from hitting the database, including SQL injection attempts in the Authorization header.

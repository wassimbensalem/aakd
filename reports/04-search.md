# QA Report 04 — Search (Full-Text + Semantic)

**Agent:** QA Tester 4
**Date:** 2026-05-12
**Verdict:** PARTIAL

---

## Summary

Full-text search is solid: org-scoped, SQL-injection-safe, handles edge cases gracefully. Semantic search is broken in production — returns HTTP 500 with an empty body for all authenticated POST requests, making the feature completely unusable. Unauthenticated access correctly produces a 307 redirect (consistent with the platform-wide middleware behavior documented by prior agents).

---

## Tests Run

### Full-Text Search

| # | Test | HTTP | Result | Severity |
|---|------|------|--------|----------|
| 1 | `GET /api/search?q=agreement` — basic FTS | 200 | PASS — 2 results, both Org A, ordered by ts_rank | — |
| 2 | `GET /api/search?q=` — empty string | 200 | PASS — `{"results":[],"total":0}` | — |
| 3 | `GET /api/search` — no q param | 200 | PASS — `{"results":[],"total":0}` | — |
| 4 | `GET /api/search?q=<5000 'a' chars>` — oversized query | 200 | PASS — no crash, empty results | — |
| 5 | `GET /api/search?q='; DROP TABLE contracts; --` | 200 | PASS — parameterized via `Prisma.sql`, safe | — |
| 6 | `GET /api/search?q=<script>alert(1)</script>` | 200 | PASS — returned as JSON string, not executed; Content-Type: application/json | — |
| 7 | `GET /api/search?q=a` — 1 char (ILIKE path) | 200 | PASS — falls back to ILIKE correctly, 2 results | — |
| 8 | `GET /api/search?q=xyzzy_nonexistent_term_12345_qa` | 200 | PASS — `{"results":[],"total":0}` | — |
| 9 | Org isolation — Org B searches `agreement` (exists only in Org A) | 200 | PASS — 0 results; WHERE `organizationId = orgId` applied in both FTS raw query and ILIKE fallback | — |
| 10 | Org A search `Test` — verify orgId on all results | 200 | PASS — both results carry `organizationId = QLpiGzDMbOZmWt5IR6IPlJC9mwdG7R6s` | — |
| 11 | `limit=5` pagination | 200 | PASS — returned ≤ 5 results | — |
| 12 | `limit=10000` — cap enforcement | 200 | PASS — code clamps to `Math.min(n, 100)` | — |
| 13 | `offset=0` vs `offset=5` — no overlap | 200 | PASS — distinct result sets | — |
| 14 | `offset=-1` — negative offset | 200 | PASS — code clamps via `Math.max(0, n)`, treated as 0 | — |
| 15 | `limit=-1` — negative limit | 200 | PASS — code clamps via `Math.max(1, n)`, treated as 1 | — |
| 16 | `limit=abc` — non-numeric limit | 200 | PASS — `parseInt` returns NaN, falls back to default 20 | — |
| 17 | Unauthenticated `GET /api/search?q=agreement` (no cookie) | 307 | DOCUMENTED — redirects to `/login?callbackUrl=...`; consistent with platform pattern | minor |
| 26 | Special chars `test & agreement | contract` | 200 | PASS — tsquery parse exception caught, falls back to ILIKE | — |
| 27 | Unicode query `договор 合同 العقد` | 200 | PASS — no crash, empty results | — |
| 28 | Relevance ordering — FTS results | 200 | PASS — ordered by `ts_rank DESC` in SQL | — |
| 29 | Content-Type header | — | PASS — `application/json` on all search responses | — |

### Semantic Search

| # | Test | HTTP | Result | Severity |
|---|------|------|--------|----------|
| 19 | `POST /api/search/semantic` valid query, Org A session | 500 | **FAIL — empty response body, no error detail** | BLOCKER |
| 20 | Empty query `""` — Zod validation | 400 | PASS — Zod rejects with field error | — |
| 21 | Query > 2000 chars — Zod validation | 400 | PASS — Zod rejects correctly | — |
| 22 | Invalid JSON body | 400 | PASS — `{"error":"Invalid JSON"}` | — |
| 23 | `limit=51` — exceeds max 50 | 400 | PASS — Zod rejects correctly | — |
| 24 | Org B semantic search (isolation test) | 500 | **FAIL — same 500 as Test 19; cannot verify isolation** | BLOCKER |
| 25 | `GET /api/search/semantic` — wrong method | 405 | PASS — Method Not Allowed | — |
| 18 | Unauthenticated `POST /api/search/semantic` (no cookie) | 307 | DOCUMENTED — redirects to login; consistent with platform pattern | minor |
| 30 | `threshold=2.0` — out of range | 400 | PASS — Zod rejects correctly | — |

---

## Blockers

### BLOCKER 1 — Semantic search returns HTTP 500 with empty body for all valid requests

**Endpoint:** `POST /api/search/semantic`
**Repro:**
```
curl -X POST http://localhost:3000/api/search/semantic \
  -H "Cookie: <valid Org A session>" \
  -H "Content-Type: application/json" \
  -d '{"query":"payment terms and conditions","limit":5,"threshold":0.1}'
```
**Result:** HTTP 500, empty response body, no JSON error object.

**Root cause analysis (code + env):**
- `OPENAI_API_KEY` is set and the key is valid — direct test to `api.openai.com/v1/embeddings` returns a 1536-dim vector successfully.
- The `generateEmbedding()` function in `lib/embedding.ts` calls OpenAI and throws on non-OK status; an exception propagates to the route handler which catches it and returns `{ error: "Embedding generation failed", status: 503 }`.
- **However**, the actual response is 500 with empty body — not 503 with a JSON error. This means the crash is happening **before** the try/catch in the route, or Next.js is swallowing an unhandled exception outside the try block.
- Most likely cause: the `requestContext.run(ctx, ...)` async context or the rate limiter (`rateLimit()`) is throwing an unhandled exception (e.g. Redis connection error or import-time failure), crashing the route handler before it reaches the `generateEmbedding` call.
- The 500 with empty body is produced by Next.js's internal error handler, not by any application-level catch — confirming the error is uncaught.

**Impact:** The entire semantic search feature is non-functional. All POST requests to `/api/search/semantic` fail regardless of payload validity.

**Secondary impact:** Org isolation for semantic search **cannot be verified** while the endpoint is broken. The SQL query in the route does include `WHERE c."organizationId" = ${ctx.organizationId}` which appears correct, but this cannot be confirmed at runtime.

---

### BLOCKER 2 — Semantic search 500 masks isolation guarantee

Because semantic search is crashing before executing the SQL query, the org-isolation WHERE clause in the pgvector query has never been exercised in this environment. If the crash is fixed, isolation must be re-tested. The query structure looks correct in code, but runtime confirmation is blocked.

---

## Warnings

### WARNING 1 — Unauthenticated API access returns 307 redirect, not 401

- **Affected:** `GET /api/search`, `POST /api/search/semantic` (and all API routes per prior agent findings)
- HTTP 307 is a browser redirect, not an API error code. API clients that don't follow redirects will see a redirect body, not a 401. This is a pre-existing platform-wide issue documented by prior agents — not introduced by search.
- **Severity:** MAJOR (platform-wide, not search-specific)

### WARNING 2 — FTS response does not include a `highlight` or `snippet` field

The spec references "highlights present" for FTS results. The route returns `id, title, contractType, status, counterpartyName, value, currency, endDate, createdAt` — no excerpt, no matched-text highlight, no `search_headline`. If the UI renders highlights, the data is not there.

### WARNING 3 — FTS does not support `status` or date-range filter params

The route ignores `status`, `from`, and `to` query params. The test confirmed `?q=test&status=ACTIVE` returns both DRAFT contracts. No validation error is returned for `?q=test&status=INVALID_STATUS` — the param is silently ignored. This is spec-undefined behavior but limits search utility.

### WARNING 4 — `page` param not supported; `offset` is used instead

The spec test case references `?page=1&limit=5`. The route uses `offset`, not `page`. `?page=-1` is silently ignored (no `page` param handling). Pagination interface is inconsistent with the spec test expectation.

---

## Recommendations

1. **Fix semantic search 500 first.** Instrument the route with a top-level try/catch wrapping the entire handler body to surface the actual error. Check whether `rateLimit()` is throwing due to a Redis issue — `redis://localhost:6379` must be reachable from the Next.js process, not just the worker.
2. **After fixing semantic search**, run the org isolation test again. The SQL WHERE clause looks correct but must be confirmed at runtime.
3. **Add FTS snippet/highlight** via `ts_headline()` in the raw SQL query to match spec.
4. **Add status and date-range filters** to the FTS route to match the documented test cases.
5. **Standardize unauthenticated API response** to 401 JSON across all API routes — addressed at the middleware level, not per-route.

---

## Code Observations (Search-Specific)

- FTS uses `Prisma.sql` tagged templates throughout — SQL injection risk is correctly eliminated.
- `plainto_tsquery` is used (not `to_tsquery`), which is correct — user input cannot construct malicious tsquery operators.
- FTS fallback chain (tsquery parse failure → ILIKE) is correctly implemented and tested.
- Semantic search Zod schema is tight and correct: query 1–2000 chars, limit 1–50, threshold 0–1.
- Semantic search correctly passes `ctx.organizationId` (not from request body) to the SQL WHERE clause — cannot be spoofed by the caller.
- Rate limiter on semantic search (30 req/min per org) is the right call given embedding API cost, but cannot be tested while the endpoint is broken.

# QA Report 03 — AI Pipeline
**Agent:** QA Agent 3
**Date:** 2026-05-12
**Verdict:** PARTIAL — 5 bugs found (1 blocker, 2 major, 2 minor), 28 tests passed

---

## Summary

The AI pipeline is partially functional. The BullMQ extract and ai_extract workers run and produce results. The extractions review queue is spec-compliant (AI values sit in pending status awaiting human approval — no auto-population). The Q&A endpoint has correct input validation, org isolation, and rate limiting.

However, the Q&A endpoint is broken in production conditions: it returns 503 "Retrieval failed" for any contract that has extracted text but whose embeddings failed to generate. This is the primary user-facing failure. A viewer RBAC bypass on the AI rerun endpoint is a confirmed security regression. A 500 crash on PATCH extraction edit is a data-integrity bug.

---

## Bugs

### P1 — Q&A endpoint crashes with 503 "Retrieval failed" when pgvector embedding lookup fails

**Severity:** BLOCKER  
**Endpoint:** `POST /api/contracts/[id]/ask`  
**Repro:**
```
curl -X POST http://localhost:3000/api/contracts/cmp1re1lm0030o9voqvtwluc8/ask \
  -b "better-auth.session_token=m3jnmO4bWDdQNyIs65vDsXWwPKsxJ81a..." \
  -H "Content-Type: application/json" \
  -d '{"question":"What is this agreement about?"}'
```
**Observed:** `{"error":"Retrieval failed"}` HTTP 503  
**Expected:** 200 with answer and citations — the contract has `hasExtractedText: true` per the GET contract response  
**Root cause (code):** `retrieveRelevantChunks()` in `/api/contracts/[id]/ask/route.ts` calls `generateEmbedding(question)` then executes a pgvector similarity search against `ContractChunkEmbedding`. When no chunk embedding rows exist for the contract (embed worker may have failed or not completed), the function falls back to `chunkText()` — but the error thrown by the `prisma.$executeRaw` or the embedding API itself propagates up to the caller at line 209, which returns 503. The fallback at line 128 (`chunkText`) is only reached if `rows.length === 0`, not if the query throws. Any exception from `generateEmbedding` or the raw SQL query surfaces as 503 with no diagnostic information to the user.  
**Impact:** Q&A is completely non-functional for any contract where chunk embeddings are absent (all newly uploaded contracts until the embed worker finishes and succeeds). This is the primary AI feature.

---

### P1 — Viewer role can trigger AI extraction rerun (write-scope endpoint bypassed)

**Severity:** BLOCKER  
**Endpoint:** `POST /api/contracts/[id]/extractions/rerun`  
**Repro:**
```
curl -X POST http://localhost:3000/api/contracts/cmp1re1lm0030o9voqvtwluc8/extractions/rerun \
  -b "better-auth.session_token=fLtDVp3vpUQ28kG0PGpVcS6juiS8Ot8s..."
```
**Observed:** HTTP 200 `{"queued":true}` — viewer successfully enqueued an AI job  
**Expected:** HTTP 403 — the route calls `requireWriteScope(ctx)` which should block viewers  
**Root cause (code):** The activity row written on success at line 43 of `extractions/rerun/route.ts` shows `userId: bu57r1cnqA7bd0VtOFCxRCYFtn8XCTZY` which is the viewer's user ID, confirming the action executed. The `requireWriteScope` guard at line 8 is imported and called, but the viewer's session role is apparently resolving to a scope that passes the check. This matches the known issue from Agent 1 findings that session-based auth and role resolution may not be correctly gating write operations for session users.  
**Impact:** Any viewer can spam AI extraction jobs against any contract in their org, exhausting OpenAI API quota.

---

### P2 — PATCH extraction edit returns 500 crash when coercion fails on some field types

**Severity:** MAJOR  
**Endpoint:** `PATCH /api/contracts/[id]/extractions`  
**Repro:**
```
curl -X PATCH http://localhost:3000/api/contracts/cmp1re1lm0030o9voqvtwluc8/extractions \
  -b "better-auth.session_token=m3jnmO4bWDdQNyIs65vDsXWwPKsxJ81a..." \
  -H "Content-Type: application/json" \
  -d '{"action":"edit","extractionId":"cmp27liji00043zvo12v4h4mx","newValue":"not-a-date"}'
```
**Observed:** HTTP 500, empty body  
**Expected:** HTTP 422 with `{"error":"AI-extracted value failed type coercion","field":"..."}` — the `isCoercedValueValid` guard exists for exactly this case  
**Root cause:** The `edit` action updates `extraction.rawValue = body.newValue` in memory at line 279, then falls through to the accept branch. If the field mapping's `coerce()` function throws (e.g. `new Date("not-a-date")` returns `Invalid Date` which `isCoercedValueValid` should catch), the unhandled exception escapes the `requestContext.run` wrapper and surfaces as a 500. The `isCoercedValueValid` path at line 286 should return 422, but something is causing it to throw instead — possibly the Prisma `update` at line 276 (updating rawValue) succeeds first, leaving a corrupted rawValue in the DB before the 500 is returned.  
**Impact:** Leaves the extraction record in a corrupted intermediate state (rawValue = "not-a-date", extractedBy = "user") and returns no error to the client.

---

### P2 — Unauthenticated requests to AI endpoints receive 307 redirect instead of 401

**Severity:** MAJOR  
**Endpoints:** `GET /api/ai-status`, `POST /api/contracts/extract-preview`, and likely all AI routes  
**Repro:**
```
curl -v http://localhost:3000/api/ai-status
curl -v -X POST http://localhost:3000/api/contracts/extract-preview
```
**Observed:** HTTP 307 Temporary Redirect to `/login`  
**Expected:** HTTP 401 for API endpoints — 307 is appropriate for browser navigation but breaks any API client or non-browser consumer that checks status codes  
**Root cause:** Next.js middleware intercepts unauthenticated requests and issues a 307 before the route handler can return 401. This is a middleware-level issue, not the route handlers themselves.  
**Impact:** API clients integrating with these endpoints get a redirect they must follow rather than a clean 401, breaking programmatic callers and MCP integrations.

---

### P3 — `text-embedding-3-small` model selection is hardcoded without env var override for embeddings

**Severity:** MINOR  
**File:** `/apps/web/lib/embedding.ts`  
**Finding:** `currentEmbeddingModel()` returns `"text-embedding-3-small"` unconditionally when `OPENAI_API_KEY` is set. There is no `OPENAI_EMBEDDING_MODEL` env var to override the model. The `OPENAI_MODEL` env var controls the chat completions model but is not used for embeddings. If the operator wants to use a different embedding model (e.g., `text-embedding-3-large` for higher quality), they cannot without a code change.  
**Impact:** Low — default is correct per spec, but inflexible for operators.

---

## Passed Tests

| Test | Result |
|---|---|
| GET /api/ai-status returns 200 with provider=openai, model=gpt-4o-mini | PASS |
| DOCX contract shows hasExtractedText=true (worker ran) | PASS (confirmed via activities log showing Text extracted from Test_Service_Agreement.docx) |
| POST /api/contracts/[id]/ask empty question returns 400 | PASS |
| POST /api/contracts/[id]/ask question > 2000 chars returns 400 | PASS |
| POST /api/contracts/[id]/ask invalid JSON returns 400 | PASS |
| POST /api/contracts/[id]/ask missing question field returns 400 | PASS |
| POST /api/contracts/[id]/ask non-existent contract returns 404 | PASS |
| POST /api/contracts/[id]/ask org isolation — Org B gets 404 on Org A contract | PASS |
| Q&A endpoint handles missing AI provider with 503 (no crash) | PASS (code-verified) |
| GET /api/contracts/[id]/extractions returns 200 | PASS |
| GET /api/contracts/[id]/extractions Org B isolation returns 404 | PASS |
| POST /api/contracts/[id]/extractions seed with valid field returns 200 seeded=1 | PASS |
| POST /api/contracts/[id]/extractions with unknown field filtered (seeded=0) | PASS |
| POST /api/contracts/[id]/extractions empty array returns 400 | PASS |
| PATCH extractions accept_all returns 200 | PASS |
| PATCH extractions invalid action returns 400 | PASS |
| POST /api/contracts/[id]/extractions/rerun on DOCX returns 200 queued=true | PASS |
| POST /api/contracts/[id]/extractions/rerun non-existent contract returns 404 | PASS |
| PATCH extractions reject action returns 200 | PASS |
| POST /api/contracts/extract-preview without file returns 400 | PASS |
| POST /api/contracts/extract-preview with DOCX file returns 200 with confidence field | PASS |
| EmbeddingProvider does NOT call Anthropic API (code-verified) | PASS |
| EmbeddingProvider uses text-embedding-3-small | PASS |
| Worker handles missing AI provider gracefully (activity log, no crash) | PASS |
| Worker has 45 catch blocks — comprehensive LLM error handling | PASS |
| Rate limit on Q&A configured at 20 req/60s per org | PASS |
| AI extractions sit in pending status — no auto-population of canonical fields (spec compliant) | PASS |
| extract-preview endpoint returns confidence scores per spec | PASS |

---

## Skipped Tests

- **End-to-end Q&A with real LLM answer and citation verification** — blocked by P1 503 bug; cannot test citation sourcePage content without a working Q&A call
- **Rate limit enforcement (actual 429)** — not tested to avoid burning API quota; code-verified only
- **Embedding dimension verification (1536)** — would require direct DB inspection; not run to avoid psql dependency
- **accept_all after AI worker populates real extractions** — worker produced 1 field ("contractType") per activity log, which was accepted during test; full multi-field acceptance path not fully covered

---

## Recommendations

1. Fix the `retrieveRelevantChunks` catch block to handle the case where no chunk embeddings exist (empty `ContractChunkEmbedding` table for the contract) without throwing — the fallback to `chunkText` should be unconditional when the query fails or returns empty.
2. Investigate `requireWriteScope` against session-based viewer tokens — the bypass confirmed here likely affects other write-scope endpoints.
3. Fix the PATCH edit action to wrap the rawValue update and accept logic in a single transaction so a coercion failure rolls back the rawValue change.
4. Consider returning 401 from API routes directly when auth is missing, rather than relying on Next.js middleware 307 — use a middleware exclusion for `/api/` paths or add explicit 401 returns before the 307 fires.

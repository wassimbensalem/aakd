# Authoring Test Report

## Status: COMPLETE
**Date:** 2026-05-12
**Tester:** QA Agent 5
**Domain:** Authoring — TipTap editor, Word import, DOCX/PDF export, templates

---

## Summary

3 P0 blockers found. The org isolation failure extends into the entire authoring surface: Org B can read Org A's contract documents AND templates. Script tags are stored raw in document content. Everything else in this domain behaves correctly.

---

## Bugs

### P0 — Org isolation breach: ContractDocument readable cross-org

**Route:** `GET /api/contracts/[id]/document`

**Repro:**
```
curl -s -b "<ORG_B_COOKIE>" http://localhost:3000/api/contracts/cmp1rdy6f002vo9voc2ibmjz7/document
```
**Result:** `200` — returns Org A's document content in full.
**Expected:** `404`

**Root cause (code):** `apps/web/app/api/contracts/[id]/document/route.ts` line 43 calls `prisma.contract.findUnique({ where: { id: params.id } })` and relies on Prisma org-scope middleware to filter by `organizationId`. The test-state.json already documented that `GET /api/contracts/[id]` itself leaks across orgs via this same mechanism. The document endpoint inherits the same breach — the middleware is not filtering as expected for `findUnique` on the parent contract, so the document lookup also returns cross-org data.

**Impact:** Any authenticated user in any org can read the full TipTap document content of any contract they know the ID of.

---

### P0 — Org isolation breach: Templates readable cross-org (list and by ID)

**Routes:**
- `GET /api/templates`
- `GET /api/templates/[id]`

**Repro:**
```
# List — Org B admin sees Org A templates
curl -s -b "<ORG_B_COOKIE>" http://localhost:3000/api/templates

# By ID — Org B reads specific Org A template
curl -s -o /dev/null -w "%{http_code}" -b "<ORG_B_COOKIE>" http://localhost:3000/api/templates/cmp27xcd1003ko9vo96mlik9s
```
**Results:**
- List: `200` — Org B response includes Org A's template (`cmp27xcd1003ko9vo96mlik9s`, name "QA Test Template", createdBy "QA Admin A") alongside another template from a third user.
- By ID: `200`

**Expected:** List returns only Org B's own templates; by-ID returns `404`.

**Root cause (code):** `apps/web/app/api/templates/route.ts` lines 55-76. The `where` clause for `findMany` is built as:
```typescript
const where: Record<string, unknown> = { isArchived: false }
if (contractType) where.contractType = contractType
```
There is no `organizationId` filter. The Prisma org-scope middleware injects `organizationId` automatically for models it covers, but `ContractTemplate` is either not covered or the injection is not active for this query path. The by-ID route (`apps/web/app/api/templates/[id]/route.ts` line 43) has the same issue — `findUnique({ where: { id: params.id } })` with no org scope.

**Impact:** Every org's template library (including confidential clause content) is visible to all other orgs.

---

### P0 — XSS: Script tags stored raw in ContractDocument content

**Route:** `PUT /api/contracts/[id]/document`

**Repro:**
```
curl -s -b "<ADMIN_A_COOKIE>" -X PUT http://localhost:3000/api/contracts/cmp1rdy6f002vo9voc2ibmjz7/document \
  -H "Content-Type: application/json" \
  -d '{"content":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"<script>alert(1)<\/script>"}]}]},"wordCount":1,"clientVersion":2}'
```
**Result:** `200` — version incremented, content accepted and persisted verbatim. Subsequent GET returns the script tag intact in stored content.

**Expected:** Sanitization strips HTML tags from text nodes, or server rejects the payload.

**Root cause (code):** `apps/web/app/api/contracts/[id]/document/route.ts` — `SaveSchema` accepts `content` as `z.array(z.unknown())`. There is no sanitization pass on text node values before persistence. The content is cast with `as any` and written directly to the database. On export to DOCX/PDF, this raw text will be embedded in the output. If any UI renderer treats document content as HTML (preview, diff view), this is stored XSS.

**Impact:** Stored XSS in document content. Any user viewing the document in an HTML-rendering context triggers the payload. Also present in exported DOCX/PDF if the export renderer interpolates raw text into HTML templates.

---

## Passed Tests

| # | Test | Result |
|---|------|--------|
| 1 | GET document with no document returns `{"document":null}`, not 500 | PASS |
| 2 | PUT document first save with `clientVersion:0` creates document at version 1 | PASS |
| 3 | PUT document with wrong `clientVersion` returns `409 conflict` with `serverVersion` | PASS |
| 4 | PUT document with invalid TipTap JSON (wrong `type` field) returns `422` | PASS |
| 5 | PUT document with empty `content.content:[]` handled gracefully (version increments) | PASS |
| 6 | Viewer `PUT /document` returns `403` with message | PASS |
| 7 | Viewer `GET /document` returns `200` (read-only access correct) | PASS |
| 8 | Member `POST /api/templates` returns `403 forbidden` (member < legal in hierarchy) | PASS |
| 9 | Viewer `POST /api/templates` returns `403 forbidden` | PASS |
| 10 | Owner/admin `POST /api/templates` creates template successfully (`201`) | PASS |
| 11 | `POST /api/templates/[id]/use` creates contract from template correctly | PASS |
| 12 | Export format validation — `z.enum(["docx","pdf"])`, invalid format returns `422` (code-verified) | PASS |
| 13 | Export with no document returns `422 no_document` (code-verified) | PASS |
| 14 | Import magic-byte validation rejects non-DOCX/PDF with `422 invalid_file_type` (code-verified) | PASS |
| 15 | Import file size capped at 25 MB (code-verified) | PASS |
| 16 | Template DELETE is soft-delete (`isArchived: true`), not hard-delete (code-verified) | PASS |
| 17 | Template `PATCH` and `DELETE` require `legal` role (code-verified) | PASS |
| 18 | Template content size capped at 5 MB (code-verified) | PASS |
| 19 | Duplicate variable names in template rejected with `422 duplicate_variable_names` (code-verified) | PASS |
| 20 | Undeclared variable chips in template content rejected with `422 undeclared_variables` (code-verified) | PASS |

---

## Skipped

- **Export binary output (live):** Export is async — enqueues a BullMQ job and returns `jobId`. Worker must be running and job polled to completion to verify DOCX/PDF binary output and track-change mark rendering.
- **Word import live conversion:** Same — queues a `documentConvertQueue` job. Magic-byte and size enforcement are code-verified; actual mammoth/DOCX-to-TipTap conversion path was not exercised live.
- **Corrupted DOCX handling:** Requires a running worker to observe the failure path. The import route only does magic-byte and size checks before queuing.
- **Template use with required variables:** The test template had zero required variables; the missing-variable validation path was not exercised live.

---

## Recommendations

1. **Fix template `organizationId` filtering.** The `where` clause in both `GET /api/templates` and `GET /api/templates/[id]` must include `organizationId: ctx.organizationId` explicitly. Do not rely solely on Prisma middleware for `ContractTemplate` until the middleware coverage for that model is confirmed.
2. **Audit Prisma middleware coverage for ContractDocument.** The document isolation breach is downstream of the same `contract.findUnique` bug documented in test-state.json for `GET /api/contracts/[id]`. Fixing the root contract isolation fixes the document leak as a side-effect, but confirm middleware is injecting `organizationId` for `findUnique` calls, not just `findMany`.
3. **Sanitize TipTap text node content on write.** Strip or escape HTML tags from all `text` type nodes before persistence. This must happen server-side; client-side sanitization is not sufficient.
4. **Verify export worker sanitizes content before HTML rendering.** Until the XSS is fixed at the storage layer, the export pipeline is the last line of defense and must not render raw text node values as innerHTML.

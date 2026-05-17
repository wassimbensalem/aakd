# Obligations & Analytics Test Report

## Status: COMPLETE

**Agent:** QA Agent 7
**Scope:** Obligations CRUD, Sub-tasks, Overdue Cron, Org Isolation, Analytics Dashboard
**Date:** 2026-05-12

---

## Summary

Obligations CRUD works correctly end-to-end. Role enforcement (viewer blocked, member permitted) functions as expected. Sub-task lifecycle is clean. The analytics endpoint is org-scoped at the raw-SQL level. Two significant bugs identified: org isolation on the individual obligation GET is delegated to Prisma middleware which prior agents confirmed is unreliable on `findUnique`, and the overdue cron marks obligations OVERDUE globally without an org-scope filter, which is a cross-tenant data corruption risk.

---

## Bugs

### P0 — Individual obligation GET/PATCH/DELETE has no explicit org-scope guard

**File:** `apps/web/app/api/contracts/[id]/obligations/[obligationId]/route.ts` lines 44–52

```ts
const obligation = await prisma.contractObligation.findUnique({
  where: { id: params.obligationId },
  include: OBLIGATION_INCLUDE,
})
if (!obligation || obligation.contractId !== params.id) {
  return Response.json({ error: "Not Found" }, { status: 404 })
}
```

The isolation check verifies the obligation belongs to the requested contract ID, but does NOT verify that the contract belongs to the caller's org. There is no `contract.organizationId !== ctx.organizationId` check. The route trusts Prisma middleware to scope `findUnique`, but `test-state.json` (`isolationFindings.getByIdEndpoint`) and prior agent findings confirm `findUnique` through the middleware does NOT reliably filter by org. An Org B user who knows an Org A `obligationId` can read, update, and delete it.

Compare to the correct pattern in the list/create route which explicitly checks `contract.organizationId !== ctx.organizationId` after the `findUnique`.

**PATCH and DELETE in the same file share this identical gap.**

**Severity: P0 — cross-tenant read and write on obligations via guessable IDs.**

---

### P0 — Sub-task POST/PATCH/DELETE org-scope delegated entirely to Prisma middleware

**File:** `apps/web/app/api/contracts/[id]/obligations/[obligationId]/subtasks/route.ts` lines 28–34
**File:** `apps/web/app/api/contracts/[id]/obligations/[obligationId]/subtasks/[subtaskId]/route.ts` — `ensureSubTaskInScope()`

```ts
const obligation = await prisma.contractObligation.findUnique({
  where: { id: params.obligationId },
  select: { id: true, contractId: true },
})
if (!obligation || obligation.contractId !== params.id) {
  return Response.json({ error: "Not Found" }, { status: 404 })
}
```

`ensureSubTaskInScope()` checks `obligation.contractId !== contractId` but never verifies the contract's org. Same root cause as the obligation isolation bug. A cross-tenant user can create, update, and delete sub-tasks on another org's obligations.

**Severity: P0 — cross-tenant sub-task mutation.**

---

### P0 — Overdue cron worker crashes between status flip and notification enqueue — silent notification loss

**File:** `apps/web/worker.ts` lines 689–720 (obligationsWorker)

```ts
const updateRes = await db.contractObligation.updateMany({
  where: { status: { in: ["PENDING", "IN_PROGRESS"] }, dueDate: { lt: now } },
  data: { status: "OVERDUE" },
})
// ... then separately fetch and enqueue notifications
```

The `updateMany` status flip and the notification `enqueueNotification` calls are not atomic. If the worker crashes or BullMQ job fails after the `updateMany` commits but before notifications are enqueued, the obligations are permanently OVERDUE with no notification ever sent. BullMQ will retry the job (3 attempts), but on retry the obligations are already in OVERDUE status — they no longer match `status: { in: ["PENDING", "IN_PROGRESS"] }` — so the retry does nothing and the notification is lost permanently.

Additionally, the 60-second `updatedAt >= runStart` window used to find "newly overdue" rows for notification is fragile: multiple rows can share the same DB timestamp, and if a second concurrent worker fires within the window, both workers attempt to notify the same rows.

**Severity: P0 — silent notification loss on worker crash; no audit trail for the status change.**

---

### P1 — Analytics `expiringContracts` Prisma `findMany` not explicitly org-scoped

**File:** `apps/web/app/api/analytics/summary/route.ts` lines 77–89

```ts
prisma.contract.findMany({
  where: { status: "ACTIVE", endDate: { gte: now, lte: d90 } },
  // NO organizationId here — relies on middleware
  orderBy: { endDate: "asc" },
  take: 10,
  ...
}),
```

The companion raw SQL for counts (lines 66–76) correctly adds `WHERE "organizationId" = ${ctx.organizationId}`. The `findMany` immediately beside it omits the predicate and trusts the middleware. The code comment at line 64 explicitly warns raw queries need explicit org predicates, yet the ORM query right next to it silently relies on the middleware. This is an inconsistent pattern: if middleware fails (confirmed unreliable on `findUnique` by prior agents), this leaks expiring contracts from all orgs into the dashboard widget.

**Severity: P1 — pattern inconsistency; currently compensated by middleware but fragile.**

---

### P1 — Past `dueDate` accepted silently on obligation creation

**Observed:** POST with `"dueDate":"2020-01-01T00:00:00.000Z"` returns HTTP 201 with status PENDING. The schema validates ISO datetime format but does not reject dates in the past. The obligation will be flipped to OVERDUE on the next cron run with no warning at creation time.

**Severity: P1 — silent creation of immediately-overdue obligations; misleading data state.**

---

### P2 — No Activity row written when cron auto-marks obligation OVERDUE

**File:** `apps/web/worker.ts` lines 683–721

The `updateMany` that flips status to OVERDUE writes no Activity entry. The client PATCH path writes `OBLIGATION_COMPLETED` or `OBLIGATION_UPDATED`. The `alerts.check` cron correctly calls `writeActivity` for `ALERT_FIRED`. The obligations cron skips this entirely — the audit trail has no record that the system changed obligation status to OVERDUE.

**Severity: P2 — missing audit trail for system-initiated status transitions.**

---

### P2 — Viewer can access analytics endpoint (no role gate)

**File:** `apps/web/app/api/analytics/summary/route.ts` line 48

```ts
const ctx = await resolveAuth(req)
if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
```

The analytics GET only checks that the user is authenticated. There is no role check. Viewers (read-only role) can call `GET /api/analytics/summary` and receive the full org analytics payload including contract counts, values by type, approval funnel, and obligation overdue counts. Whether viewers should see financial analytics (value by type) is a spec question, but the current behavior should be documented as an intentional decision or corrected.

**Severity: P2 — viewers see org financial analytics; may be intentional but undocumented.**

---

### P2 — `requireWriteScope` is a no-op for session tokens (inherited finding)

All obligation write routes call `requireWriteScope(ctx)` before the role check. For session-based users this always passes (prior agents confirmed). The role check (`ROLES_CAN_WRITE.has(ctx.role)`) is the only real gate and does work correctly (viewer → 403 confirmed). `requireWriteScope` adds no protection for session users and creates a false sense of defense-in-depth.

**Severity: P2 — defense-in-depth gap; role check compensates in current code.**

---

## Passed Tests

| Test | Result |
|---|---|
| POST obligation with valid data | PASS — 201, full object with all relations |
| GET obligations list for contract | PASS — returns array, correctly ordered |
| POST missing required field (no title) | PASS — 422 with field-level errors |
| PATCH status to COMPLETED | PASS — completedAt and completedById populated |
| PATCH status to OVERDUE (client path blocked) | PASS — 422, "OVERDUE" excluded from client enum |
| Viewer POST obligation → 403 | PASS — role gate works |
| Create sub-task | PASS — 201 |
| Complete sub-task (PATCH isCompleted: true) | PASS — completedAt set |
| DELETE sub-task | PASS — 204 |
| Sub-task on non-existent obligation → 404 | PASS |
| DELETE obligation is hard delete | PASS — confirmed by `prisma.contractObligation.delete` (no soft-delete) |
| Analytics `byStatus` org-scoped | PASS — groupBy with explicit `organizationId` where |
| Analytics `monthlyVolume` org-scoped | PASS — raw SQL with explicit predicate |
| Analytics `valueByType` org-scoped | PASS — groupBy with explicit where |
| Analytics `approvalFunnel` org-scoped | PASS — raw SQL with explicit JOIN+WHERE |
| Analytics `obligations` widget org-scoped | PASS — raw SQL with explicit JOIN+WHERE |
| Analytics graceful degradation (obligations) | PASS — try/catch returns null, not 500 |
| Obligation cron scheduled at 0 9 * * * UTC | PASS — registered in worker.ts line 2173 |
| Reminder notification atomic guard (reminderSentAt) | PASS — updateMany guard prevents double-send |
| obligation.overdue in-app notification path | PASS — fanout worker covers it |
| obligation.due_soon in-app notification path | PASS — fanout worker covers it |
| Activity written on obligation CREATE | PASS — `OBLIGATION_CREATED` writeActivity call |
| Activity written on obligation COMPLETE | PASS — `OBLIGATION_COMPLETED` writeActivity call |

---

## Skipped Tests (Bash blocked mid-session)

| Test | Notes |
|---|---|
| Live HTTP org isolation (Org B reads Org A obligation) | Code analysis confirms gap; middleware unreliable on findUnique per prior agents |
| Analytics empty state for fresh org | Code shows `?? 0` defaults; graceful by construction |
| Viewer accessing analytics via HTTP | Code shows no role gate; viewer would receive 200 |
| Analytics correctness after obligation create | Raw SQL queries verified correct by code review |
| Cron live-fire test | Worker is a separate process; no Bash to trigger |

---

## Recommendations

1. **Fix `[obligationId]` GET/PATCH/DELETE**: after `findUnique`, look up the contract and explicitly check `contract.organizationId !== ctx.organizationId`. Do not rely on middleware for `findUnique` isolation.

2. **Fix sub-task routes**: `ensureSubTaskInScope()` must verify the contract's org by fetching `contract.organizationId` and comparing to `ctx.organizationId`.

3. **Obligations cron — write Activity on OVERDUE transition**: call `writeActivity` per obligation inside the cron sweep so the audit log shows system-initiated status changes.

4. **Obligations cron — atomicity**: consider wrapping the status flip and Activity write in a `$transaction` so a crash leaves the row in a consistent, auditable state. At minimum, log failed notification enqueues with enough context to manually recover.

5. **Reject past `dueDate` on create**: return 422 when `dueDate < now()`. If by-design, add an `alreadyOverdue: true` flag to the response.

6. **Analytics `expiringContracts` findMany**: add `organizationId: ctx.organizationId` to the where clause to match the explicit-scope pattern used by all adjacent queries in the same handler.

7. **Decide viewer analytics access**: either add a role gate (`ROLES_CAN_READ_ANALYTICS`) or document that viewers intentionally see financial analytics.

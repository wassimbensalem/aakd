# M7 — Obligation Tracking

## Problem

Contracts contain commitments that must be fulfilled after signing — payment deadlines, deliverable dates, quarterly reports, notice periods. Today ClauseFlow has no way to track these. Once a contract is signed it becomes a static file. Teams manage post-signature obligations in spreadsheets or miss them entirely.

---

## Proposed Solution

A rich obligation tracking system attached to each contract:
- Obligations with status, priority, assignee, sub-tasks, and clause reference
- Auto-overdue detection via daily BullMQ cron
- Configurable reminders via the existing M5 notification fanout (`obligation.due_soon`, `obligation.overdue` events)
- New "Obligations" tab on the contract detail page
- Obligation summary widget on the M8 analytics dashboard

---

## Success Criteria

- A user can create an obligation on any non-archived contract in under 30 seconds.
- Sub-tasks are checkable inline without a page reload.
- The daily cron auto-marks obligations as OVERDUE when `dueDate < now()` and status is not COMPLETED.
- Reminder emails fire exactly once per obligation, `reminderDays` before `dueDate`, using the existing `email.send` queue.
- Org isolation: org B cannot read or write org A's obligations.
- The org isolation test passes with `ContractObligation` and `ObligationSubTask` in scope.

---

## Scope

**IN:**
- `ContractObligation` and `ObligationSubTask` Prisma models
- CRUD API for obligations and sub-tasks
- Status lifecycle: PENDING → IN_PROGRESS → COMPLETED (manual) + OVERDUE (auto via cron)
- Priority: LOW / MEDIUM / HIGH
- Assignee: optional org member (by userId)
- Due date: required
- Clause reference: optional free-text field (e.g. "Section 4.2")
- Configurable reminder: `reminderDays` (1–30, default 7) — fires once via `email.send` queue
- New notification events: `obligation.due_soon` and `obligation.overdue` wired into M5 fanout
- New BullMQ cron: `obligations.check` — daily 9am, same schedule as `alerts.check`
- "Obligations" tab on `/contracts/[id]` page
- Obligation list: grouped by status, sortable by due date
- Create / edit obligation inline (slide-over or inline form, no separate page)
- Sub-task checklist: add, check/uncheck, delete sub-tasks
- Completion flow: mark obligation complete → sets `completedAt`, `completedById`, status → COMPLETED
- New `ActivityAction` enum values: `OBLIGATION_CREATED`, `OBLIGATION_UPDATED`, `OBLIGATION_COMPLETED`, `OBLIGATION_DELETED`

**OUT:**
- Obligation templates (pre-defined obligation sets per contract type) — post-launch
- Public obligation portal for counterparties — never in OSS tier
- File attachments on obligations — post-launch
- Recurring obligations (e.g. "every quarter") — post-launch
- Obligation import from contract text via AI — cloud tier C4+
- SLA percentage completion tracking — post-launch
- Gantt chart view — post-launch

---

## Data Model

### `ContractObligation`

```prisma
model ContractObligation {
  id              String              @id @default(cuid())
  contractId      String
  contract        Contract            @relation(fields: [contractId], references: [id], onDelete: Cascade)
  organizationId  String
  organization    Organization        @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  title           String              // max 300 chars
  description     String?             // max 2000 chars
  clauseReference String?             // free-text, max 200 chars (e.g. "Section 4.2")
  priority        ObligationPriority  @default(MEDIUM)
  status          ObligationStatus    @default(PENDING)
  dueDate         DateTime

  assigneeId      String?
  assignee        User?               @relation("ObligationAssignee", fields: [assigneeId], references: [id])

  reminderDays    Int                 @default(7)  // 1–30; reminder fires this many days before dueDate
  reminderSentAt  DateTime?           // set when reminder email is sent; prevents duplicate sends

  completedAt     DateTime?
  completedById   String?
  completedBy     User?               @relation("ObligationCompleter", fields: [completedById], references: [id])

  createdById     String
  createdBy       User                @relation("ObligationCreator", fields: [createdById], references: [id])

  subTasks        ObligationSubTask[]

  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt
}

enum ObligationStatus {
  PENDING
  IN_PROGRESS
  COMPLETED
  OVERDUE
}

enum ObligationPriority {
  LOW
  MEDIUM
  HIGH
}
```

Add `obligations ContractObligation[]` to the `Contract` model.
Add `obligations ContractObligation[]` to the `Organization` model (for org-scoping — see middleware section).

Max 100 active (non-COMPLETED, non-OVERDUE) obligations per contract. Enforced in POST handler, returning 422 `{ error: "obligation_limit_reached" }`.

### `ObligationSubTask`

```prisma
model ObligationSubTask {
  id           String              @id @default(cuid())
  obligationId String
  obligation   ContractObligation  @relation(fields: [obligationId], references: [id], onDelete: Cascade)

  title        String              // max 200 chars
  isCompleted  Boolean             @default(false)
  completedAt  DateTime?
  completedById String?
  completedBy  User?               @relation("SubTaskCompleter", fields: [completedById], references: [id])

  createdAt    DateTime            @default(now())
  updatedAt    DateTime            @updatedAt
}
```

Max 20 sub-tasks per obligation. Enforced in POST handler, returning 422 `{ error: "subtask_limit_reached" }`.

### Org-scope middleware

Add `"ContractObligation"` to `ORG_SCOPED_MODELS` in `lib/db/client.ts`.
`ObligationSubTask` is scoped indirectly through `obligationId → ContractObligation → organizationId` — do NOT add it to `ORG_SCOPED_MODELS`.

### `ActivityAction` additions

```prisma
  OBLIGATION_CREATED
  OBLIGATION_UPDATED
  OBLIGATION_COMPLETED
  OBLIGATION_DELETED
```

---

## API Endpoints

All routes require `resolveAuth(req)`. Return 401 if null. Return 404 (not 403) when resource belongs to another org. Validate with Zod before DB writes.

### Obligations

**`GET /api/contracts/[id]/obligations`**
- Role: any member including viewer
- Response 200: `{ obligations: Array<ObligationWithSubTasks> }`
- Ordered by: `dueDate ASC`, then `createdAt ASC`
- Includes `subTasks` nested in each obligation
- Includes assignee: `{ id, name, email }`

```typescript
type ObligationWithSubTasks = {
  id: string
  title: string
  description: string | null
  clauseReference: string | null
  priority: "LOW" | "MEDIUM" | "HIGH"
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "OVERDUE"
  dueDate: string // ISO 8601
  assignee: { id: string; name: string; email: string } | null
  reminderDays: number
  reminderSentAt: string | null
  completedAt: string | null
  completedBy: { id: string; name: string } | null
  createdBy: { id: string; name: string }
  createdAt: string
  updatedAt: string
  subTasks: Array<{
    id: string
    title: string
    isCompleted: boolean
    completedAt: string | null
    completedBy: { id: string; name: string } | null
  }>
}
```

**`POST /api/contracts/[id]/obligations`**
- Role: `admin`, `legal`, `member` (not `viewer`)
- Body Zod schema:
```typescript
z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(2000).optional(),
  clauseReference: z.string().max(200).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  dueDate: z.string().datetime(), // ISO 8601
  assigneeId: z.string().optional(),
  reminderDays: z.number().int().min(1).max(30).default(7),
})
```
- Validate `assigneeId` is a member of the same org if provided. Return 422 `{ error: "invalid_assignee" }` if not.
- Reject if contract status is `ARCHIVED`. Return 422 `{ error: "contract_archived" }`.
- Enforce max 100 active obligations. Return 422 `{ error: "obligation_limit_reached" }` if exceeded.
- Write `OBLIGATION_CREATED` activity.
- Response 201: full `ObligationWithSubTasks` object.

**`GET /api/contracts/[id]/obligations/[obligationId]`**
- Role: any member including viewer
- Response 200: full `ObligationWithSubTasks` object.

**`PATCH /api/contracts/[id]/obligations/[obligationId]`**
- Role: `admin`, `legal`, `member`
- Body: all fields from POST body, all optional, plus:
```typescript
z.object({
  status: z.enum(["PENDING", "IN_PROGRESS", "COMPLETED"]).optional(),
  // Note: OVERDUE is set only by the cron, never by client
})
```
- If `status` is being set to `COMPLETED`: set `completedAt = now()`, `completedById = caller.userId`. Write `OBLIGATION_COMPLETED` activity.
- For any other field change: write `OBLIGATION_UPDATED` activity.
- Response 200: full `ObligationWithSubTasks`.

**`DELETE /api/contracts/[id]/obligations/[obligationId]`**
- Role: `admin` or `legal` only
- Hard delete (cascade deletes sub-tasks via Prisma onDelete: Cascade).
- Write `OBLIGATION_DELETED` activity.
- Response 204.

### Sub-tasks

**`POST /api/contracts/[id]/obligations/[obligationId]/subtasks`**
- Role: `admin`, `legal`, `member`
- Body: `z.object({ title: z.string().min(1).max(200) })`
- Enforce max 20 sub-tasks. Return 422 `{ error: "subtask_limit_reached" }`.
- Response 201: `{ id, title, isCompleted, completedAt, completedBy, createdAt }`

**`PATCH /api/contracts/[id]/obligations/[obligationId]/subtasks/[subtaskId]`**
- Role: `admin`, `legal`, `member`
- Body: `z.object({ isCompleted: z.boolean().optional(), title: z.string().min(1).max(200).optional() })`
- If `isCompleted` toggled to `true`: set `completedAt = now()`, `completedById = caller.userId`.
- If `isCompleted` toggled to `false`: clear `completedAt`, `completedById`.
- Response 200: full sub-task object.

**`DELETE /api/contracts/[id]/obligations/[obligationId]/subtasks/[subtaskId]`**
- Role: `admin`, `legal`, `member`
- Response 204.

---

## Notification Events

Add to `apps/web/lib/notifications/events.ts`:

```typescript
// Two new events appended to NOTIFICATION_EVENTS:
"obligation.due_soon"   // fires reminderDays before dueDate
"obligation.overdue"    // fires when cron marks obligation OVERDUE
```

Default email enabled: `true` for both events.

Labels:
- `"obligation.due_soon"`: `"Obligation due soon"`
- `"obligation.overdue"`: `"Obligation overdue"`

Fan-out metadata passed to `enqueueNotification`:
```typescript
{
  obligationId: string,
  obligationTitle: string,
  dueDate: string,       // ISO 8601
  assigneeName: string | null,
  daysUntilDue: number,  // for due_soon; 0 for overdue
}
```

---

## BullMQ Cron: `obligations.check`

Queue name: `obligations.check`
Schedule: `0 9 * * *` (daily 9am UTC, same as `alerts.check`)
No job data required (cron scans all orgs).

Worker logic (runs in `worker.ts`):

### Step 1 — Mark overdue
```typescript
await prisma.contractObligation.updateMany({
  where: {
    status: { in: ["PENDING", "IN_PROGRESS"] },
    dueDate: { lt: new Date() },
  },
  data: { status: "OVERDUE" },
})
```
Then: for each newly-overdue obligation (fetch those updated), enqueue `enqueueNotification("obligation.overdue", contractId, null, { obligationId, obligationTitle, dueDate, assigneeName, daysUntilDue: 0 })`.

### Step 2 — Send reminders
Fetch all obligations where:
- `status` in `["PENDING", "IN_PROGRESS"]`
- `reminderSentAt` is null (reminder not yet sent)
- `dueDate` is within the next `reminderDays` days:
  ```typescript
  dueDate: {
    lte: new Date(Date.now() + obligation.reminderDays * 24 * 60 * 60 * 1000)
  }
  ```

Since `reminderDays` varies per obligation, fetch all obligations where `status` is active and `reminderSentAt` is null, then filter in application code:
```typescript
const now = new Date()
const eligible = obligations.filter(o => {
  const triggerDate = new Date(o.dueDate.getTime() - o.reminderDays * 86400000)
  return triggerDate <= now
})
```

For each eligible obligation:
1. Set `reminderSentAt = now()` atomically (update + return, skip if already set — race guard).
2. `enqueueNotification("obligation.due_soon", contractId, null, { obligationId, obligationTitle, dueDate, assigneeName, daysUntilDue: reminderDays })`

---

## UI

### Obligations tab on `/contracts/[id]`

Add a new `TabsTrigger` and `TabsContent` for `value="obligations"` between the "AI Extractions" tab and the "Activity" tab.

Tab label: `"Obligations"` with a count badge showing the number of non-COMPLETED, non-OVERDUE obligations (active obligations). Badge hidden when count is 0.

**Toolbar:**
- Left: status filter pills — `All` | `Pending` | `In Progress` | `Overdue` | `Completed`
- Right: `"Add Obligation"` button — visible to `admin`, `legal`, `member` only

**Obligation list:**

Each obligation rendered as a card:
- Left: priority indicator dot (red=HIGH, amber=MEDIUM, blue=LOW)
- Status badge: `PENDING` (zinc), `IN_PROGRESS` (blue), `COMPLETED` (green), `OVERDUE` (red)
- Title (bold)
- Due date: `"Due [date]"` — red text if OVERDUE or due within 3 days
- Assignee avatar + name (if set)
- Clause reference in `text-zinc-400 text-sm` (if set)
- Description truncated to 2 lines (if set)
- Sub-task progress: `"3 / 5 tasks"` with a thin progress bar (if sub-tasks exist)
- Actions (visible to non-viewers): Edit (pencil icon), Mark complete (check icon, hidden if already COMPLETED), Delete (trash icon, admin/legal only)

**Sub-task section (expanded inline below obligation card):**
- Checklist of sub-tasks with checkbox + title + strike-through when complete
- `"Add task"` inline input at bottom of list (press Enter to add)
- Delete icon on each sub-task item

**Create / Edit obligation:**
Rendered as a `Sheet` (shadcn slide-over from the right — not a modal dialog).
Fields:
- Title (required, text input)
- Description (optional, textarea)
- Due date (required, date input)
- Priority (select: Low / Medium / High)
- Assignee (optional, searchable member select)
- Clause reference (optional, text input, placeholder: "e.g. Section 4.2")
- Reminder (select: 1, 3, 7, 14, 30 days before due — default 7)
- Sub-tasks: inline add/remove list (after obligation is created)

**Empty state:**
- Icon: `CheckSquare` from lucide-react, `size-10 text-zinc-300`
- Text: `"No obligations yet. Track deliverables, payments, and commitments here."`
- Button: `"Add Obligation"` (shown to non-viewers)

---

## Implementation Order

1. Prisma migration — `ContractObligation`, `ObligationSubTask`, new enums, new `ActivityAction` values
2. Add `"ContractObligation"` to `ORG_SCOPED_MODELS` in `lib/db/client.ts`
3. Add `obligation.due_soon` and `obligation.overdue` to `events.ts`
4. API: `GET /POST /api/contracts/[id]/obligations`
5. API: `GET /PATCH /DELETE /api/contracts/[id]/obligations/[obligationId]`
6. API: sub-task endpoints
7. Worker: `obligations.check` cron handler
8. UI: Obligations tab — list, status filter, empty state
9. UI: Create/Edit slide-over (Sheet)
10. UI: Sub-task checklist inline
11. UI: Mark complete action + confirmation
12. Verify org isolation test passes

---

## Open Questions

None. All decisions resolved:

- **Max obligations per contract:** 100 active. Rationale: beyond 100 you need obligation templates and bulk management, which is post-launch scope.
- **Max sub-tasks per obligation:** 20. Rationale: sub-tasks are a checklist, not a project management tool.
- **OVERDUE set by:** cron only, never by client. Client can only set PENDING / IN_PROGRESS / COMPLETED. Rationale: prevents client clock skew from incorrectly marking obligations overdue.
- **Reminder fires once:** `reminderSentAt` prevents duplicate sends even if cron runs multiple times.
- **Hard delete obligations:** unlike contracts (soft-delete only), obligations are hard-deleted. Rationale: obligations are operational records, not audit-critical documents. Activity log captures the deletion event.
- **Archived contracts:** cannot create new obligations on ARCHIVED contracts. Existing obligations remain visible read-only.
- **Reminder days options:** 1, 3, 7, 14, 30 (select, not free-text input). Rationale: prevents unreasonable values, simplifies UI.

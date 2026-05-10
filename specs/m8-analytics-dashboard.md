# M8 — Analytics Dashboard

## Problem

Legal ops leads and COOs have no visibility into their contract portfolio at a glance. Today they must manually count statuses, scroll through contract lists to spot expirations, and build their own spreadsheets to report on contract value. The result: renewals are missed, leadership asks for portfolio numbers and nobody has them, and the team can't prove CLM is working.

---

## Proposed Solution

A single analytics page at `/analytics` with 5 widgets covering the questions that matter most to the ICP:

1. **Expiring Soon** — contracts expiring in the next 30 / 60 / 90 days
2. **Portfolio Health** — contracts by status (donut)
3. **Monthly Volume** — new contracts per month, last 12 months (bar chart)
4. **Value by Type** — total contract value grouped by contract type (horizontal bar)
5. **Approval Funnel** — approval outcomes (approved vs rejected vs pending) across all contracts

All data served from a single `GET /api/analytics/summary` endpoint. No date pickers or filters in v1 — hardcoded to last 12 months for trends and next 90 days for expiration.

---

## Success Criteria

- The `/analytics` page loads and all 5 widgets render within 3 seconds on a database with 1,000 contracts.
- A user with `viewer` role can access the analytics page (read-only by nature).
- The `GET /api/analytics/summary` response is computed server-side — no client-side data aggregation.
- Org isolation: the API returns data only for the authenticated org.
- The page is responsive at 1280px+ width (2-column grid on md, 3-column on lg).

---

## Scope

**IN:**
- New page: `app/(app)/analytics/page.tsx`
- New API: `GET /api/analytics/summary`
- 5 widgets (see below)
- Recharts for all charts (MIT licensed, React-native, tree-shakeable)
- Navigation link added to sidebar (`app/(app)/layout.tsx`)
- Obligation summary widget: count of overdue + due-this-week obligations (pulled from M7 data, shown only if M7 is present — graceful degradation if `ContractObligation` table doesn't exist)

**OUT:**
- Date range picker / custom filters — post-launch
- CSV / PDF export of analytics — post-launch
- Per-user analytics (who creates the most contracts) — post-launch
- Counterparty analytics — post-launch
- Predictive renewal forecasting — cloud tier C4+
- Embedded analytics iframe for external sharing — never in OSS tier

---

## Chart Library

**Recharts** (`recharts`, MIT license).

Install: `pnpm add recharts` in `apps/web`.

Use only these Recharts components: `BarChart`, `Bar`, `PieChart`, `Pie`, `Cell`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`, `Legend`, `ResponsiveContainer`.

Do not add any other charting library.

All chart components must be wrapped in `"use client"` since Recharts uses browser APIs.

---

## API Endpoint

**`GET /api/analytics/summary`**

- Role: any authenticated user (all roles including `viewer`)
- No query params
- Computes all 5 datasets in a single DB call sequence, returns them together
- Response 200:

```typescript
{
  expiringSoon: {
    next30: number,   // count of contracts with endDate in [now, now+30d]
    next60: number,   // count with endDate in [now, now+60d] (cumulative)
    next90: number,   // count with endDate in [now, now+90d] (cumulative)
    contracts: Array<{
      id: string,
      title: string,
      endDate: string,      // ISO 8601
      counterpartyName: string | null,
      contractType: string | null,
      daysUntilExpiry: number,
    }>   // max 10 — the soonest expiring, sorted by endDate ASC
  },
  byStatus: Array<{
    status: string,   // DRAFT | INTERNAL_REVIEW | AWAITING_SIGNATURE | ACTIVE | EXPIRED | TERMINATED | ARCHIVED
    count: number,
  }>,
  monthlyVolume: Array<{
    month: string,    // "YYYY-MM" format, e.g. "2025-11"
    count: number,
  }>,   // 12 entries, oldest first, last 12 calendar months
  valueByType: Array<{
    contractType: string,   // NDA | MSA | SOW | EMPLOYMENT | VENDOR | CUSTOMER | OTHER
    totalValue: number,     // sum of Contract.value (USD cents or raw number — matches schema)
    count: number,
  }>,   // only types with at least 1 contract with a non-null value
  approvalFunnel: {
    totalRequested: number,
    approved: number,
    rejected: number,
    pending: number,        // requested but not yet decided
  },
  obligations: {            // null if ContractObligation table not queried (graceful degradation)
    overdue: number,
    dueSoon: number,        // due within 7 days, not yet overdue
  } | null,
}
```

### Implementation of each query (all within `requestContext.run(ctx, ...)`):

**expiringSoon:**
```typescript
const now = new Date()
const d90 = new Date(now.getTime() + 90 * 86400000)
const contracts = await prisma.contract.findMany({
  where: { endDate: { gte: now, lte: d90 }, status: "ACTIVE" },
  orderBy: { endDate: "asc" },
  take: 10,
  select: { id: true, title: true, endDate: true, counterpartyName: true, contractType: true },
})
// compute next30/next60/next90 counts from the same query + two count queries
```

**byStatus:**
```typescript
const grouped = await prisma.contract.groupBy({
  by: ["status"],
  _count: { _all: true },
})
```

**monthlyVolume:**
Use a raw Prisma query or `$queryRaw` to group by `DATE_TRUNC('month', "createdAt")` for last 12 months. Fill in months with 0 count where no contracts exist.

```typescript
const rows = await prisma.$queryRaw<{ month: string; count: bigint }[]>`
  SELECT TO_CHAR(DATE_TRUNC('month', "createdAt"), 'YYYY-MM') AS month,
         COUNT(*)::bigint AS count
  FROM "Contract"
  WHERE "organizationId" = ${ctx.organizationId}
    AND "createdAt" >= ${twelveMonthsAgo}
  GROUP BY 1
  ORDER BY 1 ASC
`
```

**valueByType:**
```typescript
const grouped = await prisma.contract.groupBy({
  by: ["contractType"],
  where: { value: { not: null } },
  _sum: { value: true },
  _count: { _all: true },
})
```

**approvalFunnel:**
```typescript
const [total, approved, rejected] = await Promise.all([
  prisma.contractApproval.count(),
  prisma.contractApproval.count({ where: { status: "APPROVED" } }),
  prisma.contractApproval.count({ where: { status: "REJECTED" } }),
])
```

**obligations (graceful):**
```typescript
try {
  const [overdue, dueSoon] = await Promise.all([
    prisma.contractObligation.count({ where: { status: "OVERDUE" } }),
    prisma.contractObligation.count({
      where: {
        status: { in: ["PENDING", "IN_PROGRESS"] },
        dueDate: { lte: new Date(Date.now() + 7 * 86400000) },
      }
    }),
  ])
  obligations = { overdue, dueSoon }
} catch {
  obligations = null  // table doesn't exist yet
}
```

---

## UI — Widget Specifications

### Page layout

```
/analytics
├── Page header: "Analytics" (h1), subtitle: "Contract portfolio overview · Last updated [now]"
├── Grid row 1 (3 columns on lg, 1 on sm):
│   ├── Widget: Expiring Soon (spans 1 col)
│   ├── Widget: Portfolio Health — donut (spans 1 col)
│   └── Widget: Obligation Summary (spans 1 col) — only if obligations data non-null
├── Grid row 2 (2 columns on lg, 1 on sm):
│   ├── Widget: Monthly Volume — bar chart (spans 1 col, wider)
│   └── Widget: Value by Type — horizontal bar (spans 1 col)
└── Grid row 3 (full width):
    └── Widget: Approval Funnel — 3 stat cards side-by-side
```

Each widget is a shadcn `Card` with `CardHeader` (title + optional subtitle) and `CardContent`.

---

### Widget 1: Expiring Soon

**Type:** Table + 3 summary numbers

**Summary row (3 stat numbers at top of card):**
- `30 days: [n]` | `60 days: [n]` | `90 days: [n]`
- Numbers in `text-2xl font-bold`. Label in `text-sm text-zinc-500`.
- If any count > 0: the smallest non-zero count number is `text-red-600`.

**Table (max 10 rows):**

| Contract | Counterparty | Type | Expires | Days left |
|---|---|---|---|---|
| [title link] | [name or —] | [TypeBadge] | [date] | [N days — red if ≤ 30] |

Empty state: `"No contracts expiring in the next 90 days."` in `text-zinc-500`.

---

### Widget 2: Portfolio Health

**Type:** Donut chart (Recharts `PieChart` + `Pie` with `innerRadius`)

Data: `byStatus` array from API.

Colour mapping:
```typescript
const STATUS_COLORS: Record<string, string> = {
  DRAFT: "#a1a1aa",            // zinc-400
  INTERNAL_REVIEW: "#60a5fa", // blue-400
  AWAITING_SIGNATURE: "#f59e0b", // amber-400
  ACTIVE: "#22c55e",          // green-500
  EXPIRED: "#ef4444",         // red-500
  TERMINATED: "#f97316",      // orange-500
  ARCHIVED: "#d4d4d8",        // zinc-300
}
```

Total contract count shown in centre of donut: `text-3xl font-bold`.

Legend below chart: status label + colour dot + count.

---

### Widget 3: Monthly Volume

**Type:** Bar chart (Recharts `BarChart`)

Data: `monthlyVolume` (12 months).

X-axis: abbreviated month label (`"Nov"`, `"Dec"`, etc.)
Y-axis: integer count, no decimals.
Bar fill: `#6366f1` (indigo-500).
Tooltip: `"[Month YYYY]: [N] contracts"`.

Empty state (all counts zero): `"No contracts created in the last 12 months."`.

---

### Widget 4: Value by Type

**Type:** Horizontal bar chart (Recharts `BarChart` with `layout="vertical"`)

Data: `valueByType`, sorted by `totalValue DESC`.

Y-axis: contract type label.
X-axis: formatted currency value (`"$1.2M"`, `"$450K"`, `"$12K"` — abbreviated).
Bar fill: `#8b5cf6` (violet-500).
Tooltip: `"[Type]: $[value] across [count] contracts"`.

Empty state: `"No contracts with a value set."`.

**Currency formatting:**
```typescript
function formatValue(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toLocaleString()}`
}
```

---

### Widget 5: Approval Funnel

**Type:** 3 large stat cards side by side (no chart — pure numbers).

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Requested   │  │   Approved   │  │   Rejected   │
│     [N]      │  │     [N]      │  │     [N]      │
│              │  │  [N%] rate   │  │  [N%] rate   │
└──────────────┘  └──────────────┘  └──────────────┘
```

- Approved rate: `approved / totalRequested * 100`, rounded to 1 decimal. In `text-green-600`.
- Rejected rate: `rejected / totalRequested * 100`. In `text-red-600`.
- Pending: shown as a 4th smaller note below: `"[N] pending decision"`.

Empty state (totalRequested === 0): `"No approvals have been requested yet."`.

---

### Widget 6: Obligation Summary (conditional)

**Type:** 2 stat cards side by side.

Only rendered if `obligations !== null` in API response.

```
┌──────────────┐  ┌──────────────┐
│   Overdue    │  │  Due Soon    │
│     [N]      │  │     [N]      │
│ obligations  │  │  (7 days)    │
└──────────────┘  └──────────────┘
```

- Overdue count: `text-red-600 text-3xl font-bold` if > 0, else `text-zinc-400`.
- Due soon count: `text-amber-600 text-3xl font-bold` if > 0, else `text-zinc-400`.
- Each card links to a filtered obligations view (future — for v1 just static numbers, no link).

---

## Sidebar Navigation

Add to `app/(app)/layout.tsx` navigation array:

```typescript
{
  href: "/analytics",
  label: "Analytics",
  icon: BarChart2,   // from lucide-react
}
```

Position: after "Contracts", before "Templates" (if M6 is present).

---

## Implementation Order

1. `pnpm add recharts` in `apps/web`
2. API: `GET /api/analytics/summary` — all 6 queries, response type, org-scoped
3. UI: `app/(app)/analytics/page.tsx` — page shell, loading skeleton, data fetch
4. UI: Widget 1 — Expiring Soon (table)
5. UI: Widget 2 — Portfolio Health (donut)
6. UI: Widget 3 — Monthly Volume (bar)
7. UI: Widget 4 — Value by Type (horizontal bar)
8. UI: Widget 5 — Approval Funnel (stat cards)
9. UI: Widget 6 — Obligation Summary (conditional stat cards)
10. Sidebar nav link
11. Verify org isolation (API returns only current org data)

---

## Open Questions

None. All decisions resolved:

- **Chart library:** Recharts only. No D3, no Chart.js, no Victory.
- **No date filters in v1:** hardcoded ranges (12 months back for trends, 90 days forward for expiring). Date range picker is post-launch.
- **monthlyVolume gaps:** months with 0 contracts are filled in with `count: 0` in application code after the DB query (not in SQL, to keep the query simple).
- **Value currency:** Contract.value is stored as a plain number (no currency conversion). All values assumed USD. Multi-currency conversion is post-launch.
- **Obligations widget graceful degradation:** if the `ContractObligation` table doesn't exist (M7 not yet migrated), the catch block returns `null` and the widget is hidden. No error shown to user.
- **Viewer role access:** analytics is read-only by nature — all roles including `viewer` can access.
- **Performance:** with 1,000 contracts, all queries are O(n) table scans which Postgres handles easily. Index on `organizationId` and `createdAt` already exists from M0. `monthlyVolume` uses `$queryRaw` to leverage `DATE_TRUNC` which is indexed-friendly. No additional indexes required for M8.
- **Loading state:** each widget shows a `Skeleton` (shadcn) while `fetch` is in flight. Single API call means all 5 widgets load together.

# M10 — Migration Tools: Import from Other CLM/Contract Tools

## Problem

New users arriving at ClauseFlow from spreadsheets, PandaDoc, ContractBook, DocuSign CLM, or any CLM tool that can export files face a blank slate. Their existing contract portfolio — often hundreds of records accumulated over years — is trapped in another system. Without a migration path, the cost of switching is too high: users must recreate every contract record by hand, or accept incomplete data. This is the single largest barrier to adoption for teams evaluating ClauseFlow as a replacement for their current tooling.

Reddit signal (ranked by frequency):

1. Spreadsheets (Google Sheets / Excel) — the most common "CLM" for small teams. A CSV export is universally available.
2. PandaDoc — used by small-to-mid-size teams; exports ZIPs with PDFs + JSON metadata.
3. ContractBook — popular in the EU; exports ZIPs with PDFs + CSV metadata.
4. DocuSign CLM — enterprise; exports ZIPs with PDFs + XML or JSON metadata.
5. Generic PDF/DOCX batch — catch-all for any tool that can export files but has no structured metadata export.

---

## Proposed Solution

Five import pathways, all accessible from a single `/settings/import` page:

1. **CSV/Spreadsheet Import** — upload a CSV, map columns to ClauseFlow fields, preview, bulk-create Contract records.
2. **ZIP/Batch File Upload** — drag a ZIP or multi-select up to 50 PDF/DOCX files; each becomes a Contract in DRAFT status.
3. **Google Drive Folder Scan** — OAuth-connect to Drive, pick a folder, select files, import same as batch upload.
4. **PandaDoc Export Import** — upload a PandaDoc export ZIP; we parse the JSON metadata and prefill contract fields.
5. **Generic CLM Export Import** — upload a ContractBook or DocuSign CLM export ZIP; auto-detect format, parse metadata, import.

All pathways are fully asynchronous: a BullMQ job processes each import batch, writing results back to an `ImportJob` record. AI enrichment is optional and degrades gracefully if AI is not configured.

---

## Success Criteria

- A user can import 200 contracts from a CSV in under 5 minutes end-to-end (upload → job completes → contracts visible in dashboard).
- A user can drag a ZIP of 50 PDFs and have all 50 imported with zero manual steps beyond the upload.
- The error report for a failed CSV row identifies the row number and the specific validation failure reason.
- Google Drive import requires no manual file download by the user.
- PandaDoc and ContractBook/DocuSign ZIPs produce contracts pre-populated with whatever metadata the export provides.
- Org isolation: an import job for org A never creates contracts in org B.
- All import pathways work on a self-hosted instance with no cloud dependencies beyond optional Google Drive OAuth credentials.
- AI enrichment (when configured) is triggered automatically but never blocks import completion if AI is unavailable.

---

## Scope

**IN:**

- `ImportJob` Prisma model — tracks the lifecycle of every import batch
- `ImportRow` Prisma model — tracks per-row/per-file result within a batch (CSV) or per-file result (batch upload)
- `import.process` BullMQ queue — async processor for all import types
- `GET /api/import` — list import jobs for the org (paginated)
- `POST /api/import/csv` — upload CSV, store raw file in S3, create `ImportJob`, enqueue processing job
- `GET /api/import/[jobId]` — poll job status + row-level results
- `GET /api/import/[jobId]/error-report` — download CSV of failed rows
- `POST /api/import/batch` — multi-file upload (PDF/DOCX or ZIP), create `ImportJob`, enqueue
- `POST /api/import/gdrive/connect` — initiate Google Drive OAuth
- `GET /api/import/gdrive/callback` — Google Drive OAuth callback
- `DELETE /api/import/gdrive/connect` — disconnect Google Drive
- `GET /api/import/gdrive/files?folderId=` — list files/folders in a Drive folder
- `POST /api/import/gdrive/import` — trigger import from selected Drive file IDs
- `POST /api/import/pandadoc` — upload PandaDoc export ZIP, create `ImportJob`, enqueue
- `POST /api/import/clm-export` — upload ContractBook/DocuSign export ZIP, create `ImportJob`, enqueue
- `/settings/import` page — tabbed UI covering all five pathways
- `ActivityAction.IMPORT_COMPLETED` written once per `ImportJob` on completion (on the first contract created, or as a standalone log if zero contracts)
- `GoogleDriveIntegration` Prisma model — per-org OAuth token storage (same encryption as M9 CRM tokens)
- Add `"ImportJob"` to `ORG_SCOPED_MODELS` in `lib/db/client.ts`
- Nav link: "Import" in settings sidebar

**OUT:**

- Ongoing sync / live two-way connection with any source system — this is a one-time migration tool only
- Notion, Ironclad, Juro, or any other CLM not listed above — post-launch
- Google Sheets API integration (live read from Sheets URL) — user must download CSV first
- OneDrive / SharePoint folder scan — post-launch
- Dropbox folder scan — post-launch
- Automatic field mapping via AI (the column mapping UI is manual, with AI-assisted suggestions only if AI is configured)
- Importing counterparty contact records as standalone objects — counterparty name/contact written to Contract fields only
- Importing obligations or approvals from source systems — contracts only
- Importing e-signature history (audit trails from DocuSign/PandaDoc) — the PDF file is imported, the signature trail is not
- Scheduled/recurring imports — one-shot only
- Rollback of a completed import — user must archive/delete contracts manually
- Import via MCP server — post-launch
- Support for XLSX/ODS/Numbers files directly — user must export to CSV first

---

## Environment Variables

```bash
# Google Drive OAuth (app-level — self-hoster registers their own Google Cloud project)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# These already exist from M9 — no new key needed for token encryption:
NOTIFICATION_ENCRYPTION_KEY=   # AES-256-GCM key, already required since M5
```

`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are **app-level** (one set per ClauseFlow deployment). Self-hosters must create a Google Cloud project, enable the Google Drive API, and configure the OAuth consent screen. The redirect URI is `{NEXT_PUBLIC_APP_URL}/api/import/gdrive/callback`.

Google Drive import degrades gracefully: if `GOOGLE_CLIENT_ID` is unset, the Google Drive tab is hidden and its API routes return 503.

---

## Data Model

### `ImportJob`

```prisma
model ImportJob {
  id             String          @id @default(cuid())
  organizationId String
  organization   Organization    @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  source         ImportSource    // CSV | BATCH_FILES | GOOGLE_DRIVE | PANDADOC | CLM_EXPORT
  status         ImportStatus    @default(PENDING)

  // Raw inputs stored in S3 so the worker can re-read them
  storageKey     String?         // S3 key of the uploaded file (CSV, ZIP, etc.)
  // For Google Drive imports — comma-separated Drive file IDs (no S3 upload needed)
  driveFileIds   String?

  // Counters (updated by worker as it processes)
  totalRows      Int             @default(0)   // total files/rows attempted
  succeededRows  Int             @default(0)
  failedRows     Int             @default(0)

  // S3 key of the error report CSV (set on completion if failedRows > 0)
  errorReportKey String?

  startedAt      DateTime?
  completedAt    DateTime?

  createdById    String
  createdBy      User            @relation("ImportJobCreator", fields: [createdById], references: [id])
  createdAt      DateTime        @default(now())
  updatedAt      DateTime        @updatedAt

  rows           ImportRow[]

  @@index([organizationId, status])
  @@index([organizationId, createdAt])
}

enum ImportSource {
  CSV
  BATCH_FILES
  GOOGLE_DRIVE
  PANDADOC
  CLM_EXPORT
}

enum ImportStatus {
  PENDING      // job created, not yet picked up by worker
  PROCESSING   // worker actively processing
  COMPLETED    // all rows processed (some may have failed — check failedRows)
  FAILED       // catastrophic failure before any row processing (e.g. corrupt ZIP)
}
```

### `ImportRow`

```prisma
model ImportRow {
  id           String    @id @default(cuid())
  jobId        String
  job          ImportJob @relation(fields: [jobId], references: [id], onDelete: Cascade)

  rowIndex     Int       // 1-based: row number in CSV, or file index in batch
  sourceRef    String    // CSV: original row data as JSON string; files: original filename
  status       String    @default("pending")  // "pending" | "success" | "failed" | "skipped"
  errorMessage String?   // populated on failure

  // Set on success
  contractId   String?   // ID of the created Contract

  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  @@index([jobId, status])
  @@index([jobId, rowIndex])
}
```

### `GoogleDriveIntegration`

```prisma
model GoogleDriveIntegration {
  id             String       @id @default(cuid())
  organizationId String       @unique
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)

  accessToken    String       // AES-256-GCM encrypted (same util as M9: lib/notifications/crypto.ts)
  refreshToken   String       // AES-256-GCM encrypted
  tokenExpiresAt DateTime?

  connectedById  String
  connectedBy    User         @relation("GoogleDriveConnectedBy", fields: [connectedById], references: [id])

  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
}
```

### Schema additions to existing models

Add to `Organization`:
```prisma
  importJobs             ImportJob[]
  googleDriveIntegration GoogleDriveIntegration?
```

Add to `User`:
```prisma
  importJobsCreated        ImportJob[]               @relation("ImportJobCreator")
  googleDriveConnected     GoogleDriveIntegration[]  @relation("GoogleDriveConnectedBy")
```

### `ActivityAction` additions

```prisma
  IMPORT_COMPLETED   // written once per ImportJob on completion; detail = "Imported N contracts via [source]"
```

`ImportJob` IS in `ORG_SCOPED_MODELS` (direct `organizationId`).
`ImportRow` is NOT in `ORG_SCOPED_MODELS` — scoped indirectly via `jobId → ImportJob → organizationId`.
`GoogleDriveIntegration` is NOT in `ORG_SCOPED_MODELS` — always fetched by `organizationId` directly; Prisma's `findUnique` on `@@unique([organizationId])` is sufficient without middleware injection.

---

## BullMQ Queue

### New queue: `import.process`

Add to `lib/jobs/queues.ts`:

```typescript
export interface ImportProcessJobData {
  importJobId: string
  organizationId: string
  createdById: string
}

let _importProcessQueue: Queue<ImportProcessJobData> | null = null

export function getImportProcessQueue(): Queue<ImportProcessJobData> {
  return (_importProcessQueue ??= new Queue<ImportProcessJobData>("import.process", {
    connection,
    defaultJobOptions: {
      attempts: 1,             // no automatic retries — partial progress is persisted per ImportRow
      removeOnComplete: 200,
      removeOnFail: 500,
    },
  }))
}

export const importProcessQueue = {
  add: (...a: Parameters<Queue<ImportProcessJobData>["add"]>) => getImportProcessQueue().add(...a),
  close: () => _importProcessQueue?.close() ?? Promise.resolve(),
}
```

No automatic retries (`attempts: 1`) because the worker writes partial progress to `ImportRow` records as it goes. If the job crashes mid-way, the admin can re-trigger from the UI (POST `/api/import/[jobId]/retry`) and the worker skips rows that already have `status: "success"`.

---

## Worker Handler

Add to `apps/web/worker.ts`:

```typescript
import type { ImportProcessJobData } from "@/lib/jobs/queues"
import { processImportJob } from "@/lib/import/processor"

// In the Worker registration:
new Worker<ImportProcessJobData>(
  "import.process",
  async (job: Job<ImportProcessJobData>) => {
    await processImportJob(job.data)
  },
  { connection, concurrency: 2 }
)
```

`concurrency: 2` — allows two import jobs to process in parallel without overwhelming Postgres or the S3 client.

### Processor: `lib/import/processor.ts`

This is the central dispatcher. It reads the `ImportJob` record, sets `status: PROCESSING`, then delegates to the appropriate handler based on `source`:

```typescript
export async function processImportJob(data: ImportProcessJobData): Promise<void>
```

Internal functions (one file each):

| File | Handles |
|---|---|
| `lib/import/handlers/csv.ts` | `ImportSource.CSV` |
| `lib/import/handlers/batch.ts` | `ImportSource.BATCH_FILES` and `ImportSource.GOOGLE_DRIVE` |
| `lib/import/handlers/pandadoc.ts` | `ImportSource.PANDADOC` |
| `lib/import/handlers/clm-export.ts` | `ImportSource.CLM_EXPORT` |
| `lib/import/create-contract.ts` | Shared: creates a single Contract + ContractFile from parsed data |
| `lib/import/gdrive-client.ts` | Google Drive API calls (list files, download file) |

All handlers write progress to `ImportRow` records as they go (not just on completion), so the UI polling `/api/import/[jobId]` shows live progress.

On completion of any handler, the processor:
1. Sets `ImportJob.status = "COMPLETED"` (or `"FAILED"` on catastrophic error).
2. Sets `ImportJob.completedAt = now()`.
3. If `failedRows > 0`, generates an error report CSV and uploads it to S3 under key `imports/{orgId}/{jobId}/error-report.csv`, stores the key in `ImportJob.errorReportKey`.
4. Enqueues a notification via `enqueueNotification` for event `"import.completed"` (new event name — see Notifications section below).

---

## Shared Contract Creation Utility

`lib/import/create-contract.ts` exports:

```typescript
export interface ImportedContractData {
  title: string
  contractType?: "NDA" | "MSA" | "SOW" | "EMPLOYMENT" | "VENDOR" | "CUSTOMER" | "OTHER"
  counterpartyName?: string
  counterpartyContact?: string
  value?: number
  currency?: string           // ISO 4217, 3-char. Default: "USD"
  startDate?: Date
  endDate?: Date
  renewalDate?: Date
  noticePeriodDays?: number
  autoRenewal?: boolean
  notes?: string
  status?: ContractStatus     // default: DRAFT
  // File to attach (optional — CSV imports may have no file)
  file?: {
    buffer: Buffer
    filename: string          // sanitized before use
    mimeType: "application/pdf" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    sizeBytes: number
  }
}

export async function createImportedContract(
  data: ImportedContractData,
  context: { organizationId: string; ownerId: string; prisma: PrismaClient }
): Promise<string>   // returns contractId
```

This function:
1. Validates `title` is non-empty (throws if not).
2. If `file` is provided: validates `sizeBytes <= 52428800` (50 MB), sanitizes `filename` (strip path traversal, replace special chars with `_`, truncate to 255 chars), uploads to S3 under key `contracts/{organizationId}/{contractId}/files/{fileId}/{sanitized-filename}`, creates `ContractFile` record.
3. Creates the `Contract` record (no org-scope middleware in worker — uses `getWorkerPrisma()` and sets `organizationId` explicitly).
4. Writes `Activity` record with action `CREATED`, `actorLabel: "Import"`.
5. If a file was attached: enqueues `contract.extract` job.
6. If AI is configured AND file was attached: after `contract.extract` completes (chained via `contract.ai_extract` as per existing pipeline), `contract.ai_extract` runs automatically. No extra logic needed — existing pipeline handles it.

"AI is configured" check: `process.env.ANTHROPIC_API_KEY` or `process.env.OPENAI_API_KEY` or `process.env.OLLAMA_BASE_URL` is set (same check used elsewhere in the codebase).

---

## Feature 1: CSV/Spreadsheet Import

### Accepted columns

The CSV must have a header row. Column names are matched **case-insensitively** and **whitespace-trimmed**. The mapping UI lets users drag column headers to fields. This is the canonical column-to-field mapping:

| ClauseFlow Field | Accepted CSV Header Aliases |
|---|---|
| `title` | `name`, `contract name`, `title`, `contract title` |
| `contractType` | `type`, `contract type`, `category` |
| `counterpartyName` | `counterparty`, `counterparty name`, `vendor`, `client`, `party` |
| `counterpartyContact` | `counterparty contact`, `counterparty email`, `contact email` |
| `value` | `value`, `contract value`, `amount` |
| `currency` | `currency`, `currency code` |
| `startDate` | `start date`, `effective date`, `commencement date` |
| `endDate` | `end date`, `expiry date`, `expiration date`, `termination date` |
| `renewalDate` | `renewal date`, `auto renewal date` |
| `noticePeriodDays` | `notice period`, `notice period days` |
| `autoRenewal` | `auto renewal`, `auto-renewal`, `auto renew` |
| `notes` | `notes`, `description`, `comments` |
| `status` | `status` |

Only `title` is required. All other fields are optional. Unmapped columns are ignored.

### Validation rules (applied per row)

| Field | Rule |
|---|---|
| `title` | Non-empty string, max 500 chars |
| `contractType` | If present, must be one of: `NDA`, `MSA`, `SOW`, `EMPLOYMENT`, `VENDOR`, `CUSTOMER`, `OTHER` (case-insensitive) |
| `value` | If present, must parse as a positive finite number |
| `currency` | If present, must be exactly 3 uppercase letters (coerced to uppercase automatically) |
| `startDate`, `endDate`, `renewalDate` | If present, must parse as ISO 8601 date (`YYYY-MM-DD`) or a recognizable date string (`MM/DD/YYYY`, `DD/MM/YYYY` — try both formats if ISO fails; if both fail, mark row as failed with specific field name in error) |
| `noticePeriodDays` | If present, must parse as a non-negative integer |
| `autoRenewal` | If present, must be `true`, `false`, `yes`, `no`, `1`, `0` (case-insensitive) |
| `status` | If present, must map to a valid `ContractStatus` enum value (case-insensitive); default `DRAFT` if absent or unrecognized |

A row that fails validation on `title` is marked `status: "failed"`. A row that fails on any other field is also marked `status: "failed"` (not partial-success). The error message must identify the specific field and the value that failed: e.g. `"endDate: '31/13/2024' is not a valid date"`.

Maximum rows per CSV: 1000. If the CSV has more than 1000 data rows (excluding header), reject the upload at the API layer with HTTP 422 and body `{ error: "csv_too_large", maxRows: 1000, actualRows: N }`.

### API route: `POST /api/import/csv`

- Auth: `resolveAuth(req)` — return 401 if null.
- Role: any member with write access (not viewer).
- Request: `multipart/form-data` with field `file` (the CSV file).
- Validation:
  - `Content-Type` of the file part must be `text/csv` or `application/vnd.ms-excel` or the filename must end with `.csv`.
  - File size: max 10 MB (10485760 bytes). Return 422 `{ error: "file_too_large", maxBytes: 10485760 }` if exceeded.
  - Parse the first row to confirm it is a valid CSV with at least one column. Return 422 `{ error: "invalid_csv" }` if not parseable.
  - Count data rows (excluding header). If > 1000, return 422 `{ error: "csv_too_large", maxRows: 1000, actualRows: N }`.
- Processing:
  1. Upload raw CSV to S3 under key `imports/{organizationId}/{jobId}/source.csv` using the existing `storage` client.
  2. Create `ImportJob` with `source: CSV`, `status: PENDING`, `storageKey: <the key above>`, `totalRows: N` (data row count).
  3. Enqueue `import.process` job with `{ importJobId, organizationId, createdById }`.
  4. Return 201: `{ jobId: string, totalRows: number }`.

### Column mapping UI (browser, not worker)

The API does **not** perform column mapping — the browser does. Flow:

1. User uploads CSV. The route returns `{ jobId, totalRows }` immediately after enqueueing (no mapping yet).

Wait — this needs clarification. The column mapping must happen **before** the job processes. Revised flow:

1. `POST /api/import/csv/preview` — uploads CSV, returns first 5 rows + detected headers + auto-suggested mapping. Does NOT create ImportJob yet.
2. User completes mapping in the UI.
3. `POST /api/import/csv` — sends the mapping + the `previewId` (a reference to the already-uploaded file). Creates ImportJob, enqueues processing.

#### `POST /api/import/csv/preview`

- Auth: same as above.
- Request: `multipart/form-data` with field `file`.
- Validation: same size/format checks as main route.
- Processing:
  1. Upload CSV to S3 under key `imports/{organizationId}/previews/{previewId}/source.csv`.
  2. Parse the header row + first 5 data rows.
  3. Auto-suggest column mapping: for each header, find the closest match from the alias table above (exact match first, then case-insensitive substring match). Unmapped columns produce `null`.
  4. Count total data rows.
  5. Return 200:
     ```json
     {
       "previewId": "clxxxx",
       "headers": ["Contract Name", "Client", "Start", "End", "Amount"],
       "suggestedMapping": {
         "Contract Name": "title",
         "Client": "counterpartyName",
         "Start": "startDate",
         "End": "endDate",
         "Amount": "value"
       },
       "previewRows": [
         ["Acme MSA", "Acme Corp", "2024-01-01", "2025-01-01", "50000"],
         ...
       ],
       "totalRows": 247,
       "storageKey": "imports/{organizationId}/previews/{previewId}/source.csv"
     }
     ```
- The `previewId` expires after 2 hours. Implement expiry by storing the creation timestamp in the `storageKey` path — the worker checks `createdAt` on the ImportJob and rejects jobs where `storageKey` contains a preview key older than 2 hours (this is enforced at the API layer by rejecting `POST /api/import/csv` if more than 2 hours have elapsed since the preview timestamp encoded in the previewId, using CUID creation timestamp).

  Simpler implementation: do NOT store previews in the DB. The `previewId` is just a reference token returned to the browser. The browser sends back the `storageKey` in step 3. The API validates the storageKey belongs to this org (by checking the path prefix `imports/{organizationId}/`).

#### `POST /api/import/csv` (revised, mapping-aware)

- Auth: same.
- Request body (JSON):
  ```typescript
  {
    storageKey: string        // the key from the preview response
    mapping: Record<string, string | null>   // { "CSV Header": "clauseflowField" | null }
    totalRows: number         // from preview — for ImportJob.totalRows
  }
  ```
- Validation:
  - `storageKey` must begin with `imports/{organizationId}/` — 422 if not.
  - `mapping` must have at least one entry with value `"title"` — 422 `{ error: "title_not_mapped" }` if not.
  - `totalRows` must be an integer > 0 and <= 1000.
- Creates `ImportJob`, enqueues job, returns 201 `{ jobId, totalRows }`.

### Worker: CSV handler (`lib/import/handlers/csv.ts`)

1. Download CSV from S3 (`job.storageKey`).
2. Parse with a streaming CSV parser (use the `csv-parse` package if already installed, or `papaparse` — check `package.json` first; do not add a new dependency if either is present).
3. Read the `mapping` from `ImportJob` — store the mapping JSON in a new field `ImportJob.mappingJson String?` (add to Prisma model; nullable).
4. For each data row:
   a. Map columns per the stored mapping.
   b. Validate all fields.
   c. On validation failure: update `ImportRow` to `status: "failed"`, `errorMessage: <specific message>`, increment `ImportJob.failedRows`, continue to next row.
   d. On success: call `createImportedContract(...)`, update `ImportRow` to `status: "success"`, `contractId: <id>`, increment `ImportJob.succeededRows`.
5. Write `ImportRow` records in batches of 50 using `prisma.importRow.createMany` to avoid N+1 DB round-trips for large CSVs.
6. Update `ImportJob.totalRows`, `succeededRows`, `failedRows` in a final `prisma.importJob.update` after all rows are done.

Note: `ImportJob.mappingJson` — add this field to the Prisma model:
```prisma
  mappingJson    String?   // JSON: { "CSV Header": "clauseflowField" | null }
```

---

## Feature 2: ZIP/Batch PDF+DOCX Upload

### API route: `POST /api/import/batch`

- Auth: `resolveAuth(req)` — 401 if null. Any member with write access (not viewer).
- Request: `multipart/form-data`. Accepted inputs:
  - A single ZIP file (field name: `file`, content-type: `application/zip` or `application/x-zip-compressed`, or filename ends with `.zip`).
  - OR multiple PDF/DOCX files (field name: `files[]`, up to 50 files).
- Validation:
  - If ZIP: max size 500 MB (524288000 bytes). Return 422 `{ error: "file_too_large", maxBytes: 524288000 }` if exceeded.
  - If multi-file: max 50 files. Return 422 `{ error: "too_many_files", maxFiles: 50 }` if exceeded. Each file max 50 MB (52428800 bytes). Return 422 `{ error: "file_too_large", filename: string, maxBytes: 52428800 }` for any file that exceeds this. Total across all files: max 500 MB. Return 422 `{ error: "total_size_too_large", maxBytes: 524288000 }` if exceeded.
  - For each individual file (and for each file extracted from the ZIP in the worker): validate by magic bytes (not MIME header) that it is PDF (`%PDF` at offset 0) or DOCX (`PK\x03\x04` at offset 0 — ZIP/OOXML format). Files failing magic-byte check are marked as `failed` with `errorMessage: "unsupported_file_type"`.
- Processing:
  1. If ZIP: upload entire ZIP to S3 under `imports/{organizationId}/{jobId}/source.zip`.
  2. If multi-file: upload each file to S3 under `imports/{organizationId}/{jobId}/files/{index}_{sanitized-filename}`. Store a JSON manifest at `imports/{organizationId}/{jobId}/manifest.json` listing all keys and original filenames.
  3. Create `ImportJob` with `source: BATCH_FILES`.
     - If ZIP: `storageKey = imports/{organizationId}/{jobId}/source.zip`, `totalRows = 0` (worker counts files after extracting ZIP).
     - If multi-file: `storageKey = imports/{organizationId}/{jobId}/manifest.json`, `totalRows = N` (known at upload time).
  4. Enqueue `import.process` job.
  5. Return 201: `{ jobId, totalRows }` (totalRows may be 0 for ZIP — UI should handle this gracefully with "counting files..." state).

### Worker: batch handler (`lib/import/handlers/batch.ts`)

**ZIP path:**
1. Download ZIP from S3.
2. Extract in memory using `fflate` (already a transitive dependency — check `node_modules`; use it if available, otherwise add `adm-zip` — do not use `unzipper` or native `zlib`).
3. Filter entries: only include files with extensions `.pdf` or `.docx` (case-insensitive). Skip `__MACOSX/`, `.DS_Store`, and any entry where the path has a leading `/` (zip slip protection).
4. Count valid entries. Update `ImportJob.totalRows`. If 0 valid entries: mark job `FAILED` with no rows.
5. Enforce: if valid entry count > 50, process the first 50, mark the rest as `skipped` with `errorMessage: "batch_limit_exceeded"`.
6. Enforce: total extracted size (sum of uncompressed sizes from ZIP central directory) must not exceed 500 MB. If exceeded, mark job `FAILED`.
7. For each valid entry:
   a. Validate magic bytes.
   b. Validate uncompressed size <= 52428800 bytes.
   c. Upload the extracted file buffer to S3 under `contracts/{organizationId}/{contractId}/files/{fileId}/{sanitized-filename}`.
   d. Call `createImportedContract(...)` with `title` = filename minus extension (spaces replacing underscores/hyphens, trim).
   e. Update `ImportRow`.

**Multi-file path:**
1. Download manifest JSON from S3.
2. For each entry in manifest:
   a. Download file from S3 (already uploaded at `POST /api/import/batch` time).
   b. Validate magic bytes.
   c. Call `createImportedContract(...)`.
   d. Update `ImportRow`.

---

## Feature 3: Google Drive Folder Scan

### OAuth Flow

Same pattern as M9 CRM OAuth: app-level credentials, per-org token storage, HMAC-signed state cookie.

Required Google OAuth scopes:
- `https://www.googleapis.com/auth/drive.readonly` — list files and download them.

The self-hoster must enable the Google Drive API in their Google Cloud project and add the redirect URI.

**`POST /api/import/gdrive/connect`** (note: POST not GET, to distinguish from the OAuth callback)
- Actually: **`GET /api/import/gdrive/connect`** — initiates OAuth redirect (GET is standard for OAuth initiation).
- Role: `admin` only.
- Generates OAuth state: `{ orgId, userId, nonce: 16-byte hex }`, HMAC-signed with `BETTER_AUTH_SECRET`.
- Stores state in HTTP-only cookie `gdrive_oauth_state`, 10-minute expiry.
- Redirects to: `https://accounts.google.com/o/oauth2/v2/auth` with params:
  - `client_id`: `GOOGLE_CLIENT_ID`
  - `redirect_uri`: `{NEXT_PUBLIC_APP_URL}/api/import/gdrive/callback`
  - `response_type`: `code`
  - `scope`: `https://www.googleapis.com/auth/drive.readonly`
  - `access_type`: `offline`
  - `prompt`: `consent` (forces refresh token to be issued every time)
  - `state`: the HMAC-signed state string

**`GET /api/import/gdrive/callback`**
- No auth check — called by Google.
- Validates state cookie + HMAC.
- Exchanges `code` for tokens via `POST https://oauth2.googleapis.com/token`.
- Encrypts `accessToken` and `refreshToken` with AES-256-GCM (same `encryptSecret`/`decryptSecret` from `lib/notifications/crypto.ts`).
- Upserts `GoogleDriveIntegration` record.
- Clears state cookie.
- Redirects to `/settings/import?tab=gdrive&connected=true`.

**`DELETE /api/import/gdrive/connect`**
- Role: `admin` only.
- Deletes `GoogleDriveIntegration` record.
- Response 204.

### File Listing

**`GET /api/import/gdrive/files?folderId=[id]`**
- Auth: any member (read-only).
- 503 if `GOOGLE_CLIENT_ID` is not set.
- 404 if no `GoogleDriveIntegration` for this org.
- Refreshes access token if expired (same inline refresh pattern as M9).
- Calls Google Drive API: `GET https://www.googleapis.com/drive/v3/files?q='[folderId]'+in+parents+and+(mimeType='application/pdf'+or+mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document'+or+mimeType='application/vnd.google-apps.folder')+and+trashed=false&fields=files(id,name,mimeType,size,modifiedTime)&pageSize=100`
- Returns max 100 items per call. Pagination is not surfaced in v1 — if the folder has more than 100 files, the first 100 are shown and a warning is included in the response.
- Response:
  ```json
  {
    "folderId": "...",
    "files": [
      { "id": "...", "name": "MSA Acme.pdf", "mimeType": "application/pdf", "sizeBytes": 1234567, "modifiedAt": "2024-03-01T..." },
      { "id": "...", "name": "Subfolder", "mimeType": "application/vnd.google-apps.folder", "sizeBytes": null, "modifiedAt": null }
    ],
    "truncated": false
  }
  ```
- If `folderId` is omitted: list the root (`root` as folderId in the Drive API).

### Google Drive Import

**`POST /api/import/gdrive/import`**
- Auth: any member with write access.
- 503 if `GOOGLE_CLIENT_ID` is not set.
- Body:
  ```typescript
  {
    fileIds: string[]    // Google Drive file IDs selected by the user
  }
  ```
- Validation:
  - `fileIds` must be a non-empty array. Max 50 items. Return 422 `{ error: "too_many_files", maxFiles: 50 }` if exceeded.
  - All `fileIds` must be non-empty strings.
- Processing:
  1. Create `ImportJob` with `source: GOOGLE_DRIVE`, `storageKey: null`, `driveFileIds: fileIds.join(",")`, `totalRows: fileIds.length`.
  2. Enqueue `import.process` job.
  3. Return 201: `{ jobId, totalRows }`.

### Worker: Google Drive handler (`lib/import/handlers/batch.ts`, same file as batch)

The Google Drive handler is the same logic as the multi-file batch handler, except instead of downloading from S3, it downloads each file from Google Drive:

1. Decrypt access token from `GoogleDriveIntegration`, refresh if expired.
2. Split `ImportJob.driveFileIds` by comma to get file IDs.
3. For each file ID:
   a. Fetch file metadata: `GET https://www.googleapis.com/drive/v3/files/{fileId}?fields=id,name,mimeType,size` — get `name` and `size`.
   b. Validate `size <= 52428800`. Mark failed if exceeded.
   c. Download file content: `GET https://www.googleapis.com/drive/v3/files/{fileId}?alt=media` with Bearer token.
   d. Validate magic bytes.
   e. Upload to S3 under `contracts/{organizationId}/{contractId}/files/{fileId}/{sanitized-filename}`.
   f. Call `createImportedContract(...)` with `title` = filename minus extension.
   g. Update `ImportRow`.

`lib/import/gdrive-client.ts` encapsulates all Drive API calls and token refresh logic:

```typescript
export interface DriveFile {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
}

export async function listDriveFiles(integration: GoogleDriveIntegration, folderId: string): Promise<DriveFile[]>
export async function getDriveFileMeta(integration: GoogleDriveIntegration, fileId: string): Promise<DriveFile>
export async function downloadDriveFile(integration: GoogleDriveIntegration, fileId: string): Promise<Buffer>
export async function refreshDriveTokenIfNeeded(integration: GoogleDriveIntegration): Promise<GoogleDriveIntegration>
```

`refreshDriveTokenIfNeeded` refreshes the token inline if `tokenExpiresAt < now + 5 minutes` (same pattern as M9). It updates the `GoogleDriveIntegration` record in Postgres using `getWorkerPrisma()` and returns the updated integration object with the fresh token.

---

## Feature 4: PandaDoc Export Import

PandaDoc's "Export All Documents" feature produces a ZIP with this structure:

```
export/
  document-title-abc123/
    document.pdf
    metadata.json
  another-document-def456/
    document.pdf
    metadata.json
```

The `metadata.json` schema (relevant fields only):

```json
{
  "name": "Service Agreement - Acme Corp",
  "status": "document.completed",
  "created_at": "2023-06-15T10:30:00Z",
  "completed_at": "2024-01-20T14:00:00Z",
  "expiration_date": "2025-01-20T00:00:00Z",
  "pricing": {
    "total": { "amount": 50000 },
    "currency": "USD"
  },
  "recipients": [
    { "role": "Client", "first_name": "Jane", "last_name": "Doe", "email": "jane@acme.com", "company_name": "Acme Corp" }
  ],
  "fields": {
    "start_date": { "value": "2024-01-20" }
  }
}
```

### API route: `POST /api/import/pandadoc`

- Auth: any member with write access.
- Request: `multipart/form-data`, field `file` (the PandaDoc export ZIP).
- Validation:
  - Must be a ZIP (magic bytes `PK\x03\x04`).
  - Max 500 MB.
- Processing:
  1. Upload ZIP to S3 under `imports/{organizationId}/{jobId}/source.zip`.
  2. Create `ImportJob` with `source: PANDADOC`, `totalRows: 0` (worker counts after extraction).
  3. Enqueue. Return 201 `{ jobId }`.

### Worker: PandaDoc handler (`lib/import/handlers/pandadoc.ts`)

1. Download ZIP from S3, extract in memory.
2. Detect PandaDoc format: look for entries matching the pattern `*/metadata.json` where the sibling `*/document.pdf` (or `*/document.docx`) exists. If no such entries found: mark job `FAILED` with `errorMessage: "not_a_pandadoc_export"`.
3. Collect all document directories (a directory = one contract). Update `ImportJob.totalRows`. Enforce max 50 documents; mark extras as `skipped`.
4. For each document directory:
   a. Parse `metadata.json`. If unparseable: mark row `failed`, continue.
   b. Map to `ImportedContractData`:

      | ClauseFlow field | PandaDoc source |
      |---|---|
      | `title` | `metadata.name` (required; if empty, use directory name) |
      | `counterpartyName` | First recipient's `company_name`, or `first_name + " " + last_name` if `company_name` is empty |
      | `counterpartyContact` | First recipient's `email` |
      | `value` | `pricing.total.amount` (if present) |
      | `currency` | `pricing.currency` (if present; default "USD") |
      | `startDate` | `fields.start_date.value` (if present) |
      | `endDate` | `expiration_date` (parse as ISO 8601 date only, strip time) |
      | `status` | Map: `"document.completed"` → `ACTIVE`; `"document.draft"` → `DRAFT`; all others → `DRAFT` |

   c. Attach `document.pdf` (or `document.docx` if PDF not present) as the file.
   d. Call `createImportedContract(...)`.
   e. Update `ImportRow`.

---

## Feature 5: Generic CLM Export Import (ContractBook / DocuSign CLM)

### ContractBook Export Structure

ContractBook's ZIP export:

```
contracts/
  Contract Title 1.pdf
  Contract Title 2.pdf
  ...
contracts.csv        (or metadata.csv)
```

The CSV columns (ContractBook uses these exact headers):
`ID`, `Title`, `Status`, `Created at`, `Signed at`, `Expiry date`, `Counterparty`, `Contract value`, `Currency`

### DocuSign CLM Export Structure

DocuSign CLM exports a ZIP with:

```
documents/
  {guid}/
    {guid}.pdf
    metadata.json    (or metadata.xml in older exports)
```

DocuSign `metadata.json` schema (relevant fields):
```json
{
  "documentId": "abc-def-...",
  "documentName": "Master Service Agreement",
  "status": "EXECUTED",
  "effectiveDate": "2024-01-15",
  "expirationDate": "2025-01-15",
  "parties": [
    { "partyName": "Acme Corporation", "partyType": "Counterparty" }
  ],
  "documentAmount": 75000,
  "currencyCode": "USD"
}
```

### API route: `POST /api/import/clm-export`

- Auth: any member with write access.
- Request: `multipart/form-data`, field `file`.
- Validation: must be ZIP, max 500 MB.
- Body also accepts optional field `format` (string): `"contractbook"` | `"docusign"` | `"auto"`. Default: `"auto"`.
- Processing: same as PandaDoc — upload to S3, create `ImportJob` with `source: CLM_EXPORT`, enqueue.

### Worker: CLM export handler (`lib/import/handlers/clm-export.ts`)

**Format detection (when `format = "auto"`):**

Check ZIP entries to determine format:
- ContractBook: has a file at root level named `contracts.csv` or `metadata.csv`, AND a folder named `contracts/`.
- DocuSign CLM: has a folder named `documents/` containing subdirectories, each containing a `metadata.json` or `metadata.xml`.
- If neither pattern matches: mark job `FAILED` with `errorMessage: "unknown_clm_export_format"`.

**ContractBook processing:**

1. Extract and parse the CSV (same CSV parsing logic as Feature 1, but with ContractBook-specific headers).
2. Column mapping (hard-coded, not user-configurable):

   | ClauseFlow field | ContractBook CSV header |
   |---|---|
   | `title` | `Title` |
   | `counterpartyName` | `Counterparty` |
   | `value` | `Contract value` |
   | `currency` | `Currency` |
   | `endDate` | `Expiry date` |
   | `startDate` | `Signed at` (best available proxy for effective date) |
   | `status` | `Status` → `"Active"` → `ACTIVE`; `"Draft"` → `DRAFT`; `"Signed"` → `ACTIVE`; `"Expired"` → `EXPIRED`; others → `DRAFT` |

3. For each CSV row: find the matching PDF in `contracts/` by filename matching `Title` field (case-insensitive, after stripping special chars). If no PDF found: create contract without file. If PDF found: attach it.
4. Call `createImportedContract(...)`, update `ImportRow`.

**DocuSign CLM processing:**

1. For each `documents/{guid}/` directory:
   a. Prefer `metadata.json` over `metadata.xml`. If only XML exists, parse it (use Node.js `DOMParser` via `@xmldom/xmldom` — add this dependency only if not already present; otherwise use regex for the small number of fields needed from DocuSign XML — specify in Open Questions which approach to use; for now spec assumes JSON path only; XML path is deferred if `@xmldom/xmldom` is not already a dependency).
   b. Map from JSON:

      | ClauseFlow field | DocuSign CLM JSON field |
      |---|---|
      | `title` | `documentName` |
      | `counterpartyName` | First party where `partyType == "Counterparty"` → `partyName`; if none found, first party of any type |
      | `value` | `documentAmount` |
      | `currency` | `currencyCode` |
      | `startDate` | `effectiveDate` |
      | `endDate` | `expirationDate` |
      | `status` | `"EXECUTED"` → `ACTIVE`; `"VOIDED"` → `TERMINATED`; `"DECLINED"` → `TERMINATED`; `"IN_PROCESS"` → `DRAFT`; others → `DRAFT` |

   c. Find the PDF in the same directory (file ending in `.pdf`).
   d. Call `createImportedContract(...)`, update `ImportRow`.

---

## API Routes: Status and Results

### `GET /api/import`

- Auth: any member.
- Returns paginated list of `ImportJob` records for the org.
- Query params: `page` (default 1), `limit` (default 20, max 100).
- Response:
  ```json
  {
    "jobs": [
      {
        "id": "...",
        "source": "CSV",
        "status": "COMPLETED",
        "totalRows": 200,
        "succeededRows": 197,
        "failedRows": 3,
        "createdAt": "...",
        "completedAt": "...",
        "createdBy": { "id": "...", "name": "Jane Doe" }
      }
    ],
    "total": 5,
    "page": 1,
    "limit": 20
  }
  ```

### `GET /api/import/[jobId]`

- Auth: any member.
- Returns the `ImportJob` record + all `ImportRow` records.
- 404 if jobId belongs to a different org.
- Response:
  ```json
  {
    "job": {
      "id": "...",
      "source": "CSV",
      "status": "PROCESSING",
      "totalRows": 200,
      "succeededRows": 120,
      "failedRows": 3,
      "errorReportKey": null,
      "createdAt": "...",
      "completedAt": null
    },
    "rows": [
      { "rowIndex": 1, "sourceRef": "...", "status": "success", "contractId": "...", "errorMessage": null },
      { "rowIndex": 4, "sourceRef": "...", "status": "failed", "contractId": null, "errorMessage": "endDate: '31/13/2024' is not a valid date" }
    ]
  }
  ```
- `rows` is returned for all rows when `totalRows <= 200`. When `totalRows > 200`, only `failed` rows are returned in the response (to keep payload manageable). The full list is available via the error report download.

### `GET /api/import/[jobId]/error-report`

- Auth: any member.
- 404 if job belongs to different org.
- 404 if `ImportJob.errorReportKey` is null (no failures or job not yet complete).
- Generates a presigned S3 URL (1-hour expiry) for the error report CSV and redirects to it (HTTP 302).
- The error report CSV has columns: `Row`, `Source Reference`, `Error Message`.

### `POST /api/import/[jobId]/retry`

- Auth: any member with write access.
- 404 if job belongs to different org.
- 422 if `ImportJob.status` is not `COMPLETED` or `FAILED` (can only retry a finished job).
- Resets `ImportJob.status = PENDING`, `startedAt = null`, `completedAt = null`.
- Resets `ImportRow` records with `status: "failed"` back to `status: "pending"`. Does not touch `status: "success"` rows — worker skips these.
- Enqueues a new `import.process` job.
- Response 202: `{ jobId }`.

---

## Notifications

Add `"import.completed"` as a new notification event in `lib/notifications/events.ts` (follow the same pattern as existing events):

```typescript
"import.completed": {
  label: "Import completed",
  description: "Fired when a contract import batch finishes",
  metadata: {
    source: "string",         // e.g. "CSV", "PANDADOC"
    totalRows: "number",
    succeededRows: "number",
    failedRows: "number",
  }
}
```

The notification is fired by the import processor after setting `ImportJob.status = COMPLETED`. It is NOT contract-scoped (there is no single `contractId` for a batch). The `contractId` field in the notification envelope is set to `""` (empty string) for this event — the notification system must tolerate this. If the notification system requires a non-empty `contractId`, use the `ImportJob.id` as a stand-in and document this in the notification metadata.

The `import.completed` event fires `enqueueNotification` for the org admin(s) only — not all members. This is consistent with how admin-scoped events work in the existing system.

---

## UI

### Settings navigation

Add "Import" to the settings sidebar in `apps/web/app/(app)/settings/layout.tsx`:

```typescript
{ href: "/settings/import", label: "Import", icon: Upload }  // Upload from lucide-react
```

Position: after "Integrations", before "API Keys".

### `/settings/import` page

Route: `apps/web/app/(app)/settings/import/page.tsx`

The page has five tabs, corresponding to the five import pathways:

```
[ Spreadsheet (CSV) ] [ Batch Files ] [ Google Drive ] [ PandaDoc ] [ CLM Export ]
```

Each tab contains:
1. A short description of the pathway and what source system it supports.
2. The import form for that pathway.
3. An "Import History" section at the bottom (shared across all tabs) showing the last 10 `ImportJob` records from `GET /api/import`.

#### Tab 1: Spreadsheet (CSV)

1. Step 1 — Upload:
   - A file dropzone (accept `.csv`).
   - On file select: call `POST /api/import/csv/preview`. Show loading spinner.
   - On success: advance to Step 2.

2. Step 2 — Map Columns:
   - Show a table with two columns: "Your CSV Column" (left) and "ClauseFlow Field" (right, a `<select>` per row).
   - Pre-populate `<select>` with suggested mapping from the preview response.
   - Available field options: `(ignore)`, `title *`, `contractType`, `counterpartyName`, `counterpartyContact`, `value`, `currency`, `startDate`, `endDate`, `renewalDate`, `noticePeriodDays`, `autoRenewal`, `notes`, `status`.
   - Show the preview table (first 5 rows from the preview response) below the mapping UI, with headers relabeled by the current mapping.
   - "Import N rows" button — disabled if `title` is not mapped to any column.
   - On button click: call `POST /api/import/csv` with the mapping and `storageKey`. Advance to Step 3.

3. Step 3 — Progress:
   - Poll `GET /api/import/[jobId]` every 3 seconds.
   - Show a progress bar: `(succeededRows + failedRows) / totalRows * 100%`.
   - On completion: show summary card: "197 contracts imported successfully. 3 rows failed." with a "Download Error Report" button (calls `GET /api/import/[jobId]/error-report`) if `failedRows > 0`.
   - "View Contracts" button links to `/contracts`.

#### Tab 2: Batch Files

1. A file dropzone accepting:
   - A single ZIP file, OR
   - Multiple PDF/DOCX files (up to 50, max 500 MB total).
   - Show the file count and total size in real-time as files are added.
2. "Upload and Import" button.
3. On click: POST to `POST /api/import/batch` as multipart.
4. Show per-file upload progress (browser `XMLHttpRequest` or `fetch` with `ReadableStream` for upload progress — if the complexity is high, show a single indeterminate spinner during upload instead, with a note: "Uploading files...").
5. On API response: advance to the progress polling view (same as CSV Step 3).

#### Tab 3: Google Drive

**Not connected state:**
- "Connect Google Drive" button → calls `GET /api/import/gdrive/connect` (navigates to Google OAuth).
- If `GOOGLE_CLIENT_ID` is not set (503 from the API): show a configuration warning: "Google Drive import is not configured for this installation. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` environment variables to enable it."

**Connected state:**
- Show "Connected as {user who connected}" + "Disconnect" button.
- A folder navigation tree:
  - Initial load: `GET /api/import/gdrive/files` (root folder).
  - Clicking a folder navigates into it: `GET /api/import/gdrive/files?folderId={id}`.
  - Breadcrumb trail showing current path (maintained in component state).
  - Show a list of files with checkboxes (PDF/DOCX only; folders shown but not selectable as files — clicking them navigates into them).
  - File list shows: icon (PDF or Word), filename, size, modified date.
  - If `truncated: true` in response: show warning banner "Showing first 100 files. Use subfolders to access the rest."
- "Select All" / "Deselect All" for the current folder's files.
- Footer: "N files selected (X MB)".
- "Import Selected" button — disabled if 0 files selected or >50 files selected.
- On click: call `POST /api/import/gdrive/import`, advance to progress view.

#### Tab 4: PandaDoc

1. A file dropzone accepting a single ZIP file.
2. "Upload and Import" button.
3. On click: POST to `POST /api/import/pandadoc`.
4. Progress view same as above.
5. Static note below the dropzone: "Export your documents from PandaDoc: go to Settings → Documents → Export All Documents. Upload the downloaded ZIP here."

#### Tab 5: CLM Export

1. A file dropzone accepting a single ZIP file.
2. A radio group: "Auto-detect format (recommended)" | "ContractBook" | "DocuSign CLM". Default: auto-detect.
3. "Upload and Import" button.
4. On click: POST to `POST /api/import/clm-export` with `format` field.
5. Progress view same as above.
6. Static note: "Supported formats: ContractBook export ZIP, DocuSign CLM export ZIP. For other tools, use the Batch Files tab."

#### Import History (shared, bottom of page)

A table showing the last 10 import jobs from `GET /api/import`:

| Date | Source | Status | Succeeded | Failed | Actions |
|---|---|---|---|---|---|
| 2026-05-10 14:32 | CSV | Completed | 197 | 3 | Error Report |
| 2026-05-09 09:10 | Batch Files | Completed | 45 | 0 | — |

- "Error Report" link only shown if `failedRows > 0`.
- Clicking a job row expands it to show the row-level results (only failed rows displayed in the expansion to keep it manageable).
- "View all" link → `/settings/import/history` (a full history page — out of scope for v1; link is present but grayed out with tooltip "Coming soon").

---

## Migration SQL (Prisma migration)

Migration name: `20260510180000_m10_import_tools`

```sql
-- CreateEnum
CREATE TYPE "ImportSource" AS ENUM ('CSV', 'BATCH_FILES', 'GOOGLE_DRIVE', 'PANDADOC', 'CLM_EXPORT');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable: ImportJob
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "source" "ImportSource" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "storageKey" TEXT,
    "driveFileIds" TEXT,
    "mappingJson" TEXT,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "succeededRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "errorReportKey" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ImportRow
CREATE TABLE "ImportRow" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "contractId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable: GoogleDriveIntegration
CREATE TABLE "GoogleDriveIntegration" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    "connectedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleDriveIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportJob_organizationId_status_idx" ON "ImportJob"("organizationId", "status");
CREATE INDEX "ImportJob_organizationId_createdAt_idx" ON "ImportJob"("organizationId", "createdAt");
CREATE INDEX "ImportRow_jobId_status_idx" ON "ImportRow"("jobId", "status");
CREATE INDEX "ImportRow_jobId_rowIndex_idx" ON "ImportRow"("jobId", "rowIndex");
CREATE UNIQUE INDEX "GoogleDriveIntegration_organizationId_key" ON "GoogleDriveIntegration"("organizationId");

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GoogleDriveIntegration" ADD CONSTRAINT "GoogleDriveIntegration_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GoogleDriveIntegration" ADD CONSTRAINT "GoogleDriveIntegration_connectedById_fkey"
    FOREIGN KEY ("connectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddColumn to ActivityAction enum
ALTER TYPE "ActivityAction" ADD VALUE 'IMPORT_COMPLETED';
```

---

## Implementation Order

1. Prisma: add `ImportJob`, `ImportRow`, `GoogleDriveIntegration` models + migration (`20260510180000_m10_import_tools`).
2. Update `ActivityAction` enum in `schema.prisma`: add `IMPORT_COMPLETED`.
3. Add `"ImportJob"` to `ORG_SCOPED_MODELS` in `lib/db/client.ts`.
4. Update `Organization` and `User` models in `schema.prisma` with new relations.
5. BullMQ: add `ImportProcessJobData` type + `getImportProcessQueue()` + lazy singleton + legacy export to `lib/jobs/queues.ts`.
6. `lib/import/create-contract.ts` — shared contract creation utility.
7. Worker handler registration in `apps/web/worker.ts`: import `processImportJob`, register `import.process` worker with `concurrency: 2`.
8. `lib/import/processor.ts` — dispatcher (reads ImportJob, delegates to handler by source, finalizes job on completion).
9. `lib/import/handlers/csv.ts` — CSV import handler.
10. API: `POST /api/import/csv/preview` and `POST /api/import/csv`.
11. `lib/import/handlers/batch.ts` — batch file + Google Drive handler.
12. API: `POST /api/import/batch`.
13. `lib/import/gdrive-client.ts` — Google Drive API client.
14. API: `GET /api/import/gdrive/connect`, `GET /api/import/gdrive/callback`, `DELETE /api/import/gdrive/connect`, `GET /api/import/gdrive/files`, `POST /api/import/gdrive/import`.
15. `lib/import/handlers/pandadoc.ts` — PandaDoc ZIP handler.
16. API: `POST /api/import/pandadoc`.
17. `lib/import/handlers/clm-export.ts` — ContractBook + DocuSign CLM handler.
18. API: `POST /api/import/clm-export`.
19. API: `GET /api/import`, `GET /api/import/[jobId]`, `GET /api/import/[jobId]/error-report`, `POST /api/import/[jobId]/retry`.
20. Notifications: add `"import.completed"` event to `lib/notifications/events.ts`.
21. UI: `/settings/import` page — all five tabs.
22. UI: settings sidebar nav entry.

---

## Open Questions

1. **CSV parsing library**: Is `csv-parse` or `papaparse` already in `apps/web/package.json`? If neither is present, engineer should add `csv-parse` (MIT, well-maintained, streaming-capable). Do not add both.

2. **ZIP extraction library**: Is `fflate` already a direct dependency of `apps/web` (it may be a transitive dep of another package)? If not, is `adm-zip` or another ZIP library already present? Engineer should check `apps/web/package.json` before adding a new dependency. If neither is present, add `fflate` (MIT, fast, works in Node.js with Buffer).

3. **DocuSign CLM XML metadata**: Older DocuSign exports use `metadata.xml` instead of `metadata.json`. Handling XML requires a parser. Is `@xmldom/xmldom` (or similar) already a dependency? If not, the XML path for DocuSign CLM should be deferred to a follow-up — the spec currently documents only the JSON path. Engineer should confirm and flag if the XML path needs to be scoped in or out.

4. **`import.completed` notification and contractId**: The existing notification system expects a `contractId` in the notification envelope (see `lib/notifications/fanout.ts`). An import batch produces multiple contracts with no single representative. Engineer must check whether the fanout system will accept an empty string or whether it requires a valid `contractId`. If a valid `contractId` is required, use the ID of the first successfully imported contract (or skip the notification entirely if zero contracts were created). This must be resolved before implementing step 20.

5. **Error report CSV upload to S3**: The error report is a generated CSV (not a user upload). The existing `storage` client's `put` method must support writing a `Buffer` or `string` directly. Engineer should confirm this from `lib/storage/index.ts`. If only `stream` or `file` is supported, the implementation must convert the Buffer to a `Readable` stream first.

6. **Google Drive OAuth — localhost redirect URI**: Self-hosters running ClauseFlow on localhost will need to add `http://localhost:3000/api/import/gdrive/callback` to their Google Cloud project's allowed redirect URIs. This is a documentation/UX issue, not a code issue — but the self-hosting guide (M4) should be updated with a note about Google Drive OAuth setup. Engineer should flag this to content-writer.

7. **`NOTIFICATION_ENCRYPTION_KEY` boot check in worker**: The worker currently throws if `NOTIFICATION_ENCRYPTION_KEY` is missing. Since M10 uses this key for Google Drive token encryption, no change is needed — but engineer should confirm that `GoogleDriveIntegration` encrypt/decrypt uses the same `encryptSecret`/`decryptSecret` from `lib/notifications/crypto.ts` (not a new key).

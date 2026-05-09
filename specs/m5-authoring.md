# M5 — Authoring

## Problem

ClauseFlow has no way to create a contract from scratch in the browser. Today every contract originates outside the system — typically in Word — and is uploaded as a file. This creates three concrete pain points for the ops and sales teams this product targets:

1. **No templates.** Legal ops teams cannot define a pre-approved NDA or MSA template that sales can fill in and send. Every contract starts from a blank Word doc or from memory.
2. **Word round-trips are slow.** Creating, editing, and exporting to Word just to get a signed PDF costs two to four hours per contract that could be eliminated.
3. **Author-to-pipeline gap.** There is no path from "I just drafted a contract" to "extract metadata and send for signing" without first exporting to a file and re-uploading it. The authoring and the CLM pipeline are disconnected.

User research confirms: ops teams and sales users want to create contracts from templates; lawyers will still review in Word. We are not building a Word replacement for legal review.

---

## Proposed Solution

1. **Browser-native contract editor** — Plate-based rich text editor on the contract detail page, behind an "Editor" tab. Supports legal document formatting, auto-saves to DB, and is read-only for signed/locked statuses.
2. **Template library** — Org-scoped templates with `{{variable_name}}` placeholders. Legal ops creates templates; sales fills in variables to instantiate a new contract.
3. **Word import** — Upload a .docx file into the editor tab to convert it to editable Plate content.
4. **Word/PDF export** — Generate a .docx or PDF from editor content without leaving the app.
5. **Pipeline integration** — "Send for extraction" button on the editor tab converts editor content to plain text and enqueues the existing `contract.ai_extract` job.

---

## Success Criteria

- A contract in `DRAFT` or `INTERNAL_REVIEW` status can be opened in the Editor tab and its content edited. Changes persist after a full page reload.
- Auto-save fires within 30 seconds of any keystroke, with no manual save required.
- A user can create a contract from a template, fill in all declared variables, and land on the Editor tab with those values pre-filled, in under 60 seconds of wall-clock time.
- Uploading a .docx of up to 10 MB converts to editable Plate content and is visible in the editor within 10 seconds of upload completion.
- "Export to Word" produces a valid .docx file that opens in Microsoft Word 365 without errors.
- "Send for extraction" on editor content enqueues the `contract.ai_extract` job and the extraction results appear in the AI Extractions tab within 5 minutes (subject to provider latency).
- The org isolation test continues to pass: org B cannot read or write org A's `ContractDocument` or `ContractTemplate` records.

---

## Scope

**IN:**
- Plate-based contract editor, "Editor" tab on the contract detail page
- `ContractDocument` Prisma model to store editor content
- Auto-save: debounced 30-second interval + on blur
- Read-only mode for contract statuses: `AWAITING_SIGNATURE`, `ACTIVE`, `EXPIRED`, `TERMINATED`, `ARCHIVED`
- Legal document formatting: H1, H2, H3, paragraph, numbered list, lettered list, indented clause, bold, italic, underline, table, horizontal rule
- Word count display in the editor toolbar
- `ContractTemplate` Prisma model (org-scoped, with variable declarations)
- Template library at `/templates` — list, create, edit, delete
- Template RBAC: any member can use templates; only `admin` and `legal` roles can create/edit/delete
- Variable syntax `{{variable_name}}` — rendered as styled inline chips in the editor; non-editable within body text
- "Fill variables" modal when instantiating a contract from a template
- Word import: .docx upload → mammoth → HTML → Plate JSON, available on Editor tab
- Word export: Plate JSON → .docx download, available on Editor tab
- PDF export: Plate JSON → PDF download, available on Editor tab
- "Send for extraction" button: serialise editor content to plain text, enqueue `contract.ai_extract`
- New `ActivityAction` enum values: `DOCUMENT_SAVED`, `DOCUMENT_IMPORTED`, `DOCUMENT_EXPORTED`
- Two new BullMQ queues: `document.convert` (DOCX→Plate) and `document.export` (Plate→DOCX/PDF)
- New environment variable: `DOCX_EXPORT_FONT` (optional, default `Times New Roman`)

**OUT (not in M5):**
- Real-time collaborative editing — M11
- Track changes / redlining — M10
- Clause library — M6
- Version diff viewer (comparing two saves) — M9 or later
- In-editor comments or annotations — v3
- AI-assisted drafting (suggest clause text) — cloud tier, C3+
- Counterparty portal — M12
- Template sharing across organisations — never (templates are org-scoped permanently)
- Template versioning or approval workflow — not in M5
- Import of PDF files into the editor — not in M5 (PDF upload to Files tab remains unchanged)
- Import of formats other than .docx — not in M5
- Watermarking exports — not in M5
- Digital signature directly from the editor (signing still goes through DocuSeal via the existing flow)

---

## Data Model Changes

### 1. `ContractDocument` — stores Plate JSON per contract

```prisma
model ContractDocument {
  id           String   @id @default(cuid())
  contractId   String   @unique
  contract     Contract @relation(fields: [contractId], references: [id], onDelete: Cascade)
  content      Json     // Plate JSON — array of top-level Plate nodes
  wordCount    Int      @default(0)
  version      Int      @default(1)  // incremented on every save, never reset
  savedById    String
  savedBy      User     @relation(fields: [savedById], references: [id])
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}
```

Add `document ContractDocument?` to the `Contract` model.

`content` is stored as Postgres `jsonb`. Max payload accepted by the API: 5 MB (enforced in the route handler before DB write, not by a DB constraint).

`version` is a monotonically incrementing integer. The client sends the `version` it last read as `clientVersion` in the save request. If `clientVersion !== currentVersion` when the save is processed, the API returns `409 Conflict` with body `{ error: "conflict", serverVersion: number }`. The client must re-fetch and present a "Document was updated elsewhere — reload?" prompt. It does not auto-merge.

### 2. `ContractTemplate` — org-scoped template document

```prisma
model ContractTemplate {
  id             String       @id @default(cuid())
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  name           String       // max 200 chars
  description    String?      // max 1000 chars
  contractType   ContractType?
  content        Json         // Plate JSON — same schema as ContractDocument.content
  variables      Json         // TemplateVariable[] — see Variable System section
  wordCount      Int          @default(0)
  createdById    String
  createdBy      User         @relation("TemplateCreator", fields: [createdById], references: [id])
  updatedById    String
  updatedBy      User         @relation("TemplateUpdater", fields: [updatedById], references: [id])
  isArchived     Boolean      @default(false)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
}
```

Add `templates ContractTemplate[]` to the `Organization` model.

Max 200 active (non-archived) templates per org. Enforced in the POST handler before insert, returning 422 `{ error: "template_limit_reached" }` if exceeded.

Templates are soft-deleted by setting `isArchived: true`. Hard deletes never occur.

### 3. `ActivityAction` enum additions

Add to the existing `ActivityAction` enum in `schema.prisma`:

```prisma
  DOCUMENT_SAVED
  DOCUMENT_IMPORTED
  DOCUMENT_EXPORTED
```

### 4. `Contract` model — no new columns required

The `Contract` model gains one relation only (`document ContractDocument?`). No new scalar fields.

---

## API Endpoints

All routes require `resolveAuth(req)`. Return 401 if null. Return 404 (not 403) when a resource belongs to another org. Validate all request bodies with Zod before any DB write. Follow the `requestContext.run(ctx, ...)` pattern from existing routes.

### Contract Document

**`GET /api/contracts/[id]/document`**
- Role: any member
- Response 200: `{ document: { id, content, wordCount, version, updatedAt } | null }`
- Returns `null` in `document` field (not 404) when no document exists yet for this contract.

**`PUT /api/contracts/[id]/document`**
- Role: any member (`admin`, `legal`, `member` — not `viewer`)
- Body Zod schema:
  ```typescript
  z.object({
    content: z.array(z.unknown()).max(50000), // max 50,000 array elements (top-level nodes)
    wordCount: z.number().int().min(0).max(1000000),
    clientVersion: z.number().int().min(0), // 0 means "I have no prior version — create"
  })
  ```
- If contract status is in `['AWAITING_SIGNATURE', 'ACTIVE', 'EXPIRED', 'TERMINATED', 'ARCHIVED']`: return 422 `{ error: "read_only_status" }`.
- If `ContractDocument` does not exist yet: create it with `version: 1`.
- If `ContractDocument` exists and `clientVersion !== document.version`: return 409 `{ error: "conflict", serverVersion: document.version }`.
- If `clientVersion === document.version`: update `content`, `wordCount`, increment `version` by 1, update `savedById`.
- Total serialised `content` JSON must be under 5,242,880 bytes (5 MB). Return 413 if exceeded.
- Write `DOCUMENT_SAVED` activity on every successful save.
- Response 200: `{ document: { id, wordCount, version, updatedAt } }` — content not echoed back.

### Word Import

**`POST /api/contracts/[id]/document/import`**
- Role: any member (`admin`, `legal`, `member`)
- Content-Type: `multipart/form-data`
- Field `file`: a single .docx file
- Validate by magic bytes: first 4 bytes must be `50 4B 03 04` (PK ZIP header — DOCX is a ZIP). Return 422 `{ error: "invalid_file_type" }` if not matching.
- Max file size: 10 MB. Return 413 if exceeded.
- Reject if contract status is in `['AWAITING_SIGNATURE', 'ACTIVE', 'EXPIRED', 'TERMINATED', 'ARCHIVED']`: return 422 `{ error: "read_only_status" }`.
- The route does NOT convert inline. It:
  1. Stores the .docx as a temporary S3 object under `tmp/docx-imports/{contractId}/{uuid}.docx`.
  2. Enqueues a `document.convert` BullMQ job with `{ contractId, storageKey, requestedById }`.
  3. Returns 202 `{ jobId: string }`.
- The client polls `GET /api/contracts/[id]/document/import/[jobId]` until `status` is `complete` or `failed`.

**`GET /api/contracts/[id]/document/import/[jobId]`**
- Role: same member who initiated the import (verified by `requestedById` in job data)
- Response 200: `{ status: "pending" | "complete" | "failed", error?: string }`
- On `complete`: the `ContractDocument` has already been upserted by the worker. The client re-fetches `GET /api/contracts/[id]/document`.

### Word / PDF Export

**`POST /api/contracts/[id]/document/export`**
- Role: any member
- Body Zod schema: `z.object({ format: z.enum(["docx", "pdf"]) })`
- Enqueues a `document.export` BullMQ job with `{ contractId, format, requestedById }`.
- Returns 202 `{ jobId: string }`.
- The client polls `GET /api/contracts/[id]/document/export/[jobId]`.

**`GET /api/contracts/[id]/document/export/[jobId]`**
- Role: same member who initiated (verified by `requestedById`)
- Response 200: `{ status: "pending" | "complete" | "failed", downloadUrl?: string, error?: string }`
- On `complete`: `downloadUrl` is a pre-signed S3 URL valid for 300 seconds. The worker stored the exported file under `exports/{contractId}/{jobId}.{format}`.
- Write `DOCUMENT_EXPORTED` activity once, when the worker marks the job complete.

### Send for Extraction

**`POST /api/contracts/[id]/document/extract`**
- Role: `admin` or `legal`
- No request body.
- Reads `ContractDocument.content` from DB. If no document exists: return 422 `{ error: "no_document" }`.
- Converts Plate JSON to plain text (see Plate-to-plaintext section below).
- Sets `contract.extractedText` to the plain text (updates in place).
- Enqueues `contract.ai_extract` job (existing queue).
- Writes `METADATA_EXTRACTED` activity.
- Response 200: `{ queued: true }`.

### Templates

**`GET /api/templates`**
- Role: any member
- Query params: `contractType?: ContractType`, `page: int (default 1, min 1)`, `limit: int (default 20, min 1, max 100)`
- Response 200: `{ templates: Array<{ id, name, description, contractType, wordCount, createdAt, updatedAt, createdBy: { id, name } }>, total, page, limit }`
- Filters out `isArchived: true` records.
- `content` and `variables` not returned in list response.

**`POST /api/templates`**
- Role: `admin` or `legal`
- Body Zod schema:
  ```typescript
  z.object({
    name: z.string().min(1).max(200),
    description: z.string().max(1000).optional(),
    contractType: z.enum(["NDA","MSA","SOW","EMPLOYMENT","VENDOR","CUSTOMER","OTHER"]).optional(),
    content: z.array(z.unknown()).max(50000),
    variables: z.array(z.object({
      name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/).max(64), // lowercase, underscores, max 64 chars
      label: z.string().min(1).max(100),
      type: z.enum(["text", "date", "number"]),
      required: z.boolean(),
      defaultValue: z.string().max(500).optional(),
    })).max(50),
    wordCount: z.number().int().min(0).max(1000000),
  })
  ```
- Enforce max 200 active templates per org before insert.
- Response 201: full template object including `content` and `variables`.

**`GET /api/templates/[id]`**
- Role: any member
- Response 200: full template object including `content` and `variables`.
- Return 404 if `isArchived: true` or belongs to different org.

**`PATCH /api/templates/[id]`**
- Role: `admin` or `legal`
- Body: same fields as POST, all optional. Partial update.
- `updatedById` set to caller's userId on every update.
- Response 200: full template object.

**`DELETE /api/templates/[id]`**
- Role: `admin` or `legal`
- Soft-delete: sets `isArchived: true`. Does not cascade to any contract.
- Response 204.

**`POST /api/templates/[id]/use`**
- Role: any member (`admin`, `legal`, `member`)
- Body Zod schema:
  ```typescript
  z.object({
    title: z.string().min(1).max(500),
    folderId: z.string().optional(),
    tagIds: z.array(z.string()).default([]),
    values: z.record(z.string(), z.string()), // variable name → user-supplied value
  })
  ```
- Validates that all `required: true` variables are present in `values`. Returns 422 `{ error: "missing_required_variables", missing: string[] }` if any are absent.
- Substitutes variable placeholders in the Plate JSON content (see Variable System — substitution logic).
- Creates a new `Contract` (via the same path as `POST /api/contracts`) with `status: DRAFT`, `contractType` from template.
- Creates a `ContractDocument` for the new contract with the substituted content and `version: 1`.
- Writes `CREATED` activity on the contract and `DOCUMENT_SAVED` activity on the document.
- Response 201: `{ contractId: string }`. The client navigates to `/contracts/{contractId}?tab=editor`.

---

## Variable System

### Syntax and storage

Variables are declared in `ContractTemplate.variables` as a JSON array of `TemplateVariable` objects:

```typescript
interface TemplateVariable {
  name: string        // machine name: lowercase, a-z, 0-9, underscore only, max 64 chars, must start with letter
  label: string       // human-readable label shown in fill modal, max 100 chars
  type: "text" | "date" | "number"
  required: boolean
  defaultValue?: string  // max 500 chars; pre-fills the modal input; must be valid per type
}
```

Max 50 variables per template. Enforced in POST/PATCH handlers.

Variable names must be unique within a template. The POST and PATCH handlers validate uniqueness and return 422 `{ error: "duplicate_variable_names", duplicates: string[] }` if names repeat.

### Plate inline node: `template_variable`

In the Plate JSON, a template variable is represented as a void inline element:

```typescript
{
  type: "template_variable",
  variable: "party_name",           // matches TemplateVariable.name
  children: [{ text: "" }],         // required by Plate for void elements
}
```

In the editor, this node renders as a styled non-editable chip. Visual spec:
- Background: `bg-indigo-100`
- Text: `text-indigo-800 text-sm font-medium`
- Padding: `px-2 py-0.5`
- Border radius: `rounded`
- Display: `inline-flex items-center`
- Text content shown inside chip: `{{party_name}}` (double braces + variable name)
- The chip is not contentEditable. Clicking it does nothing in template-editing mode.

After variable substitution (when instantiating a contract from a template), each `template_variable` node is replaced with a plain text node containing the user-supplied value:

```typescript
{ text: "Acme Corp" }   // replaces the template_variable node for party_name
```

Substitution is performed server-side in `POST /api/templates/[id]/use`. It is a deep recursive traversal of the Plate JSON. Any `template_variable` node whose `variable` name is not in `values` is replaced with its `defaultValue` if present, or with an empty string if `defaultValue` is absent.

### Variable discovery

`POST /api/templates` and `PATCH /api/templates/[id]` must validate that every `template_variable` node in `content` references a declared variable name. Return 422 `{ error: "undeclared_variables", names: string[] }` if a node in `content` references a variable name not present in `variables[].name`.

---

## Word Import Pipeline

### File validation

Magic bytes check: read first 4 bytes of the uploaded file. Must equal `[0x50, 0x4B, 0x03, 0x04]`. Any other value: reject immediately with 422, do not write to S3.

File size limit: 10 MB (10,485,760 bytes). Enforced before magic byte check.

### Worker job: `document.convert`

Queue name: `document.convert`

Job data interface:
```typescript
interface DocumentConvertJobData {
  contractId: string
  storageKey: string      // tmp/ path in S3
  requestedById: string
  jobId: string           // BullMQ job id, echoed for polling
}
```

BullMQ options: `{ removeOnComplete: 100, removeOnFail: 200, attempts: 1 }` — no automatic retries (the user can re-upload if it fails).

Worker logic:
1. Download the .docx from S3 using the storage client.
2. Run `mammoth.convertToHtml({ buffer })`. Capture the `value` (HTML string) and `messages` (warnings). If mammoth throws: mark job failed, set error message in job data.
3. Convert the HTML string to Plate JSON using a custom `htmlToPlateNodes(html: string): PlateNode[]` function (see HTML conversion rules below).
4. Count words: split serialised plain text on `/\s+/` and count non-empty tokens.
5. Upsert `ContractDocument` for the contract:
   - If none exists: create with `version: 1`.
   - If one exists: overwrite `content`, increment `version`, set `savedById` to `requestedById`.
6. Delete the temporary S3 object.
7. Write `DOCUMENT_IMPORTED` activity on the contract.

### HTML conversion rules (`htmlToPlateNodes`)

The mammoth HTML output is parsed with a server-side DOM parser (`@xmldom/xmldom` or Node's built-in DOMParser if available in the runtime). Tag mapping:

| HTML tag | Plate node type |
|---|---|
| `h1` | `{ type: "h1" }` |
| `h2` | `{ type: "h2" }` |
| `h3` | `{ type: "h3" }` |
| `p` | `{ type: "p" }` (default paragraph) |
| `ol` | `{ type: "ol" }` with `li` children |
| `ul` | `{ type: "ul" }` with `li` children |
| `li` | `{ type: "li" }` |
| `table` | `{ type: "table" }` |
| `tr` | `{ type: "tr" }` |
| `td` | `{ type: "td" }` |
| `th` | `{ type: "th" }` |
| `hr` | `{ type: "hr", children: [{ text: "" }] }` |
| `strong`, `b` | inline `bold: true` mark on text leaf |
| `em`, `i` | inline `italic: true` mark on text leaf |
| `u` | inline `underline: true` mark on text leaf |
| Any other block tag | treated as `{ type: "p" }` |
| Any other inline tag | text node with no marks |

Nested `ol`/`ul` elements (indented lists) produce Plate `indent` nodes if depth > 1. Depth increments by 1 per nesting level. Maximum depth: 6. Deeper nesting is flattened to depth 6.

Text nodes with only whitespace between block elements are discarded.

If the HTML output is empty (mammoth returned no content): set `content` to `[{ type: "p", children: [{ text: "" }] }]`.

---

## Export Pipeline

### Worker job: `document.export`

Queue name: `document.export`

Job data interface:
```typescript
interface DocumentExportJobData {
  contractId: string
  format: "docx" | "pdf"
  requestedById: string
  jobId: string
}
```

BullMQ options: `{ removeOnComplete: 100, removeOnFail: 200, attempts: 1 }`.

The worker:
1. Reads `ContractDocument.content` from DB.
2. If `format === "docx"`: runs the Plate JSON → DOCX conversion (see below).
3. If `format === "pdf"`: runs the Plate JSON → PDF conversion (see below).
4. Uploads the resulting `Buffer` to S3 under `exports/{contractId}/{jobId}.{format}` using the storage client.
5. Generates a pre-signed URL valid for 300 seconds.
6. Updates the BullMQ job's `returnvalue` with `{ downloadUrl }`.
7. Writes `DOCUMENT_EXPORTED` activity.

### DOCX generation

Library: `docx` (npm package `docx`, MIT licensed). Do not use `officegen`.

Font: value of env var `DOCX_EXPORT_FONT` if set, otherwise `Times New Roman`. Font size: 12pt for body paragraphs. H1: 24pt bold. H2: 20pt bold. H3: 16pt bold.

Plate node → `docx` object mapping:

| Plate type | `docx` class |
|---|---|
| `p` | `new Paragraph({ children: [...runs] })` |
| `h1` | `new Paragraph({ heading: HeadingLevel.HEADING_1, children: [...runs] })` |
| `h2` | `new Paragraph({ heading: HeadingLevel.HEADING_2, children: [...runs] })` |
| `h3` | `new Paragraph({ heading: HeadingLevel.HEADING_3, children: [...runs] })` |
| `ol` / `ul` with `li` children | `new Paragraph({ bullet: { level: 0 } })` per li (nested li: level incremented) |
| `table` | `new Table({ rows: [...] })` |
| `hr` | `new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6 } } })` |
| text leaf with `bold: true` | `new TextRun({ bold: true, text })` |
| text leaf with `italic: true` | `new TextRun({ italics: true, text })` |
| text leaf with `underline: true` | `new TextRun({ underline: { type: UnderlineType.SINGLE }, text })` |
| plain text leaf | `new TextRun({ text })` |

`template_variable` nodes found in exported content (which should not normally be present post-substitution, but may exist in a template export) are rendered as the literal string `{{variable_name}}` in a single `TextRun`.

Page margins: 1 inch (1440 twips) on all sides.

### PDF generation

Library: `@react-pdf/renderer` (MIT licensed).

The worker renders Plate JSON to a `@react-pdf/renderer` document tree server-side using `renderToBuffer`. This runs in the Node.js worker process, not in the browser.

Style mapping:

| Plate type | PDF style |
|---|---|
| `p` | `fontSize: 12, fontFamily: 'Times-Roman', marginBottom: 6` |
| `h1` | `fontSize: 24, fontFamily: 'Times-Bold', marginBottom: 10` |
| `h2` | `fontSize: 20, fontFamily: 'Times-Bold', marginBottom: 8` |
| `h3` | `fontSize: 16, fontFamily: 'Times-Bold', marginBottom: 6` |
| `ol`/`ul`/`li` | bullet prefix `•` for ul, numeric prefix for ol; `marginLeft: 20` |
| `table` | `@react-pdf/renderer` `View` grid with `border: 1` |
| `hr` | `borderBottom: 1, marginVertical: 8` |
| Bold text | `fontFamily: 'Times-Bold'` |
| Italic text | `fontFamily: 'Times-Italic'` |
| Bold+italic text | `fontFamily: 'Times-BoldItalic'` |
| Underline text | `textDecoration: 'underline'` |

Page size: A4. Margins: 72pt (1 inch) on all sides.

`template_variable` nodes render as `{{variable_name}}` in `Times-Roman`.

---

## Auto-Save Architecture

### Client-side strategy

The editor component maintains a `pendingSave` flag and a `saveTimer` ref.

On every content change event from Plate's `onChange` callback:
1. Clear any existing `saveTimer`.
2. Set `saveTimer = setTimeout(triggerSave, 30000)`.

On editor blur:
1. Clear any existing `saveTimer`.
2. Call `triggerSave()` immediately (no delay).

`triggerSave()`:
1. If `pendingSave === true`: skip (a save is already in flight).
2. Set `pendingSave = true`.
3. Call `PUT /api/contracts/[id]/document` with current content, word count, and `clientVersion`.
4. On 200: update local `clientVersion` state to the returned `document.version`. Set `pendingSave = false`. Show no toast (silent save).
5. On 409 Conflict: set `pendingSave = false`. Show toast: "Document updated elsewhere — reload to see the latest version." Do not auto-reload. The user must manually reload.
6. On 422 `read_only_status`: set `pendingSave = false`. Switch editor to read-only mode. Show toast: "This contract is now read-only."
7. On any other error: set `pendingSave = false`. Show toast: "Auto-save failed. Your changes are not saved." Log error to console.

### Save status indicator

The editor toolbar shows a save status text:
- Default (no changes since last save): `"Saved"` in `text-zinc-400`.
- After any content change, before the 30-second timer fires: `"Unsaved changes"` in `text-amber-600`.
- While save is in flight (`pendingSave === true`): `"Saving..."` in `text-zinc-400`.
- After a successful save: immediately changes back to `"Saved"` in `text-zinc-400`.
- On conflict: `"Conflict"` in `text-red-600`.
- On error: `"Save failed"` in `text-red-600`.

### Conflict handling

Conflicts are rare (single-user editing per contract in v1). The 409 response contains `serverVersion` for diagnostic purposes but the client does not auto-merge. The user is expected to reload. This is an explicit product decision: auto-merge without track-changes creates silent data loss risk.

---

## UI Screens

### Editor tab on contract detail page

Add a new `TabsTrigger` and `TabsContent` for `value="editor"` to the existing tab list in `app/(app)/contracts/[id]/page.tsx`. Insert it between the "Documents" tab and the "AI Extractions" tab.

Tab label: `Editor` (no count badge).

**Toolbar (top of editor content area):**

Left cluster (formatting controls — shown only when editor is editable):
- Heading dropdown: H1, H2, H3, Normal (paragraph)
- Bold button (B)
- Italic button (I)
- Underline button (U)
- Separator
- Ordered list button
- Unordered list button
- Separator
- Table insert button (inserts a 2×2 table)
- Horizontal rule button

Right cluster (actions):
- Word count: `"1,234 words"` in `text-sm text-zinc-500` — live count updated on content change
- Save status text (see Auto-Save Architecture section)
- `"Import from Word"` button — opens the import modal
- `"Export to Word"` button — triggers export job, polls, downloads on complete
- `"Export to PDF"` button — triggers export job, polls, downloads on complete
- `"Send for Extraction"` button — visible only to `admin` and `legal` roles, and only when a document exists

**Read-only banner (shown when contract status locks the editor):**

```
This contract is in [STATUS] status. The editor is read-only.
```

Displayed as a `bg-amber-50 border-amber-200 text-amber-800` banner above the editor content when `contract.status` is in `['AWAITING_SIGNATURE', 'ACTIVE', 'EXPIRED', 'TERMINATED', 'ARCHIVED']`.

**Empty state (no document exists and editor is editable):**

Show a centred placeholder inside the editor content area:
- Icon: `FileText` from lucide-react, `size-10 text-zinc-300`
- Text: `"Start writing your contract, or import a Word document."`
- Below: `"Import from Word"` button (outline variant)

**Word import modal:**

Triggered by `"Import from Word"` button. A shadcn `Dialog`.
- Title: `"Import from Word"`
- Body: `FileUploadZone` component (existing, already in `components/`) filtered to `.docx` only
- Warning text below the drop zone: `"Importing will replace the current editor content. This cannot be undone."`
- Buttons: `"Import"` (primary, disabled until file selected) and `"Cancel"`
- After `"Import"` click: button shows `"Uploading..."`, then `"Converting..."` while polling. On complete: dialog closes, editor reloads content.
- On conversion failure: show toast `"Import failed: [error message from job]"`. Dialog stays open so user can retry.

**Send for Extraction confirmation:**

Click on `"Send for Extraction"` shows an inline `AlertDialog` (not a full modal):
- Title: `"Send editor content for AI extraction?"`
- Body: `"This will replace any previously extracted text with the current editor content and re-run AI extraction."`
- Buttons: `"Send"` and `"Cancel"`
- On confirm: calls `POST /api/contracts/[id]/document/extract`. On success: toast `"Extraction queued"` and navigates to the AI Extractions tab.

### Template library — `/templates`

New page route: `app/(app)/templates/page.tsx`.

**List view:**

- Page title: `"Templates"`
- Right-side header button: `"New Template"` — visible to `admin` and `legal` only
- Filter row: `"All types"` dropdown (same values as `ContractType` enum + `"All"`)
- Template card grid (2 columns on md, 3 on lg):
  - Card fields: template name, contract type badge (using existing `TypeBadge`), description (truncated to 2 lines), word count, creator name, last updated relative time
  - Card actions: `"Use template"` button (primary), `"Edit"` button (outline, visible to `admin` and `legal` only), `"Delete"` icon button (visible to `admin` and `legal` only)
- Empty state: `"No templates yet. Create your first template to start drafting contracts faster."`
- Pagination: 20 templates per page, standard page controls at bottom

**Create / Edit template — `/templates/new` and `/templates/[id]/edit`**

Full-page editor view. Not a modal.

- Top bar: breadcrumb `Templates > [template name or "New Template"]`, save button, cancel link
- Left panel (240px fixed): template metadata fields
  - Name (required, text input, max 200 chars)
  - Description (optional, textarea, max 1000 chars)
  - Contract type (optional, select dropdown)
- Main area: Plate editor with same toolbar as the contract editor, plus a "Variables" panel on the right
- Right panel (240px fixed): Variables
  - Lists declared variables with name, label, type, required status
  - `"Add variable"` button: opens an inline form to add a new variable (fields: name, label, type, required, default value)
  - `"Insert into document"` button next to each variable: inserts a `template_variable` Plate node at the current cursor position
  - Delete button: removes the variable declaration (and highlights all usages in the editor with a red border to warn the author that they are now undeclared)
- Save button: calls POST or PATCH. Validates on client that all `template_variable` nodes in content reference declared variables. If not: shows toast `"Some variables in the document are not declared. Add them in the Variables panel or remove them from the document."` and does not submit.

**Fill variables modal (triggered by `"Use template"` on template list):**

A shadcn `Dialog`.
- Title: `"Create contract from [template name]"`
- Section 1 — Contract details:
  - Title (required, text input, pre-filled with template name)
  - Folder (optional, select from existing org folders)
- Section 2 — Variables (shown only if template has `variables.length > 0`):
  - For each declared variable in order: label, input (type="text" for `text`, type="date" for `date`, type="number" for `number`), required indicator (`*`)
  - Inputs pre-filled with `defaultValue` if declared
- Buttons: `"Create Contract"` (primary) and `"Cancel"`
- Client-side validation: required variable fields must be non-empty before submit. Show field-level error `"This field is required"` inline.
- On submit: POST to `/api/templates/[id]/use`. On 201: navigate to `/contracts/{contractId}?tab=editor`. On 422 missing_required_variables: show field-level errors for the missing ones (the server response includes `missing: string[]`).

---

## Template CRUD — Full Flow

### Creating a template (admin or legal)

1. User navigates to `/templates`, clicks `"New Template"`.
2. Route: `app/(app)/templates/new/page.tsx` — full page editor loads with empty content.
3. User types contract body, adds variables via Variables panel, inserts variable chips into document.
4. User fills Name and optional Description, selects Contract Type.
5. Clicks `"Save"`. Client validates all `template_variable` nodes in content are declared, then POSTs to `/api/templates`.
6. On 201: navigate to `/templates` with toast `"Template saved"`.
7. On 422 undeclared_variables: show toast with variable names listed.
8. On 422 template_limit_reached: show toast `"Template limit reached (200). Archive unused templates to create new ones."`

### Editing a template (admin or legal)

1. From template list, click `"Edit"` on a template card.
2. Route: `app/(app)/templates/[id]/edit/page.tsx` — loads template content via `GET /api/templates/[id]`.
3. Same editor as create. Save calls `PATCH /api/templates/[id]`.

### Archiving a template (admin or legal)

1. Click delete icon on template card. Confirmation: `"Archive this template? Existing contracts created from it are not affected."`.
2. On confirm: `DELETE /api/templates/[id]`. On 204: remove from list, toast `"Template archived"`.

### Using a template (any member)

1. From template list, click `"Use template"`.
2. Fill variables modal opens.
3. On submit: POST to `/api/templates/[id]/use`. Navigate to new contract editor tab.

---

## BullMQ Queue Definitions

Add to `lib/jobs/queues.ts` (or wherever queue types are defined):

**`document.convert`**

```typescript
export interface DocumentConvertJobData {
  contractId: string
  storageKey: string
  requestedById: string
  jobId: string
}
```

BullMQ options: `{ removeOnComplete: 100, removeOnFail: 200, attempts: 1 }`

**`document.export`**

```typescript
export interface DocumentExportJobData {
  contractId: string
  format: "docx" | "pdf"
  requestedById: string
  jobId: string
}
```

BullMQ options: `{ removeOnComplete: 100, removeOnFail: 200, attempts: 1 }`

Handlers for both queues live in `worker/` — not in `apps/web/`.

---

## Plate JSON → Plain Text (for extraction)

The `POST /api/contracts/[id]/document/extract` route needs plain text. The conversion is synchronous in the API route (not in a worker) because the source is already in the DB.

Algorithm: recursive depth-first traversal of the Plate JSON array.
- For each node with a `children` array: recurse into children.
- For each text leaf `{ text: string }`: append `text` to a string buffer.
- For each `{ type: "h1" | "h2" | "h3" | "p" }` node: append a double newline after processing children.
- For each `{ type: "li" }` node: prepend `"• "` and append a single newline after processing children.
- For each `{ type: "hr" }` node: append `"\n---\n"`.
- For each `{ type: "table" }`, `{ type: "tr" }`: append a newline after processing children.
- For each `{ type: "td" | "th" }`: append a tab after processing children.
- For each `{ type: "template_variable" }` node: append `{{variable_name}}` literally.
- Trim leading/trailing whitespace from the final string.

---

## Environment Variables

Add to `.env.example`:

```bash
# Optional — font family used in exported .docx files (default: Times New Roman)
DOCX_EXPORT_FONT=
```

No new required env vars. The feature runs without `DOCX_EXPORT_FONT` (falls back to default).

---

## Implementation Order

1. Prisma migration — `ContractDocument`, `ContractTemplate`, new `ActivityAction` values
2. `lib/jobs/queues.ts` — `DocumentConvertJobData`, `DocumentExportJobData` types + queue registrations
3. `lib/editor/html-to-plate.ts` — `htmlToPlateNodes(html)` conversion function
4. `lib/editor/plate-to-plaintext.ts` — `plateToPlaintext(content)` conversion function
5. `lib/editor/plate-to-docx.ts` — Plate JSON → `docx` package tree
6. `lib/editor/plate-to-pdf.ts` — Plate JSON → `@react-pdf/renderer` tree
7. Worker: `document.convert` handler (mammoth → HTML → Plate → DB upsert)
8. Worker: `document.export` handler (Plate → docx or PDF → S3 → pre-signed URL)
9. API: `GET /PUT /api/contracts/[id]/document`
10. API: `POST /GET /api/contracts/[id]/document/import` and `import/[jobId]`
11. API: `POST /GET /api/contracts/[id]/document/export` and `export/[jobId]`
12. API: `POST /api/contracts/[id]/document/extract`
13. API: templates CRUD (`GET/POST /api/templates`, `GET/PATCH/DELETE /api/templates/[id]`)
14. API: `POST /api/templates/[id]/use`
15. UI: Editor tab in `app/(app)/contracts/[id]/page.tsx` (Plate editor + toolbar + auto-save)
16. UI: Import from Word modal + polling
17. UI: Export buttons + polling + download
18. UI: Send for Extraction confirmation dialog
19. UI: `/templates` list page
20. UI: `/templates/new` and `/templates/[id]/edit` full-page editor
21. UI: Fill variables modal
22. Verify org isolation test passes for `ContractDocument` and `ContractTemplate`

---

## Open Questions

None — all design decisions are resolved:

- **Conflict resolution strategy:** server-wins, user reloads manually. No auto-merge without track changes (M10). This is intentional.
- **Import max size:** 10 MB. Rationale: mammoth memory usage scales with file size; large DOCX files with many embedded images cause OOM in the worker. Images are stripped by mammoth (they are not supported in the Plate editor in M5).
- **Export file naming:** `[contractTitle]-[YYYY-MM-DD].[format]`. Implemented client-side via the `Content-Disposition` hint in the pre-signed S3 URL or as a `download` attribute on the anchor element.
- **Template content max size:** same 5 MB JSON limit as `ContractDocument`. Enforced in `POST /PATCH /api/templates`.
- **`template_variable` chips in the contract editor (not template editor):** After substitution, no `template_variable` nodes exist in a contract document. If a user imports a raw template DOCX (containing literal `{{party_name}}` text) into a contract editor, the text `{{party_name}}` appears as a plain text string — it is NOT converted to a chip. Variable chip insertion is only available in the template editor UI, not the contract editor.
- **PDF renderer choice (`@react-pdf/renderer` vs puppeteer):** `@react-pdf/renderer` runs fully in Node.js without a headless browser, which simplifies the worker Docker image. Puppeteer is deferred unless fidelity complaints arise after launch.
- **`document.convert` and `document.export` retry count:** set to 1 (no retries). Conversion failures are user-actionable (re-upload or try a different file). Retrying a failed conversion is unlikely to produce a different result.
- **S3 tmp cleanup:** the `document.convert` worker deletes the `tmp/docx-imports/{contractId}/{uuid}.docx` object on job completion (success or failure). If the worker crashes mid-job before deletion, the tmp object is orphaned. A cleanup cron for objects older than 24 hours under `tmp/` is out of scope for M5 but logged for M4 or infrastructure maintenance work.

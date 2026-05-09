# Zapier / Make Integration

ClauseFlow does not yet ship a published Zapier app or Make.com connector. This document specifies the trigger and action surface a future Zapier / Make app would expose. Today, every capability described here is already available via the public API and outbound webhooks — you can wire ClauseFlow into Zapier, Make, n8n, or any other automation platform using a generic "Webhooks" trigger and HTTP action.

## Authentication

All API requests authenticate via Bearer token using a ClauseFlow API key.

- Header: `Authorization: Bearer cf_live_<key>`
- Generate keys at `/settings/api-keys` (admin only)
- Keys carry `read` and/or `write` scopes — request the minimum scopes you need
- Keys are scoped to a single organization

In Zapier, configure authentication as **API Key** auth with the header above.

## Triggers (10)

Triggers fire when ClauseFlow's outbound webhook system delivers a signed event to your registered URL. Register a webhook at `/settings/notifications` to obtain a per-org `signingSecret`. Every delivery includes an `X-ClauseFlow-Signature` header — see [Webhook signature verification](#webhook-signature-verification).

Each trigger receives the same envelope shape:

```json
{
  "event": "contract.signed",
  "orgId": "org_abc123",
  "timestamp": "2026-05-09T14:30:00.000Z",
  "apiVersion": "2026-05-01",
  "data": {
    "contractId": "ctr_xyz",
    "contractTitle": "Acme MSA 2026",
    "counterpartyName": "Acme Corp",
    "status": "ACTIVE",
    "ownerId": "usr_123",
    "actorId": "usr_456",
    "actorName": "Jane Smith",
    "metadata": {}
  }
}
```

| Trigger key | Label | Description |
|---|---|---|
| `contract.uploaded` | Contract file uploaded | Fires when a PDF or DOCX is attached to a contract. |
| `contract.extracted` | AI metadata extracted | Fires after the AI extraction job completes for a contract. |
| `approval.requested` | Approval request created | Fires when an approval is assigned to a member. |
| `approval.approved` | Approval approved | Fires when an approval is marked approved. |
| `approval.rejected` | Approval rejected | Fires when an approval is marked rejected. |
| `contract.sent_for_signing` | Contract sent for signing | Fires when a contract enters the `AWAITING_SIGNATURE` status. |
| `contract.signed` | Contract signed | Fires when all signers have completed signing. |
| `contract.expiring_soon` | Contract expiring soon | Fires for the EXPIRY_7 / EXPIRY_30 / EXPIRY_90 alert windows. `metadata.alertType` and `metadata.daysUntilExpiry` are populated. |
| `contract.expired` | Contract expired | Fires once the contract `endDate` has passed. `metadata.alertType` is `EXPIRY_PAST`. |
| `contract.archived` | Contract archived | Fires when a contract is moved to `ARCHIVED` status. |

### Sample payloads

**`approval.requested`**

```json
{
  "event": "approval.requested",
  "orgId": "org_abc123",
  "timestamp": "2026-05-09T14:30:00.000Z",
  "apiVersion": "2026-05-01",
  "data": {
    "contractId": "ctr_xyz",
    "contractTitle": "Acme MSA 2026",
    "counterpartyName": "Acme Corp",
    "status": "IN_REVIEW",
    "ownerId": "usr_owner",
    "actorId": "usr_requester",
    "actorName": "Jane Smith",
    "metadata": {
      "approvalId": "appr_123",
      "assigneeId": "usr_assignee",
      "assigneeName": "John Doe",
      "requesterId": "usr_requester",
      "requesterName": "Jane Smith",
      "message": "Please review section 4.2"
    }
  }
}
```

**`contract.expiring_soon`**

```json
{
  "event": "contract.expiring_soon",
  "orgId": "org_abc123",
  "timestamp": "2026-05-09T08:00:00.000Z",
  "apiVersion": "2026-05-01",
  "data": {
    "contractId": "ctr_xyz",
    "contractTitle": "Acme MSA 2026",
    "counterpartyName": "Acme Corp",
    "status": "ACTIVE",
    "ownerId": "usr_owner",
    "actorId": null,
    "actorName": null,
    "metadata": {
      "alertType": "EXPIRY_30",
      "daysUntilExpiry": 30
    }
  }
}
```

## Actions (3)

Actions perform writes against the ClauseFlow API. Each maps directly to an existing endpoint.

### Create Contract

- Endpoint: `POST /api/contracts`
- Required scopes: `write`
- Inputs: `title`, `contractType`, optional `counterpartyName`, `value`, `currency`, `startDate`, `endDate`, `tags`
- Output: full contract record (id, status, createdAt, ...)

```bash
curl -X POST https://app.example.com/api/contracts \
  -H "Authorization: Bearer cf_live_..." \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Acme MSA 2026",
    "contractType": "MSA",
    "counterpartyName": "Acme Corp"
  }'
```

### Get Contract

- Endpoint: `GET /api/contracts/{id}`
- Required scopes: `read`
- Inputs: `id`
- Output: full contract record including metadata, owner, current status, tags, folders

```bash
curl https://app.example.com/api/contracts/ctr_xyz \
  -H "Authorization: Bearer cf_live_..."
```

### Search Contracts

- Endpoint: `GET /api/search`
- Required scopes: `read`
- Inputs: `q` (keyword string), optional `mode=semantic|fulltext`, `limit`, `cursor`
- Output: paginated list of contract summaries

```bash
curl "https://app.example.com/api/search?q=Acme%20MSA&mode=semantic" \
  -H "Authorization: Bearer cf_live_..."
```

## Webhook setup

1. Sign in as an org admin.
2. Navigate to `/settings/notifications` → Outbound Webhooks → "Add webhook".
3. Enter a label and your destination URL (Zapier "Catch Hook", Make "Custom webhook", n8n "Webhook" node, etc.).
4. After save, ClauseFlow displays the `signingSecret` **once**. Copy it immediately — it cannot be retrieved again. Lose it and you must recreate the webhook.
5. Validate the `X-ClauseFlow-Signature` header on every incoming request (see below).

Failed deliveries are retried automatically: 10 s, 30 s, 90 s. After three failures the delivery is marked `failed` and surfaced in the delivery log at `/settings/notifications/webhooks/{id}/deliveries`.

## Webhook signature verification

Every delivery carries:

- `X-ClauseFlow-Signature: sha256=<lowercase hex digest>`
- `Content-Type: application/json`

To verify:

1. Read the raw request body as bytes (do not parse and re-stringify — the JSON encoding will differ).
2. Compute `HMAC-SHA256(secret_bytes, body_bytes)` where `secret_bytes = hex_decode(signingSecret)` (the secret stored on creation is a 32-character hex string representing 16 bytes).
3. Format as `sha256=<hex>` and compare against the header using a constant-time comparison.

### Node.js

```javascript
import crypto from "node:crypto"

function verify(rawBody, header, signingSecretHex) {
  const expected = "sha256=" + crypto
    .createHmac("sha256", Buffer.from(signingSecretHex, "hex"))
    .update(rawBody)
    .digest("hex")
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
```

### Python

```python
import hmac, hashlib

def verify(raw_body: bytes, header: str, signing_secret_hex: str) -> bool:
    expected = "sha256=" + hmac.new(
        bytes.fromhex(signing_secret_hex),
        raw_body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(header, expected)
```

If the signature does not match, reject the request with 401. Never act on an unverified webhook payload.

## API version

The current envelope `apiVersion` is `2026-05-01`. Future breaking changes will bump this string and remain available alongside the previous version for at least 90 days.

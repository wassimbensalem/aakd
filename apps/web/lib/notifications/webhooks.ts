/**
 * Webhook notification helpers for renewal alerts and lifecycle events.
 * Supports Slack (Block Kit) and Microsoft Teams (Adaptive Card).
 *
 * sendSlackAlert / sendTeamsAlert are the legacy renewal-alert path —
 * they read the webhook URL from env at call time. The newer
 * sendSlackEvent / sendTeamsEvent take an explicit (already-decrypted)
 * URL and cover all 10 M5 notification events.
 *
 * Every helper:
 * - Returns false on any failure — never throws
 * - Logs the error for operator visibility
 */
import { HUMAN_EVENT_LABELS, type NotificationEventName } from "@/lib/notifications/fanout"

export interface AlertWebhookOpts {
  contractTitle: string
  counterpartyName: string | null
  daysUntilExpiry: number
  contractId: string
  appUrl: string
}

export interface NotificationEventOpts {
  webhookUrl: string
  eventName: string
  contractTitle: string
  counterpartyName: string | null
  actorName: string | null
  contractId: string
  appUrl: string
  metadata: Record<string, string | number | boolean | null>
}

function eventLabel(eventName: string): string {
  return HUMAN_EVENT_LABELS[eventName as NotificationEventName] ?? eventName
}

function metadataLines(metadata: Record<string, string | number | boolean | null>): string[] {
  const lines: string[] = []
  if (typeof metadata.daysUntilExpiry === "number") {
    lines.push(`Expires in ${metadata.daysUntilExpiry} day${metadata.daysUntilExpiry === 1 ? "" : "s"}`)
  }
  if (typeof metadata.assigneeName === "string") {
    lines.push(`Assignee: ${metadata.assigneeName}`)
  }
  if (typeof metadata.requesterName === "string") {
    lines.push(`Requested by: ${metadata.requesterName}`)
  }
  if (typeof metadata.decidedByName === "string") {
    lines.push(`Decided by: ${metadata.decidedByName}`)
  }
  if (typeof metadata.comment === "string" && metadata.comment.length > 0) {
    lines.push(`Comment: ${metadata.comment}`)
  }
  if (typeof metadata.message === "string" && metadata.message.length > 0) {
    lines.push(`Message: ${metadata.message}`)
  }
  return lines
}

// ─── Slack ────────────────────────────────────────────────────────────────────

/**
 * Sends a Slack incoming webhook message using Block Kit layout.
 * Returns true on success, false on any failure (including missing env var).
 */
export async function sendSlackAlert(opts: AlertWebhookOpts): Promise<boolean> {
  const url = process.env.SLACK_WEBHOOK_URL
  if (!url) return false

  const { contractTitle, counterpartyName, daysUntilExpiry, contractId, appUrl } = opts
  const counterparty = counterpartyName ?? "Unknown"
  const contractUrl = `${appUrl}/contracts/${contractId}`

  const payload = {
    text: `Contract expiring soon: ${contractTitle}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "⚠️ Contract Expiring Soon" },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Contract:*\n${contractTitle}` },
          { type: "mrkdwn", text: `*Counterparty:*\n${counterparty}` },
          { type: "mrkdwn", text: `*Days Until Expiry:*\n${daysUntilExpiry} days` },
        ],
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "View Contract" },
            url: contractUrl,
            style: "primary",
          },
        ],
      },
    ],
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      console.error(`[webhooks] Slack returned ${res.status} for contract ${contractId}`)
      return false
    }
    return true
  } catch (err) {
    console.error(`[webhooks] Slack fetch failed for contract ${contractId}:`, err)
    return false
  }
}

// ─── Microsoft Teams ──────────────────────────────────────────────────────────

/**
 * Sends a Microsoft Teams incoming webhook message using an Adaptive Card.
 * Returns true on success, false on any failure (including missing env var).
 */
export async function sendTeamsAlert(opts: AlertWebhookOpts): Promise<boolean> {
  const url = process.env.TEAMS_WEBHOOK_URL
  if (!url) return false

  const { contractTitle, counterpartyName, daysUntilExpiry, contractId, appUrl } = opts
  const counterparty = counterpartyName ?? "Unknown"
  const contractUrl = `${appUrl}/contracts/${contractId}`

  const payload = {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            {
              type: "TextBlock",
              text: "⚠️ Contract Expiring Soon",
              weight: "Bolder",
              size: "Medium",
            },
            {
              type: "FactSet",
              facts: [
                { title: "Contract", value: contractTitle },
                { title: "Counterparty", value: counterparty },
                { title: "Days Until Expiry", value: `${daysUntilExpiry} days` },
              ],
            },
          ],
          actions: [
            {
              type: "Action.OpenUrl",
              title: "View Contract",
              url: contractUrl,
            },
          ],
        },
      },
    ],
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      console.error(`[webhooks] Teams returned ${res.status} for contract ${contractId}`)
      return false
    }
    return true
  } catch (err) {
    console.error(`[webhooks] Teams fetch failed for contract ${contractId}:`, err)
    return false
  }
}

// ─── M5: Slack lifecycle event ────────────────────────────────────────────────

export async function sendSlackEvent(opts: NotificationEventOpts): Promise<boolean> {
  const { webhookUrl, eventName, contractTitle, counterpartyName, actorName, contractId, appUrl, metadata } = opts
  if (!webhookUrl) return false

  const label = eventLabel(eventName)
  const counterparty = counterpartyName ?? "—"
  const actor = actorName ?? "System"
  const contractUrl = `${appUrl}/contracts/${contractId}`
  const extras = metadataLines(metadata)

  const blocks: Array<Record<string, unknown>> = [
    {
      type: "header",
      text: { type: "plain_text", text: label },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Contract:*\n${contractTitle}` },
        { type: "mrkdwn", text: `*Counterparty:*\n${counterparty}` },
        { type: "mrkdwn", text: `*Actor:*\n${actor}` },
      ],
    },
  ]

  if (extras.length > 0) {
    blocks.push({
      type: "context",
      elements: extras.map((text) => ({ type: "mrkdwn", text })),
    })
  }

  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "View Contract" },
        url: contractUrl,
        style: "primary",
      },
    ],
  })

  const payload = { text: `${label}: ${contractTitle}`, blocks }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      console.error(`[webhooks] Slack event returned ${res.status} for contract ${contractId}`)
      return false
    }
    return true
  } catch (err) {
    console.error(`[webhooks] Slack event fetch failed for contract ${contractId}:`, err)
    return false
  }
}

// ─── M5: Microsoft Teams lifecycle event ──────────────────────────────────────

export async function sendTeamsEvent(opts: NotificationEventOpts): Promise<boolean> {
  const { webhookUrl, eventName, contractTitle, counterpartyName, actorName, contractId, appUrl, metadata } = opts
  if (!webhookUrl) return false

  const label = eventLabel(eventName)
  const counterparty = counterpartyName ?? "—"
  const actor = actorName ?? "System"
  const contractUrl = `${appUrl}/contracts/${contractId}`

  const facts: Array<{ title: string; value: string }> = [
    { title: "Contract", value: contractTitle },
    { title: "Counterparty", value: counterparty },
    { title: "Actor", value: actor },
  ]
  if (typeof metadata.daysUntilExpiry === "number") {
    facts.push({
      title: "Expires in",
      value: `${metadata.daysUntilExpiry} day${metadata.daysUntilExpiry === 1 ? "" : "s"}`,
    })
  }
  if (typeof metadata.assigneeName === "string") {
    facts.push({ title: "Assignee", value: metadata.assigneeName })
  }
  if (typeof metadata.requesterName === "string") {
    facts.push({ title: "Requested by", value: metadata.requesterName })
  }
  if (typeof metadata.decidedByName === "string") {
    facts.push({ title: "Decided by", value: metadata.decidedByName })
  }
  if (typeof metadata.comment === "string" && metadata.comment.length > 0) {
    facts.push({ title: "Comment", value: metadata.comment })
  }
  if (typeof metadata.message === "string" && metadata.message.length > 0) {
    facts.push({ title: "Message", value: metadata.message })
  }

  const payload = {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.4",
          body: [
            { type: "TextBlock", text: label, weight: "Bolder", size: "Medium" },
            { type: "FactSet", facts },
          ],
          actions: [
            { type: "Action.OpenUrl", title: "View Contract", url: contractUrl },
          ],
        },
      },
    ],
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      console.error(`[webhooks] Teams event returned ${res.status} for contract ${contractId}`)
      return false
    }
    return true
  } catch (err) {
    console.error(`[webhooks] Teams event fetch failed for contract ${contractId}:`, err)
    return false
  }
}

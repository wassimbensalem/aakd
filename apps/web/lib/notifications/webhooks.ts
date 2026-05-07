/**
 * Webhook notification helpers for renewal alerts.
 * Supports Slack (Block Kit) and Microsoft Teams (Adaptive Card).
 *
 * Both functions:
 * - Read webhook URL from env at call time (not module load time)
 * - Return false immediately when env var is not set — graceful degradation
 * - Wrap fetch in try/catch and return false on any error — never throw
 */

export interface AlertWebhookOpts {
  contractTitle: string
  counterpartyName: string | null
  daysUntilExpiry: number
  contractId: string
  appUrl: string
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

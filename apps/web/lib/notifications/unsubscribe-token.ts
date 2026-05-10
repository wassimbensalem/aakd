import crypto from "node:crypto"

import type { NotificationEventName } from "./events"
import { isNotificationEventName } from "./events"

const DEFAULT_TTL_SECONDS = 90 * 24 * 3600 // 90 days

function computeSignature(
  userId: string,
  orgId: string,
  eventName: string,
  exp: number,
): string {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required")
  return crypto
    .createHmac("sha256", secret)
    .update(`${userId}:${orgId}:${eventName}:${exp}`)
    .digest("base64url")
}

export function buildUnsubscribeToken(
  userId: string,
  orgId: string,
  eventName: NotificationEventName,
): string {
  const exp = Math.floor(Date.now() / 1000) + DEFAULT_TTL_SECONDS
  const signature = computeSignature(userId, orgId, eventName, exp)
  const envelope = JSON.stringify({
    u: userId,
    o: orgId,
    e: eventName,
    x: exp,
    s: signature,
  })
  return Buffer.from(envelope, "utf8").toString("base64url")
}

export interface DecodedUnsubscribeToken {
  userId: string
  orgId: string
  eventName: NotificationEventName
}

export function verifyUnsubscribeToken(
  token: string,
): DecodedUnsubscribeToken | null {
  let parsed: { u?: unknown; o?: unknown; e?: unknown; x?: unknown; s?: unknown }
  try {
    const json = Buffer.from(token, "base64url").toString("utf8")
    parsed = JSON.parse(json) as typeof parsed
  } catch {
    return null
  }

  if (
    typeof parsed.u !== "string" ||
    typeof parsed.o !== "string" ||
    typeof parsed.e !== "string" ||
    typeof parsed.x !== "number" ||
    typeof parsed.s !== "string"
  ) {
    return null
  }

  if (!isNotificationEventName(parsed.e)) return null

  // Reject expired tokens — limits damage from a leaked email
  if (parsed.x < Math.floor(Date.now() / 1000)) return null

  let expected: string
  try {
    expected = computeSignature(parsed.u, parsed.o, parsed.e, parsed.x)
  } catch {
    return null
  }

  const a = Buffer.from(parsed.s)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return null
  if (!crypto.timingSafeEqual(a, b)) return null

  return { userId: parsed.u, orgId: parsed.o, eventName: parsed.e }
}

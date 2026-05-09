import crypto from "node:crypto"

import type { NotificationEventName } from "./events"
import { isNotificationEventName } from "./events"

function computeSignature(
  userId: string,
  orgId: string,
  eventName: string,
): string {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error("BETTER_AUTH_SECRET is required")
  return crypto
    .createHmac("sha256", secret)
    .update(`${userId}:${orgId}:${eventName}`)
    .digest("base64url")
}

export function buildUnsubscribeToken(
  userId: string,
  orgId: string,
  eventName: NotificationEventName,
): string {
  const signature = computeSignature(userId, orgId, eventName)
  const envelope = JSON.stringify({
    u: userId,
    o: orgId,
    e: eventName,
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
  let parsed: { u?: unknown; o?: unknown; e?: unknown; s?: unknown }
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
    typeof parsed.s !== "string"
  ) {
    return null
  }

  if (!isNotificationEventName(parsed.e)) return null

  let expected: string
  try {
    expected = computeSignature(parsed.u, parsed.o, parsed.e)
  } catch {
    return null
  }

  const a = Buffer.from(parsed.s)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return null
  if (!crypto.timingSafeEqual(a, b)) return null

  return { userId: parsed.u, orgId: parsed.o, eventName: parsed.e }
}

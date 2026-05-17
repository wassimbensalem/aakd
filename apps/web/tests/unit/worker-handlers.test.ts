/**
 * Worker Handler Unit Tests
 *
 * Tests utility modules used by the BullMQ workers:
 *
 * 1. lib/notifications/crypto.ts        — AES-256-GCM encrypt/decrypt
 * 2. lib/notifications/unsubscribe-token.ts — HMAC-signed tokens
 * 3. lib/notifications/write-in-app.ts  — in-app notification writes
 * 4. lib/notifications/validate-webhook-url.ts — SSRF guard
 * 5. lib/notifications/fanout.ts        — enqueueNotification
 * 6. worker/jobs/signing-sync.ts        — DocuSeal sync worker factory
 *
 * All external dependencies (Prisma, Storage, BullMQ, DocuSeal) are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ─────────────────────────────────────────────────────────────────────────────
// Top-level module mocks (hoisted by Vitest before any imports)
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("@/lib/db/client", () => {
  const prisma: any = {
    notification: {
      create: vi.fn().mockResolvedValue({ id: "notif-1" }),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    member: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
    },
    contract: { update: vi.fn().mockResolvedValue({}) },
    contractFile: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    },
    contractSigner: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    activity: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn().mockImplementation(async (arg: unknown) => {
      if (typeof arg === "function") return (arg as any)(prisma)
      if (Array.isArray(arg)) return Promise.all(arg)
      return arg
    }),
  }
  return { prisma }
})

vi.mock("@/lib/db/worker-client", () => {
  const db: any = {
    contract: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
    contractFile: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
    },
    contractSigner: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    activity: { create: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn().mockImplementation(async (arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg)
      if (typeof arg === "function") return (arg as any)(db)
      return arg
    }),
  }
  return { getWorkerPrisma: vi.fn().mockReturnValue(db) }
})

vi.mock("@/lib/storage", () => ({
  storage: {
    upload: vi.fn().mockResolvedValue("storage/signed_doc.pdf"),
    getSignedDownloadUrl: vi.fn().mockResolvedValue("https://s3.example.com/signed.pdf"),
    storageKey: vi.fn((_o: string, _i: string, n: string) => `storage/${_o}/${_i}/${n}`),
  },
}))

vi.mock("@/lib/docuseal", () => ({
  getSubmission: vi.fn(),
  isAllowedDocuSealUrl: vi.fn().mockReturnValue(true),
}))

vi.mock("@/lib/notifications/fanout", () => ({
  enqueueNotification: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/jobs/queues", () => ({
  notificationFanoutQueue: { add: vi.fn().mockResolvedValue(undefined) },
  contractExtractQueue: { add: vi.fn().mockResolvedValue(undefined) },
  contractAiExtractQueue: { add: vi.fn().mockResolvedValue(undefined) },
  contractEmbedQueue: { add: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock("bullmq", () => ({
  Worker: vi.fn().mockImplementation(() => ({ on: vi.fn(), close: vi.fn() })),
  Job: vi.fn(),
}))

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// ─────────────────────────────────────────────────────────────────────────────
// Imports (after all vi.mock declarations)
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/db/client"
import { enqueueNotification } from "@/lib/notifications/fanout"

// ─────────────────────────────────────────────────────────────────────────────
// 1. Notification crypto (lib/notifications/crypto.ts)
// ─────────────────────────────────────────────────────────────────────────────

describe("lib/notifications/crypto — encrypt / decrypt round-trip", () => {
  const VALID_KEY = "a".repeat(64) // 64 hex chars = 32 bytes
  let origKey: string | undefined

  beforeEach(() => {
    origKey = process.env.NOTIFICATION_ENCRYPTION_KEY
  })

  afterEach(async () => {
    if (origKey === undefined) delete process.env.NOTIFICATION_ENCRYPTION_KEY
    else process.env.NOTIFICATION_ENCRYPTION_KEY = origKey
    const mod = await import("@/lib/notifications/crypto")
    mod.__resetKeyCacheForTests()
  })

  it("successfully round-trips a short string", async () => {
    process.env.NOTIFICATION_ENCRYPTION_KEY = VALID_KEY
    const { encrypt, decrypt, __resetKeyCacheForTests } = await import("@/lib/notifications/crypto")
    __resetKeyCacheForTests()
    const plain = "https://hooks.slack.com/services/T/B/xxx"
    const cipher = encrypt(plain)
    expect(cipher).not.toBe(plain)
    expect(decrypt(cipher)).toBe(plain)
  })

  it("produces different ciphertexts for the same plaintext (random IV)", async () => {
    process.env.NOTIFICATION_ENCRYPTION_KEY = VALID_KEY
    const { encrypt, __resetKeyCacheForTests } = await import("@/lib/notifications/crypto")
    __resetKeyCacheForTests()
    const plain = "https://example.com/hook"
    const c1 = encrypt(plain)
    const c2 = encrypt(plain)
    expect(c1).not.toBe(c2)
  })

  it("throws when NOTIFICATION_ENCRYPTION_KEY is not set", async () => {
    delete process.env.NOTIFICATION_ENCRYPTION_KEY
    const { encrypt, __resetKeyCacheForTests } = await import("@/lib/notifications/crypto")
    __resetKeyCacheForTests()
    expect(() => encrypt("test")).toThrow("NOTIFICATION_ENCRYPTION_KEY is required")
  })

  it("throws when the key is the wrong length", async () => {
    process.env.NOTIFICATION_ENCRYPTION_KEY = "tooshort"
    const { encrypt, __resetKeyCacheForTests } = await import("@/lib/notifications/crypto")
    __resetKeyCacheForTests()
    expect(() => encrypt("test")).toThrow()
  })

  it("throws when decrypting a tampered ciphertext", async () => {
    process.env.NOTIFICATION_ENCRYPTION_KEY = VALID_KEY
    const { encrypt, decrypt, __resetKeyCacheForTests } = await import("@/lib/notifications/crypto")
    __resetKeyCacheForTests()
    const cipher = encrypt("secret")
    const tampered = cipher.slice(0, -4) + "XXXX"
    expect(() => decrypt(tampered)).toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Unsubscribe token (lib/notifications/unsubscribe-token.ts)
// ─────────────────────────────────────────────────────────────────────────────

describe("lib/notifications/unsubscribe-token — build / verify", () => {
  const VALID_SECRET = "super-secret-for-testing-only"
  let origSecret: string | undefined

  beforeEach(() => {
    origSecret = process.env.BETTER_AUTH_SECRET
    process.env.BETTER_AUTH_SECRET = VALID_SECRET
  })

  afterEach(() => {
    if (origSecret === undefined) delete process.env.BETTER_AUTH_SECRET
    else process.env.BETTER_AUTH_SECRET = origSecret
  })

  it("round-trips: build then verify returns the original payload", async () => {
    const { buildUnsubscribeToken, verifyUnsubscribeToken } = await import(
      "@/lib/notifications/unsubscribe-token"
    )
    const token = buildUnsubscribeToken("user-1", "org-1", "contract.signed")
    const decoded = verifyUnsubscribeToken(token)
    expect(decoded).toEqual({
      userId: "user-1",
      orgId: "org-1",
      eventName: "contract.signed",
    })
  })

  it("returns null for an invalid base64url token", async () => {
    const { verifyUnsubscribeToken } = await import("@/lib/notifications/unsubscribe-token")
    expect(verifyUnsubscribeToken("not-a-real-token")).toBeNull()
  })

  it("returns null when the HMAC signature is wrong", async () => {
    const { buildUnsubscribeToken, verifyUnsubscribeToken } = await import(
      "@/lib/notifications/unsubscribe-token"
    )
    const token = buildUnsubscribeToken("user-1", "org-1", "contract.signed")
    // Decode, modify the signature, re-encode
    const json = Buffer.from(token, "base64url").toString("utf8")
    const obj = JSON.parse(json)
    obj.s = "tampered-signature"
    const tampered = Buffer.from(JSON.stringify(obj)).toString("base64url")
    expect(verifyUnsubscribeToken(tampered)).toBeNull()
  })

  it("returns null for an unknown eventName", async () => {
    const { verifyUnsubscribeToken } = await import("@/lib/notifications/unsubscribe-token")
    const exp = Math.floor(Date.now() / 1000) + 3600
    const raw = Buffer.from(
      JSON.stringify({ u: "user-1", o: "org-1", e: "fake.event", x: exp, s: "bad" }),
    ).toString("base64url")
    expect(verifyUnsubscribeToken(raw)).toBeNull()
  })

  it("returns null for an expired token", async () => {
    const { buildUnsubscribeToken, verifyUnsubscribeToken } = await import(
      "@/lib/notifications/unsubscribe-token"
    )
    // Build a valid token, then backdate its expiry
    const token = buildUnsubscribeToken("user-1", "org-1", "contract.signed")
    const json = Buffer.from(token, "base64url").toString("utf8")
    const obj = JSON.parse(json)
    obj.x = Math.floor(Date.now() / 1000) - 1 // already expired
    const expired = Buffer.from(JSON.stringify(obj)).toString("base64url")
    expect(verifyUnsubscribeToken(expired)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. In-app notification write helpers (lib/notifications/write-in-app.ts)
// ─────────────────────────────────────────────────────────────────────────────

describe("lib/notifications/write-in-app — writeInApp", () => {
  beforeEach(() => vi.clearAllMocks())

  it("calls prisma.notification.create with the correct data", async () => {
    vi.mocked(prisma.notification.create).mockResolvedValueOnce({ id: "notif-1" } as any)
    const { writeInApp } = await import("@/lib/notifications/write-in-app")
    await writeInApp(
      "user-1",
      "org-1",
      "contract-1",
      "contract.signed",
      "Contract Signed",
      "Your contract has been signed.",
    )
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        organizationId: "org-1",
        contractId: "contract-1",
        eventName: "contract.signed",
        title: "Contract Signed",
        body: "Your contract has been signed.",
      },
    })
  })

  it("does NOT throw when prisma.notification.create fails (error absorbed)", async () => {
    vi.mocked(prisma.notification.create).mockRejectedValueOnce(new Error("DB down"))
    const { writeInApp } = await import("@/lib/notifications/write-in-app")
    await expect(
      writeInApp("user-1", "org-1", null, "contract.signed", "Title", "Body"),
    ).resolves.toBeUndefined()
  })

  it("accepts null contractId (system-level events have no contract)", async () => {
    vi.mocked(prisma.notification.create).mockResolvedValueOnce({ id: "notif-2" } as any)
    const { writeInApp } = await import("@/lib/notifications/write-in-app")
    await writeInApp("user-1", "org-1", null, "member.joined", "Welcome", "A new member joined.")
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contractId: null }) }),
    )
  })
})

describe("lib/notifications/write-in-app — writeInAppToOrgMembers", () => {
  beforeEach(() => vi.clearAllMocks())

  it("writes one notification per admin/legal/owner member", async () => {
    vi.mocked(prisma.member.findMany).mockResolvedValueOnce([
      { userId: "user-admin" },
      { userId: "user-legal" },
    ] as any)
    vi.mocked(prisma.notification.create).mockResolvedValue({ id: "notif-x" } as any)
    const { writeInAppToOrgMembers } = await import("@/lib/notifications/write-in-app")
    await writeInAppToOrgMembers("org-1", "contract-1", "contract.signed", "Signed", "Body")
    expect(prisma.notification.create).toHaveBeenCalledTimes(2)
  })

  it("excludes the actor user when excludeUserId is provided", async () => {
    vi.mocked(prisma.member.findMany).mockResolvedValueOnce([
      { userId: "user-admin" },
      { userId: "user-legal" },
    ] as any)
    vi.mocked(prisma.notification.create).mockResolvedValue({ id: "notif-x" } as any)
    const { writeInAppToOrgMembers } = await import("@/lib/notifications/write-in-app")
    await writeInAppToOrgMembers(
      "org-1", "contract-1", "contract.signed", "Signed", "Body",
      "user-legal",
    )
    expect(prisma.notification.create).toHaveBeenCalledTimes(1)
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "user-admin" }) }),
    )
  })

  it("does NOT throw when member lookup fails (error absorbed)", async () => {
    vi.mocked(prisma.member.findMany).mockRejectedValueOnce(new Error("DB error"))
    const { writeInAppToOrgMembers } = await import("@/lib/notifications/write-in-app")
    await expect(
      writeInAppToOrgMembers("org-1", null, "contract.signed", "Title", "Body"),
    ).resolves.toBeUndefined()
  })

  it("writes nothing when org has no elevated members", async () => {
    vi.mocked(prisma.member.findMany).mockResolvedValueOnce([])
    const { writeInAppToOrgMembers } = await import("@/lib/notifications/write-in-app")
    await writeInAppToOrgMembers("org-1", null, "contract.signed", "Title", "Body")
    expect(prisma.notification.create).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. SSRF guard — validateWebhookUrl (lib/notifications/validate-webhook-url.ts)
// ─────────────────────────────────────────────────────────────────────────────

describe("lib/notifications/validate-webhook-url — SSRF guard", () => {
  it("accepts a public https URL (DNS failure is non-fatal)", async () => {
    const { validateWebhookUrl } = await import("@/lib/notifications/validate-webhook-url")
    await expect(
      validateWebhookUrl("https://hooks.slack.com/services/T12345/B67890/abcdef"),
    ).resolves.toBeUndefined()
  })

  it("rejects non-http/https protocols", async () => {
    const { validateWebhookUrl } = await import("@/lib/notifications/validate-webhook-url")
    await expect(validateWebhookUrl("ftp://example.com/hook")).rejects.toThrow(
      "Only http and https URLs are allowed",
    )
  })

  it("rejects localhost", async () => {
    const { validateWebhookUrl } = await import("@/lib/notifications/validate-webhook-url")
    await expect(validateWebhookUrl("http://localhost/hook")).rejects.toThrow(
      "Private or internal URLs are not allowed",
    )
  })

  it("rejects loopback IP 127.0.0.1", async () => {
    const { validateWebhookUrl } = await import("@/lib/notifications/validate-webhook-url")
    await expect(validateWebhookUrl("http://127.0.0.1/hook")).rejects.toThrow(
      "Private or internal IP addresses are not allowed",
    )
  })

  it("rejects RFC-1918 range 10.x.x.x", async () => {
    const { validateWebhookUrl } = await import("@/lib/notifications/validate-webhook-url")
    await expect(validateWebhookUrl("https://10.0.0.1/hook")).rejects.toThrow(
      "Private or internal IP addresses are not allowed",
    )
  })

  it("rejects RFC-1918 range 192.168.x.x", async () => {
    const { validateWebhookUrl } = await import("@/lib/notifications/validate-webhook-url")
    await expect(validateWebhookUrl("https://192.168.100.1/hook")).rejects.toThrow(
      "Private or internal IP addresses are not allowed",
    )
  })

  it("rejects link-local address 169.254.x.x (AWS IMDS)", async () => {
    const { validateWebhookUrl } = await import("@/lib/notifications/validate-webhook-url")
    await expect(validateWebhookUrl("http://169.254.169.254/latest/meta-data/")).rejects.toThrow(
      "Private or internal IP addresses are not allowed",
    )
  })

  it("rejects metadata.google.internal", async () => {
    const { validateWebhookUrl } = await import("@/lib/notifications/validate-webhook-url")
    await expect(
      validateWebhookUrl("http://metadata.google.internal/computeMetadata/v1/"),
    ).rejects.toThrow("Private or internal URLs are not allowed")
  })

  it("rejects 0.0.0.0 (unspecified address in blocked hostname set)", async () => {
    const { validateWebhookUrl } = await import("@/lib/notifications/validate-webhook-url")
    // 0.0.0.0 is in BLOCKED_HOSTNAMES so it throws the hostname-blocked message
    await expect(validateWebhookUrl("http://0.0.0.0/hook")).rejects.toThrow(
      "Private or internal URLs are not allowed",
    )
  })

  it("accepts a valid http URL (non-SSRF public host)", async () => {
    const { validateWebhookUrl } = await import("@/lib/notifications/validate-webhook-url")
    await expect(validateWebhookUrl("http://example.com/webhook")).resolves.toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. enqueueNotification (lib/notifications/fanout.ts)
//    Tests the fire-and-forget contract of the fanout helper.
// ─────────────────────────────────────────────────────────────────────────────

describe("lib/notifications/fanout — enqueueNotification (real impl via importActual)", () => {
  beforeEach(() => vi.clearAllMocks())

  it("adds a fanout job with the correct payload shape", async () => {
    // @/lib/notifications/fanout is mocked at the top of this file, so we use
    // vi.importActual to get the real implementation for this test only.
    const { enqueueNotification: realEnqueue } = await vi.importActual<
      typeof import("@/lib/notifications/fanout")
    >("@/lib/notifications/fanout")
    const { notificationFanoutQueue } = await import("@/lib/jobs/queues")
    vi.mocked(notificationFanoutQueue.add).mockResolvedValueOnce(undefined as any)

    await realEnqueue("contract.signed", "contract-1", "user-1", { extra: "data" })

    expect(notificationFanoutQueue.add).toHaveBeenCalledWith(
      "fanout",
      expect.objectContaining({
        eventName: "contract.signed",
        contractId: "contract-1",
        actorId: "user-1",
        metadata: { extra: "data" },
      }),
    )
  })

  it("swallows queue errors and never throws to the caller", async () => {
    const { enqueueNotification: realEnqueue } = await vi.importActual<
      typeof import("@/lib/notifications/fanout")
    >("@/lib/notifications/fanout")
    const { notificationFanoutQueue } = await import("@/lib/jobs/queues")
    vi.mocked(notificationFanoutQueue.add).mockRejectedValueOnce(new Error("Redis down"))

    await expect(realEnqueue("contract.signed", "c-1", null)).resolves.toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. isAllowedDocuSealUrl — real implementation via vi.importActual
//
// The signing-sync worker uses this SSRF guard before downloading signed PDFs.
// @/lib/docuseal is mocked at the top of this file, so we use vi.importActual
// to get the real function and test its hostname-matching logic directly.
// ─────────────────────────────────────────────────────────────────────────────

describe("lib/docuseal — isAllowedDocuSealUrl SSRF guard (real impl)", () => {
  it("allows a URL whose host matches the configured DocuSeal host", async () => {
    process.env.DOCUSEAL_API_URL = "https://api.docuseal.com"
    const { isAllowedDocuSealUrl } = await vi.importActual<typeof import("@/lib/docuseal")>("@/lib/docuseal")
    expect(isAllowedDocuSealUrl("https://api.docuseal.com/submissions/123/signed.pdf")).toBe(true)
  })

  it("rejects a URL from a different host (SSRF protection)", async () => {
    process.env.DOCUSEAL_API_URL = "https://api.docuseal.com"
    const { isAllowedDocuSealUrl } = await vi.importActual<typeof import("@/lib/docuseal")>("@/lib/docuseal")
    expect(isAllowedDocuSealUrl("https://evil.example.com/signed.pdf")).toBe(false)
  })

  it("rejects an RFC-1918 private address (different host from DocuSeal)", async () => {
    process.env.DOCUSEAL_API_URL = "https://api.docuseal.com"
    const { isAllowedDocuSealUrl } = await vi.importActual<typeof import("@/lib/docuseal")>("@/lib/docuseal")
    expect(isAllowedDocuSealUrl("https://192.168.1.1/signed.pdf")).toBe(false)
  })

  it("rejects a non-http(s) URL", async () => {
    process.env.DOCUSEAL_API_URL = "https://api.docuseal.com"
    const { isAllowedDocuSealUrl } = await vi.importActual<typeof import("@/lib/docuseal")>("@/lib/docuseal")
    expect(isAllowedDocuSealUrl("file:///etc/passwd")).toBe(false)
  })

  it("returns false for a malformed URL string", async () => {
    process.env.DOCUSEAL_API_URL = "https://api.docuseal.com"
    const { isAllowedDocuSealUrl } = await vi.importActual<typeof import("@/lib/docuseal")>("@/lib/docuseal")
    expect(isAllowedDocuSealUrl("not a url at all")).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 7. NOTIFICATION_EVENT_NAMES — known event registry
//
// The notification system depends on a fixed set of event names exported from
// lib/notifications/events.ts (re-exported via fanout.ts). These are the events
// that workers, routes, and tests all reference. Verify the shape is correct.
// ─────────────────────────────────────────────────────────────────────────────

describe("lib/notifications/events — NOTIFICATION_EVENT_NAMES registry", () => {
  it("includes the core signing lifecycle events", async () => {
    const { NOTIFICATION_EVENT_NAMES } = await vi.importActual<typeof import("@/lib/notifications/fanout")>(
      "@/lib/notifications/fanout",
    )
    expect(Array.isArray(NOTIFICATION_EVENT_NAMES)).toBe(true)
    expect(NOTIFICATION_EVENT_NAMES).toContain("contract.signed")
    expect(NOTIFICATION_EVENT_NAMES).toContain("contract.signing_declined")
    expect(NOTIFICATION_EVENT_NAMES).toContain("contract.sent_for_signing")
  })

  it("includes alert and obligation events", async () => {
    const { NOTIFICATION_EVENT_NAMES } = await vi.importActual<typeof import("@/lib/notifications/fanout")>(
      "@/lib/notifications/fanout",
    )
    expect(NOTIFICATION_EVENT_NAMES).toContain("contract.expiring_soon")
    expect(NOTIFICATION_EVENT_NAMES).toContain("obligation.due_soon")
    expect(NOTIFICATION_EVENT_NAMES).toContain("obligation.overdue")
  })

  it("includes approval and member events", async () => {
    const { NOTIFICATION_EVENT_NAMES } = await vi.importActual<typeof import("@/lib/notifications/fanout")>(
      "@/lib/notifications/fanout",
    )
    expect(NOTIFICATION_EVENT_NAMES).toContain("approval.requested")
    expect(NOTIFICATION_EVENT_NAMES).toContain("member.joined")
  })
})

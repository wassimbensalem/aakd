// Prevent MaxListeners warning from ioredis exit handlers in test environment
process.setMaxListeners(50)

import "@testing-library/jest-dom"
import { vi } from "vitest"

vi.mock("@/lib/jobs/queues", () => ({
  contractExtractQueue: { add: vi.fn().mockResolvedValue(undefined), close: vi.fn() },
  contractAiExtractQueue: { add: vi.fn().mockResolvedValue(undefined), close: vi.fn() },
  contractEmbedQueue: { add: vi.fn().mockResolvedValue(undefined), close: vi.fn() },
  alertsCheckQueue: { add: vi.fn().mockResolvedValue(undefined), close: vi.fn() },
  signingSyncQueue: { add: vi.fn().mockResolvedValue(undefined), close: vi.fn() },
  emailQueue: { add: vi.fn().mockResolvedValue(undefined), close: vi.fn() },
  notificationFanoutQueue: { add: vi.fn().mockResolvedValue(undefined), close: vi.fn() },
  notificationDeliverQueue: { add: vi.fn().mockResolvedValue(undefined), close: vi.fn() },
  documentConvertQueue: { add: vi.fn().mockResolvedValue(undefined), close: vi.fn() },
  documentExportQueue: { add: vi.fn().mockResolvedValue(undefined), close: vi.fn() },
  obligationsCheckQueue: { add: vi.fn().mockResolvedValue(undefined), close: vi.fn() },
  salesforcePollQueue: { add: vi.fn().mockResolvedValue(undefined), close: vi.fn() },
  importProcessQueue: { add: vi.fn().mockResolvedValue(undefined), close: vi.fn() },
  obligationExtractQueue: { add: vi.fn().mockResolvedValue(undefined), close: vi.fn() },
}))

vi.mock("@/lib/db/client", () => {
  const prisma: any = {
    contract: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    activity: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    contractFile: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    contractVersion: { create: vi.fn() },
    tag: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), delete: vi.fn() },
    folder: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    organization: { findUnique: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn(), findMany: vi.fn() },
    member: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
    invitation: { create: vi.fn() },
    apiKey: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    aIExtraction: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
    orgAiConfig: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    contractAlert: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), upsert: vi.fn() },
    approval: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(), count: vi.fn(), aggregate: vi.fn().mockResolvedValue({ _max: { step: null } }) },
    contractSigner: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    $use: vi.fn(),
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  }
  // $transaction supports both array form (Promise.all) and callback form
  // (interactive). Keep a default that mirrors real semantics so tests don't
  // need to mock it per-case.
  prisma.$transaction = vi.fn().mockImplementation(async (arg: unknown) => {
    if (typeof arg === "function") return (arg as (tx: typeof prisma) => Promise<unknown>)(prisma)
    if (Array.isArray(arg)) return Promise.all(arg)
    return arg
  })
  return { prisma }
})

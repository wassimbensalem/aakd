import "@testing-library/jest-dom"
import { vi } from "vitest"

vi.mock("@/lib/db/client", () => ({
  prisma: {
    contract: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    activity: { create: vi.fn(), findMany: vi.fn(), count: vi.fn() },
    contractFile: { create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    contractVersion: { create: vi.fn() },
    tag: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), delete: vi.fn() },
    folder: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    organization: { findUnique: vi.fn(), update: vi.fn() },
    member: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    invitation: { create: vi.fn() },
    apiKey: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    $use: vi.fn(),
  },
}))

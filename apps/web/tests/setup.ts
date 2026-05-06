import "@testing-library/jest-dom"
import { vi } from "vitest"

vi.mock("@/lib/db/client", () => ({
  prisma: {
    contract: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    activity: { create: vi.fn() },
    apiKey: { findUnique: vi.fn(), update: vi.fn() },
    member: { findUnique: vi.fn() },
    $use: vi.fn(),
  },
}))

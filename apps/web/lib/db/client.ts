import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"
import { getRequestContext } from "@/lib/context"

const ORG_SCOPED_MODELS = new Set([
  "Contract", "ContractFile", "ContractVersion",
  "Activity", "Folder", "Tag", "ApiKey",
])

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

function createPrismaClient() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? "",
  })

  const adapter = new PrismaPg(pool)

  const baseClient = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  })

  // Org-scope query extension — injects organizationId on every query
  return baseClient.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const ctx = getRequestContext()
          if (!ctx?.organizationId || !ORG_SCOPED_MODELS.has(model ?? "")) {
            return query(args)
          }

          if (["findFirst", "findMany", "count", "aggregate", "findUnique"].includes(operation)) {
            args = { ...args } as typeof args
            ;(args as any).where = { ...(args as any).where, organizationId: ctx.organizationId }
          } else if (operation === "create") {
            args = { ...args } as typeof args
            ;(args as any).data = { ...(args as any).data, organizationId: ctx.organizationId }
          } else if (["update", "updateMany", "delete", "deleteMany"].includes(operation)) {
            args = { ...args } as typeof args
            ;(args as any).where = { ...(args as any).where, organizationId: ctx.organizationId }
          }

          return query(args)
        },
      },
    },
  })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma as PrismaClient

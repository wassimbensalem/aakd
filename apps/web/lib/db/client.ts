import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"
import { getRequestContext } from "@/lib/context"

// Only models that have a direct organizationId column should be in this set.
// ContractFile, ContractVersion, and Activity are org-scoped *indirectly*
// through their contractId FK — injecting organizationId into those queries
// causes a Prisma validation error (unknown field).
const ORG_SCOPED_MODELS = new Set([
  "Contract", "Folder", "Tag", "ApiKey",
  // M5: notification models with direct organizationId columns
  "OrgNotificationChannel", "OutboundWebhook", "UserNotificationPreference",
  // M6: contract templates
  "ContractTemplate",
  // M7: obligation tracking
  "ContractObligation",
  // M9: CRM integrations
  "CrmIntegration",
  // M10: Import / migration tools
  "ImportJob",
])

type ScopedQueryArgs = {
  where?: Record<string, unknown>
  data?: Record<string, unknown>
}

function createPrismaClient() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? "",
    max: 20,
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
          if (!ctx?.organizationId) {
            if (ORG_SCOPED_MODELS.has(model ?? "")) {
              console.warn(
                `[org-scope] middleware fired but no org context — query model: ${model}, action: ${operation}. ` +
                "Explicit organizationId filter in the route is the active guard.",
              )
            }
            return query(args)
          }
          if (!ORG_SCOPED_MODELS.has(model ?? "")) {
            return query(args)
          }

          if (["findFirst", "findMany", "count", "aggregate", "findUnique"].includes(operation)) {
            const scopedArgs = { ...args } as ScopedQueryArgs
            scopedArgs.where = { ...scopedArgs.where, organizationId: ctx.organizationId }
            args = scopedArgs as typeof args
          } else if (operation === "create") {
            const scopedArgs = { ...args } as ScopedQueryArgs
            scopedArgs.data = {
              ...scopedArgs.data,
              organization: { connect: { id: ctx.organizationId } },
            }
            args = scopedArgs as typeof args
          } else if (operation === "upsert") {
            const scopedArgs = { ...args } as ScopedQueryArgs
            scopedArgs.where = { ...scopedArgs.where, organizationId: ctx.organizationId }
            args = scopedArgs as typeof args
          } else if (["update", "updateMany", "delete", "deleteMany"].includes(operation)) {
            const scopedArgs = { ...args } as ScopedQueryArgs
            scopedArgs.where = { ...scopedArgs.where, organizationId: ctx.organizationId }
            args = scopedArgs as typeof args
          }

          return query(args)
        },
      },
    },
  })
}

// The $extends call wraps the client in DynamicClientExtensionThis which,
// due to a known Prisma TypeScript limitation with $allOperations, loses the
// model delegate types (aIExtraction, contractAlert, etc.) from the inferred
// type. Casting to PrismaClient restores those types; the runtime object is a
// structural superset so this is safe.
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

export const prisma: PrismaClient = (
  globalForPrisma.prisma ?? createPrismaClient()
) as unknown as PrismaClient

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma

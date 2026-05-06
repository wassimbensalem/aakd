import type { PrismaConfig } from "prisma"

export default {
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
} satisfies PrismaConfig

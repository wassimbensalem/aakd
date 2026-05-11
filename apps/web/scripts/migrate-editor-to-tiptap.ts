// Usage: cd apps/web && npx tsx scripts/migrate-editor-to-tiptap.ts
//
// Migrates ContractDocument and ContractTemplate rows from Slate/Plate JSON
// (array format) to TipTap ProseMirror JSON (object format).
//
// Safe to run multiple times — rows already in TipTap format (type === "doc")
// are skipped.

import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"
import { slateToTiptap } from "../lib/editor/slate-to-tiptap"

// Prisma 7 requires the pg adapter (no embedded engine in client mode).
const pool = new Pool({ connectionString: process.env.DATABASE_URL ?? "" })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log("Starting editor format migration: Slate → TipTap")

  // ── ContractDocument rows ──────────────────────────────────────────────────
  const docs = await prisma.contractDocument.findMany({
    select: { id: true, content: true },
  })

  let docCount = 0
  let docSkipped = 0

  for (const doc of docs) {
    if (Array.isArray(doc.content)) {
      // Legacy Slate array — convert
      const tiptap = slateToTiptap(doc.content as unknown[])
      await prisma.contractDocument.update({
        where: { id: doc.id },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { content: tiptap as any },
      })
      docCount++
    } else if (doc.content && typeof doc.content === "object" && (doc.content as { type?: string }).type === "doc") {
      // Already TipTap format — skip
      docSkipped++
    } else if (doc.content !== null) {
      console.warn(`  [WARN] ContractDocument ${doc.id} has unexpected content shape — skipping`)
      docSkipped++
    }
  }

  console.log(
    `ContractDocument: migrated ${docCount}, skipped ${docSkipped} (already TipTap or null)`,
  )

  // ── ContractTemplate rows ──────────────────────────────────────────────────
  const templates = await prisma.contractTemplate.findMany({
    select: { id: true, content: true },
  })

  let templateCount = 0
  let templateSkipped = 0

  for (const template of templates) {
    if (Array.isArray(template.content)) {
      const tiptap = slateToTiptap(template.content as unknown[])
      await prisma.contractTemplate.update({
        where: { id: template.id },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { content: tiptap as any },
      })
      templateCount++
    } else if (
      template.content &&
      typeof template.content === "object" &&
      (template.content as { type?: string }).type === "doc"
    ) {
      templateSkipped++
    } else if (template.content !== null) {
      console.warn(`  [WARN] ContractTemplate ${template.id} has unexpected content shape — skipping`)
      templateSkipped++
    }
  }

  console.log(
    `ContractTemplate: migrated ${templateCount}, skipped ${templateSkipped} (already TipTap or null)`,
  )

  await prisma.$disconnect()
  await pool.end()
  console.log("Migration complete.")
}

main().catch((err) => {
  console.error("Migration failed:", err)
  process.exit(1)
})

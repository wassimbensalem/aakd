-- CreateTable: clause_snippets
-- Org-scoped user snippet library for the contract editor

CREATE TABLE "clause_snippets" (
  "id"             TEXT         NOT NULL,
  "organizationId" TEXT         NOT NULL,
  "createdById"    TEXT         NOT NULL,
  "name"           VARCHAR(200) NOT NULL,
  "category"       VARCHAR(100) NOT NULL,
  "contentText"    TEXT         NOT NULL,
  "content"        JSONB        NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "clause_snippets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clause_snippets_organizationId_idx" ON "clause_snippets"("organizationId");

-- AddForeignKey
ALTER TABLE "clause_snippets"
  ADD CONSTRAINT "clause_snippets_organizationId_fkey"
  FOREIGN KEY ("organizationId")
  REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clause_snippets"
  ADD CONSTRAINT "clause_snippets_createdById_fkey"
  FOREIGN KEY ("createdById")
  REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

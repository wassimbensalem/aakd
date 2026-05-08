CREATE TABLE "ContractChunkEmbedding" (
  "id" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "chunkIndex" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "embedding" vector(1536),
  "model" TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContractChunkEmbedding_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractChunkEmbedding_contractId_chunkIndex_key" UNIQUE ("contractId", "chunkIndex"),
  CONSTRAINT "ContractChunkEmbedding_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ContractChunkEmbedding_contractId_idx" ON "ContractChunkEmbedding" ("contractId");
CREATE INDEX "ContractChunkEmbedding_embedding_idx" ON "ContractChunkEmbedding" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);

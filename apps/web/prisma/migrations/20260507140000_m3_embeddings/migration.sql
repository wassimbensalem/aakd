CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "ContractEmbedding" (
  "id" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "embedding" vector(1536),
  "model" TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContractEmbedding_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ContractEmbedding_contractId_key" UNIQUE ("contractId"),
  CONSTRAINT "ContractEmbedding_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ContractEmbedding_embedding_idx" ON "ContractEmbedding" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 100);

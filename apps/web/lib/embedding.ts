/**
 * Embedding provider abstraction.
 * Uses OpenAI text-embedding-3-small by default.
 * Falls back to Ollama if OLLAMA_BASE_URL is set and OPENAI_API_KEY is not.
 * Returns null if no provider is configured.
 *
 * Embedding dimension is fixed at 1536 — never parameterized.
 * Uses fetch only — no openai SDK imported here.
 */

export async function generateEmbedding(text: string): Promise<number[] | null> {
  const input = text.slice(0, 8000)

  if (process.env.OPENAI_API_KEY) {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input,
      }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`OpenAI embeddings API error ${res.status}: ${text}`)
    }

    const data = (await res.json()) as {
      data: Array<{ embedding: number[] }>
    }
    return data.data[0].embedding
  }

  if (process.env.OLLAMA_BASE_URL) {
    const base = process.env.OLLAMA_BASE_URL.replace(/\/$/, "")
    const model = process.env.OLLAMA_EMBEDDING_MODEL ?? "nomic-embed-text:v1.5"

    const res = await fetch(`${base}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: input }),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`Ollama embeddings API error ${res.status}: ${text}`)
    }

    const data = (await res.json()) as { embedding: number[] }
    return data.embedding
  }

  console.warn(
    "[embedding] No embedding provider configured — set OPENAI_API_KEY or OLLAMA_BASE_URL",
  )
  return null
}

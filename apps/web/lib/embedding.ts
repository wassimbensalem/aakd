/**
 * Embedding provider abstraction.
 * Uses OpenAI text-embedding-3-small by default.
 * Falls back to Ollama if OLLAMA_BASE_URL is set and OPENAI_API_KEY is not.
 * Returns null if no provider is configured.
 *
 * Embedding dimension is fixed at 1536 — never parameterized.
 * Uses fetch only — no openai SDK imported here.
 */

let _ollamaDimWarned = false

function warnOllamaDimensionMismatch() {
  if (_ollamaDimWarned) return
  _ollamaDimWarned = true
  const model = process.env.OLLAMA_EMBEDDING_MODEL
  if (!model) {
    console.error(
      "[embedding] OLLAMA_EMBEDDING_MODEL is not set. The default Ollama embedding " +
        "models (e.g. nomic-embed-text) produce 768-dim vectors, but the ContractEmbedding " +
        "column is vector(1536). Inserts will fail. Set OLLAMA_EMBEDDING_MODEL to a " +
        "1536-dim model such as 'mxbai-embed-large'.",
    )
  }
}

export async function generateEmbedding(text: string): Promise<number[] | null> {
  // text-embedding-3-small supports ~8191 tokens. Roughly 4 chars per token,
  // so ~32K chars fits comfortably; cap at 30K for headroom.
  const input = text.slice(0, 30000)

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
    if ((process.env.AI_PROVIDER?.toLowerCase() === "ollama") || !process.env.OLLAMA_EMBEDDING_MODEL) {
      warnOllamaDimensionMismatch()
    }
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

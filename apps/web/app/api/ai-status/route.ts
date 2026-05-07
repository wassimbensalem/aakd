import { resolveAuth } from "@/lib/auth/middleware"

export async function GET(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const provider = process.env.AI_PROVIDER ?? null
  let model: string | null = null
  if (provider === "anthropic") model = process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5"
  else if (provider === "openai") model = process.env.OPENAI_MODEL ?? "gpt-4o-mini"
  else if (provider === "ollama") model = process.env.OLLAMA_MODEL ?? "llama3"

  return Response.json({ provider, model })
}

import { SECURE_HEADERS } from "@/lib/api-headers"

export async function GET() {
  return Response.json(
    { status: "ok", timestamp: new Date().toISOString() },
    { headers: SECURE_HEADERS },
  )
}

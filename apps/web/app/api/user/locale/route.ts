import { z } from "zod"
import { resolveAuth } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"
import { LOCALES, type Locale } from "@/lib/i18n/config"

const PatchSchema = z.object({
  locale: z.enum(LOCALES as unknown as [Locale, ...Locale[]]),
})

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

function localeCookieHeader(locale: Locale): string {
  return `NEXT_LOCALE=${locale}; Path=/; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`
}

export async function GET(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    const user = await prisma.user.findUnique({
      where: { id: ctx.userId },
      select: { locale: true },
    })
    return Response.json({ locale: (user?.locale ?? "en") as Locale })
  })
}

export async function PATCH(req: Request) {
  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })

  return requestContext.run(ctx, async () => {
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return new Response("Invalid JSON", { status: 400 })
    }

    const parsed = PatchSchema.safeParse(body)
    if (!parsed.success) {
      return Response.json({ error: parsed.error.flatten() }, { status: 422 })
    }

    const { locale } = parsed.data

    await prisma.user.update({
      where: { id: ctx.userId },
      data: { locale },
    })

    return new Response(JSON.stringify({ locale }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": localeCookieHeader(locale),
      },
    })
  })
}

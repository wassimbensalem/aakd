"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Plug2, Upload } from "lucide-react"
import { LocaleSwitcher } from "@/components/locale-switcher"
import { cn } from "@/lib/utils"

const settingsLinks = [
  { label: "Organization", href: "/settings/org" },
  { label: "Members", href: "/settings/members" },
  { label: "Integrations", href: "/settings/integrations", icon: Plug2 },
  { label: "Import", href: "/settings/import", icon: Upload },
  { label: "API Keys", href: "/settings/api-keys" },
  { label: "Notifications", href: "/settings/notifications" },
  { label: "My Notifications", href: "/settings/profile/notifications" },
]

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="flex min-h-full">
      <nav className="w-48 shrink-0 border-r border-border bg-muted p-2 flex flex-col">
        <p className="px-[10px] pt-3 pb-1.5 text-[10px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
          Settings
        </p>
        <div className="space-y-0.5">
          {settingsLinks.map(({ label, href, icon: Icon }) => {
            const isActive = pathname === href || pathname.startsWith(href + "/")
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2.5 rounded-[calc(var(--radius)-1px)] px-[10px] py-[6px] text-[13px] transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary font-semibold"
                    : "text-foreground/80 hover:bg-muted-foreground/[0.08] hover:text-foreground",
                )}
              >
                {Icon && (
                  <Icon
                    className="h-4 w-4 shrink-0"
                    strokeWidth={isActive ? 2.2 : 1.8}
                  />
                )}
                <span>{label}</span>
              </Link>
            )
          })}
        </div>
        <div className="mt-auto pt-3 border-t border-border space-y-2">
          <p className="px-[10px] text-[10px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
            Language
          </p>
          <div className="px-[10px]">
            <LocaleSwitcher className="w-full" />
          </div>
        </div>
      </nav>
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}

"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Building2,
  Users,
  CreditCard,
  Key,
  ClipboardList,
  Plug2,
  Upload,
  Bell,
  Mail,
  User,
} from "lucide-react"
import { LocaleSwitcher } from "@/components/locale-switcher"
import { cn } from "@/lib/utils"

interface SettingsLink {
  label: string
  href: string
  icon: React.ElementType
  disabled?: boolean
}

interface SettingsGroup {
  title: string
  items: SettingsLink[]
}

const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    title: "Workspace",
    items: [
      { label: "Organization",      href: "/settings/org",           icon: Building2 },
      { label: "Members",           href: "/settings/members",       icon: Users },
      { label: "API Keys",          href: "/settings/api-keys",      icon: Key },
      { label: "Audit Log",         href: "/settings/audit-log",     icon: ClipboardList },
      { label: "Billing",           href: "/settings/billing",       icon: CreditCard, disabled: true },
    ],
  },
  {
    title: "Integrations",
    items: [
      { label: "Integrations",  href: "/settings/integrations", icon: Plug2 },
      { label: "Data Import",   href: "/settings/import",       icon: Upload },
    ],
  },
  {
    title: "Notifications",
    items: [
      { label: "Org Notifications", href: "/settings/notifications",              icon: Bell },
      { label: "My Notifications",  href: "/settings/profile/notifications",      icon: Mail },
    ],
  },
  {
    title: "Account",
    items: [
      { label: "My Profile", href: "/settings/profile", icon: User },
    ],
  },
]

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="flex min-h-full">
      <nav className="w-52 shrink-0 border-r border-border bg-muted p-2 flex flex-col">
        {SETTINGS_GROUPS.map((group) => (
          <div key={group.title}>
            <p className="px-[10px] pt-3 pb-1 text-[10px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
              {group.title}
            </p>
            <div className="space-y-0.5">
              {group.items.map(({ label, href, icon: Icon, disabled }) => {
                const isActive = pathname === href || pathname.startsWith(href + "/")
                if (disabled) {
                  return (
                    <div
                      key={href}
                      className="flex items-center gap-2.5 rounded-[calc(var(--radius)-1px)] px-[10px] py-[6px] text-[13px] opacity-40 cursor-not-allowed select-none"
                    >
                      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                      <span>{label}</span>
                      <span className="ml-auto text-[9px] font-semibold bg-muted-foreground/20 text-muted-foreground px-1.5 py-0.5 rounded-full">
                        Soon
                      </span>
                    </div>
                  )
                }
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
                    <Icon
                      className="h-4 w-4 shrink-0"
                      strokeWidth={isActive ? 2.2 : 1.8}
                    />
                    <span>{label}</span>
                  </Link>
                )
              })}
            </div>
          </div>
        ))}

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

import Link from "next/link"
import { Plug2, Upload } from "lucide-react"
import { LocaleSwitcher } from "@/components/locale-switcher"

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
  return (
    <div className="flex min-h-full">
      <nav className="w-48 shrink-0 border-r border-zinc-200 bg-white p-4 flex flex-col">
        <div className="space-y-0.5">
          {settingsLinks.map(({ label, href, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 transition-colors"
            >
              {Icon && <Icon className="h-4 w-4" />}
              <span>{label}</span>
            </Link>
          ))}
        </div>
        <div className="mt-auto pt-4 border-t border-zinc-200 space-y-2">
          <p className="px-3 text-xs font-medium text-zinc-500">Language</p>
          <div className="px-3">
            <LocaleSwitcher className="w-full" />
          </div>
        </div>
      </nav>
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  )
}

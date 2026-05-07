"use client"

import { useState, useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import Link from "next/link"
import { LayoutDashboard, FileText, Search, Settings, LogOut, Moon, Sun, Shield, ChevronLeft, ChevronRight, BotIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { useSession, useActiveOrganization, signOut, organization } from "@/lib/auth/client"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Skeleton } from "@/components/ui/skeleton"
import { CmdK } from "@/components/cmd-k"
import { cn } from "@/lib/utils"

const navItems = [
  { href: "/dashboard",    icon: LayoutDashboard, label: "Dashboard" },
  { href: "/contracts",    icon: FileText,         label: "Contracts" },
  { href: "/search",       icon: Search,           label: "Search" },
  { href: "/settings/org", icon: Settings,         label: "Settings" },
]

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <button
      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      className="text-zinc-400 hover:text-white transition-colors"
      aria-label="Toggle theme"
    >
      <Sun className="size-4 dark:hidden" />
      <Moon className="size-4 hidden dark:block" />
    </button>
  )
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { data: session, isPending } = useSession()
  const { data: activeOrg, isPending: orgPending } = useActiveOrganization()
  const [collapsed, setCollapsed] = useState(false)
  const [aiStatus, setAiStatus] = useState<{ provider: string | null; model: string | null } | null>(null)

  useEffect(() => {
    fetch("/api/ai-status").then(r => r.json()).then(setAiStatus).catch(() => {})
  }, [])

  useEffect(() => {
    if (!isPending && !session?.user) {
      router.replace("/login")
    }
  }, [isPending, session, router])

  useEffect(() => {
    if (!isPending && !orgPending && session?.user && !activeOrg) {
      // Auto-select the first existing org if the user already has one,
      // instead of always redirecting to /create-org on every fresh login.
      organization.list().then((result) => {
        const orgs = result?.data
        if (orgs && orgs.length > 0) {
          organization.setActive({ organizationId: orgs[0].id })
        } else {
          router.replace("/create-org")
        }
      }).catch(() => {
        router.replace("/create-org")
      })
    }
  }, [isPending, orgPending, session, activeOrg, router])

  if (isPending || orgPending) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="w-64 space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    )
  }

  if (!session?.user) return null

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside
        className={cn(
          "flex h-screen shrink-0 flex-col bg-zinc-900 text-white transition-all duration-200",
          collapsed ? "w-16" : "w-[220px]",
        )}
      >
        {/* Logo */}
        <div className="flex h-14 items-center gap-2 border-b border-zinc-800 px-3">
          <Shield className="size-6 shrink-0 text-indigo-400" />
          {!collapsed && (
            <span className="text-sm font-semibold text-white">ClauseFlow</span>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-2">
          <div className="space-y-0.5">
            {navItems.map(({ href, icon: Icon, label }) => {
              const isActive =
                pathname === href ||
                (href !== "/dashboard" && pathname.startsWith(href + "/")) ||
                (href === "/settings/org" && pathname.startsWith("/settings"))
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-indigo-600 text-white"
                      : "text-zinc-400 hover:bg-zinc-800 hover:text-white",
                  )}
                  title={collapsed ? label : undefined}
                >
                  <Icon className="size-4 shrink-0" />
                  {!collapsed && <span>{label}</span>}
                </Link>
              )
            })}
          </div>
        </nav>

        {/* AI model status */}
        {!collapsed && aiStatus && (
          <div className="px-3 py-2 border-t border-zinc-800">
            <div className="flex items-center gap-2">
              <BotIcon className="size-3.5 shrink-0 text-zinc-500" />
              {aiStatus.provider ? (
                <span className="text-xs text-zinc-400 truncate">
                  <span className="text-zinc-300">{aiStatus.provider}</span>
                  {aiStatus.model && <span> · {aiStatus.model}</span>}
                </span>
              ) : (
                <span className="text-xs text-zinc-500">No AI configured</span>
              )}
            </div>
          </div>
        )}

        {/* Collapse toggle */}
        <div className="border-t border-zinc-800 px-3 py-2">
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="flex w-full items-center gap-2.5 rounded-md px-0 py-1.5 text-sm text-zinc-400 hover:text-white transition-colors"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? (
              <ChevronRight className="size-4 shrink-0" />
            ) : (
              <>
                <ChevronLeft className="size-4 shrink-0" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>

        {/* User section */}
        <div className="border-t border-zinc-800 p-3">
          <div className={cn("flex items-center gap-2.5", collapsed && "justify-center")}>
            <Avatar className="size-7 shrink-0">
              {session.user.image && <AvatarImage src={session.user.image} />}
              <AvatarFallback className="bg-zinc-700 text-xs font-medium text-white">
                {getInitials(session.user.name ?? session.user.email)}
              </AvatarFallback>
            </Avatar>
            {!collapsed && (
              <>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">
                    {session.user.name ?? session.user.email}
                  </p>
                  {activeOrg && (
                    <p className="truncate text-xs text-zinc-400">{activeOrg.name}</p>
                  )}
                </div>
                <ThemeToggle />
                <button
                  className="text-zinc-400 hover:text-white transition-colors"
                  onClick={() =>
                    signOut({ fetchOptions: { onSuccess: () => router.push("/login") } })
                  }
                  aria-label="Sign out"
                >
                  <LogOut className="size-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>

      <CmdK />
    </div>
  )
}

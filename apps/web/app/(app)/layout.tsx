"use client"

import { useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import Link from "next/link"
import { LayoutDashboard, FileText, Search, Settings, LogOut, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { useSession, useActiveOrganization, signOut } from "@/lib/auth/client"
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
      className="text-muted-foreground hover:text-foreground transition-colors"
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

  useEffect(() => {
    if (!isPending && !session?.user) {
      router.replace("/login")
    }
  }, [isPending, session, router])

  useEffect(() => {
    if (!isPending && !orgPending && session?.user && !activeOrg) {
      router.replace("/create-org")
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
      <aside className="flex h-screen w-56 shrink-0 flex-col border-r border-border bg-card">
        {/* Logo */}
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <div className="flex size-7 items-center justify-center rounded bg-foreground">
            <span className="text-xs font-bold text-background">CF</span>
          </div>
          <span className="text-sm font-semibold text-foreground">ClauseFlow</span>
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
                    "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground",
                  )}
                >
                  <Icon className="size-4" />
                  <span>{label}</span>
                </Link>
              )
            })}
          </div>
        </nav>

        {/* User section */}
        <div className="border-t border-border p-3">
          <div className="flex items-center gap-2.5">
            <Avatar className="size-7">
              {session.user.image && <AvatarImage src={session.user.image} />}
              <AvatarFallback className="bg-secondary text-xs font-medium text-foreground">
                {getInitials(session.user.name ?? session.user.email)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {session.user.name ?? session.user.email}
              </p>
              {activeOrg && (
                <p className="truncate text-xs text-muted-foreground">{activeOrg.name}</p>
              )}
            </div>
            <ThemeToggle />
            <button
              className="text-muted-foreground hover:text-foreground transition-colors"
              onClick={() =>
                signOut({ fetchOptions: { onSuccess: () => router.push("/login") } })
              }
              aria-label="Sign out"
            >
              <LogOut className="size-4" />
            </button>
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

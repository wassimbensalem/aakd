"use client"

import { useEffect, useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import Link from "next/link"
import {
  LayoutDashboard, FileText, Folder, Settings, Bell,
  ChevronRight, PanelLeftClose, PanelLeftOpen, LogOut, FileText as LogoIcon
} from "lucide-react"
import { useSession, useActiveOrganization, signOut } from "@/lib/auth/client"
import { ThemeToggle } from "@/components/theme-toggle"
import { CmdK } from "@/components/cmd-k"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

const navItems = [
  { label: "Dashboard", href: "/dashboard", Icon: LayoutDashboard },
  { label: "Contracts", href: "/contracts", Icon: FileText },
  { label: "Folders", href: "/contracts?view=folders", Icon: Folder },
  { label: "Settings", href: "/settings/org", Icon: Settings },
]

function getInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
}

function Breadcrumbs() {
  const pathname = usePathname()
  const parts = pathname.split("/").filter(Boolean)
  return (
    <nav className="flex items-center gap-1 text-sm text-muted-foreground">
      {parts.map((part, i) => {
        const isLast = i === parts.length - 1
        const label = part.charAt(0).toUpperCase() + part.slice(1)
        return (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3.5 w-3.5" />}
            <span className={cn(isLast ? "text-foreground font-medium" : "")}>
              {label}
            </span>
          </span>
        )
      })}
    </nav>
  )
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { data: session, isPending } = useSession()
  const { data: activeOrg } = useActiveOrganization()
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    if (!isPending && !session?.user) {
      router.replace("/login")
    }
  }, [isPending, session, router])

  useEffect(() => {
    if (!isPending && session?.user && !activeOrg) {
      router.replace("/create-org")
    }
  }, [isPending, session, activeOrg, router])

  if (isPending) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="space-y-3 w-64">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    )
  }

  if (!session?.user) return null

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside
        className={cn(
          "flex flex-col border-r border-border bg-card transition-all duration-200 shrink-0",
          collapsed ? "w-14" : "w-56"
        )}
      >
        {/* Logo */}
        <div className={cn("flex items-center gap-2.5 h-14 px-3 border-b border-border", collapsed && "justify-center px-2")}>
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary shrink-0">
            <LogoIcon className="h-3.5 w-3.5 text-primary-foreground" />
          </div>
          {!collapsed && (
            <span className="font-semibold text-sm tracking-tight">ClauseFlow</span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
          {navItems.map(({ label, href, Icon }) => {
            const isActive = href === "/contracts?view=folders"
              ? pathname === "/contracts" && false
              : pathname.startsWith(href.split("?")[0]) && (href === "/dashboard" ? pathname === "/dashboard" : true)
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  collapsed && "justify-center px-2"
                )}
                title={collapsed ? label : undefined}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span>{label}</span>}
              </Link>
            )
          })}
        </nav>

        {/* Org + User */}
        <div className="border-t border-border p-2 space-y-2">
          {!collapsed && activeOrg && (
            <div className="px-2 py-1.5 rounded-md bg-muted">
              <p className="text-xs font-medium truncate">{activeOrg.name}</p>
              <p className="text-xs text-muted-foreground">Organization</p>
            </div>
          )}
          <div className={cn("flex items-center gap-2", collapsed && "justify-center")}>
            <Avatar className="h-7 w-7 shrink-0">
              {session.user.image && <AvatarImage src={session.user.image} />}
              <AvatarFallback className="text-xs">{getInitials(session.user.name ?? session.user.email)}</AvatarFallback>
            </Avatar>
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{session.user.name}</p>
                <p className="text-xs text-muted-foreground truncate">{session.user.email}</p>
              </div>
            )}
            {!collapsed && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => signOut({ fetchOptions: { onSuccess: () => router.push("/login") } })}
                title="Sign out"
              >
                <LogOut className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-14 items-center justify-between gap-4 border-b border-border bg-card px-4 shrink-0">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setCollapsed((v) => !v)}
            >
              {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </Button>
            <Breadcrumbs />
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" disabled>
              <Bell className="h-4 w-4" />
            </Button>
            <ThemeToggle />
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>

      <CmdK />
    </div>
  )
}

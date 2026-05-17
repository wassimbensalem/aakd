"use client"

import { useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import Link from "next/link"
import {
  LayoutDashboard,
  FileText,
  Layers,
  Target,
  BarChart2,
  Bot,
  MessageSquare,
  Settings,
  LogOut,
  Search,
  ChevronDown,
  RefreshCw,
} from "lucide-react"
import { useSession, useActiveOrganization, signOut } from "@/lib/auth/client"
import { ThemeToggle } from "@/components/theme-toggle"
import { CmdK } from "@/components/cmd-k"
import { NotificationBell } from "@/components/notification-bell"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { GlobalProviders } from "@/components/global-providers"
import { ClauseFlowLogoMark } from "@/components/aakd-logo"
import { useTranslations } from "next-intl"

// ─── Types ───────────────────────────────────────────────────────────────────

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
  disabled?: boolean
  exact?: boolean
  /** Override the path prefix used for active-link detection */
  matchPrefix?: string
}

interface NavSection {
  title: string
  items: NavItem[]
}

// ─── Nav config (moved inside component — see AppLayout below) ───────────────

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

// ─── SoonBadge ───────────────────────────────────────────────────────────────

function SoonBadge() {
  return (
    <span className="ml-auto text-[9px] font-semibold bg-muted text-muted-foreground px-1.5 py-0.5 rounded-full">
      Soon
    </span>
  )
}

// ─── NavItemRow ──────────────────────────────────────────────────────────────

function NavItemRow({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = item.icon
  const activePrefix = item.matchPrefix ?? item.href
  const isActive = item.exact
    ? pathname === item.href
    : pathname.startsWith(activePrefix)

  if (item.disabled) {
    return (
      <div
        className="flex items-center gap-2.5 rounded-[calc(var(--radius)-1px)] px-[10px] py-[6px] opacity-40 cursor-not-allowed select-none"
        style={{ fontSize: "13px" }}
      >
        <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
        <span>{item.label}</span>
        <SoonBadge />
      </div>
    )
  }

  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-2.5 rounded-[calc(var(--radius)-1px)] px-[10px] py-[6px] transition-colors",
        isActive
          ? "bg-primary/10 text-primary font-semibold"
          : "text-foreground/80 hover:bg-muted-foreground/[0.08] hover:text-foreground"
      )}
      style={{ fontSize: "13px" }}
    >
      <Icon
        className="h-4 w-4 shrink-0"
        strokeWidth={isActive ? 2.2 : 1.8}
      />
      <span>{item.label}</span>
    </Link>
  )
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function Sidebar({
  pathname,
  userName,
  userEmail,
  userImage,
  orgName,
  onSignOut,
  navSections,
  searchLabel,
  themeLabel,
}: {
  pathname: string
  userName: string
  userEmail: string
  userImage?: string | null
  orgName: string
  onSignOut: () => void
  navSections: NavSection[]
  searchLabel: string
  themeLabel: string
}) {
  return (
    <aside className="flex flex-col h-full w-[232px] shrink-0 bg-muted border-r border-border">
      {/* Logo row */}
      <div className="flex items-center gap-2.5 px-3 py-3 border-b border-border">
        <ClauseFlowLogoMark size={26} />
        <span className="font-extrabold text-sm flex-1 min-w-0 truncate" style={{ fontFamily: "var(--font-sora), 'Sora', sans-serif", letterSpacing: '-0.02em' }}>
          ClauseFlow
        </span>
        <NotificationBell />
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      </div>

      {/* Search bar */}
      <div className="px-2 pt-2 pb-1">
        <button
          type="button"
          className="flex items-center gap-2 w-full rounded-[calc(var(--radius)-1px)] px-[10px] py-[6px] bg-background border border-border text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors"
          style={{ fontSize: "13px" }}
          onClick={() => {
            document.dispatchEvent(
              new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true })
            )
          }}
        >
          <Search className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
          <span className="flex-1 text-left">{searchLabel}</span>
          <kbd className="font-mono text-[10px] bg-muted border border-border rounded px-1 py-0.5 text-muted-foreground leading-none">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
        {navSections.map((section) => (
          <div key={section.title}>
            <p className="px-[10px] pt-[14px] pb-1 text-[10px] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
              {section.title}
            </p>
            {section.items.map((item) => (
              <NavItemRow key={item.href} item={item} pathname={pathname} />
            ))}
          </div>
        ))}
      </nav>

      {/* Spacer is handled by flex-1 on nav above */}

      {/* Theme toggle row */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-border">
        <ThemeToggle />
        <span className="text-xs text-muted-foreground">{themeLabel}</span>
      </div>

      {/* User card */}
      <div className="px-2 pb-2">
        <div className="bg-background border border-border rounded-md p-2 flex items-center gap-2">
          {/* Avatar */}
          {userImage ? (
            <img src={userImage} className="h-7 w-7 rounded-full object-cover shrink-0" alt="avatar" />
          ) : (
            <div className="h-7 w-7 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
              <span className="text-[10px] font-bold text-primary">
                {getInitials(userName || userEmail)}
              </span>
            </div>
          )}
          {/* Info */}
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-xs truncate leading-tight">
              {userName || userEmail}
            </p>
            <p className="text-[10px] text-muted-foreground truncate leading-tight">
              {orgName}
            </p>
          </div>
          {/* Sign out */}
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
            onClick={onSignOut}
            title="Sign out"
          >
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </aside>
  )
}

// ─── AppLayout ───────────────────────────────────────────────────────────────

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { data: session, isPending } = useSession()
  const { data: activeOrg, isPending: orgPending } = useActiveOrganization()
  const t = useTranslations("nav")

  const NAV_SECTIONS: NavSection[] = [
    {
      title: t("sections.core"),
      items: [
        { label: t("dashboard"),   href: "/dashboard",   icon: LayoutDashboard, exact: true },
        { label: t("contracts"),   href: "/contracts",   icon: FileText },
        { label: t("renewals"),    href: "/renewals",    icon: RefreshCw },
        { label: t("templates"),   href: "/templates",   icon: Layers },
        { label: t("obligations"), href: "/obligations", icon: Target },
        { label: t("analytics"),   href: "/analytics",   icon: BarChart2 },
      ],
    },
    {
      title: t("sections.ai"),
      items: [
        { label: t("aiAgents"),  href: "/ai/agents", icon: Bot,          disabled: true },
        { label: t("aiCreate"),  href: "/ai/create", icon: MessageSquare, disabled: true },
      ],
    },
    {
      title: t("sections.settings"),
      items: [
        { label: t("settings"), href: "/settings/org", icon: Settings, matchPrefix: "/settings" },
      ],
    },
  ]

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
        <div className="space-y-3 w-64">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    )
  }

  if (!session?.user) return null

  const userName = session.user.name ?? ""
  const userEmail = session.user.email ?? ""
  const userImage = (session.user as { image?: string | null }).image ?? null
  const orgName = activeOrg?.name ?? ""

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <Sidebar
        pathname={pathname}
        userName={userName}
        userEmail={userEmail}
        userImage={userImage}
        orgName={orgName}
        onSignOut={() =>
          signOut({ fetchOptions: { onSuccess: () => router.push("/login") } })
        }
        navSections={NAV_SECTIONS}
        searchLabel={t("search")}
        themeLabel={t("theme")}
      />

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>

      <CmdK />
      <GlobalProviders />
    </div>
  )
}

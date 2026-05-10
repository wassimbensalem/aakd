"use client"

import { useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import {
  ArrowLeft,
  Sparkles,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

// ─── Types ────────────────────────────────────────────────────────────────────

type DiffKind = "changed" | "added" | "removed"

interface ClauseSection {
  id: string
  section: string
  kind: DiffKind
  oldText?: string
  newText?: string
}

interface Version {
  id: string
  label: string
  date: string
  author: string
  isCurrent?: boolean
}

// ─── Static mock data ─────────────────────────────────────────────────────────

const VERSIONS: Version[] = [
  { id: "v1", label: "v1", date: "Jan 12, 2024", author: "Alex Chen" },
  { id: "v2", label: "v2", date: "Feb 3, 2024", author: "Priya Sharma" },
  {
    id: "v3",
    label: "v3",
    date: "Mar 18, 2024",
    author: "Marcus Liu",
    isCurrent: true,
  },
]

const CLAUSE_SECTIONS: ClauseSection[] = [
  {
    id: "s1",
    section: "§ 3.2 Liability Cap",
    kind: "changed",
    oldText: "6 months of fees paid",
    newText: "12 months of fees paid",
  },
  {
    id: "s2",
    section: "§ 4.1 Confidentiality Period",
    kind: "changed",
    oldText: "3 years post-termination",
    newText: "5 years post-termination",
  },
  {
    id: "s3",
    section: "§ 7.3 Auto-Renewal Notice",
    kind: "added",
    oldText: undefined,
    newText: "90 days written notice required",
  },
]

// ─── Diff Badge ───────────────────────────────────────────────────────────────

function DiffBadge({ kind }: { kind: DiffKind }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
        kind === "changed" &&
          "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
        kind === "added" &&
          "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
        kind === "removed" &&
          "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
      )}
    >
      {kind === "changed" && "Changed"}
      {kind === "added" && "Added"}
      {kind === "removed" && "Removed"}
    </span>
  )
}

// ─── Author chip ──────────────────────────────────────────────────────────────

function AuthorChip({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/20 text-primary text-[9px] font-bold">
        {initials}
      </span>
      {name}
    </span>
  )
}

// ─── Version selector ─────────────────────────────────────────────────────────

function VersionSelector({
  label,
  versions,
  value,
  onChange,
}: {
  label: string
  versions: Version[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">
        {label}
      </span>
      <Select value={value} onValueChange={(v) => { if (v != null) onChange(v) }}>
        <SelectTrigger className="h-8 w-36 text-sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {versions.map((v) => (
            <SelectItem key={v.id} value={v.id}>
              {v.label}
              {v.isCurrent ? " (current)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

// ─── Clause Row ───────────────────────────────────────────────────────────────

function ClauseRow({ section }: { section: ClauseSection }) {
  return (
    <>
      {/* Section title spanning both columns */}
      <div className="col-span-2 flex items-center justify-between border-b border-border pb-2 mt-4 first:mt-0">
        <h3 className="text-sm font-semibold text-foreground">{section.section}</h3>
        <DiffBadge kind={section.kind} />
      </div>

      {/* Left — old clause */}
      <div>
        {section.oldText ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 leading-relaxed">
            {section.oldText}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground italic">
            — Not present in this version —
          </div>
        )}
      </div>

      {/* Right — new clause */}
      <div>
        {section.newText ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 leading-relaxed">
            {section.newText}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground italic">
            — Not present in this version —
          </div>
        )}
      </div>
    </>
  )
}

// ─── Coming Soon Overlay ──────────────────────────────────────────────────────

function ComingSoonOverlay() {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/80 backdrop-blur-sm rounded-xl">
      <div className="flex flex-col items-center text-center gap-4 bg-card ring-1 ring-foreground/10 rounded-xl px-10 py-8 shadow-xl max-w-sm">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <Sparkles className="h-7 w-7 text-primary" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-foreground">
            Version Comparison
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Compare contract versions side by side with highlighted changes
          </p>
        </div>
        <Button disabled className="opacity-50 cursor-not-allowed w-full">
          Request Early Access
        </Button>
      </div>
    </div>
  )
}

// ─── Page Component ───────────────────────────────────────────────────────────

export default function ComparisonPage() {
  const { id } = useParams<{ id: string }>()

  const [versionA, setVersionA] = useState<string>("v2")
  const [versionB, setVersionB] = useState<string>("v3")

  const versionAData = VERSIONS.find((v) => v.id === versionA)
  const versionBData = VERSIONS.find((v) => v.id === versionB)

  return (
    <div className="min-h-screen bg-background">
      {/* Page header */}
      <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center gap-4">
          <Link href={`/contracts/${id}`}>
            <Button variant="ghost" size="icon-sm">
              <ArrowLeft className="h-4 w-4" />
              <span className="sr-only">Back to contract</span>
            </Button>
          </Link>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-semibold text-foreground leading-tight">
              Version Comparison
            </h1>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="mx-auto max-w-6xl px-6 py-8 space-y-6">
        {/* Version selectors */}
        <div className="flex items-center gap-6 flex-wrap">
          <VersionSelector
            label="Version A:"
            versions={VERSIONS}
            value={versionA}
            onChange={setVersionA}
          />
          <VersionSelector
            label="Version B:"
            versions={VERSIONS}
            value={versionB}
            onChange={setVersionB}
          />
        </div>

        {/* Comparison grid — wrapped in relative container for the overlay */}
        <div className="relative rounded-xl">
          {/* Coming soon overlay sits on top */}
          <ComingSoonOverlay />

          {/* Behind overlay — blurred preview content */}
          <div className="rounded-xl border border-border overflow-hidden">
            {/* Column headers */}
            <div className="grid grid-cols-2 divide-x divide-border border-b border-border bg-muted/50">
              {/* Version A header */}
              <div className="px-5 py-3 flex items-center gap-3">
                {versionAData && (
                  <>
                    <span className="text-sm font-semibold text-foreground">
                      {versionAData.label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {versionAData.date}
                    </span>
                    <AuthorChip name={versionAData.author} />
                  </>
                )}
              </div>
              {/* Version B header */}
              <div className="px-5 py-3 flex items-center gap-3">
                {versionBData && (
                  <>
                    <span className="text-sm font-semibold text-foreground">
                      {versionBData.label}
                      {versionBData.isCurrent && (
                        <span className="ml-1 text-xs font-normal text-muted-foreground">
                          (current)
                        </span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {versionBData.date}
                    </span>
                    <AuthorChip name={versionBData.author} />
                  </>
                )}
              </div>
            </div>

            {/* Clause rows */}
            <div className="grid grid-cols-2 gap-x-0 gap-y-4 px-5 py-5">
              {CLAUSE_SECTIONS.map((section) => (
                <ClauseRow key={section.id} section={section} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

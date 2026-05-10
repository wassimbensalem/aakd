import { Eye, Zap, Calendar, CheckCircle, Bot } from "lucide-react"
import Link from "next/link"

// ─── Agent Card ────────────────────────────────────────────────────────────

interface AgentStat {
  value: string
  label: string
}

interface AgentCardProps {
  icon: React.ReactNode
  name: string
  description: string
  trigger: string
  stats: AgentStat[]
}

function AgentCard({ icon, name, description, trigger, stats }: AgentCardProps) {
  return (
    <div className="relative rounded-[var(--radius)] border border-border bg-card p-5 opacity-60">
      {/* Coming Soon badge */}
      <span className="absolute top-3 right-3 text-[9px] font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-full">
        Coming Soon
      </span>

      {/* Icon */}
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground mb-3">
        {icon}
      </div>

      {/* Name + description */}
      <h3 className="text-sm font-semibold text-foreground mb-1">{name}</h3>
      <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{description}</p>

      {/* Trigger */}
      <div className="flex items-center gap-1.5 mb-4">
        <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          Trigger:
        </span>
        <span className="text-[11px] text-foreground/70 bg-muted rounded px-1.5 py-0.5">
          {trigger}
        </span>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 border-t border-border pt-3">
        {stats.map((s) => (
          <div key={s.label} className="text-center">
            <p className="text-base font-bold tabular-nums text-foreground">{s.value}</p>
            <p className="text-[10px] text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Disabled toggle */}
      <div className="flex items-center gap-2 mt-3">
        <div className="relative w-9 h-5 rounded-full bg-muted cursor-not-allowed">
          <div className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-muted-foreground/40" />
        </div>
        <span className="text-xs text-muted-foreground">Disabled</span>
      </div>
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default function AIAgentsPage() {
  const agents: AgentCardProps[] = [
    {
      icon: <Eye className="h-4 w-4" />,
      name: "Contract Reviewer",
      description:
        "Automatically reviews new contracts for risks, non-standard clauses, and compliance issues.",
      trigger: "On contract upload",
      stats: [
        { value: "34", label: "Processed" },
        { value: "7", label: "Flagged" },
        { value: "96%", label: "Accuracy" },
      ],
    },
    {
      icon: <Zap className="h-4 w-4" />,
      name: "Key Term Extractor",
      description:
        "Extracts dates, monetary values, parties, obligations, and key terms from uploaded documents.",
      trigger: "On document import",
      stats: [
        { value: "142", label: "Processed" },
        { value: "1840", label: "Extracted" },
        { value: "94%", label: "Accuracy" },
      ],
    },
    {
      icon: <Calendar className="h-4 w-4" />,
      name: "Obligation Monitor",
      description:
        "Continuously monitors upcoming deadlines and obligations. Sends alerts before due dates.",
      trigger: "Daily at 8 AM",
      stats: [
        { value: "89", label: "Tracked" },
        { value: "12", label: "Alerts" },
        { value: "1", label: "Overdue" },
      ],
    },
    {
      icon: <CheckCircle className="h-4 w-4" />,
      name: "Compliance Checker",
      description:
        "Validates contracts against your company playbook and regulatory requirements.",
      trigger: "On approval request",
      stats: [
        { value: "0", label: "Processed" },
        { value: "0", label: "Flagged" },
        { value: "—", label: "Accuracy" },
      ],
    },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-7 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-xl font-semibold">AI Agents</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Automate your contract workflows.
          </p>
        </div>
        <button
          type="button"
          disabled
          className="inline-flex items-center gap-1.5 h-[34px] px-3 text-[13px] font-medium rounded-[var(--radius)] bg-primary text-primary-foreground opacity-40 cursor-not-allowed"
        >
          Create Agent
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-7 py-5 space-y-6">
        {/* ── Agent grid ───────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4">
          {agents.map((agent) => (
            <AgentCard key={agent.name} {...agent} />
          ))}
        </div>

        {/* ── Cloud callout banner ──────────────────────────────────── */}
        <div className="flex items-start gap-4 rounded-[var(--radius)] border border-primary/20 bg-primary/5 p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Bot className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">
              AI Agents — Cloud Feature
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              AI Agents will be available in the ClauseFlow Cloud plan. Self-hosted users
              can configure their own AI providers via the API.
            </p>
          </div>
          <Link
            href="mailto:hello@clauseflow.io"
            target="_blank"
            className="shrink-0 inline-flex items-center h-8 px-3 text-xs font-medium rounded-[var(--radius)] bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            Join Waitlist
          </Link>
        </div>
      </div>
    </div>
  )
}

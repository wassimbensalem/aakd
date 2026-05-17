import Link from "next/link"
import { Bot, Check } from "lucide-react"

// ─── Preview Pane ─────────────────────────────────────────────────────────

function PreviewPane() {
  const steps = [
    { label: "Contract Type", done: true },
    { label: "Counterparty", done: true },
    { label: "Key Terms", active: true },
    { label: "Review & Create", done: false },
  ]

  return (
    <div className="flex flex-1 overflow-hidden rounded-[var(--radius)] border border-border bg-card">
      {/* Left sidebar */}
      <div className="w-64 shrink-0 border-r border-border flex flex-col">
        {/* Steps */}
        <div className="p-4 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground mb-3">
            Progress
          </p>
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2.5">
              <div
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${
                  s.done
                    ? "bg-primary border-primary text-primary-foreground"
                    : s.active
                    ? "border-primary text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                {s.done ? <Check className="h-2.5 w-2.5" /> : i + 1}
              </div>
              <span
                className={`text-xs ${
                  s.active ? "font-semibold text-foreground" : "text-muted-foreground"
                }`}
              >
                {s.label}
              </span>
            </div>
          ))}
        </div>

        {/* Extracted card */}
        <div className="mx-3 mb-3 rounded-[var(--radius)] border border-border bg-muted/40 p-3 text-xs space-y-1.5">
          <p className="font-semibold text-muted-foreground text-[10px] uppercase tracking-[0.06em]">
            Extracted
          </p>
          <div className="flex gap-1.5">
            <span className="text-muted-foreground">Type:</span>
            <span className="text-foreground">SaaS License</span>
          </div>
          <div className="flex gap-1.5">
            <span className="text-muted-foreground">Party:</span>
            <span className="text-foreground">Acme Corp</span>
          </div>
          <div className="flex gap-1.5">
            <span className="text-muted-foreground">Template:</span>
            <span className="text-foreground">SaaS License Agr.</span>
          </div>
        </div>

        <div className="mt-auto p-3">
          <button
            disabled
            className="w-full h-8 text-xs font-medium rounded-[var(--radius)] bg-primary text-primary-foreground opacity-40 cursor-not-allowed"
          >
            Create Draft
          </button>
        </div>
      </div>

      {/* Right: chat area */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Messages */}
        <div className="flex-1 p-4 space-y-3 overflow-hidden">
          {/* Assistant */}
          <div className="flex gap-2 items-start">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Bot className="h-3 w-3" />
            </div>
            <div className="rounded-[var(--radius)] bg-muted px-3 py-2 text-xs text-foreground max-w-[320px]">
              Hi! I&apos;ll help you create a new contract. What type of agreement do
              you need?
            </div>
          </div>
          {/* User */}
          <div className="flex justify-end">
            <div className="rounded-[var(--radius)] bg-primary px-3 py-2 text-xs text-primary-foreground max-w-[300px]">
              A SaaS license agreement for an enterprise client.
            </div>
          </div>
          {/* Assistant */}
          <div className="flex gap-2 items-start">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Bot className="h-3 w-3" />
            </div>
            <div className="rounded-[var(--radius)] bg-muted px-3 py-2 text-xs text-foreground max-w-[320px]">
              Great choice. Who is the counterparty?
            </div>
          </div>
        </div>

        {/* Input bar */}
        <div className="border-t border-border p-3">
          <input
            disabled
            placeholder="Type your response..."
            className="w-full h-8 px-3 text-xs bg-muted border border-border rounded-[var(--radius)] text-muted-foreground cursor-not-allowed"
          />
        </div>
      </div>
    </div>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────

export default function AICreatePage() {
  return (
    <div className="flex flex-col h-full">
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-7 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-xl font-semibold">Create with AI</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Build contracts through guided AI conversation.
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-7 py-5">
        {/* Two-pane preview wrapper with overlay */}
        <div className="relative h-[calc(100vh-220px)] min-h-[400px]">
          <PreviewPane />

          {/* Semi-opaque overlay */}
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded-[var(--radius)] bg-background/80 backdrop-blur-[2px]">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary mb-4">
              <Bot className="h-7 w-7" />
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-1">
              Create with AI
            </h2>
            <p className="text-sm text-muted-foreground text-center max-w-xs mb-5">
              Guided AI contracting is available in the ClauseFlow Cloud plan.
            </p>
            <Link
              href="mailto:hello@clauseflow.io"
              target="_blank"
              className="inline-flex items-center h-9 px-4 text-sm font-medium rounded-[var(--radius)] bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
            >
              Join Waitlist
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

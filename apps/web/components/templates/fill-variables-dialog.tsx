"use client"

import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { ChevronLeft, ChevronRight, CircleHelp, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"

export interface TemplateVariable {
  name: string
  label: string
  type: "text" | "date" | "number"
  required: boolean
  defaultValue?: string
}

interface FullTemplate {
  id: string
  name: string
  variables: TemplateVariable[]
  content?: unknown
}

// ---------------------------------------------------------------------------
// Variable grouping — splits >5 variables into logical steps
// ---------------------------------------------------------------------------
type VariableGroup = { label: string; vars: TemplateVariable[] }

function groupVariables(vars: TemplateVariable[]): VariableGroup[] {
  if (vars.length <= 5) {
    return [{ label: "Variables", vars }]
  }

  const parties: TemplateVariable[] = []
  const dates: TemplateVariable[] = []
  const financial: TemplateVariable[] = []
  const other: TemplateVariable[] = []

  for (const v of vars) {
    const lower = v.name.toLowerCase()
    if (
      lower.includes("party") ||
      lower.includes("counterparty") ||
      lower.includes("company") ||
      lower.includes("name") ||
      lower.includes("address") ||
      lower.includes("email") ||
      lower.includes("signatory")
    ) {
      parties.push(v)
    } else if (
      lower.includes("date") ||
      lower.includes("term") ||
      lower.includes("duration") ||
      lower.includes("period") ||
      lower.includes("expir") ||
      lower.includes("renew")
    ) {
      dates.push(v)
    } else if (
      lower.includes("value") ||
      lower.includes("amount") ||
      lower.includes("price") ||
      lower.includes("fee") ||
      lower.includes("cost") ||
      lower.includes("payment") ||
      lower.includes("salary") ||
      lower.includes("rate")
    ) {
      financial.push(v)
    } else {
      other.push(v)
    }
  }

  const groups: VariableGroup[] = []
  if (parties.length > 0) groups.push({ label: "Parties", vars: parties })
  if (dates.length > 0) groups.push({ label: "Dates", vars: dates })
  if (financial.length > 0) groups.push({ label: "Financial", vars: financial })
  if (other.length > 0) groups.push({ label: "Other", vars: other })

  // Fallback — if all went to one bucket, don't show steps
  if (groups.length === 1) {
    return [{ label: "Variables", vars }]
  }

  return groups
}

// ---------------------------------------------------------------------------
// Hint text for well-known variable names
// ---------------------------------------------------------------------------
function getVariableHint(name: string, label: string): string {
  const lower = name.toLowerCase()
  if (lower === "party_name" || lower === "counterparty_name") return "Enter the full legal name of the counterparty"
  if (lower === "effective_date" || lower === "date") return "The date this contract becomes effective"
  if (lower === "company_name" || lower === "your_company" || lower === "our_company") return "Your organisation's legal name"
  if (lower === "contract_value" || lower === "amount" || lower === "price") return "The total monetary value of this agreement"
  if (lower === "term" || lower === "duration") return "How long this contract remains in effect"
  if (lower === "governing_law" || lower === "jurisdiction") return "The legal jurisdiction that governs this agreement"
  return `Enter a value for ${label}`
}

// ---------------------------------------------------------------------------
// Preview renderer — walks TipTap JSON and substitutes variable values
// ---------------------------------------------------------------------------
function renderPreview(content: unknown, values: Record<string, string>): string {
  if (!content || typeof content !== "object") return ""

  function visitNode(n: unknown): string {
    if (!n || typeof n !== "object") return ""
    const node = n as {
      type?: string
      text?: string
      attrs?: Record<string, string>
      content?: unknown[]
      marks?: Array<{ type: string }>
    }

    // Text leaf
    if (node.type === "text") {
      let text = node.text ?? ""
      // Apply basic marks
      if (Array.isArray(node.marks)) {
        for (const mark of node.marks) {
          if (mark.type === "bold") text = `<strong>${text}</strong>`
          else if (mark.type === "italic") text = `<em>${text}</em>`
          else if (mark.type === "underline") text = `<u>${text}</u>`
        }
      }
      return text
    }

    // Template variable node
    if (node.type === "templateVariable") {
      const varName = node.attrs?.variable ?? ""
      const filled = values[varName]
      if (filled) {
        return `<span class="font-medium text-foreground">${escapeHtml(filled)}</span>`
      }
      return `<mark style="background:#fef3c7;color:#92400e;padding:0 4px;border-radius:3px;">{{${varName}}}</mark>`
    }

    const inner = Array.isArray(node.content) ? node.content.map(visitNode).join("") : ""

    if (node.type === "doc") return inner

    if (node.type === "paragraph") {
      return inner ? `<p style="margin:0 0 0.75em">${inner}</p>` : `<p style="margin:0 0 0.75em">&nbsp;</p>`
    }

    if (node.type === "heading") {
      const level = node.attrs?.level ?? "1"
      const tag = `h${level}`
      const sizes: Record<string, string> = {
        "1": "font-size:1.5em;font-weight:700;margin:1em 0 0.5em",
        "2": "font-size:1.25em;font-weight:600;margin:0.875em 0 0.5em",
        "3": "font-size:1.1em;font-weight:600;margin:0.75em 0 0.375em",
      }
      return `<${tag} style="${sizes[String(level)] ?? ""}">${inner}</${tag}>`
    }

    if (node.type === "bulletList") return `<ul style="list-style:disc;padding-left:1.5em;margin:0 0 0.75em">${inner}</ul>`
    if (node.type === "orderedList") return `<ol style="list-style:decimal;padding-left:1.5em;margin:0 0 0.75em">${inner}</ol>`
    if (node.type === "listItem") return `<li style="margin:0 0 0.25em">${inner}</li>`

    if (node.type === "horizontalRule") return `<hr style="border:none;border-top:1px solid #e5e7eb;margin:1em 0" />`

    return inner
  }

  return visitNode(content)
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function FillVariablesDialog({
  templateId,
  onClose,
  onCreated,
}: {
  templateId: string
  onClose: () => void
  onCreated: (contractId: string) => void
}) {
  const [template, setTemplate] = useState<FullTemplate | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [autoFilling, setAutoFilling] = useState(false)
  const [title, setTitle] = useState("")
  const [values, setValues] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [previewHtml, setPreviewHtml] = useState("")
  const [stepIndex, setStepIndex] = useState(0)
  const [groups, setGroups] = useState<VariableGroup[]>([])
  const orgFetchedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/templates/${templateId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(async (tpl) => {
        if (cancelled) return
        const declared: TemplateVariable[] = Array.isArray(tpl.variables) ? tpl.variables : []
        setTemplate({ id: tpl.id, name: tpl.name, variables: declared, content: tpl.content })
        setTitle(tpl.name)
        setGroups(groupVariables(declared))

        // Smart auto-populate defaults
        const initial: Record<string, string> = {}
        for (const v of declared) {
          if (v.defaultValue) {
            initial[v.name] = v.defaultValue
            continue
          }
          const lower = v.name.toLowerCase()
          if (lower === "effective_date" || lower === "date") {
            initial[v.name] = new Date().toISOString().split("T")[0]
          }
        }

        // Fetch org name for company variables — only once
        if (!orgFetchedRef.current) {
          orgFetchedRef.current = true
          try {
            const orgRes = await fetch("/api/org")
            if (orgRes.ok) {
              const org = await orgRes.json()
              if (org?.name) {
                for (const v of declared) {
                  const lower = v.name.toLowerCase()
                  if (lower === "company_name" || lower === "your_company" || lower === "our_company") {
                    initial[v.name] = org.name
                  }
                }
              }
            }
          } catch {
            // non-fatal — org name auto-fill is best-effort
          }
        }

        setValues(initial)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        toast.error("Failed to load template")
        onClose()
      })
    return () => {
      cancelled = true
    }
  }, [templateId, onClose])

  // Rebuild preview whenever content or values change
  useEffect(() => {
    if (!template?.content) return
    setPreviewHtml(renderPreview(template.content, values))
  }, [template?.content, values])

  // Progress: required fields filled
  const requiredVars = template?.variables.filter((v) => v.required) ?? []
  const filledRequired = requiredVars.filter((v) => !!values[v.name]).length
  const progressPct = requiredVars.length > 0 ? Math.round((filledRequired / requiredVars.length) * 100) : 100
  const titleFilled = title.trim().length > 0
  const totalRequired = requiredVars.length + 1 // +1 for title
  const totalFilled = filledRequired + (titleFilled ? 1 : 0)

  const isMultiStep = groups.length > 1
  const currentGroup = groups[stepIndex] ?? null
  const isFirstStep = stepIndex === 0
  const isLastStep = stepIndex === groups.length - 1

  async function handleAutoFill() {
    setAutoFilling(true)
    try {
      // Attempt to pull org details for auto-fill hints
      const orgRes = await fetch("/api/org")
      if (!orgRes.ok) {
        toast.info("Auto-fill requires connected contracts — coming soon.")
        return
      }
      const org = await orgRes.json()
      const newValues: Record<string, string> = { ...values }
      let filled = 0
      for (const v of template?.variables ?? []) {
        if (newValues[v.name]) continue // skip already-filled
        const lower = v.name.toLowerCase()
        if ((lower === "company_name" || lower === "your_company" || lower === "our_company") && org?.name) {
          newValues[v.name] = org.name
          filled++
        }
        if ((lower === "effective_date" || lower === "date") && !newValues[v.name]) {
          newValues[v.name] = new Date().toISOString().split("T")[0]
          filled++
        }
        if ((lower === "governing_law" || lower === "jurisdiction") && !newValues[v.name]) {
          newValues[v.name] = org?.country ?? ""
          if (newValues[v.name]) filled++
        }
      }
      setValues(newValues)
      if (filled > 0) {
        toast.success(`Auto-filled ${filled} field${filled > 1 ? "s" : ""} from your org profile`)
      } else {
        toast.info("AI auto-fill requires connected contracts — coming soon.")
      }
    } catch {
      toast.info("AI auto-fill requires connected contracts — coming soon.")
    } finally {
      setAutoFilling(false)
    }
  }

  function validateCurrentStep(): boolean {
    const newErrors: Record<string, string> = {}
    // Always validate title on first interaction
    if (!title.trim()) newErrors.title = "Title is required"

    const varsToValidate = isMultiStep ? (currentGroup?.vars ?? []) : (template?.variables ?? [])
    for (const v of varsToValidate) {
      if (v.required && !values[v.name]) {
        newErrors[v.name] = "This field is required"
      }
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors((prev) => ({ ...prev, ...newErrors }))
      return false
    }
    return true
  }

  function handleNext() {
    if (!validateCurrentStep()) return
    setStepIndex((i) => Math.min(i + 1, groups.length - 1))
  }

  async function handleCreate() {
    if (!template) return
    const newErrors: Record<string, string> = {}
    if (!title.trim()) newErrors.title = "Title is required"
    for (const v of template.variables) {
      if (v.required && !values[v.name]) {
        newErrors[v.name] = "This field is required"
      }
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/templates/${templateId}/use`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, values }),
      })
      if (res.status === 422) {
        const body = await res.json().catch(() => ({}))
        if (body.error === "missing_required_variables" && Array.isArray(body.missing)) {
          const newErrs: Record<string, string> = {}
          for (const m of body.missing) newErrs[m] = "This field is required"
          setErrors(newErrs)
          return
        }
        toast.error("Validation failed")
        return
      }
      if (!res.ok) {
        toast.error("Failed to create contract")
        return
      }
      const body = await res.json()
      if (body.contractId) {
        onCreated(body.contractId)
      }
    } catch (err) {
      console.error("[fill-variables] failed:", err)
      toast.error("Failed to create contract")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !submitting && !open && onClose()}>
      <DialogContent
        showCloseButton
        className="max-w-5xl w-full p-0 overflow-hidden"
        style={{ height: "80vh", maxHeight: "80vh", display: "flex", flexDirection: "column" }}
      >
        {loading ? (
          <div className="p-6 space-y-3 flex-1">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : template ? (
          <div className="flex flex-1 overflow-hidden">
            {/* LEFT PANEL — form */}
            <div className="flex flex-col w-2/5 border-r border-border overflow-hidden">
              <div className="px-5 py-4 border-b border-border shrink-0">
                <DialogHeader>
                  <DialogTitle className="text-base">
                    Create from &ldquo;{template.name}&rdquo;
                  </DialogTitle>
                </DialogHeader>
                {isMultiStep && (
                  <div className="flex items-center gap-1.5 mt-2">
                    {groups.map((g, i) => (
                      <button
                        key={g.label}
                        type="button"
                        onClick={() => i < stepIndex && setStepIndex(i)}
                        className={`h-1.5 rounded-full transition-all ${
                          i === stepIndex
                            ? "bg-primary w-6"
                            : i < stepIndex
                            ? "bg-primary/40 w-3 cursor-pointer"
                            : "bg-muted w-3 cursor-not-allowed"
                        }`}
                        title={g.label}
                      />
                    ))}
                    <span className="text-xs text-muted-foreground ml-1">
                      Step {stepIndex + 1} of {groups.length}: {currentGroup?.label}
                    </span>
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                {/* Progress indicator */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{totalFilled} of {totalRequired} required fields complete</span>
                    <span className="font-medium">{progressPct}%</span>
                  </div>
                  <Progress value={progressPct} />
                </div>

                {/* Contract title (always visible) */}
                {(!isMultiStep || stepIndex === 0) && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contract details</p>
                    <div className="space-y-1">
                      <Label htmlFor="fill-title">
                        Title <span className="text-red-500">*</span>
                      </Label>
                      <Input
                        id="fill-title"
                        value={title}
                        onChange={(e) => {
                          setTitle(e.target.value)
                          setErrors((prev) => ({ ...prev, title: "" }))
                        }}
                        placeholder="e.g. NDA with Acme Corp"
                      />
                      {errors.title && <p className="text-xs text-destructive">{errors.title}</p>}
                    </div>
                  </div>
                )}

                {/* Variables for current step */}
                {(isMultiStep ? currentGroup?.vars ?? [] : template.variables).length > 0 && (
                  <div className="space-y-3">
                    {isMultiStep && (
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {currentGroup?.label}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1.5"
                          onClick={handleAutoFill}
                          disabled={autoFilling}
                        >
                          <Sparkles className="size-3.5" />
                          {autoFilling ? "Filling…" : "Auto-fill from AI"}
                        </Button>
                      </div>
                    )}
                    {!isMultiStep && (
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Variables</p>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1.5"
                          onClick={handleAutoFill}
                          disabled={autoFilling}
                        >
                          <Sparkles className="size-3.5" />
                          {autoFilling ? "Filling…" : "Auto-fill from AI"}
                        </Button>
                      </div>
                    )}
                    {(isMultiStep ? currentGroup?.vars ?? [] : template.variables).map((v) => (
                      <div key={v.name} className="space-y-1">
                        <div className="flex items-center gap-1.5">
                          <Label htmlFor={`var-${v.name}`}>
                            {v.label}
                            {v.required && <span className="text-red-500 ml-0.5">*</span>}
                          </Label>
                          <button
                            type="button"
                            title={getVariableHint(v.name, v.label)}
                            className="text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                            tabIndex={-1}
                          >
                            <CircleHelp className="size-3.5" />
                          </button>
                        </div>
                        <Input
                          id={`var-${v.name}`}
                          type={v.type === "date" ? "date" : v.type === "number" ? "number" : "text"}
                          value={values[v.name] ?? ""}
                          onChange={(e) => {
                            setValues((prev) => ({ ...prev, [v.name]: e.target.value }))
                            setErrors((prev) => ({ ...prev, [v.name]: "" }))
                          }}
                          placeholder={v.type === "date" ? "YYYY-MM-DD" : `Enter ${v.label.toLowerCase()}`}
                        />
                        {errors[v.name] && (
                          <p className="text-xs text-destructive">{errors[v.name]}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Bottom action */}
              <div className="px-5 py-4 border-t border-border shrink-0 flex gap-2">
                {isMultiStep ? (
                  <>
                    <Button
                      variant="outline"
                      onClick={() => isFirstStep ? onClose() : setStepIndex((i) => i - 1)}
                      disabled={submitting}
                      className="flex-1"
                    >
                      {isFirstStep ? "Cancel" : (
                        <>
                          <ChevronLeft className="size-3.5" />
                          Back
                        </>
                      )}
                    </Button>
                    {isLastStep ? (
                      <Button onClick={handleCreate} disabled={submitting} className="flex-1">
                        {submitting ? "Creating…" : "Create Contract"}
                      </Button>
                    ) : (
                      <Button onClick={handleNext} className="flex-1">
                        Next
                        <ChevronRight className="size-3.5" />
                      </Button>
                    )}
                  </>
                ) : (
                  <>
                    <Button variant="outline" onClick={onClose} disabled={submitting} className="flex-1">
                      Cancel
                    </Button>
                    <Button onClick={handleCreate} disabled={submitting} className="flex-1">
                      {submitting ? "Creating…" : "Create Contract"}
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* RIGHT PANEL — live preview */}
            <div className="flex flex-col flex-1 overflow-hidden">
              <div className="px-5 py-3 border-b border-border shrink-0 flex items-center justify-between">
                <span className="text-sm font-medium text-foreground">Preview</span>
                <span className="text-xs text-muted-foreground bg-muted rounded px-1.5 py-0.5">Read-only</span>
              </div>
              <div className="flex-1 overflow-y-auto">
                {previewHtml ? (
                  <div
                    className="p-6 text-sm leading-relaxed text-foreground"
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                  />
                ) : (
                  <div className="p-6 text-sm text-muted-foreground text-center mt-8">
                    <p>Fill in the variables on the left to see a live preview here.</p>
                    <p className="mt-1 text-xs">Unfilled fields are highlighted in amber.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

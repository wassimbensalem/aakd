"use client"

import { useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { ChevronRight, Plus, Trash2 } from "lucide-react"
import type { Descendant } from "slate"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { ContractEditor, EMPTY_DOC } from "@/components/editor/contract-editor"

const CONTRACT_TYPES = ["NDA", "MSA", "SOW", "EMPLOYMENT", "VENDOR", "CUSTOMER", "OTHER"] as const
type ContractType = (typeof CONTRACT_TYPES)[number]

interface Variable {
  name: string
  label: string
  type: "text" | "date" | "number"
  required: boolean
  defaultValue?: string
}


export function TemplateEditorPage({ templateId }: { templateId?: string }) {
  const router = useRouter()
  const isEdit = !!templateId

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [contractType, setContractType] = useState<ContractType | "NONE">("NONE")
  const [content, setContent] = useState<Descendant[]>(EMPTY_DOC)
  const [wordCount, setWordCount] = useState(0)
  const [variables, setVariables] = useState<Variable[]>([])
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [showAddVariable, setShowAddVariable] = useState(false)
  const [newVar, setNewVar] = useState<Variable>({
    name: "",
    label: "",
    type: "text",
    required: true,
    defaultValue: "",
  })

  useEffect(() => {
    if (!isEdit || !templateId) return
    fetch(`/api/templates/${templateId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((tpl) => {
        setName(tpl.name ?? "")
        setDescription(tpl.description ?? "")
        setContractType((tpl.contractType ?? "NONE") as ContractType | "NONE")
        if (Array.isArray(tpl.content) && tpl.content.length > 0) setContent(tpl.content)
        if (Array.isArray(tpl.variables)) setVariables(tpl.variables)
        setWordCount(tpl.wordCount ?? 0)
        setLoading(false)
      })
      .catch(() => {
        toast.error("Failed to load template")
        router.push("/templates")
      })
  }, [isEdit, templateId, router])

  const handleEditorChange = useCallback((value: Descendant[], wc: number) => {
    setContent(value)
    setWordCount(wc)
  }, [])

  function addVariable() {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(newVar.name)) {
      toast.error("Variable name must be lowercase letters, numbers, underscores; start with a letter.")
      return
    }
    if (!newVar.label.trim()) {
      toast.error("Variable label is required")
      return
    }
    if (variables.some((v) => v.name === newVar.name)) {
      toast.error("Variable name already exists")
      return
    }
    if (variables.length >= 50) {
      toast.error("Max 50 variables per template")
      return
    }
    setVariables([...variables, { ...newVar, defaultValue: newVar.defaultValue || undefined }])
    setNewVar({ name: "", label: "", type: "text", required: true, defaultValue: "" })
    setShowAddVariable(false)
  }

  function removeVariable(name: string) {
    setVariables((vs) => vs.filter((v) => v.name !== name))
  }

  async function save() {
    if (!name.trim()) {
      toast.error("Name is required")
      return
    }
    // Client-side check: every {{variable}} chip must reference a declared variable.
    const used = findUsedVariableNames(content)
    const declaredNames = new Set(variables.map((v) => v.name))
    const undeclared = used.filter((n) => !declaredNames.has(n))
    if (undeclared.length > 0) {
      toast.error(
        "Some variables in the document are not declared. Add them in the Variables panel or remove them from the document.",
      )
      return
    }

    setSaving(true)
    try {
      const body = {
        name,
        description: description || undefined,
        contractType: contractType === "NONE" ? undefined : contractType,
        content,
        variables,
        wordCount,
      }
      const url = isEdit ? `/api/templates/${templateId}` : "/api/templates"
      const method = isEdit ? "PATCH" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        if (err.error === "template_limit_reached") {
          toast.error("Template limit reached (200). Archive unused templates to create new ones.")
        } else if (err.error === "duplicate_variable_names") {
          toast.error(`Duplicate variable names: ${err.duplicates?.join(", ")}`)
        } else if (err.error === "undeclared_variables") {
          toast.error(`Undeclared variables in document: ${err.names?.join(", ")}`)
        } else if (err.error === "payload_too_large") {
          toast.error("Template content too large (max 5 MB)")
        } else {
          toast.error("Failed to save template")
        }
        return
      }
      toast.success("Template saved")
      router.push("/templates")
    } catch (err) {
      console.error("[template-editor] save failed:", err)
      toast.error("Failed to save template")
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="p-6 text-sm text-zinc-500">Loading template…</div>

  return (
    <div className="p-6 space-y-4">
      <nav className="flex items-center gap-1 text-sm text-zinc-500">
        <Link href="/templates" className="hover:text-zinc-900">Templates</Link>
        <ChevronRight className="size-3.5" />
        <span className="text-zinc-900">{isEdit ? name || "Edit Template" : "New Template"}</span>
      </nav>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 md:col-span-3 space-y-4">
          <div className="rounded-lg border border-zinc-200 bg-white p-4 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-name">Name <span className="text-red-500">*</span></Label>
              <Input
                id="tpl-name"
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-desc">Description</Label>
              <Textarea
                id="tpl-desc"
                rows={3}
                maxLength={1000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Contract type</Label>
              <Select value={contractType} onValueChange={(v) => v && setContractType(v as ContractType | "NONE")}>
                <SelectTrigger className="h-9 text-sm w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">None</SelectItem>
                  {CONTRACT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Variables</p>
              <Button
                variant="outline"
                size="sm"
                className="h-7"
                onClick={() => setShowAddVariable((v) => !v)}
                disabled={variables.length >= 50}
              >
                <Plus className="size-3.5" /> Add
              </Button>
            </div>
            {showAddVariable && (
              <div className="space-y-2 rounded border border-zinc-200 p-2 bg-zinc-50">
                <Input
                  placeholder="Name (e.g. party_name)"
                  value={newVar.name}
                  onChange={(e) => setNewVar({ ...newVar, name: e.target.value })}
                  className="h-8 text-sm"
                />
                <Input
                  placeholder="Label (e.g. Party Name)"
                  value={newVar.label}
                  onChange={(e) => setNewVar({ ...newVar, label: e.target.value })}
                  className="h-8 text-sm"
                />
                <Select
                  value={newVar.type}
                  onValueChange={(v) => v && setNewVar({ ...newVar, type: v as "text" | "date" | "number" })}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Text</SelectItem>
                    <SelectItem value="date">Date</SelectItem>
                    <SelectItem value="number">Number</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  placeholder="Default value (optional)"
                  value={newVar.defaultValue ?? ""}
                  onChange={(e) => setNewVar({ ...newVar, defaultValue: e.target.value })}
                  className="h-8 text-sm"
                />
                <label className="inline-flex items-center gap-2 text-xs text-zinc-700">
                  <Switch
                    checked={newVar.required}
                    onCheckedChange={(c) => setNewVar({ ...newVar, required: c })}
                  />
                  Required
                </label>
                <div className="flex gap-2">
                  <Button size="sm" className="h-7" onClick={addVariable}>Add</Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7"
                    onClick={() => setShowAddVariable(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              {variables.length === 0 && !showAddVariable && (
                <p className="text-xs text-zinc-500">No variables declared yet.</p>
              )}
              {variables.map((v) => (
                <div key={v.name} className="rounded border border-zinc-200 px-2 py-1.5 text-xs flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-zinc-900 truncate">{v.label}</p>
                    <p className="text-zinc-500 truncate">{v.name} · {v.type}{v.required ? " · req" : ""}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeVariable(v.name)}
                    className="text-red-500 hover:text-red-700"
                    title="Remove variable"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="col-span-12 md:col-span-9 space-y-3">
          <div className="flex items-center justify-end gap-2">
            <Link href="/templates">
              <Button variant="outline">Cancel</Button>
            </Link>
            <Button onClick={save} disabled={saving}>
              {saving ? "Saving…" : "Save Template"}
            </Button>
          </div>
          <ContractEditor
            initialContent={content}
            initialVersion={0}
            onChange={handleEditorChange}
            showVariablesPanel
            variables={variables.map((v) => ({ name: v.name, label: v.label, required: v.required }))}
            enableAutoSave={false}
          />
        </div>
      </div>
    </div>
  )
}

function findUsedVariableNames(nodes: Descendant[]): string[] {
  const out = new Set<string>()
  function visit(n: unknown): void {
    if (!n || typeof n !== "object") return
    const node = n as { type?: string; variable?: string; children?: unknown[] }
    if (node.type === "template_variable" && typeof node.variable === "string") {
      out.add(node.variable)
    }
    if (Array.isArray(node.children)) {
      for (const c of node.children) visit(c)
    }
  }
  for (const n of nodes) visit(n)
  return Array.from(out)
}

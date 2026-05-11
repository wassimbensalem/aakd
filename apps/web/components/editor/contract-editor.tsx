"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createEditor, Editor, Element as SlateElement, Range, Text, Transforms, type Descendant, type BaseEditor, type NodeEntry } from "slate"
import { Slate, Editable, withReact, type ReactEditor, type RenderElementProps, type RenderLeafProps } from "slate-react"
import { withHistory, type HistoryEditor } from "slate-history"
import { toast } from "sonner"
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  List, ListOrdered, Minus, Table as TableIcon, FileText, Heading1, Heading2, Heading3,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"

type CustomEditor = BaseEditor & ReactEditor & HistoryEditor

// We do not augment Slate's module declaration globally to avoid colliding with
// future editors. Instead, we cast as needed at the call site.
type CustomElement = {
  type: string
  children: CustomDescendant[]
  variable?: string
  indent?: number
}
type CustomText = {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
}
type CustomDescendant = CustomElement | CustomText

// Slate editor defaults to a single empty paragraph if no content provided
export const EMPTY_DOC: Descendant[] = [
  { type: "p", children: [{ text: "" }] } as unknown as Descendant,
]

type FormatKey = "bold" | "italic" | "underline" | "strikethrough"

function isMarkActive(editor: Editor, format: FormatKey): boolean {
  const marks = Editor.marks(editor) as Partial<Record<FormatKey, boolean>> | null
  return marks ? !!marks[format] : false
}

function toggleMark(editor: Editor, format: FormatKey): void {
  const isActive = isMarkActive(editor, format)
  if (isActive) Editor.removeMark(editor, format)
  else Editor.addMark(editor, format, true)
}

function isBlockActive(editor: Editor, type: string): boolean {
  const { selection } = editor
  if (!selection) return false
  const [match] = Array.from(
    Editor.nodes(editor, {
      at: Editor.unhangRange(editor, selection),
      match: (n) => SlateElement.isElement(n) && (n as CustomElement).type === type,
    }),
  )
  return !!match
}

const LIST_TYPES = new Set(["ol", "ul"])

function toggleBlock(editor: Editor, type: string): void {
  const isActive = isBlockActive(editor, type)
  const isList = LIST_TYPES.has(type)

  Transforms.unwrapNodes(editor, {
    match: (n) => SlateElement.isElement(n) && LIST_TYPES.has((n as CustomElement).type),
    split: true,
  })

  const newType = isActive ? "p" : isList ? "li" : type
  Transforms.setNodes(editor, { type: newType } as Partial<SlateElement>, {
    match: (n) => SlateElement.isElement(n),
  })

  if (!isActive && isList) {
    Transforms.wrapNodes(editor, { type, children: [] } as unknown as SlateElement)
  }
}

function insertHorizontalRule(editor: Editor): void {
  Transforms.insertNodes(editor, [
    { type: "hr", children: [{ text: "" }] } as unknown as SlateElement,
    { type: "p", children: [{ text: "" }] } as unknown as SlateElement,
  ])
}

function insertSimpleTable(editor: Editor): void {
  const cell = (text = ""): SlateElement =>
    ({
      type: "td",
      children: [{ type: "p", children: [{ text }] }],
    }) as unknown as SlateElement
  const row = (): SlateElement =>
    ({
      type: "tr",
      children: [cell(), cell()],
    }) as unknown as SlateElement
  const table: SlateElement = {
    type: "table",
    children: [row(), row()],
  } as unknown as SlateElement
  Transforms.insertNodes(editor, table)
}

function insertVariableNode(editor: Editor, name: string): void {
  if (!name) return
  const node: SlateElement = {
    type: "template_variable",
    variable: name,
    children: [{ text: "" }],
  } as unknown as SlateElement
  Transforms.insertNodes(editor, node)
  // Move past the inserted void inline.
  Transforms.move(editor, { unit: "offset" })
}

// ─── Renderers ────────────────────────────────────────────────────────────────

function VariableChip({ name }: { name: string }) {
  return (
    <span
      contentEditable={false}
      className="bg-indigo-100 text-indigo-800 text-sm font-medium px-2 py-0.5 rounded inline-flex items-center"
    >
      {`{{${name}}}`}
    </span>
  )
}

function renderElement(props: RenderElementProps): React.ReactElement {
  const { attributes, children, element } = props
  const el = element as unknown as CustomElement
  const indentStyle = el.indent ? { marginLeft: `${(el.indent - 1) * 24}px` } : undefined
  switch (el.type) {
    case "h1":
      return (
        <h1 {...attributes} className="text-2xl font-bold mt-4 mb-2">
          {children}
        </h1>
      )
    case "h2":
      return (
        <h2 {...attributes} className="text-xl font-bold mt-3 mb-2">
          {children}
        </h2>
      )
    case "h3":
      return (
        <h3 {...attributes} className="text-lg font-bold mt-3 mb-1.5">
          {children}
        </h3>
      )
    case "ol":
      return (
        <ol {...attributes} className="list-decimal pl-6 my-2" style={indentStyle}>
          {children}
        </ol>
      )
    case "ul":
      return (
        <ul {...attributes} className="list-disc pl-6 my-2" style={indentStyle}>
          {children}
        </ul>
      )
    case "li":
      return (
        <li {...attributes} className="my-1">
          {children}
        </li>
      )
    case "table":
      return (
        <table {...attributes} className="border border-zinc-300 my-3 w-full">
          <tbody>{children}</tbody>
        </table>
      )
    case "tr":
      return <tr {...attributes}>{children}</tr>
    case "td":
      return (
        <td {...attributes} className="border border-zinc-300 px-2 py-1.5 align-top">
          {children}
        </td>
      )
    case "th":
      return (
        <th {...attributes} className="border border-zinc-300 px-2 py-1.5 align-top font-semibold bg-zinc-50">
          {children}
        </th>
      )
    case "hr":
      return (
        <div {...attributes} contentEditable={false} className="my-4 border-t border-zinc-300">
          {children}
        </div>
      )
    case "template_variable":
      return (
        <span {...attributes}>
          <VariableChip name={el.variable ?? ""} />
          {children}
        </span>
      )
    case "p":
    default:
      return (
        <p {...attributes} className="my-2 leading-6">
          {children}
        </p>
      )
  }
}

function renderLeaf(props: RenderLeafProps): React.ReactElement {
  const { attributes, children, leaf } = props
  let el: React.ReactNode = children
  const t = leaf as unknown as CustomText
  if (t.bold) el = <strong>{el}</strong>
  if (t.italic) el = <em>{el}</em>
  if (t.underline) el = <u>{el}</u>
  if (t.strikethrough) el = <s>{el}</s>
  return <span {...attributes}>{el}</span>
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface ContractEditorProps {
  contractId?: string                    // required for non-template usage
  initialContent: Descendant[]
  initialVersion: number
  readOnly?: boolean
  readOnlyReason?: string
  showVariablesPanel?: boolean
  variables?: { name: string; label?: string; required?: boolean }[]
  onChange?: (value: Descendant[], wordCount: number) => void
  rightActions?: React.ReactNode        // extra toolbar actions
  // Auto-save mode: only enabled when contractId is provided
  enableAutoSave?: boolean
}

export function ContractEditor({
  contractId,
  initialContent,
  initialVersion,
  readOnly = false,
  readOnlyReason,
  showVariablesPanel,
  variables = [],
  onChange,
  rightActions,
  enableAutoSave = true,
}: ContractEditorProps): React.ReactElement {
  const editor = useMemo<CustomEditor>(() => {
    const e = withTemplateVariableInline(withHistory(withReact(createEditor() as unknown as ReactEditor)))
    return e as unknown as CustomEditor
  }, [])
  const [value, setValue] = useState<Descendant[]>(
    initialContent.length > 0 ? initialContent : EMPTY_DOC,
  )
  const [version, setVersion] = useState<number>(initialVersion)
  const pendingSaveRef = useRef(false)
  const pendingRetryRef = useRef(false)
  const [isReadOnly, setIsReadOnly] = useState(readOnly)
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saved" | "unsaved" | "saving" | "conflict" | "error"
    // "idle" = no edits yet and no document on server (version 0)
    // "saved" = document exists and is in sync
  >(initialVersion > 0 ? "saved" : "idle")
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const valueRef = useRef<Descendant[]>(value)
  valueRef.current = value
  const versionRef = useRef<number>(version)
  versionRef.current = version

  useEffect(() => {
    setIsReadOnly(readOnly)
  }, [readOnly])

  const wordCount = useMemo(() => countDescendantWords(value), [value])

  const triggerSave = useCallback(async () => {
    if (!contractId || !enableAutoSave) return
    if (pendingSaveRef.current) { pendingRetryRef.current = true; return }
    if (isReadOnly) return
    pendingSaveRef.current = true
    setSaveStatus("saving")
    try {
      const res = await fetch(`/api/contracts/${contractId}/document`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: valueRef.current,
          wordCount: countDescendantWords(valueRef.current),
          clientVersion: versionRef.current,
        }),
      })
      if (res.status === 409) {
        setSaveStatus("conflict")
        toast.error("Document updated elsewhere — reload to see the latest version.")
        return
      }
      if (res.status === 422) {
        const body = await res.json().catch(() => ({}))
        if (body.error === "read_only_status") {
          setIsReadOnly(true)
          toast.error("This contract is now read-only.")
        } else {
          setSaveStatus("error")
          toast.error("Auto-save failed.")
        }
        return
      }
      if (!res.ok) {
        setSaveStatus("error")
        toast.error("Auto-save failed. Your changes are not saved.")
        return
      }
      const body = await res.json()
      if (body.document?.version) {
        setVersion(body.document.version)
      }
      setSaveStatus("saved")
    } catch (err) {
      console.error("[editor] save failed:", err)
      setSaveStatus("error")
      toast.error("Auto-save failed. Your changes are not saved.")
    } finally {
      pendingSaveRef.current = false
      if (pendingRetryRef.current) {
        pendingRetryRef.current = false
        triggerSave()
      }
    }
  }, [contractId, enableAutoSave, isReadOnly])

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (saveStatus === "unsaved" || saveStatus === "saving") {
        e.preventDefault()
        e.returnValue = ""
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [saveStatus])

  const handleChange = useCallback(
    (next: Descendant[]) => {
      setValue(next)
      onChange?.(next, countDescendantWords(next))

      // Detect content vs selection-only change
      const isAstChange = editor.operations.some((op) => op.type !== "set_selection")
      if (!isAstChange) return
      if (isReadOnly) return

      setSaveStatus("unsaved")

      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (enableAutoSave && contractId) {
        saveTimer.current = setTimeout(() => {
          triggerSave()
        }, 3_000)
      }
    },
    [editor, onChange, isReadOnly, enableAutoSave, contractId, triggerSave],
  )

  const handleBlur = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    if (enableAutoSave && contractId && !isReadOnly && saveStatus === "unsaved") {
      triggerSave()
    }
  }, [enableAutoSave, contractId, isReadOnly, saveStatus, triggerSave])

  const onKeyDown: React.KeyboardEventHandler<HTMLDivElement> = useCallback(
    (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey) {
        if (e.key === "b") { e.preventDefault(); toggleMark(editor, "bold"); return }
        if (e.key === "i") { e.preventDefault(); toggleMark(editor, "italic"); return }
        if (e.key === "u") { e.preventDefault(); toggleMark(editor, "underline"); return }
        if (e.key === "s") { e.preventDefault(); triggerSave(); return }
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
        if (e.key === "s" || e.key === "S") { e.preventDefault(); toggleMark(editor, "strikethrough"); return }
      }
    },
    [editor, triggerSave],
  )

  // Recomputes only when document content or selection changes, not on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const headingValue = useMemo(() => {
    if (isBlockActive(editor, "h1")) return "h1"
    if (isBlockActive(editor, "h2")) return "h2"
    if (isBlockActive(editor, "h3")) return "h3"
    return "p"
  // editor.selection is a plain object; including `value` ensures we re-check
  // when the document structure changes too.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.selection, value])

  return (
    <div className="flex flex-col gap-3">
      {isReadOnly && readOnlyReason && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 rounded text-sm">
          {readOnlyReason}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 pb-2">
        {!isReadOnly && (
          <>
            <Select
              value={headingValue}
              onValueChange={(v) => v && toggleBlock(editor, v)}
            >
              <SelectTrigger className="h-8 w-32 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="p">Normal</SelectItem>
                <SelectItem value="h1">
                  <span className="inline-flex items-center gap-1.5"><Heading1 className="size-3.5" /> H1</span>
                </SelectItem>
                <SelectItem value="h2">
                  <span className="inline-flex items-center gap-1.5"><Heading2 className="size-3.5" /> H2</span>
                </SelectItem>
                <SelectItem value="h3">
                  <span className="inline-flex items-center gap-1.5"><Heading3 className="size-3.5" /> H3</span>
                </SelectItem>
              </SelectContent>
            </Select>

            <ToolbarButton
              active={isMarkActive(editor, "bold")}
              onMouseDown={(e) => { e.preventDefault(); toggleMark(editor, "bold") }}
              title="Bold (Cmd+B)"
            >
              <Bold className="size-4" />
            </ToolbarButton>
            <ToolbarButton
              active={isMarkActive(editor, "italic")}
              onMouseDown={(e) => { e.preventDefault(); toggleMark(editor, "italic") }}
              title="Italic (Cmd+I)"
            >
              <Italic className="size-4" />
            </ToolbarButton>
            <ToolbarButton
              active={isMarkActive(editor, "underline")}
              onMouseDown={(e) => { e.preventDefault(); toggleMark(editor, "underline") }}
              title="Underline (Cmd+U)"
            >
              <UnderlineIcon className="size-4" />
            </ToolbarButton>
            <ToolbarButton
              active={isMarkActive(editor, "strikethrough")}
              onMouseDown={(e) => { e.preventDefault(); toggleMark(editor, "strikethrough") }}
              title="Strikethrough (Cmd+Shift+S)"
            >
              <Strikethrough className="size-4" />
            </ToolbarButton>

            <span className="w-px h-5 bg-zinc-200 mx-1" />

            <ToolbarButton
              active={isBlockActive(editor, "ol")}
              onMouseDown={(e) => { e.preventDefault(); toggleBlock(editor, "ol") }}
              title="Ordered list"
            >
              <ListOrdered className="size-4" />
            </ToolbarButton>
            <ToolbarButton
              active={isBlockActive(editor, "ul")}
              onMouseDown={(e) => { e.preventDefault(); toggleBlock(editor, "ul") }}
              title="Bulleted list"
            >
              <List className="size-4" />
            </ToolbarButton>

            <span className="w-px h-5 bg-zinc-200 mx-1" />

            <ToolbarButton
              onMouseDown={(e) => { e.preventDefault(); insertSimpleTable(editor) }}
              title="Insert table"
            >
              <TableIcon className="size-4" />
            </ToolbarButton>
            <ToolbarButton
              onMouseDown={(e) => { e.preventDefault(); insertHorizontalRule(editor) }}
              title="Horizontal rule"
            >
              <Minus className="size-4" />
            </ToolbarButton>
          </>
        )}

        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-zinc-500 tabular-nums">
            {wordCount.toLocaleString()} words
          </span>
          <SaveStatusLabel status={saveStatus} />
          {rightActions}
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className={cn("rounded-md border border-zinc-200 bg-white p-4 min-h-[400px]", showVariablesPanel ? "col-span-9" : "col-span-12")}>
          {(() => {
            if (value.length === 0 && !isReadOnly) {
              return (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <FileText className="size-10 text-zinc-300" />
                  <p className="text-sm text-zinc-500">
                    Start writing your contract, or import a Word document.
                  </p>
                </div>
              )
            }
            return null
          })()}
          <Slate editor={editor as unknown as ReactEditor} initialValue={value} onChange={handleChange}>
            <Editable
              readOnly={isReadOnly}
              renderElement={renderElement}
              renderLeaf={renderLeaf}
              onKeyDown={onKeyDown}
              onBlur={handleBlur}
              spellCheck
              placeholder={isReadOnly ? undefined : "Start writing…"}
              className="outline-none min-h-[400px] text-sm text-zinc-900"
            />
          </Slate>
        </div>

        {showVariablesPanel && (
          <div className="col-span-3 rounded-md border border-zinc-200 bg-white p-3 space-y-2 max-h-[600px] overflow-y-auto">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Variables</p>
            {variables.length === 0 && (
              <p className="text-xs text-zinc-500">No variables declared yet.</p>
            )}
            {variables.map((v) => (
              <div key={v.name} className="rounded border border-zinc-200 px-2 py-1.5 text-xs flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-zinc-900 truncate">{v.label ?? v.name}</p>
                  <p className="text-zinc-500 truncate">{v.name}{v.required ? " *" : ""}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 text-xs px-2 shrink-0"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    insertVariableNode(editor, v.name)
                  }}
                >
                  Insert
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ToolbarButton({
  active,
  onMouseDown,
  title,
  children,
}: {
  active?: boolean
  onMouseDown: React.MouseEventHandler<HTMLButtonElement>
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={onMouseDown}
      className={cn(
        "h-8 w-8 inline-flex items-center justify-center rounded text-zinc-700 hover:bg-zinc-100",
        active && "bg-zinc-100 text-indigo-600",
      )}
    >
      {children}
    </button>
  )
}

function SaveStatusLabel({ status }: { status: string }) {
  if (status === "idle") return null
  if (status === "saved") return <span className="text-sm text-zinc-400">Saved</span>
  if (status === "unsaved") return <span className="text-sm text-amber-600">Unsaved changes</span>
  if (status === "saving") return <span className="text-sm text-zinc-400">Saving…</span>
  if (status === "conflict") return <span className="text-sm text-red-600">Conflict — reload to sync</span>
  if (status === "error") return <span className="text-sm text-red-600">Save failed</span>
  return null
}

// Plugin: mark `template_variable` as inline + void
function withTemplateVariableInline<T extends ReactEditor>(editor: T): T {
  const { isInline, isVoid } = editor
  editor.isInline = (el) => {
    if (SlateElement.isElement(el) && (el as unknown as CustomElement).type === "template_variable") {
      return true
    }
    return isInline(el)
  }
  editor.isVoid = (el) => {
    if (SlateElement.isElement(el) && (el as unknown as CustomElement).type === "template_variable") {
      return true
    }
    return isVoid(el)
  }
  return editor
}

function countDescendantWords(nodes: Descendant[]): number {
  let buf = ""
  function walk(n: Descendant): void {
    if (Text.isText(n)) {
      buf += " " + n.text
      return
    }
    if (SlateElement.isElement(n)) {
      const el = n as unknown as CustomElement
      if (el.type === "template_variable") {
        buf += ` {{${el.variable ?? ""}}} `
        return
      }
      for (const c of el.children) walk(c as Descendant)
    }
  }
  for (const n of nodes) walk(n)
  return buf.split(/\s+/).filter(Boolean).length
}

// Helper to surface NodeEntry type used elsewhere — avoids import-level error
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _NodeEntry = NodeEntry

// Range used by Slate selection — ensure we're exporting the import so tsc keeps it.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _Range = Range

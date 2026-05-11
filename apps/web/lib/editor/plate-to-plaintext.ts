// TipTap JSON → plain text.
// Also accepts the legacy Slate array format (detected by Array.isArray).
// Used for AI extraction and word counting.

import type { TipTapDoc } from "./tiptap-types"

interface AnyNode {
  type?: string
  text?: string
  content?: unknown[]
  children?: unknown[]  // legacy Slate field
  attrs?: Record<string, unknown>
  variable?: string     // legacy Slate template_variable field
}

// ─── TipTap traversal ─────────────────────────────────────────────────────────

function visitTipTap(node: unknown, buf: string[]): void {
  if (!node || typeof node !== "object") return
  const n = node as AnyNode
  const type = n.type ?? ""

  // Text node (ProseMirror leaf)
  if (type === "text" && typeof n.text === "string") {
    buf.push(n.text)
    return
  }

  // Template variable inline node
  if (type === "templateVariable") {
    const variable = (n.attrs?.variable as string | undefined) ?? ""
    buf.push(`{{${variable}}}`)
    return
  }

  // Paragraph / heading — add double newline after
  if (type === "paragraph" || type === "heading") {
    if (Array.isArray(n.content)) {
      for (const c of n.content) visitTipTap(c, buf)
    }
    buf.push("\n\n")
    return
  }

  // List item — bullet prefix + newline
  if (type === "listItem") {
    buf.push("• ")
    if (Array.isArray(n.content)) {
      for (const c of n.content) visitTipTap(c, buf)
    }
    buf.push("\n")
    return
  }

  // Horizontal rule
  if (type === "horizontalRule") {
    buf.push("\n---\n")
    return
  }

  // Table / row
  if (type === "table" || type === "tableRow") {
    if (Array.isArray(n.content)) {
      for (const c of n.content) visitTipTap(c, buf)
    }
    buf.push("\n")
    return
  }

  // Table cell / header — tab-separated
  if (type === "tableCell" || type === "tableHeader") {
    if (Array.isArray(n.content)) {
      for (const c of n.content) visitTipTap(c, buf)
    }
    buf.push("\t")
    return
  }

  // Anything else with children: recurse
  if (Array.isArray(n.content)) {
    for (const c of n.content) visitTipTap(c, buf)
  }
}

// ─── Legacy Slate traversal (for backward compat with old DB rows) ────────────

function visitSlate(node: unknown, buf: string[]): void {
  if (!node || typeof node !== "object") return
  const n = node as AnyNode

  // Text leaf
  if (typeof n.text === "string") {
    buf.push(n.text)
    return
  }

  // Template variable inline node (old Slate format)
  if (n.type === "template_variable" && typeof n.variable === "string") {
    buf.push(`{{${n.variable}}}`)
    return
  }

  const type = n.type ?? ""

  if (type === "li") {
    buf.push("• ")
    if (Array.isArray(n.children)) {
      for (const c of n.children) visitSlate(c, buf)
    }
    buf.push("\n")
    return
  }

  if (type === "hr") {
    buf.push("\n---\n")
    return
  }

  if (type === "h1" || type === "h2" || type === "h3" || type === "p") {
    if (Array.isArray(n.children)) {
      for (const c of n.children) visitSlate(c, buf)
    }
    buf.push("\n\n")
    return
  }

  if (type === "table" || type === "tr") {
    if (Array.isArray(n.children)) {
      for (const c of n.children) visitSlate(c, buf)
    }
    buf.push("\n")
    return
  }

  if (type === "td" || type === "th") {
    if (Array.isArray(n.children)) {
      for (const c of n.children) visitSlate(c, buf)
    }
    buf.push("\t")
    return
  }

  if (Array.isArray(n.children)) {
    for (const c of n.children) visitSlate(c, buf)
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Convert TipTap or legacy Slate JSON to a plain-text string.
 * Detects format by shape: TipTap doc has `{ type: "doc", content: [...] }`;
 * Slate uses a top-level array.
 */
export function plateToPlaintext(doc: unknown): string {
  const buf: string[] = []

  if (Array.isArray(doc)) {
    // Legacy Slate array
    for (const n of doc) visitSlate(n, buf)
  } else if (doc && typeof doc === "object") {
    const d = doc as AnyNode
    if (d.type === "doc" && Array.isArray(d.content)) {
      // TipTap doc object
      for (const n of d.content) visitTipTap(n, buf)
    }
  }

  return buf.join("").trim()
}

export function countWords(plaintext: string): number {
  if (!plaintext) return 0
  return plaintext.split(/\s+/).filter((t) => t.length > 0).length
}

/**
 * Plain text → minimal TipTap doc.
 * Used when importing a PDF (plain-text extraction only, no formatting).
 * Double newlines are paragraph separators.
 *
 * The function name is kept as `plaintextToPlateNodes` for backward compatibility
 * with worker.ts imports, but it now returns a TipTap doc object.
 */
export function plaintextToPlateNodes(text: string): TipTapDoc {
  if (!text) {
    return { type: "doc", content: [{ type: "paragraph", content: [] }] }
  }

  const paragraphs = text
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)

  if (paragraphs.length === 0) {
    return { type: "doc", content: [{ type: "paragraph", content: [] }] }
  }

  return {
    type: "doc",
    content: paragraphs.map((p) => ({
      type: "paragraph",
      content: [{ type: "text", text: p }],
    })),
  }
}

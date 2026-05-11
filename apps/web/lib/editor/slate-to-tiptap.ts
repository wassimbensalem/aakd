// Migration helper: converts legacy Slate/Plate JSON (array format) to TipTap
// ProseMirror JSON (object format with type: "doc").
//
// Used at runtime in contract-editor.tsx when initialContent is an array (old format),
// and by the migration script scripts/migrate-editor-to-tiptap.ts.

import type { TipTapDoc, TipTapNode, TipTapMark } from "./tiptap-types"

// ─── Slate leaf / element types (what's stored in DB currently) ───────────────

interface SlateLeaf {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  fontSize?: string
  color?: string
  highlight?: string
}

interface SlateElement {
  type: string
  children: SlateNode[]
  variable?: string
  indent?: number
  align?: string
  url?: string
  alt?: string
}

type SlateNode = SlateLeaf | SlateElement

function isTextLeaf(n: unknown): n is SlateLeaf {
  return !!n && typeof n === "object" && "text" in (n as object)
}

// ─── Text leaf → TipTap marks ─────────────────────────────────────────────────

function leafMarks(leaf: SlateLeaf): TipTapMark[] {
  const marks: TipTapMark[] = []
  if (leaf.bold) marks.push({ type: "bold" })
  if (leaf.italic) marks.push({ type: "italic" })
  if (leaf.underline) marks.push({ type: "underline" })
  if (leaf.strikethrough) marks.push({ type: "strike" })
  // fontSize and color both go into the textStyle mark's attrs
  if (leaf.fontSize || leaf.color) {
    const attrs: Record<string, string> = {}
    if (leaf.fontSize) attrs.fontSize = leaf.fontSize
    if (leaf.color) attrs.color = leaf.color
    marks.push({ type: "textStyle", attrs })
  }
  if (leaf.highlight) {
    marks.push({ type: "highlight", attrs: { color: leaf.highlight } })
  }
  return marks
}

// ─── Convert a single Slate node → TipTap node(s) ────────────────────────────
//
// Returns an array because some Slate constructs (e.g. list items inside ul/ol)
// expand into multiple TipTap nodes.

function convertNode(n: SlateNode): TipTapNode[] {
  if (isTextLeaf(n)) {
    const marks = leafMarks(n)
    const node: TipTapNode = { type: "text", text: n.text }
    if (marks.length > 0) node.marks = marks
    return [node]
  }

  const el = n as SlateElement
  const align = el.align
  const alignAttrs = align ? { textAlign: align } : {}

  switch (el.type) {
    // ── Headings ──────────────────────────────────────────────────────────────
    case "h1":
    case "h2":
    case "h3": {
      const level = el.type === "h1" ? 1 : el.type === "h2" ? 2 : 3
      return [{
        type: "heading",
        attrs: { level, ...alignAttrs },
        content: convertChildren(el.children),
      }]
    }

    // ── Paragraph ─────────────────────────────────────────────────────────────
    case "p": {
      return [{
        type: "paragraph",
        attrs: Object.keys(alignAttrs).length > 0 ? alignAttrs : undefined,
        content: convertChildren(el.children),
      }]
    }

    // ── Unordered list ────────────────────────────────────────────────────────
    case "ul": {
      return [{
        type: "bulletList",
        content: convertListItems(el.children, "bulletList"),
      }]
    }

    // ── Ordered list ──────────────────────────────────────────────────────────
    case "ol": {
      return [{
        type: "orderedList",
        content: convertListItems(el.children, "orderedList"),
      }]
    }

    // ── List item (standalone — shouldn't appear outside ul/ol but handle gracefully) ──
    case "li": {
      return [convertListItem(el)]
    }

    // ── Table ─────────────────────────────────────────────────────────────────
    case "table": {
      return [{
        type: "table",
        content: el.children.flatMap(convertNode),
      }]
    }

    case "tr": {
      return [{
        type: "tableRow",
        content: el.children.flatMap(convertNode),
      }]
    }

    case "td": {
      return [{
        type: "tableCell",
        attrs: {},
        content: wrapCellContent(el.children),
      }]
    }

    case "th": {
      return [{
        type: "tableHeader",
        attrs: {},
        content: wrapCellContent(el.children),
      }]
    }

    // ── Horizontal rule ───────────────────────────────────────────────────────
    case "hr": {
      return [{ type: "horizontalRule" }]
    }

    // ── Link (Slate stored links as block-like elements in some configs) ───────
    case "a": {
      // In Slate the link wraps text children; in TipTap links are marks on text nodes.
      // Convert children and add the link mark to each text node.
      const href = el.url ?? ""
      const converted = convertChildren(el.children)
      return converted.map((child) => {
        if (child.type === "text") {
          const marks = [...(child.marks ?? []), { type: "link", attrs: { href } }]
          return { ...child, marks }
        }
        return child
      })
    }

    // ── Image ─────────────────────────────────────────────────────────────────
    case "image": {
      return [{
        type: "image",
        attrs: { src: el.url ?? "", alt: el.alt ?? "" },
      }]
    }

    // ── Template variable ─────────────────────────────────────────────────────
    case "template_variable": {
      return [{
        type: "templateVariable",
        attrs: { variable: el.variable ?? "" },
      }]
    }

    // ── Unknown / fallback → paragraph ───────────────────────────────────────
    default: {
      const children = el.children ? convertChildren(el.children) : []
      return [{
        type: "paragraph",
        attrs: Object.keys(alignAttrs).length > 0 ? alignAttrs : undefined,
        content: children.length > 0 ? children : undefined,
      }]
    }
  }
}

// ─── Convert an array of Slate children → TipTap content ─────────────────────

function convertChildren(children: SlateNode[]): TipTapNode[] {
  if (!Array.isArray(children) || children.length === 0) return []
  return children.flatMap(convertNode)
}

// ─── Convert ul/ol children (li nodes) → TipTap listItem nodes ───────────────

function convertListItems(children: SlateNode[], _parentType: string): TipTapNode[] {
  return children.flatMap((child) => {
    if (isTextLeaf(child)) return []
    const el = child as SlateElement
    if (el.type === "li") return [convertListItem(el)]
    // If somehow a nested ul/ol appears, convert it directly
    return convertNode(el)
  })
}

function convertListItem(el: SlateElement): TipTapNode {
  // TipTap listItem must wrap content in a paragraph.
  // Slate li children are text leaves or inline elements — wrap them.
  const childNodes = el.children ?? []
  const hasOnlyLeaves = childNodes.every(isTextLeaf)

  let content: TipTapNode[]
  if (hasOnlyLeaves) {
    content = [{
      type: "paragraph",
      content: convertChildren(childNodes),
    }]
  } else {
    // Mixed: some block children (nested lists), some inline
    const inlineItems: SlateNode[] = []
    const blockItems: TipTapNode[] = []
    for (const c of childNodes) {
      if (isTextLeaf(c)) {
        inlineItems.push(c)
      } else {
        const el2 = c as SlateElement
        if (el2.type === "ul" || el2.type === "ol" || el2.type === "li") {
          blockItems.push(...convertNode(el2))
        } else {
          inlineItems.push(c)
        }
      }
    }
    const inlineConverted = convertChildren(inlineItems)
    content = []
    if (inlineConverted.length > 0) {
      content.push({ type: "paragraph", content: inlineConverted })
    }
    content.push(...blockItems)
  }

  return {
    type: "listItem",
    content,
  }
}

// ─── Wrap table cell children (Slate td/th children may be p nodes or leaves) ─

function wrapCellContent(children: SlateNode[]): TipTapNode[] {
  if (!Array.isArray(children) || children.length === 0) {
    return [{ type: "paragraph", content: [] }]
  }

  // If children are all text leaves, wrap them in a single paragraph
  const allLeaves = children.every(isTextLeaf)
  if (allLeaves) {
    return [{
      type: "paragraph",
      content: convertChildren(children),
    }]
  }

  // If children are already block nodes (like p), convert them
  const out: TipTapNode[] = []
  for (const child of children) {
    if (isTextLeaf(child)) {
      // Wrap stray leaves
      out.push({ type: "paragraph", content: convertChildren([child]) })
    } else {
      out.push(...convertNode(child))
    }
  }
  return out.length > 0 ? out : [{ type: "paragraph", content: [] }]
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Convert a Slate/Plate JSON array (old format) to a TipTap ProseMirror doc.
 * Safe to call with any unknown[]; invalid nodes are skipped gracefully.
 */
export function slateToTiptap(nodes: unknown[]): TipTapDoc {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return { type: "doc", content: [{ type: "paragraph", content: [] }] }
  }

  const content: TipTapNode[] = []
  for (const n of nodes) {
    if (!n || typeof n !== "object") continue
    try {
      content.push(...convertNode(n as SlateNode))
    } catch {
      // Skip malformed nodes
    }
  }

  if (content.length === 0) {
    return { type: "doc", content: [{ type: "paragraph", content: [] }] }
  }

  return { type: "doc", content }
}

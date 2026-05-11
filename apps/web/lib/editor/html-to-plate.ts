// HTML → TipTap ProseMirror JSON.
// Uses @xmldom/xmldom (already installed) for HTML parsing.
// Export names are preserved for backward compat with worker.ts:
//   htmlToPlateNodes   — primary alias, returns TipTapDoc
//   htmlToTiptapDoc    — canonical name

import { DOMParser } from "@xmldom/xmldom"
import type { TipTapDoc, TipTapNode, TipTapMark } from "./tiptap-types"

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MAX_NESTING_DEPTH = 6

const HEADING_MAP: Record<string, number> = { h1: 1, h2: 2, h3: 3 }

interface InlineMarks {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isElementNode(n: any): boolean {
  return !!n && typeof n === "object" && n.nodeType === 1
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isTextNode(n: any): boolean {
  return !!n && typeof n === "object" && n.nodeType === 3
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tagName(node: any): string {
  return ((node.tagName ?? node.nodeName ?? "") as string).toLowerCase()
}

function makeTextNode(text: string, marks: InlineMarks, href?: string): TipTapNode {
  const builtMarks: TipTapMark[] = []
  if (marks.bold) builtMarks.push({ type: "bold" })
  if (marks.italic) builtMarks.push({ type: "italic" })
  if (marks.underline) builtMarks.push({ type: "underline" })
  if (marks.strikethrough) builtMarks.push({ type: "strike" })
  if (href) builtMarks.push({ type: "link", attrs: { href } })

  const node: TipTapNode = { type: "text", text }
  if (builtMarks.length > 0) node.marks = builtMarks
  return node
}

// ─── Collect inline children → TipTap text nodes with marks ──────────────────

function collectInline(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node: any,
  marks: InlineMarks,
  out: TipTapNode[],
  href?: string,
): void {
  const childNodes = node.childNodes
  if (!childNodes) return
  for (let i = 0; i < childNodes.length; i++) {
    const child = childNodes[i]
    if (isTextNode(child)) {
      const text: string = child.nodeValue ?? ""
      if (text.length > 0) out.push(makeTextNode(text, marks, href))
      continue
    }
    if (!isElementNode(child)) continue
    const tag = tagName(child)
    if (tag === "br") {
      out.push(makeTextNode("\n", marks, href))
      continue
    }
    if (tag === "strong" || tag === "b") {
      collectInline(child, { ...marks, bold: true }, out, href)
      continue
    }
    if (tag === "em" || tag === "i") {
      collectInline(child, { ...marks, italic: true }, out, href)
      continue
    }
    if (tag === "u") {
      collectInline(child, { ...marks, underline: true }, out, href)
      continue
    }
    if (tag === "s" || tag === "del" || tag === "strike") {
      collectInline(child, { ...marks, strikethrough: true }, out, href)
      continue
    }
    if (tag === "a") {
      const childHref: string = child.getAttribute?.("href") ?? ""
      collectInline(child, marks, out, childHref || href)
      continue
    }
    if (tag === "img") {
      const src: string = child.getAttribute?.("src") ?? ""
      const alt: string = child.getAttribute?.("alt") ?? ""
      if (src) out.push({ type: "image", attrs: { src, alt } })
      continue
    }
    // Any other inline element: recurse with current marks
    collectInline(child, marks, out, href)
  }
}

function inlineContent(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node: any,
): TipTapNode[] {
  const nodes: TipTapNode[] = []
  collectInline(node, {}, nodes)
  if (nodes.length === 0) nodes.push({ type: "text", text: "" })
  return nodes
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function elementChildren(node: any): any[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: any[] = []
  const childNodes = node.childNodes
  if (!childNodes) return out
  for (let i = 0; i < childNodes.length; i++) {
    if (isElementNode(childNodes[i])) out.push(childNodes[i])
  }
  return out
}

// ─── List processing ──────────────────────────────────────────────────────────

function processList(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listEl: any,
  type: "ul" | "ol",
  depth: number,
): TipTapNode {
  const listType = type === "ul" ? "bulletList" : "orderedList"
  const items: TipTapNode[] = []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const liElements = elementChildren(listEl).filter((c: any) => tagName(c) === "li")

  for (const li of liElements) {
    // Separate inline content from nested lists
    const inlineItems: TipTapNode[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nestedLists: any[] = []

    if (li.childNodes) {
      for (let i = 0; i < li.childNodes.length; i++) {
        const child = li.childNodes[i]
        if (isElementNode(child)) {
          const t = tagName(child)
          if (t === "ol" || t === "ul") {
            nestedLists.push(child)
            continue
          }
        }
        if (isTextNode(child)) {
          const text: string = child.nodeValue ?? ""
          if (text.length > 0) inlineItems.push(makeTextNode(text, {}))
        } else if (isElementNode(child)) {
          collectInline(child, {}, inlineItems)
        }
      }
    }

    if (inlineItems.length === 0) inlineItems.push({ type: "text", text: "" })

    const listItemContent: TipTapNode[] = [
      { type: "paragraph", content: inlineItems },
    ]

    if (nestedLists.length > 0 && depth < MAX_NESTING_DEPTH) {
      for (const nested of nestedLists) {
        const nt = tagName(nested) as "ol" | "ul"
        listItemContent.push(processList(nested, nt, depth + 1))
      }
    }

    items.push({ type: "listItem", content: listItemContent })
  }

  if (items.length === 0) {
    items.push({
      type: "listItem",
      content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }],
    })
  }

  return { type: listType, content: items }
}

// ─── Table processing ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function processTable(tableEl: any): TipTapNode {
  const rows: TipTapNode[] = []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function visitTable(el: any): void {
    for (const child of elementChildren(el)) {
      const t = tagName(child)
      if (t === "tr") {
        const cells: TipTapNode[] = []
        const cellEls = elementChildren(child).filter(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (x: any) => tagName(x) === "td" || tagName(x) === "th",
        )
        for (const cell of cellEls) {
          const cellType = tagName(cell) === "th" ? "tableHeader" : "tableCell"
          cells.push({
            type: cellType,
            attrs: {},
            content: [{ type: "paragraph", content: inlineContent(cell) }],
          })
        }
        if (cells.length === 0) {
          cells.push({
            type: "tableCell",
            attrs: {},
            content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }],
          })
        }
        rows.push({ type: "tableRow", content: cells })
      } else if (t === "tbody" || t === "thead" || t === "tfoot") {
        visitTable(child)
      }
    }
  }

  visitTable(tableEl)

  if (rows.length === 0) {
    rows.push({
      type: "tableRow",
      content: [{
        type: "tableCell",
        attrs: {},
        content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }],
      }],
    })
  }

  return { type: "table", content: rows }
}

// ─── Block processing ─────────────────────────────────────────────────────────

const BLOCK_TAGS = new Set([
  "root", "body", "html", "div", "section", "article", "main", "header", "footer",
])

const WRAPPER_TAGS_THAT_RECURSE_AS_SIBLINGS = BLOCK_TAGS

function processBlock(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  el: any,
  out: TipTapNode[],
  depth: number,
): void {
  const tag = tagName(el)

  // Heading
  const headingLevel = HEADING_MAP[tag]
  if (headingLevel !== undefined) {
    out.push({ type: "heading", attrs: { level: headingLevel }, content: inlineContent(el) })
    return
  }

  if (tag === "p") {
    out.push({ type: "paragraph", content: inlineContent(el) })
    return
  }

  if (tag === "ul" || tag === "ol") {
    out.push(processList(el, tag, depth + 1))
    return
  }

  if (tag === "table") {
    out.push(processTable(el))
    return
  }

  if (tag === "hr") {
    out.push({ type: "horizontalRule" })
    return
  }

  if (tag === "img") {
    const src: string = el.getAttribute?.("src") ?? ""
    const alt: string = el.getAttribute?.("alt") ?? ""
    if (src) out.push({ type: "image", attrs: { src, alt } })
    return
  }

  if (tag === "br") return

  // Wrapper elements (div, body, section, etc.) — recurse children as siblings
  if (WRAPPER_TAGS_THAT_RECURSE_AS_SIBLINGS.has(tag)) {
    const children = elementChildren(el)
    if (children.length === 0) {
      // Inline content directly under wrapper — wrap in paragraph
      const inline = inlineContent(el)
      const hasContent = inline.some((n) => n.type === "text" && (n.text?.trim().length ?? 0) > 0)
      if (hasContent) out.push({ type: "paragraph", content: inline })
      return
    }

    let pendingInline: TipTapNode[] = []
    const flush = () => {
      if (pendingInline.length > 0) {
        const hasContent = pendingInline.some(
          (n) => n.type === "text" && (n.text?.trim().length ?? 0) > 0
        )
        if (hasContent) out.push({ type: "paragraph", content: pendingInline })
        pendingInline = []
      }
    }

    if (el.childNodes) {
      for (let i = 0; i < el.childNodes.length; i++) {
        const child = el.childNodes[i]
        if (isTextNode(child)) {
          const text: string = child.nodeValue ?? ""
          if (text.trim().length > 0) pendingInline.push({ type: "text", text })
          continue
        }
        if (!isElementNode(child)) continue
        const childTag = tagName(child)
        if (
          HEADING_MAP[childTag] !== undefined ||
          childTag === "p" ||
          childTag === "ul" ||
          childTag === "ol" ||
          childTag === "table" ||
          childTag === "hr" ||
          BLOCK_TAGS.has(childTag)
        ) {
          flush()
          processBlock(child, out, depth)
        } else {
          collectInline(child, {}, pendingInline)
        }
      }
    }
    flush()
    return
  }

  // Fallback: treat as paragraph
  out.push({ type: "paragraph", content: inlineContent(el) })
}

// ─── Empty doc ────────────────────────────────────────────────────────────────

function emptyDoc(): TipTapDoc {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "" }] }] }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse an HTML string and return a TipTap ProseMirror doc.
 * This is the canonical implementation; `htmlToPlateNodes` is an alias for
 * backward compatibility with existing worker.ts imports.
 */
export function htmlToTiptapDoc(html: string): TipTapDoc {
  const trimmed = (html ?? "").trim()
  if (!trimmed) return emptyDoc()

  const wrapped = trimmed.startsWith("<")
    ? `<root>${trimmed}</root>`
    : `<root><p>${trimmed}</p></root>`

  let doc: ReturnType<DOMParser["parseFromString"]>
  try {
    doc = new DOMParser({ onError: () => {} }).parseFromString(wrapped, "text/html")
  } catch {
    return emptyDoc()
  }

  const root = doc.documentElement
  if (!root) return emptyDoc()

  const out: TipTapNode[] = []
  processBlock(root, out, 0)

  if (out.length === 0) return emptyDoc()

  return { type: "doc", content: out }
}

/**
 * Alias for backward compatibility — worker.ts imports `htmlToPlateNodes`.
 * Returns a TipTapDoc (not a Plate/Slate array).
 */
export const htmlToPlateNodes = htmlToTiptapDoc

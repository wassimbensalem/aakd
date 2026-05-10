import { DOMParser } from "@xmldom/xmldom"

export interface PlateTextLeaf {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
}

export interface PlateElementNode {
  type: string
  children: PlateNode[]
  indent?: number
}

export type PlateNode = PlateTextLeaf | PlateElementNode

interface InlineMarks {
  bold?: boolean
  italic?: boolean
  underline?: boolean
}

const MAX_NESTING_DEPTH = 6

const HEADING_TAGS: Record<string, string> = {
  h1: "h1",
  h2: "h2",
  h3: "h3",
}

function isElementNode(n: unknown): boolean {
  return !!n && typeof n === "object" && (n as { nodeType?: number }).nodeType === 1
}

function isTextNode(n: unknown): boolean {
  return !!n && typeof n === "object" && (n as { nodeType?: number }).nodeType === 3
}

function tagName(node: { tagName?: string; nodeName?: string }): string {
  return (node.tagName ?? node.nodeName ?? "").toLowerCase()
}

function makeText(text: string, marks: InlineMarks): PlateTextLeaf {
  const leaf: PlateTextLeaf = { text }
  if (marks.bold) leaf.bold = true
  if (marks.italic) leaf.italic = true
  if (marks.underline) leaf.underline = true
  return leaf
}

// Walk inline children of a block element and collect text leaves with marks
// applied. Whitespace-only text nodes between block siblings are dropped at
// the block level (see processChildren), so we don't filter them here.
function collectInline(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node: any,
  marks: InlineMarks,
  out: PlateTextLeaf[],
): void {
  const childNodes = node.childNodes
  if (!childNodes) return
  for (let i = 0; i < childNodes.length; i++) {
    const child = childNodes[i]
    if (isTextNode(child)) {
      const text = child.nodeValue ?? ""
      if (text.length > 0) out.push(makeText(text, marks))
      continue
    }
    if (!isElementNode(child)) continue
    const tag = tagName(child)
    if (tag === "br") {
      out.push(makeText("\n", marks))
      continue
    }
    if (tag === "strong" || tag === "b") {
      collectInline(child, { ...marks, bold: true }, out)
      continue
    }
    if (tag === "em" || tag === "i") {
      collectInline(child, { ...marks, italic: true }, out)
      continue
    }
    if (tag === "u") {
      collectInline(child, { ...marks, underline: true }, out)
      continue
    }
    // Any other inline element: recurse with current marks
    collectInline(child, marks, out)
  }
}

function inlineChildren(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node: any,
): PlateTextLeaf[] {
  const leaves: PlateTextLeaf[] = []
  collectInline(node, {}, leaves)
  if (leaves.length === 0) leaves.push({ text: "" })
  return leaves
}

function elementChildArray(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  node: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any[] {
  const out: unknown[] = []
  const childNodes = node.childNodes
  if (!childNodes) return out as never
  for (let i = 0; i < childNodes.length; i++) {
    const c = childNodes[i]
    if (isElementNode(c)) out.push(c)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return out as any[]
}

function processList(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  listEl: any,
  type: "ol" | "ul",
  depth: number,
): PlateElementNode[] {
  const out: PlateElementNode[] = []
  const items = elementChildArray(listEl).filter((c) => tagName(c) === "li")
  for (const li of items) {
    // Inline content of <li> (excluding nested lists)
    const liInline: PlateTextLeaf[] = []
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
        // Treat anything else (text, inline tags, paragraphs inside li) as inline text
        if (isTextNode(child)) {
          const text = child.nodeValue ?? ""
          if (text.length > 0) liInline.push({ text })
        } else if (isElementNode(child)) {
          const tag = tagName(child)
          if (tag === "strong" || tag === "b") {
            collectInline(child, { bold: true }, liInline)
          } else if (tag === "em" || tag === "i") {
            collectInline(child, { italic: true }, liInline)
          } else if (tag === "u") {
            collectInline(child, { underline: true }, liInline)
          } else {
            collectInline(child, {}, liInline)
          }
        }
      }
    }
    if (liInline.length === 0) liInline.push({ text: "" })

    const liNode: PlateElementNode = {
      type: "li",
      children: liInline,
    }
    const cappedDepth = Math.min(depth, MAX_NESTING_DEPTH)
    if (cappedDepth > 1) liNode.indent = cappedDepth
    out.push({ type, children: [liNode] })

    for (const nested of nestedLists) {
      const nt = tagName(nested) as "ol" | "ul"
      out.push(...processList(nested, nt, depth + 1))
    }
  }
  return out
}

function processTable(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tableEl: any,
): PlateElementNode {
  const rows: PlateElementNode[] = []
  // Walk through tbody/thead/tr to flatten to a single table node.
  function visit(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    el: any,
  ): void {
    const children = elementChildArray(el)
    for (const c of children) {
      const t = tagName(c)
      if (t === "tr") {
        const cells: PlateElementNode[] = []
        const cellEls = elementChildArray(c).filter(
          (x) => tagName(x) === "td" || tagName(x) === "th",
        )
        for (const cell of cellEls) {
          const cellType = tagName(cell) === "th" ? "th" : "td"
          const inline = inlineChildren(cell)
          cells.push({
            type: cellType,
            children: [{ type: "p", children: inline }],
          })
        }
        rows.push({ type: "tr", children: cells.length > 0 ? cells : [{ type: "td", children: [{ type: "p", children: [{ text: "" }] }] }] })
      } else if (t === "tbody" || t === "thead" || t === "tfoot") {
        visit(c)
      }
    }
  }
  visit(tableEl)
  return {
    type: "table",
    children: rows.length > 0 ? rows : [{ type: "tr", children: [{ type: "td", children: [{ type: "p", children: [{ text: "" }] }] }] }],
  }
}

function processBlock(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  el: any,
  out: PlateNode[],
  depth: number,
): void {
  const tag = tagName(el)

  if (HEADING_TAGS[tag]) {
    out.push({ type: HEADING_TAGS[tag], children: inlineChildren(el) })
    return
  }
  if (tag === "p") {
    out.push({ type: "p", children: inlineChildren(el) })
    return
  }
  if (tag === "ol" || tag === "ul") {
    out.push(...processList(el, tag, depth + 1))
    return
  }
  if (tag === "table") {
    out.push(processTable(el))
    return
  }
  if (tag === "hr") {
    out.push({ type: "hr", children: [{ text: "" }] })
    return
  }
  if (tag === "br") {
    return
  }
  // body, div, section, article, root wrapper, etc — recurse children as siblings
  if (
    tag === "root" ||
    tag === "body" ||
    tag === "html" ||
    tag === "div" ||
    tag === "section" ||
    tag === "article" ||
    tag === "main" ||
    tag === "header" ||
    tag === "footer"
  ) {
    const children = elementChildArray(el)
    if (children.length === 0) {
      // Inline content directly under wrapper — wrap in a paragraph
      const inline = inlineChildren(el)
      const hasContent = inline.some((l) => l.text && l.text.trim().length > 0)
      if (hasContent) out.push({ type: "p", children: inline })
      return
    }
    // Mix of block and inline: gather inline runs into paragraphs
    let pendingInline: PlateTextLeaf[] = []
    const flush = () => {
      if (pendingInline.length > 0) {
        const hasContent = pendingInline.some((l) => l.text && l.text.trim().length > 0)
        if (hasContent) out.push({ type: "p", children: pendingInline })
        pendingInline = []
      }
    }
    if (el.childNodes) {
      for (let i = 0; i < el.childNodes.length; i++) {
        const child = el.childNodes[i]
        if (isTextNode(child)) {
          const text = child.nodeValue ?? ""
          if (text.trim().length > 0) pendingInline.push({ text })
          continue
        }
        if (!isElementNode(child)) continue
        const childTag = tagName(child)
        if (
          childTag === "p" ||
          HEADING_TAGS[childTag] ||
          childTag === "ol" ||
          childTag === "ul" ||
          childTag === "table" ||
          childTag === "hr" ||
          childTag === "div" ||
          childTag === "section" ||
          childTag === "article"
        ) {
          flush()
          processBlock(child, out, depth)
        } else {
          // Inline: collect with marks
          if (childTag === "strong" || childTag === "b") {
            collectInline(child, { bold: true }, pendingInline)
          } else if (childTag === "em" || childTag === "i") {
            collectInline(child, { italic: true }, pendingInline)
          } else if (childTag === "u") {
            collectInline(child, { underline: true }, pendingInline)
          } else if (childTag === "br") {
            pendingInline.push({ text: "\n" })
          } else {
            collectInline(child, {}, pendingInline)
          }
        }
      }
    }
    flush()
    return
  }
  // Fallback: any other block tag → paragraph
  out.push({ type: "p", children: inlineChildren(el) })
}

function emptyDocument(): PlateNode[] {
  return [{ type: "p", children: [{ text: "" }] }]
}

export function htmlToPlateNodes(html: string): PlateNode[] {
  const trimmed = (html ?? "").trim()
  if (!trimmed) return emptyDocument()

  // Wrap in a body so the parser has a clear root
  const wrapped = trimmed.startsWith("<")
    ? `<root>${trimmed}</root>`
    : `<root><p>${trimmed}</p></root>`

  // @xmldom/xmldom parses HTML loosely — good enough for mammoth's clean output.
  let doc: ReturnType<DOMParser["parseFromString"]>
  try {
    doc = new DOMParser({
      onError: () => {},
    }).parseFromString(wrapped, "text/html")
  } catch {
    return emptyDocument()
  }

  const root = doc.documentElement
  if (!root) return emptyDocument()

  const out: PlateNode[] = []
  processBlock(root, out, 0)

  if (out.length === 0) return emptyDocument()
  return out
}

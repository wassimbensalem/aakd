import React from "react"
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from "@react-pdf/renderer"

interface AnyNode {
  type?: string
  text?: string
  children?: unknown[]
  variable?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
}

const styles = StyleSheet.create({
  page: {
    fontFamily: "Times-Roman",
    fontSize: 12,
    paddingTop: 72,
    paddingBottom: 72,
    paddingLeft: 72,
    paddingRight: 72,
  },
  paragraph: {
    fontSize: 12,
    fontFamily: "Times-Roman",
    marginBottom: 6,
  },
  h1: {
    fontSize: 24,
    fontFamily: "Times-Bold",
    marginBottom: 10,
  },
  h2: {
    fontSize: 20,
    fontFamily: "Times-Bold",
    marginBottom: 8,
  },
  h3: {
    fontSize: 16,
    fontFamily: "Times-Bold",
    marginBottom: 6,
  },
  hr: {
    borderBottomWidth: 1,
    borderBottomColor: "#000",
    marginVertical: 8,
  },
  listItem: {
    fontSize: 12,
    fontFamily: "Times-Roman",
    marginLeft: 20,
    marginBottom: 3,
  },
  table: {
    borderWidth: 1,
    borderColor: "#000",
    marginBottom: 8,
  },
  tableRow: {
    flexDirection: "row",
  },
  tableCell: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#000",
    padding: 4,
    fontSize: 12,
    fontFamily: "Times-Roman",
  },
})

function fontFamilyForMarks(bold: boolean, italic: boolean): string {
  if (bold && italic) return "Times-BoldItalic"
  if (bold) return "Times-Bold"
  if (italic) return "Times-Italic"
  return "Times-Roman"
}

function renderInline(children: unknown[] | undefined, keyPrefix: string): React.ReactNode[] {
  if (!Array.isArray(children)) return []
  const out: React.ReactNode[] = []
  let i = 0
  function walk(items: unknown[], prefix: string): void {
    for (const child of items) {
      if (!child || typeof child !== "object") continue
      const n = child as AnyNode
      if (typeof n.text === "string") {
        const family = fontFamilyForMarks(!!n.bold, !!n.italic)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const style: any = { fontFamily: family }
        // React PDF supports a single textDecoration value. When both underline
        // and strikethrough are active, "line-through" takes visual priority.
        if (n.strikethrough) style.textDecoration = "line-through"
        else if (n.underline) style.textDecoration = "underline"
        out.push(
          React.createElement(Text, { key: `${prefix}_${i++}`, style }, n.text),
        )
        continue
      }
      if (n.type === "template_variable" && typeof n.variable === "string") {
        out.push(
          React.createElement(
            Text,
            { key: `${prefix}_${i++}`, style: { fontFamily: "Times-Roman" } },
            `{{${n.variable}}}`,
          ),
        )
        continue
      }
      if (Array.isArray(n.children)) walk(n.children, prefix)
    }
  }
  walk(children, keyPrefix)
  return out
}

function renderBlock(node: unknown, idx: number): React.ReactNode | null {
  if (!node || typeof node !== "object") return null
  const n = node as AnyNode
  const type = n.type ?? ""
  const key = `b_${idx}`

  if (type === "h1") {
    return React.createElement(Text, { key, style: styles.h1 }, ...renderInline(n.children, key))
  }
  if (type === "h2") {
    return React.createElement(Text, { key, style: styles.h2 }, ...renderInline(n.children, key))
  }
  if (type === "h3") {
    return React.createElement(Text, { key, style: styles.h3 }, ...renderInline(n.children, key))
  }
  if (type === "p" || !type) {
    return React.createElement(
      Text,
      { key, style: styles.paragraph },
      ...renderInline(n.children, key),
    )
  }
  if (type === "hr") {
    return React.createElement(View, { key, style: styles.hr })
  }
  if (type === "ol" || type === "ul") {
    if (!Array.isArray(n.children)) return null
    const items: React.ReactNode[] = []
    let counter = 1
    for (let li = 0; li < n.children.length; li++) {
      const item = n.children[li] as AnyNode | undefined
      if (!item || typeof item !== "object" || item.type !== "li") continue
      const prefix = type === "ol" ? `${counter++}. ` : "• "
      items.push(
        React.createElement(
          Text,
          { key: `${key}_li_${li}`, style: styles.listItem },
          prefix,
          ...renderInline(item.children, `${key}_li_${li}`),
        ),
      )
    }
    return React.createElement(View, { key }, ...items)
  }
  if (type === "li") {
    return React.createElement(
      Text,
      { key, style: styles.listItem },
      "• ",
      ...renderInline(n.children, key),
    )
  }
  if (type === "table") {
    if (!Array.isArray(n.children)) return null
    const rows: React.ReactNode[] = []
    for (let r = 0; r < n.children.length; r++) {
      const row = n.children[r] as AnyNode | undefined
      if (!row || typeof row !== "object" || row.type !== "tr") continue
      const cells: React.ReactNode[] = []
      if (Array.isArray(row.children)) {
        for (let c = 0; c < row.children.length; c++) {
          const cell = row.children[c] as AnyNode | undefined
          if (!cell || typeof cell !== "object" || (cell.type !== "td" && cell.type !== "th")) continue
          // Cell content: typically a paragraph. Flatten any nested paragraphs to inline runs.
          const inlineChildren: unknown[] = []
          if (Array.isArray(cell.children)) {
            for (const cc of cell.children) {
              if (!cc || typeof cc !== "object") continue
              const ccn = cc as AnyNode
              if (Array.isArray(ccn.children)) {
                inlineChildren.push(...ccn.children)
              } else {
                inlineChildren.push(cc)
              }
            }
          }
          cells.push(
            React.createElement(
              Text,
              { key: `${key}_${r}_${c}`, style: styles.tableCell },
              ...renderInline(inlineChildren, `${key}_${r}_${c}`),
            ),
          )
        }
      }
      rows.push(React.createElement(View, { key: `${key}_row_${r}`, style: styles.tableRow }, ...cells))
    }
    return React.createElement(View, { key, style: styles.table }, ...rows)
  }
  return React.createElement(
    Text,
    { key, style: styles.paragraph },
    ...renderInline(n.children, key),
  )
}

export async function plateToPdfBuffer(nodes: unknown[]): Promise<Buffer> {
  const blocks: React.ReactNode[] = []
  for (let i = 0; i < nodes.length; i++) {
    const block = renderBlock(nodes[i], i)
    if (block) blocks.push(block)
  }
  if (blocks.length === 0) {
    blocks.push(React.createElement(Text, { key: "empty", style: styles.paragraph }, ""))
  }

  const doc = React.createElement(
    Document,
    null,
    React.createElement(
      Page,
      { size: "A4", style: styles.page },
      ...blocks,
    ),
  )

  // @react-pdf/renderer's renderToBuffer accepts a React element of type DocumentElement.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToBuffer(doc as any) as Promise<Buffer>
}

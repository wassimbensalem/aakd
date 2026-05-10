// Plate JSON → plain text. Used for AI extraction (re-running ai_extract on
// editor content) and for word counting.

interface AnyNode {
  type?: string
  text?: string
  children?: unknown[]
  variable?: string
}

function visit(node: unknown, buf: string[]): void {
  if (!node || typeof node !== "object") return
  const n = node as AnyNode

  // Text leaf
  if (typeof n.text === "string") {
    buf.push(n.text)
    return
  }

  // Template variable inline node — render literal {{name}}
  if (n.type === "template_variable" && typeof n.variable === "string") {
    buf.push(`{{${n.variable}}}`)
    return
  }

  const type = n.type ?? ""

  if (type === "li") {
    buf.push("• ")
    if (Array.isArray(n.children)) {
      for (const c of n.children) visit(c, buf)
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
      for (const c of n.children) visit(c, buf)
    }
    buf.push("\n\n")
    return
  }

  if (type === "table" || type === "tr") {
    if (Array.isArray(n.children)) {
      for (const c of n.children) visit(c, buf)
    }
    buf.push("\n")
    return
  }

  if (type === "td" || type === "th") {
    if (Array.isArray(n.children)) {
      for (const c of n.children) visit(c, buf)
    }
    buf.push("\t")
    return
  }

  // Default: recurse children
  if (Array.isArray(n.children)) {
    for (const c of n.children) visit(c, buf)
  }
}

export function plateToPlaintext(nodes: unknown[]): string {
  if (!Array.isArray(nodes)) return ""
  const buf: string[] = []
  for (const n of nodes) visit(n, buf)
  return buf.join("").trim()
}

export function countWords(plaintext: string): number {
  if (!plaintext) return 0
  const matches = plaintext.split(/\s+/).filter((t) => t.length > 0)
  return matches.length
}

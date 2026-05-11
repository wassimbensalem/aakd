// Helpers for the M6 template variable system.
// Updated for TipTap JSON format.
// TipTap template variables are: { type: "templateVariable", attrs: { variable: "..." } }
// Legacy Slate format:           { type: "template_variable", variable: "..." }

export interface TemplateVariable {
  name: string
  label: string
  type: "text" | "date" | "number"
  required: boolean
  defaultValue?: string
}

interface AnyNode {
  type?: string
  text?: string
  // TipTap fields
  content?: unknown[]
  attrs?: Record<string, unknown>
  // Legacy Slate fields
  children?: unknown[]
  variable?: string
}

// ─── Find all used variable names ─────────────────────────────────────────────

/**
 * Walk a TipTap doc (or legacy Slate array) and return all variable names
 * referenced by templateVariable / template_variable nodes.
 *
 * Accepts:
 *  - TipTap doc object: { type: "doc", content: [...] }
 *  - Flat TipTap content array: [{ type: "paragraph", ... }, ...]
 *  - Legacy Slate array: [{ type: "p", children: [...] }, ...]
 */
export function findUsedVariableNames(nodes: unknown): string[] {
  const names = new Set<string>()

  function visit(n: unknown): void {
    if (!n || typeof n !== "object") return
    const node = n as AnyNode

    // TipTap templateVariable node
    if (node.type === "templateVariable" && node.attrs?.variable) {
      names.add(node.attrs.variable as string)
    }

    // Legacy Slate template_variable node
    if (node.type === "template_variable" && typeof node.variable === "string") {
      names.add(node.variable)
    }

    // TipTap: children are in `content`
    if (Array.isArray(node.content)) {
      for (const c of node.content) visit(c)
    }

    // Legacy Slate: children are in `children`
    if (Array.isArray(node.children)) {
      for (const c of node.children) visit(c)
    }
  }

  if (Array.isArray(nodes)) {
    for (const n of nodes) visit(n)
  } else {
    // TipTap doc object — visit top-level
    visit(nodes)
  }

  return Array.from(names)
}

// ─── Substitute template variables ────────────────────────────────────────────

/**
 * Deep-clone the TipTap (or legacy Slate) doc, replacing every
 * `templateVariable` / `template_variable` node with a plain text node
 * containing the user-supplied value.
 *
 * For TipTap: templateVariable → { type: "text", text: "value" }
 * For legacy Slate: template_variable → { text: "value" }
 */
export function substituteVariables(
  nodes: unknown,
  values: Record<string, string>,
  declared: TemplateVariable[],
): unknown {
  const defaults = new Map<string, string>()
  for (const v of declared) {
    defaults.set(v.name, v.defaultValue ?? "")
  }

  function resolveValue(name: string): string {
    const supplied = values[name]
    return supplied !== undefined && supplied !== null && supplied !== ""
      ? supplied
      : (defaults.get(name) ?? "")
  }

  function transform(n: unknown): unknown {
    if (!n || typeof n !== "object") return n
    const node = n as AnyNode

    // TipTap: templateVariable → text node
    if (node.type === "templateVariable" && node.attrs?.variable) {
      const name = node.attrs.variable as string
      return { type: "text", text: resolveValue(name) }
    }

    // Legacy Slate: template_variable → text leaf
    if (node.type === "template_variable" && typeof node.variable === "string") {
      return { text: resolveValue(node.variable) }
    }

    // TipTap node: transform content array
    if (Array.isArray(node.content)) {
      return { ...node, content: node.content.map(transform) }
    }

    // Legacy Slate node: transform children array
    if (Array.isArray(node.children)) {
      return { ...node, children: node.children.map(transform) }
    }

    return { ...node }
  }

  if (Array.isArray(nodes)) {
    return (nodes as unknown[]).map(transform)
  }

  // TipTap doc object
  return transform(nodes)
}

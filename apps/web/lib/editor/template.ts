// Helpers for the M6 template variable system.

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
  children?: unknown[]
  variable?: string
}

// Find every `template_variable` node anywhere in the document and return
// its variable name. Used for validation (every chip must reference a
// declared variable).
export function findUsedVariableNames(nodes: unknown[]): string[] {
  const names = new Set<string>()
  function visit(n: unknown): void {
    if (!n || typeof n !== "object") return
    const node = n as AnyNode
    if (node.type === "template_variable" && typeof node.variable === "string") {
      names.add(node.variable)
    }
    if (Array.isArray(node.children)) {
      for (const c of node.children) visit(c)
    }
  }
  for (const n of nodes) visit(n)
  return Array.from(names)
}

// Substitute every `template_variable` node with a plain text leaf containing
// the user-supplied value (or the variable's defaultValue, or empty string).
// Returns a new structure — does not mutate input.
export function substituteVariables(
  nodes: unknown[],
  values: Record<string, string>,
  declared: TemplateVariable[],
): unknown[] {
  const defaults = new Map<string, string>()
  for (const v of declared) {
    defaults.set(v.name, v.defaultValue ?? "")
  }

  function transform(n: unknown): unknown {
    if (!n || typeof n !== "object") return n
    const node = n as AnyNode
    if (node.type === "template_variable" && typeof node.variable === "string") {
      const supplied = values[node.variable]
      const text =
        supplied !== undefined && supplied !== null && supplied !== ""
          ? supplied
          : defaults.get(node.variable) ?? ""
      return { text }
    }
    if (Array.isArray(node.children)) {
      return {
        ...node,
        children: node.children.map(transform),
      }
    }
    return { ...node }
  }

  return nodes.map(transform)
}

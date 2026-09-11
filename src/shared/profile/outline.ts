/**
 * The document outline: blocks, with the sections and subsections found inside
 * them nested underneath.
 *
 * Sections are comments, so nothing that understands YAML can see them. This
 * is what the sticky header, the file tree's expanded view and the folding
 * provider all read.
 */

import { type Line, scanLines } from "./grammar.ts"

export type OutlineKind = "block" | "section" | "subsection"

export interface OutlineNode {
  kind: OutlineKind
  title: string
  /** 1-based line of the heading, or of the block's key. */
  line: number
  /** 1-based last line covered, inclusive. */
  endLine: number
  children: OutlineNode[]
}

/**
 * Walks the file and returns blocks with their headings nested inside.
 *
 * A profile with no headings still yields its blocks, which is what most
 * profiles written before the convention existed look like.
 */
export function parseOutline(text: string): OutlineNode[] {
  const lines = scanLines(text)
  const roots: OutlineNode[] = []

  let block: OutlineNode | null = null
  let section: OutlineNode | null = null
  let subsection: OutlineNode | null = null

  // Ends every node still open at or below the given level.
  const close = (level: OutlineKind, at: number) => {
    if (subsection) {
      subsection.endLine = at
      subsection = null
    }
    if (level !== "subsection" && section) {
      section.endLine = at
      section = null
    }
    if (level === "block" && block) {
      block.endLine = at
      block = null
    }
  }

  const open = (node: OutlineNode, parent: OutlineNode[]) => {
    parent.push(node)
    return node
  }

  for (const line of lines) {
    if (line.kind === "blockKey") {
      close("block", line.number - 1)
      block = open(
        {
          kind: "block",
          title: line.name,
          line: line.number,
          endLine: lines.length,
          children: [],
        },
        roots
      )
      continue
    }

    if (line.kind !== "heading") continue

    const node: OutlineNode = {
      kind: line.level === 1 ? "section" : "subsection",
      title: line.title,
      line: line.number,
      endLine: lines.length,
      children: [],
    }

    if (line.level === 1) {
      close("section", line.number - 1)
      section = open(node, block?.children ?? roots)
      continue
    }

    close("subsection", line.number - 1)
    subsection = open(node, section?.children ?? block?.children ?? roots)
  }

  return roots
}

/** The chain of nodes containing a line, outermost first. */
export function nodesAtLine(nodes: OutlineNode[], line: number): OutlineNode[] {
  for (const node of nodes) {
    if (line < node.line || line > node.endLine) continue
    return [node, ...nodesAtLine(node.children, line)]
  }

  return []
}

/** Every heading covering a line, as the scanner saw it. */
export function headingTrail(line: Line): string | undefined {
  return (
    [line.context.section, line.context.subsection].filter(Boolean).join(" › ") ||
    undefined
  )
}

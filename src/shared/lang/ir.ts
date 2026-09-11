/**
 * The IR — layer 2. Tokens become nodes that rules can ask questions of.
 *
 * The interesting work is the `ref` token: its inner text is a variable
 * reference in the sim's calculator syntax, and this is where the shared
 * name parser meets the expression language. Everything else is a word
 * carrying its stack effect, or a value pushing one.
 */

import { parseVar, type VarRef } from "../vars/parse.ts"
import { stackEffectOf, type StackEffect } from "./ops.ts"
import { tokenize, type Token } from "./tokens.ts"

/** What a parenthesised reference does. */
export type RefAccess = "read" | "write"

export type IrNode =
  | {
      kind: "ref"
      access: RefAccess
      ref: VarRef
      /** The unit as written after the comma, or null when none. */
      unit: string | null
      token: Token
    }
  /** A number, string, or `${…}` hole: pushes one value. */
  | { kind: "value"; token: Token }
  | {
      kind: "word"
      /** Null for a word the operator table does not know. */
      effect: StackEffect | null
      token: Token
    }
  | { kind: "invisible"; token: Token }

export interface IrDoc {
  nodes: IrNode[]
  /** Tokens flagged unterminated, surfaced once rather than per rule. */
  unterminated: Token[]
}

/**
 * `>NAME, unit` inside the parens: a leading `>` is a write, one comma
 * separates the unit. FS Copilot reads only the second field, and so does
 * this — a third field is part of the unit string, wrong and visible.
 *
 * Exported for the highlighter, which needs one ref's anatomy without
 * lifting a whole document.
 */
export function parseRef(token: Token): Extract<IrNode, { kind: "ref" }> {
  let inner = token.text.slice(1, token.unterminated ? undefined : -1).trim()

  let access: RefAccess = "read"
  if (inner.startsWith(">")) {
    access = "write"
    inner = inner.slice(1).trim()
  }

  const comma = inner.indexOf(",")
  const name = (comma === -1 ? inner : inner.slice(0, comma)).trim()
  const unit = comma === -1 ? null : inner.slice(comma + 1).trim()

  return { kind: "ref", access, ref: parseVar(name), unit, token }
}

export function toIr(tokens: Token[]): IrDoc {
  const nodes: IrNode[] = []
  const unterminated: Token[] = []

  for (const token of tokens) {
    if (token.unterminated) unterminated.push(token)

    switch (token.kind) {
      case "ref":
        nodes.push(parseRef(token))
        break
      case "number":
      case "string":
      case "hole":
        nodes.push({ kind: "value", token })
        break
      case "word":
        nodes.push({ kind: "word", effect: stackEffectOf(token.text), token })
        break
      case "invisible":
        nodes.push({ kind: "invisible", token })
        break
    }
  }

  return { nodes, unterminated }
}

/** Tokenize and lift in one call — what nearly every caller wants. */
export function parseRpn(text: string): IrDoc {
  return toIr(tokenize(text))
}

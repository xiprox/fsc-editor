/**
 * The stack simulator — layer 3. Symbolic depth at every point.
 *
 * This is what makes arity rules general: "this call needs two operands and
 * one is available" catches a missing `:2`, a missing value, and malformed
 * RPN with one mechanism, instead of one regex per mistake.
 *
 * ## What it deliberately does not do
 *
 * Branches are walked linearly: `if{` consumes its condition and the body is
 * simulated as if it always runs, with no reconciliation of the two arms'
 * depths. Reconciling would need real control-flow analysis for a payoff the
 * corpus does not demand yet — most setters are a value, a ref, done. The
 * honest cost: after the first `els{`, depth may drift from truth, so depth
 * turns `null` (unknown) there, and every rule that reads depth mutes itself
 * on null. Unknown words null the depth the same way. Conservative silence,
 * never a guessed complaint — the confidence-tier contract from
 * 18-language-core.
 */

import type { IrDoc, IrNode } from "./ir.ts"

export interface StackPoint {
  /** Depth *before* this node runs, or null once the simulation went blind. */
  before: number | null
  /** What this node pops — refs and values included, not just words. */
  pops: number
  pushes: number
  /** This node needed more operands than the stack held. */
  underflow?: boolean
}

export interface Simulation {
  points: StackPoint[]
  /** Depth after the last node, or null when the simulation went blind. */
  end: number | null
}

/**
 * A ref's stack effect. A read pushes its value; a write consumes one. A
 * `K:` fire consumes its documented parameters — but how many is the
 * catalogue's business, so here it is the written arity: `(>K:2:E)` pops 2,
 * `(>K:E)` pops 1... except that zero-parameter events exist and are spelled
 * identically to one-parameter ones. The linear truth: a bare `(>K:E)` pops
 * *at most* 1, and the sim tolerates an empty stack there. Modelled as
 * popping the written arity, floored at what is available — see `simulate`.
 */
function effectOf(node: IrNode): { pops: number; pushes: number; soft?: boolean } {
  if (node.kind === "value") return { pops: 0, pushes: 1 }
  if (node.kind === "invisible") return { pops: 0, pushes: 0 }

  if (node.kind === "ref") {
    if (node.access === "read") return { pops: 0, pushes: 1 }
    if (node.ref.ns === "K")
      return { pops: node.ref.params, pushes: 0, soft: true }
    // A B: write takes the pushed value as its parameter — and is also legal
    // with none, `(>B:X_Inc)` nudging by its default step. Soft, like K:.
    // The first sweep mis-modelled this as pops 0 and called 700 working
    // prepended setters unbalanced.
    if (node.ref.ns === "B") return { pops: 1, pushes: 0, soft: true }
    // H: and W: fire without consuming; L:, A:, Z:… consume the value
    // being written.
    if (node.ref.ns === "H" || node.ref.ns === "W")
      return { pops: 0, pushes: 0 }
    return { pops: 1, pushes: 0 }
  }

  // A word the table knows, or the end of what can be known.
  return node.effect ?? { pops: 0, pushes: 0 }
}

/**
 * `initialDepth` models what surrounds the text: a *prepended* setter's
 * value is pushed by FS Copilot before the written code runs, so its
 * simulation starts at 1 — without that, every prepended setter in the
 * corpus reads as an underflow.
 */
export function simulate(doc: IrDoc, initialDepth = 0): Simulation {
  const points: StackPoint[] = []
  let depth: number | null = initialDepth

  for (const node of doc.nodes) {
    const { pops, pushes, soft } = effectOf(node)
    const point: StackPoint = { before: depth, pops, pushes }
    points.push(point)

    if (depth === null) continue

    // The two blinders: an unknown word, and the second arm of a branch.
    if (node.kind === "word" && node.effect === null) {
      depth = null
      continue
    }
    if (node.kind === "word" && node.token.text.toLowerCase() === "els{") {
      depth = null
      continue
    }

    if (pops > depth && !soft) {
      // Underflow. The sim itself treats missing operands as zeros; depth
      // continues from empty so one mistake reads as one, not as a cascade.
      point.underflow = true
      depth = pushes
      continue
    }

    depth = Math.max(0, depth - pops) + pushes
  }

  return { points, end: depth }
}

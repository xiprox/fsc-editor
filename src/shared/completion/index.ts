/**
 * Variable-name completion, decided without an editor in the room.
 *
 * docs/sim-vars/19-completion.md is the design. `completionSlot` says where
 * the caret is, `documentFacts` what the file says, `complete` what to offer
 * and in which order; the Monaco adapter in the renderer maps offers onto
 * items and decides nothing.
 */

export {
  complete,
  completeSegments,
  completionIndex,
  type CompletionIndex,
  type Evidence,
  type Offer,
} from "./complete.ts"
export { detailOf } from "./detail.ts"
export {
  documentFacts,
  type DocumentFacts,
  type DocumentUse,
} from "./document.ts"
export {
  belongsAt,
  kEventSnippet,
  parameterLabel,
  shape,
  unitFor,
  writtenForm,
  type NamePosition,
  type Shape,
} from "./shapes.ts"
export {
  completionSlot,
  type CompletionSlot,
  type NameSlot,
  type UnitsSlot,
} from "./slot.ts"

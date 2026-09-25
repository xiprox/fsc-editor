export { SCOPES, isScope, type Scope } from "./scopes.ts"
export {
  refsInCode,
  setterFrames,
  setterRefs,
  type CodeRef,
  type RefNode,
} from "./refs.ts"
export {
  walkCode,
  type CodeListener,
  paintCode,
  paintName,
  paintRef,
  paintRpn,
  Spans,
  framesEqual,
  JS,
  RPN,
  type Frame,
  type Span,
} from "./paint.ts"
export {
  highlightLine,
  initialHighlightState,
  statesEqual,
  type Highlighted,
  type HighlightState,
} from "./line.ts"

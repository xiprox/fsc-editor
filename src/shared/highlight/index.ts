export { SCOPES, isScope, type Scope } from "./scopes.ts"
export {
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

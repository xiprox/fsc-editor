export { INVISIBLE, tokenize, type Token, type TokenKind } from "./tokens.ts"
export { stackEffectOf, type StackEffect } from "./ops.ts"
export {
  parseRef,
  parseRpn,
  toIr,
  type IrDoc,
  type IrNode,
  type RefAccess,
} from "./ir.ts"
export { simulate, type Simulation, type StackPoint } from "./stack.ts"
export {
  collectRefs,
  collectRefSpans,
  tokenAt,
  type CollectedRef,
  type RefSpan,
  type TokenHit,
} from "./refs.ts"
export {
  BASIS_LABEL,
  FACTS,
  factOf,
  type Anchor,
  type Basis,
  type Fact,
  type FactId,
} from "./facts.ts"
export {
  analyze,
  diagnose,
  type CockpitPanelNames,
  type Confidence,
  type Diagnostic,
  type Finding,
  type Fix,
  type Rule,
  type RuleContext,
  type RuleFamily,
  type Severity,
  type TextEdit,
} from "./rules.ts"
export {
  analyzeEntry,
  type EntryDiagnostic,
  type EntryRule,
  type EntryTarget,
  type EntryView,
} from "./entry.ts"
export { kArity, documentedParams } from "./rules/k-arity.ts"
export { kOperandOrder, paramSlots } from "./rules/k-operand-order.ts"
export { bWriteOp } from "./rules/b-write-op.ts"
export {
  bPresetUnknown,
  bWriteBare,
  getPresetUnknown,
} from "./rules/b-preset.ts"
export { bValueConstant } from "./rules/b-value-constant.ts"
export { refUnresolved } from "./rules/ref-unresolved.ts"
export { rpnBraces, rpnUnterminated } from "./rules/syntax.ts"
export { invisibleChars } from "./rules/invisible.ts"
export { nsAccess } from "./rules/ns-access.ts"
export { unitMeaningless } from "./rules/unit-meaningless.ts"
export { stackBalance } from "./rules/stack-balance.ts"
export { deadSet, masterSetShape } from "./rules/master-set.ts"
export { noWrite } from "./rules/no-write.ts"
export { getUnitMeaningless } from "./rules/get-unit.ts"
export { getNoPrefix } from "./rules/get-no-prefix.ts"
export { blockConflict, duplicateGet } from "./rules/duplicate-get.ts"
export { keyUnknown } from "./rules/key-unknown.ts"
export { includeMissing } from "./rules/include.ts"
export { headerUpdated } from "./rules/header-updated.ts"
export { blockUnknown, ignoreDuplicate } from "./rules/block-key.ts"
export { panelMissing } from "./rules/panel-missing.ts"
export {
  notSettable,
  prependedUnused,
  valueWord,
} from "./rules/setter-shape.ts"
export { distance, nearest } from "./nearest.ts"
export {
  analyzeProfileView,
  type ProfileDiagnostic,
  type ProfileBlock,
  type ProfileMapping,
  type ProfileItem,
  type ProfileRule,
  type ProfileView,
} from "./profile.ts"

import { kArity } from "./rules/k-arity.ts"
import { kOperandOrder } from "./rules/k-operand-order.ts"
import { bWriteOp } from "./rules/b-write-op.ts"
import {
  bPresetUnknown,
  bWriteBare,
  getPresetUnknown,
} from "./rules/b-preset.ts"
import { bValueConstant } from "./rules/b-value-constant.ts"
import { rpnBraces, rpnUnterminated } from "./rules/syntax.ts"
import { invisibleChars } from "./rules/invisible.ts"
import { nsAccess } from "./rules/ns-access.ts"
import { unitMeaningless } from "./rules/unit-meaningless.ts"
import { stackBalance } from "./rules/stack-balance.ts"
import { deadSet, masterSetShape } from "./rules/master-set.ts"
import { noWrite } from "./rules/no-write.ts"
import { getUnitMeaningless } from "./rules/get-unit.ts"
import { getNoPrefix } from "./rules/get-no-prefix.ts"
import { blockConflict, duplicateGet } from "./rules/duplicate-get.ts"
import { keyUnknown } from "./rules/key-unknown.ts"
import { includeMissing } from "./rules/include.ts"
import { headerUpdated } from "./rules/header-updated.ts"
import { blockUnknown, ignoreDuplicate } from "./rules/block-key.ts"
import { panelMissing } from "./rules/panel-missing.ts"
import {
  notSettable,
  prependedUnused,
  valueWord,
} from "./rules/setter-shape.ts"
import { refUnresolved } from "./rules/ref-unresolved.ts"
import type { ProfileRule } from "./profile.ts"
import type { EntryRule } from "./entry.ts"
import type { Rule } from "./rules.ts"

/**
 * Every shipped rule, text-level facts first — an unterminated ref garbles
 * everything after it, so its diagnostic should sit above the knock-on
 * complaints in any list ordered by arrival. Callers narrow this; nothing
 * forces the whole list.
 */
export const defaultRules: Rule[] = [
  rpnUnterminated,
  rpnBraces,
  invisibleChars,
  nsAccess,
  unitMeaningless,
  kArity,
  kOperandOrder,
  bWriteOp,
  bPresetUnknown,
  bWriteBare,
  stackBalance,
]

/**
 * Every shipped entry rule — level 2, judging the `get:`/`set:` pair rather
 * than one expression. Separate from `defaultRules` because they take a
 * different argument, not because they are optional: `analysis.ts` runs
 * both over the same profile.
 */
export const defaultEntryRules: EntryRule[] = [
  deadSet,
  getPresetUnknown,
  bValueConstant,
  refUnresolved,
  getNoPrefix,
  getUnitMeaningless,
  notSettable,
  prependedUnused,
  valueWord,
  masterSetShape,
  noWrite,
]

/**
 * Every shipped profile rule — level 3, judging entries against each other.
 * Their evidence is the file, so nothing here needs a `RuleContext` yet.
 */
export const defaultProfileRules: ProfileRule[] = [
  duplicateGet,
  blockConflict,
  includeMissing,
  headerUpdated,
  blockUnknown,
  keyUnknown,
  ignoreDuplicate,
  panelMissing,
]

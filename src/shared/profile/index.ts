/**
 * Reading and writing the FS Copilot profile comment format.
 * See docs/profile-format.md.
 *
 * `grammar.ts` is the only description of the format. Everything else in here
 * folds over it — import from this module, never reimplement a line pattern.
 */

export * from "./grammar.ts"
export * from "./indent.ts"
export * from "./format.ts"
export * from "./outline.ts"
export * from "./entries.ts"
export * from "./cursor.ts"
export * from "./expression.ts"
export * from "./aircraft.ts"
export * from "./panel-items.ts"

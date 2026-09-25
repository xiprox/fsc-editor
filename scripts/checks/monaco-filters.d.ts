/**
 * Monaco's own fuzzy scorer, which `check:completion` imports so that it
 * measures the order the suggest widget would show. The package ships no
 * declarations for its internal modules; this is the one signature used.
 */
declare module "monaco-editor/esm/vs/base/common/filters.js" {
  /** `[score, ...matches]`, or undefined when the pattern does not match. */
  export function fuzzyScore(
    pattern: string,
    patternLow: string,
    patternStart: number,
    word: string,
    wordLow: string,
    wordStart: number,
    options?: { firstMatchCanBeWeak: boolean; boostFullMatch: boolean }
  ): number[] | undefined
}

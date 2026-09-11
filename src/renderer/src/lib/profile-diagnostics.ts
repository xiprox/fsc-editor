/**
 * Re-export shim: the analyzer moved to `src/shared/analysis.ts` so the
 * corpus sweep and the editor run the same judge. Renderer imports keep
 * working through here.
 */

export {
  analyzeProfile,
  type DocumentPosition,
  type FileDiagnostic,
} from "@shared/analysis"

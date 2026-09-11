// Types only: nothing here touches the Monaco runtime, which keeps the
// tokenizer exercisable outside a browser.
import type * as monaco from "monaco-editor"

import {
  highlightLine,
  initialHighlightState,
  statesEqual,
  type HighlightState,
} from "@shared/highlight"

/**
 * Syntax highlighting for FS Copilot profiles, replacing Monaco's generic YAML
 * tokenizer on the `yaml` language id.
 *
 * This is the adapter and nothing else. The highlighter lives in
 * `src/shared/highlight/` — the scope vocabulary, the RPN and JavaScript
 * painters, and the per-line dispatch over the profile grammar — so that it
 * runs under plain Node for the corpus sweep (`npm run check:highlight`) and
 * so that the theme in `monaco-theme.ts` can be typed against the same
 * vocabulary. Its design, and the corpus measurements behind it, are in
 * *Highlighting v2* in docs/sim-vars/18-language-core.md.
 *
 * A plain `TokensProvider` is handed one line and a state object, which is
 * exactly what the highlighter wants: synchronous, instant, and carrying the
 * grammar's state plus the painter's open frames from line to line.
 */

/** Wraps the highlighter's state in the shape Monaco wants to hand back. */
class TokenState implements monaco.languages.IState {
  readonly state: HighlightState

  constructor(state: HighlightState) {
    this.state = state
  }

  clone(): monaco.languages.IState {
    return new TokenState(this.state)
  }

  equals(other: monaco.languages.IState): boolean {
    return other instanceof TokenState && statesEqual(this.state, other.state)
  }
}

export const profileTokens: monaco.languages.TokensProvider = {
  getInitialState: () => new TokenState(initialHighlightState()),

  tokenize(text, state) {
    const from =
      state instanceof TokenState ? state.state : initialHighlightState()
    const { spans, state: next } = highlightLine(text, from)

    return {
      tokens: spans.map((span) => ({
        startIndex: span.start,
        scopes: span.scope,
      })),
      endState: new TokenState(next),
    }
  },
}

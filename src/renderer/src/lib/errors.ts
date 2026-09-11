/**
 * The sentence inside an error, with the plumbing taken off the front.
 *
 * `ipcRenderer.invoke` does not hand back the error main threw. It rejects with
 * a new one whose message wraps that error's text in a sentence of its own —
 * `Error invoking remote method 'files:write': Error: Could not save …` — and
 * main writes these to be read by somebody who has just pressed Ctrl+S. The
 * prefix names a channel, which is the one fact in there that a person looking
 * at a bar above their editor cannot use.
 *
 * Defensive rather than exact: anything without the prefix comes back unchanged,
 * so this is also the right thing to call on an error raised in the renderer,
 * and it survives Electron wording the wrapper differently.
 */
export function messageOf(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)

  return raw
    .replace(/^Error invoking remote method '[^']*':\s*/, "")
    .replace(/^[A-Za-z]*Error:\s*/, "")
    .trim()
}

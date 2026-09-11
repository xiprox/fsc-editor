/**
 * What the picker puts inside a cockpit panel: an outline, and inspect mode.
 *
 * Everything else about the picker reads. This writes — into the document of
 * an instrument somebody is flying with — so it is apart from the scan, and
 * held to the rules FS Copilot's own record arrived at the hard way
 * (`record/conventions.md`, "anything injected into the pilot's own input path
 * must fail open").
 *
 * ## What it does
 *
 * **Lit**: a tinted box over the instrument with its name in the middle,
 * `pointer-events: none`. The name is whatever the app says it is — the text
 * the picker would write for this panel, so the cockpit and the list call it
 * the same thing, and two `WasmInstrument`s are told apart where they are
 * being looked at. Until the app has said, it is the identifier. Drawn while a row is hovered in the app, so "which
 * of these is `KX155B_2`" is answered by looking at the cockpit.
 *
 * **Inspect**: the DevTools gesture. While it is on, moving the mouse over a
 * panel lights it the same way, and the next press on it is *taken* — reported
 * to the app as a pick and kept from the instrument, so choosing the GTN does
 * not also press whatever softkey was under the pointer. One pick ends it.
 *
 * ## How it fails open
 *
 * Inspect mode swallows input, which is the one thing here that can hurt. So:
 *
 * - **A deadman.** Every `set` re-arms a timer; `DEADMAN_MS` without one and
 *   the whole thing removes itself. The app renews it on a heartbeat while
 *   anything is on, so an app that crashed, a socket that dropped or a session
 *   that forgot to tidy up costs the pilot five seconds, not a panel.
 * - **A fixed global.** `window.FSCEDITOR_PICK.remove()` undoes everything and
 *   survives losing every other handle — it can be typed into the Coherent
 *   debugger by somebody who has never seen this file.
 * - **Additive only.** Listeners are added and a node is appended. Nothing of
 *   the aircraft's is wrapped or replaced, so there is nothing to restore
 *   wrongly: removing what was added is the whole of the undo.
 * - **Off means gone.** `set(false, false)` is `remove()`. There is no dormant
 *   state sitting in a panel waiting to be woken.
 *
 * ## How it talks back
 *
 * It does not; it is asked. Signals queue inside the panel and `set` returns
 * them, so the call that renews the deadman is also the call that collects —
 * one round trip, and a panel nobody is asking has nobody to tell.
 *
 * The console was the first idea and does not work: Coherent GT replays a
 * document's console backlog when `Console.enable` is sent and then pushes
 * nothing live, from an evaluate or from a listener. Measured 2026-09-19.
 *
 * ## Chrome 49, and the name
 *
 * ES5 throughout: a single `?.` fails the parse and takes the whole expression
 * with it. `panel-inject.test.ts` holds that line. The prefix is `FSCEDITOR_`,
 * which is this app's on the buses and globals it shares with FS Copilot
 * (`fsc…`) in the same panels.
 */

export const INJECT_GLOBAL = "FSCEDITOR_PICK"

/** No `set` for this long and the panel cleans itself up. */
export const DEADMAN_MS = 5000

/**
 * How long a motionless pointer still counts as over the panel, when no leave
 * was heard. A net, not the mechanism — see `left` in the installer.
 */
const IDLE_MS = 4000

/** The dark theme's `--sim`, as the sRGB Chrome 49 can parse. */
const TINT = "17, 181, 244"

export type PanelSignal = "hover" | "leave" | "pick"

const INSTALLER = `function (token) {
  var K = "${INJECT_GLOBAL}"
  var existing = window[K]
  if (existing && existing.token === token) return existing
  if (existing) { try { existing.remove() } catch (e) {} }

  var queue = []
  var lit = false
  var inspect = false
  var hover = false
  var overlay = null
  var label = null
  var name = ""
  var deadman = null
  var idle = null
  var listening = false

  function say(type) {
    // Bounded: a session that stopped asking must not grow a list in a panel.
    if (queue.length < 64) queue.push(type)
  }

  function instrument() {
    var all = document.getElementsByTagName("*")
    for (var i = 0; i < all.length; i++) {
      var el = all[i]
      if (el.tagName.indexOf("-") < 0) continue
      try { if (typeof el.instrumentIdentifier === "string" && el.instrumentIdentifier) return el } catch (e) {}
    }
    return null
  }

  function unpaint() {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay)
    overlay = null
    label = null
  }

  function paint() {
    if (!(lit || (inspect && hover))) return unpaint()

    var el = instrument()
    var r = el ? el.getBoundingClientRect() : null
    if (!r || !r.width) r = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }

    if (!overlay) {
      overlay = document.createElement("div")
      overlay.setAttribute("data-fsceditor", "pick")
      var s = overlay.style
      s.position = "fixed"
      s.zIndex = "2147483647"
      s.pointerEvents = "none"
      s.boxSizing = "border-box"
      s.margin = "0"
      s.background = "rgba(${TINT}, 0.28)"

      label = document.createElement("div")
      var t = label.style
      // Centred: a round gauge's corners are outside the bezel, and a label
      // up there is a label nobody can see.
      t.position = "absolute"
      t.left = "50%"
      t.top = "50%"
      t.transform = "translate(-50%, -50%)"
      t.webkitTransform = "translate(-50%, -50%)"
      // Wrapped, never cut short: a key's telling part is at its end.
      t.maxWidth = "90%"
      t.textAlign = "center"
      t.whiteSpace = "normal"
      t.wordBreak = "break-all"
      t.lineHeight = "1.25"
      t.background = "rgb(${TINT})"
      t.color = "#00121c"
      t.fontFamily = "sans-serif"
      t.fontWeight = "600"
      t.boxSizing = "border-box"
      overlay.appendChild(label)
      ;(document.body || document.documentElement).appendChild(overlay)
    }

    // Sized from the panel, which may be 256 px across or 1024.
    var unit = Math.max(2, Math.round(Math.min(r.width, r.height) / 90))
    overlay.style.left = r.left + "px"
    overlay.style.top = r.top + "px"
    overlay.style.width = r.width + "px"
    overlay.style.height = r.height + "px"
    overlay.style.border = unit + "px solid rgb(${TINT})"
    label.style.fontSize = Math.max(11, Math.min(28, Math.round(r.height / 14))) + "px"
    label.style.padding = unit + "px " + unit * 3 + "px"
    // Scaled with the rest, and generous: on a small radio it is a pill.
    label.style.borderRadius = Math.max(6, unit * 4) + "px"
    label.textContent = name || (el ? el.instrumentIdentifier : document.title)
  }

  function setHover(next) {
    if (hover === next) return
    hover = next
    say(next ? "hover" : "leave")
    paint()
  }

  function moved() {
    if (!inspect) return
    setHover(true)
    // Leaving is what ends a hover - see left(). Stillness is only the net
    // under it, for a leave that never arrives, and is long on purpose: a
    // pointer resting on a display is still on it, and an outline that gave
    // up after a moment read as the panel having been left.
    clearTimeout(idle)
    idle = setTimeout(function () { setHover(false) }, ${IDLE_MS})
  }

  // The pointer leaving the panel. The sim does say so, as a mouseleave on the
  // instrument - its own VCockpit.js hides the vignette on exactly that - but
  // not as a mouseout with no relatedTarget, which is all this used to hear:
  // the outline then sat there until the stillness timer ran out, and lagged
  // behind the pointer by that long.
  //
  // mouseleave does not bubble, but it is still captured at the window, once
  // for every element the pointer left. Leaving a button inside the display is
  // not leaving the display, so only the instrument and the document count.
  function left(event) {
    if (!inspect) return
    var t = event.target
    var outer = t === document || t === document.documentElement || t === document.body || t === instrument()
    if (!event.relatedTarget || (event.type === "mouseleave" && outer)) {
      clearTimeout(idle)
      setHover(false)
    }
  }

  function swallow(event) {
    if (!inspect) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  function pressed(event) {
    if (!inspect) return
    swallow(event)
    say("pick")
    // One pick ends it, here and now rather than when the app gets round to
    // saying so. The release that follows this press is still swallowed, by
    // released(), and nothing after that is.
    inspect = false
    picked = true
    releasing = true
    setTimeout(function () { releasing = false }, 1500)
    clearTimeout(idle)
    hover = false
    paint()
  }

  // The session learns of a pick from the answer to a set() that still says
  // "inspect" - it could not have known. Until it has said "not inspecting"
  // once, that stale yes is not allowed to turn input-taking back on.
  var picked = false
  var releasing = false
  function released(event) {
    if (!inspect && !releasing) return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.type === "click") releasing = false
  }

  function listen(on) {
    if (on === listening) return
    listening = on
    var f = on ? "addEventListener" : "removeEventListener"
    window[f]("mousemove", moved, true)
    window[f]("mouseover", moved, true)
    window[f]("mouseout", left, true)
    window[f]("mouseleave", left, true)
    window[f]("mousedown", pressed, true)
    window[f]("mouseup", released, true)
    window[f]("click", released, true)
    window[f]("dblclick", swallow, true)
  }

  function remove() {
    clearTimeout(deadman)
    clearTimeout(idle)
    lit = false
    inspect = false
    hover = false
    releasing = false
    listen(false)
    unpaint()
    if (window[K] === api) { try { delete window[K] } catch (e) { window[K] = undefined } }
    return "removed"
  }

  function set(nextLit, nextInspect, nextName) {
    if (!nextLit && !nextInspect) return remove()

    name = typeof nextName === "string" ? nextName : ""

    lit = !!nextLit
    if (!nextInspect) picked = false
    if (picked) nextInspect = false
    if (!!nextInspect !== inspect) {
      inspect = !!nextInspect
      if (!inspect) { clearTimeout(idle); hover = false }
    }
    listen(inspect || releasing)
    paint()

    clearTimeout(deadman)
    deadman = setTimeout(remove, ${DEADMAN_MS})

    var heard = queue
    queue = []
    return JSON.stringify(heard)
  }

  var api = { token: token, set: set, remove: remove }
  window[K] = api
  return api
}`

/** Installs if this session has not, then applies the state. */
export function applyExpression(
  token: string,
  state: { lit: boolean; inspect: boolean; label?: string }
): string {
  // Off in a panel that was never touched must not install in order to remove.
  if (!state.lit && !state.inspect) return REMOVE_EXPRESSION

  return `(${INSTALLER})(${JSON.stringify(token)}).set(${state.lit}, ${state.inspect}, ${JSON.stringify(state.label ?? "")})`
}

export const REMOVE_EXPRESSION = `(window.${INJECT_GLOBAL} ? window.${INJECT_GLOBAL}.remove() : "absent")`

/** What `set` answered, as the signals queued since the last one. */
export function readSignals(answer: string): PanelSignal[] {
  // `remove()` and an absent global answer with a word, not a list.
  if (!answer.startsWith("[")) return []

  try {
    return (JSON.parse(answer) as unknown[]).filter(
      (type): type is PanelSignal =>
        type === "hover" || type === "leave" || type === "pick"
    )
  } catch {
    return []
  }
}

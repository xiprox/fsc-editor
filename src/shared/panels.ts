/**
 * Cockpit panels, as the simulator reports them — and which profile blocks
 * take one as an item.
 *
 * A panel is one instrument in one Coherent GT document. FS Copilot routes by
 * a key made from the instrument's identifier and the query of its `url`
 * attribute (`Channel.keyFor` in the bridge), and a `pointer:` item matches
 * either that whole key or the bare identifier (`hook.js`, `_configure`).
 *
 * ## The identifier is what gets written
 *
 * The query is not stable. The A220 declares its displays as
 * `?config=[config]`, so the key reads `DisplayUnits|config=Default` on the
 * house livery and `DisplayUnits|config=N324DU` on another — and a profile
 * that named the first missed every other livery. So a panel that has its
 * identifier to itself is written as the identifier.
 *
 * ## A shared identifier is written as its keys
 *
 * Where several panels report one identifier, the item is each panel's key,
 * and the identifier is not written for "all of them". (The one way it still
 * is: a panel in the group with no key of its own, which has nothing else to
 * be called — see `PickChild`.) An
 * identifier takes every panel that reports it *including the ones that do
 * not exist yet*: `WasmInstrument` is every wasm gauge from every vendor, and
 * a bare `- WasmInstrument` would start syncing a gauge installed next month
 * that nobody ever agreed to. Keys make the list say exactly what was chosen,
 * and nothing joins it without somebody ticking a box.
 *
 * The two rules do not collide as far as anything seen so far: the queries
 * that tell sibling panels apart (`side=L`, `wasm_gauge=…`) come from
 * `panel.cfg` and are the same on every machine, and the livery-dependent
 * query belonged to a panel with no siblings.
 *
 * ## A block is a spec, and the picker knows nothing else
 *
 * The scan returns every panel and says what kind each is. One thing is
 * worked out before any block is asked — whether the simulator is sending the
 * panel input right now, `takesInput` — and it orders the list rather than
 * cutting it: see there for why a dark panel still belongs in a profile. What
 * a block makes of a panel — the text an item gets, whether it can be named
 * alone, which rows carry a warning — is a `PanelBlockSpec`. A spec ranks
 * before it filters: a row the block would not recommend is still a row the
 * user can see and choose, with the reason beside it, and `accepts` is kept
 * for the panel an item could do nothing for. Another block that takes panels is another spec
 * and one more name in `BLOCKS`; the trigger, the scan and the popup do not
 * change.
 */

/** `wasm` is a `WasmInstrument`: the sim hit-tests it, not a document. */
export type PanelKind = "html" | "wasm"

export interface CockpitPanel {
  /** The inspector's page id. Assigned by the sim, different every session. */
  page: number
  /** `VCockpit02 - DisplayUnits`, as the debugger lists it. */
  title: string
  identifier: string
  /** Identifier plus the url query, when there is one. */
  key: string
  kind: PanelKind
  /**
   * The instrument's own `isInteractive`. FS Copilot's hook starts the
   * element-name path only when this is true, so a panel without it is one
   * that path never sees. `null` when the document would not be read.
   */
  interactive: boolean | null
  /** The instrument element's own size, in its document's pixels. */
  width: number
  height: number
  /**
   * Made from the title alone, because another debugger holds the document.
   * The identifier is right; the key, the size and `interactive` are unknown,
   * and nothing can be drawn in the panel or heard from it.
   */
  unread?: true
}

/**
 * Why a scan came back with nothing, as the cases that want different words.
 *
 * - `unreachable`: nothing answered on the port — the sim is not running, or
 *   this build does not host the debugger.
 * - `no-panels`: the debugger answered and listed no cockpit documents, which
 *   is the sim in a menu rather than in a flight.
 * - `failed`: it answered and then something else went wrong; `detail` is all
 *   there is to say.
 */
export type PanelScanFailure = "unreachable" | "no-panels" | "failed"

export type PanelScan =
  | {
      ok: true
      panels: CockpitPanel[]
      skipped: SkippedPage[]
      /**
       * Other processes connected to the debugger, when any panel went
       * unread. Empty otherwise — nobody needs naming when nothing was held.
       */
      holders: PanelHolder[]
    }
  | { ok: false; reason: PanelScanFailure; detail: string }

/**
 * What an open picker hears from the cockpit.
 *
 * `hover` and `leave` are the pointer over a panel while inspect mode is on;
 * `pick` is the press that chose one, which also ends inspect mode — reported
 * as `inspect` with `on: false`, the same event a toggle in the app produces,
 * so the button has one source of truth whoever turned it off.
 */
export type PanelEvent =
  | { type: "hover" | "leave" | "pick"; page: number }
  | { type: "inspect"; on: boolean }

/** A process holding a connection to the simulator's debugger. */
export interface PanelHolder {
  pid: number
  /** The image name, as Windows has it: `Debugger.exe`. */
  name: string
}

/** A cockpit document that would not be read. Reported, never fatal. */
export interface SkippedPage {
  page: number
  title: string
  detail: string
}

export type PanelRank = "fits" | "plain" | "warn"

export interface PanelBlockSpec {
  block: string
  /** What listing a panel here will do, as the popup's one line of body copy. */
  summary: string
  /** Shown when the cockpit has panels and none of them is one for this block. */
  none: string
  /**
   * Whether the panel is a row at all. Only for a panel the block cannot act
   * on, where an item would be a line that does nothing — a panel the block
   * merely advises against is `rank`'s business, and stays visible.
   */
  accepts?(panel: CockpitPanel): boolean
  /** The text a new item gets. */
  insert(panel: CockpitPanel): string
  /**
   * The text that names this panel *alone*, where the block has such a thing —
   * for `pointer:`, the full key. Absent for a block that only ever matches
   * the identifier, where a second spelling would be a line that does nothing.
   */
  insertOne?(panel: CockpitPanel): string | null
  /**
   * What a panel with no siblings is written as, when that is not its
   * identifier — for an identifier that is not the aircraft's own name for
   * the thing, and so would take in panels nobody has seen yet.
   */
  alone?(panel: CockpitPanel): string | null
  rank(panel: CockpitPanel): PanelRank
  /** One line beside a `warn` row, saying what choosing it will do. */
  note?(panel: CockpitPanel): string
}

const pointer: PanelBlockSpec = {
  block: "pointer",
  summary:
    "Clicks and drags on the panels you add will be sent to the other pilot by position.",
  none: "This aircraft has no cockpit panels.",
  insert: (panel) => panel.identifier,
  // `hook.js` takes a whole key as well as an identifier. A panel read from
  // its title alone has no key to offer.
  insertOne: (panel) => (panel.unread ? null : panel.key),
  // `WasmInstrument` is every wasm gauge there is, not this aircraft's name
  // for one, so even a lone gauge is written by its key: the reason a shared
  // identifier is never written applies to it with nobody to share with. Its
  // query is `wasm_module` and `wasm_gauge`, straight out of panel.cfg. An
  // html panel's identifier *is* the aircraft's own, and stays — that is the
  // A220 rule, and a lone `DisplayUnits` is exactly the case it was made for.
  alone: (panel) => (panel.kind === "wasm" && !panel.unread ? panel.key : null),
  // WasmInstrument is ranked like any other panel until the warning pass.
  rank: () => "fits",
}

/**
 * `ignore:` takes a panel off the element-name path, and matches the bare
 * identifier (`Coordinator`, `!_ignore.Contains(i.Instrument)`). That path is
 * only ever started for an instrument that says it is interactive, so those
 * are the only panels an item here can change anything for.
 */
const ignore: PanelBlockSpec = {
  block: "ignore",
  summary:
    "Interactions with the panels you add will not be sent to the other pilot.",
  none: "No panel in this aircraft uses element-name sync — there is nothing for ignore: to switch off.",
  accepts: (panel) => panel.kind === "html",
  insert: (panel) => panel.identifier,
  rank: () => "plain",
}

export const PANEL_BLOCKS: readonly PanelBlockSpec[] = [pointer, ignore]

export function panelBlockSpec(block: string | null): PanelBlockSpec | null {
  return PANEL_BLOCKS.find((spec) => spec.block === block) ?? null
}

/**
 * One line of the picker: an identifier, and every panel that reports it.
 *
 * Alone, it is an item and writes the identifier. With `children` it is not
 * an item at all: it is the heading of a group and a tick-them-all for it, and
 * what gets written is always the children — see the file header for why a
 * shared identifier is never written.
 */
export interface PickRow {
  /** The item's text, and the row's identity. */
  text: string
  panels: CockpitPanel[]
  rank: PanelRank
  note: string | null
  /** The block lists it already. Shown, and not offered again. */
  taken: boolean
  /**
   * Every panel behind it is a few pixels across: a helper instrument that
   * draws nothing. A valid item that nobody is looking for, so it goes last.
   */
  helper: boolean
  /**
   * The panels behind a shared identifier, one line each. Empty for a lone
   * panel, and for a block that cannot name a panel alone.
   */
  children: PickChild[]
}

/**
 * One panel of a group.
 *
 * Every panel gets a line, including the ones no item can tell apart — the
 * Baron's two `GNS_DISABLED` have no url query, so both have the key
 * `GNS_DISABLED` and FS Copilot cannot take one without the other. They are
 * still two displays in the cockpit, and a list that showed one row for them
 * was claiming otherwise; two lines can each be hovered to see which is which.
 *
 * What cannot be had is a separate tick. `text` is what a line writes, and
 * lines that write the same thing are the same item: ticking one ticks the
 * other, which is the list being truthful about what the item will take. The
 * same goes for a line whose `text` is the bare identifier sitting among
 * keyed siblings — it takes them all, and they all light up with it.
 */
export interface PickChild {
  /** Unique in the list. Not what is written — two lines can write one text. */
  id: string
  /** What ticking it writes: the panel's key, or the identifier if that is all it has. */
  text: string
  panel: CockpitPanel
  taken: boolean
}

/**
 * Whether the simulator is sending this panel input *right now*.
 *
 * An instrument reports `isInteractive` to the sim as it initialises
 * (`ON_VCOCKPIT_INSTRUMENT_INITIALIZED` in BaseInstrument.js), and the sim
 * routes the mouse only to those that said yes. It was seen from inside as
 * well: inspect mode's listeners hear nothing at all in the others.
 *
 * It is a state and not a fact about the aircraft, which is why it sorts the
 * list and does not cut it. The Black Square Baron swaps avionics in the
 * cockpit, and the unit that is swapped out says no until it is swapped back
 * in — so the panels that are dark right now include exactly the ones a
 * profile most needs to name, because it cannot know which unit the other
 * pilot has chosen. They were filtered out for one afternoon, and the only
 * way to list the second GTN was to go and swap to it first.
 *
 * So: live panels lead, dark ones follow under a label, and both can be
 * ticked. What a dark one cannot do is be picked in the cockpit.
 *
 * Unknown counts as live. A panel another debugger holds could not be asked,
 * and nobody said no.
 */
export function takesInput(panel: CockpitPanel): boolean {
  return panel.interactive !== false
}

/** At or under this in both directions, a panel is not something anyone sees. */
const HELPER_MAX_PX = 16

const RANK_ORDER: Record<PanelRank, number> = { fits: 0, plain: 1, warn: 2 }

export function pickRows(
  spec: PanelBlockSpec,
  panels: CockpitPanel[],
  taken: string[]
): PickRow[] {
  const rows = new Map<string, PickRow>()

  for (const panel of panels) {
    if (spec.accepts && !spec.accepts(panel)) continue

    const text = spec.insert(panel)
    // A block's own warning outranks where the panel would have sorted.
    const own = spec.rank(panel)
    const rank: PanelRank =
      own === "warn" ? own : takesInput(panel) ? "fits" : "plain"
    const row = rows.get(text)
    if (!row) {
      rows.set(text, {
        text,
        panels: [panel],
        rank,
        note: spec.note?.(panel) ?? null,
        taken: taken.includes(text),
        helper: false,
        children: [],
      })
      continue
    }

    row.panels.push(panel)
    // The best rank any of them earns: one live FCP puts the group up top.
    if (RANK_ORDER[rank] < RANK_ORDER[row.rank]) row.rank = rank
  }

  const all = [...rows.values()]
  for (const row of all) {
    row.helper = row.panels.every(
      (panel) =>
        !panel.unread &&
        panel.width <= HELPER_MAX_PX &&
        panel.height <= HELPER_MAX_PX
    )
    if (row.panels.length > 1) {
      row.children = childrenOf(spec, row, taken)
      continue
    }

    // Alone, and the block says its identifier is not its own: it is written
    // — and shown, and matched against what is listed — by that text instead.
    const alone = spec.alone?.(row.panels[0]!)
    if (alone && alone !== row.text) {
      row.text = alone
      row.taken = row.taken || taken.includes(alone)
    }
  }

  return all.sort(
    (a, b) =>
      Number(a.helper) - Number(b.helper) ||
      RANK_ORDER[a.rank] - RANK_ORDER[b.rank] ||
      a.text.localeCompare(b.text)
  )
}

function childrenOf(
  spec: PanelBlockSpec,
  row: PickRow,
  taken: string[]
): PickChild[] {
  // A block that only ever matches identifiers has nothing to say per panel.
  if (!spec.insertOne) return []

  return row.panels
    .map((panel, index) => {
      // No key of its own — read from a title, or no query — leaves the
      // identifier, which is at least what it answers to.
      const text = spec.insertOne?.(panel) || row.text
      return {
        id: `${row.text}#${index}`,
        text,
        panel,
        taken: taken.includes(text),
      }
    })
    .sort(
      (a, b) =>
        a.text.localeCompare(b.text) ||
        a.panel.title.localeCompare(b.panel.title)
    )
}

// ---- choosing --------------------------------------------------------------

/** The texts that are ticked: lone rows' and children's. */
export type Picked = ReadonlySet<string>

export type PickState = "on" | "some" | "off"

/** Whether the row is a group heading rather than an item. */
function isGroup(row: PickRow): boolean {
  return row.children.length > 0
}

/**
 * Whether this panel will be taken by what is ticked or listed.
 *
 * By its own text — or by the identifier, which takes every panel of the row
 * whichever line it was ticked on. That second half is what makes two lines
 * with one text move together, and a bare identifier light its siblings.
 */
function childOn(row: PickRow, child: PickChild, picked: Picked): boolean {
  return (
    row.taken || child.taken || picked.has(child.text) || picked.has(row.text)
  )
}

export function rowState(row: PickRow, picked: Picked): PickState {
  if (row.taken) return "on"
  if (!isGroup(row)) return picked.has(row.text) ? "on" : "off"

  const on = row.children.filter((child) => childOn(row, child, picked))
  if (on.length === row.children.length) return "on"
  return on.length ? "some" : "off"
}

export function childState(
  row: PickRow,
  child: PickChild,
  picked: Picked
): PickState {
  return childOn(row, child, picked) ? "on" : "off"
}

/**
 * Ticks or unticks a row, or one child of it.
 *
 * Addressed by the row and then the child, not by text alone: a child's text
 * can *be* the row's — that is the `GNS_DISABLED` case — and the two are
 * different gestures. The row is "every line under me"; the child is its own
 * item.
 *
 * A lone row and a child toggle what they write. A group's row ticks every
 * line that is not ticked, or, when they all are, unticks them; it is a
 * shortcut and never an item. Where one of those lines writes the bare
 * identifier, that is what ticking them all comes to, since it takes the
 * rest — and the keys beside it are dropped as the noise they would be.
 */
export function togglePick(
  rows: PickRow[],
  picked: Picked,
  rowText: string,
  childId?: string
): Set<string> {
  const next = new Set(picked)

  const row = rows.find((candidate) => candidate.text === rowText)
  if (!row || row.taken) return next

  if (!isGroup(row)) {
    if (!next.delete(row.text)) next.add(row.text)
    return next
  }

  const settle = (): Set<string> => {
    // The identifier takes every panel here, so keys beside it say nothing.
    if (next.has(row.text))
      for (const child of row.children)
        if (child.text !== row.text) next.delete(child.text)
    return next
  }

  if (childId === undefined) {
    const open = row.children.filter((child) => !child.taken)
    const all = open.every((child) => childOn(row, child, next))
    for (const child of open)
      if (all) next.delete(child.text)
      else next.add(child.text)
    return settle()
  }

  const child = row.children.find((entry) => entry.id === childId)
  if (!child || child.taken) return next

  if (childOn(row, child, next)) {
    // Covered by the identifier rather than ticked itself: unticking it means
    // "all but this one", which only the other lines' own texts can say.
    if (!next.has(child.text) && next.delete(row.text))
      for (const other of row.children)
        if (
          other.text !== child.text &&
          other.text !== row.text &&
          !other.taken
        )
          next.add(other.text)
    next.delete(child.text)
    return next
  }

  next.add(child.text)
  return settle()
}

/** What will be written, in the order the list shows it, each text once. */
export function pickedTexts(rows: PickRow[], picked: Picked): string[] {
  const out = new Set<string>()

  for (const row of rows) {
    if (!isGroup(row)) {
      if (picked.has(row.text)) out.add(row.text)
      continue
    }
    for (const child of row.children)
      if (picked.has(child.text)) out.add(child.text)
  }
  return [...out]
}

/** FS Copilot's routing key, from the two things it is made of. */
export function panelKey(identifier: string, url: string): string {
  const at = url.indexOf("?")
  return at >= 0 ? `${identifier}|${url.slice(at + 1)}` : identifier
}

/**
 * The facts table — each mechanism stated once, with where it comes from.
 *
 * Not a string registry; docs/copy.md rejects one and is right to. A
 * diagnostic's verdict belongs beside the code that reaches it. What lives
 * here is the other half: the *mechanism* — what FS Copilot or the simulator
 * does — which used to be retold inside every message, hover and completion
 * doc that leaned on it, a little differently each time. The `skp:` direction
 * was written down four times and was wrong in all four; that is what copies
 * do.
 *
 * So a fact is said here, once, and cited by id. A rule's `why` names the
 * facts its verdict rests on, and the venue with room for them — the hover's
 * Why section today, a reference page later — renders the statements.
 *
 * ## Basis is provenance, and nothing else
 *
 * `basis` says where a fact comes from. It does not set a diagnostic's
 * severity or its confidence — an SDK-documented fact can carry an error and
 * a source-read one can carry an info. It is shown so the reader can weigh
 * the claim the way its author did.
 *
 * ## Source-backed facts are swept
 *
 * A `source` fact carries anchors: a file under FS Copilot's `src/` and a
 * verbatim single-line snippet. `npm run check:claims` greps every one
 * against a checkout, so a fact that FS Copilot has moved out from under
 * fails a sweep rather than staying quietly untrue. Line numbers drift;
 * anchors survive — the convention docs/fscopilot-behavior.md already keeps
 * by hand.
 */

export type Basis =
  /** Read from FS Copilot's source. Carries anchors. */
  | "source"
  /** True of the text itself — no outside knowledge involved. */
  | "grammar"
  /** What the MSFS SDK documentation says. */
  | "sdk-docs"
  /** Reported by the simulator about the aircraft that is loaded. */
  | "observed"
  /** Established by an experiment in the simulator. */
  | "probed"
  /** What the installed profiles do. */
  | "corpus"

/**
 * How a basis is named to the reader — the hover's chip. One pattern, "Based
 * on …", so the chip reads as a kind of thing before it reads as words.
 *
 * `grammar` has none, on purpose: an unclosed paren is its own evidence, and
 * a chip saying so would be a label on the obvious.
 *
 * `observed` is "live sim data" rather than anything about "the loaded
 * aircraft", which could as easily mean the profile open in the app. It is
 * always the user's own simulator, and only ever about the aircraft the open
 * file is the profile for — see `aircraft-evidence.ts`.
 */
export const BASIS_LABEL: Record<Basis, string | null> = {
  source: "Based on FSC source code",
  grammar: null,
  "sdk-docs": "Based on the MSFS SDK docs",
  observed: "Based on live sim data",
  probed: "Based on sim testing",
  corpus: "Based on other profiles",
}

export interface Anchor {
  /** Path under FS Copilot's `src/`, forward-slashed. */
  file: string
  /** A verbatim snippet from one line of it. */
  anchor: string
}

export interface Fact {
  /**
   * The mechanism, in markdown. What happens, not what to do about it: the
   * remedy belongs to the diagnostic, which knows the line.
   */
  statement: string
  basis: Basis
  /** Required in spirit for `source`; `facts.test.ts` makes it required in fact. */
  anchors?: Anchor[]
  /** Where a fact that is not source-backed was established. For maintainers. */
  record?: string
}

const DEFINITIONS = "FsCopilot/Simulation/Definitions.cs"
const COORDINATOR = "FsCopilot/Simulation/Coordinator.cs"

export const FACTS = {
  "master-parsed-not-run": {
    statement:
      "A `master:` setter is never run as RPN. FS Copilot matches the built " +
      "text against `args (>NAME, units)`, splits `args` on spaces and reads " +
      "each one as a number — anything that is not a number becomes 0.",
    basis: "source",
    anchors: [
      {
        file: DEFINITIONS,
        anchor:
          "var set = ParseSet(value, current ?? value, out var units, out var values);",
      },
      { file: DEFINITIONS, anchor: '[GeneratedRegex(@"^(?<args>.*?)' },
      {
        file: DEFINITIONS,
        anchor: "object ParseParam(string p) => uint.TryParse(p, out var ui)",
      },
    ],
  },

  "master-fallback": {
    statement:
      "When a `master:` setter does not end in `(>NAME)`, FS Copilot sets " +
      "the text aside and writes the incoming value to the `get:` variable.",
    basis: "source",
    anchors: [
      { file: DEFINITIONS, anchor: "if (!m.Success)" },
      { file: DEFINITIONS, anchor: "values = [value];" },
      { file: DEFINITIONS, anchor: "return Get;" },
    ],
  },

  "unknown-key-fails-load": {
    statement:
      "FS Copilot's YAML reader throws on a key it doesn't recognize. The " +
      "exception is caught and logged, and the file is treated as empty — " +
      "its own entries and everything it includes.",
    basis: "source",
    anchors: [
      { file: DEFINITIONS, anchor: "// .IgnoreUnmatchedProperties()" },
      {
        file: DEFINITIONS,
        anchor:
          'Log.Error(e, "[Definitions] Failed to load {Module} configuration", path);',
      },
      { file: DEFINITIONS, anchor: "node = DefinitionNode.Empty;" },
    ],
  },

  "k-bare-pops-one": {
    statement:
      "`(>K:EVENT)` with no arity pops one value from the stack, and the " +
      "event's other parameters are 0. `(>K:2:EVENT)` pops two.",
    basis: "probed",
    record: "docs/sim-vars/build/v1-log.md, 2026-08-29, The arity probes",
  },

  "k-zero-pushed-last": {
    statement:
      "An event's `[0]` parameter is popped from the top of the stack, so it " +
      "is the value pushed last — nearest the call.",
    basis: "probed",
    record: "docs/sim-vars/build/v1-log.md, 2026-08-29, The arity probes",
  },

  "input-events-listed-by-id": {
    statement:
      "The simulator lists input events by ID. An aircraft defines actions " +
      "on an ID — `_Set`, `_Toggle`, `_Push` and others — and a profile " +
      "usually writes the ID with an action after it. The list holds the ID " +
      "only.",
    basis: "probed",
    record:
      "docs/sim-vars/build/v1-log.md, 2026-09-03, The input-event table lists IDs",
  },

  "b-write-needs-action": {
    statement:
      "Whether a write to an input event lands is decided by the code the " +
      "aircraft attached to the action. Writing to a bare ID had no effect " +
      "when tested. Reading a bare ID is correct.",
    basis: "probed",
    record: "docs/sim-vars/build/v1-log.md, 2026-08-29, The arity probes",
  },

  "b-value-on-id": {
    statement:
      "An input event's value is read from its ID. A name ending in an " +
      "action — `_Set`, `_Inc`, `_Dec` — names something to fire, not " +
      "something to read.",
    basis: "sdk-docs",
    record: "MSFS SDK, Input Events",
  },

  "input-events-register-late": {
    statement:
      "The simulator's variable table keeps filling in after an aircraft " +
      "loads — instruments initialise and add-ons start. That was measured " +
      "for `L:` variables. It has not been measured for input events, so a " +
      "missing one is treated as possibly late rather than certainly absent.",
    basis: "probed",
    record:
      "docs/sim-vars/build/v1-log.md — 784 L: names appeared between two snapshots of one aircraft; carried to input events by analogy in src/main/sim/session.ts",
  },

  "momentary-reads-zero": {
    statement:
      "A momentary control — a push button — reports 0 every time it " +
      "fires. Its value never changes, so reading it says nothing about " +
      "what it controls. Nothing in the simulator says which controls are " +
      "momentary; it shows only when one is worked.",
    basis: "probed",
    record:
      "docs/sim-vars/build/v1-log.md, 2026-09-04, The B: subscription is a change feed",
  },

  "calculator-read-creates": {
    statement:
      "Reading a variable through the calculator creates it when it does " +
      "not exist. FS Copilot reads through the calculator, so an absent " +
      "variable becomes a present one holding 0. The sim module reads by " +
      "typed id, which does not create — that is how the app can tell the " +
      "variable was never there. Tested on a `Z:` variable.",
    basis: "probed",
    record:
      "docs/sim-vars/build/v1-log.md, 2026-08-27, Protocol 4 verified in the sim",
  },

  "bare-word-ignored": {
    statement:
      "The calculator ignores a bare name. It reads nothing, writes nothing " +
      "and fires nothing, and the code after it still runs. `(>NAME)` is " +
      "the only way calculator code writes.",
    basis: "probed",
    record: "docs/sim-vars/build/v1-log.md, 2026-08-29, Bare words are ignored",
  },

  "unit-ignored-without-units": {
    statement:
      "Events, functions and lookups have no units. A unit written on one " +
      "is accepted and ignored — `(>K:2:KOHLSMAN_SET, Bool)` behaved " +
      "exactly as it does without the unit.",
    basis: "probed",
    record:
      "docs/sim-vars/build/v1-log.md, 2026-08-29, The get: line gets its mapper",
  },

  "ns-fired-not-read": {
    statement:
      "Key events, HTML events and sound events are fired. None of them " +
      "holds a value, so reading one gives nothing. An HTML event is a " +
      "one-way message into the aircraft's own JavaScript.",
    basis: "sdk-docs",
    record: "MSFS SDK, Reverse Polish Notation — variable types",
  },

  "ns-read-only": {
    statement:
      "Mouse, gauge, GPS, resource, mission and function references belong " +
      "to the simulator's own code and cannot be written from outside it. " +
      "Environment variables are read-only, except `E:SIMULATION RATE`.",
    basis: "sdk-docs",
    record: "MSFS SDK, Reverse Polish Notation — variable types",
  },

  "sdk-settable": {
    statement:
      "The SDK lists each simulation variable as settable or not. Other " +
      "profiles write several it calls read-only, and FS Copilot writes " +
      "`A:` variables through SimConnect rather than the calculator, so " +
      "the SDK's word is not the last one.",
    basis: "sdk-docs",
    record: "src/shared/lang/rules/setter-shape.ts, not-settable",
  },

  "setter-kind-by-shape": {
    statement:
      "FS Copilot picks how to treat a `set:` from its characters. " +
      "Containing any of `'` `` ` `` `?` `{` `}` makes it JavaScript, with " +
      "`value` and `current` in scope. Otherwise, starting with `(` puts " +
      "the incoming value in front. Otherwise it is sent as written.",
    basis: "source",
    anchors: [
      {
        file: DEFINITIONS,
        anchor: "_set.IndexOfAny(['\\'', '`', '?', '{', '}'])",
      },
      {
        file: DEFINITIONS,
        anchor: "if (_set.StartsWith('(')) return $\"{valueStr} {_set}\";",
      },
    ],
  },

  "implicit-setter": {
    statement:
      "With no `set:`, FS Copilot writes the incoming value straight to the " +
      "`get:` variable, units included.",
    basis: "source",
    anchors: [
      {
        file: DEFINITIONS,
        anchor: "if (_set == null) return !string.IsNullOrWhiteSpace(Units)",
      },
    ],
  },

  "skp-marks-on-send": {
    statement:
      "`skp:` names a second variable whose next change is not sent out. " +
      "The mark is registered when **this** entry sends, and only from a " +
      "`shared:` entry — it is for a control whose one press moves two " +
      "synced variables. Only shared entries' outgoing changes are " +
      "filtered, so the name has to be some `shared:` entry's `get:` for " +
      "anything to be held back. A mark is spent by the first change, or " +
      "expires 2 seconds after it was set.",
    basis: "source",
    anchors: [
      {
        file: COORDINATOR,
        anchor: "if (!master && def.Skip != null) Skip.Next(def.Skip);",
      },
      {
        file: COORDINATOR,
        anchor: "if (!master) simRx = simRx.Where(_ => !Skip.Should(getVar));",
      },
      {
        file: "FsCopilot/Simulation/Skip.cs",
        anchor:
          "private static readonly TimeSpan ResetAfter = TimeSpan.FromSeconds(2);",
      },
    ],
  },

  "echo-held-back-automatically": {
    statement:
      "Applying an incoming value to a `shared:` entry marks that entry's " +
      "own `get:` first, so the change it causes is not sent straight back " +
      "to the other pilot. This is automatic and needs no `skp:`. A " +
      "`master:` entry needs none either: it sends only from the pilot in " +
      "control, who is not the one applying.",
    basis: "source",
    anchors: [
      { file: DEFINITIONS, anchor: "if (fromPeer) Simulation.Skip.Next(Get);" },
      {
        file: COORDINATOR,
        anchor: ".Where(_ => !master || !_masterSwitch.IsMaster)",
      },
    ],
  },

  "bare-name-not-streamed": {
    statement:
      "A name with no `X:` prefix reaches neither the simulator nor the " +
      "calculator. FS Copilot's stream falls through every branch and " +
      "returns nothing, and a write matches no branch either. The entry is " +
      "inert — nothing is read, sent or applied.",
    basis: "source",
    anchors: [
      {
        file: "FsCopilot/Connection/SimClient.cs",
        anchor: "return Observable.Empty<object>();",
      },
      {
        file: "FsCopilot/Connection/SimClient.cs",
        anchor: "if (name.Length > 2 && name[1] == ':')",
      },
    ],
  },

  "shared-runs-in-calculator": {
    statement:
      "A `shared:` setter is run by the simulator's calculator exactly as " +
      "built. There is no fallback — a setter that writes nothing applies " +
      "nothing.",
    basis: "source",
    anchors: [{ file: DEFINITIONS, anchor: "sim.Execute(expression);" }],
  },

  // No rule cites this since `toggle-guard` was retired (2026-09-19): the skip
  // happens only when the two sides already agree, so the accidental case
  // was never worth a diagnostic. Kept because the mechanism is real — the
  // setter templates describe it and the entry trace will show it as a step.
  "toggle-guard": {
    statement:
      "FS Copilot skips a `shared:` setter when the built text writes " +
      "`>K:` or `>B:`, contains `TOGGLE` anywhere in any case, and the " +
      "incoming value equals the current one. The test is on the whole " +
      "text, not on the name being written.",
    basis: "source",
    anchors: [
      {
        file: DEFINITIONS,
        anchor:
          '&& expression.Contains("TOGGLE", StringComparison.OrdinalIgnoreCase)',
      },
      { file: DEFINITIONS, anchor: "&& value.Equals(current)) return;" },
    ],
  },

  "one-subscription-per-entry": {
    statement:
      "FS Copilot gives every entry its own subscription and keeps no " +
      "table of names. A name declared twice is sent twice on every change " +
      "and applied twice on every incoming value.",
    basis: "source",
    anchors: [
      {
        file: COORDINATOR,
        anchor: "foreach (var def in definitions) AddLink(def);",
      },
      {
        file: DEFINITIONS,
        anchor: "var simVars = master.Concat(shared).ToArray();",
      },
    ],
  },

  "block-authority": {
    statement:
      "A `master:` entry sends only from the machine in control and applies " +
      "only on the others. A `shared:` entry sends and applies everywhere.",
    basis: "source",
    anchors: [
      {
        file: COORDINATOR,
        anchor: ".Where(_ => !master || _masterSwitch.IsMaster);",
      },
      {
        file: COORDINATOR,
        anchor: ".Where(_ => !master || !_masterSwitch.IsMaster)",
      },
    ],
  },

  "include-missing-skipped": {
    statement:
      "An `include:` path is resolved from the Definitions folder, not from " +
      "the file that includes it. A file that isn't there is skipped with " +
      "one log line, and loading carries on without it.",
    basis: "source",
    anchors: [
      {
        file: DEFINITIONS,
        anchor:
          "Path.Combine([AppContext.BaseDirectory, \"Definitions\", ..path.Split('/')])",
      },
      {
        file: DEFINITIONS,
        anchor:
          'Log.Information("[Definitions] Failed to load {Module} configuration", path);',
      },
      { file: DEFINITIONS, anchor: ".Where(def => def.loaded)" },
    ],
  },

  "updated-date-compared": {
    statement:
      "FS Copilot reads a profile's date from a `# Updated:` line and " +
      "offers an update when a published profile for the aircraft has a " +
      "later one. With no date it uses the earliest date there is, so any " +
      "published version counts as newer.",
    basis: "source",
    anchors: [
      {
        file: DEFINITIONS,
        anchor: "TryReadUpdatedUtc(cfgFile) ?? DateTime.MinValue",
      },
      {
        file: "FsCopilot/ViewModels/MainViewModel.cs",
        anchor: "updatedAt != null && updatedAt > defs!.UpdatedAt",
      },
    ],
  },

  "ignore-is-a-set": {
    statement:
      "`ignore:` names are read into a set and matched exactly, including " +
      "case. A repeat changes nothing, and a name that matches no panel " +
      "does nothing — there is no error either way.",
    basis: "source",
    anchors: [
      {
        file: COORDINATOR,
        anchor: "foreach (var i in definitions.Ignore) _ignore.Add(i);",
      },
      {
        file: COORDINATOR,
        anchor: ".Where(i => !_ignore.Contains(i.Instrument))",
      },
    ],
  },

  "pointer-matches-exactly": {
    statement:
      "A `pointer:` item is handed to every panel, and a panel that does " +
      "not find itself in the list carries on as it was. Names are matched " +
      "exactly, including case, and a miss is silent.",
    basis: "probed",
    // hook.js `_configure`, which upstream does not have yet. Move this to
    // `source` with an anchor once the pointer PR lands there.
    record: "src/shared/lang/rules/panel-missing.ts, file comment",
  },

  "panel-key-query": {
    statement:
      "The part of a panel key after the `|` is the instrument's URL " +
      "query. An aircraft can fill it in from the livery, so a key that " +
      "matches on one livery can match nothing on another. The identifier " +
      "alone takes every panel that reports it.",
    basis: "probed",
    record: "src/shared/lang/rules/panel-missing.ts, file comment",
  },
} as const satisfies Record<string, Fact>

export type FactId = keyof typeof FACTS

/** A fact by id, widened — `FACTS` itself is `as const` for the key type. */
export function factOf(id: FactId): Fact {
  return FACTS[id]
}

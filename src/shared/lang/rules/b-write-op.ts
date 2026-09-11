/**
 * `b-write-op` — a `B:` input event written without an operation.
 *
 * Reading uses the bare preset name; writing requires a generated operation
 * — `_Set`, `_Inc`, `_Dec`, or a vendor's `_Toggle`/`_On`/`_Off`. A bare
 * name in write position does nothing, silently, which reads exactly like a
 * setter that works. The inverse matters too: reading a suffixed name asks
 * for the value of an *operation*, which is almost never what a `get:`
 * meant.
 *
 * Parser-backed — no external evidence — so it always runs.
 *
 * Warning, not error — calibrated by the first corpus sweep: the Aerosoft
 * CRJ alone writes bare presets 81 times (`_KEY_PUSH`, `_SHOW_HIDE` — names
 * that *are* the action, with no generated suffix family). Either every one
 * is quietly broken or a bare write is sometimes valid; until an in-sim
 * probe decides, a warning is the honest strength.
 */

import { diagnose, type Rule, type Diagnostic } from "../rules.ts"

/**
 * The probe answered (v1-log 2026-08-29, "The arity probes"): do NOT flip.
 * Bare writes ARE dead air on a state preset — but per-preset, not by
 * grammar: vendors name action presets `..._Push`/`..._KEY_Release`, full
 * Preset IDs our op regex cannot segment, and whether any write lands is
 * decided by set-code authored on that preset. The branch returns as an
 * evidence rule (aircraft's enumerated input events), never as this one.
 */
const BARE_WRITE_MUTED = true

export const bWriteOp: Rule = {
  id: "b-write-op",
  family: "sim",
  run(doc) {
    const out: Diagnostic[] = []

    for (const node of doc.nodes) {
      if (node.kind !== "ref" || node.ref.ns !== "B") continue

      // The name's span inside the token, computed once: the fixes below
      // must edit exactly the name, never a unit sitting after the comma.
      const nameAt = node.token.start + node.token.text.indexOf(node.ref.name)

      /*
       * The bare-write warning is MUTED pending the in-sim probe.
       *
       * The premise — a bare preset cannot be written — came from the SDK
       * docs and the avionics framework. The corpus disagrees at scale:
       * once diagnostics reached refs inside JS strings, the count hit 529,
       * nearly all Aerosoft CRJ presets *named as actions* (`…_KEY_Push`,
       * `…_KEY_Release`, `…_SHOW_HIDE`) and written bare in payware people
       * fly daily. Either all of it is quietly broken or bare writes work;
       * a premise with 529 counterexamples does not get to warn. One exec
       * session settles it — see 18-language-core's probe list.
       */
      if (!BARE_WRITE_MUTED && node.access === "write" && node.ref.op === null) {
        // `_Set` is the fix offered because a write with a pushed value is
        // the Set shape; the message names the others for the cases where
        // the author meant a nudge.
        const end = nameAt + node.ref.name.length
        out.push({
          ruleId: "b-write-op",
          severity: "warning",
          start: node.token.start,
          end: node.token.end,
          message:
            `B:${node.ref.name} is written through one of its operations — ` +
            `_Set, _Inc, _Dec (some aircraft add _Toggle, _On, _Off). ` +
            `The bare preset cannot be set.`,
          fix: {
            title: `Change to B:${node.ref.name}_Set`,
            edits: [{ start: end, end, newText: "_Set" }],
          },
        })
      }

      if (node.access === "read" && node.ref.op !== null) {
        // The suffix is the tail of the name past the preset — deleted
        // exactly, leaving any unit after the comma untouched.
        const suffixAt = nameAt + node.ref.preset.length
        out.push(
          diagnose({
            ruleId: "b-write-op",
            severity: "warning",
            // "Op" is a naming convention, not a sim mechanism (b-preset.ts):
            // a vendor can name a whole ID `..._Push`. Likely, never more.
            confidence: "likely",
            basis: "sdk-docs",
            why: ["b-value-on-id"],
            start: node.token.start,
            end: node.token.end,
            verdict: `B:${node.ref.name} names an action, not a value.`,
            consequence:
              `Reading it will probably not give the control's position — ` +
              `that is probably on B:${node.ref.preset}.`,
            fix: {
              title: `Change to B:${node.ref.preset}`,
              edits: [
                {
                  start: suffixAt,
                  end: nameAt + node.ref.name.length,
                  newText: "",
                },
              ],
            },
          })
        )
      }
    }

    return out
  },
}

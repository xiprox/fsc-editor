/**
 * Turning a written `B:` name into the IDs the simulator might know it by.
 *
 * `EnumerateInputEvents` returns `<InputEvent ID=...>` values, and profiles
 * write `<ID>_<Preset>`. Measured on the A220, 2026-09-03: of 464 enumerated
 * names exactly **one** ends in a generated operation, so a written name
 * usually is not in the table and its base usually is.
 *
 * Two callers need that mapping and must not disagree about it. `b-preset.ts`
 * asks "does this aircraft have the control" to decide whether to warn;
 * `session.ts` asks "which hash do I read" to put a value in the gutter. A
 * name the rule calls present and the resolver cannot find would be a warning
 * that contradicts the value on the same line — so the stripping lives here,
 * once, and both import it.
 *
 * One trailing `_Word` comes off, and which word is unknowable: `_Push` and
 * `_Set` are the same shape, and the 2026-08-28 entry in v1-log.md established
 * that no static rule can tell an operation suffix from part of an ID — the
 * A220 names controls `AIRLINER_FCU_SPD_PUSH` *and* `AIRLINER_FCU_SPD_PUSH_PUSH`,
 * both genuine.
 *
 * **A purely numeric suffix is the one exception**, because it is an index
 * rather than a preset. No preset is a bare number, and 71 of the corpus's 919
 * distinct `B:` names end in one — `ELECTRICAL_Alternator_1` beside
 * `ELECTRICAL_Alternator_2`, `DEICE_Pitot_1` beside `_2`. Stripping it makes
 * every numbered control resolve to its siblings: harmless while this only
 * suppressed a missing-control warning, and a wrong number in the gutter once
 * the same list decides which value a line shows.
 */

/**
 * The IDs a written `B:` name could mean, most specific first and deduplicated.
 *
 * `name` and `preset` are `parseVar`'s fields — the name as written, and the
 * form with a known operation suffix already removed. Both are tried before
 * the blind strip, so a name the parser has already split is never asked about
 * twice, and callers should take the first that the aircraft knows.
 */
export function inputEventIds(name: string, preset: string): string[] {
  // The suffix must contain a letter to be a preset. A bare number is an
  // index, and `_1` and `_2` are different controls.
  const base = /^(.*)_(?=[0-9]*[A-Za-z])[A-Za-z0-9]+$/.exec(name)?.[1]

  return [...new Set([name, preset, base])].filter(
    (id): id is string => id !== undefined && id.length > 0
  )
}

/**
 * The enumerated input event a `B:` name continues, and what follows the
 * underscore after it: `AIRLINER_FCU_CHRONO_2_Pu` is `AIRLINER_FCU_CHRONO_2`
 * and `Pu`.
 *
 * `ids` maps each enumerated ID, lowercased, to its own spelling — the
 * calculator does not care about case, and the enumeration's casing is the one
 * to write back. The longest ID the name extends by an underscore wins, so
 * `…_SPD_PUSH_` is read as the ID `…_SPD_PUSH` and an empty suffix rather than
 * `…_SPD` and `PUSH_`: the A220 enumerates both. Null when the name continues
 * no enumerated ID — including a name that *is* one, which has no underscore
 * after it yet.
 */
export function inputEventOf(
  name: string,
  ids: ReadonlyMap<string, string>
): { id: string; suffix: string } | null {
  for (
    let at = name.lastIndexOf("_");
    at > 0;
    at = name.lastIndexOf("_", at - 1)
  ) {
    const id = ids.get(name.slice(0, at).toLowerCase())
    if (id) return { id, suffix: name.slice(at + 1) }
  }
  return null
}

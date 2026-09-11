/**
 * "Did you mean" — the policy, not just the arithmetic.
 *
 * Edit distance is the easy half. The half that decides whether a suggestion
 * helps or misleads is *when to offer one at all*, and 18-language-core has
 * the scar to prove it: nearest-match over variable names was struck after
 * measuring 16 wrong suggestions in 18, because unknown names cluster in
 * numbered families and the nearest neighbour of `A:COM2 STORED FREQUENCY`
 * is confidently `COM1`, which is not what anybody meant.
 *
 * So the rule here is deliberately strict, and lives in one place rather
 * than in each caller: a suggestion is offered only when **exactly one**
 * candidate is within the budget. A tie, or a crowd, means the neighbourhood
 * is ambiguous and the diagnostic ships without a fix — which is still the
 * useful half.
 *
 * That leaves it fit for closed vocabularies — the four block keys, the
 * filenames in one directory — and unfit for open ones, which is exactly the
 * distinction the doc draws.
 */

/** Levenshtein, abandoned as soon as it cannot come in under `max`. */
export function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1

  const row = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]!
    row[0] = i
    let best = i

    for (let j = 1; j <= b.length; j++) {
      const above = row[j]!
      row[j] = Math.min(
        above + 1,
        row[j - 1]! + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
      best = Math.min(best, row[j]!)
      diagonal = above
    }

    if (best > max) return max + 1
  }

  return row[b.length]!
}

/**
 * The one candidate within `max` edits, or null when there is none — or more
 * than one, which is the case this exists to refuse. Case-insensitive, since
 * every vocabulary it is used on is.
 */
export function nearest(
  target: string,
  candidates: readonly string[],
  max = 2
): string | null {
  const key = target.toLowerCase()
  const close = candidates.filter(
    (candidate) => distance(candidate.toLowerCase(), key, max) <= max
  )

  return close.length === 1 ? close[0]! : null
}

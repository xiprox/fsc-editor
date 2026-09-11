# Variables panel

    Purpose:    The standalone right-hand view over the database.
    Depends on: 05-data-model
    Decides:    search specification, ranking, filters, row content

> **Amended by the build.** Which rows can carry a live value is no longer a
> panel-local predicate: `readable()` asks the descriptor table
> (`src/shared/vars/namespaces.ts`), whose `why` strings are the copy for rows
> nothing can read. See "One parser, one descriptor table" in
> [build/v1-log.md](build/v1-log.md).

> **Amended by the build.** `in sim` means **observed to move while this
> aircraft was loaded**, not declared by it. Enumeration returns ~6,150 `L:`
> variables regardless of which aircraft is in the sim — the table is global and
> nothing is added or removed on a swap — so there is no runtime signal for "this
> aircraft's". Observation is, and it is the better question anyway: a variable
> that never moves cannot be the one a switch moved. See "The `L:` table is
> global" in [build/v1-log.md](build/v1-log.md).

> **Amended by the build.** The note above is an `L:` fact, not a general one.
> `B:` **is** declared per aircraft: `EnumerateInputEvents` answers for the
> aeroplane in front of you, with names, needing no module. Those names now fold
> into the index as an `aircraft` facet (`inputEvent`), count as "this aircraft"
> for the filter, and lead the sort — and the names are `<InputEvent ID>`s,
> which is not what a working `B:` reference looks like, so the panel says so in
> a line above the list. See "The panel never saw the enumeration" in
> [build/v1-log.md](build/v1-log.md).

> **Amended by the build.** Rank `in sim` as **binary** — has this variable ever
> moved on this aircraft — not by how often. Measured on a live session, two
> clock-like variables were 88% of all change records while 418 of 428 variables
> moved once or twice, so frequency would bury every switch under a counter. See
> "Change count is the wrong ranking signal" in
> [build/v1-log.md](build/v1-log.md).

> **Partly built (stage 1b).** The search, ranking, namespace filters, rows and
> expandable detail exist. The `in sim` and `new` filters, live values, probe,
> insert-at-cursor and reveal-in-Activity do not — they need evidence that only
> a sim connection produces. See the log entry "Variables panel pulled forward
> into v1" in [build/v1-log.md](build/v1-log.md).

A right-hand panel with its own rail button, independent of Activity and of
Remote Connect. It is the database viewer: everything known about every
variable, from every source, whether or not the sim is connected.

Layout in [15-ui-surfaces](15-ui-surfaces.md).

## Search is the feature

The complaint this exists to fix is specific: tools like SPAD.neXt treat a
query as a literal substring, so one extra space breaks it. Concretely, what to
do instead.

**Normalize both sides.** Case-fold, and collapse `_`, `-`, spaces and camelCase
boundaries to a single separator. `XMLVAR_BATTERYSTBY_SWITCHSTATE` tokenizes to
`xmlvar battery stby switch state`.

**Unordered token AND.** `switch battery` matches the above. This alone fixes
most of the pain.

**Subsequence and initials**, as a lower tier: `bss` → **B**attery**S**tby**S**witch.

**Namespace prefixes are filters, not text.** Typing `L:` narrows the namespace
rather than searching for a colon.

**Structured filters inline** — `ns:L`, `used:>3`, `aircraft:current`,
`unseen:` — mirrored as chips so they are discoverable rather than folklore.

## Ranking

Tiers, in order: exact, prefix, whole-token, subsequence. **Tie-broken by
corpus `fileCount`.**

That tiebreak is the asset. No other tool has a corpus of working profiles, so
no other tool can sort by how many real aircraft profiles use a variable. It is
a better default than alphabetical and it costs nothing.

## Filters

- **in sim** — has sim evidence for the current aircraft
- **new** — sim evidence, no corpus evidence: the undocumented list
- **unused** — discovered but not bound in the current profile
- **namespace**
- **aircraft** — current, any, or a specific one

These are queries against the evidence table, not maintained flags. See
[05-data-model](05-data-model.md).

## Row content

Name, usage count, and — when connected — the live value.

Expanded: units seen and how often, the best documentation comment, enclosing
headings, the profiles that use it, distinct `set:` expressions, tooltip label
if Analysis found one, and probe results if it has been probed.

Everything above already exists in `VarEntry` except the sim, static and probe
evidence.

## Actions

- insert into the open profile at the cursor, as a formatted entry
- probe it ([10-probe](10-probe.md))
- reveal in Activity — filter the feed to findings mentioning it
- copy name

## Without a connection

Fully useful: the corpus is 12,000 variables and does not need the sim. The
in-sim and new filters grey out, live values are absent, probe is unavailable.
Nothing else changes.

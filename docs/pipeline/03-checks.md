# Checks — what runs on a pull request

    Purpose:    What CI verifies, what it cannot, and how the corpus sweeps
                were made testable without being turned into CI jobs.
    Depends on: 02-deployables
    Decides:    the PR job, the committed corpus, assertions extracted into
                modules, golden files, the five scripts that stay out

## The PR job

One job, [.github/workflows/pr.yml](../../.github/workflows/pr.yml). Non-PR
pushes to `main` are disabled, so this is the only way anything arrives.

| Step | Why |
| --- | --- |
| ~~`npm run lint`~~ | **Not a step.** See below |
| ~~`npm run format:check`~~ | The script now exists; the step does not. See below |
| `npm run check:module` | Three greps and a hash — see [08-module](08-module.md) |
| `npm test` | vitest, including the corpus tests below |
| `npm run relay:check` | The relay compiles against the app's shared module — this is what makes editor/relay parity structural rather than maintained |
| `npm run build` | Bundles main, preload and renderer, and runs `tsc -b` on the way in, which is why there is no separate typecheck step. `electron-builder` runs only on release |
| `npm run check:cascade` | Against the merge base, **non-blocking** — see below |

Cheapest first, so an obvious failure does not wait behind a bundle.

**It runs on `windows-latest`**, not the cheaper Ubuntu. This is a Windows
application — it reads the registry, drives an executable, and writes into a
game's Community folder — and the tests carry paths and fixtures that assume it.
A green run on a platform nobody ships from is a weaker claim than it looks.

## Why lint and formatting are not checked

Neither passes today.

| | Today |
| --- | --- |
| `npm run lint` | **123 errors**, 6 warnings, across ten areas of `src/` and one script. Irregular whitespace, useless escapes, a `react-hooks` incompatibility in the virtualizer |
| `npm run format:check` | **484 files.** The tree has never been formatted with the prettier config sitting in it. The disagreement is mostly wrapping, and it runs the unexpected way — prettier wants to *unwrap* signatures that were broken across lines by hand |

Both would therefore fail the first pull request and every one after it. And
satisfying either means a sweep of the whole repository — on a tree that
routinely carries weeks of uncommitted work, which is the one thing
[CLAUDE.md](../../CLAUDE.md) is most emphatic about not doing as a side effect
of something else.

Running them non-blocking was considered and rejected for the same reason the
release-preview bot was: **a check that is always red teaches people to ignore
checks**, and one that is ignored is worse than one that is absent, because it
looks like coverage.

So `format:check` exists as a script and neither is a step. Both are one line
the day the tree is clean, and that cleanup is its own piece of work — see
[09-open-questions](09-open-questions.md).

Lint-on-changed-files was also considered, and rejected because it punishes
whoever first touches a file that already had errors. That is a sweep by
ambush.

## check:cascade is the one sweep that belongs here

It catches a class of regression that is invisible in a diff. Tailwind emits
every custom utility *ahead of* its own, so the moment a style fragment moves
out of a component and into an `@utility` in `index.css`, it stops competing on
equal terms with the classes the component still writes beside it — and
whichever of the two used to win may now lose. Nothing says so.

The script compiles the stylesheet twice, once as it is now and once at a git
ref, and compares the resolved cascade for every control. It has already found
two real bugs in code that had been read several times: `Button`'s `destructive`
variant set a focus border and ring the base ring had always overridden, so they
had never once been visible; and `Checkbox`'s
`aria-invalid:aria-checked:border-primary` lost to the base invalid border in
dark mode.

It qualifies for CI because of one line in its own header: *"It needs no corpus,
though — it only reads this repository."* It runs against the merge base, which
is why the PR job checks out full history.

**It does not block a merge**, and that is a compromise rather than a
preference. It exits non-zero on a reordering, and a reordering is a real visual
difference — but a *deliberate* one looks identical to a regression from the
outside, and there is no way to acknowledge one. Red and ignorable beats red and
unmergeable until there is. An acknowledgement mechanism is in
[09-open-questions](09-open-questions.md); the moment it exists, this becomes a
gate.

## What never runs in CI

`check:format`, `check:grammar`, `check:setters` and `check:highlight` need a
`Definitions` folder. `check:claims` needs an FS Copilot checkout at
`~/dev/fsc/src`. Neither exists on a runner, and a test that needs somebody
else's folder is a test that fails on a fresh clone.

> **[CLAUDE.md](../../CLAUDE.md) lists four of these. There are five** —
> `check:claims` is missing from it. Worth correcting there, since the omission
> is exactly how somebody ends up adding it to a workflow.

That is a statement about the *folder*, though, not about the assertions. The
rest of this doc is about separating those two things.

## The corpus

`corpus/` at the repository root — beside `docs/`, `link/`, `relay/` and
`scripts/`. Not under `src/`, because it is not source. It never reaches a
build: `electron-builder.yml`'s `files:` list names `out/**`, `package.json` and
a specific set of `node_modules` paths, so anything at the root is excluded by
construction.

Contents: a real Definitions folder, exhaustively — **58 profiles and 11
modules, 2.1 MB**, which is nothing, and means there is no reason to curate. It
comes from two sources, because a working Definitions folder is assembled from
two: the community profiles at `~/dev/fsc/profiles/definitions` and the shared
module profiles at `~/Documents/Definitions/modules`.

Provenance and date are in [corpus/README.md](../../corpus/README.md), and
`npm run corpus:sync` mirrors both sources — additions, changes and removals —
so refreshing produces a reviewable diff.

### The line endings are load-bearing

Every profile in that folder is **CRLF**. This repository has
**`core.autocrlf=true`**. There is no `.gitattributes`.

Commit the corpus as-is and git stores it as LF, hands it back as CRLF on
Windows and as **LF on a Linux runner** — under a check whose entire contract is
that a save can never alter what FS Copilot loads. The corpus would be a
different byte sequence in CI than on disk.

And the line ending is not incidental to what is being tested.
[src/shared/profile/format.ts](../../src/shared/profile/format.ts) branches on
it: the formatter reads whether the text contains a CRLF and writes back
whichever it found. Normalising the corpus to LF would test the branch nobody
has and skip the branch everybody has.
[src/shared/analysis.ts](../../src/shared/analysis.ts) calls out CRLF too, so it
is not only the formatter.

```
corpus/profiles/** -text
corpus/formatted/** -text
```

Those lines land in the same commit as the first corpus file. Not a workaround
for git; what stops git from silently deleting half the coverage.

No curation was needed to cover both branches. The real folder already carries
the mix: **47 CRLF, 11 LF, and several files that are both within one file** —
which the formatter resolves to a single ending for the whole file, and which is
therefore the most interesting thing several of those profiles have to say.

## The extraction — why nothing "moves into CI"

The four sweeps were written as exploratory tools: bulk input in, report out, a
human reads it. Running one on a runner would be shoehorning. But their
assertions were never script-specific, and that is the part worth having.

So the assertions come out into modules:

```
scripts/checks/corpus.ts      loads the committed corpus, as bytes
scripts/checks/format.ts      checkFormat()
scripts/checks/grammar.ts     checkGrammar()
scripts/checks/highlight.ts   checkHighlight()
scripts/checks/setters.ts     checkSetters()
scripts/checks/corpus.test.ts runs all four over corpus/
```

- `npm test` calls them over `corpus/`.
- `npm run check:format <folder>` calls the same functions over a real folder and
  prints a report.

One implementation, two inputs. All four scripts are rewired through them and
keep their names, their folder argument and their reports. There is already
precedent in-tree: [scripts/entry-compare.ts](../../scripts/entry-compare.ts)
was factored out because `check-format` and `merge-profile` asked the same
question. This is that move, one level further.

**Under `scripts/`, not `src/`**, for one concrete reason: `checkFormat` needs
the `yaml` package as its oracle, and `yaml` is a devDependency. An import of it
sitting in `src/shared` would be a dev-only package reachable from everything
the app bundles — working today only because nothing imports it, which is not a
property worth relying on.

**Two of the four take a visitor.** `checkHighlight` hands each line's spans to
its caller, and `checkSetters` hands over each entry with what every value
resolved to. That is what lets the scripts build their histograms and their
refusal list from the same walk the check performs — resolving a JavaScript
setter *evaluates* it, so a second walk is not free, and two walks eventually
become two opinions about what a well-formed span list is.

### The properties that port

| From | Properties |
| --- | --- |
| `check:format` | Semantic identity, idempotence |
| `check:grammar` | Placement, stability, containment |
| `check:highlight` | Totality, vocabulary, span shape |
| `check:setters` | Resolution never throws |

These state what must be true for any input at all. `check:grammar`'s header
says so outright — *"the assertions are all about what comes out … and none of
them care what went in."*

### The reports that do not

The list of setters FS Copilot silently refuses. The scope histogram. The most
frequent `rpn.word` texts — every word the operator table does not know. These
are discovery, they need files nobody here wrote, and they stay in the scripts.

The sweeps' remaining job, in one sentence: **point them at a Definitions folder
newer than the snapshot, to find shapes the snapshot does not have.**

## Golden files, not snapshots

A property test over 65 real files fails with `a400m.yaml: not idempotent`, and
then you open a 2,000-line file somebody else wrote and bisect it by hand. For a
property that is an acceptable price. For corpus-wide *behaviour change* it is
not — so that gets a different artifact.

```
corpus/profiles/a400m.yaml      as found, CRLF
corpus/formatted/a400m.yaml     what the formatter produces, committed
```

Regenerated by `npm run corpus:golden`, asserted by the corpus test. 52 of the
69 currently differ from their input, which is the formatter doing its job.

A formatter change then appears as a diff of real output, in the file it
happened in, on the line it happened on. No bisecting. It subsumes identity and
idempotence as *review material* rather than only as pass/fail — which matters
more here than in most projects, because the contract is that a save must never
alter what FS Copilot loads, and the diff is the evidence for it. Prettier keeps
its own corpus this way, for the same reason.

The cost is 2 MB and a large diff whenever the formatter legitimately changes.
That diff is the thing you would want to read anyway.

### Aggregate snapshots are deferred

A committed refusal list and a committed scope histogram were considered. They
are not being built yet. A hundred-line snapshot that churns on every change
trains people to run `vitest -u` without reading it, at which point it is worse
than nothing. If they return, they return small — counts per category, three
lines, readable at a glance — not a line per entry.

## Performance

Measured: the corpus tests take **5.3 s** and take the whole suite from 8.4 s to
10.0 s in wall clock, since vitest runs them alongside everything else. They
live in their own file so a watch run can skip them.

Most of that was the setter check, which **evaluates** every JavaScript setter
it resolves. Over 26,781 entries at four values apiece that is twelve seconds —
more than the rest of the suite put together, to re-prove the same property four
times. The test passes one value; the script still passes four, because deciding
whether an entry is *refused* needs them and deciding whether it *throws* does
not.

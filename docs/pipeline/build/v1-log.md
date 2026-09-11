# Pipeline build log

    Purpose:  What the build discovered, and what changed as a result.
    Plan:     v1-plan.md
    Order:    newest first

Findings and decisions, recorded as they happen — the same convention as
[sim-vars/build/v1-log.md](../../sim-vars/build/v1-log.md): a verification that
resolved a question, anything that contradicts a design doc, a decision a later
session would otherwise re-derive, and an approach abandoned **with why**. Not
what got implemented and when; that is what commits are for.

```
## YYYY-MM-DD — one-line summary
Stage:     which stage of v1-plan.md
Expected:  what was believed going in
Found:     what turned out to be true
Changed:   what this changes about the plan, or "nothing"
Affects:   design docs this amends, or "none"
```

---

## 2026-09-20 — release-please runs on a PAT, so that its own pull request gets checked

    Stage:     2 / 7 — publish, and the PR job
    Expected:  The default `secrets.GITHUB_TOKEN` is enough. release-please's
               own documentation uses it.
    Found:     It is enough to *open* the release pull request and not enough
               to make it mergeable. GitHub does not start a workflow run for
               events raised by `GITHUB_TOKEN`, so pr.yml never fires on a
               release pull request — the checks are not red, they are
               **absent**, and an absent check cannot satisfy a required one.
               The one pull request that performs a release would be the one
               pull request that could never be merged under branch
               protection.
               Three ways out, and the choice is not close. Dropping the
               required check makes protection advisory. Merging release pull
               requests with admin bypass does the same thing by hand, every
               time, forever. A PAT costs one secret to store and rotate and
               leaves the rule meaning what it says.
    Changed:   `release.yml` passes `secrets.RELEASE_PLEASE_TOKEN` — a
               fine-grained token on this repository, Contents read/write and
               Pull requests read/write, nothing further. Two consequences
               worth knowing: the release pull request now runs pr.yml like
               any other, and "Allow GitHub Actions to create and approve pull
               requests" stops mattering, because that setting gates
               `GITHUB_TOKEN` alone.
    Affects:   none — no design doc named a token.

## 2026-09-20 — The editor's release-please outputs are not path-prefixed

    Stage:     2 — publish
    Expected:  Manifest mode keys every component's outputs by path, so the
               editor reads as `.--release_created` and the relay as
               `relay--release_created`. Listed in v1-plan as a thing stage 2
               still had to confirm.
    Found:     **Half of that is wrong, and it is the half that matters.**
               `setPathOutput` in release-please-action is
               `if (path === '.') setOutput(key)` else
               `setOutput(`${path}--${key}`)`. The root component — the editor
               — is *unprefixed*. `.--release_created` is never set at all.
               The relay, not being root, was right.
               What makes this worth a log entry rather than a commit message
               is the failure shape. An empty output is not an error: `if:`
               reads it as false and the job is **skipped**. release-please
               would have created the tag, the changelog and a GitHub Release
               for `v0.1.0` with no installer, no blockmap and no `latest.yml`
               inside it — a release that looks finished from the outside, and
               that the README's download link points straight at. And by
               04-versioning's one-way door, `0.1.0` could not then be reused.
               Caught by reading the action's source before the first run
               rather than by the first run, which is the only reason it cost
               nothing.
    Changed:   `release.yml` reads `release_created` and `tag_name` bare, with
               the rule and the failure mode written into the file. Stage 2's
               open question is resolved and stops being one.
    Affects:   none — no design doc named the output keys.

## 2026-09-20 — electron-updater is bundled, and the ring's timer belongs in main

    Stage:     3 / 5 — the updater and the header slot
    Expected:  Add `electron-updater` as a dependency and import it. Put the
               400 ms threshold in the component, since when to draw something
               is a renderer question.
    Found:     **Externalizing it would have been a trap.**
               `externalizeDepsPlugin` makes everything in `dependencies`
               external, and an external module has to be named in
               electron-builder's `files` allowlist or it is simply absent from
               a packaged build — silently, because in a checkout Node
               resolution walks up out of `out/` and finds the repo's own
               `node_modules`. electron-updater's closure is about a dozen
               packages. It is bundled instead, joining `yazl` in the same
               `exclude` list and for the same reason the config already gives.
               **The threshold is not a renderer question after all.** What
               main publishes is already "what there is to say"; deciding the
               same thing twice would leave two places to look when the answer
               is wrong. Main holds the timer, and a download that finishes
               inside 400 ms never produces a `downloading` state at all.
               **`react-hooks/set-state-in-effect` rejected the obvious
               disarm.** Resetting a boolean in an effect keyed on the version
               is lint-illegal, and the fix is better than what it replaced:
               the state holds *which version* the first click was for, so an
               update arriving between the two clicks disarms it by no longer
               matching. Nothing to synchronise.
    Changed:   Nothing about the design. Three implementation facts written
               into 06-updater so they are not rediscovered.
    Affects:   06-updater — amended in three places

## 2026-09-20 — The confirmation survived the control being hidden

    Stage:     5 — the header slot
    Expected:  Nothing. This was found while capturing screenshots of the
                states, which is the only reason it was found at all.
    Found:     Returning `null` from a React component **does not unmount it**,
               so the armed flag lived on while the control was invisible. The
               sequence that breaks it:
                 arm the button          → "Click again to update and restart"
                 a Remote session starts → the slot is hidden, as designed
                 the session ends        → the button returns **still armed**
               One click then restarts the app. That is precisely the
               accidental restart the two-click design exists to prevent, and
               the gate meant to make things safer is what set it up.
               Measured before and after in the running app, by publishing
               state into the store:
                 before   ready → click → hosting → ready   222px, armed
                 after    ready → click → hosting → ready    28px, resting
               The same held for a round trip through `downloading`.
    Changed:   The confirmation moved into its own `ReadyButton`, mounted only
               while there is something to confirm and keyed on the version.
               React now owns every way of disarming it — leaving `ready`
               unmounts it, a session starting unmounts it, a new version
               replaces it — so there is no reset to write and none to forget.
               Worth stating plainly: no test would have caught this, and
               reading the component would not have either. It took looking at
               the states in order.
    Affects:   06-updater — the paragraph describing `armedFor` is replaced

## 2026-09-20 — The control was seen by publishing state, not by faking a feed

    Stage:     3 / 5
    Expected:  The updater and its control could not be looked at from here.
               `electron-updater` refuses to run when `app.isPackaged` is
               false, and the control is suppressed in the same condition, so
               the ring and the reveal looked unverifiable short of a release.
    Found:     Half true, and the useful half is the other one. What cannot be
               exercised is the *updater* — the check, the download, the
               staging. The *control* is a pure function of a state main
               publishes, and publishing that state into a running development
               build is not faking anything: it is the exact value main sends.
               Driven through every state via CDP (the recipe in the
               driving-the-app memory), reading the DOM rather than pixels:
                 downloading 40%  role=progressbar, aria-valuenow 40, 28x28,
                                  arc oklch(0.758 0.096 195) — `--update` — on
                                  a track of `--update-border`, dash offset
                                  37.699 = 62.83 x 0.6, so the arc is exactly
                                  40% of the ring
                 size unknown     no aria-valuenow, the spinning quarter arc
                 ready            28x28, `Update to version 0.2.0 and restart`
                 armed            222x28 — **the height does not change**
                 hosting          the whole slot absent, ring included
               And the measurement that was a guess until now: at the narrowest
               window the app allows (940px) there are **89px** between the
               armed button's right edge and the centred launch island. It does
               not collide.
               Settings' About section renders in a development build on its
               own, since its whole job there is to explain why updates are off.
    Changed:   Nothing about the design — every state came out as drawn. The
               copy-review entries move from `unchecked` to `rendered`, with
               what remains unseen named: the control appearing *by itself*,
               which still needs a packaged build.
    Affects:   none

## 2026-09-20 — The corpus already carried the line-ending mix, and the setter check is the expensive one

    Stage:     8 — the corpus
    Expected:  A corpus of real profiles, all CRLF, with a couple of LF files
               added by hand so the formatter's other branch is covered. Four
               sets of assertions extracted and run over it, costing "probably
               under two seconds".
    Found:     Three things.
               **No curation was needed.** The real folder is 47 CRLF and 11
               LF, and several files are *both within one file* — which
               `formatProfile` resolves to a single ending for the whole file.
               That mix is more interesting than anything that would have been
               written by hand, and it was already there.
               **Five profiles are already invalid YAML.** Not a failure —
               formatting is not expected to fix them — but it means the count
               has to be asserted, or a corpus that quietly became unparseable
               would make the identity check look like it passes while checking
               nothing.
               **The setter check costs twelve seconds**, not two. Resolving a
               JavaScript setter *evaluates* it, and the corpus holds 26,781
               entries tried at four values apiece. That is more than the rest
               of the suite put together, spent re-proving the same property
               four times.
    Changed:   `checkSetters` takes its values as a parameter: the test passes
               one, the script still passes four, because deciding whether an
               entry is *refused* needs them and deciding whether it *throws*
               does not. The suite went from 8.4 s to 10.0 s.
               The modules live in `scripts/checks/` rather than `src/shared/`,
               which 03-checks had guessed. `checkFormat` needs `yaml` as an
               oracle and `yaml` is a devDependency — an import of it inside
               `src/shared` would be reachable from everything the app bundles,
               working only for as long as nothing happens to import it.
               `checkHighlight` and `checkSetters` gained a visitor callback,
               so the scripts' histogram and refusal list come from the same
               walk the assertions do rather than a second one.
    Affects:   03-checks — amended throughout

## 2026-09-20 — The tree passes neither eslint nor prettier, so the PR job checks neither

    Stage:     7 — the PR job
    Expected:  Lint was assumed to pass, since it is an existing npm script in
               an actively developed repository. `format:check` was listed as
               a straightforward gap — a `format` script that writes, nothing
               that verifies — and adding the missing half looked like one line.
    Found:     Both fail, and not marginally.
                 `npm run lint`         123 errors, 6 warnings
                 `npm run format:check` 484 files
               Neither is caused by anything in this change. The prettier
               disagreement runs the unexpected way: it wants to *unwrap*
               signatures that were broken across lines by hand, so adopting it
               means adopting a house style nobody chose.
               Either step would fail the first pull request and every one
               after it. Satisfying either means a sweep of the whole tree —
               the one thing CLAUDE.md is most emphatic about not doing as a
               side effect of something else.
    Changed:   Neither is a step. `format:check` is added as a script so the
               cleanup has something to run. Running them non-blocking was
               rejected on the same grounds as the release-preview bot: an
               always-red check teaches people to ignore checks, and is worse
               than an absent one because it looks like coverage.
               Lint-on-changed-files was rejected too — it punishes whoever
               first touches a file that already had errors, which is a sweep
               by ambush.
    Affects:   03-checks (rewritten section), 09-open-questions (new entry with
               the order the cleanup has to happen in)

## 2026-09-20 — The module's source hash was bootstrapped, not built

    Stage:     0 / 7 — the module guards
    Expected:  `link/build.sh` writes `link/Packages/source.sha256` at the end
               of a build, so the recorded hash always describes the source the
               committed wasm was compiled from.
    Found:     True from the next build onwards, and not true for this one. The
               file was created by running `check:module --hash` against the
               tree as it stands, which records *the source as of now* and
               asserts — rather than proves — that the committed
               `fsc-editor-link.wasm` came from it. The evidence for that
               assertion is circumstantial but consistent: `k_protocol` is 6 and
               so is `LINK_PROTOCOL`; `k_version` is 0.7.0 and so is the
               committed `manifest.json`.
               The alternative was to leave the guard failing until somebody
               with MSFS and the SDK happened to rebuild, which could be months,
               and a check that is red for months is a check nobody reads.
    Changed:   Nothing about the design. Worth knowing that the first recorded
               hash carries slightly less authority than every later one.
    Affects:   none — 08-module already describes the intended mechanism

## 2026-09-20 — Component-prefixed tags would have broken the update feed

    Stage:     0 — versioning
    Expected:  release-please's `include-component-in-tag` set once, globally,
               giving `fsc-editor-vX.Y.Z` and `relay-vX.Y.Z`. That is what
               02-deployables and 04-versioning both said when they were
               written.
    Found:     electron-updater identifies the newest build by reading the
               version out of the tag on the latest GitHub release. A
               `fsc-editor-v0.2.0` tag is not a version it can parse, so every
               editor in the wild would have been unable to find an update —
               and the symptom would have been silence, which is also what "no
               update available" looks like.
    Changed:   `include-component-in-tag` is now set **per package**: off for
               the editor, on for the relay. The two tag shapes are a
               constraint, not an inconsistency.
    Affects:   02-deployables (tag column), 04-versioning (tag table, and a new
               section explaining the split) — both amended

## 2026-09-20 — A relay release would have become "latest"

    Stage:     0 — versioning
    Expected:  The bare `vX.Y.Z` tag to be enough for the update feed, with the
               relay's release a changelog entry nothing reads.
    Found:     release-please gives the relay a GitHub Release as well as a
               tag, and GitHub's "latest" is whichever release was created
               last. After a relay-only release, "latest" is `relay-vX.Y.Z`:
               electron-updater reads that tag for a version and asks that
               release for `latest.yml`, and the README's download link lands
               on a page with no installer. Found while writing that link, not
               by a failed update — no release has been cut yet.
    Changed:   `release.yml` gains a step in `prepare`, run only when the relay
               was released: the relay release is edited to `--latest=false`
               and the newest non-draft `vX.Y.Z` release is named latest again.
               Not yet run — it cannot be exercised before the first relay
               release exists.
    Affects:   04-versioning (the tag section should say that tag shape alone
               does not keep the feed on the editor) — not yet amended

# Versioning — how a release is decided

    Purpose:    How versions are chosen, how a release is cut, and what the
                commit messages have to carry for that to work.
    Depends on: 02-deployables
    Decides:    release-please in manifest mode, two components, the 0.x bump
                rules, 0.1.0 as the first release, no title lint, no preview bot

## release-please, manifest mode

Two components in one repository, routed by path:

| Component | Path | Tag | Version lives in |
| --- | --- | --- | --- |
| `fsc-editor` | everything outside `relay/` | `vX.Y.Z` | `package.json` |
| `relay` | `relay/` | `relay-vX.Y.Z` | `relay/package.json` |

The relay has no version anything reads. A private `package.json` exists there
purely so release-please has a file to bump; the value is in the changelog and
the gate, not the number. See [07-relay](07-relay.md).

### The two tag shapes are not an inconsistency

`include-component-in-tag` is set **per package**: off for the editor, on for
the relay.

electron-updater identifies the newest build by reading the version out of the
tag on the latest release. A `fsc-editor-v0.2.0` tag is not a version it can
parse, so the editor's tag has to be the bare `vX.Y.Z` — the update feed depends
on it. The relay is downloaded by nobody and can afford to be explicit.

Each component gets its own `CHANGELOG.md`, its own tag and its own release PR.
Merging a release PR is what performs the release — a GitHub Release for the
editor, a `wrangler deploy` for the relay.

### One wrinkle, written down so it is not rediscovered

release-please routes by path, and the editor/relay contract lives in
`src/shared/remote-connect.ts`, which is **outside `relay/`**. So a change to the
wire contract attributes to the editor, not the relay. This is rare enough to
handle with an explicit `feat(relay):` commit rather than engineered around.

## Conventional commits

Standard types. Scope is optional and mostly sugar, since routing is by path.

**Multi-scope pull requests use a commit override block in the PR body:**

```
BEGIN_COMMIT_OVERRIDE
feat(relay): hibernate idle sessions
fix: stop the rail dropping Radar on a narrow window
docs: pipeline record
END_COMMIT_OVERRIDE
```

release-please reads that in place of the squash title, so one PR can produce
three changelog entries across both components. This is what makes squash merges
workable without forcing every PR to be single-purpose. Worth confirming the
exact markers against current release-please docs when this is first set up.

**There is no PR title lint.** A blocking check on the title is friction on
every PR to catch a mistake that has a better remedy — see below.

## Bump rules at 0.x

```
bump-minor-pre-major: true
bump-patch-for-minor-pre-major: false   (the default)
```

Which gives:

| Commit | 0.1.0 becomes |
| --- | --- |
| `fix:` | 0.1.1 |
| `feat:` | 0.2.0 |
| `feat!:` / `BREAKING CHANGE` | 0.2.0 |

Without `bump-minor-pre-major`, a breaking change would take the app to 1.0.0,
which is not a statement this project is ready to make.

## The first release is 0.1.0

`package.json` said `0.0.1`, which was a placeholder rather than a version. It
now says `0.1.0`.

`.release-please-manifest.json` starts at `0.0.0` for both components, and that
is not a version either — it is the value release-please reads as *never
released*. `manifest.ts` backfills a prior release from the manifest only when
the entry is something other than `0.0.0`, and with no tags in the repository
there is nothing else to find one from. So on a first release the bump rules
above do not run at all; `initialReleaseVersion()` in `strategies/base.ts`
decides, and its default is `1.0.0`.

That is what the first release PR proposed. The three `feat:` commits behind it
are incidental — a lone `fix:` would have proposed `1.0.0` just the same.

So the first version of each component is pinned declaratively:

```json
"initial-version": "0.1.0"
```

A `Release-As: 0.1.0` footer on a commit to `main` does the same job, and is
what release-please's own docs reach for. It was rejected here because it has
to be remembered exactly once, by whoever writes that commit, with no check
that would catch its absence — and `relay` has not had its first release yet,
so the trap is still armed. The config option is read on every run and needs
nobody to remember anything. Once a component has a release the option is inert
and the ordinary rules take over.

**Semver here is a one-way door.** electron-updater compares versions and will
not offer an older one, so once a build is in somebody's hands the version line
can only go forward. There is no un-publishing a number.

## Two mechanisms considered and rejected

Both are recorded because each is the obvious idea, and somebody reasoning from
first principles will propose them again.

### A PR comment previewing the release

A bot that parses the PR title and body and posts the version bump and changelog
lines it would produce. Rejected: **release-please already maintains a live
release PR on `main`**, continuously updated, showing exactly that. The bot buys
one merge of earliness in exchange for a script that depends on release-please's
internals. The failure it was meant to catch — a commit that silently produces
no changelog entry — is caught by the release PR too, one step later and still
in time to fix.

### release-please as a devDependency

Considered so that the bot could import the same parser the releaser uses, for a
preview that could not drift. With the bot dropped, the reason went with it. The
release job uses `googleapis/release-please-action@v4`, which bundles its own
copy. The action's version drifting under `@v4` does not matter for a releaser:
any behaviour change appears in the release PR, which is read before it is
merged.

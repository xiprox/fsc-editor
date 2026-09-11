# Relay — versioning and deploying the Worker

    Purpose:    How the relay is released, and the rule that keeps editors in
                the wild working.
    Depends on: 02-deployables, 04-versioning
    Decides:    a versioned component with a merge-to-deploy gate; the relay is
                always the old half

## The release is the deploy

There is no artifact anyone downloads. `relay-vX.Y.Z` is a tag, a changelog
entry, and a `wrangler deploy` — in that order, triggered by merging the relay's
release PR.

This needs `relay/package.json` to exist, private, carrying nothing but a
version, because release-please needs a file to bump. Nothing reads that number.
It is bookkeeping, and it is worth being honest that the number is not the point.

## The point is the gate

The alternative was simpler: deploy on any merge that touches `relay/`, with no
version and no changelog. It was rejected.

**The relay is the one thing here where a bad deploy reaches every user
instantly** — including people running an editor from a year ago, who cannot be
reached by an editor update and cannot be helped by a fix that requires one.
Deploy-on-merge makes the squash button on a pull request a production deploy,
on a repository where the same button also merges UI tweaks.

With a release PR there are two deliberate acts: the change lands on `main`, and
then somebody chooses to deploy it. The version number is the price of that gate,
and it is cheap.

`CLOUDFLARE_API_TOKEN` lives as a repository secret, and the deploy job is scoped
to `relay/` so an editor release never touches it.

## The compatibility rule

> **The relay must stay compatible with every editor that has ever been
> released. It is always the old half of the pair.**

Inside this repository, parity is structural: the relay imports
[src/shared/remote-connect.ts](../../src/shared/remote-connect.ts) directly out of
the app's source tree, so two compilers read one file and `npm run relay:check`
fails if they disagree. But the install base is not in this repository, and
compile-time parity says nothing about it.

The surface is small, which is what makes this manageable: `RelayFrame`, the
`CLOSE_*` codes, `CODE_ALPHABET` / `CODE_LENGTH` / `parseCode`, `MAX_GUESTS` and
`HOST_GRACE_MS`. And the relay never opens the envelope — it routes frames
without reading `message` — so the app protocol can change freely without
touching any of it.

**No mechanism enforces this today, deliberately.** There are zero released
editor versions, so the set of editors that could break is empty. The design for
the mechanism, and the reason it must not be left as a vague intention, is in
[09-open-questions](09-open-questions.md).

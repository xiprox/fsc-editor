# Remote Connect

Two people open each other's `Definitions` folders. One **hosts**, choosing which
profiles to share and reading out a six-character code; anyone with that code
**joins** and gets a live, colour-coded view of those profiles, with the host's
saves arriving as they happen.

`src/shared/remote-connect.ts` is the whole contract, shared by the app and the
relay. Nothing below is implemented twice.

## Shape

```
host app  ──ws──┐                    ┌──ws── guest app
                ├── Worker ── Durable Object ──┤
host app  ──ws──┘   (routes)   (one per code)  └──ws── guest app
```

The Durable Object is a router. It reads the envelope — who sent this, who is it
for — and never the payload. It stores no message, so the relay cannot hold a
profile even in principle, and it keeps no protocol state in memory: each
socket's role rides in `serializeAttachment`, so a hibernation wake rebuilds the
roster from `getWebSockets()`. That is also why an idle session is free.

One host, up to `MAX_GUESTS` guests.

## Messages

Relay envelope (`RelayFrame`) — the only layer the Worker understands:

| frame | direction |
| --- | --- |
| `join` | guest → relay |
| `hosting` / `joined` | relay → the socket that just opened |
| `guest-joined` / `guest-left` | relay → host |
| `from-host` | host → relay → one guest (`to`) or all (omitted) |
| `from-guest` | guest → relay → host, with `from` stamped by the relay |
| `closed` | relay → guest, carrying a `CloseReason` |

Payloads (`HostMessage`, `GuestMessage`) pass through untouched: `manifest`,
`manifest-delta`, `file`, `file-error`, and `get-file`.

**Manifest before content.** The host sends `{relPath, size, mtimeMs, hash}` per
file and nothing else. That is a few kilobytes instead of a few megabytes, and it
is not an optimisation — the hash comparison *is* the colour coding, and contents
are not needed to do it. A file's text crosses the wire only when someone asks
for that file.

**Hashes are of newline-normalized content.** Both ends are Windows installs with
their own checkout habits, so one writing CRLF where the other writes LF is
normal. Hashing raw bytes would mark every file modified on that alone and the
whole comparison would say nothing. `\r\n` and a bare `\r` both fold to `\n`
before hashing. Only the comparison is normalized; what is written to disk keeps
the file's own convention.

**Saved state only, never a draft.** Everything the host publishes comes from the
filesystem watcher, so an edit made in this app, in another editor, or by FS
Copilot itself all travel the same path with no special case — and what a guest
sees is what the sim would actually load.

## What a session contains

A host picks profiles before there is a code to give anyone. `host(paths)` takes
the selection as an argument and there is no argumentless form, so sharing a
whole workspace is something a host chooses rather than something that happens
by forgetting to choose. The picker opens with the profile you are looking at
ticked and nothing else.

The point is less privacy than focus. These are profile files rather than
secrets, and the guest count is on screen throughout — but a guest shown one
file cannot open the wrong one, and most of what the guest UI does (three
lenses, a filter, a status sort) exists to find the two rows that matter among
sixty that do not.

`src/main/remote-connect/share.ts` holds the selection and is the only thing
that answers whether a path is in it, because three separate places have to get
the same answer:

- the **manifest**, filtered before hashing, so an unshared profile is never
  opened or read;
- **`serveFile`**, which is what makes the rule real. Absent from the manifest
  only stops an honest guest from asking; a guest can name any path it likes,
  including one kept from before it was unshared. An unshared path gets `Not
  available.` — word for word what a path outside the workspace gets, since a
  different message would answer whether the file exists;
- **presence**, so a host reading an unshared profile does not announce its
  filename. It reports `null`, which to a guest is indistinguishable from the
  host looking away.

Comparison is case-insensitive and separator-insensitive, because both ends are
Windows and `Modules\A320.yaml` names the same file as `modules/a320.yaml`.
Matching raw strings would let the shift key defeat the share set.

Changing the selection mid-session is not a special case: ticking a box sends a
manifest delta and unticking sends a removal, which is the same thing a save and
a deletion already send. The guest needs no new code — a file leaving the
manifest is already something it knows how to stop showing.

## The code

Six characters from a 30-character alphabet that excludes `I L O U 0 1`, because
codes are read aloud and typed by someone looking at a sim. That is 30⁶ ≈
7.3 × 10⁸. Four characters would have been 36⁴ ≈ 1.7 × 10⁶ — sweepable in about a
minute.

The code is **reusable for the life of the session**, so somebody can join late.
The primary defence against a sweep is therefore the Worker's per-IP rate limit,
which is checked before any Durable Object exists — a malformed or hammered code
costs one cheap request rather than an object instantiation, so a sweep cannot
chew through the daily free-tier budget either.

This is a deliberate trade: a code stays valid for hours rather than ten minutes.
These are profile files, not secrets, and the connected-peer count is on screen
the whole time.

## Ending a session

Stopping on purpose closes with `CLOSE_INTENTIONAL`, and the relay kicks the
guests immediately. Any other drop starts a `HOST_GRACE_MS` alarm instead, so a
dying tunnel is not the same as leaving; the host reconnects with its code and a
`resume` token and the guests never notice.

The token exists because the code alone is enough to *join* by design, and must
not therefore also be enough to *take over* an orphaned session and inherit its
guests.

## Trust

A host is whoever holds a six-character code, so everything arriving from one is
treated as hostile:

- Every `relPath` off the wire goes through `resolveInside()`
  (`src/main/paths.ts`), which rejects absolute paths, traversal, and anything
  that is not `.yaml`. Manifest entries that fail are dropped rather than
  aborting the message.
- `MAX_FILE_BYTES` and `MAX_MANIFEST_ENTRIES` bound what a broken or malicious
  host can make a guest hold. Both sit far inside Cloudflare's 32 MiB per-message
  limit, so a file is always one frame and there is no chunking.
- A guest cannot forge `from`: the relay stamps it from the socket the frame
  arrived on. A guest cannot address another guest at all.
- Nothing is written to disk except through the app's existing save path.
- A guest can only fetch what the host selected. Unshared paths are refused at
  `serveFile` and never appear in a manifest or in presence.

## Running the relay

```bash
npm run relay:dev
```

Local Durable Objects and rate limiter, no Cloudflare account needed. Point the
app at it with `FSCE_RELAY_URL=ws://127.0.0.1:8787`.

```bash
npm run relay:check
npm run relay:deploy
```

`relay:deploy` needs `wrangler login` once. The free plan covers this comfortably
and is hard-capped rather than overage-billed: exceeding a limit fails the
request, it never produces a bill.

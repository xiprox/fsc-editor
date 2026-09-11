# fsc-editor

An editor for **FS Copilot aircraft profiles** — a VS Code-style shell over the
`Definitions` folder FS Copilot loads profiles from, with schema validation,
completions built from the profiles already installed, live simulator values in
the gutter, and a peer-to-peer Remote Connect mode. Electron + React 19 +
Tailwind 4.

`README.md` is the product documentation and is kept current — read it for how
setup detection, Remote Connect, or the formatter actually behave. This file is
for working in the repo.

## Layout

| Path               | What lives there                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `src/main`         | Node side: IPC (`ipc.ts`), workspace and file watching, SimConnect, activity capture, the local db |
| `src/preload`      | The bridge, and the typed surface in `index.d.ts`                                                  |
| `src/renderer/src` | React app — `store.ts` (zustand), Monaco wiring in `lib/`, panels in `components/`                 |
| `src/shared`       | Profile grammar, formatter and setter resolution — used by both sides                              |
| `link/`            | The native SimConnect bridge (`build.sh`, vcxproj)                                                 |
| `relay/`           | Cloudflare Worker backing Remote Connect                                                           |
| `scripts/`         | Maintainer sweeps, not tests — see below                                                           |
| `docs/`            | Design docs, including 17 numbered ones under `docs/sim-vars/`                                     |

The profile format is **parsed and written by hand** in `src/shared/profile`, not
by a YAML library. That is deliberate: these are files people distribute to each
other, and a save must never alter what FS Copilot loads. A real parser appears
only as a test oracle.

## Commands

```bash
npm run dev
```

```bash
npm run build       # typecheck + bundle main, preload and renderer into out/
npm run typecheck
npm run test        # vitest
npm run lint
```

`check:format`, `check:grammar`, `check:setters` and `check:highlight` are **maintainer corpus
sweeps, not tests**. They run over a real `Definitions` folder, which lives
outside the repository — a test that needs somebody else's folder is a test that
fails on a fresh clone. `check:claims` is a fifth, over an FS Copilot checkout
rather than a `Definitions` folder, and is out of CI for the same reason. Each
script's header comment says what it asserts.

`check:cascade` is the exception and _does_ run in CI: it shells out to git and
compiles the stylesheet, but it reads nothing outside this repository.

**Verify a script through its documented `npm run` command.** Running
`bash script.sh` directly is a different test: the user launches from PowerShell
through npm, where `$APPDATA` is absent and `$HOME` can be a Git Bash value
unrelated to the Windows profile. Two bugs shipped in `link/build.sh` this way,
both invisible to every test that did not go through npm. To reproduce the
awkward environment on purpose:

```bash
env -u APPDATA -u USERPROFILE HOME=/home/other bash link/build.sh
```

## UI

**`docs/ui.md` is the source of truth.** Read it before building or changing
anything visual. In short: every control comes from shadcn and lives in
`src/renderer/src/components/ui/`; there are no transitions; spacing sits on a
4px grid; feature colours are applied through the `tone` prop and never by hand.

Values are not documented in prose — they live in `src/renderer/src/index.css`
as tokens and `@utility` blocks, which is what lets a control be replaced
without taking the measurements with it.

### Design changes are systemic until proven local

When asked to change a visual value — a radius, a padding, a border colour, a
size — find out who owns it first. Grep it: if it is a token or `@utility` in
`index.css`, or it appears in three or more files, it belongs to the system
rather than to the component in front of you.

- **Genuinely local** — one panel's max width, one empty state's copy. Just make
  the change.
- **Systemic, and the request is really a system change** — "the corners are too
  round" is about `--radius`, which every control inherits. A spot fix would
  create drift. Say so in a sentence or two, name what the system-level change
  would be, and recommend one.
- **Systemic, but a real local exception is wanted** — the answer is a named
  variant on the component or a new token, never a hardcoded override at a call
  site. A lone `rounded-[3px]` in a feature file is how the system erodes.

**Surface, don't sweep.** Being asked to change one thing is not authorisation to
change forty. State the observation, give a recommendation, then do what was
asked unless told otherwise.

The same check applies when writing new UI: before hardcoding a value, look for
an existing token. Writing the third copy of something is the signal to promote
it — and to say so rather than quietly doing it.

## Copy

**`docs/copy.md` is the source of truth for every string a user reads** —
panel text, tooltips, dialogs, errors, diagnostics, hover docs. Read it before
writing or changing one. In short: second person; consequences in the future
tense; fact then consequence after an em dash; buttons are the specific verb;
one vocabulary (the app, the FSC folder, sim module, the host and peers). It
also lists which surfaces are still owed a holistic pass.

## Working in this repo

### Nothing personal in the tree

The repository is public and takes contributions. Nothing committed should
identify a particular machine or the person sitting at it — not in source, not
in a doc, not in a fixture.

The trap is that all of it arrives as convenience. A sweep script wants a
default folder to walk. A captured session records the `aircraft.cfg` path the
sim reported. A redaction test wants a plausible Windows path to redact. Every
one of those carried a real username until the repository was made public.

- **Paths default from `homedir()`**, never from a literal — `join(homedir(),
"Documents/Definitions")`, overridable by an env var and by argv. Every
  script in `scripts/` is already this shape; copy the nearest one.
- **Docs write `<user>`** where a real path would carry a name. See
  `docs/sim-vars/04-connection.md`.
- **Captures are scrubbed before they land.** `src/main/sim/fixtures/` holds
  real sessions, and a session carries the package path of everything that was
  in the sim that day — including the `.gz` ones, which no grep will find.
- **`corpus/` is somebody else's work**, mirrored by `npm run corpus:sync` with
  its own provenance and licence note. The author credits in those files stay
  exactly as their authors wrote them.

Before committing, grep the tree for your own account name:

```bash
git grep -in "$(whoami)"
```

This is a different job from `src/main/report/redact.ts`, which does the same
thing at runtime for the debug report a user sends us. That one protects the
user; this one protects whoever writes the commit.

import { useCallback, useEffect, useState } from "react"

import { AlertTriangle, Check, FolderOpen, Loader2, Trash2 } from "lucide-react"

import type {
  CommunityFolder,
  LinkInstallResult,
  LinkInstallState,
} from "@shared/link-install"

import { Button } from "@/components/ui/button"
import { useStore } from "@/store"

/**
 * What the module buys you, in one breath.
 */
export function SimModulePitch() {
  return (
    <>
      The sim module unlocks current aircraft detection, real-time variable 
      values, code completion with verified names, various diagnostics based 
      on sim data, the ability to run setter functions in the sim, and more.
    </>
  )
}

/**
 * The install flow's body — everything between a container's header and its
 * close affordance. Two containers render it: the sim chip's focused dialog
 * (`sim/install-dialog.tsx`), which keeps the pitch in its header, and the
 * Settings dialog's Simulator section, which asks for the pitch inline via
 * `showPitch`.
 *
 * [04-connection] lays out four steps — explain, ask for the folder, install
 * and report, say what happens next — and the second one is the one worth
 * thinking about, because the honest version of it is *do not ask*. Discovery
 * reads `UserCfg.opt`, which is authoritative, and on a normal machine it
 * returns one obvious answer. An earlier version opened onto a list of two
 * near-identical absolute paths and made choosing between them the first thing
 * a user did, which is a question they have no information to answer and we
 * do. So the folder is *proposed*, on one line, with a way to change it — the
 * same bargain `detect.ts` makes for the workspace.
 *
 * The other thing that is not asked is updating. A package that does not match
 * the one this app ships is replaced at startup by `updateStaleLinks`, without
 * a prompt — nobody can evaluate what changed inside a WASM module, so the
 * only answer that ever makes sense is yes, and a question with one right
 * answer should not be a question. By the time this renders, that has
 * happened.
 */
export function SimModuleGroup({ showPitch = false }: { showPitch?: boolean }) {
  const sim = useStore((state) => state.sim)

  const [state, setState] = useState<LinkInstallState | null>(null)
  const [chosen, setChosen] = useState<CommunityFolder | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<LinkInstallResult | null>(null)

  const refresh = useCallback(async () => {
    setState(await window.api.linkInstallState())
  }, [])

  // Loads once, on mount. Both containers mount this fresh each time they
  // open — the chip's dialog through its `key` bump, Settings by unmounting
  // its content with the dialog — so every opening starts clean without a
  // "reset when reopened" effect.
  useEffect(() => {
    // `set-state-in-effect` is about synchronous setState cascading into
    // another render before the first one has painted. Nothing here is
    // synchronous — every write happens after an IPC round trip — so the rule
    // is reading an async function as if it were a direct call. Same shape,
    // and the same reason, as the mount effect in `remote-connect/code-input`.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh])

  // An override wins over discovery; otherwise the first folder, which
  // `linkInstallState` has already sorted best-first.
  const target = chosen ?? state?.folders[0] ?? null
  const shipped = state?.shipped ?? null
  const installed = target?.installed ?? null

  async function browse(): Promise<void> {
    const folder = await window.api.chooseCommunityFolder(target?.path)
    if (folder) setChosen(folder)
  }

  async function install(): Promise<void> {
    if (!target) return

    setBusy(true)
    setResult(await window.api.installLink(target.path))
    setBusy(false)
    void refresh()
  }

  async function uninstall(): Promise<void> {
    if (!target) return

    setBusy(true)
    const removed = await window.api.uninstallLink(target.path)
    setBusy(false)
    setResult(removed.ok ? null : { ok: false, reason: removed.reason })
    setChosen(null)
    void refresh()
  }

  // Absent once the package is in place and matching. There is nothing a
  // reinstall would achieve that has not already happened — updates are
  // automatic — and a button offering to redo finished work only invites
  // somebody to wonder whether it is finished.
  const offerInstall = !result?.ok && installed?.current !== "same"
  const offerUninstall = !!installed && !result?.ok

  return (
    <div className="flex flex-col gap-3">
      {showPitch && (
        <p className="text-muted-foreground">
          <SimModulePitch />
        </p>
      )}

      {state === null ? (
        <p className="text-muted-foreground">Looking for your simulator…</p>
      ) : result?.ok === true ? (
        <Written result={result} sim={sim} />
      ) : (
        <>
          <Target
            folder={target}
            busy={busy}
            onBrowse={() => void browse()}
            onUninstall={offerUninstall ? () => void uninstall() : null}
          />

          {installed && (
            <Status
              linked={installed.linked}
              version={installed.version}
              sim={sim}
            />
          )}

          {result?.ok === false && <Problem>{result.reason}</Problem>}

          {shipped === null && (
            <Problem>
              This build does not carry the sim module. Run{" "}
              <Mono>npm run link:build</Mono> in a checkout, or use a release
              build.
            </Problem>
          )}

          {offerInstall && (
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={busy || !target || shipped === null}
                onClick={() => void install()}
              >
                {busy && <Loader2 className="animate-spin" />}
                {installed ? "Repair" : "Install"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function Mono({ children }: { children: React.ReactNode }) {
  return <code className="font-mono text-[0.95em]">{children}</code>
}

function Problem({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-muted-foreground">
      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

/**
 * The folder, proposed rather than asked for.
 *
 * One line, because on a normal machine there is one right answer and the user
 * gains nothing by being walked through how it was reached. `Change` is the
 * whole of the override, and it opens next to what was proposed.
 *
 * `Uninstall` sits with it rather than beside the primary action, because both
 * of these act on the folder named underneath them and neither belongs to the
 * flow that button drives. It is offered at all because we wrote into
 * somebody's game install — 04 asks for it in as many words — not because it
 * is a thing anyone is being encouraged to do.
 */
function Target({
  folder,
  busy,
  onBrowse,
  onUninstall,
}: {
  folder: CommunityFolder | null
  busy: boolean
  onBrowse: () => void
  onUninstall: (() => void) | null
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">
          {folder?.installed ? "Installed in" : "Install to"}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="xs" onClick={onBrowse}>
            <FolderOpen />
            Change
          </Button>
          {onUninstall && (
            <Button
              variant="ghost"
              size="xs"
              disabled={busy}
              onClick={onUninstall}
            >
              <Trash2 />
              Uninstall
            </Button>
          )}
        </div>
      </div>

      {folder ? (
        <div className="rounded-md border border-border bg-muted/40 px-2 py-1.5">
          <p className="font-mono text-[11px] break-all">{folder.path}</p>
          <p className="text-[10px] text-muted-foreground">
            {folder.sim}
            {folder.source === "chosen" && " · chosen by you"}
          </p>
        </div>
      ) : (
        /*
          Discovery reads `UserCfg.opt` and does not guess, so coming up empty
          is a real answer rather than a bug — the file is missing, or names a
          Packages folder that is not there. Naming the file is what makes that
          a solvable problem rather than a dead end.
        */
        <p className="text-muted-foreground">
          No simulator found. FSC Editor reads <Mono>UserCfg.opt</Mono> rather
          than guessing where MSFS is installed — choose your Community folder
          to carry on.
        </p>
      )}
    </div>
  )
}

type Sim = ReturnType<typeof useStore.getState>["sim"]

/** Where an existing install stands, without repeating what the chip says. */
function Status({
  linked,
  version,
  sim,
}: {
  linked: boolean
  version: string | null
  sim: Sim
}) {
  return (
    <div className="flex flex-col gap-1 text-muted-foreground">
      <p className="flex items-start gap-1.5">
        <Check className="mt-0.5 size-3.5 shrink-0 text-sim" />
        <span>
          Installed{version ? ` · version ${version}` : ""}. Updates are applied
          automatically when FSC Editor starts.
        </span>
      </p>

      {/*
        Worth saying out loud, and only when it is true. A junction here is
        somebody's own arrangement — AddonLinker, or a package farm on another
        drive — and repairing replaces the link with a real folder, which is a
        change to their setup rather than to ours.
      */}
      {linked && (
        <p className="pl-5">
          This entry is a junction to another folder. Repairing it would replace
          the link with a real folder.
        </p>
      )}

      <p className="pl-5">{next(sim)}</p>
    </div>
  )
}

/**
 * What was written, and what has to happen before it does anything.
 */
function Written({
  result,
  sim,
}: {
  result: Extract<LinkInstallResult, { ok: true }>
  sim: Sim
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-start gap-1.5">
        <Check className="mt-0.5 size-3.5 shrink-0 text-sim" />
        <span>
          {result.replaced ? "Replaced" : "Installed"} {result.files.length}{" "}
          files ({Math.round(result.bytes / 1024)} KB) in{" "}
          <span className="font-mono text-[11px] break-all">{result.path}</span>
        </span>
      </p>
      <p className="pl-5 text-muted-foreground">{next(sim)}</p>
    </div>
  )
}

/**
 * The sentence about restarting, which 04 is specific about: MSFS scans
 * packages at boot, so this is stated as a fact about how the simulator works
 * rather than as "try restarting". The difference matters to somebody who has
 * just let an editor write into their game install — one is an explanation,
 * the other invites them to wonder whether it will help.
 */
function next(sim: Sim): string {
  if (sim.phase === "live" && sim.link) return "The module is loaded and talking."

  if (sim.phase === "live") {
    return "MSFS scans packages when it starts, so the simulator you have open will not see this one until it restarts."
  }

  return "It will load the next time you start MSFS."
}

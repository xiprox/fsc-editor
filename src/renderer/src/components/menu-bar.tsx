import { useState, type ReactNode } from "react"

import {
  Download,
  Loader2,
  RefreshCw,
  ScrollText,
  Settings,
} from "lucide-react"

import {
  Menubar,
  MenubarContent,
  MenubarGroup,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from "@/components/ui/menubar"
import { ProgressRing } from "@/components/ui/progress-ring"
import { commands, keysLabel, type Command } from "@/lib/commands"
import { useStore } from "@/store"
import type { About, ManualCheck } from "@shared/types"

/**
 * The menu bar, in the title bar, where the app's name used to be a label.
 *
 * One menu so far: the app's own, under its name. File, View and the rest line
 * up after it as they arrive, and each is a list of `commands` so the keys a
 * menu shows are the keys that fire.
 */
export function MenuBar() {
  return (
    <Menubar className="no-drag">
      <AppMenu />
    </Menubar>
  )
}

/**
 * The mark beside the app's name, and the row it points at wears the same one:
 * an update is downloaded, and restarting into it would take two seconds.
 */
const READY_ICON = Download

/**
 * The app itself: which version this is, what changed, whether there is a
 * newer one, and Settings.
 *
 * **This is where an update is offered.** It used to be a button of its own in
 * the title bar, which had nowhere to go once a menu bar sat there too. Now an
 * icon beside the name says there is something to see, and the row inside with
 * the same icon says what — so opening the menu and choosing the row are the
 * two clicks the button's confirmation used to cost, with the row's own words
 * as the confirmation.
 */
function AppMenu() {
  const ready = useStore((state) => state.update.kind === "ready")
  const sharing = useStore((state) => state.remote.phase !== "idle")
  const about = useStore((state) => state.about)

  // Not while a Remote Connect session is live: the row cannot be used then,
  // and a mark pointing at a disabled row is a signal with nothing to act on.
  const Mark = ready && !sharing ? READY_ICON : null

  return (
    <MenubarMenu>
      <MenubarTrigger className="text-[13px]">
        FSC Editor
        {/*
          In the row rather than in a corner, so it reads as part of the name.
          `inline-end` is what `control-md` trims the trailing padding for, so
          the icon is not marooned. The trigger grows by the icon while it is
          there; with a menu after it, that menu moves by as much.
        */}
        {Mark && (
          <>
            <Mark aria-hidden data-icon="inline-end" className="text-update" />
            <span className="sr-only">, update ready</span>
          </>
        )}
      </MenubarTrigger>

      {/*
        A fixed width, because the update row's words change while the menu is
        open — a check answers in place — and a menu that resized under the
        pointer would move the row being read. Wide enough for the longest of
        them on one line.
      */}
      <MenubarContent className="w-72">
        {about && (
          <MenubarGroup>
            <MenubarLabel>
              Version <span className="font-mono">{about.version}</span>
            </MenubarLabel>
          </MenubarGroup>
        )}

        <MenubarSeparator />

        <MenubarItem onClick={commands.whatsNew.run}>
          <ScrollText />
          {commands.whatsNew.title}
        </MenubarItem>

        {about && <UpdateRow about={about} />}

        <MenubarSeparator />

        <CommandItem command={commands.settings} icon={<Settings />} />
      </MenubarContent>
    </MenubarMenu>
  )
}

function CommandItem({
  command,
  icon,
}: {
  command: Command
  icon: ReactNode
}) {
  return (
    <MenubarItem onClick={command.run}>
      {icon}
      {command.title}
      {command.keys && <MenubarShortcut>{keysLabel(command.keys)}</MenubarShortcut>}
    </MenubarItem>
  )
}

const UNAVAILABLE: Record<Exclude<About["updates"], "on">, string> = {
  portable: "Updates are off in a portable build",
  development: "Updates are off in a development build",
}

/** A check somebody started from this row, and its answer. */
type Asked = "checking" | ManualCheck

const ANSWERS: Partial<Record<Asked, string>> = {
  checking: "Checking for updates…",
  "up-to-date": "This is the newest version",
  failed: "Could not reach the update server",
}

/**
 * How long *Checking for updates…* stays up, however fast the answer comes.
 *
 * The feed often answers in a few hundred milliseconds, and a label that
 * flashes and reverts reads as a click that did nothing. This only ever holds
 * the checking state: a download that starts meanwhile shows at once, since
 * the row reads the ambient state before its own answer.
 */
const CHECKING_AT_LEAST_MS = 1000

const elapsed = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * One row that always says where updating stands.
 *
 * A check started here **answers here**: the row keeps the menu open and its
 * words become the answer. That is the rule `checkForUpdatesNow` is built on —
 * a check somebody asked for is a question, and the answer goes back to the
 * caller rather than into the ambient state — with this row as the caller.
 *
 * The answer lives in this component, and the menu's popup unmounts when it
 * closes, so reopening the menu starts from the standing state again. Nothing
 * resets it by hand.
 */
function UpdateRow({ about }: { about: About }) {
  const update = useStore((state) => state.update)
  const sharing = useStore((state) => state.remote.phase !== "idle")
  const [asked, setAsked] = useState<Asked | null>(null)

  if (about.updates !== "on") {
    return (
      <MenubarItem disabled>
        <RefreshCw />
        {UNAVAILABLE[about.updates]}
      </MenubarItem>
    )
  }

  if (update.kind === "ready") {
    // Restarting would end a Remote Connect session for everybody in it, and
    // could leave the two sides on different builds with no way for the other
    // pilot to see why. Disabled rather than hidden, so the menu keeps its
    // rows where they were.
    if (sharing) {
      return (
        <MenubarItem disabled>
          <Download />
          Restart to update after Remote Connect
        </MenubarItem>
      )
    }

    return (
      <MenubarItem tone="update" onClick={() => void window.api.installUpdate()}>
        <READY_ICON />
        Restart to update to {update.version}
      </MenubarItem>
    )
  }

  if (update.kind === "downloading" || asked === "downloading") {
    return (
      <MenubarItem closeOnClick={false}>
        <ProgressRing
          className="tone-update"
          value={update.kind === "downloading" ? update.percent : null}
          aria-label="Downloading an update"
        />
        Downloading update…
      </MenubarItem>
    )
  }

  const checking = asked === "checking"

  return (
    <MenubarItem
      closeOnClick={false}
      onClick={() => {
        if (checking) return

        setAsked("checking")
        void Promise.all([
          window.api.checkForUpdates(),
          elapsed(CHECKING_AT_LEAST_MS),
        ]).then(([answer]) => setAsked(answer))
      }}
    >
      {checking ? <Loader2 className="animate-spin" /> : <RefreshCw />}
      {(asked && ANSWERS[asked]) ?? "Check for updates"}
    </MenubarItem>
  )
}

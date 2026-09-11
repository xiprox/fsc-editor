import { Fragment, useEffect, useMemo, useRef, useState } from "react"

import {
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Copy,
  FileCode2,
  Folder,
  FolderOpen,
  Hash,
  List,
  Pencil,
  Trash2,
  TriangleAlert,
} from "lucide-react"

import { nodesAtLine, type OutlineNode } from "@shared/profile"
import type { ProfileFile } from "@shared/types"

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { revealLine } from "@/lib/editor-bridge"
import { setFileDrag } from "@/lib/editor-dnd"
import { useStore } from "@/store"

const EXPANDED_KEY = "expanded-folders"
const INDENT = 12
const BASE_PADDING = 8
/**
 * How far into a row the name itself starts: the spacer and the icon in front
 * of it, plus the two `gap-1`s. Anything that belongs to the *name* rather than
 * to the row — the field's refusal, so far — lines up here rather than under the
 * icons, which are about the file.
 */
const NAME_INSET = 36

type TreeNode =
  | { type: "file"; name: string; path: string }
  | { type: "dir"; name: string; path: string; children: TreeNode[] }

function sortNodes(nodes: TreeNode[]): TreeNode[] {
  // Folders first, the way a file explorer does it.
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  for (const node of nodes) if (node.type === "dir") sortNodes(node.children)

  return nodes
}

function buildTree(files: ProfileFile[]): TreeNode[] {
  const root: TreeNode[] = []
  const directories = new Map<string, Extract<TreeNode, { type: "dir" }>>()

  /** Returns the child list for a directory path, creating it and its parents. */
  function childrenOf(path: string): TreeNode[] {
    if (!path) return root

    const existing = directories.get(path)
    if (existing) return existing.children

    const separator = path.lastIndexOf("/")
    const node: Extract<TreeNode, { type: "dir" }> = {
      type: "dir",
      name: path.slice(separator + 1),
      path,
      children: [],
    }

    directories.set(path, node)
    childrenOf(separator === -1 ? "" : path.slice(0, separator)).push(node)

    return node.children
  }

  for (const file of files)
    childrenOf(file.dir).push({
      type: "file",
      name: file.name,
      path: file.relPath,
    })

  return sortNodes(root)
}

interface TreeState {
  expanded: Set<string>
  onToggle: (key: string) => void
  /** The one row currently spelling out a new name, if any. */
  renaming: string | null
  onRenaming: (path: string | null) => void
}

interface BlockSections {
  block: OutlineNode | null
  sections: OutlineNode[]
}

/**
 * Sections, under the block they belong to. Subsections stay out of it — they
 * belong to the sticky header and the fold gutter.
 *
 * The block level is here because a concern whose entries are mostly shared
 * with a few master ones has to be written twice, once per block. Showing the
 * block is what tells the two copies apart.
 */
function blocksOf(outline: OutlineNode[] | undefined): BlockSections[] {
  const blocks: BlockSections[] = []

  for (const node of outline ?? []) {
    if (node.kind === "section") {
      blocks.push({ block: null, sections: [node] })
      continue
    }

    if (node.kind !== "block") continue

    const sections = node.children.filter((child) => child.kind === "section")
    if (sections.length) blocks.push({ block: node, sections })
  }

  return blocks
}

/**
 * The absolute path of a row, for pasting somewhere outside this window.
 *
 * Built here rather than asked for over IPC because the answer is a join and
 * the window it is being built in only ever runs on Windows. Rows carry
 * forward-slashed relative paths — that is the identity every store is keyed by
 * — and Explorer wants them the other way round.
 */
function fullPath(root: string, relPath: string): string {
  return `${root}\\${relPath.replace(/\//g, "\\")}`
}

/**
 * The name without the extension — which is the name.
 *
 * A profile is named for an aeroplane, and `.yaml` is how it is stored rather
 * than part of what it is called. Every place this gets pasted — a title, a
 * message, the box you search MSFS with — wants the aeroplane.
 */
function stem(name: string): string {
  return name.replace(/\.ya?ml$/i, "")
}

function reveal(relPath: string): void {
  void window.api.revealFile(relPath).catch((error: unknown) => {
    void window.api.log(
      "error",
      "reveal",
      error instanceof Error ? error.message : String(error)
    )
  })
}

/**
 * Silent on success, and silent on failure too. There is nowhere on a context
 * menu for a confirmation to live once the menu has gone, and a status bar
 * saying "copied" would be reporting a thing the user is about to find out by
 * pasting.
 */
async function copy(text: string): Promise<void> {
  await navigator.clipboard.writeText(text).catch(() => undefined)
}

/**
 * The row, while it is a name being typed rather than a file being pointed at.
 *
 * Committing on blur rather than reverting, the way Explorer does: clicking
 * away from a name you have finished typing means you finished typing it. Esc
 * is the way out, and it is the only way out, so `settled` stops the blur that
 * follows either ending from arriving as a second answer.
 *
 * **A refused name keeps the field.** Windows turns down two kinds of name —
 * one already taken, one with characters a filename cannot hold — and both of
 * those leave you with a name that is still yours to fix. So `onCommit` is a
 * question rather than a goodbye: it answers, and *still being mounted when it
 * answers* is what says the rename did not land. That is what reopens `settled`,
 * and it is the only thing that can — keying the reset off the `error` prop
 * would deadlock the field the second time the same name is refused, since an
 * unchanged string is a render React is entitled to skip.
 *
 * It is also why blur no longer always ends this. Only the rename landing does,
 * and the row it lands on is rebuilt by the rescan that follows.
 */
function RenameField({
  name,
  error,
  onCommit,
  onCancel,
}: {
  name: string
  /** Why the last attempt was refused, from `renameProfile`. */
  error: string | null
  /** Resolves when the rename has been answered — see the note above. */
  onCommit: (name: string) => Promise<void>
  onCancel: () => void
}) {
  const [value, setValue] = useState(name)
  const settled = useRef(false)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const input = field.current
    if (!input) return

    input.focus()

    // The stem, not the extension. Renaming a profile almost always means
    // renaming the aeroplane, and `.yaml` is not part of that — selecting it
    // too would make the first keystroke delete it.
    const dot = name.lastIndexOf(".")
    input.setSelectionRange(0, dot === -1 ? name.length : dot)
  }, [name])

  const settle = (commit: boolean): void => {
    if (settled.current) return
    settled.current = true

    const next = value.trim()
    if (!commit || !next || next === name) {
      onCancel()
      return
    }

    void onCommit(next).then(() => {
      // Reached only when the rename did not land — success unmounts this, and
      // then both of these are no-ops on a field that no longer exists. The
      // focus is for the blur that got us here: a name Windows refused is not a
      // name you have finished typing, whatever clicking away meant.
      settled.current = false
      field.current?.focus()
    })
  }

  return (
    <Input
      ref={field}
      value={value}
      aria-label={`Rename ${name}`}
      aria-invalid={!!error}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => settle(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter") settle(true)
        else if (event.key === "Escape") settle(false)
        else return

        event.preventDefault()
        event.stopPropagation()
      }}
      className="h-5 rounded-sm px-1 py-0 text-[13px]"
    />
  )
}

/**
 * The row while a new name is being typed, and the one place a refusal appears.
 *
 * Its own component so the refusal lives exactly as long as the field does —
 * held in `Row`, it would be one more thing to remember to clear, and it would
 * outlive the field on any path that closed it without going through here.
 *
 * The commit no longer closes the row. It asks, and closes on `null`: a rename
 * Windows refused has left the user with a name that is still theirs to fix, and
 * taking the field away would take the name with it. What closes this on success
 * is `onDone`; what closes it on a rescan is the list being rebuilt underneath.
 */
function RenamingRow({
  node,
  padding,
  onDone,
}: {
  node: TreeNode & { type: "file" }
  padding: React.CSSProperties
  onDone: () => void
}) {
  const renameProfile = useStore((store) => store.renameProfile)
  const [error, setError] = useState<string | null>(null)

  return (
    <div style={padding} className="flex w-full flex-col py-1 pr-2">
      <div className="flex w-full items-center gap-1">
        <span className="size-3.5 shrink-0" />
        <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />
        <RenameField
          name={node.name}
          error={error}
          onCommit={(name) =>
            renameProfile(node.path, name).then((refused) => {
              setError(refused)
              if (!refused) onDone()
            })
          }
          onCancel={onDone}
        />
      </div>

      {/*
        Muted rather than red: the field's own `aria-invalid` ring is what raises
        the alarm, and this is the sentence explaining it. Two reds in one row
        would be the row shouting twice.

        Wrapping, not truncating — the illegal-character sentence is a list of
        characters and the ones that fell off the end are the ones you needed.
        Same shape as the folder picker's error in Settings; a third of these
        earns a component, two does not.
      */}
      {error && (
        <p
          style={{ paddingLeft: NAME_INSET }}
          className="flex items-start gap-1.5 pt-1 text-[11px] text-muted-foreground"
        >
          <TriangleAlert className="mt-px size-3 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  )
}

function OutlineRow({
  node,
  file,
  depth,
  isActive,
}: {
  node: OutlineNode
  file: string
  depth: number
  isActive: boolean
}) {
  const Icon = node.kind === "block" ? List : Hash

  return (
    <button
      onClick={() => void revealLine(file, node.line)}
      style={{ paddingLeft: BASE_PADDING + depth * INDENT }}
      className={cn(
        "flex w-full items-center gap-1 py-1 pr-2 text-left text-[13px] hover:bg-accent/60",
        isActive ? "font-medium text-foreground" : "text-muted-foreground",
        node.kind === "block" && "text-[11px] tracking-wide uppercase"
      )}
    >
      <span className="size-3.5 shrink-0" />
      <Icon className="size-3 shrink-0 opacity-70" />
      <span className="truncate">{node.title}</span>
    </button>
  )
}

function Row({
  node,
  depth,
  state,
}: {
  node: TreeNode
  depth: number
  state: TreeState
}) {
  const activePath = useStore((store) => store.activePath)
  const open = useStore((store) => store.open)
  const openLocal = useStore((store) => store.openLocal)
  const root = useStore((store) => store.workspace?.root ?? "")
  const duplicateProfile = useStore((store) => store.duplicateProfile)
  const deleteProfile = useStore((store) => store.deleteProfile)
  /** Whether the menu closing is the rename item passing focus to the field. */
  const handingOff = useRef(false)
  /**
   * The sections of whichever copy this file's tab is showing.
   *
   * Not always ours: a tab in the remote view is displaying the host's document
   * under our filename, and its line numbers are theirs. Listing our sections
   * against their text would highlight the wrong one whenever the two have
   * drifted — which is the only time anyone is looking — and would jump to a
   * line chosen from a document that is not on screen.
   */
  const outline = useStore((store) =>
    node.type !== "file"
      ? undefined
      : store.viewMode[node.path] === "remote"
        ? store.remoteOutlines[node.path]
        : store.outlines[node.path]
  )
  const activeLine = useStore((store) => store.activeLine)

  const padding = { paddingLeft: BASE_PADDING + depth * INDENT }

  if (node.type === "dir") {
    const isExpanded = state.expanded.has(node.path)
    const FolderIcon = isExpanded ? FolderOpen : Folder
    const Chevron = isExpanded ? ChevronDown : ChevronRight

    return (
      <>
        <ContextMenu>
          <ContextMenuTrigger
            render={<button type="button" />}
            onClick={() => state.onToggle(node.path)}
            style={padding}
            className="flex w-full items-center gap-1 py-1 pr-2 text-left text-[13px] hover:bg-accent/60"
          >
            <Chevron className="size-3.5 shrink-0 text-muted-foreground" />
            <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{node.name}</span>
          </ContextMenuTrigger>

          {/*
            A folder is not a profile, so the two things it can do are the two
            that are about where it is rather than about what is in it. Renaming
            one would move every profile under it between the folder FS Copilot
            includes as modules and the folder it loads as aircraft, which is a
            bigger thing than a right-click should offer.
          */}
          <ContextMenuContent>
            <ContextMenuItem onClick={() => reveal(node.path)}>
              <FolderOpen />
              Open in File Explorer
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => void copy(fullPath(root, node.path))}
            >
              <ClipboardCopy />
              Copy path
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>

        {isExpanded &&
          node.children.map((child) => (
            <Row
              key={child.path}
              node={child}
              depth={depth + 1}
              state={state}
            />
          ))}
      </>
    )
  }

  const entry = open[node.path]
  const dirty = !!entry && entry.draft !== entry.saved
  // Same fact as the tab's dot, in the same colour — two marks for one state
  // that disagreed about it would read as a bug rather than as a detail.
  const stale = dirty && !!entry.stale
  const isActive = activePath === node.path
  // Only files we have read, and only those that use sections, have anything.
  const blocks = blocksOf(outline)
  const isExpanded = state.expanded.has(node.path)
  const Chevron = isExpanded ? ChevronDown : ChevronRight

  const activeLines = new Set(
    isActive
      ? nodesAtLine(outline ?? [], activeLine).map((found) => found.line)
      : []
  )

  // A row being renamed is a field where the row was, at the same indent and
  // behind the same icon, so the name stays where you were already looking. Its
  // outline folds away with it: those are section names in a file you are in
  // the middle of naming, and none of them is what the question is about.
  if (state.renaming === node.path)
    return (
      <RenamingRow
        node={node}
        padding={padding}
        onDone={() => state.onRenaming(null)}
      />
    )

  return (
    <>
      <ContextMenu
        onOpenChange={(opened) => {
          if (opened) handingOff.current = false
        }}
      >
        <ContextMenuTrigger
          render={<button type="button" />}
          onClick={() => void openLocal(node.path)}
          /*
            Dragged into the editor to open it there — on the pane's edge for a
            new split, on a pane or its tab strip to open in that one.

            The payload is a private MIME type and deliberately not
            `text/plain`: the editor accepts a text drop and inserts it at the
            pointer, which is how a variable chip gets into a file, so a row
            carrying its path as text would be dropped *into* the document as
            the literal string `modules/fuel.yaml`.
          */
          draggable
          onDragStart={(event) => setFileDrag(event.dataTransfer, node.path)}
          onKeyDown={(event) => {
            // The two shortcuts Explorer and every editor already agree on, on
            // the row that has focus. Nothing else here is destructive enough
            // to want a key of its own.
            if (event.key === "F2") state.onRenaming(node.path)
            else if (event.key === "Delete") void deleteProfile(node.path)
            else return

            event.preventDefault()
          }}
          data-active={isActive}
          style={padding}
          className={cn(
            "flex w-full items-center gap-1 py-1 pr-2 text-left text-[13px] hover:bg-accent/60",
            isActive && "bg-accent text-accent-foreground"
          )}
        >
          {blocks.length ? (
            <Chevron
              role="button"
              aria-label={isExpanded ? "Collapse outline" : "Expand outline"}
              className="size-3.5 shrink-0 opacity-70"
              onClick={(event) => {
                event.stopPropagation()
                state.onToggle(node.path)
              }}
            />
          ) : (
            <span className="size-3.5 shrink-0" />
          )}
          <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{node.name}</span>
          {dirty && (
            <span
              className={cn(
                "ml-auto size-1.5 shrink-0 rounded-full",
                stale ? "bg-amber-600 dark:bg-amber-400" : "bg-foreground/60"
              )}
            />
          )}
        </ContextMenuTrigger>

        {/*
          Closing a menu hands focus back to the row it was opened from, which
          is right for every item here except the one that replaces that row
          with a field wanting focus of its own. `handingOff` is which of those
          two just happened.
        */}
        <ContextMenuContent finalFocus={() => !handingOff.current}>
          <ContextMenuItem onClick={() => reveal(node.path)}>
            <FolderOpen />
            Open in File Explorer
          </ContextMenuItem>

          <ContextMenuSeparator />

          <ContextMenuItem onClick={() => void duplicateProfile(node.path)}>
            <Copy />
            Duplicate
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              handingOff.current = true
              state.onRenaming(node.path)
            }}
          >
            <Pencil />
            Rename
            <ContextMenuShortcut>F2</ContextMenuShortcut>
          </ContextMenuItem>

          <ContextMenuSeparator />

          {/*
            Widening: the aeroplane, then the path a profile would include it
            by, then the path anything outside this window would need.
          */}
          <ContextMenuItem onClick={() => void copy(stem(node.name))}>
            <ClipboardCopy />
            Copy name
          </ContextMenuItem>
          <ContextMenuItem onClick={() => void copy(node.path)}>
            <ClipboardCopy />
            Copy relative path
          </ContextMenuItem>
          <ContextMenuItem onClick={() => void copy(fullPath(root, node.path))}>
            <ClipboardCopy />
            Copy path
          </ContextMenuItem>

          <ContextMenuSeparator />

          <ContextMenuItem
            variant="destructive"
            onClick={() => void deleteProfile(node.path)}
          >
            <Trash2 />
            Delete
            <ContextMenuShortcut>Del</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {isExpanded &&
        blocks.map((entry) => (
          <Fragment key={entry.block?.line ?? entry.sections[0].line}>
            {entry.block && (
              <OutlineRow
                node={entry.block}
                file={node.path}
                depth={depth + 1}
                isActive={activeLines.has(entry.block.line)}
              />
            )}

            {entry.sections.map((section) => (
              <OutlineRow
                key={section.line}
                node={section}
                file={node.path}
                depth={depth + (entry.block ? 2 : 1)}
                isActive={activeLines.has(section.line)}
              />
            ))}
          </Fragment>
        ))}
    </>
  )
}

export function FileTree() {
  const files = useStore((state) => state.files)
  const activePath = useStore((state) => state.activePath)
  const tree = useMemo(() => buildTree(files), [files])
  const list = useRef<HTMLDivElement>(null)
  /**
   * One at a time, held here rather than in the row, so that a rename left open
   * ends the moment the list is rebuilt under it — a rescan, a workspace
   * switch, or the rename itself landing.
   */
  const [renaming, setRenaming] = useState<string | null>(null)

  /*
   * The active file brings its row into view, the way the tab strip brings its
   * own tab in. Opening a profile from somewhere other than this list — the
   * current-aircraft box below it, a tab, Ctrl+Tab — should point at where the
   * file lives rather than silently highlighting a row off-screen.
   *
   * `tree` is a dependency because a file can be opened before it is listed: a
   * profile created from the box is opened immediately and appears here only
   * when the watcher reports it, a frame or two later.
   */
  useEffect(() => {
    list.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" })
  }, [activePath, tree])

  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const stored = localStorage.getItem(EXPANDED_KEY)
    if (!stored) return new Set()

    try {
      return new Set<string>(JSON.parse(stored) as string[])
    } catch {
      return new Set()
    }
  })

  // In practice the only folder here is `modules`, so start it open rather than
  // making people expand it every session.
  const [seeded, setSeeded] = useState(
    () => !!localStorage.getItem(EXPANDED_KEY)
  )

  if (!seeded && tree.length) {
    setSeeded(true)
    setExpanded(
      new Set(
        tree.filter((node) => node.type === "dir").map((node) => node.path)
      )
    )
  }

  const onToggle = (key: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]))
      return next
    })
  }

  if (!files.length)
    return (
      <p className="px-3 py-2 text-xs text-muted-foreground">
        No profiles in this folder.
      </p>
    )

  return (
    <div ref={list}>
      {tree.map((node) => (
        <Row
          key={node.path}
          node={node}
          depth={0}
          state={{ expanded, onToggle, renaming, onRenaming: setRenaming }}
        />
      ))}
    </div>
  )
}

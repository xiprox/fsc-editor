/**
 * Collecting a debug report, and putting it somewhere a person can find it.
 *
 * The format is docs/debug-report.md. This is the half that runs.
 *
 * ## One folder, and a zip inside it
 *
 * The first thing anybody does with a report is read one file out of it; the
 * second is attach the whole thing to a message. A zip alone serves the second
 * and makes the first a chore, and loose files alone serve the first and leave
 * "which of these twelve do I send?" to somebody who should not have to
 * answer it. So both, in one folder, revealed with the zip selected.
 *
 * ## Redaction is the last thing that happens
 *
 * Every collector produces text and none of them is trusted to have thought
 * about paths. The pass over the finished bytes is what makes that safe, and it
 * is deliberately the only place the rules live — a new collector cannot forget
 * to call it, because it does not get the chance.
 *
 * ## Nothing here throws
 *
 * A collector that fails removes one file and is named in `errors.txt`. The
 * only failure that ends the run is being unable to make the folder at all, and
 * that comes back as a reason the dialog can show.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import zlib from "node:zlib"

import { app } from "electron"

import type { DebugReport } from "@shared/types"

import { linkInstallState } from "../sim/install"
import { captureFile, captureFiles } from "../sim/capture"
import { currentWorkspace } from "../workspace"

import { redactText, type Roots } from "./redact"
import { sources, type Collected } from "./sources"
import { writeZip } from "./zip"

/** The format's version, not the app's. See docs/debug-report.md. */
const FORMAT_VERSION = 1

/**
 * What both the folder and the zip inside it are called.
 *
 * The same name deliberately. The zip is the thing that leaves the machine —
 * it lands in a chat window next to a dozen other attachments, and by then the
 * folder it came out of is not there to say what it was. So it carries the
 * whole name: what it is, which app it is from, and when it was taken.
 *
 * It also means extracting it reproduces the folder it was made from, because
 * Explorer names the destination after the archive.
 */
function reportName(at: Date): string {
  return `fsc-editor-report-${stamp(at)}`
}

/** `2026-08-26T14-02-11` — the same stamp captures use, for the same reasons. */
function stamp(at: Date): string {
  return at.toISOString().slice(0, 19).replace(/:/g, "-")
}

interface Entry {
  name: string
  bytes: number
  records?: number
}

/**
 * The directories worth naming, so the text pass can take them out.
 *
 * The Community folder is asked for rather than remembered because it is the
 * one root the app did not choose — discovery reads it out of the simulator's
 * own config, and on a machine with two simulators there are two of them.
 */
async function roots(): Promise<Roots> {
  let workspace: string | null = null
  try {
    workspace = currentWorkspace().root
  } catch {
    // No workspace chosen yet. Nothing to take out.
  }

  let community: string | null = null
  try {
    community = (await linkInstallState()).folders[0]?.path ?? null
  } catch {
    // Discovery failed, which the backstop in `redactText` covers anyway.
  }

  return {
    home: app.getPath("home"),
    userData: app.getPath("userData"),
    workspace,
    community,
  }
}

/**
 * Collects everything, writes the folder, and zips it.
 *
 * `aircraft` comes from the caller rather than being read here, because the
 * only honest answer lives in the live arm of `SimState` and unpacking a union
 * is not this module's business.
 */
export async function collectReport(
  aircraft: string | null
): Promise<DebugReport> {
  const at = new Date()
  const name = reportName(at)
  const folder = path.join(app.getPath("downloads"), name)

  // The one file in the folder that is not inside the zip, for obvious reasons.
  const zipName = `${name}.zip`

  try {
    fs.mkdirSync(folder, { recursive: true })
  } catch (error) {
    return { ok: false, reason: reasonOf(error) }
  }

  const redact = await redactor()
  const entries: Entry[] = []
  const errors: string[] = []

  const put = (collected: Collected): void => {
    const file = path.join(folder, collected.name)
    const text = redact(collected.text)

    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, text, "utf8")

    entries.push({
      name: collected.name,
      bytes: Buffer.byteLength(text),
      records: collected.records,
    })
  }

  for (const source of sources(aircraft)) {
    try {
      put(await source.collect())
    } catch (error) {
      errors.push(`${source.name}: ${reasonOf(error)}`)
    }
  }

  const captures = copyCaptures(folder, redact, entries, errors)

  if (errors.length)
    fs.writeFileSync(
      path.join(folder, "errors.txt"),
      `${errors.join("\n")}\n`,
      "utf8"
    )

  // Last, so it can describe everything that came before it — including itself
  // being the only file a reader is promised.
  const manifest = {
    version: FORMAT_VERSION,
    at: at.getTime(),
    atLocal: local(at),
    app: app.getVersion(),
    packaged: app.isPackaged,
    files: entries,
    captures,
    errors: errors.length,
  }
  fs.writeFileSync(
    path.join(folder, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  )

  const zip = path.join(folder, zipName)
  try {
    await writeZip(folder, zip, zipName)
  } catch (error) {
    // The folder is written and readable; only the convenience failed. Saying
    // so beats throwing away eleven files because the twelfth did not compress.
    fs.appendFileSync(
      path.join(folder, "errors.txt"),
      `zip: ${reasonOf(error)}\n`,
      "utf8"
    )
    return { ok: true, folder, zip: null, bytes: 0, errors: errors.length + 1 }
  }

  return {
    ok: true,
    folder,
    zip,
    bytes: fs.statSync(zip).size,
    errors: errors.length,
  }
}

/**
 * The captures on disk, gzipped into the report.
 *
 * All of them, not a window: the directory is already held to 100 MB by
 * `capture.ts`, which makes "everything there is" a bounded answer, and the
 * session worth reading is not always the one that is live. Somebody who flew,
 * landed, quit the sim and then noticed something wrong is describing the
 * previous file.
 *
 * Gzipped one at a time and released, because the raw total can be 100 MB and
 * this runs on a machine that is also running a flight simulator. Compression
 * happens here rather than being left to the zip so that the loose folder is
 * small too — an uncompressed copy sitting beside a compressed one would double
 * the cost of the thing on the way to halving it.
 */
function copyCaptures(
  folder: string,
  redact: (text: string) => string,
  entries: Entry[],
  errors: string[]
): { files: string[]; live: string | null } {
  const dir = path.join(folder, "captures")
  const written: string[] = []

  // Named rather than assumed to be the last one. It usually is, but a session
  // that has just rolled a part leaves two files a second apart, and "which one
  // is still being written" is the question the manifest is answering.
  const current = captureFile()
  let live: string | null = null

  for (const file of captureFiles(app.getPath("userData"))) {
    const name = `captures/${path.basename(file)}.gz`

    try {
      fs.mkdirSync(dir, { recursive: true })

      const gz = zlib.gzipSync(redact(fs.readFileSync(file, "utf8")), {
        level: 6,
      })
      fs.writeFileSync(path.join(folder, name), gz)

      written.push(name)
      entries.push({ name, bytes: gz.length })
      if (file === current) live = name
    } catch (error) {
      errors.push(`${name}: ${reasonOf(error)}`)
    }
  }

  return { files: written, live }
}

/** The text pass, built once so its patterns are compiled once. */
async function redactor(): Promise<(text: string) => string> {
  const known = await roots()
  const user = (() => {
    try {
      return os.userInfo().username
    } catch {
      return undefined
    }
  })()

  return (text: string) => redactText(text, known, user)
}

/** `2026-08-26T14:02:11+03:00`, for a human skimming the manifest. */
function local(at: Date): string {
  const offset = -at.getTimezoneOffset()
  const sign = offset < 0 ? "-" : "+"
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0")

  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `T${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}` +
    `${sign}${pad(offset / 60)}:${pad(offset % 60)}`
  )
}

/**
 * One line, always.
 *
 * `errors.txt` is one line per collector, and a reader counts them against
 * `manifest.errors`. Plenty of real messages arrive with newlines in them — a
 * SQLite complaint, anything that stringified a stack — and one of those turns
 * a three-failure report into a file that claims five.
 */
function reasonOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/\s*[\r\n]+\s*/g, " ").trim()
}

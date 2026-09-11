/**
 * What the panel scan finds in the cockpit that is loaded right now.
 *
 * Runs `scanPanels` from `src/main/sim/panels.ts` — the same code the app
 * runs, not a copy — against the simulator's debugger on 127.0.0.1:19999, and
 * prints one row per instrument: kind, size, the identifier a `pointer:` item
 * would get, and the full key beside it.
 *
 * Read-only. It lists documents and reads properties out of each; it puts
 * nothing in a panel and leaves nothing behind. Safe beside the app and
 * beside FS Copilot.
 *
 * Usage:
 *   npm run sim:panels
 *   npm run sim:panels -- --json       the raw scan, for a results file
 *   npm run sim:panels -- --port 19998
 *
 * Needs the sim in a flight. In a menu it reports `no-panels`, which is the
 * answer rather than a fault.
 */

import { INSPECTOR_PORT, scanPanels } from "../src/main/sim/panels.ts"

const args = process.argv.slice(2)
const portAt = args.indexOf("--port")
const port = portAt >= 0 ? Number(args[portAt + 1]) : INSPECTOR_PORT

const started = Date.now()
const scan = await scanPanels(port)
const took = Date.now() - started

if (args.includes("--json")) {
  console.log(JSON.stringify(scan, null, 2))
} else if (!scan.ok) {
  console.log(`${scan.reason}: ${scan.detail}  (${took}ms)`)
} else {
  const wide = Math.max(...scan.panels.map((panel) => panel.identifier.length))
  for (const panel of scan.panels)
    console.log(
      [
        panel.kind.padEnd(4),
        (panel.interactive ? "interactive" : "").padEnd(11),
        (panel.unread ? "unread" : `${panel.width}x${panel.height}`).padStart(
          9
        ),
        panel.identifier.padEnd(wide),
        panel.key === panel.identifier ? "" : panel.key,
        `  [${panel.title}]`,
      ].join("  ")
    )
  for (const page of scan.skipped)
    console.log(`skipped  ${page.title}: ${page.detail}`)
  console.log(
    `\n${scan.panels.length} instruments, ${scan.skipped.length} skipped, ${took}ms`
  )
}

process.exitCode = scan.ok ? 0 : 1

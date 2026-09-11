/*
 * Writes `layout.json` for a package fspackagetool has already built.
 *
 * fspackagetool owns `manifest.json` and does it well — it corrected
 * `minimum_game_version` from a hand-guessed 1.6.34 to the sim's actual 1.8.14,
 * which is exactly the sort of thing we adopted it for. But it emits **no
 * layout.json**, with an empty `_RPTErrors.xml` and no complaint.
 *
 * Every other package installed on this machine has one, Asobo's own 2024
 * packages included, and our earlier hand-built package — which had one — was
 * registered by the simulator. So absence is a gap in the tool rather than a
 * statement that the file is obsolete, and guessing wrong costs a sim restart.
 *
 * Two things this gets right that the first hand-written version did not:
 * `date` is a bare number, not a quoted string, and the digits survive
 * intact — a Windows FILETIME is around 1.34e17, past Number.MAX_SAFE_INTEGER,
 * so the JSON is assembled from a BigInt rather than round-tripped through a
 * JS number.
 */
import fs from "node:fs"
import path from "node:path"

const pkg = process.argv[2]
if (!pkg || !fs.existsSync(pkg)) {
  console.error(`no package at ${pkg}`)
  process.exit(1)
}

/** Windows FILETIME: 100ns ticks since 1601-01-01, kept as exact digits. */
const filetime = (ms) => ((BigInt(Math.floor(ms)) + 11644473600000n) * 10000n).toString()

const content = []
;(function walk(dir, rel) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name)
    const r = (rel ? `${rel}/` : "") + entry.name
    if (entry.isDirectory()) {
      walk(abs, r)
      continue
    }
    if (entry.name === "layout.json" || entry.name === "manifest.json") continue

    const stat = fs.statSync(abs)
    content.push({ path: r.toLowerCase(), size: stat.size, date: filetime(stat.mtimeMs) })
  }
})(pkg, "")

const rows = content
  .map(
    (item) =>
      `    {\n      "path": ${JSON.stringify(item.path)},\n` +
      `      "size": ${item.size},\n      "date": ${item.date}\n    }`
  )
  .join(",\n")

fs.writeFileSync(path.join(pkg, "layout.json"), `{\n  "content": [\n${rows}\n  ]\n}\n`)
console.log(`  layout.json written — ${content.length} file(s)`)

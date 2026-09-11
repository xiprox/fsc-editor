/*
 * Checks a built module against what MSFS requires of one, before it is
 * installed.
 *
 * This exists because none of the ways to get a wasm module wrong fail at build
 * time. A module missing the allocator exports links perfectly, installs
 * perfectly, is registered by the simulator, and is then simply never
 * scheduled — which you discover after a sim restart, from a Status: FAILED in
 * a dev-tools panel. Two restarts went that way.
 *
 * So the invariants are asserted here instead, where being wrong costs a
 * second. The required list is not invented: it is the set FS Copilot's working
 * module exports, cross-checked against the `--export` flags in the MSFS2024
 * toolset's own link line.
 */
import fs from "node:fs"

/**
 * MSFS drives a module's memory by calling into it, so these are not
 * decoration — a module without them registers and never runs.
 */
const REQUIRED = [
  "malloc",
  "free",
  "mallinfo",
  "mchunkit_begin",
  "mchunkit_next",
  "get_pages_state",
  "mark_decommit_pages",
  "__wasm_call_ctors",
  "GetSimConnectVersion",
]

/** Ours: the standalone module lifecycle MSFS looks for. */
const LIFECYCLE = ["module_init", "module_deinit", "Update_StandAlone"]

function parse(file) {
  const b = fs.readFileSync(file)
  if (b.readUInt32LE(0) !== 0x6d736100) throw new Error(`${file} is not a wasm module`)

  let o = 8
  const u = () => {
    let r = 0, s = 0, y
    do { y = b[o++]; r |= (y & 0x7f) << s; s += 7 } while (y & 0x80)
    return r >>> 0
  }
  const str = () => { const n = u(); const s = b.toString("utf8", o, o + n); o += n; return s }

  const imports = [], exports = []
  while (o < b.length) {
    const id = b[o++], size = u(), end = o + size
    if (id === 2) {
      const n = u()
      for (let i = 0; i < n; i++) {
        const m = str(), f = str(), kind = b[o++]
        if (kind === 0) { u(); imports.push(`${m}.${f}`) }
        else if (kind === 1) { o++; const fl = b[o++]; u(); if (fl & 1) u() }
        else if (kind === 2) { const fl = b[o++]; u(); if (fl & 1) u() }
        else if (kind === 3) { o++; o++ }
      }
    } else if (id === 7) {
      const n = u()
      for (let i = 0; i < n; i++) { const nm = str(); const k = b[o++]; u(); if (k === 0) exports.push(nm) }
    }
    o = end
  }
  return { imports, exports }
}

const file = process.argv[2]
const { imports, exports } = parse(file)
const has = new Set(exports)

const missing = [...REQUIRED, ...LIFECYCLE].filter((name) => !has.has(name))

if (missing.length) {
  console.error(`  FAIL — ${missing.length} required export(s) missing:`)
  for (const name of missing) console.error(`    ${name}`)
  console.error("")
  console.error("  MSFS will register this module and never schedule it.")
  console.error("  The toolset's link line supplies these; a hand-written one usually does not.")
  process.exit(1)
}

const host = imports.filter((name) => name.startsWith("env."))
console.log(`  OK — ${REQUIRED.length + LIFECYCLE.length} required exports present`)
console.log(`  ${host.length} host imports:`)
for (const name of host) console.log(`    ${name.slice(4)}`)

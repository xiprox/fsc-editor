/**
 * Runs a shell script under **Git Bash**, whatever shell invoked npm.
 *
 * `"link:build": "bash link/build.sh"` looks portable and is not. On Windows,
 * `bash` is whatever is first on PATH, and from PowerShell that is
 * `WindowsApps\bash.exe` — the WSL shim. `build.sh` is a Git Bash script: it
 * uses `/c/Program Files/...` paths, `cygpath`, and the `cmd.exe //c` escape
 * that exists because MSYS rewrites a leading single slash. None of that means
 * anything under WSL.
 *
 * What that failure looked like is the reason this file exists rather than a
 * line in the README. Under WSL the script inherits no Windows environment, so
 * `APPDATA` and `USERPROFILE` were both empty; it fell through to asking
 * `cmd.exe`, whose `//c` arrived uninterpreted so cmd started interactively and
 * printed its banner; and the banner was accepted as a filesystem path. The
 * error was `Could not locate the Community folder (tried Microsoft Windows
 * [Version 10.0.26200.9168](c) Microsoft Corporation...)`. Nothing about that
 * says "wrong shell".
 *
 * Git Bash is found from `git` itself rather than from `C:\Program Files\Git`,
 * because it is not always there — this machine installs git with scoop, at
 * `~/scoop/apps/git/current`. Wherever `git.exe` lives, `../bin/bash.exe` is
 * beside it.
 */

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import path from "node:path"

/** Candidates, best first. `FSCE_BASH` wins, for an install we cannot guess. */
function findBash() {
  if (process.env.FSCE_BASH) return process.env.FSCE_BASH

  const candidates = []

  // `git.exe` sits in `<root>/cmd`, and Git Bash in `<root>/bin`.
  const where = spawnSync(process.platform === "win32" ? "where" : "which", ["git"], {
    encoding: "utf8",
  })

  const git = where.stdout?.split(/\r?\n/).find((line) => line.trim().endsWith(".exe"))
  if (git) {
    /*
     * Walk up from `git.exe` rather than assuming it sits in `<root>/cmd`.
     *
     * It does on a Git-for-Windows install and it does not on a scoop one,
     * where `where git` answers `<version>/mingw64/bin/git.exe` — so the
     * old two-level guess landed on `<version>/mingw64` and looked for a
     * bash one directory further up than it searched. The symptom was a
     * flat "Could not find Git Bash" on a machine that plainly had it.
     */
    let directory = path.dirname(git.trim())
    for (let up = 0; up < 4; up++) {
      candidates.push(path.join(directory, "bin", "bash.exe"))
      candidates.push(path.join(directory, "usr", "bin", "bash.exe"))

      const parent = path.dirname(directory)
      if (parent === directory) break
      directory = parent
    }
  }

  for (const base of [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]) {
    if (base) candidates.push(path.join(base, "Git", "bin", "bash.exe"))
  }

  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

const script = process.argv[2]
if (!script) {
  console.error("usage: node link/tools/bash.mjs <script.sh> [args...]")
  process.exit(2)
}

// Not Windows: `bash` on PATH is the real thing, and none of the above applies.
const bash = process.platform === "win32" ? findBash() : "bash"

if (!bash) {
  console.error("Could not find Git Bash.")
  console.error("")
  console.error("This script needs Git Bash specifically — the WSL `bash` on")
  console.error("PATH cannot run it. Install Git for Windows, or set FSCE_BASH")
  console.error("to the full path of its bash.exe.")
  process.exit(1)
}

const result = spawnSync(bash, [script, ...process.argv.slice(3)], {
  stdio: "inherit",
  // Git Bash resolves a Windows-style script path fine, and this keeps the
  // working directory the repo root however npm was invoked.
  cwd: process.cwd(),
})

process.exit(result.status ?? 1)

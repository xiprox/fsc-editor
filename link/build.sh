#!/usr/bin/env bash
#
# Builds the Link module and installs it into the Community folder.
#
#   npm run link:build
#
# Three steps, and none of them describes how to build a wasm module or what a
# Community package looks like:
#
#   1. MSBuild, through the MSFS2024 toolset  — owns every compile/link flag
#   2. tools/check.mjs                        — asserts the exports MSFS needs
#   3. tools/version.mjs                      — one version, not two
#   4. fspackagetool, from the SDK            — owns manifest.json/layout.json
#
# Steps 2 and 3 exist because steps 1 and 4 used to be hand-written here, and
# every way of getting them wrong succeeded at build time and failed only in the
# simulator — a sim restart per mistake. The invariants are now asserted where
# being wrong costs a second.
#
# Requires: MSFS SDK, MSFS itself (fspackagetool drives it), and Visual Studio
# with the MSFS platform toolset. All maintainer tools — the module ships built,
# and the app's installer only ever copies the finished folder.
set -euo pipefail

# This is a Git Bash script, and says so before it does any damage.
#
# It uses `/c/Program Files/...`, `cygpath`, and the `cmd.exe //c` escape that
# only means anything where MSYS rewrites a leading single slash. Under WSL —
# which is what `bash` resolves to from PowerShell, via `WindowsApps\bash.exe` —
# every one of those quietly does something else, and the first symptom is a
# complaint about a Community folder whose path is a cmd.exe banner. Run through
# `npm run link:build`, which picks the right shell; see `tools/bash.mjs`.
case "${OSTYPE:-}" in
  msys* | cygwin*) ;;
  *)
    echo "This script needs Git Bash. \$OSTYPE is '${OSTYPE:-unset}'." >&2
    echo "Run it as: npm run link:build" >&2
    exit 1
    ;;
esac

HERE="$(cd "$(dirname "$0")" && pwd)"
SDK="${MSFS_SDK:-C:/MSFS 2024 SDK}"
PACKAGE_TOOL="$SDK/Tools/bin/fspackagetool.exe"

# Where the roaming profile is. `$APPDATA` is not reliably present: running this
# through `npm run` from PowerShell drops it, and `set -u` then aborts on line
# one. `${VAR:-}` everywhere below, and a fallback built from USERPROFILE.
roaming() {
  [ -n "${APPDATA:-}" ] && { echo "$APPDATA"; return; }
  [ -n "${USERPROFILE:-}" ] && { echo "$USERPROFILE/AppData/Roaming"; return; }

  # Ask Windows, rather than guessing from HOME. Git Bash can be started with a
  # POSIX-style HOME — /home/someone — that has nothing to do with the Windows
  # profile, and building a path from it produces a directory that has never
  # existed. cmd knows, whatever the shell thinks.
  # `//c`, not `/c` — MSYS rewrites a leading single slash as a drive path, so
  # `cmd.exe /c` arrives as `cmd.exe C:/c` and cmd opens a banner instead of
  # answering. The doubled slash is the escape.
  #
  # The answer is checked for being a path, not merely for being non-empty.
  # When `//c` is not understood — which is every shell that is not MSYS — cmd
  # starts interactively and prints its banner, and the banner is a long
  # non-empty string that is not `%APPDATA%`. That passed both of the old tests
  # and was then used as a directory. `-d` is the only check worth making.
  local answer
  answer="$(cmd.exe //c "echo %APPDATA%" 2>/dev/null | tr -d '\r\n')"
  answer="${answer//\\//}"
  if [ -n "$answer" ] && [ -d "$answer" ]; then
    echo "$answer"
    return
  fi

  # Last resort, and only a guess at the layout rather than an answer from it.
  [ -n "${USERNAME:-}" ] && { echo "/c/Users/$USERNAME/AppData/Roaming"; return; }

  echo ""
}

# `UserCfg.opt` holds `InstalledPackagesPath` and is authoritative across MS
# Store, Steam and relocated installs — 04-connection says the app must read it
# rather than guess, so this reads it too instead of hardcoding a path that
# happens to work on one machine.
find_community() {
  if [ -n "${FSCE_COMMUNITY:-}" ]; then echo "$FSCE_COMMUNITY"; return; fi

  local base packages cfg
  base="$(roaming)"
  [ -n "$base" ] || { echo ""; return; }

  cfg="$base/Microsoft Flight Simulator 2024/UserCfg.opt"
  if [ -f "$cfg" ]; then
    packages="$(grep -i "InstalledPackagesPath" "$cfg" | head -1 | sed 's/[^"]*"//; s/"[^"]*$//')"
    [ -n "$packages" ] && [ -d "$packages/Community" ] && { echo "$packages/Community"; return; }
  fi

  echo "$base/Microsoft Flight Simulator 2024/Packages/Community"
}

COMMUNITY="$(find_community)"
if [ -z "$COMMUNITY" ] || [ ! -d "$COMMUNITY" ]; then
  echo "Could not locate the Community folder${COMMUNITY:+ (tried $COMMUNITY)}." >&2
  echo "Set FSCE_COMMUNITY to it and run again." >&2
  exit 1
fi

find_msbuild() {
  if [ -n "${MSBUILD:-}" ]; then echo "$MSBUILD"; return; fi
  for edition in Enterprise Professional Community BuildTools; do
    local candidate="/c/Program Files/Microsoft Visual Studio/2022/$edition/MSBuild/Current/Bin/MSBuild.exe"
    [ -x "$candidate" ] && { echo "$candidate"; return; }
  done
  echo ""
}

# fspackagetool drives FlightSimulator2024.exe, and with the game already
# running it does not fail — it hangs, holding the build until killed. Twice now
# that has cost several minutes and a confusing half-installed state, so it is
# checked up front where the message can say what to do about it.
if tasklist 2>/dev/null | grep -qi "FlightSimulator2024.exe"; then
  echo "MSFS is running. fspackagetool drives the sim executable and will hang" >&2
  echo "waiting for it — close the simulator and run this again." >&2
  exit 1
fi

MSBUILD_EXE="$(find_msbuild)"
if [ -z "$MSBUILD_EXE" ]; then
  echo "Could not find MSBuild. Install Visual Studio with the MSFS platform" >&2
  echo "toolset, or set MSBUILD to its MSBuild.exe." >&2
  exit 1
fi
[ -f "$PACKAGE_TOOL" ] || { echo "No fspackagetool at $PACKAGE_TOOL — set MSFS_SDK." >&2; exit 1; }

# ---- 1. the module ---------------------------------------------------------
# Deleted first, so a failed compile cannot leave the previous binary in place
# for the export check to validate and pass. That nearly shipped once.
rm -f "$HERE/PackageSources/Modules/fsc-editor-link.wasm"

echo "building the module (MSFS2024 toolset)..."
"$MSBUILD_EXE" "$HERE/fsc-editor-link.vcxproj" \
  -p:Configuration=Release -p:Platform=MSFS -v:minimal -nologo \
  | grep -viE "warning|message :|^ *In file" || true

WASM="$HERE/PackageSources/Modules/fsc-editor-link.wasm"
[ -f "$WASM" ] || { echo "build produced no .wasm" >&2; exit 1; }

# ---- 2. is it a module MSFS will actually schedule? ------------------------
echo
echo "checking exports..."
node "$HERE/tools/check.mjs" "$WASM"

# ---- 3. one version, not two -----------------------------------------------
# Before packaging, because fspackagetool reads the definition to write
# manifest.json. See tools/version.mjs for how the two drifted.
echo
echo "syncing the version..."
node "$HERE/tools/version.mjs" sync

# ---- 4. the package --------------------------------------------------------
# fspackagetool drives FlightSimulator2024.exe to do the packaging, so it
# cannot run while the sim is open. That is the one surprising thing about it.
echo
echo "packaging (fspackagetool)..."
"$PACKAGE_TOOL" "$(cygpath -w "$HERE/link.xml" 2>/dev/null || echo "$HERE/link.xml")" -nopause \
  | tail -5

BUILT="$HERE/Packages/fsc-editor-link"
[ -d "$BUILT" ] || { echo "fspackagetool produced no package at $BUILT" >&2; exit 1; }

# What the tool actually wrote, rather than what it was asked for. The same
# tool has already been caught emitting no layout.json without complaining.
node "$HERE/tools/version.mjs" check "$BUILT"

# fspackagetool emits manifest.json but not layout.json — no error, just absent.
# Every other package on disk has one, so the gap gets filled rather than
# trusted. See tools/layout.mjs.
node "$HERE/tools/layout.mjs" "$BUILT"

# ---- 5. record what this was built from ------------------------------------
# The package is committed and no hosted runner can reproduce it, so CI checks
# that the committed binary matches the committed source instead. That check
# needs a number to compare against, and the only honest moment to write it is
# here — a hash a person updates by hand is one more thing to forget. See
# scripts/check-module.ts and docs/pipeline/08-module.md.
#
# Beside the package rather than inside it: everything in `Packages/
# fsc-editor-link` is copied into somebody's Community folder, and a file MSFS
# did not put in layout.json has no business being there.
echo
echo "recording the source hash..."
node --experimental-strip-types "$HERE/../scripts/check-module.ts" --hash \
  > "$HERE/Packages/source.sha256"

# ---- install ---------------------------------------------------------------
echo
echo "installing to $COMMUNITY/fsc-editor-link"
rm -rf "$COMMUNITY/fsc-editor-link"
mkdir -p "$COMMUNITY/fsc-editor-link"
cp -r "$BUILT/." "$COMMUNITY/fsc-editor-link/"

echo
echo "done. RESTART MSFS — packages are scanned at boot."
echo "then:  npm run link:read"

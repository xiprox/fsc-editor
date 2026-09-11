# Goals

    Purpose:    What this feature set is for, who it serves, and what it is not.
    Depends on: nothing
    Decides:    scope, non-goals, positioning

## The problem

Writing an FS Copilot profile means knowing which variables an aircraft exposes
and which of them are worth binding. Today that knowledge comes from three
places, all of them indirect: other people's profiles, MSFS's developer tools,
and guessing.

The editor already exploits the first of those well — `src/main/vars.ts` builds
a dictionary of ~12,000 distinct variables from the ~55 installed profiles,
with usage counts, units, documentation comments and working `set:`
expressions. That corpus is genuinely good, and it has one structural blind
spot: **it can only contain variables somebody has already bound.** The
variable being hunted for is, by definition, usually not one of those.

Closing that gap needs the simulator, or the addon's own files, or both.

## Who it is for

Profile authors. In practice that is a small number of people who write
profiles for aircraft they own and share them, debugging in pairs over the
existing Remote Connect feature. The tool should assume competence and optimize
for the tenth hour, not the first.

## What success looks like

Three scenarios, in increasing order of how badly they are served today:

1. **"Which variable does this switch move?"** — flip the switch, get an answer
   in seconds rather than minutes of scrolling a watch window.
2. **"Which variable holds this internal state?"** — no switch to flip, nothing
   to click, and no existing tool helps at all. Answering this at all is new.
3. **"I just bought an addon and have no profile."** — start from a document
   that already lists the aircraft's variables, grouped by system, labelled
   with the manufacturer's own tooltip text, with units and a proposed `set:`
   for each. This is the largest saving and the least obvious use case.

## Non-goals

- **Replacing MSFS's Behaviors window.** Its element inspection is good and we
  should not try to beat it at pointing at a knob and seeing its template.
- **Being a general SimConnect client.** No instruments, no autopilot control,
  no map. Everything here exists to get a variable name into a profile.
- **Cross-machine sim access.** The relay could carry a peer's findings later
  (see [14-sweep-and-testing](14-sweep-and-testing.md)) but v1 assumes the sim
  is on this machine.
- **MSFS 2020.** Not excluded on principle, but 2024 is what is installed here
  and what the input-event work leans on. See
  [17-open-questions](17-open-questions.md).

## Positioning

**Against MSFS's dev tools:** they answer questions about the element under the
cursor, right now, with developer mode on. They persist nothing, cannot search
across aircraft, know nothing about which variables working profiles actually
use, and cannot answer a question about something that already happened. Those
four gaps are the product.

**Against SPAD.neXt and similar:** the closest existing thing, and its search is
the specific weakness to beat — literal substring matching where one extra
space breaks a query. See [06-variables-panel](06-variables-panel.md).

**The unique asset is the corpus.** No other tool has ~12,000 variables ranked
by how many working profiles use them, alongside the expressions those profiles
write. That ranking signal recurs throughout: it sorts completions, it sorts
search results, and it is one of the two oracles that make offline file mining
safe ([11-static-analysis](11-static-analysis.md)).

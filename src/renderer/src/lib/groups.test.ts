/**
 * The group arithmetic.
 *
 * What is worth asserting here is everything the single-pane version got for
 * free and a split has to be told: that a file open twice is one open file, that
 * closing it in one pane leaves the other alone, and that a group emptying
 * itself is how a split is undone.
 */

import { describe, expect, it } from "vitest"

import {
  createGroup,
  moveBetween,
  moveWithin,
  normalize,
  openCount,
  renamedTab,
  resizeAt,
  splitGroup,
  unionTabs,
  withoutTab,
  withoutTabEverywhere,
  withTab,
} from "./groups"

/** Two groups with known ids, so assertions can name them. A settled row: the
 * shares already sum to 1, which is the invariant `normalize` maintains. */
function pair() {
  const left = createGroup(["a.yaml", "b.yaml"], "a.yaml", 0.5)
  const right = createGroup(["b.yaml"], "b.yaml", 0.5)
  return { left, right, groups: [left, right] }
}

/** Shares, rounded, so a third of a row can be asserted without noise. */
const sharesOf = (groups: { share: number }[]) =>
  groups.map((group) => Math.round(group.share * 1000) / 1000)

describe("unionTabs", () => {
  it("counts a file open in two groups once", () => {
    const { groups } = pair()
    expect(unionTabs(groups)).toEqual(["a.yaml", "b.yaml"])
  })

  it("keeps the order the groups first mention them in", () => {
    const groups = [createGroup(["c.yaml"]), createGroup(["a.yaml", "c.yaml"])]
    expect(unionTabs(groups)).toEqual(["c.yaml", "a.yaml"])
  })
})

describe("withTab", () => {
  it("appends and activates", () => {
    const { left, groups } = pair()
    const next = withTab(groups, left.id, "c.yaml")

    expect(next[0].tabs).toEqual(["a.yaml", "b.yaml", "c.yaml"])
    expect(next[0].active).toBe("c.yaml")
  })

  it("brings an already-open file forward rather than opening it twice", () => {
    const { left, groups } = pair()
    const next = withTab(groups, left.id, "b.yaml")

    expect(next[0].tabs).toEqual(["a.yaml", "b.yaml"])
    expect(next[0].active).toBe("b.yaml")
  })

  it("places at an index, for a tab dropped into the middle of a strip", () => {
    const { left, groups } = pair()
    expect(withTab(groups, left.id, "c.yaml", 1)[0].tabs).toEqual([
      "a.yaml",
      "c.yaml",
      "b.yaml",
    ])
  })

  it("leaves other groups untouched", () => {
    const { left, right, groups } = pair()
    const next = withTab(groups, left.id, "c.yaml")

    expect(next[1]).toBe(right)
  })
})

describe("withoutTab", () => {
  it("closes in one group only", () => {
    const { left, groups } = pair()
    const next = withoutTab(groups, left.id, "b.yaml")

    expect(next[0].tabs).toEqual(["a.yaml"])
    expect(next[1].tabs).toEqual(["b.yaml"])
    expect(openCount(next, "b.yaml")).toBe(1)
  })

  it("hands active to whichever tab slid into the gap", () => {
    const group = createGroup(["a.yaml", "b.yaml", "c.yaml"], "b.yaml")
    expect(withoutTab([group], group.id, "b.yaml")[0].active).toBe("c.yaml")
  })

  it("falls back to the new last tab when the gap is at the end", () => {
    const group = createGroup(["a.yaml", "b.yaml"], "b.yaml")
    expect(withoutTab([group], group.id, "b.yaml")[0].active).toBe("a.yaml")
  })

  it("leaves active alone when some other tab closed", () => {
    const group = createGroup(["a.yaml", "b.yaml"], "a.yaml")
    expect(withoutTab([group], group.id, "b.yaml")[0].active).toBe("a.yaml")
  })
})

describe("withoutTabEverywhere", () => {
  it("takes a vanished file out of every group", () => {
    const { groups } = pair()
    const next = withoutTabEverywhere(groups, "b.yaml")

    expect(openCount(next, "b.yaml")).toBe(0)
    expect(next[1].active).toBeNull()
  })
})

describe("renamedTab", () => {
  it("re-keys the tab and the active path in every group holding it", () => {
    const { groups } = pair()
    const next = renamedTab(groups, "b.yaml", "c.yaml")

    expect(next[0].tabs).toEqual(["a.yaml", "c.yaml"])
    expect(next[1].tabs).toEqual(["c.yaml"])
    expect(next[1].active).toBe("c.yaml")
  })
})

describe("moveWithin", () => {
  it("reorders", () => {
    const group = createGroup(["a.yaml", "b.yaml", "c.yaml"], "a.yaml")
    expect(moveWithin([group], group.id, 0, 2)[0].tabs).toEqual([
      "b.yaml",
      "c.yaml",
      "a.yaml",
    ])
  })

  it("refuses an index that is not a tab", () => {
    const group = createGroup(["a.yaml"], "a.yaml")
    expect(moveWithin([group], group.id, 0, 5)[0]).toBe(group)
  })
})

describe("moveBetween", () => {
  it("carries a tab across and activates it where it lands", () => {
    const { left, right, groups } = pair()
    const next = moveBetween(groups, "a.yaml", left.id, right.id, 0)

    expect(next[0].tabs).toEqual(["b.yaml"])
    expect(next[1].tabs).toEqual(["a.yaml", "b.yaml"])
    expect(next[1].active).toBe("a.yaml")
  })

  it("is a no-op within one group, which is a reorder instead", () => {
    const { left, groups } = pair()
    expect(moveBetween(groups, "a.yaml", left.id, left.id)).toBe(groups)
  })
})

describe("splitGroup", () => {
  it("puts the new group after the one it came from, holding one file", () => {
    const { left, groups } = pair()
    const { groups: next, group } = splitGroup(groups, left.id, "a.yaml")

    expect(next.map((entry) => entry.id)).toEqual([left.id, group.id, next[2].id])
    expect(group.tabs).toEqual(["a.yaml"])
    expect(group.active).toBe("a.yaml")
  })

  it("can open before, for a drop on the leading edge", () => {
    const { left, groups } = pair()
    const { groups: next, group } = splitGroup(
      groups,
      left.id,
      "a.yaml",
      "before"
    )

    expect(next[0].id).toBe(group.id)
  })

  it("splits empty, for a split with nothing open", () => {
    const group = createGroup()
    const { group: made } = splitGroup([group], group.id, null)

    expect(made.tabs).toEqual([])
    expect(made.active).toBeNull()
  })

  it("takes the new pane's room out of the one it came from", () => {
    const { left, groups } = pair()
    const { groups: next } = splitGroup(groups, left.id, "a.yaml")

    // The right-hand pane, which had nothing to do with it, does not move.
    expect(sharesOf(next)).toEqual([0.25, 0.25, 0.5])
  })

  it("halves a lopsided pane without redealing the row", () => {
    const wide = createGroup(["a.yaml"], "a.yaml", 0.8)
    const narrow = createGroup(["b.yaml"], "b.yaml", 0.2)
    const { groups } = splitGroup([wide, narrow], wide.id, "a.yaml")

    expect(sharesOf(groups)).toEqual([0.4, 0.4, 0.2])
  })
})

describe("shares", () => {
  it("hands a closed pane's room to the survivors in proportion", () => {
    const a = createGroup(["a.yaml"], "a.yaml", 0.5)
    const b = createGroup(["b.yaml"], "b.yaml", 0.25)
    const c = createGroup([], null, 0.25)

    // `c` has run out of tabs, so it closes and its quarter is shared out two
    // to one — the ratio `a` and `b` already stood in.
    expect(sharesOf(normalize([a, b, c], a.id).groups)).toEqual([0.667, 0.333])
  })

  it("always leaves the row summing to one", () => {
    const groups = [
      createGroup(["a.yaml"], "a.yaml", 3),
      createGroup(["b.yaml"], "b.yaml", 1),
    ]

    expect(sharesOf(normalize(groups, groups[0].id).groups)).toEqual([0.75, 0.25])
  })

  it("divides evenly when the sizes are unusable", () => {
    const groups = [
      createGroup(["a.yaml"], "a.yaml", 0),
      createGroup(["b.yaml"], "b.yaml", 0),
    ]

    expect(sharesOf(normalize(groups, groups[0].id).groups)).toEqual([0.5, 0.5])
  })

  it("gives the last pane the whole row", () => {
    const group = createGroup([], null, 0.3)
    expect(normalize([group], group.id).groups[0].share).toBe(1)
  })
})

describe("resizeAt", () => {
  it("moves room between the two panes either side, and no others", () => {
    const groups = [
      createGroup(["a.yaml"], "a.yaml", 1 / 3),
      createGroup(["b.yaml"], "b.yaml", 1 / 3),
      createGroup(["c.yaml"], "c.yaml", 1 / 3),
    ]

    const next = resizeAt(groups, 0, 0.1, 0.12)
    expect(sharesOf(next)).toEqual([0.433, 0.233, 0.333])
  })

  it("will not squeeze either of the pair below the floor", () => {
    const groups = [
      createGroup(["a.yaml"], "a.yaml", 0.5),
      createGroup(["b.yaml"], "b.yaml", 0.5),
    ]

    // A yank far past the edge stops at 12% of the room the two of them share.
    expect(sharesOf(resizeAt(groups, 0, -5, 0.12))).toEqual([0.12, 0.88])
    expect(sharesOf(resizeAt(groups, 0, 5, 0.12))).toEqual([0.88, 0.12])
  })

  it("ignores a divider that is not between two panes", () => {
    const groups = [createGroup(["a.yaml"], "a.yaml", 1)]
    expect(resizeAt(groups, 0, 0.2, 0.12)).toBe(groups)
  })
})

describe("normalize", () => {
  it("drops a group that has run out of tabs", () => {
    const { left, right } = pair()
    const emptied = { ...right, tabs: [], active: null }
    const { groups } = normalize([left, emptied], left.id)

    // The survivor keeps its tabs and takes the room the closed pane gave up.
    expect(groups).toEqual([{ ...left, share: 1 }])
  })

  it("moves focus to the neighbour when the focused group closes", () => {
    const { left, right } = pair()
    const emptied = { ...left, tabs: [], active: null }
    const { focusedGroup } = normalize([emptied, right], left.id)

    expect(focusedGroup).toBe(right.id)
  })

  it("keeps the last group even with nothing in it", () => {
    const group = createGroup([], null)
    const { groups, focusedGroup } = normalize([group], group.id)

    expect(groups).toHaveLength(1)
    expect(groups[0].tabs).toEqual([])
    expect(focusedGroup).toBe(group.id)
  })

  it("keeps the focused group when it still has tabs", () => {
    const { left, right, groups } = pair()
    expect(normalize(groups, right.id).focusedGroup).toBe(right.id)
    expect(normalize(groups, left.id).groups).toEqual(groups)
  })
})

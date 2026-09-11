import { describe, expect, it } from "vitest"

import { newProfile, profileIsFor, profileKey } from "./aircraft.ts"

describe("profileIsFor", () => {
  it("matches the aircraft's own profile, case aside", () => {
    expect(profileIsFor("pa24-250.yaml", "pa24-250")).toBe(true)
    expect(profileIsFor("PA24-250.yaml", "Pa24-250")).toBe(true)
  })

  it("refuses another aircraft's profile, a working copy and a module", () => {
    expect(profileIsFor("a220.yaml", "pa24-250")).toBe(false)
    expect(profileIsFor("pa24-250-old.yaml", "pa24-250")).toBe(false)
    expect(profileIsFor("modules/pa24-250.yaml", "pa24-250")).toBe(false)
  })

  it("is false with no file or no aircraft", () => {
    expect(profileIsFor(null, "pa24-250")).toBe(false)
    expect(profileIsFor("pa24-250.yaml", null)).toBe(false)
  })
})

describe("profileKey", () => {
  it("reads the aircraft out of a root-level profile", () => {
    expect(profileKey("pa24-250.yaml")).toBe("pa24-250")
    expect(profileKey("bksq-aircraft-baronpropress.yml")).toBe(
      "bksq-aircraft-baronpropress"
    )
  })

  it("is case-insensitive, because the sim's key and the file need not agree", () => {
    expect(profileKey("PA24-250.YAML")).toBe("pa24-250")
  })

  // The whole point of the rule: FS Copilot loads `<key>.yaml` and nothing
  // else, so a suffixed file is a working copy the sim ignores.
  it("refuses a suffixed name rather than folding it", () => {
    expect(profileKey("pa24-250-default.yaml")).toBe("pa24-250-default")
    expect(profileKey("pa24-250-old.yaml")).toBe("pa24-250-old")
  })

  it("refuses anything in a subdirectory", () => {
    expect(profileKey("modules/pa24-250.yaml")).toBeNull()
    expect(profileKey("modules\\pa24-250.yaml")).toBeNull()
  })

  it("refuses what is not a profile at all", () => {
    expect(profileKey("pa24-250.txt")).toBeNull()
    expect(profileKey(".yaml")).toBeNull()
  })
})

describe("newProfile", () => {
  it("names the aircraft, stamps the day, and carries one entry", () => {
    expect(newProfile("pa24-250", new Date(2026, 7, 25, 9))).toBe(
      [
        "# pa24-250",
        "# Updated: 2026-08-25",
        "",
        "shared:",
        "  # Example entry",
        "  - get: A:AMBIENT TEMPERATURE, Celsius",
        "",
      ].join("\n")
    )
  })

  // Late enough in the day that UTC has already rolled over east of
  // Greenwich, which is what `toISOString` would have stamped here.
  it("stamps the author's day rather than UTC's", () => {
    expect(newProfile("pa24-250", new Date(2026, 0, 1, 23, 30))).toContain(
      "# Updated: 2026-01-01"
    )
  })
})

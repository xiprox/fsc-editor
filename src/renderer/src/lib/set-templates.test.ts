/**
 * Every template is the kind its label claims, and inserts a value the
 * language core reads clean — checked by resolving the snippet the way
 * Monaco would and handing the result to the same `setKind` and tokenizer
 * the editor uses on the buffer.
 */

import { describe, expect, it } from "vitest"

import { tokenize } from "@shared/lang"
import { scalarValue, setKind } from "@shared/profile"

import { resolvedInsert, setTemplates } from "./set-templates"

/** The `set:` value FS Copilot would see after the template is accepted. */
function valueOf(insert: string): string {
  if (!insert.startsWith(">")) return scalarValue(insert)

  // A folded block scalar: the body, joined the way YAML folds it.
  return insert
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .join(" ")
}

describe("set: templates", () => {
  const templates = setTemplates("PITOT_HEAT_TOGGLE")

  it("offers every shape the corpus writes, prepended first", () => {
    expect(templates.length).toBeGreaterThanOrEqual(14)
    expect(templates[0]!.kind).toBe("prepended")
    expect(templates.map((t) => t.kind)).toContain("literal")
  })

  it.each(templates.map((t) => [t.label, t] as const))(
    "%s is the kind its label claims",
    (_label, template) => {
      const value = valueOf(resolvedInsert(template))
      expect(setKind(value)).toBe(template.kind)
    }
  )

  it.each(templates.map((t) => [t.label, t] as const))(
    "%s inserts nothing unterminated",
    (_label, template) => {
      const value = valueOf(resolvedInsert(template))
      const unterminated = tokenize(value).filter((t) => t.unterminated)
      expect(unterminated).toEqual([])
    }
  )

  it("puts the entry's event into the first placeholder", () => {
    expect(resolvedInsert(templates[0]!)).toBe("(>K:PITOT_HEAT_TOGGLE)")
  })

  it("resolves the JavaScript template to what the corpus writes", () => {
    const expression = templates.find((t) => t.label.endsWith("  expression"))!
    expect(resolvedInsert(expression)).toBe(
      '"`${value} (>K:PITOT_HEAT_TOGGLE)`"'
    )
  })

  it("escapes snippet metacharacters in the event name", () => {
    const [first] = setTemplates("WEIRD}$NAME")
    expect(resolvedInsert(first!)).toBe("(>K:WEIRD}$NAME)")
  })
})

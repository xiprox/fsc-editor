/**
 * SimConnect unit names.
 *
 * SimConnect matches units case-insensitively, so the spelling here is a
 * convention rather than a requirement. The convention follows FS Copilot
 * itself, which writes `Number` as the default unit when an entry omits one,
 * and the installed corpus agrees by a wide margin — `Number` outnumbers
 * `number` 3543 to 701, `Bool` outnumbers `bool` 2789 to 88.
 */

export const UNITS: readonly string[] = [
  // Dimensionless
  "Number",
  "Bool",
  "Enum",
  "Flags",
  "Mask",
  "String",
  "Percent",
  "Percent over 100",
  "Percent scaler 16k",
  // Axis positions
  "Position",
  "Position 16k",
  "Position 32k",
  "Position 128k",
  // Angles
  "Degrees",
  "Radians",
  "Degrees per second",
  // Distance
  "Feet",
  "Inches",
  "Meters",
  "Kilometers",
  "Nautical miles",
  // Speed
  "Knots",
  "Feet per minute",
  "Feet per second",
  "Meters per second",
  "Mach",
  // Mass and volume
  "Pounds",
  "Kilograms",
  "Slugs",
  "Gallons",
  "Liters",
  "Pounds per hour",
  "Gallons per hour",
  // Pressure
  "Millibars",
  "inHg",
  "PSI",
  "Pascals",
  // Temperature
  "Celsius",
  "Fahrenheit",
  "Kelvin",
  "Rankine",
  // Time
  "Seconds",
  "Minutes",
  "Hours",
  // Electrical
  "Volts",
  "Amperes",
  "Ohms",
  // Frequency and encoded values
  "Hz",
  "KHz",
  "MHz",
  "BCO16",
  "Frequency BCD16",
  "Frequency BCD32",
  "Frequency ADF BCD32",
  // Engine
  "RPM",
  "GForce",
]

const BY_LOWERCASE = new Map(UNITS.map((unit) => [unit.toLowerCase(), unit]))

/**
 * Spellings that mean the same unit but are not merely mis-cased. Rewriting
 * one of these changes the string SimConnect receives, so it is offered as a
 * suggestion and never applied automatically.
 *
 * That caution is about the *rewrite*, not about the alias: two of these were
 * checked against the sim on 2026-08-29 and SimConnect resolves them itself.
 * `(A:KOHLSMAN SETTING MB:1, Millibar)` and `…, Millibars` both returned 1005;
 * `(A:PLANE ALTITUDE, ft)` and `…, Feet` both returned 113.232674. So the
 * eight corpus lines spelled this way are correct, not broken — which is why
 * there is no diagnostic for them. The other eight aliases are untested.
 */
const ALIASES: Record<string, string> = {
  boolean: "Bool",
  percentage: "Percent",
  millibar: "Millibars",
  ft: "Feet",
  "ft/min": "Feet per minute",
  fpm: "Feet per minute",
  kts: "Knots",
  lbs: "Pounds",
  deg: "Degrees",
  sec: "Seconds",
}

/**
 * Canonical casing for a known unit, or null. Only ever differs by case, so
 * applying it cannot change which unit SimConnect resolves — that is what
 * makes it safe for the formatter to apply on save.
 */
export function canonicalCasing(raw: string): string | null {
  const canonical = BY_LOWERCASE.get(raw.trim().toLowerCase())
  return canonical && canonical !== raw.trim() ? canonical : null
}

/** Canonical unit including alias rewrites. For suggestions, not for saving. */
export function canonicalUnit(raw: string): string | null {
  const key = raw.trim().toLowerCase()
  return BY_LOWERCASE.get(key) ?? ALIASES[key] ?? null
}

export function isKnownUnit(raw: string): boolean {
  return BY_LOWERCASE.has(raw.trim().toLowerCase())
}

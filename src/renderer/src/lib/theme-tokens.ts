/**
 * Reading the resolved shadcn palette out of the document.
 *
 * Two things in this app are painted by something that has never heard of a CSS
 * variable — Monaco, which has its own theming system, and the Windows caption
 * buttons, which are drawn by the OS from colors handed to it over IPC. Both
 * would otherwise need a second copy of the palette, maintained by hand and
 * wrong one tweak later. Instead they ask for the tokens the rest of the app is
 * already using.
 */

const SENTINEL = "#010203"

const parser = (() => {
  const canvas = document.createElement("canvas")
  canvas.width = 1
  canvas.height = 1
  return canvas.getContext("2d", { willReadFrequently: true })
})()

const hex = (n: number) =>
  Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, "0")

/**
 * The tokens are `oklch(...)`, which neither consumer can parse.
 *
 * The color is converted by painting one pixel and reading it back, rather
 * than by reading `fillStyle` — Chromium serializes a color function straight
 * back out as `oklch(...)`, so the round trip through the property converts
 * nothing. Rasterizing gives real sRGB bytes for any color the browser
 * understands, and clamps out-of-gamut values, which is what they need anyway.
 */
function cssColorToHex(value: string, fallback: string): string {
  if (!parser || !value) return fallback

  try {
    // An unparseable color leaves the previous value in place.
    parser.fillStyle = SENTINEL
    parser.fillStyle = value
    if (
      (parser.fillStyle as string).toLowerCase() === SENTINEL &&
      value.trim().toLowerCase() !== SENTINEL
    )
      return fallback

    parser.clearRect(0, 0, 1, 1)
    parser.fillRect(0, 0, 1, 1)

    const [r, g, b, a] = parser.getImageData(0, 0, 1, 1).data
    const base = `#${hex(r)}${hex(g)}${hex(b)}`

    return a >= 255 ? base : `${base}${hex(a)}`
  } catch {
    return fallback
  }
}

/** One palette token, resolved against the current theme, as sRGB hex. */
export function token(name: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim()

  return cssColorToHex(raw, fallback)
}

export function isDarkMode(): boolean {
  return document.documentElement.classList.contains("dark")
}

/**
 * Fires whenever the app switches between light and dark.
 *
 * Watching the class rather than the stored preference, because the preference
 * can sit on "system" for a whole session and still change what is on screen
 * when the OS flips at sunset. The class is the one thing every route to a
 * theme change ends at.
 */
export function onThemeChange(listener: () => void): () => void {
  const observer = new MutationObserver(listener)

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  })

  return () => observer.disconnect()
}

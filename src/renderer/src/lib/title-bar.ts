import { onThemeChange, token } from "@/lib/theme-tokens"

/**
 * The app's header strip is the window's title bar, and Windows draws the
 * caption buttons into its trailing end. This is the two things the renderer
 * owes that arrangement: leaving room for the buttons, and keeping them the
 * same color as the strip they sit in.
 */

/**
 * The gap to leave at the trailing edge of a header so its content does not run
 * under the caption buttons.
 *
 * Windows reports the strip it left us as `titlebar-area-width`, which is the
 * window width less the buttons — and less whatever *their* width happens to be
 * on this machine, which is why this is measured rather than hardcoded. The
 * fallback covers the moment before the overlay exists, and any platform that
 * has no overlay at all, where the full width is ours.
 */
export const CAPTION_INSET =
  "calc(100vw - env(titlebar-area-width, 100vw) - env(titlebar-area-x, 0px))"

function syncTitleBar(): void {
  void window.api.setTitleBarColors({
    color: token("--background", "#101418"),
    symbolColor: token("--muted-foreground", "#a0a8b0"),
  })
}

/**
 * Repaints the caption buttons now and on every theme change.
 *
 * Without this the buttons keep whatever palette they were created with, so
 * switching to light leaves a dark rectangle sitting in the corner of an
 * otherwise white header — the one part of the window the stylesheet cannot
 * reach.
 */
export function watchTitleBar(): () => void {
  syncTitleBar()
  return onThemeChange(syncTitleBar)
}

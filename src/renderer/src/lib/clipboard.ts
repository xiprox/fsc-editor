/**
 * Puts text on the clipboard from a context menu item.
 *
 * Silent on success, and silent on failure too. There is nowhere on a context
 * menu for a confirmation to live once the menu has gone, and a status bar
 * saying "copied" would be reporting a thing the user is about to find out by
 * pasting.
 *
 * Not for a button that stays on screen — the invite code in Remote Connect
 * has somewhere to say it worked, and says so.
 */
export async function copy(text: string): Promise<void> {
  await navigator.clipboard.writeText(text).catch(() => undefined)
}

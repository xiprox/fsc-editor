import { useRef, useState } from "react"

/**
 * `bottom` measures upward from the window's bottom edge, with the footer
 * counted in the distance — exactly as the rail is counted for `right`.
 *
 * That constant is measured at pointer-down and subtracted, rather than assumed
 * away. It was assumed away, and the assumption was wrong in the one place it
 * shows: the first move of a drag snapped the panel to the pointer's distance,
 * which is the panel's size *plus* whatever sits beyond it.
 */
export type PanelSide = "left" | "right" | "bottom"

interface PanelWidthOptions {
  side: PanelSide
  min: number
  max: number
  initial: number
  /**
   * The element the width is measured *inside*, for a split that is not against
   * a window edge.
   *
   * Without it `left` means "distance from the left of the window", which is
   * right for a sidebar and wrong for a divider within a panel: the divider
   * sits after whatever else is open to its left, and dragging it would jump by
   * however wide that happened to be.
   *
   * `bottom` needs no equivalent. It measures upward from the window's bottom
   * edge, and whatever sits in between is absorbed by `offset` at pointer-down
   * — which is why Radar's inner split, once it became a height, could drop
   * this.
   */
  within?: React.RefObject<HTMLElement | null>
}

export interface PanelWidth {
  /** Width for `left`/`right`, height for `bottom`. */
  width: number
  handlers: {
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void
    onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => void
  }
}

/**
 * A dragged panel width, remembered across sessions.
 *
 * The pointer's distance is measured from the panel's own edge rather than from
 * the left of the window, because a panel anchored to the right grows as the
 * pointer travels the other way.
 *
 * The live width is held in a ref as well as in state: the value written back to
 * storage is read at pointer-up, and a ref cannot be a render behind.
 */
export function usePanelWidth(
  key: string,
  { side, min, max, initial, within }: PanelWidthOptions
): PanelWidth {
  const [width, setWidth] = useState(() => {
    const stored = Number(localStorage.getItem(key))
    return Number.isFinite(stored) && stored >= min && stored <= max
      ? stored
      : initial
  })

  const dragging = useRef(false)
  const live = useRef(width)

  /**
   * The gap between what the pointer measures and what the panel actually is.
   *
   * `bottom` measures upward from the window's bottom edge, and the footer sits
   * below the panel inside that distance; `left` measures from a container that
   * may itself be offset. Either way the pointer's distance is the panel's size
   * plus some constant, and treating them as equal made the panel **jump by
   * that constant on the first move of every drag** — the size snapped to the
   * distance, which is a different number.
   *
   * Measuring it once at pointer-down rather than deriving it means no side
   * has to know what is beneath it, and a layout change cannot silently make
   * the arithmetic wrong again.
   */
  const offset = useRef(0)

  const distanceFrom = (event: React.PointerEvent<HTMLDivElement>): number => {
    const origin = within?.current?.getBoundingClientRect().left ?? 0

    return side === "left"
      ? event.clientX - origin
      : side === "right"
        ? window.innerWidth - event.clientX
        : window.innerHeight - event.clientY
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true
    offset.current = distanceFrom(event) - live.current
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return

    const next = Math.min(max, Math.max(min, distanceFrom(event) - offset.current))
    live.current = next
    setWidth(next)
  }

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false
    event.currentTarget.releasePointerCapture(event.pointerId)
    localStorage.setItem(key, String(live.current))
  }

  return { width, handlers: { onPointerDown, onPointerMove, onPointerUp } }
}

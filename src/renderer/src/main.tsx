import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { useStore } from "@/store"

// Dev-only handle, so the renderer can be driven from the console or from a
// plain browser tab pointed at the Vite server.
if (import.meta.env.DEV) {
  ;(window as unknown as { store: typeof useStore }).store = useStore
}

/**
 * The renderer's own crashes, into main's ring.
 *
 * Main installs the equivalent for its process and cannot see this side of the
 * bridge. Registered here rather than in a component because the errors worth
 * catching include the ones thrown before React has mounted anything — a bad
 * import, a stylesheet that took the module graph down — and a handler inside
 * the tree is not there yet when those happen.
 *
 * `console.error` is deliberately not wrapped the way main's is: React routes
 * every caught render error through it, so mirroring it would fill the ring
 * with the second copy of an error the boundary already reported.
 */
window.addEventListener("error", (event) => {
  void window.api?.log("error", "uncaught", event.message, {
    source: event.filename,
    line: event.lineno,
    column: event.colno,
    stack: event.error instanceof Error ? event.error.stack : undefined,
  })
})

window.addEventListener("unhandledrejection", (event) => {
  const reason: unknown = event.reason
  void window.api?.log(
    "error",
    "unhandled-rejection",
    reason instanceof Error ? reason.message : String(reason),
    { stack: reason instanceof Error ? reason.stack : undefined }
  )
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Dark by default — the app is an IDE and ships tuned for it. "system"
        and "light" are real choices in Settings → Appearance, not fallbacks. */}
    <ThemeProvider defaultTheme="dark">
        <App />
    </ThemeProvider>
  </StrictMode>
)

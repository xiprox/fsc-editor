import { fileURLToPath } from "node:url"

import { configDefaults, defineConfig } from "vitest/config"

const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url))

/**
 * The same aliases the three electron-vite builds use. Without them a test can
 * only reach modules that import relatively, which quietly makes "is this
 * testable" a question about import style rather than about the code.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": dir("src/renderer/src"),
      "@shared": dir("src/shared"),
    },
  },
  test: {
    /*
     * A git worktree is a whole second copy of the tree, so without this the
     * suite runs once per worktree — 117 files instead of 46 with two open,
     * every test executed three times, and a failure reported against a path
     * nobody is editing.
     */
    exclude: [...configDefaults.exclude, "**/.claude/worktrees/**"],
  },
})

import { fileURLToPath } from "node:url"

import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, externalizeDepsPlugin } from "electron-vite"

const dir = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  main: {
    // `yazl` is bundled rather than externalized. Everything in `dependencies`
    // is external by default, and an external module has to be listed in
    // electron-builder's `files` to exist in a packaged build — a step that
    // fails silently in a checkout, where Node resolution walks up out of
    // `dist/` and finds the repo's own `node_modules`. It is pure JS with no
    // path-sensitive assets, so bundling it removes the question entirely.
    // node-simconnect stays external for the reason `electron-builder.yml`
    // gives: `regedit` shells out to real `.vbs` files it locates by path.
    //
    // `electron-updater` is bundled for the same reason as `yazl`, and more
    // so: externalizing it would mean adding its whole transitive closure —
    // builder-util-runtime, fs-extra, js-yaml, semver and the rest — to
    // electron-builder's `files` allowlist, and keeping that list right
    // forever. It reads `app-update.yml` by path at runtime rather than
    // importing it, so bundling takes nothing away. See
    // docs/pipeline/06-updater.md.
    plugins: [externalizeDepsPlugin({ exclude: ["yazl", "electron-updater"] })],
    resolve: {
      alias: { "@shared": dir("src/shared") },
    },
    build: {
      rollupOptions: { input: { index: dir("src/main/index.ts") } },
    },
  },

  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { "@shared": dir("src/shared") },
    },
    build: {
      rollupOptions: {
        input: { index: dir("src/preload/index.ts") },
        // CommonJS preload so the renderer can keep sandbox: true.
        // An ESM preload would force sandbox: false in Electron.
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },

  renderer: {
    root: dir("src/renderer"),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        // Vite cannot append ?worker to a subpath that goes through a package
        // exports map. Resolving it to the file directly is what lets
        // monaco-setup.ts import these two with `?worker` at all.
        //
        // This also used to reconcile monaco-worker-manager, which imported
        // the same specifier without a query. That dependency left with
        // monaco-yaml; the aliases stay because our own imports need them.
        "monaco-editor/esm/vs/editor/editor.worker.js": dir(
          "node_modules/monaco-editor/esm/vs/editor/editor.worker.js"
        ),
        "monaco-editor/esm/vs/language/typescript/ts.worker.js": dir(
          "node_modules/monaco-editor/esm/vs/language/typescript/ts.worker.js"
        ),
        "@": dir("src/renderer/src"),
        "@shared": dir("src/shared"),
      },
    },
    build: {
      rollupOptions: { input: { index: dir("src/renderer/index.html") } },
    },
    worker: {
      format: "es",
    },
  },
})

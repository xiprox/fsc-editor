import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Build output, both kinds. `dist` is electron-builder's; `out` is
  // electron-vite's, and it was missing — bundled renderer chunks made up 115
  // of the 117 problems `npm run lint` reported, which buried the two real
  // ones.
  // `.claude/worktrees` holds whole checkouts of this repo, tsconfigs and all,
  // which typescript-eslint reads as a second candidate root and then refuses
  // to parse anything at all — every file in the project, one parsing error
  // each. Not lint output about a worktree, but no lint output about anything.
  globalIgnores(['dist', 'out', '.claude']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // shadcn components are generated, and every one of them exports its
    // `cva` variants beside the component — which is exactly what the
    // fast-refresh rule objects to. Adding a component should not add a lint
    // error, and hand-editing generated files to satisfy a rule they will
    // regenerate against is worse than scoping the rule.
    files: ['src/renderer/src/components/ui/**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])

import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      // The onboarding dialog tests import the virtual specifier
      // `@htscai-onboarding-src/client`; map it to the real source so the
      // tests run against the actual component (its ambient `.d.ts` keeps
      // tsc from typechecking the cross-package source).
      '@htscai-onboarding-src/client': fileURLToPath(
        new URL('../packages/htscai-onboarding/src/client/index.tsx', import.meta.url),
      ),
      // Redirect the upstream Modal/Button/Input bundle to a lightweight stub
      // for the React component tests. The onboarding logic under test does
      // not depend on the real chrome, and the upstream bundle pulls a bare
      // `katex.min.css` side-effect import that vitest cannot load.
      '@deepseek-ai/dsh-client-ui-primitives': fileURLToPath(
        new URL('./tests/fixtures/ui-primitives-stub.tsx', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    // React component tests render into a real DOM; the per-file
    // `// @vitest-environment happy-dom` pragma opts them into happy-dom
    // while every node-side .spec.ts keeps the default node environment.
  },
})

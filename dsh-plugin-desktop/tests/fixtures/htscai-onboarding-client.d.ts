/**
 * Opaque type surface for the onboarding dialog's client entry.
 *
 * The React component tests import this virtual specifier (`@htscai-onboarding-
 * src/client`); vitest's `resolve.alias` maps it to the real source at runtime
 * (see vitest.config.ts). Declaring it ambient here keeps the desktop tsconfig
 * from following the import into the onboarding package's source, which lives
 * outside this package's `rootDir` and typechecks under its own (lenient)
 * tsconfig — cross-package strict typechecking would otherwise mint spurious
 * errors (rootDir, duplicate `@types/react`, the upstream `katex.min.css`
 * side-effect `.d.ts`, strict-mode false positives).
 *
 * Only the surface the tests actually use is declared.
 */
declare module '@htscai-onboarding-src/client' {
  export function apply(ctx: unknown): void
}

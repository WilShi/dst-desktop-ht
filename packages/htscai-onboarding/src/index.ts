/**
 * HTSC AI onboarding plugin, Host half. The feature is entirely client-side
 * (first-run dialog); this entry exists so the Cordis Loader can compose the
 * package and the client registry can serve its browser bundle.
 * @module dsh-htscai-onboarding
 */

/** Stable Cordis plugin name. */
export const name = 'htscai-onboarding'

/** No Host services required: the client half talks to existing remotes. */
export function apply(): void {}

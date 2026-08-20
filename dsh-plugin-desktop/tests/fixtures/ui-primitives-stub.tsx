/**
 * Lightweight stand-in for `@deepseek-ai/dsh-client-ui-primitives` used only by
 * the onboarding dialog's component tests.
 *
 * The onboarding dialog's probe/phase logic under test does not depend on the
 * upstream Modal chrome (which portals to `document.body` and pulls a heavy
 * shiki/markdown/katex bundle plus a bare `katex.min.css` side-effect import
 * that vitest cannot load). These stubs keep the same prop surfaces so the
 * dialog renders, while staying out of the upstream bundle entirely.
 */
import { createElement } from 'react'

/**
 * Records the props passed to every `<Modal>` render, so tests can assert on
 * the dialog's chrome (native vs headless) and its dismiss handler. Cleared
 * between tests by the spec's afterEach.
 */
export const modalPropsLog: Array<Record<string, unknown>> = []

// Props are intentionally `any`: this stub mirrors an untyped chrome boundary
// and only needs to render without exercising the upstream component logic.
export const Modal = (props: any) => {
  modalPropsLog.push(props)
  return createElement('div', null, props.children)
}
export const Button = (props: any) =>
  createElement('button', { ...props, type: 'button' }, props.children)
export const Input = (props: any) => createElement('input', props)

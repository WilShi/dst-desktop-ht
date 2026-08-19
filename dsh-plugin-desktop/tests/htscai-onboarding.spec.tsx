// @vitest-environment happy-dom
/**
 * Regression tests for the HTSC AI first-run onboarding dialog.
 *
 * Two field-reported bugs share one root cause: `check` was declared with
 * `complete` in its deps, and `complete` is an unstable prop the upstream
 * onboarding coordinator (`SettingsRoot`) re-mints on every render. Each
 * coordinator re-render (the boot-time blank-session selection is one
 * essentially-guaranteed re-render) therefore recreated `check` and re-fired
 * the probe effect mid-flow:
 *   - every re-fire began with `setPhase('loading')`, which returns `null`,
 *     so the modal unmounted/remounted -> the "flashes every few seconds"
 *     flicker that disabling the mask's backdrop-filter did not address.
 *   - a re-fire that landed while the host composition was still transient
 *     hit `if (!declared) { complete() }` and permanently dismissed the step
 *     -> the "dialog vanished before I clicked anything" auto-dismiss.
 *
 * These tests render the real component the same way the slot registry does
 * (drive `apply()` with a stub context, capture the registered component) and
 * pin the two fixes: the probe must not re-fire on a fresh `complete`, and a
 * failed probe must park on the retryable error card instead of completing.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { apply } from '@htscai-onboarding-src/client'

// The upstream Modal/Button/Input chrome is redirected to a lightweight stub
// via vitest `resolve.alias` (see vitest.config.ts): the onboarding logic
// under test does not depend on it, and the stub keeps the upstream bundle
// (and its bare `katex.min.css` import) out of the test graph entirely.

/** Provider-list probe outcome handed to `api.llm.providers`. */
type ProvidersResult = { ok: true; value: { providers: { provider: string }[] } } | { ok: false; error: { message: string } }

/** A wire face stub: only the calls the dialog reaches during probe/input. */
function makeWireApi(providersResult: ProvidersResult) {
  return {
    llm: {
      providers: vi.fn(async () => ({ result: providersResult })),
      models: vi.fn(async () => ({ result: { ok: true, value: { groups: [] } } })),
      discoverModels: vi.fn(async () => ({ result: { ok: true, value: { models: [] } } })),
    },
    credentials: {
      describe: vi.fn(async () => ({
        result: { ok: true, value: { credentials: { HTSCAI_API_KEY: { configured: false } } } },
      })),
      set: vi.fn(async () => ({ result: { ok: true } })),
    },
    settings: { mutate: vi.fn(async () => ({ result: { ok: true } })) },
  }
}

/**
 * Drive the real `apply()` with a stub context that captures the dialog
 * component exactly as the slot registry would receive it. Returns the
 * component reference plus the `api` it will be injected with.
 */
function captureDialog(providersResult: ProvidersResult): { Comp: any; api: ReturnType<typeof makeWireApi> } {
  const api = makeWireApi(providersResult)
  let Comp: any
  const ctx = {
    get: (key: string) => (key === 'connection' ? { api } : undefined),
    slots: {
      inject: (_name: string, factory: () => any) => void factory(),
      register: (meta: { name: string }, component: any) => {
        if (meta.name === 'settings.onboarding') Comp = component
        return meta
      },
    },
    on: () => () => {},
  } as any
  apply(ctx)
  return { Comp, api }
}

const noopOnReset = () => () => {}

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('HTSC AI onboarding dialog — probe stability', () => {
  it('does not re-probe when the coordinator re-renders with a fresh complete closure', async () => {
    // Route declared, key not yet configured -> the dialog parks on input.
    const { Comp, api } = captureDialog({ ok: true, value: { providers: [{ provider: 'htscai' }] } })
    const complete = vi.fn()

    const { rerender } = render(createElement(Comp, { complete, api, onReset: noopOnReset }))

    await waitFor(() => expect(api.llm.providers).toHaveBeenCalledOnce())
    const afterBoot = api.llm.providers.mock.calls.length

    // The coordinator mints a brand-new `complete` on every render; this is the
    // re-render trigger, not a user gesture. The probe must NOT re-fire.
    await act(async () => {
      rerender(createElement(Comp, { complete: vi.fn(), api, onReset: noopOnReset }))
    })
    await new Promise((r) => setTimeout(r, 30))

    expect(api.llm.providers.mock.calls.length).toBe(afterBoot)
    expect(complete).not.toHaveBeenCalled()
  })

  it('never completes when the provider probe transiently fails', async () => {
    // Host composition not yet ready -> providers returns ok:false. The dialog
    // must park on the retryable error card; it must NOT call complete().
    const { Comp, api } = captureDialog({ ok: false, error: { message: 'host still booting' } })
    const complete = vi.fn()

    render(createElement(Comp, { complete, api, onReset: noopOnReset }))

    await waitFor(() => expect(api.llm.providers).toHaveBeenCalledOnce())
    await new Promise((r) => setTimeout(r, 10))

    expect(complete).not.toHaveBeenCalled()
  })

  it('completes when the htscai route is genuinely absent from the composition', async () => {
    // A successful probe that simply does not list the htscai route is the only
    // legitimate reason to auto-skip the step.
    const { Comp, api } = captureDialog({ ok: true, value: { providers: [{ provider: 'something-else' }] } })
    const complete = vi.fn()

    render(createElement(Comp, { complete, api, onReset: noopOnReset }))

    await waitFor(() => expect(complete).toHaveBeenCalled())
    expect(api.credentials.describe).not.toHaveBeenCalled()
  })
})

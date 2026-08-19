/**
 * HTSC AI first-run onboarding, browser half. Registers one
 * 'settings.onboarding' step: collects the company gateway key (stored
 * write-only as HTSCAI_API_KEY), discovers the models that key may serve,
 * attaches the selected models to the htscai route, and seeds the default
 * model selection. Skips itself when the route is absent from the composition
 * or the key is already configured. Chrome comes from ui-primitives (Modal
 * portals to document.body, so the inert root never traps our own inputs)
 * and every color follows the active theme tokens.
 */
import { useCallback, useEffect, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'

/** Settings namespace the pi-ai adapter reads provider profiles from. */
const PI_AI_NS = 'llm-pi-ai'
/** Credential reference the htscai route resolves per request. */
const CREDENTIAL_REF = 'HTSCAI_API_KEY'
/** The pre-declared company gateway route. */
const PROVIDER = 'htscai'
/**
 * Company gateway endpoint, mirrored from the desktop patch's llm-pi-ai row.
 * Discovery passes it explicitly: the wire interrogates the draft endpoint
 * directly rather than resolving the composed profile.
 */
const GATEWAY_BASE_URL = 'http://127.0.0.1:8091/llm-service/v1'  // SCREENSHOT-BUILD ONLY: revert before packaging
/** Wire protocol every model on the gateway speaks. */
const GATEWAY_API = 'openai-completions'
/** Settings namespace of the default Agent model selection. */
const DEFAULT_MODEL_NS = 'agent-default-model'
/** Where colleagues request a gateway key or model permissions. */
const APPLY_URL = 'http://eip.htsc.com.cn/modelPlatform/#/apiManage/list'

/** Wire face this dialog needs. */
interface HtscaiOnboardingInjected {
  api: Pick<IApiClient, 'credentials' | 'llm' | 'settings'>
  /** Subscribe to connection resets; returns the disposer. */
  onReset: (listener: () => void) => () => void
}

type HtscaiOnboardingProps = PropsRuntime<'settings.onboarding'> & InjectFace<HtscaiOnboardingInjected>

interface DiscoveredModel {
  id: string
  name?: string
  contextWindow?: number
  maxTokens?: number
}

type Phase = 'loading' | 'input' | 'busy' | 'models' | 'error'

const secondaryTextStyle = { margin: '0 0 4px', opacity: 0.68 } as const
const hintTextStyle = { margin: '10px 0 6px', fontSize: 13, opacity: 0.68 } as const
const addressRowStyle = { display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 12px' } as const
const addressStyle = {
  flex: 1, fontSize: 12, padding: '6px 8px', borderRadius: 6,
  background: 'var(--dsw-alias-bg-layer-2)', border: '1px solid var(--dsw-alias-border-l1)',
  wordBreak: 'break-all', userSelect: 'text', opacity: 0.85,
} as const
const errorTextStyle = { color: 'var(--dsw-alias-state-error-primary)', margin: '10px 0 0' } as const
const actionRowStyle = { display: 'flex', alignItems: 'center', marginTop: 18, gap: 8 } as const

/**
 * The one HTSC AI onboarding step.
 * @param props - onboarding coordinator owner props plus the injected wire face.
 * @returns the modal card, or null while readiness loads / when not needed.
 */
function HtscaiOnboardingDialog(props: HtscaiOnboardingProps) {
  const { complete, api, onReset } = props
  const [phase, setPhase] = useState<Phase>('loading')
  const [secret, setSecret] = useState('')
  const [busyNote, setBusyNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [models, setModels] = useState<DiscoveredModel[]>([])
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState(false)

  // Readiness probe: only a confirmed-absent route or an already-configured
  // key may auto-skip. Failures park the dialog on a retryable error card —
  // it never vanishes on its own (a dropped connection mid-boot must not
  // swallow the step).
  const check = useCallback(async (): Promise<void> => {
    setPhase('loading')
    try {
      const providers = await api.llm.providers({})
      const declared = providers.result.ok
        && providers.result.value.providers.some(p => p.provider === PROVIDER)
      if (!declared) { complete(); return }
      const creds = await api.credentials.describe({ refs: [CREDENTIAL_REF] })
      const configured = creds.result.ok
        && creds.result.value.credentials[CREDENTIAL_REF]?.configured === true
      if (configured) { complete(); return }
      setPhase('input')
    } catch {
      setPhase('error')
    }
  }, [api, complete])

  useEffect(() => { void check() }, [check])

  // Re-probe after a connection reset, but never clobber a phase the user
  // is actively working in (typing a key, picking models).
  useEffect(() => {
    if (phase !== 'loading' && phase !== 'error') return
    return onReset(() => { void check() })
  }, [phase, onReset, check])

  // Keep the app root inert while the (body-portaled) modal owns interaction.
  // Also drop the modal mask's backdrop-filter while we are open: a full-window
  // backdrop blur re-composites on every repaint, which flickers on older
  // Windows GPUs (field report: whole window flashing every few seconds).
  useEffect(() => {
    if (phase === 'loading') return
    const appRoot = document.getElementById('root')
    if (appRoot === null) return
    const previous = appRoot.inert
    appRoot.inert = true
    document.body.setAttribute('data-htscai-onboarding', '')
    const style = document.createElement('style')
    style.textContent = 'body[data-htscai-onboarding] > div:has(> [role="dialog"]) > :first-child {'
      + ' backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }'
    document.head.appendChild(style)
    return () => {
      appRoot.inert = previous
      document.body.removeAttribute('data-htscai-onboarding')
      style.remove()
    }
  }, [phase])

  const copyAddress = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(APPLY_URL)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  const saveAndDiscover = async (): Promise<void> => {
    setError(null)
    setPhase('busy')
    setBusyNote('正在验证密钥并查询可用模型…')
    // Interrogate the gateway with the typed key BEFORE persisting anything:
    // a rejected key never reaches the credential store.
    const found = await api.llm.discoverModels({
      settingsNs: PI_AI_NS,
      provider: PROVIDER,
      baseURL: GATEWAY_BASE_URL,
      api: GATEWAY_API,
      apiKey: secret.trim(),
    })
    if (!found.result.ok) {
      setPhase('input')
      setError('查询失败：' + found.result.error.message + '。请确认密钥正确且当前在公司内网。')
      return
    }
    setBusyNote('正在保存密钥…')
    const stored = await api.credentials.set({ ref: CREDENTIAL_REF, value: secret.trim() })
    if (!stored.result.ok) {
      setPhase('input')
      setError('密钥保存失败：' + stored.result.error.message)
      return
    }
    const list = found.result.value.models
    if (list.length === 0) {
      setPhase('input')
      setError('该密钥下没有可用模型（可点上方链接申请模型权限）。密钥已保存，可稍后在「设置 → 模型」里配置。')
      return
    }
    setModels(list)
    setChecked(Object.fromEntries(list.map(m => [m.id, true])))
    setPhase('models')
  }

  const attachModels = async (): Promise<void> => {
    const chosen = models.filter(m => checked[m.id])
    setError(null)
    setPhase('busy')
    setBusyNote('正在写入模型配置…')
    const write = await api.settings.mutate({
      ns: PI_AI_NS,
      ops: [{
        op: 'set',
        path: ['providers', PROVIDER, 'models'],
        value: chosen.map(m => ({
          id: m.id,
          ...m.contextWindow !== undefined ? { contextWindow: m.contextWindow } : {},
          ...m.maxTokens !== undefined ? { maxTokens: m.maxTokens } : {},
        })),
      }],
    })
    if (!write.result.ok) {
      setPhase('models')
      setError('模型配置写入失败：' + write.result.error.message + '。可稍后在「设置 → 模型」里手动添加。')
      return
    }
    if (chosen.length > 0) {
      await api.settings.mutate({
        ns: DEFAULT_MODEL_NS,
        ops: [
          { op: 'set', path: ['provider'], value: PROVIDER },
          { op: 'set', path: ['model'], value: chosen[0].id },
        ],
      }).catch(() => undefined)
    }
    complete()
  }

  if (phase === 'loading') return null

  return (
    <Modal open title="配置 HTSC AI 密钥" onClose={() => complete()}>
      {phase === 'error' ? (
        <>
          <p style={secondaryTextStyle}>
            状态查询失败——应用可能还在启动中，或连接暂时中断。重试不会丢失任何内容。
          </p>
          <div style={actionRowStyle}>
            <Button variant="primary" onClick={() => void check()}>重试</Button>
            <Button onClick={() => complete()}>稍后再说</Button>
          </div>
        </>
      ) : null}
      {phase === 'input' || phase === 'busy' ? (
        <>
          <p style={secondaryTextStyle}>
            请输入公司内部 HTSC AI 网关的密钥。密钥只保存在本机凭证库，不会写入任何配置文件。
          </p>
          <p style={hintTextStyle}>没有密钥或需要申请模型权限？复制地址到浏览器申请：</p>
          <div style={addressRowStyle}>
            <code style={addressStyle}>{APPLY_URL}</code>
            <Button size="sm" onClick={() => void copyAddress()}>{copied ? '已复制 ✓' : '复制'}</Button>
          </div>
          <Input
            type="password"
            placeholder="HTSCAI_API_KEY"
            value={secret}
            autoFocus
            disabled={phase === 'busy'}
            onChange={event => setSecret(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && secret.trim() !== '' && phase !== 'busy') void saveAndDiscover()
            }}
          />
          {error !== null && <p style={errorTextStyle}>{error}</p>}
          <div style={actionRowStyle}>
            <Button
              variant="primary"
              disabled={phase === 'busy' || secret.trim() === ''}
              onClick={() => void saveAndDiscover()}
            >
              {phase === 'busy' ? busyNote : '保存并查询可用模型'}
            </Button>
            <Button disabled={phase === 'busy'} onClick={() => complete()}>
              稍后再说
            </Button>
          </div>
        </>
      ) : null}
      {phase === 'models' ? (
        <>
          <p style={{ ...secondaryTextStyle, margin: '0 0 10px' }}>
            查询到 {models.length} 个可用模型，勾选要加入配置的：
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
            {models.map(m => (
              <label key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={checked[m.id] === true}
                  onChange={event => setChecked(prev => ({ ...prev, [m.id]: event.target.checked }))}
                />
                <span>{m.name ?? m.id}</span>
                {m.name !== undefined && m.name !== m.id
                  ? <span style={{ opacity: 0.55, fontSize: 12 }}>{m.id}</span>
                  : null}
              </label>
            ))}
          </div>
          {error !== null && <p style={{ ...errorTextStyle, margin: '0 0 10px' }}>{error}</p>}
          <div style={{ ...actionRowStyle, marginTop: 0 }}>
            <Button
              variant="primary"
              disabled={!models.some(m => checked[m.id])}
              onClick={() => void attachModels()}
            >
              加入配置
            </Button>
            <Button onClick={() => complete()}>跳过</Button>
          </div>
        </>
      ) : null}
    </Modal>
  )
}

const creditWrapStyle = {
  marginTop: 24, paddingTop: 12,
  borderTop: '1px solid var(--dsw-alias-border-l1)',
  fontSize: 12, lineHeight: 1.8, opacity: 0.55,
} as const

/**
 * Attribution footer shown at the bottom of the General settings page.
 * @returns the two-line credit block.
 */
function HtscaiCredit() {
  return (
    <div style={creditWrapStyle}>
      <div>本项目为人工智能通用技术研发中心探索性项目</div>
      <div>欢迎技术交流，问题咨询：施文博（022296）</div>
    </div>
  )
}

/** Required services: the slot registry and the connection carrying the wire API. */
export const inject = ['slots', 'connection']

/**
 * Client plugin body: register the HTSC AI step into the onboarding
 * coordinator once the settings shell has declared the slot.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const connection = ctx.get('connection') as { api: HtscaiOnboardingInjected['api'] }
  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding',
    id: 'htscai-key',
    order: 0,
    inject: (): HtscaiOnboardingInjected => ({
      api: connection.api,
      onReset: listener => ctx.on('connection/reset', listener),
    }),
  }, HtscaiOnboardingDialog))
  // High order keeps the credit line last on the General settings page.
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'htscai-credit',
    order: 1000,
    inject: () => ({}),
  }, HtscaiCredit))
}

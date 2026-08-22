/**
 * Desktop model-probe host plugin.
 *
 * Registers a same-origin HTTP route on the loopback web server that the
 * onboarding dialog (and future Settings surfaces) can POST to. The handler
 * probes each discovered model on the company gateway for two capabilities the
 * discoverModels wire does not disclose:
 *
 *  - **Image input**: sends a minimal chat completion with a 1×1 PNG image_url.
 *    200 or a 400 that complains about image dimensions means the model
 *    accepts images (it was processed, just too small); a 400 that rejects
 *    image content means text-only.
 *
 *  - **Reasoning effort**: sends a minimal chat completion with
 *    `reasoning_effort` for each of six standard levels. 200 means the gateway
 *    accepts that level; 400 means it does not. The DSH-level "off" option
 *    (adapter omits the parameter) is always included and never probed.
 *
 * The renderer `fetch`es `/desktop/probe-models` (same-origin, no CORS) with
 * `{ baseURL, apiKey, models }` and receives a JSON array of per-model results.
 * All models and all probe dimensions are concurrent (Promise.all), so the
 * total latency is one round-trip, not models × levels.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'

export const name = 'desktop-model-probe'
export const inject = ['webServer', 'credentials']

const PROBE_PATH = '/desktop/probe-models'
const MAX_BODY_BYTES = 64 * 1024
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
const REASONING_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
const PROBE_TIMEOUT_MS = 15_000

interface ProbeModel {
  id: string
  name?: string
}

interface ProbeRequest {
  baseURL: string
  apiKey?: string
  apiKeyEnv?: string
  models: ProbeModel[]
}

export interface ProbeResult {
  modelId: string
  supportsImage: boolean
  reasoningEfforts: Record<string, string>
}

/** Read and validate the JSON POST body (max 64 KiB). */
async function readBody(req: IncomingMessage): Promise<ProbeRequest | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += bytes.byteLength
    if (size > MAX_BODY_BYTES) return undefined
    chunks.push(bytes)
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (typeof value?.baseURL !== 'string' || typeof value?.apiKey !== 'string' || !Array.isArray(value?.models)) {
      return undefined
    }
    return value as ProbeRequest
  } catch {
    return undefined
  }
}

/** Probe one model for image input support (1×1 PNG). */
async function probeImage(baseURL: string, apiKey: string, modelId: string): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    const resp = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: [
          { type: 'text', text: '.' },
          { type: 'image_url', image_url: { url: TINY_PNG } },
        ]}],
        max_tokens: 1,
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (resp.status === 200) return true
    if (resp.status === 400) {
      const text = await resp.text()
      // "too small" / "dimension" / "restrict" = the model DOES accept images (the image was processed, just too small)
      return /too small|dimension|restrict|larger than/i.test(text)
    }
    return false
  } catch {
    return false
  }
}

/** Probe one model for a single reasoning_effort level. */
async function probeReasoningLevel(baseURL: string, apiKey: string, modelId: string, level: string): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    const resp = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: '.' }],
        max_tokens: 1,
        reasoning_effort: level,
      }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    return resp.status === 200
  } catch {
    return false
  }
}

/** Probe one model for image + all reasoning levels (7 requests, all concurrent). */
async function probeModel(baseURL: string, apiKey: string, model: ProbeModel): Promise<ProbeResult> {
  const [supportsImage, ...reasoningResults] = await Promise.all([
    probeImage(baseURL, apiKey, model.id),
    ...REASONING_LEVELS.map(level => probeReasoningLevel(baseURL, apiKey, model.id, level)),
  ])
  const reasoningEfforts: Record<string, string> = { off: 'none' }
  for (const [i, level] of REASONING_LEVELS.entries()) {
    if (reasoningResults[i]) {
      reasoningEfforts[level] = level
    }
  }
  return { modelId: model.id, supportsImage, reasoningEfforts }
}

export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'exact' as const,
      path: PROBE_PATH,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
        const ct = req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
        if (ct !== 'application/json') { res.statusCode = 415; res.end(); return }
        const request = await readBody(req)
        if (request === undefined) { res.statusCode = 400; res.end(); return }
        // Resolve apiKey: direct (onboarding) or from credential store (Settings).
        let apiKey = request.apiKey
        if (apiKey === undefined && request.apiKeyEnv !== undefined) {
          const resolved = await ctx.credentials.resolve(credentialRef(request.apiKeyEnv))
          apiKey = resolved?.value
        }
        if (apiKey === undefined) { res.statusCode = 400; res.end(); return }
        // All models concurrent; each model's 7 probes are also concurrent.
        const results = await Promise.all(
          request.models.map(model => probeModel(request.baseURL, apiKey, model)),
        )
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(results))
      },
    }),
    'desktop-model-probe: probe route',
  )
}

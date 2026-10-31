import { usePersisted } from './store'

export type ModelKind = 'chat' | 'image' | 'video'

export interface ProviderModel {
  id: string
  name?: string
  kind: ModelKind
  declared?: boolean
}

export interface Provider {
  id: string
  label: string
  baseUrl: string
  apiKey: string
  /** 各类型当前选中的模型 */
  selected: Record<ModelKind, string>
  /** /v1/models 拉到的清单 */
  models: ProviderModel[]
  lastSync?: number
}

export interface ProviderConfig {
  providers: Provider[]
  activeId: string | null
}

export const DEFAULT_PROVIDER: Omit<Provider, 'id'> = {
  label: '本地网关',
  baseUrl: 'http://192.168.1.3:17990',
  apiKey: '',
  selected: { chat: '', image: '', video: '' },
  models: [],
}

export function useProviders() {
  return usePersisted<ProviderConfig>('wb.providers', {
    providers: [],
    activeId: null,
  })
}

export function activeProvider(cfg: ProviderConfig): Provider | null {
  if (!cfg.activeId) return null
  return cfg.providers.find(p => p.id === cfg.activeId) || null
}

/* ── 模型目录 ── */

interface RawModel {
  id?: string
  name?: string
  type?: string
  capabilities?: { output_modalities?: string[] }
}

/**
 * 解析 /v1/models。优先用服务端声明的 type / output_modalities，
 * 没有声明时按名字关键词兜底（doubao-seedream 不含 image 字样）。
 */
export function parseModels(json: unknown): ProviderModel[] {
  const list: RawModel[] = Array.isArray(json)
    ? (json as RawModel[])
    : Array.isArray((json as { data?: RawModel[] })?.data)
      ? (json as { data: RawModel[] }).data
      : []

  const out: ProviderModel[] = []
  const seen = new Set<string>()

  for (const m of list) {
    const id = String(m.id || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)

    const declaredOut = m.capabilities?.output_modalities || []
    const declaredType = String(m.type || '').toLowerCase()

    let kind: ModelKind = 'chat'
    let declared = false

    if (declaredOut.length) {
      declared = true
      if (declaredOut.indexOf('video') >= 0) kind = 'video'
      else if (declaredOut.indexOf('image') >= 0) kind = 'image'
      else kind = 'chat'
    } else if (declaredType === 'image' || declaredType === 'video') {
      declared = true
      kind = declaredType as ModelKind
    } else {
      const low = id.toLowerCase()
      if (/seedream|image|dall|flux|sdxl|stable-diffusion|imagen/.test(low)) kind = 'image'
      else if (/video|veo|kling|sora|wan2|t2v|i2v/.test(low)) kind = 'video'
    }

    out.push({ id, name: m.name, kind, declared })
  }

  return out
}

/* ── HTTP ──
   第三方网关的 POST 响应常缺 CORS 头，浏览器会直接拦成 "Failed to fetch"。
   因此优先走同源代理：原生外壳内置的 /proxy 或本机 mcp_server.py 的 /proxy。
   浏览器预览时若没有代理，则退回直连（需要网关正确返回 CORS）。 */

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + path
}

function headers(apiKey: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) h.Authorization = 'Bearer ' + apiKey
  return h
}

/** 同源代理前缀；空串表示直连。探测失败不缓存，下次重试。 */
let proxyBase = ''

export function resetProxy() {
  proxyBase = ''
}

export async function detectProxy(): Promise<string> {
  if (proxyBase) return proxyBase
  const candidates = [
    (typeof location !== 'undefined' ? location.origin : '') + '/proxy',
    'http://127.0.0.1:7801/proxy',
    'http://127.0.0.1:7802/proxy',
    'http://127.0.0.1:7803/proxy',
  ]
  for (const c of candidates) {
    if (!c.startsWith('http')) continue
    try {
      const r = await fetch(c, { method: 'OPTIONS' })
      if (r.status === 204 || r.ok) {
        proxyBase = c
        break
      }
    } catch {
      /* 试下一个 */
    }
  }
  return proxyBase
}

interface CallOptions {
  method: 'GET' | 'POST'
  path: string
  body?: unknown
}

async function call(p: Provider, opt: CallOptions): Promise<Response> {
  const target = joinUrl(p.baseUrl, opt.path)
  const h = headers(p.apiKey)

  if (!proxyBase) await detectProxy()

  if (proxyBase) {
    let res: Response
    try {
      res = await fetch(proxyBase, {
        method: 'POST',
        headers: {
          ...h,
          'X-Target': target,
          'X-Method': opt.method,
        },
        body: opt.body === undefined ? undefined : JSON.stringify(opt.body),
      })
    } catch (e) {
      // 代理掉线：清缓存后回退直连
      resetProxy()
      throw new Error(
        '代理请求失败，已回退直连：' + (e instanceof Error ? e.message : String(e)),
      )
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`)
    }
    return res
  }

  const res = await fetch(target, {
    method: opt.method,
    headers: h,
    body: opt.body === undefined ? undefined : JSON.stringify(opt.body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`)
  }
  return res
}

export async function fetchModels(p: Provider): Promise<ProviderModel[]> {
  const res = await call(p, { method: 'GET', path: '/v1/models' })
  return parseModels(await res.json())
}

/* ── 图片生成 ── */

export interface ImageRequest {
  prompt: string
  negativePrompt?: string
  /** 参考图 URL 或 data URL，支持多张 */
  images?: string[]
  size?: string
  model: string
}

export interface ImageResult {
  url?: string
  b64?: string
}

export async function generateImage(
  p: Provider,
  req: ImageRequest,
): Promise<ImageResult[]> {
  const body: Record<string, unknown> = {
    model: req.model,
    prompt: req.prompt,
    n: 1,
    response_format: 'url',
  }
  if (req.negativePrompt) body.negative_prompt = req.negativePrompt
  if (req.size) body.size = req.size
  if (req.images && req.images.length === 1) body.image = req.images[0]
  else if (req.images && req.images.length > 1) body.image = req.images

  const res = await call(p, {
    method: 'POST',
    path: '/v1/images/generations',
    body,
  })

  const json = (await res.json()) as {
    data?: { url?: string; b64_json?: string }[]
  }
  const data = json.data || []
  return data.map(d => ({ url: d.url, b64: d.b64_json }))
}

/* ── 视频生成 ── */

export interface VideoRequest {
  prompt: string
  image?: string
  model: string
  duration?: number
  size?: string
}

export interface VideoJob {
  id: string
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  url?: string
  error?: string
}

/**
 * 视频接口按 OpenAI 风格约定：POST /v1/videos 创建任务，GET /v1/videos/{id} 轮询。
 * 不同服务商路径可能不同，因此失败时把服务端原文带回给调用方显示。
 */
export async function createVideo(
  p: Provider,
  req: VideoRequest,
): Promise<VideoJob> {
  const body: Record<string, unknown> = {
    model: req.model,
    prompt: req.prompt,
  }
  if (req.image) body.image = req.image
  if (req.duration) body.duration = req.duration
  if (req.size) body.size = req.size

  let json: Record<string, unknown>
  try {
    const res = await call(p, { method: 'POST', path: '/v1/videos', body })
    json = (await res.json()) as Record<string, unknown>
  } catch (e) {
    throw new Error(
      '视频接口不可用：' + (e instanceof Error ? e.message : String(e)),
    )
  }
  return {
    id: String(json.id || json.task_id || ''),
    status: (String(json.status || 'queued') as VideoJob['status']),
    url: typeof json.url === 'string' ? json.url : undefined,
  }
}

export async function pollVideo(p: Provider, id: string): Promise<VideoJob> {
  const res = await call(p, {
    method: 'GET',
    path: '/v1/videos/' + encodeURIComponent(id),
  })
  const json = (await res.json()) as Record<string, unknown>
  const status = String(json.status || 'running')
  return {
    id,
    status: (status === 'completed' || status === 'succeeded'
      ? 'succeeded'
      : status === 'failed' || status === 'error'
        ? 'failed'
        : status === 'queued'
          ? 'queued'
          : 'running') as VideoJob['status'],
    url: typeof json.url === 'string' ? json.url : undefined,
    error: typeof json.error === 'string' ? json.error : undefined,
  }
}

/* ── 文本模型：改写提示词 ── */

export type ChatContent =
  | string
  | { type: 'text'; text: string }[]
  | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[]

export async function chatComplete(
  p: Provider,
  model: string,
  messages: { role: string; content: ChatContent }[],
): Promise<string> {
  const res = await call(p, {
    method: 'POST',
    path: '/v1/chat/completions',
    body: { model, messages, stream: false },
  })
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  return json.choices?.[0]?.message?.content || ''
}

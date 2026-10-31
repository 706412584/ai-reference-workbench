/**
 * 原生桥接。Android / Windows 外壳注入 window.__wbNative；
 * 浏览器环境自动回退到 <a download>。
 */

interface NativeApi {
  saveImage: (url: string, filename: string) => string
  shareText?: (text: string) => void
  toast?: (msg: string) => void
  platform: string | (() => string)
}

export interface McpApi {
  start: (port: number, lan: boolean) => boolean
  stop: () => void
  running: () => boolean
  lanIp: () => string
}

declare global {
  interface Window {
    __wbNative?: NativeApi
    __wbMcp?: McpApi
  }
}

export function hasNative(): boolean {
  return !!window.__wbNative
}

export function platform(): string {
  const n = window.__wbNative
  if (!n) return 'web'
  try {
    return typeof n.platform === 'function' ? n.platform() : String(n.platform)
  } catch {
    return 'native'
  }
}

/**
 * 保存图片。返回保存后的路径（原生环境）或 null（浏览器已触发下载）。
 * 注意：Android 端用 MediaStore 写入 Pictures/AI参考工作台，返回 content URI。
 */
export async function saveImage(path: string, filename: string): Promise<string | null> {
  const url = path.replace(/^\.?\//, '')
  if (window.__wbNative) {
    try {
      return window.__wbNative.saveImage(url, filename)
    } catch {
      return null
    }
  }

  // 浏览器：fetch -> blob -> a[download]
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    const objUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    window.setTimeout(() => URL.revokeObjectURL(objUrl), 1500)
    return null
  } catch {
    return null
  }
}

/* ── 内置 MCP（仅原生外壳） ── */

export function hasMcpHost(): boolean {
  return !!window.__wbMcp
}

export function mcpStart(port: number, lan: boolean): boolean {
  const m = window.__wbMcp
  if (!m) return false
  try {
    return m.start(port, lan)
  } catch {
    return false
  }
}

export function mcpStop(): void {
  const m = window.__wbMcp
  if (!m) return
  try {
    m.stop()
  } catch {
    /* 忽略 */
  }
}

export function mcpRunning(): boolean {
  const m = window.__wbMcp
  if (!m) return false
  try {
    return m.running()
  } catch {
    return false
  }
}

export function mcpLanIp(): string {
  const m = window.__wbMcp
  if (!m) return ''
  try {
    return m.lanIp() || ''
  } catch {
    return ''
  }
}

/** 生成适合展示的文件名 */
export function imageFilename(ref: string, ext = 'webp'): string {
  const safe = ref.replace(/[\\/:*?"<>|]/g, '_')
  return `${safe}.${ext}`
}

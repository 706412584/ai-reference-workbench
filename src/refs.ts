import type { CostumeItem, IndexData, PoseItem, PoseVariant } from './types'

/**
 * 稳定引用格式，供外部 AI / MCP 解析：
 *   costume:SPR-0001
 *   pose:full-sexy/P001:front        （深度版）
 *   pose-line:full-sexy/P001:front   （线稿版）
 *   https://app.local/assets/costume/mid/SPR-0001.webp
 */

export const APP_ORIGIN = 'https://app.local'

export function costumeRef(it: CostumeItem): string {
  return `costume:${it.id}`
}

export function poseRef(p: PoseItem, ang: string, variant: PoseVariant = 'depth'): string {
  return `${variant === 'line' ? 'pose-line' : 'pose'}:${p.id}:${ang}`
}

/** 引用前缀 -> 姿势数据源 */
function poseData(ref: string, data: IndexData): { poses: PoseItem[]; variant: PoseVariant } | null {
  if (ref.indexOf('pose:') === 0) return { poses: data.pose.poses, variant: 'depth' }
  if (ref.indexOf('pose-line:') === 0 && data.poseLine)
    return { poses: data.poseLine.poses, variant: 'line' }
  return null
}

export function absUrl(path: string): string {
  return `${APP_ORIGIN}/${path.replace(/^\.?\//, '')}`
}

export interface Resolved {
  kind: 'costume' | 'pose'
  id: string
  ang?: string
  title: string
  sub: string
  thumb: string
  image: string
  tags?: string[]
}

/** 解析一条引用，返回可展示的条目；无法解析返回 null。 */
export function resolveRef(ref: string, data: IndexData): Resolved | null {
  const raw = ref.trim()
  if (!raw) return null

  // 完整 URL
  if (/^https?:\/\//i.test(raw)) {
    const path = raw.replace(/^https?:\/\/[^/]+\//i, '')
    const costume = data.costume.items.find(x => x.mid === path || x.thumb === path || x.full === path)
    if (costume) return toCostume(costume, data)
    const sources: { poses: PoseItem[]; variant: PoseVariant }[] = [
      { poses: data.pose.poses, variant: 'depth' },
    ]
    if (data.poseLine) sources.push({ poses: data.poseLine.poses, variant: 'line' })
    for (const s of sources) {
      for (const p of s.poses) {
        for (const v of p.views) {
          if (v.full === path || v.thumb === path) return toPose(p, v.ang, data, s.variant)
        }
      }
    }
    return null
  }

  if (raw.indexOf('costume:') === 0) {
    const id = raw.slice(8)
    const it = data.costume.items.find(x => x.id === id)
    return it ? toCostume(it, data) : null
  }

  const ps = poseData(raw, data)
  if (ps) {
    const cut = raw.lastIndexOf(':')
    const id = raw.slice(ps.variant === 'line' ? 10 : 5, cut > 0 ? cut : undefined)
    const ang = cut > 0 ? raw.slice(cut + 1) : ''
    const p = ps.poses.find(x => x.id === id)
    if (!p) return null
    const v = p.views.find(x => x.ang === ang) || p.views[0]
    return toPose(p, v.ang, data, ps.variant)
  }

  return null
}

function toCostume(it: CostumeItem, data: IndexData): Resolved {
  const cat = data.costume.cats.find(c => c.slug === it.cat)
  return {
    kind: 'costume',
    id: it.id,
    title: it.id,
    sub: cat ? cat.zh : it.cat,
    thumb: it.thumb,
    image: it.mid,
    tags: it.tags,
  }
}

function toPose(p: PoseItem, ang: string, data: IndexData, variant: PoseVariant = 'depth'): Resolved {
  const v = p.views.find(x => x.ang === ang) || p.views[0]
  const cat = data.pose.cats.find(c => c.slug === p.cat)
  return {
    kind: 'pose',
    id: p.id,
    ang: v.ang,
    title: `${p.pid} · ${v.nameZh}`,
    sub: (variant === 'line' ? '线稿 · ' : '') + (cat ? cat.zh : p.cat),
    thumb: v.thumb,
    image: v.full,
    tags: [p.nameZh],
  }
}

/** 生成给 AI 的紧凑索引块（含绝对 URL）。 */
export function buildIndexBlock(refs: string[], data: IndexData): string {
  const lines: string[] = []
  for (const r of refs) {
    const x = resolveRef(r, data)
    if (!x) continue
    lines.push(
      `${r}\t${x.title}\t${x.sub}\t${absUrl(x.image)}`,
    )
  }
  return lines.join('\n')
}

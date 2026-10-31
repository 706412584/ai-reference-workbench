import { usePersisted } from './store'

export type AssetKind = 'image' | 'video' | 'upload'

export type AssetCategory = 'image' | 'video' | 'character' | 'upload'

export interface Asset {
  id: string
  kind: AssetKind
  /** 资源库分类：生成图 / 生成视频 / 角色卡 / 用户上传 */
  category?: AssetCategory
  /** 角色卡的分组名（同一角色的多视图共用） */
  group?: string
  /** 远程 URL 或本地 data URL */
  url: string
  /** 缩略图（视频取首帧时可能为空） */
  thumb?: string
  title: string
  prompt?: string
  model?: string
  refs?: string[]
  createdAt: number
  /** 用户备注 */
  note?: string
}

export const CATEGORY_LABEL: Record<AssetCategory, string> = {
  image: '生成图片',
  video: '生成视频',
  character: '角色卡',
  upload: '我的上传',
}

export function assetCategory(a: Asset): AssetCategory {
  if (a.category) return a.category
  if (a.kind === 'video') return 'video'
  if (a.kind === 'upload') return 'upload'
  return 'image'
}

export function useLibrary() {
  return usePersisted<Asset[]>('wb.library', [])
}

/** 估算 data URL 体积（字节） */
export function dataUrlBytes(url: string): number {
  const i = url.indexOf(',')
  if (i < 0) return 0
  return Math.round(((url.length - i - 1) * 3) / 4)
}

export function formatBytes(n: number): string {
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}

/**
 * localStorage 通常只有 5MB。远程 URL 直接存；
 * base64 结果超过阈值时提示用户保存到本地磁盘而不是入库。
 */
export const INLINE_LIMIT = 1.6 * 1024 * 1024

export interface CostumeCat {
  slug: string
  ja: string
  zh: string
  count: number
}

export interface TagGroup {
  key: string
  zh: string
  ja: string
  tags: string[]
}

export interface CostumeItem {
  id: string
  cat: string
  tags: string[]
  thumb: string
  mid: string
  full: string
}

export interface PoseSeries {
  slug: string
  ja: string
  zh: string
  count: number
}

export interface PoseCat {
  slug: string
  ja: string
  zh: string
  count: number
}

export interface PoseView {
  ang: string
  name: string
  nameZh: string
  thumb: string
  full: string
}

export interface PoseItem {
  id: string
  series: string
  cat: string
  pid: string
  name: string
  nameZh: string
  views: PoseView[]
}

export interface IndexData {
  version: number
  costume: {
    cats: CostumeCat[]
    groups: TagGroup[]
    items: CostumeItem[]
    tagZh: Record<string, string>
    tagJa: Record<string, string>
  }
  pose: {
    series: PoseSeries[]
    cats: PoseCat[]
    poses: PoseItem[]
    angZh: Record<string, string>
    angOrder: string[]
  }
}

export type Library = 'costume' | 'pose'

export interface FavRef {
  kind: Library
  id: string
  ang?: string
}

export interface PromptBagItem {
  kind: Library
  id: string
  label: string
  tags?: string[]
  ang?: string
  thumb: string
}

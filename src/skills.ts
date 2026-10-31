import { useEffect, useState } from 'react'

export interface MiniMaxMode {
  id: string
  label: string
  desc: string
}

export interface SkillsData {
  version: number
  sources: { name: string; url: string; license: string }[]
  minimax: {
    title: string
    modes: MiniMaxMode[]
    skill: string
    guide: string
    refGuide: string
  }
  qwen: {
    title: string
    variants: { id: string; label: string; lang: string; prompt: string }[]
  }
}

let cache: SkillsData | null = null
let inflight: Promise<SkillsData> | null = null

export function loadSkills(): Promise<SkillsData> {
  if (cache) return Promise.resolve(cache)
  if (inflight) return inflight
  inflight = fetch('data/skills.json')
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json() as Promise<SkillsData>
    })
    .then(d => {
      cache = d
      return d
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

export function useSkills(): SkillsData | null {
  const [data, setData] = useState<SkillsData | null>(cache)
  useEffect(() => {
    if (cache) return
    let alive = true
    loadSkills().then(
      d => {
        if (alive) setData(d)
      },
      () => {
        /* 技能文件缺失不影响主流程 */
      },
    )
    return () => {
      alive = false
    }
  }, [])
  return data
}

/** 生成发给外部 AI 的提示词请求（含技能规范） */
export function buildSkillRequest(
  skills: SkillsData,
  tab: 'minimax' | 'qwen',
  mode: string,
  lang: 'zh' | 'en',
  userText: string,
): string {
  if (tab === 'minimax') {
    const m = skills.minimax.modes.find(x => x.id === mode)
    const guide = mode === 'ref2va' ? skills.minimax.refGuide : skills.minimax.guide
    const head = [
      '# 任务：按 MiniMax H3 规范改写提示词',
      `# 模式：${m ? m.label : mode}${m ? ' — ' + m.desc : ''}`,
      '',
      '## 规范',
      guide,
      '',
      '## 用户输入',
      userText,
      '',
      '## 输出要求',
      '- 严格使用规范中的字段名、段落顺序与时间记法。',
      '- 重写正文用英文；对白、歌词、画面文字保留原语言。',
    ].join('\n')
    return head
  }

  const variant =
    skills.qwen.variants.find(v => v.lang === lang) || skills.qwen.variants[0]
  return [
    '# 任务：按 Qwen-Image 规范改写图像提示词',
    '',
    '## 规范',
    variant.prompt,
    '',
    '## 用户输入',
    userText,
    '',
    '## 输出要求',
    lang === 'zh'
      ? '- 输出改写后的提示词正文，不要解释。'
      : '- Output only the rewritten prompt, no commentary.',
  ].join('\n')
}

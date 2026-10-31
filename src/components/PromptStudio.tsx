import { useEffect, useMemo, useState } from 'react'
import type { IndexData } from '../types'
import { usePersisted } from '../store'
import { absUrl, buildIndexBlock, resolveRef } from '../refs'
import Img from './Img'
import Drawer from './Drawer'
import Select from './Select'
import { IconCopy, IconLink, IconSave, IconTrash } from '../icons'
import { buildSkillRequest, type SkillsData } from '../skills'

export interface PromptRecord {
  id: string
  name: string
  text: string
  refs: string[]
  createdAt: number
}

interface Props {
  data: IndexData
  skills: SkillsData | null
  defaultSkill: 'none' | 'minimax' | 'qwen'
  defaultLang: 'zh' | 'en'
  onClose: () => void
  onToast: (m: string) => void
  onCopy: (text: string, okMsg: string) => void
}

export function usePrompts() {
  return usePersisted<PromptRecord[]>('wb.prompts', [])
}

export function usePromptsCount(): [number] {
  // 与 PromptStudio 共用同一个持久化键，写入后会自动同步
  const [list] = usePersisted<PromptRecord[]>('wb.prompts', [])
  return [list.length]
}

/** 提示词工作室：保存 / 编辑 / 导入外部链接 / 导出 AI 索引 */
export default function PromptStudio({
  data,
  skills,
  defaultSkill,
  defaultLang,
  onClose,
  onToast,
  onCopy,
}: Props) {
  const [prompts, setPrompts] = usePrompts()
  const [activeId, setActiveId] = useState<string | null>(prompts[0] ? prompts[0].id : null)
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [refsText, setRefsText] = useState('')
  const [importText, setImportText] = useState('')
  const [skillTab, setSkillTab] = useState<'none' | 'minimax' | 'qwen'>(defaultSkill)
  const [skillLang, setSkillLang] = useState<'zh' | 'en'>(defaultLang)
  const [skillMode, setSkillMode] = useState('t2va')
  const [skillOpen, setSkillOpen] = useState(false)

  const active = useMemo(
    () => prompts.find(p => p.id === activeId) || null,
    [prompts, activeId],
  )

  useEffect(() => {
    if (active) {
      setName(active.name)
      setText(active.text)
      setRefsText(active.refs.join('\n'))
    }
  }, [active])

  const parsedRefs = useMemo(() => {
    const lines = refsText
      .split('\n')
      .map(x => x.trim())
      .filter(Boolean)
    const out: {
      ref: string
      ok: boolean
      label: string
      sub: string
      thumb: string
      url: string
    }[] = []
    for (const r of lines) {
      const x = resolveRef(r, data)
      out.push({
        ref: r,
        ok: !!x,
        label: x ? x.title : r,
        sub: x ? x.sub : '无法解析',
        thumb: x ? x.thumb : '',
        url: x ? absUrl(x.image) : '',
      })
    }
    return out
  }, [refsText, data])

  const create = () => {
    const rec: PromptRecord = {
      id: `p${Date.now()}`,
      name: '未命名提示词',
      text: '',
      refs: [],
      createdAt: Date.now(),
    }
    setPrompts(prev => [rec, ...prev])
    setActiveId(rec.id)
  }

  const save = () => {
    if (!active) return
    const refs = refsText
      .split('\n')
      .map(x => x.trim())
      .filter(Boolean)
    setPrompts(prev =>
      prev.map(p => (p.id === active.id ? { ...p, name: name.trim() || p.name, text, refs } : p)),
    )
    onToast('已保存')
  }

  const remove = (id: string) => {
    setPrompts(prev => prev.filter(p => p.id !== id))
    if (activeId === id) setActiveId(null)
  }

  /** 从外部（AI / MCP）粘贴的链接或引用中提取并合并 */
  const importRefs = () => {
    const found: string[] = []
    const re = /(https?:\/\/[^\s"'<>)]+)|(costume:[A-Z]{3}-\d{4})|(pose:[a-z-]+\/[A-Z]\d{3}:[a-z]+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(importText)) !== null) {
      found.push(m[0])
    }
    // 去重并校验
    const uniq: string[] = []
    const seen: Record<string, true> = {}
    for (const f of found) {
      if (seen[f]) continue
      seen[f] = true
      if (resolveRef(f, data)) uniq.push(f)
    }
    if (!uniq.length) {
      onToast('没有识别到可用引用')
      return
    }
    setRefsText(prev => {
      const lines = prev.split('\n').map(x => x.trim()).filter(Boolean)
      for (const u of uniq) if (lines.indexOf(u) < 0) lines.push(u)
      return lines.join('\n')
    })
    setImportText('')
    onToast(`已导入 ${uniq.length} 条`)
  }

  return (
    <Drawer
      title="提示词"
      count={prompts.length}
      onClose={onClose}
      footer={
        <>
          <button className="primary" onClick={create}>
            新建
          </button>
          <button onClick={save} disabled={!active}>
            保存
          </button>
          <button
            disabled={!active}
            onClick={() => {
              const refs = refsText
                .split('\n')
                .map(x => x.trim())
                .filter(Boolean)
              const block = buildIndexBlock(refs, data)
              onCopy(block, '已复制 AI 索引')
            }}
          >
            <IconCopy size={13} /> 复制索引
          </button>
          <button
            disabled={!active}
            onClick={() => {
              const refs = refsText
                .split('\n')
                .map(x => x.trim())
                .filter(Boolean)
              const block = buildIndexBlock(refs, data)
              const body = `# ${name}\n\n${text}\n\n## 参考索引\n\n\`\`\`\n${block}\n\`\`\`\n`
              const blob = new Blob([body], { type: 'text/markdown;charset=utf-8' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `${(name || 'prompt').replace(/[\\/:*?"<>|]/g, '_')}.md`
              document.body.appendChild(a)
              a.click()
              document.body.removeChild(a)
              window.setTimeout(() => URL.revokeObjectURL(url), 1200)
              onToast('已导出 Markdown')
            }}
          >
            <IconSave size={13} /> 导出 MD
          </button>
        </>
      }
    >
      <div className="prompt-layout">
        <div className="prompt-list">
          {prompts.length === 0 ? (
            <div className="drawer-empty">还没有提示词。点「新建」开始。</div>
          ) : (
            prompts.map(p => (
              <div
                key={p.id}
                className={'prompt-item' + (p.id === activeId ? ' on' : '')}
                onClick={() => setActiveId(p.id)}
                role="button"
                tabIndex={0}
                onKeyDown={e => {
                  if (e.key === 'Enter') setActiveId(p.id)
                }}
              >
                <div className="t">{p.name}</div>
                <div className="s">
                  {p.refs.length} 条引用 · {p.text ? p.text.slice(0, 24) : '空'}
                </div>
                <button
                  className="rm"
                  aria-label="删除"
                  onClick={e => {
                    e.stopPropagation()
                    remove(p.id)
                  }}
                >
                  <IconTrash size={13} />
                </button>
              </div>
            ))
          )}
        </div>

        {active && (
          <div className="prompt-edit">
            <label className="field">
              <span>名称</span>
              <input value={name} onChange={e => setName(e.target.value)} />
            </label>

            <label className="field">
              <span>提示词正文</span>
              <textarea
                value={text}
                placeholder="正向提示词、负面提示词、风格描述…"
                onChange={e => setText(e.target.value)}
              />
            </label>

            <div className="field">
              <span>提示词技能</span>
              <div className="skill-tabs">
                <button
                  className="skill-tab"
                  aria-pressed={skillTab === 'none'}
                  onClick={() => setSkillTab('none')}
                >
                  不使用
                </button>
                <button
                  className="skill-tab"
                  aria-pressed={skillTab === 'minimax'}
                  onClick={() => setSkillTab('minimax')}
                >
                  MiniMax H3
                </button>
                <button
                  className="skill-tab"
                  aria-pressed={skillTab === 'qwen'}
                  onClick={() => setSkillTab('qwen')}
                >
                  Qwen-Image
                </button>
              </div>

              {skillTab === 'minimax' && skills && (
                <div className="skill-body">
                  <div className="skill-opts">
                    <Select
                      value={skillMode}
                      ariaLabel="MiniMax 模式"
                      options={skills.minimax.modes.map(m => ({ value: m.id, label: m.label }))}
                      onChange={setSkillMode}
                    />
                  </div>
                  <p className="skill-desc">
                    {skills.minimax.modes.find(m => m.id === skillMode)?.desc}
                  </p>
                  <div className="skill-actions">
                    <button
                      className="chip-btn"
                      onClick={() => setSkillOpen(o => !o)}
                    >
                      {skillOpen ? '收起规范' : '查看规范'}
                    </button>
                    <button
                      className="chip-btn primary-soft"
                      onClick={() => {
                        if (!skills) return
                        onCopy(
                          buildSkillRequest(skills, 'minimax', skillMode, 'en', text || '（在此描述你的画面）'),
                          '已复制改写请求',
                        )
                      }}
                    >
                      <IconCopy size={13} />
                      <span style={{ marginLeft: 6 }}>复制改写请求</span>
                    </button>
                  </div>
                  {skillOpen && (
                    <pre className="skill-pre">
                      {skillMode === 'ref2va' ? skills.minimax.refGuide : skills.minimax.guide}
                    </pre>
                  )}
                </div>
              )}

              {skillTab === 'qwen' && skills && (
                <div className="skill-body">
                  <div className="skill-opts">
                    <Select
                      value={skillLang}
                      ariaLabel="改写语言"
                      options={[
                        { value: 'zh', label: '中文改写' },
                        { value: 'en', label: '英文改写' },
                      ]}
                      onChange={v => setSkillLang(v as 'zh' | 'en')}
                    />
                  </div>
                  <div className="skill-actions">
                    <button className="chip-btn" onClick={() => setSkillOpen(o => !o)}>
                      {skillOpen ? '收起规范' : '查看规范'}
                    </button>
                    <button
                      className="chip-btn primary-soft"
                      onClick={() => {
                        if (!skills) return
                        onCopy(
                          buildSkillRequest(skills, 'qwen', 't2i', skillLang, text || '（在此描述你的画面）'),
                          '已复制改写请求',
                        )
                      }}
                    >
                      <IconCopy size={13} />
                      <span style={{ marginLeft: 6 }}>复制改写请求</span>
                    </button>
                  </div>
                  {skillOpen && (
                    <pre className="skill-pre">
                      {(skills.qwen.variants.find(v => v.lang === skillLang) || skills.qwen.variants[0])
                        .prompt}
                    </pre>
                  )}
                </div>
              )}
            </div>

            <label className="field">
              <span>参考索引（每行一条引用或图片地址）</span>
              <textarea
                className="mono"
                value={refsText}
                placeholder={'costume:SPR-0001\npose:full-sexy/P001:front\nhttps://app.local/assets/costume/mid/SPR-0001.webp'}
                onChange={e => setRefsText(e.target.value)}
              />
            </label>

            {parsedRefs.length > 0 && (
              <div className="ref-preview">
                {parsedRefs.map((r, i) => (
                  <div className={'ref-row' + (r.ok ? '' : ' bad')} key={r.ref + i}>
                    <div className="thumb">
                      {r.thumb ? <Img src={r.thumb} alt="" /> : null}
                    </div>
                    <div className="txt">
                      <b>{r.label}</b>
                      <span>{r.ok ? r.url : '无法解析：' + r.ref}</span>
                    </div>
                    <button
                      className="rm"
                      aria-label="移除"
                      onClick={() => {
                        const lines = refsText.split('\n').filter((_, idx) => idx !== i)
                        setRefsText(lines.join('\n'))
                      }}
                    >
                      <IconTrash size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="field">
              <span>从外部导入（粘贴 AI 返回的链接 / 引用）</span>
              <textarea
                className="mono"
                value={importText}
                placeholder="粘贴包含图片链接或 costume:/pose: 引用的文本"
                onChange={e => setImportText(e.target.value)}
              />
              <button className="chip-btn" style={{ marginTop: 8 }} onClick={importRefs}>
                <IconLink size={13} />
                <span style={{ marginLeft: 6 }}>识别并导入</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  )
}

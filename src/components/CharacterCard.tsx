import { useState } from 'react'
import type { ProviderConfig } from '../providers'
import { activeProvider, generateImage } from '../providers'
import type { Asset } from '../library'
import Img from './Img'
import Drawer from './Drawer'
import { IconCopy, IconSave, IconStar, IconTrash } from '../icons'
import { saveImage } from '../native'

interface Props {
  config: ProviderConfig
  onAdd: (a: Asset) => void
  onClose: () => void
  onToast: (m: string) => void
  onCopy: (text: string, okMsg: string) => void
  onProviders: () => void
}

type Layout = 'sheet' | 'sheet-face' | 'sheet-lower'

const LAYOUTS: { key: Layout; label: string; hint: string }[] = [
  {
    key: 'sheet',
    label: '全身三视图',
    hint: '同一张图内并排：正面、侧面、背面',
  },
  {
    key: 'sheet-face',
    label: '三视图 + 脸部特写',
    hint: '左侧三视图，右侧脸部大头贴',
  },
  {
    key: 'sheet-lower',
    label: '三视图 + 下身三视图',
    hint: '上半部分全身三视图，下半部分下身三视图',
  },
]

const LAYOUT_PROMPT: Record<Layout, string> = {
  sheet:
    'character reference sheet on one single canvas, three full-body views side by side: front view, side view, back view, ' +
    'identical character and outfit across all three, T-pose or neutral standing, full figure head to toe, ' +
    'thin separator lines between views, clean white background, even studio lighting, no text labels',
  'sheet-face':
    'character reference sheet on one single canvas, left side shows three full-body views side by side (front, side, back), ' +
    'right side shows a large close-up portrait of the same face, identical character and outfit, ' +
    'clean white background, even studio lighting, no text labels',
  'sheet-lower':
    'character reference sheet on one single canvas, top row shows three full-body views (front, side, back), ' +
    'bottom row shows three close-up lower-body views (front, side, back) of the same legs and footwear, ' +
    'identical character and outfit, thin separator lines, clean white background, even studio lighting, no text labels',
}

/** 角色卡：单张设定图，图内包含多个部位与视角。 */
export default function CharacterCard({
  config,
  onAdd,
  onClose,
  onToast,
  onCopy,
  onProviders,
}: Props) {
  const provider = activeProvider(config)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [layout, setLayout] = useState<Layout>('sheet')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [results, setResults] = useState<Asset[]>([])

  const model = provider ? provider.selected.image : ''

  const buildPrompt = () =>
    [
      LAYOUT_PROMPT[layout],
      desc.trim(),
      'consistent character design, same person, same outfit, same colors, high detail',
    ]
      .filter(Boolean)
      .join(', ')

  const run = async () => {
    if (!provider) {
      onProviders()
      return
    }
    if (!model) {
      onToast('请选择图片模型')
      return
    }
    if (!desc.trim()) {
      onToast('先描述角色')
      return
    }
    const group = name.trim() || '角色 ' + new Date().toLocaleTimeString()
    const prompt = buildPrompt()

    setBusy(true)
    setProgress('生成中…')
    try {
      const res = await generateImage(provider, {
        prompt,
        size: '1024x1536',
        model,
      })
      const first = res[0]
      if (!first) {
        setProgress('服务端没有返回图片')
        return
      }
      const asset: Asset = {
        id: 'c' + Date.now(),
        kind: 'image',
        category: 'character',
        group,
        url: first.url || (first.b64 ? 'data:image/png;base64,' + first.b64 : ''),
        title: `${group} · ${LAYOUTS.find(l => l.key === layout)?.label}`,
        prompt,
        model,
        createdAt: Date.now(),
      }
      setResults([asset])
      setProgress('完成')
    } catch (e) {
      setProgress('失败：' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy(false)
    }
  }

  const save = async (a: Asset) => {
    const filename = a.title.replace(/[\\/:*?"<>|]/g, '_') + '.png'
    if (a.url.startsWith('data:')) {
      const link = document.createElement('a')
      link.href = a.url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      return
    }
    await saveImage(a.url, filename)
  }

  return (
    <Drawer
      title="角色卡"
      onClose={onClose}
      footer={
        <>
          <button className="primary" onClick={run} disabled={busy}>
            {busy ? progress || '生成中…' : '生成角色卡'}
          </button>
          <button
            disabled={results.length === 0}
            onClick={() => {
              results.forEach(r => onAdd(r))
              onToast('已入库')
            }}
          >
            <IconStar size={13} /> 入库
          </button>
          <button onClick={onProviders}>服务商</button>
        </>
      }
    >
      {!provider && (
        <div className="gen-empty">
          <b>还没有配置服务商</b>
          <p>先添加一个图片模型，才能生成角色卡。</p>
          <button className="chip-btn" onClick={onProviders}>
            去配置
          </button>
        </div>
      )}

      {provider && (
        <>
          <div className="gen-head">
            <span className="gen-prov">{provider.label}</span>
            <span className="gen-model">{model || '未选图片模型'}</span>
          </div>

          <label className="field">
            <span>角色名（用于资源库分组）</span>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例如 银发少女 A"
            />
          </label>

          <label className="field">
            <span>角色设定</span>
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="年龄、发型发色、瞳色、服装、配饰、体型…越具体越稳定"
            />
          </label>

          <div className="field">
            <span>版式</span>
            <div className="skill-tabs">
              {LAYOUTS.map(l => (
                <button
                  key={l.key}
                  className="skill-tab"
                  aria-pressed={layout === l.key}
                  onClick={() => setLayout(l.key)}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <p className="set-hint">
              {LAYOUTS.find(l => l.key === layout)?.hint}
              。整张图一次生成，比例固定 2:3。
            </p>
          </div>

          {progress && <p className="gen-status">{progress}</p>}

          {results.length > 0 && (
            <div className="char-results">
              {results.map(r => (
                <div className="char-result" key={r.id}>
                  <Img src={r.url} alt={r.title} />
                  <div className="char-result-meta">
                    <b>{r.title}</b>
                    <div className="char-ops">
                      <button onClick={() => save(r)} aria-label="保存">
                        <IconSave size={12} />
                      </button>
                      <button onClick={() => onCopy(r.url, '已复制地址')} aria-label="复制地址">
                        <IconCopy size={12} />
                      </button>
                      <button
                        onClick={() => {
                          onAdd(r)
                          onToast('已入库')
                        }}
                        aria-label="入库"
                      >
                        <IconStar size={12} />
                      </button>
                      <button
                        onClick={() => setResults(prev => prev.filter(x => x.id !== r.id))}
                        aria-label="移除"
                      >
                        <IconTrash size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Drawer>
  )
}

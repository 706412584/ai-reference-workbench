import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProviderConfig } from '../providers'
import {
  activeProvider,
  chatComplete,
  createVideo,
  generateImage,
  pollVideo,
  type ChatContent,
} from '../providers'
import type { Asset } from '../library'
import type { IndexData } from '../types'
import RefPicker from './RefPicker'
import Select from './Select'
import { dataUrlBytes, formatBytes, INLINE_LIMIT } from '../library'
import type { SkillsData } from '../skills'
import { buildSkillRequest } from '../skills'
import { saveImage } from '../native'
import Drawer from './Drawer'
import Img from './Img'
import { IconBag, IconCopy, IconSave, IconStar, IconTrash } from '../icons'

type Mode = 't2i' | 'i2i' | 't2v' | 'i2v'

interface Props {
  config: ProviderConfig
  index: IndexData
  /** 从图片详情跳转时预置的参考图与提示词 */
  seed?: { url: string; prompt: string; nonce: number } | null
  skills: SkillsData | null
  library: Asset[]
  onAddAsset: (a: Asset) => void
  onRemoveAsset: (id: string) => void
  onClose: () => void
  onToast: (m: string) => void
  onCopy: (text: string, okMsg: string) => void
  onProviders: () => void
  onSeedConsumed: () => void
  onCharacter: () => void
  onPreview: (asset: Asset) => void
}

const SIZES = ['1024x1024', '1024x1536', '1536x1024', '768x1024', '512x512']

/** 从参考图读到的比例，映射到最接近的生成尺寸 */
const RATIOS: { label: string; size: string; ratio: number }[] = [
  { label: '1:1', size: '1024x1024', ratio: 1 },
  { label: '2:3', size: '1024x1536', ratio: 2 / 3 },
  { label: '3:2', size: '1536x1024', ratio: 3 / 2 },
  { label: '3:4', size: '768x1024', ratio: 3 / 4 },
]

function nearestRatio(w: number, h: number): string {
  if (!w || !h) return SIZES[0]
  const r = w / h
  let best = RATIOS[0]
  let diff = Math.abs(Math.log(r / best.ratio))
  for (const cand of RATIOS) {
    const d = Math.abs(Math.log(r / cand.ratio))
    if (d < diff) {
      diff = d
      best = cand
    }
  }
  return best.size
}

const MODE_LABEL: Record<Mode, string> = {
  t2i: '文生图',
  i2i: '图生图',
  t2v: '文生视频',
  i2v: '图生视频',
}

export default function GenerateStudio({
  config,
  index,
  seed,
  skills,
  library,
  onAddAsset,
  onRemoveAsset,
  onClose,
  onToast,
  onCopy,
  onProviders,
  onSeedConsumed,
  onCharacter,
  onPreview,
}: Props) {
  const provider = activeProvider(config)
  const [mode, setMode] = useState<Mode>('t2i')
  const [prompt, setPrompt] = useState('')
  const [negative, setNegative] = useState('')
  const [size, setSize] = useState(SIZES[0])
  const [images, setImages] = useState<{ url: string; ratio: string }[]>([])
  const [matchRatio, setMatchRatio] = useState(true)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [results, setResults] = useState<Asset[]>([])
  const [rewriting, setRewriting] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const needImage = mode === 'i2i' || mode === 'i2v'
  const isVideo = mode === 't2v' || mode === 'i2v'

  const model = provider
    ? isVideo
      ? provider.selected.video
      : provider.selected.image
    : ''

  // 提示词以 state 为准；某些输入法/自动化场景不会触发 onChange，
  // 因此运行前再读一次 DOM 兜底（见 run()）。

  useEffect(() => {
    setResults([])
  }, [mode])

  // 从图片详情跳转：预置参考图与提示词，并切到图生图
  useEffect(() => {
    if (!seed) return
    setMode('i2i')
    const slot = { url: seed.url, ratio: SIZES[0] }
    setImages([slot])
    if (seed.prompt) setPrompt(seed.prompt)
    probeRatio(seed.url).then(sz => {
      setImages([{ url: seed.url, ratio: sz }])
      setSize(sz)
    })
    onSeedConsumed()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.nonce])

  /* ── 参考图 ── */

  /** 把任意图片地址转成 data URL（网关视觉输入只接受 base64） */
  const toDataUrl = (url: string): Promise<string | null> =>
    new Promise(resolve => {
      if (url.startsWith('data:')) {
        resolve(url)
        return
      }
      fetch(url)
        .then(r => (r.ok ? r.blob() : null))
        .then(blob => {
          if (!blob) {
            resolve(null)
            return
          }
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result || ''))
          reader.onerror = () => resolve(null)
          reader.readAsDataURL(blob)
        })
        .catch(() => resolve(null))
    })

  /** 读图片尺寸，用于「按参考图比例生成」 */
  const probeRatio = (url: string) =>
    new Promise<string>(resolve => {
      const im = new Image()
      im.onload = () => resolve(nearestRatio(im.naturalWidth, im.naturalHeight))
      im.onerror = () => resolve(SIZES[0])
      im.src = url
    })

  const addFiles = (files: FileList | null) => {
    if (!files) return
    const arr: File[] = []
    for (let i = 0; i < files.length; i++) arr.push(files[i])
    arr.forEach(f => {
      if (!f.type.startsWith('image/')) return
      const reader = new FileReader()
      reader.onload = () => {
        const url = String(reader.result || '')
        const slot = { url, ratio: SIZES[0] }
        setImages(prev => (prev.length >= 4 ? prev : prev.concat([slot])))
        probeRatio(url).then(sz => {
          setImages(prev => prev.map(x => (x.url === url ? { ...x, ratio: sz } : x)))
          if (matchRatio) setSize(sz)
        })
      }
      reader.readAsDataURL(f)
    })
  }

  const addFromLibrary = (a: Asset) => {
    if (images.length >= 4) {
      onToast('最多 4 张参考图')
      return
    }
    if (a.url.startsWith('data:') && dataUrlBytes(a.url) > 2 * 1024 * 1024) {
      onToast('该图过大，请先保存到本地再上传')
      return
    }
    const url = a.url
    setImages(prev => prev.concat([{ url, ratio: SIZES[0] }]))
    probeRatio(a.thumb || a.url).then(sz => {
      setImages(prev => prev.map(x => (x.url === url ? { ...x, ratio: sz } : x)))
      if (matchRatio) setSize(sz)
    })
  }

  const addFromWorkbench = (url: string) => {
    if (images.length >= 4) {
      onToast('最多 4 张参考图')
      return
    }
    setImages(prev => prev.concat([{ url, ratio: SIZES[0] }]))
    probeRatio(url).then(sz => {
      setImages(prev => prev.map(x => (x.url === url ? { ...x, ratio: sz } : x)))
      if (matchRatio) setSize(sz)
    })
    setPickerOpen(false)
  }

  const removeImage = (i: number) => {
    setImages(images.filter((_, k) => k !== i))
  }

  /* ── 文本模型改写 ── */

  const rewrite = async () => {
    if (!provider || !provider.selected.chat) {
      onToast('未配置文本模型')
      return
    }
    if (!prompt.trim()) {
      onToast('先写一点描述')
      return
    }
    setRewriting(true)
    try {
      const skill = skills
        ? buildSkillRequest(skills, 'qwen', 't2i', 'zh', prompt.trim())
        : prompt.trim()

      // 有参考图时以多模态消息发送，让文本模型「看见」图再改写。
      // 该网关只接受 base64，不接受图片 URL，因此先转成 data URL。
      const inline: string[] = []
      for (const u of images.map(x => x.url)) {
        const d = await toDataUrl(u)
        if (d) inline.push(d)
      }
      const userContent: ChatContent =
        inline.length > 0
          ? [
              {
                type: 'text',
                text: skill + '\n\n请参考随附图片的实际内容改写。',
              },
              ...inline.map(u => ({ type: 'image_url' as const, image_url: { url: u } })),
            ]
          : skill

      const out = await chatComplete(provider, provider.selected.chat, [
        { role: 'system', content: '你是图像提示词工程师，只输出改写后的提示词正文。' },
        { role: 'user', content: userContent },
      ])
      if (out.trim()) {
        setPrompt(out.trim())
        onToast('提示词已改写')
      } else {
        onToast('模型返回为空')
      }
    } catch (e) {
      onToast('改写失败：' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setRewriting(false)
    }
  }

  /* ── 生成 ── */

  const run = async () => {
    // DOM 兜底：IME / 自动化输入可能不触发 onChange
    const ta = document.querySelector<HTMLTextAreaElement>('.drawer textarea')
    const live = (ta?.value ?? '').trim()
    if (live && live !== prompt.trim()) setPrompt(live)
    const finalPrompt = live || prompt.trim()

    if (!provider) {
      onProviders()
      return
    }
    if (!model) {
      onToast(isVideo ? '请选择视频模型' : '请选择图片模型')
      return
    }
    if (!finalPrompt) {
      onToast('先写提示词')
      return
    }
    setBusy(true)
    setStatus(isVideo ? '提交视频任务…' : '生成中…')
    try {
      if (!isVideo) {
        // 网关不会主动拉取图片 URL，参考图必须内联为 base64
        let refs: string[] | undefined
        if (needImage) {
          refs = []
          for (const u of images.map(x => x.url)) {
            const d = await toDataUrl(u)
            if (d) refs.push(d)
          }
          if (!refs.length) {
            setStatus('参考图读取失败')
            return
          }
        }

        const out = await generateImage(provider, {
          prompt: finalPrompt,
          negativePrompt: negative.trim() || undefined,
          images: refs,
          size,
          model,
        })
        if (!out.length) {
          setStatus('服务端没有返回图片')
          return
        }
        const added: Asset[] = out.map((r, i) => ({
          id: 'g' + Date.now() + '_' + i,
          kind: 'image',
          url: r.url || (r.b64 ? 'data:image/png;base64,' + r.b64 : ''),
          title: finalPrompt.slice(0, 40) || '生成图片',
          prompt: finalPrompt,
          model,
          refs: needImage ? images.map(x => x.url) : undefined,
          createdAt: Date.now(),
        }))
        setResults(added)
        setStatus('完成')
      } else {
        const job = await createVideo(provider, {
          prompt: finalPrompt,
          image: mode === 'i2v' ? images[0]?.url : undefined,
          model,
        })
        if (job.status === 'succeeded' && job.url) {
          const asset: Asset = {
            id: 'v' + Date.now(),
            kind: 'video',
            url: job.url,
            title: finalPrompt.slice(0, 40) || '生成视频',
            prompt: finalPrompt,
            model,
            createdAt: Date.now(),
          }
          setResults([asset])
          setStatus('完成')
        } else {
          setStatus('任务已提交，轮询中…')
          let tries = 0
          while (tries < 90) {
            await new Promise(r => setTimeout(r, 3000))
            tries++
            const st = await pollVideo(provider, job.id)
            if (st.status === 'succeeded' && st.url) {
              setResults([
                {
                  id: 'v' + Date.now(),
                  kind: 'video',
                  url: st.url,
                  title: finalPrompt.slice(0, 40) || '生成视频',
                  prompt: finalPrompt,
                  model,
                  createdAt: Date.now(),
                },
              ])
              setStatus('完成')
              return
            }
            if (st.status === 'failed') {
              setStatus('失败：' + (st.error || '未知错误'))
              return
            }
            setStatus(`轮询中… ${tries}`)
          }
          setStatus('超时，请稍后到服务商查询')
        }
      }
    } catch (e) {
      setStatus('失败：' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setBusy(false)
    }
  }

  const saveResult = async (a: Asset) => {
    if (a.url.startsWith('data:')) {
      // data URL：转成 Blob 下载
      const a2 = document.createElement('a')
      a2.href = a.url
      a2.download = a.id + '.png'
      document.body.appendChild(a2)
      a2.click()
      document.body.removeChild(a2)
      onToast('已开始保存')
      return
    }
    const saved = await saveImage(a.url, a.id + '.png')
    onToast(saved ? '已保存到 ' + saved : '已开始保存')
  }

  const addToLibrary = (a: Asset) => {
    if (a.url.startsWith('data:') && dataUrlBytes(a.url) > INLINE_LIMIT) {
      onToast('图片过大，已直接保存到磁盘而非资源库')
      void saveResult(a)
      return
    }
    onAddAsset(a)
    onToast('已加入资源库')
  }

  const videoModels = useMemo(
    () => (provider ? provider.models.filter(m => m.kind === 'video') : []),
    [provider],
  )

  return (
    <>
    <Drawer
      title="生成"
      onClose={onClose}
      footer={
        <>
          <button className="primary" onClick={run} disabled={busy}>
            {busy ? '处理中…' : MODE_LABEL[mode]}
          </button>
          <button onClick={rewrite} disabled={rewriting || !prompt.trim()}>
            {rewriting ? '改写中…' : 'AI 改写'}
          </button>
          <button onClick={onCharacter}>角色卡</button>
          <button onClick={onProviders}>服务商</button>
        </>
      }
    >
      {!provider && (
        <div className="gen-empty">
          <b>还没有配置服务商</b>
          <p>添加一个 OpenAI 兼容地址，拉取模型后即可生成。</p>
          <button className="chip-btn" onClick={onProviders}>
            去配置
          </button>
        </div>
      )}

      {provider && (
        <>
          <div className="gen-head">
            <span className="gen-prov">{provider.label}</span>
            <span className="gen-model">
              {model || (isVideo ? '未选视频模型' : '未选图片模型')}
            </span>
          </div>

          <div className="skill-tabs gen-modes">
            {(['t2i', 'i2i', 't2v', 'i2v'] as Mode[]).map(m => (
              <button
                key={m}
                className="skill-tab"
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>

          <label className="field">
            <span>提示词</span>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="描述画面内容、风格、光线、构图…"
            />
          </label>

          {!isVideo && (
            <>
              <label className="field">
                <span>反向提示词（可选）</span>
                <input
                  value={negative}
                  onChange={e => setNegative(e.target.value)}
                  placeholder="低质量、模糊、畸形…"
                />
              </label>

              <label className="field">
                <span>尺寸</span>
                <Select
                  value={size}
                  ariaLabel="生成尺寸"
                  options={SIZES.map(s => ({ value: s, label: s }))}
                  onChange={setSize}
                />
              </label>

              {needImage && images.length > 0 && (
                <label className="set-row" style={{ borderBottom: 0 }}>
                  <span>按参考图比例生成（当前 {images[0]?.ratio || size}）</span>
                  <input
                    type="checkbox"
                    checked={matchRatio}
                    onChange={e => {
                      setMatchRatio(e.target.checked)
                      if (e.target.checked && images[0]?.ratio) setSize(images[0].ratio)
                    }}
                  />
                </label>
              )}
            </>
          )}

          {isVideo && (
            <p className="set-hint">
              视频接口按 OpenAI 风格 <code>/v1/videos</code> 约定实现。
              当前网关若未开放视频，提交会直接返回服务端错误信息。
              {videoModels.length === 0 && ' 该服务商未声明视频模型。'}
            </p>
          )}

          {needImage && (
            <div className="field">
              <span>参考图（最多 4 张）</span>
              <div className="ref-strip">
                {images.map((slot, i) => (
                  <div className="ref-cell" key={i}>
                    <Img src={slot.url} alt={'参考 ' + (i + 1)} />
                    <button className="rm" aria-label="移除" onClick={() => removeImage(i)}>
                      <IconTrash size={12} />
                    </button>
                  </div>
                ))}
                {images.length < 4 && (
                  <>
                    <button className="ref-add" onClick={() => fileRef.current?.click()}>
                      + 上传
                    </button>
                    <button
                      className="ref-add"
                      onClick={() => setPickerOpen(true)}
                      title="从工作台浏览选择"
                    >
                      浏览库
                    </button>
                  </>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                style={{
                  position: 'absolute',
                  width: 1,
                  height: 1,
                  opacity: 0,
                  overflow: 'hidden',
                  clip: 'rect(0 0 0 0)',
                  border: 0,
                  padding: 0,
                }}
                onChange={e => {
                  addFiles(e.target.files)
                  e.target.value = ''
                }}
              />
              {library.length > 0 && (
                <>
                  <p className="side-label" style={{ marginTop: 12 }}>
                    从资源库选择
                  </p>
                  <div className="ref-strip">
                    {library
                      .filter(a => a.kind !== 'video')
                      .slice(0, 12)
                      .map(a => (
                        <button
                          key={a.id}
                          className="ref-cell pick"
                          title={a.title}
                          onClick={() => addFromLibrary(a)}
                        >
                          <Img src={a.thumb || a.url} alt={a.title} />
                        </button>
                      ))}
                  </div>
                </>
              )}
            </div>
          )}

          {status && <p className="gen-status">{status}</p>}

          {results.length > 0 && (
            <div className="gen-results">
              {results.map(a => (
                <div className="gen-result" key={a.id}>
                  {a.kind === 'video' ? (
                    <video src={a.url} controls playsInline />
                  ) : (
                    <button className="gen-media" onClick={() => onPreview(a)} title="点击预览">
                      <Img src={a.url} alt={a.title} />
                    </button>
                  )}
                  <div className="gen-actions">
                    <button onClick={() => saveResult(a)}>
                      <IconSave size={13} /> 保存
                    </button>
                    <button onClick={() => addToLibrary(a)}>
                      <IconStar size={13} /> 入库
                    </button>
                    <button onClick={() => onCopy(a.url, '已复制地址')}>
                      <IconCopy size={13} /> 地址
                    </button>
                    <button onClick={() => onCopy(a.prompt || '', '已复制提示词')}>
                      <IconBag size={13} /> 提示词
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="set-hint" style={{ marginTop: 16 }}>
            生成结果默认不入库。远程链接会失效，需要长期保留请点「保存」或「入库」。
          </p>
        </>
      )}

      {library.length > 0 && (
        <>
          <p className="side-label" style={{ marginTop: 24 }}>
            资源库 · {library.length}
          </p>
          <div className="lib-grid">
            {library.map(a => (
              <div className="lib-cell" key={a.id}>
                {a.kind === 'video' ? (
                  <video src={a.url} muted playsInline />
                ) : (
                  <Img src={a.thumb || a.url} alt={a.title} />
                )}
                <div className="lib-ops">
                  <button onClick={() => saveResult(a)} aria-label="保存">
                    <IconSave size={12} />
                  </button>
                  <button onClick={() => onCopy(a.url, '已复制地址')} aria-label="复制地址">
                    <IconCopy size={12} />
                  </button>
                  <button onClick={() => onRemoveAsset(a.id)} aria-label="删除">
                    <IconTrash size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <p className="set-hint">
            资源库存在浏览器本地存储（约 5MB）。共{' '}
            {formatBytes(library.reduce((n, a) => n + (a.url.startsWith('data:') ? dataUrlBytes(a.url) : 0), 0))}{' '}
            内联数据。
          </p>
        </>
      )}
    </Drawer>
    {pickerOpen && (
      <RefPicker
        data={index}
        selectedCount={images.length}
        max={4}
        onPick={(url) => addFromWorkbench(url)}
        onClose={() => setPickerOpen(false)}
      />
    )}
    </>
  )
}

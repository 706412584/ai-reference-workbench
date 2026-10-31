import { useMemo, useRef, useState } from 'react'
import type { Asset, AssetCategory } from '../library'
import { CATEGORY_LABEL, assetCategory, dataUrlBytes, formatBytes } from '../library'
import { saveImage } from '../native'
import Img from './Img'
import { IconClose, IconCopy, IconSave, IconTrash, IconUpload } from '../icons'

interface Props {
  assets: Asset[]
  onRemove: (id: string) => void
  onAdd: (a: Asset) => void
  onOpenViewer: (index: number) => void
  onToast: (m: string) => void
  onCopy: (text: string, okMsg: string) => void
  onClose: () => void
}

const TABS: (AssetCategory | 'all')[] = ['all', 'image', 'video', 'character', 'upload']

/** 资源库：独立整页界面，按生成分类归档。 */
export default function LibraryPanel({
  assets,
  onRemove,
  onAdd,
  onOpenViewer,
  onToast,
  onCopy,
  onClose,
}: Props) {
  const [tab, setTab] = useState<AssetCategory | 'all'>('all')
  const fileRef = useRef<HTMLInputElement | null>(null)

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: assets.length }
    for (const a of assets) {
      const k = assetCategory(a)
      c[k] = (c[k] || 0) + 1
    }
    return c
  }, [assets])

  const view = useMemo(() => {
    const list = tab === 'all' ? assets : assets.filter(a => assetCategory(a) === tab)
    return list.slice().sort((a, b) => b.createdAt - a.createdAt)
  }, [assets, tab])

  // 角色卡按 group 聚合
  const characterGroups = useMemo(() => {
    if (tab !== 'character') return null
    const map = new Map<string, Asset[]>()
    for (const a of view) {
      const g = a.group || a.title || '未分组'
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(a)
    }
    return Array.from(map.entries())
  }, [view, tab])

  const upload = (files: FileList | null) => {
    if (!files) return
    const arr: File[] = []
    for (let i = 0; i < files.length; i++) arr.push(files[i])
    arr.forEach(f => {
      const isVideo = f.type.startsWith('video/')
      const isImage = f.type.startsWith('image/')
      if (!isVideo && !isImage) return
      const reader = new FileReader()
      reader.onload = () => {
        const url = String(reader.result || '')
        if (dataUrlBytes(url) > 1.6 * 1024 * 1024) {
          onToast(`${f.name} 超过 1.6MB，未加入资源库`)
          return
        }
        onAdd({
          id: 'u' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
          kind: 'upload',
          category: 'upload',
          url,
          title: f.name,
          createdAt: Date.now(),
        })
        onToast('已加入资源库')
      }
      reader.readAsDataURL(f)
    })
  }

  const save = async (a: Asset) => {
    if (a.url.startsWith('data:')) {
      const link = document.createElement('a')
      link.href = a.url
      link.download = a.title || a.id
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      onToast('已开始保存')
      return
    }
    const p = await saveImage(a.url, (a.title || a.id) + '.png')
    onToast(p ? '已保存到 ' + p : '已开始保存')
  }

  const inlineBytes = assets.reduce(
    (n, a) => n + (a.url.startsWith('data:') ? dataUrlBytes(a.url) : 0),
    0,
  )

  const renderCell = (a: Asset) => {
    const realIndex = assets.findIndex(x => x.id === a.id)
    return (
      <div className="lib-card" key={a.id}>
        <button className="lib-card-media" onClick={() => onOpenViewer(realIndex)}>
          {a.kind === 'video' ? (
            <video src={a.url} muted playsInline />
          ) : (
            <Img src={a.thumb || a.url} alt={a.title} />
          )}
        </button>
        <div className="lib-card-meta">
          <b title={a.title}>{a.title}</b>
          <span>
            {CATEGORY_LABEL[assetCategory(a)]}
            {a.group ? ' · ' + a.group : ''}
          </span>
        </div>
        <div className="lib-card-ops">
          <button onClick={() => save(a)} aria-label="保存">
            <IconSave size={13} />
          </button>
          <button onClick={() => onCopy(a.url, '已复制地址')} aria-label="复制地址">
            <IconCopy size={13} />
          </button>
          <button onClick={() => onRemove(a.id)} aria-label="删除">
            <IconTrash size={13} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="libpage" role="dialog" aria-modal="true" aria-label="资源库">
      <div className="libpage-head">
        <h2>资源库</h2>
        <span className="n">{assets.length}</span>
        <div className="spacer" />
        <button className="chip-btn" onClick={() => fileRef.current?.click()}>
          <IconUpload size={14} />
          <span style={{ marginLeft: 6 }}>上传</span>
        </button>
        <button className="icon-btn" onClick={onClose} aria-label="关闭">
          <IconClose />
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*,video/*"
        multiple
        style={{ display: 'none' }}
        onChange={e => {
          upload(e.target.files)
          e.target.value = ''
        }}
      />

      <div className="libpage-tabs">
        {TABS.map(t => (
          <button
            key={t}
            className="cat"
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
          >
            {t === 'all' ? '全部' : CATEGORY_LABEL[t]}
            <span className="n">{counts[t] || 0}</span>
          </button>
        ))}
      </div>

      <div className="libpage-body">
        {assets.length === 0 ? (
          <div className="empty">
            <b>资源库是空的</b>
            <p>生成图片或视频后点「入库」，也可以直接上传本地文件。</p>
            <button className="chip-btn" onClick={() => fileRef.current?.click()}>
              上传文件
            </button>
          </div>
        ) : view.length === 0 ? (
          <div className="empty">
            <b>该分类下还没有资源</b>
            <p>切换其他分类，或先去生成。</p>
          </div>
        ) : tab === 'character' && characterGroups ? (
          characterGroups.map(([g, list]) => (
            <section className="char-group" key={g}>
              <h3>
                {g}
                <span>{list.length} 视图</span>
              </h3>
              <div className="libpage-grid">{list.map(renderCell)}</div>
            </section>
          ))
        ) : (
          <div className="libpage-grid">{view.map(renderCell)}</div>
        )}
      </div>

      <div className="libpage-foot">
        内联数据 {formatBytes(inlineBytes)}（本地存储上限约 5MB）。
        远程链接会过期，长期保存请点「保存」。
      </div>
    </div>
  )
}

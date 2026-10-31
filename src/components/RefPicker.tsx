import { useMemo, useState } from 'react'
import type { CostumeItem, IndexData, PoseItem } from '../types'
import Img from './Img'
import { IconClose, IconSearch } from '../icons'

interface Props {
  data: IndexData
  /** 已选数量，用于限制 */
  selectedCount: number
  max: number
  onPick: (url: string, label: string) => void
  onClose: () => void
}

type Tab = 'costume' | 'pose'

/**
 * 参考图选择器：像首页一样浏览两个库，点卡片即选中。
 * 用 mid / full 图（而不是缩略图），保证生成时有足够细节。
 */
export default function RefPicker({ data, selectedCount, max, onPick, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('costume')
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<string | null>(null)

  const costumes = useMemo(() => {
    const query = q.trim().toLowerCase()
    return data.costume.items.filter(it => {
      if (cat && it.cat !== cat) return false
      if (!query) return true
      const hay = (it.id + ' ' + it.tags.join(' ')).toLowerCase()
      return hay.indexOf(query) >= 0
    })
  }, [data, q, cat])

  const poses = useMemo(() => {
    const query = q.trim().toLowerCase()
    return data.pose.poses.filter(p => {
      if (cat && p.cat !== cat) return false
      if (!query) return true
      const hay = (p.pid + ' ' + p.name + ' ' + p.nameZh).toLowerCase()
      return hay.indexOf(query) >= 0
    })
  }, [data, q, cat])

  const full = selectedCount >= max

  return (
    <div
      className="modal ref-modal"
      role="dialog"
      aria-modal="true"
      aria-label="选择参考图"
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="ref-modal-box">
        <div className="ref-modal-head">
          <h3>选择参考图</h3>
          <span className="n">
            {selectedCount} / {max}
          </span>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onClose} aria-label="关闭">
            <IconClose />
          </button>
        </div>

        <div className="ref-modal-tools">
          <label className="search" style={{ flex: 1 }}>
            <span className="s-icon">
              <IconSearch size={15} />
            </span>
            <input
              value={q}
              placeholder="搜索编号 / 标签 / 姿势名"
              onChange={e => setQ(e.target.value)}
            />
          </label>
          <div className="skill-tabs" style={{ margin: '0 0 0 8px' }}>
            <button
              className="skill-tab"
              aria-pressed={tab === 'costume'}
              onClick={() => {
                setTab('costume')
                setCat(null)
              }}
            >
              服装
            </button>
            <button
              className="skill-tab"
              aria-pressed={tab === 'pose'}
              onClick={() => {
                setTab('pose')
                setCat(null)
              }}
            >
              姿势
            </button>
          </div>
        </div>

        <div className="ref-modal-cats">
          <button className="cat" aria-pressed={cat === null} onClick={() => setCat(null)}>
            全部
          </button>
          {(tab === 'costume' ? data.costume.cats : data.pose.cats).map(c => (
            <button
              key={c.slug}
              className="cat"
              aria-pressed={cat === c.slug}
              onClick={() => setCat(cat === c.slug ? null : c.slug)}
            >
              {c.zh}
            </button>
          ))}
        </div>

        <div className="ref-modal-body">
          {tab === 'costume' ? (
            <div className="ref-modal-grid">
              {costumes.slice(0, 240).map(it => (
                <button
                  key={it.id}
                  className="ref-pick"
                  disabled={full}
                  title={`${it.id} · ${it.tags.slice(0, 4).join(', ')}`}
                  onClick={() => onPick(it.mid, (it as CostumeItem).id)}
                >
                  <Img src={it.thumb} alt={it.id} />
                  <span>{it.id}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="ref-modal-grid">
              {poses.slice(0, 240).map(p => {
                const v = (p as PoseItem).views[0]
                return (
                  <button
                    key={p.id}
                    className="ref-pick"
                    disabled={full}
                    title={`${p.pid} · ${p.nameZh}`}
                    onClick={() => onPick(v.full, `${p.pid} ${v.nameZh}`)}
                  >
                    <Img src={v.thumb} alt={p.pid} />
                    <span>{p.pid}</span>
                  </button>
                )
              })}
            </div>
          )}
          {full && <p className="set-hint">已达上限，先移除一张再选。</p>}
        </div>
      </div>
    </div>
  )
}

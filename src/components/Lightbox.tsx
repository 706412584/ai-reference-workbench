import { useEffect, useRef, useState } from 'react'
import type { CostumeItem, PoseItem } from '../types'
import Img from './Img'
import { imageFilename } from '../native'
import { absUrl, costumeRef, poseRef } from '../refs'
import {
  IconBag,
  IconChevronL,
  IconChevronR,
  IconClose,
  IconCopy,
  IconSave,
  IconSpark,
  IconStar,
} from '../icons'

interface CostumeProps {
  kind: 'costume'
  item: CostumeItem
  catName: string
  tagLabel: (t: string) => string
  index: number
  total: number
  faved: boolean
  onClose: () => void
  onPrev: () => void
  onNext: () => void
  onFav: () => void
  onBag: () => void
  onTag: (t: string) => void
  onToast: (m: string) => void
  onCopy: (text: string, okMsg: string) => void
  onSave: (path: string, name: string) => void
  onGenerate: (url: string, prompt: string) => void
}

interface PoseProps {
  kind: 'pose'
  pose: PoseItem
  ang: string
  catName: string
  seriesName: string
  angLabel: (a: string) => string
  index: number
  total: number
  faved: boolean
  onClose: () => void
  onPrev: () => void
  onNext: () => void
  onFav: (ang: string) => void
  onBag: (ang: string) => void
  onAng: (ang: string) => void
  onToast: (m: string) => void
  onCopy: (text: string, okMsg: string) => void
  onSave: (path: string, name: string) => void
  onGenerate: (url: string, prompt: string) => void
}

type Props = CostumeProps | PoseProps

export default function Lightbox(props: Props) {
  const { onClose, onPrev, onNext, onCopy, onSave, onGenerate } = props
  const [fullSrc, setFullSrc] = useState<string | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const touch = useRef<number | null>(null)

  const view =
    props.kind === 'costume'
      ? { thumb: props.item.thumb, mid: props.item.mid, full: props.item.mid }
      : (() => {
          const v = props.pose.views.find(x => x.ang === props.ang) || props.pose.views[0]
          return { thumb: v.thumb, mid: v.thumb, full: v.full }
        })()

  // 换图时清空大图
  useEffect(() => {
    setFullSrc(null)
    let alive = true
    const img = new Image()
    img.onload = () => {
      if (alive) setFullSrc(img.src)
    }
    img.src = view.full
    return () => {
      alive = false
    }
  }, [view.full])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        onPrev()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        onNext()
      }
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose, onPrev, onNext])

  useEffect(() => {
    if (boxRef.current) boxRef.current.focus()
  }, [])

  const single = props.total < 2

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label="大图"
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal-box" ref={boxRef} tabIndex={-1}>
        <div
          className="modal-img"
          onTouchStart={e => {
            touch.current = e.touches[0].clientX
          }}
          onTouchEnd={e => {
            if (touch.current == null) return
            const dx = e.changedTouches[0].clientX - touch.current
            touch.current = null
            if (Math.abs(dx) > 45) {
              if (dx < 0) onNext()
              else onPrev()
            }
          }}
        >
          <Img src={fullSrc || view.mid} alt="" eager />
          {!single && (
            <button className="nav l" onClick={onPrev} aria-label="上一张">
              <IconChevronL size={20} />
            </button>
          )}
          {!single && (
            <button className="nav r" onClick={onNext} aria-label="下一张">
              <IconChevronR size={20} />
            </button>
          )}
          <button className="modal-close" onClick={onClose} aria-label="关闭">
            <IconClose size={17} />
          </button>
        </div>

        <div className="modal-side">
          {props.kind === 'costume' ? (
            <>
              <h3>{props.item.id}</h3>
              <div className="sub">
                {props.catName} · {props.index + 1} / {props.total}
              </div>
              <dl className="kv">
                <div className="r">
                  <dt>分类</dt>
                  <dd>{props.catName}</dd>
                </div>
                <div className="r">
                  <dt>标签</dt>
                  <dd>{props.item.tags.length}</dd>
                </div>
              </dl>
              <p className="side-label">标签</p>
              <div className="chips">
                {props.item.tags.map(t => (
                  <button key={t} className="chip" title={t} onClick={() => props.onTag(t)}>
                    {props.tagLabel(t)}
                  </button>
                ))}
              </div>
              <div style={{ height: 16 }} />
              <div className="side-actions">
                <button className="primary" onClick={props.onFav}>
                  <IconStar size={14} filled={props.faved} /> {props.faved ? '已收藏' : '收藏'}
                </button>
                <button onClick={props.onBag}>
                  <IconBag size={14} /> 加入提示词袋
                </button>
                <button
                  onClick={() => onSave(props.item.mid, imageFilename(props.item.id))}
                >
                  <IconSave size={14} /> 保存图片
                </button>
                <button onClick={() => onCopy(costumeRef(props.item), '已复制引用')}>
                  <IconCopy size={14} /> 复制引用
                </button>
                <button onClick={() => onCopy(absUrl(props.item.mid), '已复制图片地址')}>
                  <IconCopy size={14} /> 复制图片地址
                </button>
                <button
                  onClick={() => onCopy(props.item.tags.join(', '), '已复制标签')}
                >
                  <IconCopy size={14} /> 复制标签
                </button>
                <button onClick={() => onGenerate(props.item.mid, props.item.tags.join(', '))}>
                  <IconSpark size={14} /> 以此图生成
                </button>
              </div>
            </>
          ) : (
            <>
              <h3>{props.pose.nameZh}</h3>
              <div className="sub">
                {props.pose.pid} · {props.angLabel(props.ang)} · {props.index + 1} / {props.total}
              </div>
              <dl className="kv">
                <div className="r">
                  <dt>系列</dt>
                  <dd>{props.seriesName}</dd>
                </div>
                <div className="r">
                  <dt>分类</dt>
                  <dd>{props.catName}</dd>
                </div>
                <div className="r">
                  <dt>视角</dt>
                  <dd>{props.pose.views.length}</dd>
                </div>
              </dl>
              <p className="side-label">视角</p>
              <div className="modal-views">
                {props.pose.views.map(v => (
                  <button
                    key={v.ang}
                    className={v.ang === props.ang ? 'on' : ''}
                    aria-pressed={v.ang === props.ang}
                    title={props.angLabel(v.ang)}
                    onClick={() => props.onAng(v.ang)}
                  >
                    <Img src={v.thumb} alt="" />
                  </button>
                ))}
              </div>
              <div className="side-actions">
                <button className="primary" onClick={() => props.onFav(props.ang)}>
                  <IconStar size={14} filled={props.faved} /> {props.faved ? '已收藏' : '收藏'}
                </button>
                <button onClick={() => props.onBag(props.ang)}>
                  <IconBag size={14} /> 加入提示词袋
                </button>
                <button
                  onClick={() => {
                    const v = props.pose.views.find(x => x.ang === props.ang) || props.pose.views[0]
                    onSave(v.full, imageFilename(`${props.pose.pid}_${props.ang}`))
                  }}
                >
                  <IconSave size={14} /> 保存图片
                </button>
                <button
                  onClick={() =>
                    onCopy(
                      poseRef(
                        props.pose,
                        props.ang,
                        view.full.indexOf('/pose-line/') >= 0 ? 'line' : 'depth',
                      ),
                      '已复制引用',
                    )
                  }
                >
                  <IconCopy size={14} /> 复制引用
                </button>
                <button
                  onClick={() => {
                    const v = props.pose.views.find(x => x.ang === props.ang) || props.pose.views[0]
                    onCopy(absUrl(v.full), '已复制图片地址')
                  }}
                >
                  <IconCopy size={14} /> 复制图片地址
                </button>
                <button
                  onClick={() => {
                    const v = props.pose.views.find(x => x.ang === props.ang) || props.pose.views[0]
                    onGenerate(v.full, `${props.pose.nameZh} · ${props.angLabel(props.ang)}`)
                  }}
                >
                  <IconSpark size={14} /> 以此图生成
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

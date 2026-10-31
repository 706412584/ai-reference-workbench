import { useEffect, useRef, useState } from 'react'
import { IconClose, IconCopy, IconSave, IconTrash } from '../icons'
import type { Asset } from '../library'

interface Props {
  assets: Asset[]
  index: number
  onClose: () => void
  onPrev: () => void
  onNext: () => void
  onSave: (a: Asset) => void
  onCopy: (text: string, okMsg: string) => void
  onDelete: (id: string) => void
}

const MIN_SCALE = 1
const MAX_SCALE = 6

/** 全屏预览：滚轮 / 双指缩放，拖拽平移。 */
export default function AssetViewer({
  assets,
  index,
  onClose,
  onPrev,
  onNext,
  onSave,
  onCopy,
  onDelete,
}: Props) {
  const a = assets[index]
  const [scale, setScale] = useState(1)
  const [tx, setTx] = useState(0)
  const [ty, setTy] = useState(0)
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)
  const pinch = useRef<{ dist: number; scale: number } | null>(null)

  useEffect(() => {
    setScale(1)
    setTx(0)
    setTy(0)
  }, [index])

  const stageRef = useRef<HTMLDivElement | null>(null)

  // React 的 wheel 监听是 passive，preventDefault 无效，这里手动注册
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      setScale(s => {
        const n = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * (e.deltaY < 0 ? 1.12 : 0.89)))
        if (n === 1) {
          setTx(0)
          setTy(0)
        }
        return n
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') onPrev()
      else if (e.key === 'ArrowRight') onNext()
      else if (e.key === '+' || e.key === '=') zoom(1.25)
      else if (e.key === '-') zoom(0.8)
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose, onPrev, onNext])

  const zoom = (f: number) => {
    setScale(s => {
      const n = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * f))
      if (n === 1) {
        setTx(0)
        setTy(0)
      }
      return n
    })
  }

  if (!a) return null

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label="图片预览">
      <div className="viewer-top">
        <span className="viewer-title">{a.title}</span>
        <span className="viewer-meta">
          {index + 1} / {assets.length} · {Math.round(scale * 100)}%
        </span>
        <button className="icon-btn" onClick={onClose} aria-label="关闭">
          <IconClose />
        </button>
      </div>

      <div
        ref={stageRef}
        className="viewer-stage"
        onClick={e => {
          if (e.target === e.currentTarget) onClose()
        }}
        onDoubleClick={() => {
          if (scale > 1) {
            setScale(1)
            setTx(0)
            setTy(0)
          } else zoom(2)
        }}
        onMouseDown={e => {
          if (scale <= 1) return
          drag.current = { x: e.clientX, y: e.clientY, tx, ty }
        }}
        onMouseMove={e => {
          const d = drag.current
          if (!d) return
          setTx(d.tx + (e.clientX - d.x))
          setTy(d.ty + (e.clientY - d.y))
        }}
        onMouseUp={() => {
          drag.current = null
        }}
        onMouseLeave={() => {
          drag.current = null
        }}
        onTouchStart={e => {
          if (e.touches.length === 2) {
            const [p1, p2] = [e.touches[0], e.touches[1]]
            pinch.current = {
              dist: Math.hypot(p1.clientX - p2.clientX, p1.clientY - p2.clientY),
              scale,
            }
          } else if (e.touches.length === 1 && scale > 1) {
            drag.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, tx, ty }
          }
        }}
        onTouchMove={e => {
          if (e.touches.length === 2 && pinch.current) {
            const [p1, p2] = [e.touches[0], e.touches[1]]
            const d = Math.hypot(p1.clientX - p2.clientX, p1.clientY - p2.clientY)
            const n = Math.min(MAX_SCALE, Math.max(MIN_SCALE, (pinch.current.scale * d) / pinch.current.dist))
            setScale(n)
            if (n === 1) {
              setTx(0)
              setTy(0)
            }
          } else if (e.touches.length === 1 && drag.current) {
            setTx(drag.current.tx + (e.touches[0].clientX - drag.current.x))
            setTy(drag.current.ty + (e.touches[0].clientY - drag.current.y))
          }
        }}
        onTouchEnd={() => {
          pinch.current = null
          drag.current = null
        }}
      >
        {a.kind === 'video' ? (
          <video src={a.url} controls autoPlay playsInline className="viewer-media" />
        ) : (
          <img
            src={a.url}
            alt={a.title}
            className="viewer-media"
            style={{
              transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
              cursor: scale > 1 ? 'grab' : 'zoom-in',
            }}
            draggable={false}
          />
        )}

        {assets.length > 1 && (
          <>
            <button
              className="nav l"
              onClick={e => {
                e.stopPropagation()
                onPrev()
              }}
              aria-label="上一张"
            >
              ‹
            </button>
            <button
              className="nav r"
              onClick={e => {
                e.stopPropagation()
                onNext()
              }}
              aria-label="下一张"
            >
              ›
            </button>
          </>
        )}
      </div>

      <div className="viewer-bottom">
        <button onClick={() => zoom(1.25)}>放大</button>
        <button onClick={() => zoom(0.8)}>缩小</button>
        <button
          onClick={() => {
            setScale(1)
            setTx(0)
            setTy(0)
          }}
        >
          复位
        </button>
        <button onClick={() => onSave(a)}>
          <IconSave size={13} /> 保存
        </button>
        <button onClick={() => onCopy(a.url, '已复制地址')}>
          <IconCopy size={13} /> 地址
        </button>
        <button onClick={() => onDelete(a.id)}>
          <IconTrash size={13} /> 删除
        </button>
      </div>

      {a.prompt && <div className="viewer-prompt">{a.prompt}</div>}
    </div>
  )
}

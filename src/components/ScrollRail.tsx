import { useCallback, useEffect, useRef, useState } from 'react'

interface Props {
  /** 滚动容器；不传则监听 window */
  targetRef?: React.RefObject<HTMLElement | null>
  /** 隐藏延时（毫秒） */
  hideDelay?: number
}

interface Metrics {
  top: number
  left: number
  height: number
  width: number
  progress: number
}

const RAIL_INSET = 8

/**
 * 快速滚动条：滚动/滑动手势触发后显示，静止数秒后淡出。
 * 可拖动滑块；点击轨道跳转。兼容 WebView 81（不用 gap / inset）。
 */
export default function ScrollRail({ targetRef, hideDelay = 1400 }: Props) {
  const [visible, setVisible] = useState(false)
  const [m, setM] = useState<Metrics | null>(null)
  const [dragging, setDragging] = useState(false)
  const hideTimer = useRef<number | null>(null)
  const dragState = useRef<{ startY: number; startScroll: number; ratio: number } | null>(null)

  const measure = useCallback(() => {
    const el = targetRef?.current
    const scrollTop = el ? el.scrollTop : window.scrollY
    const scrollHeight = el ? el.scrollHeight : document.documentElement.scrollHeight
    const clientHeight = el ? el.clientHeight : window.innerHeight
    const max = scrollHeight - clientHeight
    if (max <= 4) {
      setM(null)
      return
    }
    const ratio = clientHeight / scrollHeight
    const height = Math.max(36, Math.round(clientHeight * ratio))
    const progress = Math.min(1, Math.max(0, scrollTop / max))
    let left: number
    if (el) {
      const r = el.getBoundingClientRect()
      left = r.right - RAIL_INSET - 6
    } else {
      left = window.innerWidth - RAIL_INSET - 6
    }
    setM({ top: 0, left, height, width: 6, progress })
  }, [targetRef])

  const reveal = useCallback(() => {
    measure()
    setVisible(true)
    if (hideTimer.current) window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => {
      if (!dragState.current) setVisible(false)
    }, hideDelay)
  }, [measure, hideDelay])

  useEffect(() => {
    const el = targetRef?.current
    const onScroll = () => reveal()
    const onTouch = () => reveal()
    const onWheel = () => reveal()
    const onResize = () => measure()

    const scrollTarget: EventTarget = el || window
    scrollTarget.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('touchmove', onTouch, { passive: true })
    window.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('resize', onResize)

    return () => {
      scrollTarget.removeEventListener('scroll', onScroll)
      window.removeEventListener('touchmove', onTouch)
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('resize', onResize)
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
    }
  }, [targetRef, reveal, measure])

  // 拖动
  useEffect(() => {
    if (!dragging) return

    const onMove = (e: MouseEvent | TouchEvent) => {
      const st = dragState.current
      if (!st) return
      const y = 'touches' in e ? e.touches[0].clientY : e.clientY
      const dy = y - st.startY
      const el = targetRef?.current
      const scrollHeight = el ? el.scrollHeight : document.documentElement.scrollHeight
      const clientHeight = el ? el.clientHeight : window.innerHeight
      const max = scrollHeight - clientHeight
      const target = st.startScroll + dy / st.ratio
      const next = Math.min(max, Math.max(0, target))
      if (el) el.scrollTop = next
      else window.scrollTo(0, next)
    }

    const onUp = () => {
      dragState.current = null
      setDragging(false)
      reveal()
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchmove', onMove, { passive: true })
    window.addEventListener('touchend', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('touchmove', onMove)
      window.removeEventListener('touchend', onUp)
    }
  }, [dragging, targetRef, reveal])

  if (!m) return null

  const travel = window.innerHeight - m.height - RAIL_INSET * 2
  const thumbTop = RAIL_INSET + m.progress * travel
  const el = targetRef?.current
  const scrollHeight = el ? el.scrollHeight : document.documentElement.scrollHeight
  const clientHeight = el ? el.clientHeight : window.innerHeight
  const ratio = clientHeight / scrollHeight

  return (
    <div
      className={'rail' + (visible || dragging ? ' on' : '')}
      style={{ left: m.left, width: m.width }}
      aria-hidden
    >
      <div
        className="rail-thumb"
        style={{ top: thumbTop, height: m.height }}
        onMouseDown={e => {
          e.preventDefault()
          dragState.current = {
            startY: e.clientY,
            startScroll: el ? el.scrollTop : window.scrollY,
            ratio,
          }
          setDragging(true)
          reveal()
        }}
        onTouchStart={e => {
          dragState.current = {
            startY: e.touches[0].clientY,
            startScroll: el ? el.scrollTop : window.scrollY,
            ratio,
          }
          setDragging(true)
          reveal()
        }}
      />
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { IconChevronDown } from '../icons'

interface Props {
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
  disabled?: boolean
  ariaLabel?: string
}

/**
 * 自定义下拉。
 * 原生 <select> 的弹窗在 Android WebView 81 上由系统绘制，不读 option 的 CSS，
 * 深色模式下会出现白底白字。这里用普通 DOM 实现，样式完全可控。
 */
export default function Select({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const current = options.find(o => o.value === value)

  return (
    <div className={'sel' + (open ? ' open' : '') + (disabled ? ' disabled' : '')} ref={boxRef}>
      <button
        type="button"
        className="sel-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
      >
        <span className="sel-label">{current ? current.label : value || '请选择'}</span>
        <IconChevronDown size={14} />
      </button>

      {open && (
        <div className="sel-menu" role="listbox">
          {options.map(o => (
            <button
              key={o.value}
              type="button"
              role="option"
              aria-selected={o.value === value}
              className={'sel-opt' + (o.value === value ? ' on' : '')}
              onClick={() => {
                onChange(o.value)
                setOpen(false)
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

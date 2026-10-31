import { useEffect, type ReactNode } from 'react'
import { IconClose } from '../icons'

interface Props {
  title: string
  count?: number
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}

export default function Drawer({ title, count, onClose, children, footer }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title}>
        <div className="drawer-head">
          <h3>{title}</h3>
          {count != null && <span className="n">{count}</span>}
          <button
            className="icon-btn"
            style={{ marginLeft: 'auto' }}
            onClick={onClose}
            aria-label="关闭"
          >
            <IconClose />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </aside>
    </>
  )
}

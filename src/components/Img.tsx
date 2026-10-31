import { useEffect, useRef, useState } from 'react'

interface Props {
  src: string
  alt: string
  className?: string
  eager?: boolean
  style?: React.CSSProperties
}

/**
 * 渐进淡入图片。
 * 已缓存图片不会触发 onLoad，用 ref 在挂载时检查 complete。
 */
export default function Img({ src, alt, className, eager, style }: Props) {
  const ref = useRef<HTMLImageElement | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setLoaded(false)
    const el = ref.current
    if (el && el.complete && el.naturalWidth > 0) {
      setLoaded(true)
    }
  }, [src])

  return (
    <img
      ref={ref}
      src={src}
      alt={alt}
      style={style}
      className={[className, loaded ? 'ld' : ''].filter(Boolean).join(' ')}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={() => setLoaded(true)}
    />
  )
}

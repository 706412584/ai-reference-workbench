import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FavRef, PromptBagItem } from './types'

/* ── 通用 localStorage hook（Android WebView 81 支持） ── */

export function usePersisted<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw != null) return JSON.parse(raw) as T
    } catch {
      /* 隐私模式 / 存储满：回退到内存 */
    }
    return initial
  })

  // 当前值的序列化副本，用于识别「自己广播的」事件。
  // 不能只靠 setValue 的引用比较：JSON.parse 每次都产生新对象，
  // 若自身监听器也 setValue，就会 写入→广播→setValue→写入 无限自激。
  const rawRef = useRef<string | null>(null)
  rawRef.current = JSON.stringify(value)

  // 同页多实例同步：本实例写入后广播，其他实例据此更新
  useEffect(() => {
    const onSync = (e: Event) => {
      const detail = (e as CustomEvent).detail as { key: string; value: string }
      if (!detail || detail.key !== key) return
      // 自己刚写出去的值，直接忽略（否则自激循环）
      if (detail.value === rawRef.current) return
      try {
        setValue(JSON.parse(detail.value) as T)
      } catch {
        /* 忽略非法负载 */
      }
    }
    window.addEventListener('wb:sync', onSync)
    return () => window.removeEventListener('wb:sync', onSync)
  }, [key, setValue])

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value))
      window.dispatchEvent(
        new CustomEvent('wb:sync', { detail: { key, value: JSON.stringify(value) } }),
      )
    } catch {
      // 配额超限：通知上层，避免用户以为已保存
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('wb:storage-full', { detail: key }))
      }
    }
  }, [key, value])

  return [value, setValue] as const
}

/* ── 主题 ── */

export type Theme = 'light' | 'dark'

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    const cur = document.documentElement.getAttribute('data-theme')
    return cur === 'dark' ? 'dark' : 'light'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      localStorage.setItem('wb.theme', theme)
    } catch {
      /* 忽略 */
    }
  }, [theme])

  const toggle = useCallback(() => {
    setTheme(t => (t === 'dark' ? 'light' : 'dark'))
  }, [])

  return { theme, setTheme, toggle }
}

/* ── 收藏 ── */

const favKey = (f: FavRef) => `${f.kind}:${f.id}${f.ang ? ':' + f.ang : ''}`

export function useFavorites() {
  const [list, setList] = usePersisted<FavRef[]>('wb.favs', [])
  const set = useMemo(() => {
    const s = new Set<string>()
    for (const f of list) s.add(favKey(f))
    return s
  }, [list])

  const has = useCallback((f: FavRef) => set.has(favKey(f)), [set])

  const toggle = useCallback(
    (f: FavRef) => {
      const k = favKey(f)
      setList(prev => {
        if (prev.some(x => favKey(x) === k)) {
          return prev.filter(x => favKey(x) !== k)
        }
        return [f, ...prev]
      })
    },
    [setList],
  )

  const remove = useCallback(
    (f: FavRef) => {
      const k = favKey(f)
      setList(prev => prev.filter(x => favKey(x) !== k))
    },
    [setList],
  )

  const clear = useCallback(() => setList([]), [setList])

  return { list, has, toggle, remove, clear }
}

/* ── 提示词袋 ── */

export function usePromptBag() {
  const [items, setItems] = usePersisted<PromptBagItem[]>('wb.bag', [])

  const add = useCallback(
    (item: PromptBagItem) => {
      setItems(prev => {
        const k = `${item.kind}:${item.id}:${item.ang || ''}`
        if (prev.some(x => `${x.kind}:${x.id}:${x.ang || ''}` === k)) return prev
        return [item, ...prev]
      })
    },
    [setItems],
  )

  const remove = useCallback(
    (item: PromptBagItem) => {
      setItems(prev =>
        prev.filter(x => `${x.kind}:${x.id}:${x.ang || ''}` !== `${item.kind}:${item.id}:${item.ang || ''}`),
      )
    },
    [setItems],
  )

  const clear = useCallback(() => setItems([]), [setItems])

  return { items, add, remove, clear }
}

/* ── Toast ── */

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  const show = useCallback((text: string, ms = 1600) => {
    setMsg(text)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMsg(null), ms)
  }, [])

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [])

  return { msg, show }
}

/* ── 剪贴板（WebView 需要回退） ── */

export function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => fallbackCopy(text),
    )
  }
  return Promise.resolve(fallbackCopy(text))
}

function fallbackCopy(text: string): boolean {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/* ── 下载/保存文件 ── */

export function saveFile(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

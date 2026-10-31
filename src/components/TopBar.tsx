import { useEffect, useRef, useState } from 'react'
import type { Library } from '../types'
import type { Theme } from '../store'
import {
  IconBag,
  IconCompare,
  IconMoon,
  IconLibrary,
  IconMore,
  IconPrompt,
  IconSettings,
  IconSpark,
  IconStar,
  IconSun,
} from '../icons'

interface Props {
  lib: Library
  onLib: (l: Library) => void
  costumeCount: number
  poseCount: number
  theme: Theme
  onTheme: () => void
  favCount: number
  bagCount: number
  onFavs: () => void
  onBag: () => void
  onCompare: () => void
  onPrompts: () => void
  promptCount: number
  onSettings: () => void
  onGenerate: () => void
  onLibrary: () => void
  libraryCount: number
}

export default function TopBar({
  lib,
  onLib,
  costumeCount,
  poseCount,
  theme,
  onTheme,
  favCount,
  bagCount,
  onFavs,
  onBag,
  onCompare,
  onPrompts,
  promptCount,
  onSettings,
  onGenerate,
  onLibrary,
  libraryCount,
}: Props) {
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement | null>(null)

  // 点击外部 / Esc 关闭菜单
  useEffect(() => {
    if (!moreOpen) return
    const onDown = (e: MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [moreOpen])

  const pick = (fn: () => void) => () => {
    setMoreOpen(false)
    fn()
  }

  return (
    <div className="topbar">
      <div className="wrap topbar-in">
        <div className="brand">
          <b>参考工作台</b>
          <span>LOCAL</span>
        </div>

        <div className="libs" role="tablist" aria-label="素材库">
          <button
            className="lib-tab"
            role="tab"
            aria-selected={lib === 'costume'}
            onClick={() => onLib('costume')}
          >
            服装<span className="n">{costumeCount}</span>
          </button>
          <button
            className="lib-tab"
            role="tab"
            aria-selected={lib === 'pose'}
            onClick={() => onLib('pose')}
          >
            姿势<span className="n">{poseCount}</span>
          </button>
        </div>

        <div className="top-actions">
          {/* 常驻：生成 / 资源库 / 主题 */}
          <button className="icon-btn" onClick={onGenerate} title="生成" aria-label="生成">
            <IconSpark />
          </button>
          <button className="icon-btn" onClick={onLibrary} title="资源库" aria-label="资源库">
            <IconLibrary />
            {libraryCount > 0 && (
              <span className="badge">{libraryCount > 99 ? '99+' : libraryCount}</span>
            )}
          </button>
          <button
            className="icon-btn"
            onClick={onTheme}
            title={theme === 'dark' ? '切换到浅色' : '切换到深色'}
            aria-label={theme === 'dark' ? '切换到浅色' : '切换到深色'}
          >
            {theme === 'dark' ? <IconSun /> : <IconMoon />}
          </button>

          {/* 其余收进菜单 */}
          <div className="more-wrap" ref={moreRef}>
            <button
              className={'icon-btn' + (moreOpen ? ' on' : '')}
              onClick={() => setMoreOpen(o => !o)}
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              title="更多"
              aria-label="更多"
            >
              <IconMore />
            </button>

            {moreOpen && (
              <div className="more-menu" role="menu">
                <button role="menuitem" onClick={pick(onPrompts)}>
                  <IconPrompt size={16} />
                  <span>提示词</span>
                  {promptCount > 0 && <b>{promptCount > 99 ? '99+' : promptCount}</b>}
                </button>
                <button role="menuitem" onClick={pick(onBag)}>
                  <IconBag size={16} />
                  <span>提示词袋</span>
                  {bagCount > 0 && <b>{bagCount > 99 ? '99+' : bagCount}</b>}
                </button>
                <button role="menuitem" onClick={pick(onFavs)}>
                  <IconStar size={16} />
                  <span>收藏</span>
                  {favCount > 0 && <b>{favCount > 99 ? '99+' : favCount}</b>}
                </button>
                <button role="menuitem" onClick={pick(onCompare)}>
                  <IconCompare size={16} />
                  <span>并排对比</span>
                </button>
                <button role="menuitem" onClick={pick(onSettings)}>
                  <IconSettings size={16} />
                  <span>设置</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

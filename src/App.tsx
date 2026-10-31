import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CostumeItem,
  IndexData,
  Library,
  PoseItem,
  PromptBagItem,
} from './types'
import { useData } from './useData'
import {
  copyText,
  saveFile,
  useFavorites,
  usePromptBag,
  useTheme,
  useToast,
} from './store'
import TopBar from './components/TopBar'
import Toolbar from './components/Toolbar'
import CostumeCard from './components/CostumeCard'
import PoseCard from './components/PoseCard'
import Lightbox from './components/Lightbox'
import Drawer from './components/Drawer'
import ScrollRail from './components/ScrollRail'
import PromptStudio, { usePromptsCount } from './components/PromptStudio'
import { hasNative, saveImage } from './native'
import { useSkills } from './skills'
import { useSettings } from './settings'
import SettingsPanel from './components/SettingsPanel'
import GenerateStudio from './components/GenerateStudio'
import ProviderPanel from './components/ProviderPanel'
import LibraryPanel from './components/LibraryPanel'
import CharacterCard from './components/CharacterCard'
import AssetViewer from './components/AssetViewer'
import { useProviders } from './providers'
import { useLibrary } from './library'
import Img from './components/Img'
import { IconTrash } from './icons'

const PAGE_COSTUME = 120
const PAGE_POSE = 60

type Overlay =
  | { kind: 'none' }
  | { kind: 'favs' }
  | { kind: 'bag' }
  | { kind: 'compare' }
  | { kind: 'prompts' }
  | { kind: 'settings' }
  | { kind: 'generate' }
  | { kind: 'providers' }
  | { kind: 'library' }
  | { kind: 'character' }

interface LightboxState {
  lib: Library
  id: string
  ang?: string
}

export default function App() {
  const { data, error } = useData()
  const { theme, toggle } = useTheme()
  const favs = useFavorites()
  const [promptCount] = usePromptsCount()
  const [settings, setSettings] = useSettings()
  const skills = useSkills()
  const [providers, setProviders] = useProviders()
  const [library, setLibrary] = useLibrary()
  const [genSeed, setGenSeed] = useState<{ url: string; prompt: string; nonce: number } | null>(null)
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const bag = usePromptBag()
  const toast = useToast()

  // 本地存储写满时明确提示（否则资源库会静默丢数据）
  useEffect(() => {
    const onFull = () => toast.show('本地存储已满，本次改动未保存')
    window.addEventListener('wb:storage-full', onFull)
    return () => window.removeEventListener('wb:storage-full', onFull)
  }, [toast])

  const [lib, setLib] = useState<Library>('costume')
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState<string | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [series, setSeries] = useState<string | null>(null)
  const [ang, setAng] = useState<string | null>(null)
  const [facetOpen, setFacetOpen] = useState(false)
  const [limit, setLimit] = useState(PAGE_COSTUME)
  const [overlay, setOverlay] = useState<Overlay>({ kind: 'none' })
  const [lightbox, setLightbox] = useState<LightboxState | null>(null)
  const sentinel = useRef<HTMLDivElement | null>(null)

  /* ── 派生数据 ── */

  const costumeCatName = useCallback(
    (slug: string) => {
      const c = data?.costume.cats.find(x => x.slug === slug)
      return c ? c.zh : slug
    },
    [data],
  )

  const poseCatName = useCallback(
    (slug: string) => {
      const c = data?.pose.cats.find(x => x.slug === slug)
      return c ? c.zh : slug
    },
    [data],
  )

  const poseSeriesName = useCallback(
    (slug: string) => {
      const s = data?.pose.series.find(x => x.slug === slug)
      return s ? s.zh : slug
    },
    [data],
  )

  const tagLabel = useCallback(
    (t: string) => {
      if (!data) return t
      return data.costume.tagZh[t] || t
    },
    [data],
  )

  const angLabel = useCallback(
    (a: string) => {
      if (!data) return a
      return data.pose.angZh[a] || a
    },
    [data],
  )

  /* ── 过滤 ── */

  const hiddenCats = useMemo(() => {
    if (!settings.hideAdult) return new Set<string>()
    const s = new Set<string>()
    for (const c of data?.costume.cats || []) {
      if (c.ja === 'ランジェリー' || c.ja === 'セクシー') s.add(c.slug)
    }
    return s
  }, [data, settings.hideAdult])

  const costumeView = useMemo(() => {
    if (!data) return [] as CostumeItem[]
    const q = query.trim().toLowerCase()
    const tagSet = new Set(tags)
    return data.costume.items.filter(it => {
      if (hiddenCats.has(it.cat)) return false
      if (cat && it.cat !== cat) return false
      if (tagSet.size) {
        for (const t of tagSet) if (it.tags.indexOf(t) < 0) return false
      }
      if (q) {
        const hay =
          it.id.toLowerCase() +
          ' ' +
          costumeCatName(it.cat).toLowerCase() +
          ' ' +
          it.tags.join(' ').toLowerCase() +
          ' ' +
          it.tags.map(tagLabel).join(' ').toLowerCase()
        if (hay.indexOf(q) < 0) return false
      }
      return true
    })
  }, [data, query, cat, tags, costumeCatName, tagLabel, hiddenCats])

  const poseView = useMemo(() => {
    if (!data) return [] as PoseItem[]
    const q = query.trim().toLowerCase()
    return data.pose.poses.filter(p => {
      if (series && p.series !== series) return false
      if (cat && p.cat !== cat) return false
      if (ang && !p.views.some(v => v.ang === ang)) return false
      if (q) {
        const hay = [
          p.pid,
          p.name,
          p.nameZh,
          poseSeriesName(p.series),
          poseCatName(p.cat),
        ]
          .join(' ')
          .toLowerCase()
        if (hay.indexOf(q) < 0) return false
      }
      return true
    })
  }, [data, query, cat, series, ang, poseSeriesName, poseCatName])

  const view = lib === 'costume' ? costumeView : poseView
  const pageSize = lib === 'costume' ? PAGE_COSTUME : PAGE_POSE
  const shown = view.slice(0, limit)

  // 筛选条件变化时回到第一页
  useEffect(() => {
    setLimit(lib === 'costume' ? PAGE_COSTUME : PAGE_POSE)
  }, [lib, query, cat, tags, series, ang])

  // 滚动到底自动加载
  useEffect(() => {
    const el = sentinel.current
    if (!el || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          setLimit(l => (l < view.length ? Math.min(l + pageSize, view.length) : l))
        }
      },
      { rootMargin: '900px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [view.length, pageSize])

  /* ── 收藏 ── */

  const costumeFav = useCallback(
    (id: string) => favs.has({ kind: 'costume', id }),
    [favs],
  )

  const poseFav = useCallback(
    (id: string, angCode: string) => favs.has({ kind: 'pose', id, ang: angCode }),
    [favs],
  )

  const toggleCostumeFav = useCallback(
    (id: string) => favs.toggle({ kind: 'costume', id }),
    [favs],
  )

  const togglePoseFav = useCallback(
    (id: string, angCode: string) => favs.toggle({ kind: 'pose', id, ang: angCode }),
    [favs],
  )

  /* ── 灯箱导航 ── */

  const lbIndex = useMemo(() => {
    if (!lightbox) return -1
    const i = view.findIndex(v =>
      (lightbox.lib === 'costume' ? (v as CostumeItem).id : (v as PoseItem).id) === lightbox.id,
    )
    if (i >= 0) return i
    // 筛选后原条目可能不在结果里：用全库索引兜底，保证灯箱仍可翻页
    return -1
  }, [lightbox, view])

  // 灯箱当前条目若已不在筛选结果中，用全库列表兜底
  const lbList = useMemo(() => {
    if (!lightbox) return view
    if (lbIndex >= 0) return view
    return lightbox.lib === 'costume'
      ? (data?.costume.items as unknown as typeof view)
      : (data?.pose.poses as unknown as typeof view)
  }, [lightbox, lbIndex, view, data])

  const stepLightbox = useCallback(
    (delta: number) => {
      if (!lightbox || lbList.length < 2) return
      const base = lbIndex >= 0 ? lbIndex : lbList.findIndex(v =>
        (lightbox.lib === 'costume' ? (v as CostumeItem).id : (v as PoseItem).id) === lightbox.id,
      )
      const from = base >= 0 ? base : 0
      const next = (from + delta + lbList.length) % lbList.length
      if (lightbox.lib === 'costume') {
        const it = lbList[next] as CostumeItem
        setLightbox({ lib: 'costume', id: it.id })
      } else {
        const p = lbList[next] as PoseItem
        const match = p.views.find(v => v.ang === lightbox.ang) || p.views[0]
        setLightbox({ lib: 'pose', id: p.id, ang: match.ang })
      }
    },
    [lightbox, lbIndex, lbList],
  )

  /* ── Android 返回键：优先关灯箱/抽屉 ── */

  useEffect(() => {
    const w = window as unknown as { __onBack?: () => boolean }
    w.__onBack = () => {
      if (lightbox) {
        setLightbox(null)
        return true
      }
      if (overlay.kind !== 'none') {
        setOverlay({ kind: 'none' })
        return true
      }
      if (facetOpen) {
        setFacetOpen(false)
        return true
      }
      return false
    }
    return () => {
      delete w.__onBack
    }
  }, [lightbox, overlay, facetOpen])

  /* ── 操作 ── */

  const openCostume = useCallback((it: CostumeItem) => {
    setLightbox({ lib: 'costume', id: it.id })
  }, [])

  const openPose = useCallback((p: PoseItem, a: string) => {
    setLightbox({ lib: 'pose', id: p.id, ang: a })
  }, [])

  const addCostumeToBag = useCallback(
    (it: CostumeItem) => {
      bag.add({
        kind: 'costume',
        id: it.id,
        label: it.id,
        tags: it.tags,
        thumb: it.thumb,
      })
      toast.show('已加入提示词袋')
    },
    [bag, toast],
  )

  const addPoseToBag = useCallback(
    (p: PoseItem, a: string) => {
      bag.add({
        kind: 'pose',
        id: p.id,
        ang: a,
        label: `${p.pid} · ${angLabel(a)}`,
        thumb: (p.views.find(v => v.ang === a) || p.views[0]).thumb,
      })
      toast.show('已加入提示词袋')
    },
    [bag, angLabel, toast],
  )

  const copyAction = useCallback(
    (text: string, okMsg: string) => {
      copyText(text).then(ok => toast.show(ok ? okMsg : '复制失败'))
    },
    [toast],
  )

  const saveAction = useCallback(
    (path: string, filename: string) => {
      const prefix = settings.filePrefix ? settings.filePrefix + '_' : ''
      saveImage(path, prefix + filename).then(saved => {
        if (saved) toast.show('已保存到 ' + saved)
        else if (hasNative()) toast.show('保存失败：找不到图片或没有权限')
        else toast.show('已开始保存')
      })
    },
    [toast, settings.filePrefix],
  )

  const addTagToFilter = useCallback((t: string) => {
    setLib('costume')
    setTags(prev => (prev.indexOf(t) >= 0 ? prev : prev.concat(t)))
    setLightbox(null)
    setFacetOpen(true)
  }, [])

  /* ── 渲染 ── */

  if (error) {
    return (
      <div className="wrap" style={{ paddingTop: 80 }}>
        <div className="empty">
          <b>数据加载失败</b>
          <p>{error}</p>
          <p>请确认 public/data/index.json 存在。</p>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="wrap" style={{ paddingTop: 80 }}>
        <div className="grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i}>
              <div className="skeleton" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  const costumeCats = data.costume.cats
  const poseSeries = data.pose.series
  const poseCats = data.pose.cats
  const angOrder = data.pose.angOrder

  const activeFacetCount =
    lib === 'costume' ? tags.length + (cat ? 1 : 0) : (cat ? 1 : 0) + (ang ? 1 : 0)

  const countText =
    lib === 'costume'
      ? `<b>${view.length}</b> 件`
      : `<b>${view.length}</b> 姿势 · <b>${poseView.reduce((a, p) => a + p.views.length, 0)}</b> 图`

  const clearAll = () => {
    setQuery('')
    setCat(null)
    setTags([])
    setSeries(null)
    setAng(null)
  }

  const lbItem =
    lightbox && lightbox.lib === 'costume'
      ? (data.costume.items.find(x => x.id === lightbox.id) as CostumeItem | undefined)
      : undefined
  const lbPose =
    lightbox && lightbox.lib === 'pose'
      ? (data.pose.poses.find(x => x.id === lightbox.id) as PoseItem | undefined)
      : undefined

  return (
    <div className="app">
      <TopBar
        lib={lib}
        onLib={l => {
          setLib(l)
          setCat(null)
          setTags([])
          setSeries(null)
          setAng(null)
          setQuery('')
        }}
        costumeCount={data.costume.items.length}
        poseCount={data.pose.poses.length}
        theme={theme}
        onTheme={toggle}
        favCount={favs.list.length}
        bagCount={bag.items.length}
        onFavs={() => setOverlay({ kind: 'favs' })}
        onBag={() => setOverlay({ kind: 'bag' })}
        onCompare={() => setOverlay({ kind: 'compare' })}
        onPrompts={() => setOverlay({ kind: 'prompts' })}
        promptCount={promptCount}
        onSettings={() => setOverlay({ kind: 'settings' })}
        onGenerate={() => setOverlay({ kind: 'generate' })}
        onLibrary={() => setOverlay({ kind: 'library' })}
        libraryCount={library.length}
      />

      <div className="wrap">
        <Toolbar
          query={query}
          onQuery={setQuery}
          facetOpen={facetOpen}
          onFacetToggle={() => setFacetOpen(o => !o)}
          activeFacetCount={activeFacetCount}
          countText={countText}
        >
          <div className="catrow">
            <button className="cat" aria-pressed={cat === null} onClick={() => setCat(null)}>
              全部<span className="n">{lib === 'costume' ? data.costume.items.length : data.pose.poses.length}</span>
            </button>
            {lib === 'costume'
              ? costumeCats.filter(c => !hiddenCats.has(c.slug)).map(c => (
                  <button
                    key={c.slug}
                    className="cat"
                    aria-pressed={cat === c.slug}
                    onClick={() => setCat(cat === c.slug ? null : c.slug)}
                  >
                    {c.zh}
                    <span className="n">{c.count}</span>
                  </button>
                ))
              : poseSeries.map(s => (
                  <button
                    key={s.slug}
                    className="cat"
                    aria-pressed={series === s.slug}
                    onClick={() => {
                      setSeries(series === s.slug ? null : s.slug)
                      setCat(null)
                    }}
                  >
                    {s.zh}
                    <span className="n">{s.count}</span>
                  </button>
                ))}
          </div>

          {facetOpen && (
            <div className="facets">
              <div className="facet-head">
                <h4>{lib === 'costume' ? '标签筛选' : '姿势筛选'}</h4>
                {(activeFacetCount > 0 || query) && (
                  <button className="link-btn" onClick={clearAll}>
                    清除全部
                  </button>
                )}
              </div>

              {lib === 'costume' ? (
                data.costume.groups.map(g => {
                  const avail = g.tags.filter(t => data.costume.items.some(it => it.tags.indexOf(t) >= 0))
                  if (!avail.length) return null
                  return (
                    <div className="facet-group" key={g.key}>
                      <h5>{g.zh}</h5>
                      <div className="chips">
                        {avail.map(t => {
                          const n = data.costume.items.filter(it => it.tags.indexOf(t) >= 0).length
                          const on = tags.indexOf(t) >= 0
                          return (
                            <button
                              key={t}
                              className="chip"
                              aria-pressed={on}
                              title={t}
                              onClick={() =>
                                setTags(prev => (on ? prev.filter(x => x !== t) : prev.concat(t)))
                              }
                            >
                              {tagLabel(t)}
                              <span className="c">{n}</span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })
              ) : (
                <>
                  <div className="facet-group">
                    <h5>视角</h5>
                    <div className="chips">
                      <button className="chip" aria-pressed={ang === null} onClick={() => setAng(null)}>
                        全部
                      </button>
                      {angOrder.map(a => (
                        <button
                          key={a}
                          className="chip"
                          aria-pressed={ang === a}
                          onClick={() => setAng(ang === a ? null : a)}
                        >
                          {angLabel(a)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="facet-group">
                    <h5>分类</h5>
                    <div className="chips">
                      <button className="chip" aria-pressed={cat === null} onClick={() => setCat(null)}>
                        全部
                      </button>
                      {poseCats
                        .filter(c => data.pose.poses.some(p => p.cat === c.slug && (!series || p.series === series)))
                        .map(c => (
                          <button
                            key={c.slug}
                            className="chip"
                            aria-pressed={cat === c.slug}
                            onClick={() => setCat(cat === c.slug ? null : c.slug)}
                          >
                            {c.zh}
                          </button>
                        ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </Toolbar>

        {view.length === 0 ? (
          <div className="empty">
            <b>没有匹配的结果</b>
            <p>换个关键词，或减少筛选条件。</p>
            <button className="chip-btn" onClick={clearAll}>
              清除全部条件
            </button>
          </div>
        ) : (
          <>
            <div className="grid" data-cols={settings.gridCols}>
              {shown.map((x, i) =>
                lib === 'costume' ? (
                  <div key={(x as CostumeItem).id}>
                    <CostumeCard
                      item={x as CostumeItem}
                      catName={costumeCatName((x as CostumeItem).cat)}
                      tagLabel={tagLabel}
                      faved={costumeFav((x as CostumeItem).id)}
                      eager={i < 8}
                      onOpen={() => openCostume(x as CostumeItem)}
                      onFav={() => toggleCostumeFav((x as CostumeItem).id)}
                    />
                  </div>
                ) : (
                  <div key={(x as PoseItem).id}>
                    <PoseCard
                      pose={x as PoseItem}
                      catName={poseCatName((x as PoseItem).cat)}
                      seriesName={poseSeriesName((x as PoseItem).series)}
                      angLabel={angLabel}
                      faved={(x as PoseItem).views.some(v => poseFav((x as PoseItem).id, v.ang))}
                      eager={i < 8}
                      onOpen={a => openPose(x as PoseItem, a)}
                      onFav={a => togglePoseFav((x as PoseItem).id, a)}
                    />
                  </div>
                ),
              )}
            </div>
            <div ref={sentinel} style={{ height: 1 }} />
            {limit < view.length && (
              <button
                className="loadmore"
                onClick={() => setLimit(l => Math.min(l + pageSize, view.length))}
              >
                加载更多（剩余 {view.length - limit}）
              </button>
            )}
          </>
        )}

        <div className="foot">
          素材版权归原作者 ギア（@giaaibusi）所有，仅供个人学习与创作参考，请勿再分发。
          <br />
          代码 MIT · 中文译文 CC BY 4.0 · 图片不在任何开源许可范围内。
        </div>
      </div>

      {/* 灯箱 */}
      {lightbox && lightbox.lib === 'costume' && lbItem && (
        <Lightbox
          kind="costume"
          item={lbItem}
          catName={costumeCatName(lbItem.cat)}
          tagLabel={tagLabel}
          index={lbIndex >= 0 ? lbIndex : 0}
          total={lbList.length}
          faved={costumeFav(lbItem.id)}
          onClose={() => setLightbox(null)}
          onPrev={() => stepLightbox(-1)}
          onNext={() => stepLightbox(1)}
          onFav={() => toggleCostumeFav(lbItem.id)}
          onBag={() => addCostumeToBag(lbItem)}
          onTag={addTagToFilter}
          onToast={toast.show}
          onCopy={copyAction}
          onSave={saveAction}
          onGenerate={(url, prompt) => {
            setGenSeed({ url, prompt, nonce: Date.now() })
            setLightbox(null)
            setOverlay({ kind: 'generate' })
          }}
        />
      )}
      {lightbox && lightbox.lib === 'pose' && lbPose && (
        <Lightbox
          kind="pose"
          pose={lbPose}
          ang={lightbox.ang || lbPose.views[0].ang}
          catName={poseCatName(lbPose.cat)}
          seriesName={poseSeriesName(lbPose.series)}
          angLabel={angLabel}
          index={lbIndex >= 0 ? lbIndex : 0}
          total={lbList.length}
          faved={poseFav(lbPose.id, lightbox.ang || lbPose.views[0].ang)}
          onClose={() => setLightbox(null)}
          onPrev={() => stepLightbox(-1)}
          onNext={() => stepLightbox(1)}
          onFav={a => togglePoseFav(lbPose.id, a)}
          onBag={a => addPoseToBag(lbPose, a)}
          onAng={a => setLightbox({ lib: 'pose', id: lbPose.id, ang: a })}
          onToast={toast.show}
          onCopy={copyAction}
          onSave={saveAction}
          onGenerate={(url, prompt) => {
            setGenSeed({ url, prompt, nonce: Date.now() })
            setLightbox(null)
            setOverlay({ kind: 'generate' })
          }}
        />
      )}

      {/* 收藏 */}
      {overlay.kind === 'favs' && (
        <Drawer
          title="收藏"
          count={favs.list.length}
          onClose={() => setOverlay({ kind: 'none' })}
          footer={
            <>
              <button
                onClick={() => {
                  const lines = favs.list.map(f => {
                    if (f.kind === 'costume') return f.id
                    return `${f.id}${f.ang ? ' · ' + angLabel(f.ang) : ''}`
                  })
                  copyText(lines.join('\n')).then(ok =>
                    toast.show(ok ? '已复制清单' : '复制失败'),
                  )
                }}
              >
                复制清单
              </button>
              <button
                onClick={() => {
                  if (favs.list.length === 0) return
                  favs.clear()
                  toast.show('已清空收藏')
                }}
              >
                <IconTrash size={13} /> 清空
              </button>
            </>
          }
        >
          {favs.list.length === 0 ? (
            <div className="drawer-empty">还没有收藏。卡片右上角的星标可以收藏。</div>
          ) : (
            <div className="rows">
              {favs.list.map(f => {
                const it =
                  f.kind === 'costume'
                    ? data.costume.items.find(x => x.id === f.id)
                    : data.pose.poses.find(x => x.id === f.id)
                if (!it) return null
                const thumb =
                  f.kind === 'costume'
                    ? (it as CostumeItem).thumb
                    : ((it as PoseItem).views.find(v => v.ang === f.ang) || (it as PoseItem).views[0]).thumb
                const title =
                  f.kind === 'costume' ? (it as CostumeItem).id : (it as PoseItem).pid
                const sub =
                  f.kind === 'costume'
                    ? costumeCatName((it as CostumeItem).cat)
                    : `${(it as PoseItem).nameZh}${f.ang ? ' · ' + angLabel(f.ang) : ''}`
                return (
                  <div className="row-item" key={`${f.kind}:${f.id}:${f.ang || ''}`}>
                    <div className="thumb">
                      <Img src={thumb} alt="" />
                    </div>
                    <div className="txt">
                      <b>{title}</b>
                      <span>{sub}</span>
                    </div>
                    <button
                      className="rm"
                      aria-label="移除"
                      onClick={() => favs.remove(f)}
                    >
                      <IconTrash size={14} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </Drawer>
      )}

      {/* 提示词袋 */}
      {overlay.kind === 'bag' && (
        <Drawer
          title="提示词袋"
          count={bag.items.length}
          onClose={() => setOverlay({ kind: 'none' })}
          footer={
            <>
              <button
                className="primary"
                onClick={() => {
                  const text = bagText(bag.items)
                  copyText(text).then(ok => toast.show(ok ? '已复制提示词' : '复制失败'))
                }}
              >
                复制提示词
              </button>
              <button
                onClick={() => {
                  saveFile('prompts.txt', bagText(bag.items), 'text/plain;charset=utf-8')
                  toast.show('已导出 TXT')
                }}
              >
                导出 TXT
              </button>
              <button
                onClick={() => {
                  const rows = [['kind', 'id', 'view', 'tags']].concat(
                    bag.items.map(x => [
                      x.kind,
                      x.id,
                      x.ang || '',
                      (x.tags || []).join(' '),
                    ]),
                  )
                  const csv = rows
                    .map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(','))
                    .join('\n')
                  saveFile('prompts.csv', '\ufeff' + csv, 'text/csv;charset=utf-8')
                  toast.show('已导出 CSV')
                }}
              >
                导出 CSV
              </button>
              <button
                onClick={() => {
                  if (bag.items.length === 0) return
                  bag.clear()
                  toast.show('已清空提示词袋')
                }}
              >
                清空
              </button>
            </>
          }
        >
          {bag.items.length === 0 ? (
            <div className="drawer-empty">
              还没有内容。打开大图后点「加入提示词袋」，或在收藏里整理。
            </div>
          ) : (
            <>
              <div className="rows" style={{ marginBottom: 16 }}>
                {bag.items.map(x => (
                  <div className="row-item" key={`${x.kind}:${x.id}:${x.ang || ''}`}>
                    <div className="thumb">
                      <Img src={x.thumb} alt="" />
                    </div>
                    <div className="txt">
                      <b>{x.label}</b>
                      <span>
                        {x.kind === 'costume'
                          ? (x.tags || []).map(tagLabel).join(' · ')
                          : '姿势参考'}
                      </span>
                    </div>
                    <button className="rm" aria-label="移除" onClick={() => bag.remove(x)}>
                      <IconTrash size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <p className="side-label">合并后的提示词</p>
              <textarea
                className="bag-text"
                readOnly
                value={bagText(bag.items)}
                onFocus={e => e.currentTarget.select()}
              />
            </>
          )}
        </Drawer>
      )}

      {/* 并排对比 */}
      {overlay.kind === 'compare' && (
        <ComparePanel
          data={data}
          costumeCatName={costumeCatName}
          poseCatName={poseCatName}
          poseSeriesName={poseSeriesName}
          angLabel={angLabel}
          onClose={() => setOverlay({ kind: 'none' })}
          onToast={toast.show}
        />
      )}

      <ScrollRail hideDelay={1500} />

      {overlay.kind === 'prompts' && (
        <PromptStudio
          data={data}
          skills={skills}
          defaultSkill={settings.defaultSkill}
          defaultLang={settings.promptLang}
          onClose={() => setOverlay({ kind: 'none' })}
          onToast={toast.show}
          onCopy={copyAction}
        />
      )}

      {overlay.kind === 'generate' && (
        <GenerateStudio
          config={providers}
          index={data}
          seed={genSeed}
          onSeedConsumed={() => setGenSeed(null)}
          skills={skills}
          library={library}
          onAddAsset={a => setLibrary(prev => [a].concat(prev))}
          onRemoveAsset={id => setLibrary(prev => prev.filter(x => x.id !== id))}
          onClose={() => setOverlay({ kind: 'none' })}
          onToast={toast.show}
          onCopy={copyAction}
          onProviders={() => setOverlay({ kind: 'providers' })}
          onCharacter={() => setOverlay({ kind: 'character' })}
          onPreview={a => {
            const i = library.findIndex(x => x.id === a.id)
            if (i >= 0) setViewerIndex(i)
            else {
              setLibrary(prev => [a].concat(prev))
              setViewerIndex(0)
            }
          }}
        />
      )}

      {overlay.kind === 'library' && (
        <LibraryPanel
          assets={library}
          onRemove={id => setLibrary(prev => prev.filter(x => x.id !== id))}
          onAdd={a => setLibrary(prev => [a].concat(prev))}
          onOpenViewer={i => setViewerIndex(i)}
          onToast={toast.show}
          onCopy={copyAction}
          onClose={() => setOverlay({ kind: 'none' })}
        />
      )}

      {overlay.kind === 'character' && (
        <CharacterCard
          config={providers}
          onAdd={a => setLibrary(prev => [a].concat(prev))}
          onClose={() => setOverlay({ kind: 'generate' })}
          onToast={toast.show}
          onCopy={copyAction}
          onProviders={() => setOverlay({ kind: 'providers' })}
        />
      )}

      {overlay.kind === 'providers' && (
        <ProviderPanel
          config={providers}
          onChange={setProviders}
          onClose={() => setOverlay({ kind: 'generate' })}
          onToast={toast.show}
        />
      )}

      {overlay.kind === 'settings' && (
        <SettingsPanel
          settings={settings}
          onChange={setSettings}
          onClose={() => setOverlay({ kind: 'none' })}
          onToast={toast.show}
          onCopy={copyAction}
        />
      )}

      {viewerIndex !== null && library[viewerIndex] && (
        <AssetViewer
          assets={library}
          index={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onPrev={() => setViewerIndex(i => (i === null ? null : (i - 1 + library.length) % library.length))}
          onNext={() => setViewerIndex(i => (i === null ? null : (i + 1) % library.length))}
          onSave={async a => {
            if (a.url.startsWith('data:')) {
              const link = document.createElement('a')
              link.href = a.url
              link.download = (a.title || a.id) + '.png'
              document.body.appendChild(link)
              link.click()
              document.body.removeChild(link)
              toast.show('已开始保存')
              return
            }
            const p = await saveImage(a.url, (a.title || a.id) + '.png')
            toast.show(p ? '已保存到 ' + p : '已开始保存')
          }}
          onCopy={copyAction}
          onDelete={id => {
            setLibrary(prev => prev.filter(x => x.id !== id))
            setViewerIndex(null)
            toast.show('已删除')
          }}
        />
      )}

      {toast.msg && <div className="toast">{toast.msg}</div>}
    </div>
  )
}

/* ── 提示词合并 ── */

function bagText(items: PromptBagItem[]): string {
  const tagSet: string[] = []
  const seen: Record<string, true> = {}
  const poses: string[] = []
  for (const it of items) {
    if (it.kind === 'costume') {
      for (const t of it.tags || []) {
        if (!seen[t]) {
          seen[t] = true
          tagSet.push(t)
        }
      }
    } else {
      poses.push(`${it.id}${it.ang ? ':' + it.ang : ''}`)
    }
  }
  const parts: string[] = []
  if (tagSet.length) parts.push(tagSet.join(', '))
  if (poses.length) parts.push('pose: ' + poses.join(', '))
  return parts.join('\n')
}

/* ── 对比面板 ── */

interface CompareProps {
  data: IndexData
  costumeCatName: (s: string) => string
  poseCatName: (s: string) => string
  poseSeriesName: (s: string) => string
  angLabel: (a: string) => string
  onClose: () => void
  onToast: (m: string) => void
}

function ComparePanel({
  data,
  costumeCatName,
  poseCatName,
  poseSeriesName,
  angLabel,
  onClose,
  onToast,
}: CompareProps) {
  const [left, setLeft] = useState<CostumeItem | null>(null)
  const [right, setRight] = useState<{ pose: PoseItem; ang: string } | null>(null)

  const pickCostume = () => {
    const pool = data.costume.items
    setLeft(pool[Math.floor(Math.random() * pool.length)])
  }

  const pickPose = () => {
    const pool = data.pose.poses
    const p = pool[Math.floor(Math.random() * pool.length)]
    const a = p.views[0].ang
    setRight({ pose: p, ang: a })
  }

  return (
    <Drawer
      title="并排对比"
      onClose={onClose}
      footer={
        <>
          <button onClick={pickCostume}>随机服装</button>
          <button onClick={pickPose}>随机姿势</button>
          <button
            onClick={() => {
              const lines: string[] = []
              if (left) lines.push(left.id + ': ' + left.tags.join(', '))
              if (right) lines.push(`pose: ${right.pose.id}:${right.ang}`)
              copyText(lines.join('\n')).then(ok => onToast(ok ? '已复制组合' : '复制失败'))
            }}
          >
            复制组合
          </button>
        </>
      }
    >
      <div className="compare">
        <div>
          {left ? (
            <>
              <div className="ph">
                <Img src={left.mid} alt={left.id} />
              </div>
              <div className="meta">
                <div className="row">
                  <span className="id">{left.id}</span>
                  <span className="mcat">{costumeCatName(left.cat)}</span>
                </div>
                <div className="name">{left.tags.join(' · ')}</div>
              </div>
            </>
          ) : (
            <div className="slot-empty">点「随机服装」选择一张</div>
          )}
        </div>
        <div>
          {right ? (
            <>
              <div className="ph">
                <Img
                  src={
                    (right.pose.views.find(v => v.ang === right.ang) || right.pose.views[0]).full
                  }
                  alt={right.pose.pid}
                />
              </div>
              <div className="meta">
                <div className="row">
                  <span className="id">{right.pose.pid}</span>
                  <span className="mcat">{angLabel(right.ang)}</span>
                </div>
                <div className="name">
                  {right.pose.nameZh} · {poseSeriesName(right.pose.series)} ·{' '}
                  {poseCatName(right.pose.cat)}
                </div>
              </div>
            </>
          ) : (
            <div className="slot-empty">点「随机姿势」选择一张</div>
          )}
        </div>
      </div>
    </Drawer>
  )
}

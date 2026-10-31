import { useState } from 'react'
import type { PoseItem } from '../types'
import Img from './Img'
import { IconStar } from '../icons'

interface Props {
  pose: PoseItem
  catName: string
  seriesName: string
  angLabel: (a: string) => string
  faved: boolean
  onOpen: (ang: string) => void
  onFav: (ang: string) => void
  eager?: boolean
}

export default function PoseCard({
  pose,
  catName,
  seriesName,
  angLabel,
  faved,
  onOpen,
  onFav,
  eager,
}: Props) {
  const [ang, setAng] = useState(pose.views[0] ? pose.views[0].ang : '')
  const view = pose.views.find(v => v.ang === ang) || pose.views[0]

  return (
    <article
      className="card"
      tabIndex={0}
      role="button"
      aria-label={`${pose.pid} ${pose.nameZh}`}
      onClick={() => onOpen(view.ang)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(view.ang)
        }
      }}
    >
      <div className="ph ratio-34">
        <Img src={view.thumb} alt={`${pose.pid} ${angLabel(view.ang)}`} eager={eager} />
      </div>
      <button
        className={'fav' + (faved ? ' on' : '')}
        aria-pressed={faved}
        aria-label={faved ? '取消收藏' : '收藏'}
        onClick={e => {
          e.stopPropagation()
          onFav(view.ang)
        }}
      >
        <IconStar filled={faved} size={14} />
      </button>
      <div className="meta">
        <div className="row">
          <span className="id">{pose.pid}</span>
          <span className="mcat">{catName}</span>
        </div>
        <div className="name" title={`${pose.nameZh} · ${seriesName}`}>
          {pose.nameZh}
        </div>
      </div>
      {pose.views.length > 1 && (
        <div className="views" onClick={e => e.stopPropagation()}>
          {pose.views.map(v => (
            <button
              key={v.ang}
              className={v.ang === view.ang ? 'on' : ''}
              aria-pressed={v.ang === view.ang}
              aria-label={angLabel(v.ang)}
              title={angLabel(v.ang)}
              onClick={() => setAng(v.ang)}
            >
              <Img src={v.thumb} alt="" />
            </button>
          ))}
        </div>
      )}
    </article>
  )
}

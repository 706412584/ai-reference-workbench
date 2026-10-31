import type { CostumeItem } from '../types'
import Img from './Img'
import { IconStar } from '../icons'

interface Props {
  item: CostumeItem
  catName: string
  tagLabel: (t: string) => string
  faved: boolean
  onOpen: () => void
  onFav: () => void
  eager?: boolean
}

export default function CostumeCard({
  item,
  catName,
  tagLabel,
  faved,
  onOpen,
  onFav,
  eager,
}: Props) {
  const shown = item.tags.slice(0, 4)
  const rest = item.tags.length - shown.length

  return (
    <article
      className="card"
      tabIndex={0}
      role="button"
      aria-label={`${item.id} ${catName}`}
      onClick={onOpen}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      <div className="ph">
        <Img src={item.thumb} alt={item.id} eager={eager} />
        <div className="tagline">
          {shown.map(t => (
            <i key={t}>{tagLabel(t)}</i>
          ))}
          {rest > 0 && <i className="more">+{rest}</i>}
        </div>
      </div>
      <button
        className={'fav' + (faved ? ' on' : '')}
        aria-pressed={faved}
        aria-label={faved ? '取消收藏' : '收藏'}
        onClick={e => {
          e.stopPropagation()
          onFav()
        }}
      >
        <IconStar filled={faved} size={14} />
      </button>
      <div className="meta">
        <div className="row">
          <span className="id">{item.id}</span>
          <span className="mcat">{catName}</span>
        </div>
      </div>
    </article>
  )
}

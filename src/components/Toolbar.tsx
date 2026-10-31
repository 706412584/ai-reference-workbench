import { IconClose, IconFilter, IconSearch } from '../icons'

interface Props {
  query: string
  onQuery: (v: string) => void
  facetOpen: boolean
  onFacetToggle: () => void
  activeFacetCount: number
  countText: string
  children?: React.ReactNode
}

export default function Toolbar({
  query,
  onQuery,
  facetOpen,
  onFacetToggle,
  activeFacetCount,
  countText,
  children,
}: Props) {
  return (
    <div className="toolbar">
      <div className="toolbar-row">
        <label className="search">
          <span className="s-icon">
            <IconSearch size={16} />
          </span>
          <input
            type="search"
            value={query}
            placeholder="搜索编号、名称、标签"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={e => onQuery(e.target.value)}
          />
          {query && (
            <button className="s-clear" onClick={() => onQuery('')} aria-label="清空搜索">
              <IconClose size={14} />
            </button>
          )}
        </label>

        <button
          className="chip-btn"
          aria-expanded={facetOpen}
          onClick={onFacetToggle}
        >
          <IconFilter size={14} />
          <span style={{ marginLeft: 6 }}>筛选</span>
          {activeFacetCount > 0 && <span className="n">{activeFacetCount}</span>}
        </button>

        <div className="spacer" />
        <span className="count" dangerouslySetInnerHTML={{ __html: countText }} />
      </div>
      {children}
    </div>
  )
}

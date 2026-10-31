import { useEffect, useState } from 'react'
import type { IndexData } from './types'

interface State {
  data: IndexData | null
  error: string | null
}

let cache: IndexData | null = null
let inflight: Promise<IndexData> | null = null

function load(): Promise<IndexData> {
  if (cache) return Promise.resolve(cache)
  if (inflight) return inflight
  inflight = fetch('data/index.json')
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.json() as Promise<IndexData>
    })
    .then(d => {
      cache = d
      return d
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

export function useData(): State {
  const [state, setState] = useState<State>(() =>
    cache ? { data: cache, error: null } : { data: null, error: null },
  )

  useEffect(() => {
    let alive = true
    load().then(
      d => {
        if (alive) setState({ data: d, error: null })
      },
      e => {
        if (alive) setState({ data: null, error: String(e && e.message ? e.message : e) })
      },
    )
    return () => {
      alive = false
    }
  }, [])

  return state
}

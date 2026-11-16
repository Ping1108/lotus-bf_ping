import { useMemo, useState } from 'react'
import { useTerms } from '../hooks/useTerms'
import { DATA_MODE } from '../api'

export function Terms ({ onPickTerm }) {
  const { terms, loading, err } = useTerms()
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return terms
    // terms that start with the search text come first
    const starts = [], contains = []
    for (const t of terms) {
      const i = t.toLowerCase().indexOf(s)
      if (i === 0) starts.push(t)
      else if (i > 0) contains.push(t)
    }
    return starts.concat(contains)
  }, [terms, search])

  return (
    <div className='flex flex-col gap-3'>
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={loading ? 'Loading terms…' : `Filter ${terms.length.toLocaleString()} terms`}
        className='input w-full'
        type='search'
        aria-label='Filter terms'
      />

      {err && <div className='rounded-lg bg-red-50 p-3 text-sm text-red-700'>Could not load terms ({err}). Check that the backend is running.</div>}

      {loading && (
        <div className='flex flex-col gap-2'>
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className='h-5 animate-pulse rounded bg-paper' />)}
        </div>
      )}

      {!loading && !err && (
        filtered.length === 0
          ? <div className='text-sm text-muted'>No term matches “{search}”.</div>
          : (
            <ul className='flex flex-col'>
              {filtered.slice(0, 500).map((t) => (
                <li key={t}>
                  <button
                    className='w-full truncate rounded-md px-2 py-1 text-left text-[13.5px] text-ink hover:bg-lotus-soft hover:text-lotus-dark'
                    title={`Add “${t}” to the query`}
                    onClick={() => onPickTerm?.(t)}
                  >
                    {t}
                  </button>
                </li>
              ))}
            </ul>
            )
      )}
      {filtered.length > 500 && <div className='text-xs text-muted'>Showing 500 of {filtered.length}. Type to narrow down.</div>}
      {DATA_MODE === 'static' && <div className='mt-1 border-t border-line pt-3 text-xs text-muted'>Data: Neurosynth snapshot, 14,371 studies and 507,891 activation foci, searched in your browser.</div>}
    </div>
  )
}

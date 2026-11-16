import { useEffect, useMemo, useState } from 'react'
import { fetchStudies, pubmedUrl, doiUrl, DATA_MODE } from '../api'

const COLUMNS = [
  { key: 'year', label: 'Year' },
  { key: 'title', label: 'Title' },
  { key: 'authors', label: 'Authors' },
  { key: 'journal', label: 'Journal' },
]

export function Studies ({ query }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [sortKey, setSortKey] = useState('year')
  const [sortDir, setSortDir] = useState('desc')
  const [page, setPage] = useState(1)
  const pageSize = 20

  useEffect(() => { setPage(1) }, [query])

  useEffect(() => {
    if (!query) { setRows([]); return }
    const ac = new AbortController()
    setLoading(true); setErr('')
    fetchStudies(query, {}, ac.signal)
      .then(setRows)
      .catch(e => { if (e.name !== 'AbortError') { setErr(e?.message || String(e)); setRows([]) } })
      .finally(() => { if (!ac.signal.aborted) setLoading(false) })
    return () => ac.abort()
  }, [query])

  const changeSort = (key) => {
    if (key === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir(key === 'year' ? 'desc' : 'asc') }
  }

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    return [...rows].sort((a, b) => {
      if (sortKey === 'year') return (Number(a.year || 0) - Number(b.year || 0)) * dir
      return String(a[sortKey] || '').localeCompare(String(b[sortKey] || ''), 'en') * dir
    })
  }, [rows, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const pageRows = sorted.slice((page - 1) * pageSize, page * pageSize)

  if (!query) {
    return <p className='text-sm text-muted'>Pick a term on the left or type a query above to list matching studies.</p>
  }

  return (
    <div className='flex flex-col'>
      <div className='mb-2 text-sm text-muted'>
        {loading ? (DATA_MODE === 'static' ? 'Searching. The first search downloads the Neurosynth data (about 5 MB), later ones are instant.' : 'Searching…') : err ? '' : <><b className='text-ink'>{sorted.length}</b> studies. Titles open the paper on PubMed.</>}
      </div>

      {err && <div className='rounded-lg bg-red-50 p-3 text-sm text-red-700'>The search failed: {err}. Check the query syntax, e.g. balanced brackets and parentheses.</div>}

      {loading && (
        <div className='flex flex-col gap-2'>
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className='h-10 animate-pulse rounded-lg bg-paper' />)}
        </div>
      )}

      {!loading && !err && (
        <div className='overflow-x-auto'>
          <table className='w-full border-collapse text-[13px]'>
            <thead className='sticky top-0 bg-white text-left'>
              <tr className='border-b border-line'>
                {COLUMNS.map(({ key, label }) => (
                  <th key={key} className='cursor-pointer select-none px-2 py-2 font-semibold whitespace-nowrap' onClick={() => changeSort(key)} aria-sort={sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    {label} <span className='text-xs text-muted'>{sortKey === key ? (sortDir === 'asc' ? '▲' : '▼') : ''}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0
                ? <tr><td colSpan={4} className='px-2 py-4 text-muted'>No studies match this query. Try removing a NOT or widening the coordinate radius.</td></tr>
                : pageRows.map((r) => (
                  <tr key={r.study_id} className='border-b border-line align-top'>
                    <td className='px-2 py-2 whitespace-nowrap tabular-nums text-muted'>{r.year ?? ''}</td>
                    <td className='px-2 py-2'>
                      <a href={pubmedUrl(r.study_id)} target='_blank' rel='noreferrer' className='font-medium text-ink hover:text-lotus hover:underline'>
                        {r.title || `PMID ${r.study_id}`}
                      </a>
                      <div className='mt-0.5 text-xs text-muted'>
                        PMID {r.study_id}
                        {r.doi && <> | <a href={doiUrl(r.doi)} target='_blank' rel='noreferrer' className='hover:text-lotus hover:underline'>DOI</a></>}
                      </div>
                    </td>
                    <td className='px-2 py-2 text-muted'><div className='line-clamp-2' title={r.authors}>{r.authors || ''}</div></td>
                    <td className='px-2 py-2 italic text-muted'>{r.journal || ''}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !err && totalPages > 1 && (
        <div className='mt-3 flex items-center justify-between text-sm'>
          <span className='text-muted'>Page {page} of {totalPages}</span>
          <div className='flex gap-1'>
            <button className='btn btn--ghost' disabled={page <= 1} onClick={() => setPage(1)} aria-label='First page'>⏮</button>
            <button className='btn btn--ghost' disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button>
            <button className='btn btn--ghost' disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next</button>
            <button className='btn btn--ghost' disabled={page >= totalPages} onClick={() => setPage(totalPages)} aria-label='Last page'>⏭</button>
          </div>
        </div>
      )}
    </div>
  )
}

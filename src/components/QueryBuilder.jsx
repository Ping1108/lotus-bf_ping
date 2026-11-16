import { useEffect, useRef, useState } from 'react'

/**
 * Query input. Typing is kept as a local draft and only committed after a short pause
 * or on Enter, so the studies table and brain map are not re-fetched on every keystroke.
 */
export function QueryBuilder ({ query, setQuery }) {
  const [draft, setDraft] = useState(query)
  const inputRef = useRef(null)

  // outside changes (clicking a term, word or star) replace the draft
  useEffect(() => { setDraft(query) }, [query])

  // commit 600 ms after the user stops typing
  useEffect(() => {
    if (draft === query) return
    const id = setTimeout(() => setQuery(draft.trim()), 600)
    return () => clearTimeout(id)
  }, [draft, query, setQuery])

  const append = (token) => {
    const next = draft ? `${draft.trimEnd()} ${token}` : token
    setDraft(next)
    inputRef.current?.focus()
  }

  return (
    <div className='qb'>
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setQuery(draft.trim()) } }}
        placeholder='Search a term, a coordinate, or both, e.g. "working memory" NOT [-22,-4,18]'
        className='input qb__input'
        aria-label='Query'
      />
      <div className='qb__ops'>
        {['AND', 'OR', 'NOT', '(', ')'].map(op => (
          <button key={op} className='btn btn--op' onClick={() => append(op)} title={`Insert ${op}`}>{op}</button>
        ))}
        <button className='btn btn--ghost' onClick={() => { setDraft(''); setQuery('') }} disabled={!draft}>Clear</button>
      </div>
    </div>
  )
}

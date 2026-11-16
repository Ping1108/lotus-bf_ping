import { useEffect, useState } from 'react'
import { fetchTerms } from '../api'

/** Vocabulary of all LoTUS-BF terms, loaded once and shared. */
export function useTerms () {
  const [terms, setTerms] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  useEffect(() => {
    let alive = true
    fetchTerms()
      .then(t => { if (alive) setTerms(t) })
      .catch(e => { if (alive) setErr(e?.message || String(e)) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])
  return { terms, loading, err }
}

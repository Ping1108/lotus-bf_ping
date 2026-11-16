import { useEffect, useMemo, useRef, useState } from 'react'
import CloudLayout from 'd3-cloud'
import { fetchTermsNear, DATA_MODE } from '../api'
import { useElementSize } from '../hooks/useElementSize'

const PALETTE = ['#1b2333', '#c93d6e', '#2f7d6d', '#5b6478', '#a82f5a']

function seeded (seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

export function LocationWordCloud ({ location, onAddTerm }) {
  const [radius, setRadius] = useState(8)
  const [result, setResult] = useState({ nStudies: 0, words: [] })
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const boxRef = useRef(null)
  const { width } = useElementSize(boxRef)
  const height = 240

  const coord = location ? `[${location.x},${location.y},${location.z}]` : ''

  useEffect(() => {
    if (!coord) return
    const ac = new AbortController()
    const id = setTimeout(() => {
      setLoading(true); setErr('')
      fetchTermsNear(location, radius, ac.signal)
        .then(setResult)
        .catch(e => { if (e.name !== 'AbortError') { setErr(e?.message || String(e)); setResult({ nStudies: 0, words: [] }) } })
        .finally(() => { if (!ac.signal.aborted) setLoading(false) })
    }, 300) // wait until the user stops clicking around
    return () => { clearTimeout(id); ac.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coord, radius])

  const ranked = useMemo(() => result.words.slice(0, 45), [result])
  const weight = (d) => d.score ?? d.count

  const placed = useMemo(() => {
    if (!ranked.length || width < 50) return []
    const ws = ranked.map(weight); const max = Math.max(...ws); const min = Math.min(...ws)
    const scale = (c) => 12 + 30 * Math.sqrt((c - min) / ((max - min) || 1))
    const layout = new CloudLayout().size([width, height]).overflow(false).random(seeded(ranked.length + Math.round(max)))
    const out = []
    ranked.forEach((d, i) => {
      const sprite = layout.getSprite(d.term, {
        size: scale(weight(d)), font: 'Public Sans, system-ui, sans-serif', weight: i < 5 ? 700 : 500,
        padding: 2, rotate: 0, datum: { ...d, color: PALETTE[i % PALETTE.length] }
      })
      const w = sprite && layout.place(sprite)
      if (w) out.push(w)
    })
    return out
  }, [ranked, width])

  return (
    <div>
      <div className='mb-2 flex flex-wrap items-baseline justify-between gap-2'>
        <h2 className='card__title !mb-0'>What is studied here?</h2>
        {location && (
          <label className='flex items-center gap-2 text-xs text-muted'>
            within
            <input type='range' min={4} max={16} step={2} value={radius} onChange={e => setRadius(Number(e.target.value))} className='w-24 accent-lotus' aria-label='Search radius in mm' />
            <span className='w-10 tabular-nums'>{radius} mm</span>
          </label>
        )}
      </div>

      {!location && (
        <p className='text-sm text-muted'>Click a point on any brain slice. You’ll see the terms that studies reporting activation near that point are about. Click a word to add it to the query.</p>
      )}

      {location && (
        <p className='mb-1 text-xs text-muted'>
          {loading ? `Looking up studies near ${coord}…` : err ? '' : `${result.nStudies} studies report activation within ${radius} mm of ${coord}. ${DATA_MODE === 'static' ? 'Bigger words are more specific to this spot than to the brain overall.' : 'Bigger words appear in more of their titles.'}`}
        </p>
      )}
      {err && <div className='rounded-lg bg-red-50 p-3 text-sm text-red-700'>Lookup failed: {err}</div>}

      <div ref={boxRef} className='relative w-full'>
        {location && !loading && !err && ranked.length === 0 && (
          <p className='text-sm text-muted'>No studies here. Try a larger radius or a point inside grey matter.</p>
        )}
        {placed.length > 0 && (
          <svg width={width} height={height} className={`block transition-opacity ${loading ? 'opacity-40' : ''}`} role='img' aria-label={`Word cloud for ${coord}`}>
            <g transform={`translate(${width / 2},${height / 2})`}>
              {placed.map(w => (
                <text
                  key={w.text}
                  x={w.x} y={w.y}
                  textAnchor='middle'
                  fontSize={w.size}
                  fontWeight={w.weight}
                  fontFamily={w.font}
                  fill={w.datum.color}
                  className='cursor-pointer hover:opacity-70'
                  onClick={() => onAddTerm?.(w.text)}
                >
                  <title>{`In ${w.datum.count} of ${result.nStudies} nearby studies${w.datum.lift ? `, ${w.datum.lift.toFixed(1)}× more often than across all studies` : ''}. Click to add to the query.`}</title>
                  {w.text}
                </text>
              ))}
            </g>
          </svg>
        )}
      </div>
    </div>
  )
}

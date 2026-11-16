import { useEffect, useMemo, useRef, useState } from 'react'
import { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY } from 'd3-force'
import { zoom as d3zoom, zoomIdentity } from 'd3-zoom'
import { select } from 'd3-selection'
import { fetchRelated } from '../api'
import { useTerms } from '../hooks/useTerms'
import { useElementSize } from '../hooks/useElementSize'

const FIRST_RING = 18 // neighbours of the centre term
const NEXT_RING = 8 // neighbours added when a star is expanded
const SUGGESTIONS = ['pain', 'reward', 'working memory', 'face', 'language', 'fear']
const NODE_FILL = ['#ff6f9f', '#f6c2d4', '#8fdcc6'] // centre, first ring, further out

function starfield (n, seed = 7) {
  let s = seed
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
  return Array.from({ length: n }, () => ({ x: rnd(), y: rnd(), r: rnd() * 1.1 + 0.2, o: rnd() * 0.5 + 0.1 }))
}

export function ConceptGalaxy ({ focusTerm, onFocusChange, onAddTerm }) {
  const { terms } = useTerms()
  const wrapRef = useRef(null)
  const svgRef = useRef(null)
  const { width, height: HEIGHT } = useElementSize(wrapRef)

  const graph = useRef({ nodes: [], links: [] })
  const simRef = useRef(null)
  const [, setFrame] = useState(0)
  const [selectedId, setSelectedId] = useState(null)
  const [busy, setBusy] = useState(new Set())
  const [err, setErr] = useState('')
  const [transform, setTransform] = useState(zoomIdentity)
  const [centerInput, setCenterInput] = useState('')
  const stars = useMemo(() => starfield(110), [])
  const radius = (n) => (n.depth === 0 ? 15 : 4 + 9 * Math.sqrt((n.co_count || 0) / (graph.current.maxCo || 1)))

  // ---------- force simulation (created once) ----------
  useEffect(() => {
    let raf = 0
    const sim = forceSimulation()
      .force('link', forceLink().id(d => d.id)
        .distance(l => 55 + 170 * (1 - Math.min(1, l.jaccard / (graph.current.maxJ || 0.3))))
        .strength(0.5))
      .force('charge', forceManyBody().strength(-220))
      .force('collide', forceCollide(d => radius(d) + 10))
      .force('x', forceX(0).strength(0.03))
      .force('y', forceY(0).strength(0.04))
      .on('tick', () => {
        cancelAnimationFrame(raf)
        raf = requestAnimationFrame(() => setFrame(f => f + 1))
      })
    simRef.current = sim
    return () => { sim.stop(); cancelAnimationFrame(raf) }
  }, [])

  const restart = (alpha = 0.9) => {
    const g = graph.current
    g.maxJ = Math.max(0.05, ...g.links.map(l => l.jaccard))
    g.maxCo = Math.max(1, ...g.nodes.map(n => n.co_count || 0))
    const sim = simRef.current
    sim.nodes(g.nodes)
    sim.force('link').links(g.links)
    sim.alpha(alpha).restart()
  }

  // add related terms around one node
  const addNeighbors = (sourceId, related, depth) => {
    const g = graph.current
    const src = g.nodes.find(n => n.id === sourceId)
    if (!src) return
    const byId = new Map(g.nodes.map(n => [n.id, n]))
    for (const r of related) {
      if (!r?.term || r.term === sourceId) continue
      if (!byId.has(r.term)) {
        const a = Math.random() * Math.PI * 2
        const node = { id: r.term, depth, from: sourceId, co_count: r.co_count, jaccard: r.jaccard, x: (src.x || 0) + Math.cos(a) * 30, y: (src.y || 0) + Math.sin(a) * 30 }
        g.nodes.push(node); byId.set(r.term, node)
      }
      const exists = g.links.some(l => {
        const s = l.source.id ?? l.source; const t = l.target.id ?? l.target
        return (s === sourceId && t === r.term) || (s === r.term && t === sourceId)
      })
      if (!exists) g.links.push({ source: sourceId, target: r.term, jaccard: r.jaccard ?? 0, co_count: r.co_count })
    }
    src.expanded = true
    restart()
  }

  const expand = async (id) => {
    const node = graph.current.nodes.find(n => n.id === id)
    if (!node || node.expanded || busy.has(id)) return
    setBusy(b => new Set(b).add(id)); setErr('')
    try {
      const rel = await fetchRelated(id, node.depth === 0 ? FIRST_RING : NEXT_RING)
      addNeighbors(id, rel, Math.min(2, node.depth + 1))
    } catch (e) {
      setErr(`Could not load terms related to “${id}”: ${e?.message || e}`)
    } finally {
      setBusy(b => { const n = new Set(b); n.delete(id); return n })
    }
  }

  // ---------- new centre term → new galaxy ----------
  useEffect(() => {
    graph.current = { nodes: [], links: [] }
    setSelectedId(null); setErr('')
    if (!focusTerm) { restart(0); return }
    graph.current.nodes.push({ id: focusTerm, depth: 0, x: 0, y: 0, fx: 0, fy: 0 })
    restart()
    expand(focusTerm)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTerm])

  // ---------- zoom & pan (background only) ----------
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const z = d3zoom()
      .scaleExtent([0.35, 3])
      .filter(ev => !ev.target.closest?.('.gnode') && (!ev.ctrlKey || ev.type === 'wheel') && !ev.button)
      .on('zoom', ev => setTransform(ev.transform))
    select(svg).call(z)
    return () => select(svg).on('.zoom', null)
  }, [width > 0 && HEIGHT > 0]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- dragging stars ----------
  const drag = useRef(null)
  const toGraph = (e) => {
    const rect = svgRef.current.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left - width / 2 - transform.x) / transform.k,
      y: (e.clientY - rect.top - HEIGHT / 2 - transform.y) / transform.k
    }
  }
  const onNodeDown = (e, node) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drag.current = { node, startX: e.clientX, startY: e.clientY, moved: false }
  }
  const onNodeMove = (e) => {
    const d = drag.current
    if (!d) return
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return
    d.moved = true
    const p = toGraph(e)
    d.node.fx = p.x; d.node.fy = p.y
    simRef.current.alphaTarget(0.25).restart()
  }
  const onNodeUp = () => {
    const d = drag.current
    drag.current = null
    if (!d) return
    simRef.current.alphaTarget(0)
    if (d.node.depth !== 0) { d.node.fx = null; d.node.fy = null }
    if (!d.moved) setSelectedId(d.node.id)
  }

  const g = graph.current
  const selected = g.nodes.find(n => n.id === selectedId)

  const submitCenter = (e) => {
    e.preventDefault()
    const t = centerInput.trim()
    if (t) { onFocusChange?.(t); setCenterInput('') }
  }

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <p className='text-sm text-muted'>
          Terms that appear in the same abstracts. Thicker, shorter links mean they co-occur more often.
          Click a star for details, double-click to grow its neighbours, drag to rearrange, scroll to zoom.
        </p>
        <form onSubmit={submitCenter} className='flex gap-2'>
          <input
            list='galaxy-terms' value={centerInput} onChange={e => setCenterInput(e.target.value)}
            placeholder='Center on a term' className='input input--sm w-44' aria-label='Center the galaxy on a term'
          />
          <datalist id='galaxy-terms'>{terms.slice(0, 3000).map(t => <option key={t} value={t} />)}</datalist>
          <button className='btn btn--ghost' type='submit'>Go</button>
        </form>
      </div>

      {err && <div className='rounded-lg bg-red-50 p-3 text-sm text-red-700'>{err}</div>}

      <div ref={wrapRef} className='relative overflow-hidden rounded-xl bg-night' style={{ height: 'max(420px, calc(100vh - 300px))' }}>
        {!focusTerm && (
          <div className='absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 p-6 text-center'>
            <p className='max-w-sm text-[15px] text-white/80'>Pick a term to see which concepts orbit it.</p>
            <div className='flex flex-wrap justify-center gap-2'>
              {SUGGESTIONS.map(s => (
                <button key={s} className='rounded-full border border-white/25 px-3 py-1 text-sm text-white/90 hover:bg-white/10' onClick={() => onFocusChange?.(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}

        {width > 0 && HEIGHT > 0 && (
          <svg
            ref={svgRef} width={width} height={HEIGHT}
            className='block touch-none select-none' style={{ cursor: 'grab' }}
            onPointerMove={onNodeMove} onPointerUp={onNodeUp} onPointerLeave={onNodeUp}
            role='img' aria-label={focusTerm ? `Concept galaxy around ${focusTerm}` : 'Empty concept galaxy'}
          >
            <defs>
              <filter id='glow' x='-100%' y='-100%' width='300%' height='300%'>
                <feGaussianBlur stdDeviation='4' result='b' />
                <feMerge><feMergeNode in='b' /><feMergeNode in='SourceGraphic' /></feMerge>
              </filter>
            </defs>

            {stars.map((s, i) => <circle key={i} cx={s.x * width} cy={s.y * HEIGHT} r={s.r} fill='#fff' opacity={s.o} />)}

            <g transform={`translate(${width / 2 + transform.x},${HEIGHT / 2 + transform.y}) scale(${transform.k})`}>
              {g.links.map((l, i) => {
                const w = l.jaccard / (g.maxJ || 1)
                const hot = selectedId && (l.source.id === selectedId || l.target.id === selectedId)
                return (
                  <line
                    key={i}
                    x1={l.source.x} y1={l.source.y} x2={l.target.x} y2={l.target.y}
                    stroke={hot ? '#ff9cbd' : '#ffffff'}
                    strokeOpacity={hot ? 0.75 : 0.08 + 0.4 * w}
                    strokeWidth={(0.6 + 2.4 * w) / Math.sqrt(transform.k)}
                  />
                )
              })}

              {g.nodes.map(n => {
                const r = radius(n)
                const isSel = n.id === selectedId
                return (
                  <g
                    key={n.id}
                    className='gnode cursor-pointer'
                    transform={`translate(${n.x || 0},${n.y || 0})`}
                    onPointerDown={e => onNodeDown(e, n)}
                    onDoubleClick={() => expand(n.id)}
                  >
                    <circle r={r} fill={NODE_FILL[Math.min(2, n.depth)]} filter={n.depth === 0 || isSel ? 'url(#glow)' : undefined} />
                    {n.expanded && n.depth > 0 && <circle r={r + 4} fill='none' stroke='#fff' strokeOpacity='.35' />}
                    {busy.has(n.id) && <circle r={r + 7} fill='none' stroke='#ff9cbd' strokeDasharray='3 4' className='animate-spin' style={{ transformOrigin: 'center' }} />}
                    {isSel && <circle r={r + 5} fill='none' stroke='#ff9cbd' strokeWidth='1.5' />}
                    <text
                      x={r + 5} dy='0.35em'
                      fill='#fff' fillOpacity={n.depth === 0 || isSel ? 1 : 0.78}
                      fontSize={(n.depth === 0 ? 15 : 12) / Math.sqrt(transform.k)}
                      fontWeight={n.depth === 0 ? 700 : 500}
                      style={{ paintOrder: 'stroke', stroke: '#131a2c', strokeWidth: 3 }}
                    >
                      {n.id}
                    </text>
                  </g>
                )
              })}
            </g>
          </svg>
        )}

        {selected && (
          <div className='absolute bottom-3 left-3 z-10 max-w-xs rounded-lg bg-white p-3 text-sm shadow-lg'>
            <div className='text-[15px] font-semibold'>{selected.id}</div>
            {selected.depth > 0
              ? <p className='mt-1 text-muted'>Shares <b className='text-ink'>{selected.co_count}</b> studies with “{selected.from}” (Jaccard {Number(selected.jaccard).toFixed(3)}).</p>
              : <p className='mt-1 text-muted'>The center of this galaxy.</p>}
            <div className='mt-2 flex flex-wrap gap-2'>
              <button className='btn' onClick={() => onAddTerm?.(selected.id)}>Add to query</button>
              {!selected.expanded && <button className='btn btn--ghost' onClick={() => expand(selected.id)} disabled={busy.has(selected.id)}>Show its neighbours</button>}
              {selected.depth > 0 && <button className='btn btn--ghost' onClick={() => onFocusChange?.(selected.id)}>Center here</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

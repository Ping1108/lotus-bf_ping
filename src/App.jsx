import { useCallback, useEffect, useRef, useState } from 'react'
import { Terms } from './components/Terms'
import { QueryBuilder } from './components/QueryBuilder'
import { Studies } from './components/Studies'
import { NiiViewer } from './components/NiiViewer'
import { ConceptGalaxy } from './components/ConceptGalaxy'
import { LocationWordCloud } from './components/LocationWordCloud'
import { useUrlQueryState } from './hooks/useUrlQueryState'
import { appendToken, firstTerm, quoteTerm } from './lib/query'
import './App.css'

function Brand () {
  return (
    <div className='brand'>
      <img src={`${import.meta.env.BASE_URL}lotus.svg`} alt='' className='brand__mark' />
      <div>
        <div className='brand__name'>LoTUS-BF</div>
        <div className='brand__tag'>Location-or-Term Unified Search for Brain Functions</div>
      </div>
    </div>
  )
}

export default function App () {
  const [query, setQuery] = useUrlQueryState('q')
  const [tab, setTab] = useState('studies')
  const [focusTerm, setFocusTerm] = useState(() => firstTerm(query))
  const [location, setLocation] = useState(null)

  // the galaxy follows the query when it has nothing to show yet
  useEffect(() => { if (!focusTerm) setFocusTerm(firstTerm(query)) }, [query, focusTerm])

  const addTerm = useCallback((t) => {
    setQuery(q => appendToken(q, quoteTerm(t)))
  }, [setQuery])

  const pickTerm = useCallback((t) => {
    addTerm(t)
    setFocusTerm(t)
  }, [addTerm])

  // --- resizable panes ---
  const gridRef = useRef(null)
  const [sizes, setSizes] = useState([20, 46, 34])
  const MIN_PX = 240
  const startDrag = (which, e) => {
    e.preventDefault()
    const startX = e.clientX
    const total = gridRef.current.getBoundingClientRect().width
    const curPx = sizes.map(p => (p / 100) * total)
    const onMove = (ev) => {
      const dx = ev.clientX - startX
      const px = [...curPx]
      const a = which; const b = which + 1
      px[a] = curPx[a] + dx; px[b] = curPx[b] - dx
      if (px[a] < MIN_PX) { px[b] -= MIN_PX - px[a]; px[a] = MIN_PX }
      if (px[b] < MIN_PX) { px[a] -= MIN_PX - px[b]; px[b] = MIN_PX }
      setSizes(px.map(p => (p / total) * 100))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div className='app'>
      <header className='topbar'>
        <Brand />
        <QueryBuilder query={query} setQuery={setQuery} />
      </header>

      <main className='app__grid' ref={gridRef}>
        <section className='card' style={{ flexBasis: `${sizes[0]}%` }} aria-label='Terms'>
          <h2 className='card__title'>Terms</h2>
          <Terms onPickTerm={pickTerm} />
        </section>

        <div className='resizer' role='separator' aria-label='Resize terms and results' onMouseDown={(e) => startDrag(0, e)} />

        <section className='card' style={{ flexBasis: `${sizes[1]}%` }}>
          <div className='tabs' role='tablist'>
            <button className='tab' role='tab' aria-selected={tab === 'studies'} onClick={() => setTab('studies')}>Studies</button>
            <button className='tab' role='tab' aria-selected={tab === 'galaxy'} onClick={() => setTab('galaxy')}>Concept galaxy</button>
          </div>
          {/* both stay mounted so switching tabs keeps the table page and the galaxy you grew */}
          <div hidden={tab !== 'studies'}><Studies query={query} /></div>
          <div hidden={tab !== 'galaxy'}>
            <ConceptGalaxy focusTerm={focusTerm} onFocusChange={setFocusTerm} onAddTerm={addTerm} />
          </div>
        </section>

        <div className='resizer' role='separator' aria-label='Resize results and brain map' onMouseDown={(e) => startDrag(1, e)} />

        <section className='card' style={{ flexBasis: `${sizes[2]}%` }}>
          <div className='card__section'>
            <NiiViewer query={query} onPickLocation={setLocation} />
          </div>
          <div className='card__section'>
            <LocationWordCloud location={location} onAddTerm={addTerm} />
          </div>
        </section>
      </main>
    </div>
  )
}

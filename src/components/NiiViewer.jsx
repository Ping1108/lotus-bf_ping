// Show x>0 on the right side of the screen (right hemisphere on the right)
const X_RIGHT_ON_SCREEN_RIGHT = true

import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchMap, downloadMap } from '../api'
import { loadNiftiUrl } from '../lib/nifti'
import { firstCoordinate } from '../lib/query'

const MNI_BG_URL = `${import.meta.env.BASE_URL}static/mni_2mm.nii.gz`
const FWHM_MIN = 0
const FWHM_MAX = 30

// Standard MNI152 2mm affine (voxel i,j,k -> MNI mm): x = -2i + 90; y = 2j - 126; z = 2k - 72
const MNI2MM = { x0: 90, y0: -126, z0: -72, vx: 2, vy: 2, vz: 2 }
function isStandardMNI2mm (dims, voxelMM) {
  const okDims = dims[0] === 91 && dims[1] === 109 && dims[2] === 91
  const okSp = voxelMM && voxelMM.every(v => Math.abs(v - 2) < 1e-3)
  return okDims && okSp
}

// FIX: percentile over voxels that actually carry signal (> 0). The old version ranked the whole
// box including all the empty space outside the brain, so the threshold drifted with smoothing.
function positivePercentile (arr, p) {
  const pos = []
  for (let i = 0; i < arr.length; i++) if (arr[i] > 0) pos.push(arr[i])
  if (!pos.length) return 0
  const sorted = Float32Array.from(pos).sort()
  const k = Math.floor((p / 100) * (sorted.length - 1))
  return sorted[Math.max(0, Math.min(sorted.length - 1, k))]
}
// "hot" colormap (dark red → red → orange → yellow), t in [0,1]
function hot (t) {
  const c = (v) => Math.max(0, Math.min(1, v))
  return [c(t / 0.4) * 255, c((t - 0.4) / 0.4) * 255, c((t - 0.8) / 0.2) * 255]
}
const HOT_CSS = 'linear-gradient(to right, rgb(115,0,0), rgb(255,0,0) 30%, rgb(255,160,0) 65%, rgb(255,255,120))'

export function NiiViewer ({ query, onPickLocation }) {
  const [loadingBG, setLoadingBG] = useState(false)
  const [loadingMap, setLoadingMap] = useState(false)
  const [errBG, setErrBG] = useState('')
  const [errMap, setErrMap] = useState('')

  // map generation params
  const [fwhm, setFwhm] = useState(10)
  const [fwhmDraft, setFwhmDraft] = useState('10')

  // overlay controls
  const [overlayAlpha, setOverlayAlpha] = useState(0.7)
  const [thrMode, setThrMode] = useState('pctl')
  const [pctl, setPctl] = useState(95)
  const [thrValue, setThrValue] = useState(0)

  // volumes (refs + a version counter so React knows when they change)
  const bgRef = useRef(null)
  const mapRef = useRef(null)
  const [mapVersion, setMapVersion] = useState(0)
  const [dims, setDims] = useState([0, 0, 0])

  // slice indices (voxel coordinates)
  const [ix, setIx] = useState(0)
  const [iy, setIy] = useState(0)
  const [iz, setIz] = useState(0)
  // coordinate inputs (MNI mm, as typed)
  const [cx, setCx] = useState('0')
  const [cy, setCy] = useState('0')
  const [cz, setCz] = useState('0')

  const canvases = [useRef(null), useRef(null), useRef(null)]


  // ---------- coordinate conversion ----------
  const voxelMM = () => bgRef.current?.voxelMM ?? mapRef.current?.voxelMM ?? [1, 1, 1]
  const AXIS_SIGN = { x: -1, y: 1, z: 1 }
  const axisN = (axis) => (axis === 'x' ? dims[0] : axis === 'y' ? dims[1] : dims[2])
  const idx2coord = (i, axis) => {
    const vm = voxelMM()
    if (isStandardMNI2mm(dims, vm)) {
      if (axis === 'x') return -MNI2MM.vx * i + MNI2MM.x0
      if (axis === 'y') return MNI2MM.vy * i + MNI2MM.y0
      return MNI2MM.vz * i + MNI2MM.z0
    }
    const mm = axis === 'x' ? vm[0] : axis === 'y' ? vm[1] : vm[2]
    return AXIS_SIGN[axis] * (i - Math.floor(axisN(axis) / 2)) * mm
  }
  const coord2idx = (c, axis) => {
    const vm = voxelMM(); const n = axisN(axis)
    let v
    if (isStandardMNI2mm(dims, vm)) {
      if (axis === 'x') v = (MNI2MM.x0 - c) / MNI2MM.vx
      else if (axis === 'y') v = (c - MNI2MM.y0) / MNI2MM.vy
      else v = (c - MNI2MM.z0) / MNI2MM.vz
    } else {
      const mm = axis === 'x' ? vm[0] : axis === 'y' ? vm[1] : vm[2]
      v = AXIS_SIGN[axis] * (c / mm) + Math.floor(n / 2)
    }
    return Math.max(0, Math.min(n - 1, Math.round(v)))
  }
  const reportLocation = (i, j, k) => {
    onPickLocation?.({ x: idx2coord(i, 'x'), y: idx2coord(j, 'y'), z: idx2coord(k, 'z') })
  }

  // ---------- load background once ----------
  useEffect(() => {
    const ac = new AbortController()
    setLoadingBG(true); setErrBG('')
    loadNiftiUrl(MNI_BG_URL, ac.signal)
      .then(bg => {
        bgRef.current = bg
        setDims(bg.dims)
        setIx(Math.floor(bg.dims[0] / 2)); setIy(Math.floor(bg.dims[1] / 2)); setIz(Math.floor(bg.dims[2] / 2))
      })
      .catch(e => { if (e.name !== 'AbortError') setErrBG(e?.message || String(e)) })
      .finally(() => { if (!ac.signal.aborted) setLoadingBG(false) })
    return () => ac.abort()
  }, [])

  // ---------- load the query map ----------
  // FIX: abort the previous request so a slow, outdated map can never overwrite a newer one.
  useEffect(() => {
    if (!query) { mapRef.current = null; setErrMap(''); setMapVersion(v => v + 1); return }
    const ac = new AbortController()
    setLoadingMap(true); setErrMap('')
    fetchMap(query, { fwhm }, ac.signal)
      .then(mv => {
        mapRef.current = mv
        if (!bgRef.current) setDims(mv.dims)
        setThrValue(v => Math.min(mv.max, Math.max(0, v)))
        setMapVersion(v => v + 1)
      })
      .catch(e => {
        if (e.name === 'AbortError') return
        setErrMap(e?.message || String(e)); mapRef.current = null; setMapVersion(v => v + 1)
      })
      .finally(() => { if (!ac.signal.aborted) setLoadingMap(false) })
    return () => ac.abort()
  }, [query, fwhm])

  // ---------- FWHM: commit the typed value only when it is a valid number ----------
  // FIX: the old input refetched on every keystroke and turned an empty box into FWHM = 0.
  useEffect(() => {
    const v = Number(fwhmDraft)
    if (fwhmDraft.trim() === '' || !Number.isFinite(v) || v < FWHM_MIN || v > FWHM_MAX) return
    if (v === fwhm) return
    const id = setTimeout(() => setFwhm(v), 450)
    return () => clearTimeout(id)
  }, [fwhmDraft, fwhm])
  const fwhmInvalid = (() => {
    const v = Number(fwhmDraft)
    return fwhmDraft.trim() === '' || !Number.isFinite(v) || v < FWHM_MIN || v > FWHM_MAX
  })()

  // ---------- move the crosshair to a coordinate written in the query ----------
  useEffect(() => {
    const c = firstCoordinate(query)
    if (!c || !dims[0]) return
    const i = coord2idx(c.x, 'x'); const j = coord2idx(c.y, 'y'); const k = coord2idx(c.z, 'z')
    setIx(i); setIy(j); setIz(k)
    reportLocation(i, j, k)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, dims])

  const mapThreshold = useMemo(() => {
    const mv = mapRef.current
    if (!mv) return null
    if (thrMode === 'value') return Number(thrValue) || 0
    return positivePercentile(mv.data, Math.max(0, Math.min(99.9, Number(pctl) || 95)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thrMode, thrValue, pctl, mapVersion])

  // ---------- drawing ----------
  function drawSlice (canvas, axis, index) {
    const [nx, ny] = dims
    const sx = (x) => (X_RIGHT_ON_SCREEN_RIGHT ? (nx - 1 - x) : x)
    const bg = bgRef.current; const map = mapRef.current
    const dimsStr = dims.join('x')
    const bgOK = !!(bg && bg.dims.join('x') === dimsStr)
    const mapOK = !!(map && map.dims.join('x') === dimsStr)

    let w = 0; let h = 0; let at = null
    if (axis === 'z') { w = nx; h = ny; at = (x, y) => sx(x) + y * nx + index * nx * ny }
    if (axis === 'y') { w = nx; h = dims[2]; at = (x, y) => sx(x) + index * nx + y * nx * ny }
    if (axis === 'x') { w = ny; h = dims[2]; at = (x, y) => index + x * nx + y * nx * ny }

    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    const img = ctx.createImageData(w, h)
    const alpha = overlayAlpha
    const thr = mapThreshold ?? 0
    const top = map ? map.max : 1
    const span = (top - thr) || 1
    const bgMin = bg?.min ?? 0; const bgRange = ((bg?.max ?? 1) - bgMin) || 1

    let p = 0
    for (let yy = 0; yy < h; yy++) {
      const srcY = h - 1 - yy // flip vertically
      for (let xx = 0; xx < w; xx++) {
        const idx = at(xx, srcY)
        let gray = 0
        if (bgOK) gray = Math.max(0, Math.min(1, (bg.data[idx] - bgMin) / bgRange)) * 255
        let r = gray; let g = gray; let b = gray
        if (mapOK) {
          const mv = map.data[idx]
          if (mv > 0 && mv >= thr) {
            const t = Math.max(0, Math.min(1, (mv - thr) / span))
            const [cr, cg, cb] = hot(0.25 + 0.75 * t)
            r = (1 - alpha) * gray + alpha * cr
            g = (1 - alpha) * gray + alpha * cg
            b = (1 - alpha) * gray + alpha * cb
          }
        }
        img.data[p] = r; img.data[p + 1] = g; img.data[p + 2] = b; img.data[p + 3] = 255
        p += 4
      }
    }
    ctx.putImageData(img, 0, 0)

    // crosshair
    let chx = 0; let chy = 0
    if (axis === 'z') { chx = X_RIGHT_ON_SCREEN_RIGHT ? (w - 1 - ix) : ix; chy = iy }
    else if (axis === 'y') { chx = X_RIGHT_ON_SCREEN_RIGHT ? (w - 1 - ix) : ix; chy = iz }
    else { chx = iy; chy = iz }
    const screenY = h - 1 - chy
    ctx.strokeStyle = 'rgba(80, 220, 170, .9)'
    ctx.lineWidth = 0.6
    ctx.beginPath(); ctx.moveTo(chx + 0.5, 0); ctx.lineTo(chx + 0.5, h); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(0, screenY + 0.5); ctx.lineTo(w, screenY + 0.5); ctx.stroke()
  }

  function onCanvasClick (e, axis) {
    const canvas = e.currentTarget
    const rect = canvas.getBoundingClientRect()
    const x = Math.floor((e.clientX - rect.left) * canvas.width / rect.width)
    const y = Math.floor((e.clientY - rect.top) * canvas.height / rect.height)
    const srcY = canvas.height - 1 - y
    const toIdxX = (sx) => (X_RIGHT_ON_SCREEN_RIGHT ? (dims[0] - 1 - sx) : sx)
    let i = ix; let j = iy; let k = iz
    if (axis === 'z') { i = toIdxX(x); j = srcY } else if (axis === 'y') { i = toIdxX(x); k = srcY } else { j = x; k = srcY }
    setIx(i); setIy(j); setIz(k)
    reportLocation(i, j, k)
  }

  // keep the coordinate boxes in sync with the crosshair
  useEffect(() => {
    if (!dims[0]) return
    setCx(String(idx2coord(ix, 'x'))); setCy(String(idx2coord(iy, 'y'))); setCz(String(idx2coord(iz, 'z')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ix, iy, iz, dims])

  const commitCoord = (axis) => {
    const vStr = axis === 'x' ? cx : axis === 'y' ? cy : cz
    const parsed = parseFloat(vStr)
    if (Number.isNaN(parsed)) return
    let i = ix; let j = iy; let k = iz
    if (axis === 'x') { i = coord2idx(parsed, 'x'); setIx(i) }
    if (axis === 'y') { j = coord2idx(parsed, 'y'); setIy(j) }
    if (axis === 'z') { k = coord2idx(parsed, 'z'); setIz(k) }
    reportLocation(i, j, k)
  }

  // redraw on any change
  useEffect(() => {
    if (!dims[0]) return
    const [c0, c1, c2] = canvases.map(c => c.current)
    if (c0) drawSlice(c0, 'z', iz)
    if (c1) drawSlice(c1, 'y', iy)
    if (c2) drawSlice(c2, 'x', ix)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dims, ix, iy, iz, overlayAlpha, mapThreshold, mapVersion])

  const slices = [
    { key: 'y', name: 'Coronal', canvasRef: canvases[1] },
    { key: 'x', name: 'Sagittal', canvasRef: canvases[2] },
    { key: 'z', name: 'Axial', canvasRef: canvases[0] },
  ]
  const coordBoxes = [['x', cx, setCx], ['y', cy, setCy], ['z', cz, setCz]]
  const map = mapRef.current
  const fmt = (v) => (v == null ? '' : v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toPrecision(2))

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex items-center justify-between gap-2'>
        <h2 className='card__title !mb-0'>Brain map</h2>
        {query && <button className='btn btn--ghost' onClick={() => downloadMap(query, { fwhm }).catch(e => setErrMap(e?.message || String(e)))}>Download map (.nii)</button>}
      </div>

      <div className='flex flex-wrap items-center gap-3 text-sm'>
        <span className='text-muted'>MNI (mm)</span>
        {coordBoxes.map(([axis, val, set]) => (
          <label key={axis} className='flex items-center gap-1'>
            <span className='font-semibold uppercase'>{axis}</span>
            <input
              type='text' inputMode='decimal'
              className='input input--sm w-16 tabular-nums'
              value={val}
              onChange={e => set(e.target.value)}
              onBlur={() => commitCoord(axis)}
              onKeyDown={e => { if (e.key === 'Enter') commitCoord(axis) }}
              aria-label={`${axis.toUpperCase()} coordinate in mm`}
            />
          </label>
        ))}
      </div>

      {(errBG || errMap) && (
        <div className='rounded-lg bg-amber-50 p-3 text-sm text-amber-800'>
          {errBG && <div>Brain template failed to load: {errBG}</div>}
          {errMap && <div>The activation map failed to load: {errMap}</div>}
        </div>
      )}

      <div className='relative'>
        {loadingBG && !dims[0] && <div className='h-48 animate-pulse rounded-lg bg-paper' />}
        {!!dims[0] && (
          <div className='grid grid-cols-3 gap-2'>
            {slices.map(({ key, name, canvasRef }) => (
              <figure key={key} className='m-0'>
                <canvas
                  ref={canvasRef}
                  className='block w-full cursor-crosshair rounded-md bg-black'
                  style={{ height: 'auto' }}
                  onClick={(e) => onCanvasClick(e, key)}
                  title='Click to move the crosshair and see what is studied here'
                />
                <figcaption className='mt-1 text-center text-xs text-muted'>{name}</figcaption>
              </figure>
            ))}
          </div>
        )}
        {loadingMap && (
          <div className='absolute top-2 right-2 rounded-md bg-white/90 px-2 py-1 text-xs font-medium shadow-sm'>Building map…</div>
        )}
      </div>

      {map
        ? (
          <div className='text-xs text-muted'>
            <div className='h-2 rounded-full' style={{ background: HOT_CSS }} />
            <div className='mt-1 flex justify-between tabular-nums'><span>{fmt(mapThreshold)}</span><span>map density</span><span>{fmt(map.max)}</span></div>
          </div>
          )
        : <p className='text-sm text-muted'>{query ? '' : 'Run a query to overlay its activation map. Click anywhere on the brain to see what studies report there.'}</p>}

      <div className='grid grid-cols-1 gap-3 text-sm sm:grid-cols-2'>
        <label className='flex flex-col gap-1'>
          <span className='font-medium'>Threshold</span>
          <div className='flex gap-2'>
            <select value={thrMode} onChange={e => setThrMode(e.target.value)} className='input input--sm w-auto'>
              <option value='pctl'>Top percent</option>
              <option value='value'>Value</option>
            </select>
            {thrMode === 'pctl'
              ? <input type='number' min={0} max={99.9} step={1} value={pctl} onChange={e => setPctl(Number(e.target.value))} className='input input--sm w-20' aria-label='Percentile of non-zero voxels' />
              : <input type='number' min={0} step='0.01' value={thrValue} onChange={e => setThrValue(Number(e.target.value))} className='input input--sm w-24' aria-label='Threshold value' />}
          </div>
          <span className='text-xs text-muted'>{thrMode === 'pctl' ? `Shows the strongest ${Math.max(0, 100 - pctl).toFixed(1)}% of voxels with signal.` : 'Shows voxels at or above this density.'}</span>
        </label>

        <label className='flex flex-col gap-1'>
          <span className='font-medium'>Smoothing (Gaussian FWHM, mm)</span>
          <div className='flex items-center gap-2'>
            <input type='range' min={0} max={20} step={1} value={Number(fwhmDraft) || 0} onChange={e => setFwhmDraft(e.target.value)} className='flex-1 accent-lotus' aria-label='FWHM slider' />
            <input type='number' min={FWHM_MIN} max={FWHM_MAX} step={0.5} value={fwhmDraft} onChange={e => setFwhmDraft(e.target.value)} className={`input input--sm w-16 ${fwhmInvalid ? '!border-red-500' : ''}`} aria-label='FWHM in mm' />
          </div>
          <span className={`text-xs ${fwhmInvalid ? 'text-red-600' : 'text-muted'}`}>
            {fwhmInvalid ? `Enter a number from ${FWHM_MIN} to ${FWHM_MAX}.` : '0 shows raw peaks; 8 to 12 mm is typical.'}
          </span>
        </label>

        <label className='flex flex-col gap-1'>
          <span className='font-medium'>Overlay opacity</span>
          <input type='range' min={0} max={1} step={0.05} value={overlayAlpha} onChange={e => setOverlayAlpha(Number(e.target.value))} className='accent-lotus' />
        </label>
      </div>
    </div>
  )
}

// Static mode: the same queries as the Flask API, answered in the browser from the bundled
// Neurosynth snapshot in public/data (built by scripts/build_static_data.py).
import { MNI_AFFINE } from './nifti'

const DATA = `${import.meta.env.BASE_URL}data/`
const DIMS = [91, 109, 91]

// Generic words in the Neurosynth vocabulary that say nothing about function or anatomy
const GENERIC = new Set(['ability', 'activation', 'activations', 'activity', 'addition', 'additional', 'adults', 'altered', 'analyses', 'anterior', 'approach', 'area', 'areas', 'assessed', 'associated', 'association', 'background', 'basal', 'basis', 'behavioral', 'bold', 'bold signal', 'central', 'change', 'characterized', 'common', 'complex', 'component', 'condition', 'conditions', 'context', 'contrast', 'control', 'controls', 'correlated', 'correlates', 'correlation', 'cortex', 'cortical', 'cortices', 'critical', 'current', 'data', 'demonstrate', 'demonstrated', 'design', 'did', 'dorsal', 'early', 'effect', 'effects', 'event', 'evidence', 'exhibited', 'experiment', 'following', 'function', 'functional magnetic', 'functions', 'furthermore', 'ganglia', 'general', 'greater', 'group', 'groups', 'gyrus', 'healthy', 'healthy controls', 'high', 'higher', 'human', 'humans', 'identified', 'identify', 'implicated', 'important', 'increases', 'independent', 'indicate', 'indicated', 'individual', 'individuals', 'induced', 'inferior', 'influence', 'information', 'initial', 'interaction', 'interactions', 'involved', 'involvement', 'key', 'known', 'lateral', 'level', 'levels', 'little', 'lobe', 'lobule', 'low', 'lower', 'magnetic', 'magnetic resonance', 'measures', 'mechanisms', 'medial', 'methods', 'middle', 'model', 'modulated', 'modulation', 'multiple', 'network', 'networks', 'new', 'non', 'normal', 'novel', 'number', 'order', 'paradigm', 'pattern', 'patterns', 'performance', 'positive', 'positively', 'posterior', 'potential', 'predicted', 'presented', 'previous', 'primary', 'process', 'processes', 'provide', 'recruited', 'reflect', 'region', 'regional', 'regions', 'relationship', 'relevant', 'reported', 'research', 'resonance', 'response', 'responses', 'resting', 'result', 'results', 'role', 'second', 'shown', 'signal', 'signals', 'single', 'specifically', 'state', 'stimuli', 'stimulus', 'structure', 'structures', 'studied', 'studies', 'study', 'suggest', 'suggested', 'suggesting', 'suggests', 'sulcus', 'superior', 'systems', 'task', 'tasks', 'terms', 'test', 'tested', 'tests', 'time', 'trials', 'unclear', 'underlying', 'understanding', 'use', 'using', 'using functional', 'ventral', 'versus', 'voxel', 'vs', 'white', 'years'])

// ---------- loading (each file once, on first use) ----------
const once = (fn) => { let p = null; return () => (p ??= fn().catch(e => { p = null; throw e })) }
const getJSON = async (f) => { const r = await fetch(DATA + f); if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`); return r.json() }
const getBin = async (f) => { const r = await fetch(DATA + f); if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`); return r.arrayBuffer() }

const loadTerms = once(async () => {
  const t = await getJSON('terms.json')
  t.index = new Map(t.terms.map((term, i) => [term, i]))
  t.maxWords = Math.max(...t.terms.map(s => s.split(' ').length))
  return t
})
const loadRelated = once(() => getJSON('related.json'))
const loadCore = once(async () => {
  const [terms, postings, meta, coordBuf] = await Promise.all([loadTerms(), getBin('postings.bin'), getJSON('meta.json'), getBin('coords.bin')])
  const N = terms.nStudies
  const starts = new Uint32Array(coordBuf, 0, N + 1)
  const xyz = new Int16Array(coordBuf, (N + 1) * 4)
  const studyOf = new Uint16Array(xyz.length / 3)
  for (let s = 0; s < N; s++) studyOf.fill(s, starts[s], starts[s + 1])
  meta.titleLower = meta.title.map(t => t.toLowerCase())
  return { terms, post: new Uint16Array(postings), meta, starts, xyz, studyOf, N }
})
// study → terms (inverse of the postings), built only when the word cloud needs it
const loadStudyTerms = once(async () => {
  const { terms, post, N } = await loadCore()
  const cnt = new Uint32Array(N + 1)
  for (let i = 0; i < post.length; i++) cnt[post[i] + 1]++
  for (let s = 0; s < N; s++) cnt[s + 1] += cnt[s]
  const fill = cnt.slice(0, N)
  const list = new Uint16Array(post.length)
  terms.terms.forEach((_, t) => {
    for (let k = terms.offset[t], end = k + terms.count[t]; k < end; k++) list[fill[post[k]]++] = t
  })
  return { start: cnt, list }
})

// ---------- query language: terms, "phrases", prefix*, [x,y,z], AND / OR / NOT, ( ) ----------
const TOKEN = /\[[^\]]*\]|"[^"]*"|'[^']*'|\(|\)|[^\s()[\]]+/g
const isOp = (t) => /^(AND|OR|NOT)$/i.test(t)

function tokenize (q, terms) {
  const raw = (q || '').match(TOKEN) || []
  // join consecutive bare words into the longest vocabulary term: working memory → "working memory"
  const out = []
  for (let i = 0; i < raw.length;) {
    const t = raw[i]
    if (isOp(t) || t === '(' || t === ')' || t.startsWith('[') || /^["']/.test(t)) { out.push(t); i++; continue }
    let taken = 1
    for (let n = Math.min(terms.maxWords, raw.length - i); n > 1; n--) {
      const words = raw.slice(i, i + n)
      if (words.some(w => isOp(w) || /[()[\]"']/.test(w))) continue
      if (terms.index.has(words.join(' ').toLowerCase())) { taken = n; break }
    }
    out.push(taken > 1 ? `"${raw.slice(i, i + taken).join(' ')}"` : t)
    i += taken
  }
  return out
}

function parse (tokens) {
  let i = 0
  const peek = () => tokens[i]
  const startsOperand = (t) => t != null && t !== ')' && !/^(AND|OR)$/i.test(t)
  function primary () {
    const t = tokens[i++]
    if (t == null) throw new Error('the query ends too early; something is missing after the last operator')
    if (t === '(') {
      const e = orExpr()
      if (tokens[i++] !== ')') throw new Error('a "(" is never closed')
      return e
    }
    if (t === ')' || isOp(t)) throw new Error(`unexpected "${t}"`)
    if (t.startsWith('[')) {
      const p = t.slice(1, -1).split(',').map(s => Number(s.trim()))
      if (p.length !== 3 || p.some(v => !Number.isFinite(v))) throw new Error(`${t} is not a valid [x,y,z] coordinate`)
      return { type: 'point', x: p[0], y: p[1], z: p[2] }
    }
    return { type: 'term', value: t.replace(/^["']|["']$/g, '').toLowerCase() }
  }
  function unary () {
    if (/^NOT$/i.test(peek() || '')) { i++; return { type: 'not', a: unary() } }
    return primary()
  }
  function andExpr () {
    let left = unary()
    for (;;) {
      if (/^AND$/i.test(peek() || '')) { i++; left = { type: 'and', a: left, b: unary() } } else if (startsOperand(peek())) left = { type: 'and', a: left, b: unary() } // implicit AND
      else return left
    }
  }
  function orExpr () {
    let left = andExpr()
    while (/^OR$/i.test(peek() || '')) { i++; left = { type: 'or', a: left, b: andExpr() } }
    return left
  }
  const tree = orExpr()
  if (i < tokens.length) throw new Error(`unexpected "${tokens[i]}"`)
  return tree
}

function evaluate (node, db, r) {
  const { N } = db
  const set = new Uint8Array(N)
  switch (node.type) {
    case 'and': { const a = evaluate(node.a, db, r); const b = evaluate(node.b, db, r); for (let s = 0; s < N; s++) set[s] = a[s] & b[s]; return set }
    case 'or': { const a = evaluate(node.a, db, r); const b = evaluate(node.b, db, r); for (let s = 0; s < N; s++) set[s] = a[s] | b[s]; return set }
    case 'not': { const a = evaluate(node.a, db, r); for (let s = 0; s < N; s++) set[s] = a[s] ^ 1; return set }
    case 'point': {
      const { xyz, studyOf } = db
      const px = node.x * 10; const py = node.y * 10; const pz = node.z * 10; const r2 = (r * 10) ** 2
      for (let c = 0, n = studyOf.length; c < n; c++) {
        const dx = xyz[c * 3] - px; const dy = xyz[c * 3 + 1] - py; const dz = xyz[c * 3 + 2] - pz
        if (dx * dx + dy * dy + dz * dz < r2) set[studyOf[c]] = 1
      }
      return set
    }
    case 'term': {
      const { terms, post, meta } = db
      const mark = (t) => { for (let k = terms.offset[t], e = k + terms.count[t]; k < e; k++) set[post[k]] = 1 }
      const v = node.value
      if (terms.index.has(v)) { mark(terms.index.get(v)); return set }
      if (v.endsWith('*')) { // prefix search over the vocabulary
        const pre = v.slice(0, -1)
        terms.terms.forEach((t, i) => { if (t.startsWith(pre)) mark(i) })
        return set
      }
      // not a vocabulary term: fall back to whole-word search in titles
      const re = new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)
      meta.titleLower.forEach((t, s) => { if (re.test(t)) set[s] = 1 })
      return set
    }
  }
}

async function match (query, r = 6) {
  const db = await loadCore()
  const tokens = tokenize(query, db.terms)
  if (!tokens.length) throw new Error('Query must include at least a term or a [x,y,z] coordinate.')
  return { db, set: evaluate(parse(tokens), db, r) }
}

// ---------- public API (same shapes as the Flask endpoints) ----------
export async function terms () { return (await loadTerms()).terms }

export async function related (term, limit = 18) {
  const [t, rel] = await Promise.all([loadTerms(), loadRelated()])
  const i = t.index.get(term.toLowerCase())
  if (i == null) return []
  return rel[i].filter(([j]) => !GENERIC.has(t.terms[j])).slice(0, limit).map(([j, co, jac]) => ({ term: t.terms[j], co_count: co, jaccard: jac }))
}

export async function studies (query, { r = 6 } = {}) {
  const { db, set } = await match(query, r)
  const { meta } = db
  const out = []
  for (let s = 0; s < db.N; s++) {
    if (set[s]) out.push({ study_id: meta.pmid[s], year: meta.year[s], journal: meta.journal[s], title: meta.title[s], authors: meta.authors[s] })
  }
  return out
}

/** Same recipe as _make_nii_from_coords in app.py: count foci per voxel, then Gaussian smoothing. */
export async function map (query, { fwhm = 10, r = 6 } = {}) {
  const { db, set } = await match(query, r)
  const [nx, ny, nz] = DIMS
  const vol = new Float32Array(nx * ny * nz)
  const { starts, xyz } = db
  const [[ax, , , bx], [, ay, , by], [, , az, bz]] = MNI_AFFINE
  for (let s = 0; s < db.N; s++) {
    if (!set[s]) continue
    for (let c = starts[s]; c < starts[s + 1]; c++) {
      const i = Math.round((xyz[c * 3] / 10 - bx) / ax)
      const j = Math.round((xyz[c * 3 + 1] / 10 - by) / ay)
      const k = Math.round((xyz[c * 3 + 2] / 10 - bz) / az)
      if (i >= 0 && i < nx && j >= 0 && j < ny && k >= 0 && k < nz) vol[i + j * nx + k * nx * ny] += 1
    }
  }
  const data = fwhm > 0 ? gaussian3d(vol, DIMS, fwhm / (2 * Math.sqrt(2 * Math.log(2))) / 2) : vol
  let mn = Infinity; let mx = -Infinity
  for (let i = 0; i < data.length; i++) { if (data[i] < mn) mn = data[i]; if (data[i] > mx) mx = data[i] }
  return { data, dims: DIMS, voxelMM: [2, 2, 2], min: mn, max: mx }
}

// separable Gaussian, zero padding, truncated at 3 sigma (like scipy.ndimage.gaussian_filter)
function gaussian3d (src, [nx, ny, nz], sigma) {
  const rad = Math.max(1, Math.floor(3 * sigma + 0.5))
  const w = new Float32Array(2 * rad + 1)
  let sum = 0
  for (let k = -rad; k <= rad; k++) sum += (w[k + rad] = Math.exp(-(k * k) / (2 * sigma * sigma)))
  for (let k = 0; k < w.length; k++) w[k] /= sum
  let a = src; let b = new Float32Array(src.length)
  const pass = (n, stride, lines) => {
    for (const base of lines) {
      for (let p = 0; p < n; p++) {
        let acc = 0
        const lo = Math.max(0, p - rad); const hi = Math.min(n - 1, p + rad)
        for (let q = lo; q <= hi; q++) acc += a[base + q * stride] * w[q - p + rad]
        b[base + p * stride] = acc
      }
    }
    ;[a, b] = [b, a]
  }
  const lines = (fn) => { const out = []; fn(out); return out }
  pass(nx, 1, lines(o => { for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) o.push(j * nx + k * nx * ny) }))
  pass(ny, nx, lines(o => { for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) o.push(i + k * nx * ny) }))
  pass(nz, nx * ny, lines(o => { for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) o.push(i + j * nx) }))
  return a
}

/**
 * Terms that are over-represented in studies reporting activation near a point.
 * lift = P(term | near point) / P(term); a term needs to appear in a few of the nearby studies.
 */
export async function termsNear ({ x, y, z }, r = 8) {
  const { db, set } = await match(`[${x},${y},${z}]`, r)
  const { start, list } = await loadStudyTerms()
  const { terms, N } = db
  const cnt = new Uint32Array(terms.terms.length)
  let n = 0
  for (let s = 0; s < N; s++) {
    if (!set[s]) continue
    n++
    for (let k = start[s]; k < start[s + 1]; k++) cnt[list[k]]++
  }
  const minCount = Math.max(2, Math.ceil(n * 0.04))
  const words = []
  for (let t = 0; t < cnt.length; t++) {
    if (cnt[t] < minCount || GENERIC.has(terms.terms[t])) continue
    const lift = (cnt[t] / n) / (terms.count[t] / N)
    if (lift > 1.2) words.push({ term: terms.terms[t], count: cnt[t], lift, score: cnt[t] * Math.log2(lift) })
  }
  words.sort((a, b) => b.score - a.score)
  return { nStudies: n, words }
}

// src/api.js — every data call goes through here (one endpoint, one function).
//
// Two data modes, chosen at build time:
//   api    (default)  talks to Tren's Flask server (/terms, /query/<q>/studies, /query/<q>/nii)
//   static            answers the same questions in the browser from the bundled Neurosynth
//                     snapshot in public/data  →  npm run dev:static / npm run build:static
import { loadNiftiUrl, writeNifti } from './lib/nifti'

export const DATA_MODE = import.meta.env.VITE_DATA_MODE === 'static' ? 'static' : 'api'
// Where the Flask API lives. Empty = same site (the Vite dev proxy forwards /terms and /query).
// Set at build time to call the server directly, e.g. VITE_API_BASE=https://hpc.psy.ntu.edu.tw:5000
// (app.py allows cross-origin requests, so a site hosted elsewhere, like Render, can call it).
const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')
const local = DATA_MODE === 'static' ? import('./lib/localEngine') : null
const enc = encodeURIComponent

async function getJSON (url, signal) {
  const res = await fetch(url, { signal })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
  return data
}
const abortable = (promise, signal) => (signal
  ? Promise.race([promise, new Promise((_, rej) => signal.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError')), { once: true }))])
  : promise)

// GET /terms  → every term in the vocabulary (fetched once, shared by all components)
let termsPromise = null
export function fetchTerms () {
  if (!termsPromise) {
    termsPromise = (local
      ? local.then(m => m.terms())
      : getJSON(`${API_BASE}/terms`).then(d => (Array.isArray(d?.terms) ? d.terms : [])))
      .catch(e => { termsPromise = null; throw e })
  }
  return termsPromise
}

// GET /terms/<term>?limit=n  → co-occurring terms ranked by Jaccard similarity
export async function fetchRelated (term, limit = 18, signal) {
  if (local) return abortable(local.then(m => m.related(term, limit)), signal)
  const d = await getJSON(`${API_BASE}/terms/${enc(term)}?limit=${limit}`, signal)
  return Array.isArray(d?.related) ? d.related : []
}

// GET /query/<q>/studies?r=  → study metadata (study_id is the PubMed ID)
export async function fetchStudies (query, { r } = {}, signal) {
  if (local) return abortable(local.then(m => m.studies(query, { r: r ?? 6 })), signal)
  const qs = r != null ? `?r=${r}` : ''
  const d = await getJSON(`${API_BASE}/query/${enc(query)}/studies${qs}`, signal)
  return Array.isArray(d?.results) ? d.results : []
}

// GET /query/<q>/nii  → meta-analytic map as a volume { data, dims, voxelMM, min, max }
export function niiUrl (query, { voxel = 2, fwhm = 10, kernel = 'gauss', r = 6 } = {}) {
  const sp = new URLSearchParams({ voxel, fwhm, kernel, r })
  return `${API_BASE}/query/${enc(query)}/nii?${sp}`
}
export async function fetchMap (query, params = {}, signal) {
  if (local) return abortable(local.then(m => m.map(query, params)), signal)
  return loadNiftiUrl(niiUrl(query, params), signal)
}
export async function downloadMap (query, params = {}) {
  const a = document.createElement('a')
  a.download = 'query_mixed_map.nii'
  if (local) {
    a.href = URL.createObjectURL(writeNifti(await fetchMap(query, params)))
    setTimeout(() => URL.revokeObjectURL(a.href), 10000)
  } else {
    a.href = niiUrl(query, params)
    a.download = 'query_mixed_map.nii.gz'
  }
  a.click()
}

// Terms that studies near a coordinate are about → { nStudies, words: [{ term, count }] }
export async function fetchTermsNear (loc, r, signal) {
  if (local) return abortable(local.then(m => m.termsNear(loc, r)), signal)
  // API mode: the server has no endpoint for this, so count vocabulary terms in the titles
  const [studies, vocab] = await Promise.all([fetchStudies(`[${loc.x},${loc.y},${loc.z}]`, { r }, signal), fetchTerms()])
  return { nStudies: studies.length, words: titleTermCounts(studies, new Set(vocab.map(t => t.toLowerCase()))) }
}

const GENERIC = new Set(`
a an and the of in on for to with by from at as is are be into during between within versus vs via
study studies brain human humans neural neuronal activation activity activations response responses
fmri functional magnetic resonance imaging mri pet meta analysis analyses effect effects evidence
role roles using use based cortex cortical region regions area areas network networks task tasks
healthy subjects participants adults individual individuals processing related correlates
differences difference changes during new test level high low large small early late two one
`.split(/\s+/).filter(Boolean))

function titleTermCounts (studies, vocab) {
  const counts = new Map()
  for (const s of studies) {
    const toks = `${s.title || ''}`.toLowerCase().replace(/[^a-z0-9\- ]+/g, ' ').split(/\s+/).filter(Boolean)
    const seen = new Set()
    for (let i = 0; i < toks.length;) {
      let hit = null
      for (let n = 3; n >= 1 && !hit; n--) {
        if (i + n > toks.length) continue
        const g = toks.slice(i, i + n).join(' ')
        if ((vocab.size ? vocab.has(g) : n === 1) && !GENERIC.has(g) && !/^\d/.test(g) && g.length > 2) hit = [g, n]
      }
      if (hit) { seen.add(hit[0]); i += hit[1] } else i++
    }
    for (const t of seen) counts.set(t, (counts.get(t) || 0) + 1)
  }
  return [...counts].map(([term, count]) => ({ term, count })).sort((a, b) => b.count - a.count)
}

export const pubmedUrl = (pmid) => `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`
export const doiUrl = (doi) => `https://doi.org/${doi}`

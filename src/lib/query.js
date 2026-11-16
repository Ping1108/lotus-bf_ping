// Small helpers for building LoTUS-BF query strings

const OPS = new Set(['AND', 'OR', 'NOT', '(', ')'])

/** Multi-word terms must be quoted, otherwise the backend splits them into word AND word. */
export const quoteTerm = (t) => (/\s/.test(t) ? `"${t}"` : t)

export const appendToken = (q, token) => (q ? `${q} ${token}` : token)

/** First [x,y,z] in a query, as numbers, or null. */
export function firstCoordinate (q) {
  const m = /\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/.exec(q || '')
  return m ? { x: Number(m[1]), y: Number(m[2]), z: Number(m[3]) } : null
}

/** First positive (non-negated) term in a query, unquoted, or ''. */
export function firstTerm (q) {
  const toks = (q || '').match(/\[[^\]]*\]|"[^"]+"|'[^']+'|\(|\)|[^\s()]+/g) || []
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    if (OPS.has(t.toUpperCase()) || t.startsWith('[')) continue
    if (toks[i - 1]?.toUpperCase() === 'NOT') continue
    return t.replace(/^["']|["']$/g, '')
  }
  return ''
}

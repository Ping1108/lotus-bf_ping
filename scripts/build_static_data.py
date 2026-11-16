#!/usr/bin/env python3
"""
Build the static data bundle used by LoTUS-BF's "static" mode (no database needed).

Reads the Neurosynth parquet files (same ones create_db.py loads into PostgreSQL)
and writes compact files to public/data/:
  terms.json    vocabulary, study counts, offsets into postings.bin
  postings.bin  Uint16 study indices for each term (abstract tf-idf > 0)
  related.json  top co-occurring terms per term (Jaccard, like GET /terms/<term>)
  meta.json     study metadata (PMID, year, journal, title, authors)
  coords.bin    Uint32 per-study offsets, then Int16 x,y,z (×10 mm) sorted by study

Usage: python scripts/build_static_data.py --data-dir path/to/parquets
"""
import argparse, json, os
import numpy as np, pandas as pd
from scipy import sparse

PREFIX = 'terms_abstract_tfidf__'
TOP_RELATED = 40

ap = argparse.ArgumentParser()
ap.add_argument('--data-dir', default='.')
ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'public', 'data'))
args = ap.parse_args()
os.makedirs(args.out, exist_ok=True)
rd = lambda f: pd.read_parquet(os.path.join(args.data_dir, f))

meta = rd('metadata.parquet').sort_values('study_id').reset_index(drop=True)
sid2i = {s: i for i, s in enumerate(meta.study_id.astype(str))}
n_st = len(meta)
assert n_st < 65536

# ---------- metadata ----------
with open(os.path.join(args.out, 'meta.json'), 'w') as f:
    json.dump({
        'pmid': meta.study_id.astype(str).tolist(),
        'year': meta.year.astype(int).tolist(),
        'journal': meta.journal.astype(str).tolist(),
        'title': meta.title.astype(str).tolist(),
        'authors': meta.authors.astype(str).tolist(),
    }, f, ensure_ascii=False, separators=(',', ':'))

# ---------- annotations → postings ----------
ann = rd('annotations.parquet')
ann['_i'] = ann.study_id.astype(str).map(sid2i)
cols = [c for c in ann.columns if c.startswith(PREFIX)]
names = [c[len(PREFIX):] for c in cols]
keep = [k for k, t in enumerate(names) if not t[:1].isdigit()]   # same filter as GET /terms
cols = [cols[k] for k in keep]; names = [names[k] for k in keep]
X = ann[cols].to_numpy(np.float32) > 0
rows = ann['_i'].to_numpy()
B = sparse.csc_matrix((np.ones(X.sum(), np.int32), (rows[np.nonzero(X)[0]], np.nonzero(X)[1])), shape=(n_st, len(names)))
order = np.argsort(names)
names = [names[k] for k in order]; B = B[:, order]

offsets, counts, chunks, off = [], [], [], 0
for j in range(B.shape[1]):
    idx = np.sort(B.indices[B.indptr[j]:B.indptr[j + 1]]).astype(np.uint16)
    offsets.append(off); counts.append(len(idx)); chunks.append(idx); off += len(idx)
np.concatenate(chunks).astype('<u2').tofile(os.path.join(args.out, 'postings.bin'))
with open(os.path.join(args.out, 'terms.json'), 'w') as f:
    json.dump({'terms': names, 'count': counts, 'offset': offsets, 'nStudies': n_st}, f, separators=(',', ':'))

# ---------- related terms (Jaccard) ----------
Bc = B.tocsc().astype(np.int32)
C = (Bc.T @ Bc).toarray()
n = np.diag(C).astype(np.float64)
J = C / np.maximum(1, n[:, None] + n[None, :] - C)
np.fill_diagonal(J, -1)
related = []
for i in range(len(names)):
    top = np.argsort(-J[i])[:TOP_RELATED]
    related.append([[int(t), int(C[i, t]), round(float(J[i, t]), 4)] for t in top if J[i, t] > 0])
with open(os.path.join(args.out, 'related.json'), 'w') as f:
    json.dump(related, f, separators=(',', ':'))

# ---------- coordinates ----------
co = rd('coordinates.parquet')
co['_i'] = co.study_id.astype(str).map(sid2i)
co = co.dropna(subset=['_i']).sort_values('_i')
si = co['_i'].astype(int).to_numpy()
starts = np.searchsorted(si, np.arange(n_st + 1)).astype('<u4')
xyz = np.round(co[['x', 'y', 'z']].to_numpy() * 10).astype('<i2')
with open(os.path.join(args.out, 'coords.bin'), 'wb') as f:
    f.write(starts.tobytes()); f.write(xyz.tobytes())

print(f'studies {n_st}, terms {len(names)}, postings {off}, coords {len(xyz)}')
for fn in sorted(os.listdir(args.out)):
    print(f'  {fn:14s} {os.path.getsize(os.path.join(args.out, fn)) / 1e6:6.2f} MB')

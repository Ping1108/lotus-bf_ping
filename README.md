nvm install --lts # for install the latest long-term-support version of node.js
rm -rf node_modules package-lock.json # delete all incompatible packages
npm install # reinstall every packages according to pacakge.json
npm run dev # for local development
npm run build # for server deployment; upload the ./dist folder to a server

# Backend address (optional): defaults to https://hpc.psy.ntu.edu.tw:5000
LOTUS_API=http://localhost:5000 npm run dev

## Deploying the API-mode frontend on Render (Static Site)
- Build command: `npm install && npm run build:render`
- Publish directory: `dist`
The page then calls https://hpc.psy.ntu.edu.tw:5000 directly (app.py has CORS enabled).

## Two data modes
- API mode (default: `npm run dev`, `npm run build`): talks to the Flask server (app.py) as before.
- Static mode (`npm run dev:static`, `npm run build:static`): no server or database needed.
  The same queries (terms, "phrases", prefix*, [x,y,z], AND/OR/NOT, parentheses) are answered
  in the browser from a compact Neurosynth snapshot in public/data
  (14,371 studies, 3,168 terms, 507,891 foci), built from the course parquet files with
  `python scripts/build_static_data.py --data-dir <folder with *.parquet>`.
  Terms match the abstract tf-idf annotations (Neurosynth's convention); words that are not
  in the vocabulary fall back to a title search. Maps use the same recipe as app.py
  (foci per voxel on the MNI152 2 mm grid, then Gaussian smoothing).
  `npm run build:static` makes a dist/ folder that can be hosted anywhere (Netlify, GitHub Pages).

## HW09 changes (frontend only; app.py is unchanged)

New features
- Concept galaxy (Studies | Concept galaxy tab): a force-directed map of terms that co-occur
  with the current term, built from the previously unused `/terms/<term>` endpoint (Jaccard).
  Click a star for details, double-click to grow its neighbours, drag, scroll to zoom,
  "Add to query" / "Center here".
- "What is studied here?": click anywhere on the brain (or type a coordinate) and a word cloud
  shows which terms the studies reporting activation within r mm of that point are about.
  In static mode words are sized by how much more often they occur near the point than across
  all studies (lift), a visual take on P(Term | Brain Activation). In API mode, by title counts.
  Clicking a word adds it to the query.

Fixes
- Gaussian FWHM: the map was re-fetched on every keystroke and an empty box became FWHM = 0.
  Now the value is validated (0 to 30 mm), debounced, and has a slider.
- Percentile threshold now ranks only voxels with signal, not the empty box around the brain.
- Out-of-date map requests are aborted, so a slow old map cannot replace a newer one.
- Query box no longer re-queries on every keystroke (commits after a pause or on Enter).
- Multi-word terms are quoted when added ("working memory" instead of working AND memory).
- A coordinate in the query now moves the crosshair to it.
- Brain slices keep their aspect ratio; overlay uses a hot colormap with a colour bar.
- Studies link to PubMed (study_id = PMID) and DOI.
- Tailwind classes were used but Tailwind was never installed; it is now (@tailwindcss/vite).
- The error screen in main.jsx used string styles, which React rejects; fixed.
- New lotus logo and layout; API calls collected in src/api.js (one endpoint, one component).

# archive/dead-patches

Orphan JS/CSS patches that are **not** loaded by root `index.html`.

## Why archived (not deleted)

- Historical wrappers from v36x–v39x / v310x / late v40x experiments.
- Unused `journey.js` (+ related fix wrappers) and other root orphans.
- **點到點 journey** and journey-side GMB paths were intentionally paused
  after reload-loop issues. Do **not** re-wire these into `index.html`
  without a focused recovery plan.
- Kept here for archaeology / possible future revive — not dead-deleted.

## Live app still loads (do not move)

`styles.css`, `journey.css` (styles only), `next-features.css`,
`build-guard.js`, `timetable.js`, `app.js`, `kmb-live.js`, `fare.js`,
`watch-sync.js`, `next-features.js`, `transit-extra.js`, `mtr-bus.js`,
`v400-progressive-engine.js`, `nearby.js`, `nearby-map.js`, `sw.js`.

Search / favorites / locate / ETA (including GMB in search) remain on those live modules.

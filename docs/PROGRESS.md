# Progress log — finishing Linksketch

Branch: `fable/finish` (never push or merge to `main`; the owner does that — it deploys).
Hand‑off prompt: `docs/FABLE_PROMPT.md`. Review: `docs/REVIEW.md`.

## Milestones

- [x] **1. Phase 0 review and fixes** — 20 findings fixed with regression tests
      (`tests/review.test.ts`), 7 left with reasons. 74 → 91 unit tests.
- [x] **2. Test infrastructure** — Playwright (`npm run e2e`, production build on port 4317),
      14 editor tests, GitHub Actions CI, `netlify.toml`. The build is now multi‑page:
      `site/build/generate.ts` writes pages into `.site/` (git‑ignored) and Vite builds from
      there; the editor is at `/linksketch/app/` (`site/app.html`).
- [~] **3. App features A1–A7** — all seven are built, unit-tested and e2e-tested:
      tee sets (`model/tees.ts`), hole pages + PDF (`export/`), course stats (`model/stats.ts`),
      presentation sheet + Text tool (`model/labels.ts`), crisp shapes (`render/crisp.ts`),
      PWA (`site/build/sw.ts`, manifest, icons), feedback link + storage reminder.
      Sample course: `scripts/make-sample.ts` → `public/samples/sample-course.fairway`.
      **Still to do here:** e2e test for File → Open sample course; on hole pages the
      "NN wide" label can overlap a strategy label, and the north-arrow "N" needs its
      position checked when the page is rotated; update docs/DESIGN.md roadmap.
- [ ] 4. Personal site + Linksketch section
- [ ] 5. Design polish
- [ ] 6. Quality bars (Lighthouse, a11y, weight)
- [ ] 7. Final verification + report

## Decisions (and why)

- **Layer hide/lock are saved but are not undo steps.** Undoing a quick peek under a
  layer would be annoying; Paint and Photoshop treat visibility the same way. Name,
  background, layer rename and outline switch *are* undo steps.
- **Undo memory budget = 256 MB**, oldest steps dropped first.
- **Hole tool beats shot targets** when both are under the pointer (otherwise aim points
  can't be moved while strategy is on).
- **File format stays version 1.** New fields (`teeSets`, `hole.tees`, `labels`) are
  optional and additive, so old files open unchanged and new files still open in the
  old app (which just ignores them).
- **Tee sets:** the first set always tees off from `hole.points[0]`; other sets store
  only their own tee point per hole (`hole.tees[setId]`) and share the rest of the line
  of play.

- **Build layout:** Vite's root is the generated `.site/` folder, so the repo root stays
  free of generated HTML. Unit tests have their own `vitest.config.ts`.
- **Old bookmarks of `/`:** the home page lives there now, so it can't redirect. The home
  page links to the editor and tells returning visitors their saved course is still
  there (same site → same browser storage; covered by an e2e test).

## Rules of the road

- Gate before every commit: `npm run typecheck && npm test && npm run build && npm run e2e`.
- Browser checks use the `test-sandbox` config (port 5174) or the Playwright server
  (port 4317). Never port 5173, never the owner's `fairway-paint` IndexedDB there.

## Where the session of 2026-11-12 stopped (usage limit)

Milestones 1–2 are committed and complete. Milestone 3 is committed in working order
(gate green) with the small leftovers listed above. Milestones 4–7 (the personal site,
design polish, Lighthouse, final report) are **not started**: `/` is still a placeholder
page from `site/build/generate.ts`. No fonts have been added yet.

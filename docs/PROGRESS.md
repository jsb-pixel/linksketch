# Progress log — finishing Linksketch

Branch: `fable/finish` (never push or merge to `main`; the owner does that — it deploys).
Hand‑off prompt: `docs/FABLE_PROMPT.md`. Review: `docs/REVIEW.md`.

## Milestones

- [x] **1. Phase 0 review and fixes** — 20 findings fixed with regression tests
      (`tests/review.test.ts`), 7 left with reasons. 74 → 91 unit tests.
- [ ] 2. Test infrastructure (Playwright + CI), and the move of the editor to `/linksketch/app/`
- [ ] 3. App features A1–A7
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

## Rules of the road

- Gate before every commit: `npm run typecheck && npm test && npm run build && npm run e2e`.
- Browser checks use the `test-sandbox` config (port 5174) or the Playwright server
  (port 4317). Never port 5173, never the owner's `fairway-paint` IndexedDB there.

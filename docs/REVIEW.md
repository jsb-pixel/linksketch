# Code review of Linksketch v0.5 (Phase 0)

Reviewed 2026‑11‑12 by Claude Fable 5.2, taking over from the earlier Opus 5.5 sessions.
Every source file was read in full.

**Baseline before any change:** `npm run typecheck` clean, `npm test` 74 / 74 passing,
`npm run build` clean (169 kB JS, 55 kB gzipped).

**Overall:** the foundations are sound. The document model, the undo system, the
rasterizer and the file format are well thought out and well tested. The bugs below are
mostly at the seams between features that were added in different sessions (strategy
targets were added after undo and resize were written, and neither was taught about
them).

Severity: **High** = loses or corrupts the owner's work, or a feature visibly doesn't do
what it says. **Medium** = wrong behaviour in a common situation. **Low** = edge case or
polish.

Regression tests are in `tests/review.test.ts`, named by finding number. R1 and R2 were
run against the old code and confirmed to fail there.

## Fixed

| # | Sev | Finding | Evidence | Fix |
|---|---|---|---|---|
| R1 | High | **Dragging a shot target could not be undone.** Same for "Aim at line of play" and double‑click reset. | `History.commit()` compared holes by `points`, `par` and `number` only, so a change to `hole.targets` looked like "nothing changed" and no undo step was recorded. | The comparison now includes `targets` (and the new `tees`). |
| R2 | High | **Resizing the course area left shot targets behind.** Growing the course left or up moved the holes but not their dragged targets. | `resizeDoc()` shifted `hole.points` only. | Targets (and tees, and text labels) are shifted too. |
| R3 | Medium | **Strategy odds went stale after editing a player.** Switching a player to left‑handed, or changing the tilt, kept showing the old percentages. | The odds cache key left out the pattern tilt; a lefty has the same centre and spreads as a righty. | New `shotKey()` includes the tilt. The cache is also cleared when a course is opened. |
| R4 | Medium | **Strategy menu showed stale player names**, and never showed a course's own players at all after a reload (the menu was built before the autosave was restored). | Menu items were built once at start‑up from `ed.players`. | A menu's items can now be a function, evaluated each time the menu opens. The Strategy menu uses that. |
| R5 | Medium | **Adding or deleting an aim point moved dragged targets onto the wrong shot.** | Targets are stored by shot number; the hole tool changed the points without renumbering them. | `targetsAfterPointInserted/Removed()` keep them aligned. |
| R6 | Medium | **Several edits were not undoable and some were never saved.** Course name and background (File → Course properties), renaming a layer and the outline switch had no undo. Hiding, locking or renaming a layer did not trigger an autosave, so they were lost on reload unless something else changed afterwards. | No history calls in those handlers; no `history` event emitted. | New `History.snapshotMeta()` makes name, background, layer names and outline switches undo steps. Hide/lock now save with the course (deliberately not undo steps — like Paint's view options, undoing a peek under a layer would be annoying). |
| R7 | Medium | **Undo history could grow without limit in memory.** Each whole‑course fill or resize keeps two copies of a paint layer; 200 of those on a ½‑yard course is several GB. | `History` only capped the number of steps (200). | Added a byte budget (256 MB). Oldest steps are dropped first; the newest is always kept. |
| R8 | Low | **Damaged files could poison a drawing.** Non‑numeric points became `NaN` and were kept; a file claiming a huge size would try to allocate it. | `deserialize()` used `+p[0]` unchecked and trusted `width × height`. | Non‑finite points are dropped, shapes with fewer than 3 points and holes with fewer than 2 are dropped, and oversize files are refused with a readable message. |
| R9 | Low | **A map tile that failed once never loaded again** until 400 other tiles pushed it out of the cache (e.g. after a Wi‑Fi blip). | Failures were cached as `'error'` permanently. | Failures remember when they happened and are retried after 15 s. |
| R10 | Low | **The canvas could get stuck in pan mode.** Holding Space and switching windows lost the key‑up. | `spaceHeld` was only cleared on `keyup`. | Cleared on window `blur` too. |
| R11 | Medium | **Dialogs and menus were not accessible.** Dialogs had no dialog role or label, did not trap Tab, did not return focus, and Escape only worked while the focus was inside. Menus were mouse‑only `div`s. | `ui.ts` `dialog()` and `buildMenuBar()`. | Dialogs: `role="dialog"`, `aria-modal`, labelled by their title, focus trap, focus restored on close, Escape from anywhere. Menus: real buttons with menu roles; Enter/Space/arrows/Home/End/Escape work. Tool buttons have `aria-label` and `aria-pressed`. Covered by end‑to‑end tests. |
| R15 | Low | **Exporting a very large PNG failed silently** (Safari returns nothing above its canvas limit). | `c.toBlob((b) => b && download(…))`. | Size is checked first (`fitsCanvas()`), and an empty result now explains itself. |
| R16 | Medium (speed) | **Every undo re‑rendered the whole course** — about a quarter of a second on an 18‑hole course (measured: 235 ms for 2300 × 960 yd with 300 shapes). | `Editor.undo()` called `invalidate()` with no rectangle. | Undo/redo of a paint‑only step re‑renders just the stroke's rectangle (`History.lastRect`). |
| R18 | Low | **"All players" buried the hole under labels.** | Three players × three shots of long labels. | With more than one player shown, labels are short ("235 · 18%"). Full detail stays in the Info panel. |
| R22 | Low | **Shapes on a layer that was just locked or hidden could still be moved** if they were part of a multi‑selection. | The lock/hide handlers only cleared the selection when the *primary* shape was on that layer. | `dropSelectionOnLayer()` removes them from the selection. |
| R26 | Low | **Resizing the course with a rotated view made everything jump.** | `resizeCourse()` adjusted the pan as if the view were north‑up. | `panAfterOriginShift()` rotates the correction. |
| R27 | Low | **Underlay images were never released.** Each is a multi‑MB data URL kept in a module cache for the life of the tab. | `underlay.ts` cache had no eviction. | Pruned to the open course's images when a course is opened. |
| R28 | Medium | **With strategy on, the Hole tool could not move aim points or the green.** A shot's oval centre sits exactly on its aim point, and the oval won the click. | `hitShot()` was tested before the tool. | Tools can now claim a handle (`Tool.claims`); the Hole tool's own points win. Targets are still draggable with the Select tool, and with the Hole tool wherever they aren't on a hole point. |
| R29 | Low | **Strategy player choice could point at a player that isn't in the course**, leaving the picker blank. | `strategyPlayer` is a browser preference; players are per course. | `activeStrategyPlayer` falls back to the first player. |
| R30 | Low | About box said v0.4. | Hard‑coded string. | `src/version.ts`. |
| R31 | Low | **A click with one tool could count as the first half of a double‑click with the next.** Found by the end‑to‑end tests: finishing a hole on the green, switching to Select and pressing on the same spot within 0.4 s reset the shot target instead of dragging it. | `lastClick` survived a tool change. | Reset in `setTool()`. Covered by the strategy end‑to‑end test. |
| R14 | Low | **The last 1.5 s of work could be lost on closing the tab.** | Autosave is debounced and nothing flushed it. | Flushed on `pagehide` and when the tab is hidden. |

## Checked and found correct

- **Multi‑select and Combine shapes.** Selection survives undo/redo (`validateSelection`),
  group drags are one undo step, Combine keeps draw order and reports shapes that don't
  touch. No change.
- **Faded‑satellite tile seam fix.** The off‑screen pass carries the view transform, and
  the doc clip is still applied when the result is drawn back. Correct.
- **Detail level change, including undo with terrain.** `setDetail` makes a new terrain
  object that shares the height array; the whole‑doc snapshot restores the old object and
  bumps its revision so render caches refresh. Sculpt steps before and after a detail
  change undo in the right order. 1 → ½ → 1 is lossless. Correct.
- **Strategy target dragging** — correct apart from R1, R2, R5 and R28.
- **Players dialog** — values are validated on load (`parsePlayers`), and Reset is an undo step.
- **Label collision** — labels slide past each other; fine for one player (see R18 for several).
- **Listeners.** The app builds its UI once and never tears it down, so nothing leaks.
  Tool timers (spray, terrain) are cleared on pointer‑up and on cancel.
- **Edge cases.** Empty course, a hole with only tee and green, ½‑yard detail, courses
  with no terrain or no map placement: all handled. Rotated views: see R26.

## Left as is (with reasons)

| # | Finding | Why it stays |
|---|---|---|
| L1 | `editor.ts` is ~1,900 lines. | It is cohesive (one class owning the view) and well covered. Splitting it is style churn with real regression risk. New features went into their own modules instead (`model/tees.ts`, `model/stats.ts`, `export/…`). |
| L2 | `visibleCodes()` composites the whole course. | Measured 41 ms on an 18‑hole course with 300 shapes; it runs at most 3×/s and only while strategy is showing or on a Fill click. Not worth caching per region. |
| L3 | A full re‑render is ~235 ms on an 18‑hole course. | Now only happens for whole‑course changes (theme, resize, opening a file, undo of a shape edit). A brush dab re‑renders in 0.6 ms. |
| L4 | The first terrain brush stroke makes two undo steps ("Start terrain", "Shape terrain"). | Harmless and arguably clearer. |
| L5 | Fill writes to the active paint layer even when a layer above hides the result. | Matches the documented design ("written to the active paint layer"). |
| L6 | The editor page sets `user-scalable=no`. | Needed so pinch zooms the course rather than the page. The marketing/site pages do not set it. |
| L7 | Public Nominatim search and Esri imagery. | Licensing notes stand: Nominatim needs a paid geocoder before commercial use; Esri is personal‑use only and keeps its warning. Not changed. |

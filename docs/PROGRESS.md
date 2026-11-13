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
- [x] **3. App features A1–A7** — tee sets (`model/tees.ts`), hole pages + PDF (`export/`),
      course stats (`model/stats.ts`), presentation sheet + Text tool (`model/labels.ts`),
      crisp shapes (`render/crisp.ts`), PWA (`site/build/sw.ts`, manifest, icons), feedback
      link + storage reminder. Sample course: `npm run sample` → `public/samples/`.
- [x] **4. Personal site + Linksketch section** — `site/build/generate.ts` builds every page
      from `content/`. Home, About, Projects, Courses, Writing (+ tags, RSS), Linksketch
      page, 14-chapter manual, 404, sitemap, robots.
- [x] **5. Design polish** — two moods in one stylesheet (`site/styles/site.css`); hand-written
      isometric SVG figures (`site/build/illustrations.ts`); screenshots from the real app
      (`npm run shots`); self-hosted OFL fonts (`npm`-sourced, `scripts/copy-fonts.mjs`).
- [x] **6. Quality bars** — Lighthouse (mobile preset, production build), 2026-11-13:

      | Page | Performance | Accessibility | Best practices | SEO |
      |---|---|---|---|---|
      | `/` | 100 | 100 | 100 | 100 |
      | `/linksketch/` | 98 | 100 | 100 | 100 |
      | `/linksketch/manual/how-the-shot-pattern-is-modeled/` | 99 | 100 | 100 | 100 |
      | `/writing/` | 99 | 100 | 100 | 100 |
      | `/linksketch/manual/` | 98 | 100 | 100 | 100 |

      Home page weight is checked by an e2e test (< 1.5 MB with everything loaded).
- [x] **7. Final verification** — see the last commit message for counts.

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

## For the owner

- Everything personal is a `TODO(owner)` placeholder in `content/` (shown highlighted in
  yellow on the site). Search the folder for `TODO(owner)` to find them all.
- To add a course to the gallery: export a PNG from Linksketch, put it in
  `public/courses/`, and add an entry to `content/courses.json`.
- To write a post: add a Markdown file to `content/writing/` named
  `YYYY-MM-DD-some-title.md` with the same header lines as the existing ones.
- The site's address for the RSS feed and sitemap comes from `content/site.json` (`url`),
  or from the host automatically on Netlify / Cloudflare Pages.
- Lighthouse was run with Lighthouse 11 through its Node API against `scripts/serve.mjs`,
  because the Lighthouse command-line tool refuses to start on this Mac's Intel build
  of Node. Installing an Apple-silicon Node would let `npx lighthouse` run directly.

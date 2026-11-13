# Prompt: finish Linksketch (for Claude Fable 5.2)

Paste everything below the line into a new Claude Code session opened in `~/Game`.

---

You are taking over **Linksketch**, a browser‑based golf‑course design tool, and your job
is to **finish it**: review and harden what exists, complete the remaining features, and
build the owner's **personal website**, with Linksketch living inside it as their featured
project. You own this end to end. Work autonomously until
every outcome in "Definition of done" is met and verified. Do not hand back a plan, a
partial result or a list of suggestions when you could have done the work yourself.

## 1. Who you're working for

- The owner designs golf courses (previously in jspaint) and is **not an experienced
  programmer**. Explain decisions in plain language, briefly. They want you to make the
  technical calls ("be the boss") and to favor solid foundations over rushing.
- They love the app's **simple, jspaint / Windows‑98 style UI**. Keep the editor's chrome
  simple and familiar. Do not redesign it into a modern dashboard. New editor features
  must fit the existing menus, toolbox, Info panel and dialogs.
- Mac with mouse/trackpad first. US courses only. Fictional courses supported.
- They prefer painting and outlining with the brush over freehand shapes.

## 2. What exists (read before touching anything)

Read `README.md` and `docs/DESIGN.md` first. Then skim the code map below. All of it
was built by Claude Opus 5.5 over earlier sessions.

- **Stack:** Vite 5, TypeScript 5 (strict), Vitest. No UI framework. Win98‑style CSS
  in `src/styles.css`.
- **Doc model** (`src/model/`):
  - World units are yards. The pixel grid is `yardsPerPixel` (½, 1 or 2).
  - Paint layers store surface codes in a `Uint8Array`.
  - Shape layers hold vector features.
  - Holes are polylines (tee → aim points → green), plus optional per‑shot strategy
    `targets`.
  - Undo is `History` with snapshots; every edit must be one undoable step.
  - The `.fairway` JSON file format lives in `io.ts`. **Keep it backward‑compatible.**
    The internal ID `fairway-paint` is deliberate.
- **Editor** (`src/editor/`):
  - `editor.ts` holds the view, transform, rotation, input, drawing and selection.
  - `tools.ts` holds all the tools.
  - `holes.ts`, `maptiles.ts`, `underlay.ts`, `cursors.ts`.
- **Rendering** (`src/render/`): scanline raster with Paint‑style outlines, and regions
  (flood, trace).
- **Geo, terrain:**
  - `src/geo/`: lat/lon ↔ yards.
  - `src/terrain/`: USGS 3DEP elevation, hillshade, contours, sculpt brush.
- **Strategy mode** (`src/strategy/`): shot patterns per player, in yard widths, tilted
  short‑right → long‑left, with hazard odds. Draggable shot targets.
- **Geometry** (`src/geom/combine.ts`): shape union via sub‑pixel mask.
- **UI glue:** `src/ui/ui.ts` (panels, dialogs) and `src/app.ts` (menus, keys, file
  I/O, autosave to IndexedDB, PNG export).
- **Tests:** `tests/*.test.ts`, 74 passing at hand‑off.
- **Hosting:** the repo is `github.com/jsb-pixel/linksketch`, branch `main`. Netlify
  deploys from it, but there is **no `netlify.toml` yet**.

## 3. Phase 0: review what Opus 5.5 built (do this first)

1. **Baseline.** Run `npm install`, `npm run typecheck`, `npm test`, `npm run build`.
   Record the results.
2. **Review the code** like a senior engineer taking ownership. Look for:
   - correctness bugs;
   - undo/redo gaps;
   - save/load round‑trip losses;
   - edge cases: empty docs, huge docs, ½‑yd detail, rotated views, a hole with 2
     points, missing terrain or geo;
   - performance traps on a real 18‑hole course (~2300 × 960 yd with ~300 shapes);
   - leaked listeners;
   - accessibility of dialogs.

   Give extra scrutiny to the newest work:
   - multi‑select and Combine shapes;
   - the faded‑satellite tile seam fix;
   - File → Detail level change (including undo with terrain present);
   - strategy mode: odds caching, label collision, target dragging, the Players dialog.

   Known soft spots to check:
   - Menus are built once, so player names in the Strategy menu may go stale.
   - `editor.ts` is large.
   - "All players" view clutter.
   - `visibleCodes()` cost on big docs.
3. **Write `docs/REVIEW.md`.** List each finding with severity, evidence and the fix (or
   why you left it).
4. **Fix every real bug**, each with a regression test that fails before the fix and
   passes after. Refactor only where it removes real risk. Do not churn working code
   for style.

## 4. Definition of done (outcomes)

### A. The app is complete and solid

Finish the roadmap in `docs/DESIGN.md`. Each item must be undoable, saved in the file
where relevant, and covered by tests.

1. **Multiple tee sets per hole.**
   - Sets like Back / Middle / Forward, each with its own tee point and yardage.
   - A scorecard column per set.
   - Sets are named and colored per course.
2. **Hole pages.**
   - Export one hole as a yardage‑book page: tee at the bottom, distances to hazards,
     carries, fairway width at the landing zone, and the strategy patterns if they
     are on.
   - Export as PNG, and "all holes" as a multi‑page PDF or a zip of PNGs.
3. **Course stats:** acres per surface, square feet of greens, bunker count, total
   yardage per tee set. Shown in the Info panel and exportable.
4. **Presentation export:** title block, north arrow, scale bar, legend of the surfaces
   actually used, and optional text labels (a simple Text tool).
5. **"Crisp shapes" view option:** shapes drawn as smooth curves at screen resolution
   when zoomed in. Paint stays pixelated. Off by default.
6. **Installable web app (PWA):**
   - manifest and icons;
   - service worker that caches the app shell (never map tiles or USGS data);
   - works offline except for maps and terrain.
7. **Help → Send feedback** (mailto or a GitHub issue link), and a visible reminder that
   work is stored in this browser, so use File → Save to keep a copy.

### B. The owner's personal website, with Linksketch living inside it

The site is **the owner's personal page first**: who they are, what they make, what they
write. **Linksketch is their featured project inside it**, with its own section, manual
and devlog, and the editor itself runs within the site.

Build it as one static, multi‑page Vite build in this repo. URL structure:

| Path | What it is |
|---|---|
| `/` | Personal home page |
| `/about/` | About the owner |
| `/projects/` | Everything they've made, Linksketch first |
| `/courses/` | Gallery of the owner's golf course designs |
| `/writing/` | Posts and devlogs, with an RSS feed |
| `/linksketch/` | Linksketch project page |
| `/linksketch/manual/…` | The reference manual |
| `/linksketch/app/` | The editor itself |

- The editor must keep working at `/linksketch/app/` with its autosave and file handling
  intact. The site stays on the same domain, so the owner's existing autosave carries
  over; verify that it does.
- The live site currently serves the editor at `/`, so add a redirect or a clear link so
  people who bookmarked it can still find it.
- The repo is named `linksketch`. Leave the name alone; renaming it or splitting the site
  into its own repo is the owner's call. Mention it in your final report.

**Content model.** This follows bybrooklyn.dev: a personal, honest maker's site in the
owner's own voice. It is not a corporate page.
- **Home**, in order:
  1. A short first‑person intro: who they are, that they design golf courses, what
     they're making now.
  2. **"Working on"**: project cards with an image, a name, a one‑line evocative pitch
     and a small honest status label (*released*, *beta*, *in development*). Linksketch
     is first and most prominent. Add `TODO(owner)` placeholder cards for other
     projects.
  3. **Courses**: a strip of the owner's course designs, linking to `/courses/`.
  4. **Minis**: small live toys built from the real Linksketch code. For example:
     - drag a shot‑pattern oval over a bunker and watch the odds change;
     - paint on a tiny pixel green;
     - a yardage‑arc ruler.
  5. **Writing**: the latest post or devlog entry.
  6. A footer with GitHub, RSS, contact, a "no tracking" note, the license, and **"built
     from commit `<hash>` on `<date>`"**, injected at build time.
- **About**: the owner's story in first person, plus a quick‑facts block (location, what
  they do, contact).
- **Projects**: every project with a type tag and a status label. Linksketch links to its
  section.
- **Courses**: a gallery of the owner's designs. Each one has a cover image, a name, a
  location (or "fictional"), a hole count and a short note.
  - Drive it from a simple data file (e.g. `content/courses.json`) plus images in
    `public/courses/`, so the owner can add designs without touching code.
  - Seed it with the sample course you build, and add `TODO(owner)` entries for their
    real ones.
- **Writing**:
  - Dated posts with tags and read time, stored as Markdown in `content/writing/` and
    rendered at build time.
  - Seed it with Linksketch devlog entries generated from the version history in
    `docs/DESIGN.md` and the git log (v0.1 → now), tagged `linksketch`.
  - An RSS feed generated at build time.
- **Linksketch section** (`/linksketch/`):
  - A project landing page with a one‑paragraph pitch, a big "Open Linksketch" button,
    screenshots and feature cards with status labels.
  - The **manual**, in the style of makingsoftware.com: a table of contents grouped into
    parts (Drawing, Holes & Yardage, Maps & Terrain, Strategy, Exporting), one page per
    topic, numbered figures ("FIG. 3.2") and short plain‑language explanations. Topic
    examples: how scale works, how the shot pattern is modeled, why the oval tilts, how
    hazard odds are counted.
  - A link to its devlog, which is the `linksketch` tag in Writing.
- **Do not invent personal facts about the owner.** Anything personal — name, bio,
  location, other projects, real course designs, contact details, photos — gets a
  clearly marked `TODO(owner)` placeholder in their voice. List every placeholder in your
  final report. Their GitHub handle is `jsb-pixel`; use only that.
- **No analytics, no trackers, no cookie banners.**

**Design language.** Blend two references into one coherent system. Do not copy their
code, text, images or fonts.

From **auge‑xp.com** (Awwwards Site of the Day), the structure and confidence:
- A warm off‑white page (`#EDEEE5`) with pure black (`#000000`) text. Color comes only
  from imagery.
- Huge, heavy, tightly‑set uppercase display type, stacked in short lines (e.g. a
  massive name across the hero: the owner's name on Home, a placeholder until they
  provide it, and "LINKSKETCH" on the project page).
- A small uppercase sans for labels and nav.
- Full‑bleed image/video cards in a gallery row. Each card has a large uppercase title
  and a tiny uppercase category tag beneath.
- Minimal navigation: a small menu button, plus a sparse footer bar with small
  uppercase links separated by thin pipes.
- Restrained, smooth motion: scroll‑revealed cards, hover zoom on media, gentle page
  transitions. **All motion must respect `prefers-reduced-motion`.**

From **makingsoftware.com**, the content pages:
- A reference‑manual layout on near‑white (`#FBFBFB`).
- A pixel/bitmap‑style wordmark.
- Dotted or dashed horizontal rules.
- Serif body text for long reading. Small monospace annotations like `FIG. 2.1` and
  `[ SHOT PATTERN ]`, set vertically along figure edges.
- **Isometric line‑art technical illustrations** in a single blue (around `#2B4BFF`)
  with light blue fills.
- A dense table of contents with per‑chapter metadata.

**Make it Linksketch's own:**
- The illustrations are golf: an isometric green complex with bunkers, a tee box, a
  flagstick, shot‑pattern ovals, contour lines, and a pixel brush.
- Draw them as **hand‑authored SVG**, rather than image files.
- The personal pages use the same system, but quieter: the auge‑style big type and
  gallery for Home, Projects and Courses, and the manual style for Writing and the
  Linksketch manual. It should feel like one person's site, with Linksketch's pixel
  flavor showing up in the parts about Linksketch.
- Linksketch imagery uses **real screenshots and exports of the app**, captured
  with Playwright from a bundled **fictional sample course** that you design in the
  app. Ship that course as `public/samples/*.fairway`, and offer "Open sample course"
  in the app.
- **Never use Esri satellite imagery anywhere on the site.** Its license is personal
  and non‑commercial. Show painted courses instead.
- The pixel‑art look of the app should be visible in the site: the pixel wordmark, and
  screenshots shown crisp with `image-rendering: pixelated` where they're enlarged.

**Fonts.** Use only free, self‑hosted fonts under the SIL OFL or a similar license, kept
in `public/fonts`, with no Google Fonts requests at runtime. Suggested set:
- a heavy grotesk for display, such as Archivo or Inter Tight at 800–900;
- a clean sans for UI;
- a readable serif for manual pages, such as Newsreader or Source Serif;
- a monospace for annotations;
- a pixel font for the wordmark, such as Silkscreen.

**Quality bars for the website:**
- Lighthouse ≥ 90 for Performance, Accessibility, Best Practices and SEO on Home, the
  Linksketch page and one manual page. Measure it and report the numbers.
- WCAG AA contrast and keyboard navigable.
- Responsive from 360 px to wide desktop.
- Total home page weight under ~1.5 MB.
- Real `<title>`/meta/Open Graph tags, a sitemap, and a 404 page.

**Hosting:**
- Add `netlify.toml`: build command, publish dir, a redirect so old bookmarks of the
  editor reach `/linksketch/app/`, and cache headers for hashed assets.
- Keep it portable to Cloudflare Pages: no host‑specific runtime features.

### C. Automated tests are mandatory and green

1. Add **Playwright** end‑to‑end tests with an `npm run e2e` script. They run against a
   production build served on a dedicated port (not 5173 or 5174).
2. **App smoke tests:**
   - the editor loads with no console errors;
   - paint with the brush;
   - draw and Combine shapes;
   - add a hole and check its yardage;
   - toggle strategy and see the odds appear;
   - drag a shot target;
   - change the detail level, then undo;
   - Save → reopen round trip;
   - export PNG;
   - load the sample course.
3. **Website tests:**
   - every page renders with no console errors, including `/about/`, `/projects/`,
     `/courses/`, `/writing/` and the Linksketch section;
   - the editor works when loaded from `/linksketch/app/`;
   - every internal link resolves;
   - the RSS feed and sitemap are valid;
   - mini demos respond to input;
   - reduced‑motion mode disables animation.
4. **Unit tests** (Vitest) for every new pure function: tee‑set math, stats, page
   layout, and so on. Keep existing tests green. **Never** delete, skip or weaken a
   test to make it pass. Fix the code, or fix a test that is genuinely wrong, and say
   which in the commit message.
5. Add **GitHub Actions CI**: install, typecheck, unit, build, e2e on every push and PR.
6. **The gate before every commit:**
   `npm run typecheck && npm test && npm run build && npm run e2e`, all passing.

## 5. How to work

**Keep a running log.** Maintain `docs/PROGRESS.md` with what's done, what's next, and
the decisions you made and why. Update it at each milestone, so the work can continue
cleanly after a context reset.

**Milestones, in order:**
1. Phase 0 review and fixes.
2. Test infrastructure (Playwright + CI).
3. App features A1–A7.
4. Personal site structure and content, then the Linksketch section inside it.
5. Design polish.
6. Quality bars.
7. Final verification.

**Git:**
- Work on a branch `fable/finish`.
- Commit after each milestone, with clear messages, once the gate is green.
- Push the branch.
- **Do not push to or merge into `main`.** That deploys to the live site, so the owner
  merges it.
- End commit messages with your model attribution line.

**Errors are yours to solve.** For build failures, type errors, failing tests, flaky
selectors, dependency conflicts, port clashes and the like:
1. Read the actual error.
2. Find the root cause.
3. Fix it.
4. Re‑run.

If an approach fails three times, step back and try a different one. Don't stop to ask
about routine engineering problems. Never paper over a failure: no `any` casts to
silence the type checker, no `@ts-ignore`, no `.skip`, no catch‑and‑ignore.

**Verify in a real browser**, not just in tests:
- Use the `test-sandbox` launch config (port 5174) or your Playwright server.
- **Never** drive the owner's dev server on port 5173, and never clear or overwrite
  their IndexedDB autosave (db `fairway-paint`). They use it for real work.

**Dependencies:** keep them few and mainstream (Playwright, maybe a tiny PDF or zip
library). No UI framework for the editor. A framework for the website is only allowed
if it clearly earns its weight, and plain Vite multi‑page HTML/TS is preferred.

**Licensing:**
- USGS imagery and elevation are public domain.
- Esri World Imagery is personal‑use only, so keep its warning.
- Nominatim search needs a paid geocoder before any commercial use. Note it; don't
  switch providers.

## 6. Stop only for deliberate blockers

Pause and ask the owner **only** for:
- anything needing their accounts, credentials or money: domain purchase, Netlify or
  Cloudflare settings, Apple or Windows code signing, an Esri license, a paid geocoder;
- personal facts for the site: bio, other projects, real course designs, photos,
  contact details (use placeholders and keep going; ask at the end);
- destructive or irreversible actions: force‑push, rewriting history, deleting
  branches, merging to `main`, deleting user data;
- a product decision that would change how existing courses look or behave for the
  owner, such as changing the file format incompatibly or changing default colors.

For everything else, decide, document the decision in `docs/PROGRESS.md`, and keep
going. If you hit a blocker, finish every other piece of work that doesn't depend on it
before you stop.

## 7. Final report

When everything is done, reply with:
1. **What was built.** A short list per outcome (A, B, C), with links to the key files.
2. **Review findings.** What was wrong in the earlier code and how you fixed it (point
   to `docs/REVIEW.md`).
3. **Verification.** Exact commands run and their results: test counts, e2e results,
   Lighthouse scores per page.
4. **What the owner must do:**
   - merge `fable/finish`;
   - fill in the `TODO(owner)` items: bio, projects, courses, contact;
   - decide whether to rename the repo or move the site to its own repo;
   - any account or license steps.
5. **Anything not done or not verified.** State it plainly, with the reason.

# Linksketch

A Paint-style pixel-art golf course designer, and the personal website it lives in.
See [docs/DESIGN.md](docs/DESIGN.md) for the design and [docs/PROGRESS.md](docs/PROGRESS.md)
for what's done and why.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173 — the site; the editor is at /linksketch/app/
```

```bash
npm test           # unit tests (Vitest)
npm run e2e        # end-to-end tests (Playwright) against a production build
npm run build      # typecheck + production build into dist/
npm run gate       # everything above, in order — run before every commit
```

## Code map

| Folder | What lives there |
|---|---|
| `src/model` | Course data: types, surfaces (palette), undo history, file format + autosave |
| `src/geom` | Geometry: simplification, splines, areas, hit tests |
| `src/render` | The pixel rasterizer (scanline fill + Paint-style outlines) |
| `src/editor` | Editor core (view, input, rendering loop) and all tools |
| `src/ui` | Menus, toolbox, palette, layers, info panel, dialogs |
| `src/strategy`, `src/terrain`, `src/geo` | Shot patterns, elevation, map placement |
| `site` | The website: page generator, templates, styles |
| `content` | Words and data for the site (posts, courses, manual) |
| `tests` | Vitest unit tests |
| `e2e` | Playwright end-to-end tests |

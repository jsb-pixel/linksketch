# Linksketch

A Paint-style pixel-art golf course designer. See [docs/DESIGN.md](docs/DESIGN.md) for the plan.

## Run it

```bash
npm install
npm run dev        # open http://localhost:5173
```

```bash
npm test           # unit tests
npm run build      # typecheck + production build into dist/
```

## Code map

| Folder | What lives there |
|---|---|
| `src/model` | Course data: types, surfaces (palette), undo history, file format + autosave |
| `src/geom` | Geometry: simplification, splines, areas, hit tests |
| `src/render` | The pixel rasterizer (scanline fill + Paint-style outlines) |
| `src/editor` | Editor core (view, input, rendering loop) and all tools |
| `src/ui` | Menus, toolbox, palette, layers, info panel, dialogs |
| `tests` | Vitest unit tests |

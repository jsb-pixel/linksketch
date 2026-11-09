# Fairway Paint — Design Doc

_Working name. Living document — update it when a decision changes._

## 1. Product in one sentence

An MS‑Paint‑simple, pixel‑art drawing tool for designing golf courses, that also
*understands* what it draws (fairways, greens, bunkers, holes, distances, terrain)
so it can measure, overlay real land, and analyze strategy.

## 2. Guiding principles

1. **Paint first.** Opening the app should feel like jspaint: a toolbox, a palette,
   a canvas. No sign‑up, no wizard. Every advanced feature is optional.
2. **Pixel look, real data underneath.** Everything renders as crisp, palette‑limited
   pixels — but shapes are stored as editable geometry with a type.
3. **Real units from day one.** The document is in **yards**. Every pixel has a
   known size, so a ruler, yardages and later real‑world overlays need no
   "calibration" for fictional courses.
4. **Nothing is a dead end.** A freehand scribble can become an editable shape; a
   shape can be reshaped by dragging points; everything undoes.
5. **Offline & local by default.** Works without an account; files are the user's.

## 3. Platform decision

**Web app (TypeScript + HTML Canvas, built with Vite).** Mac + mouse/trackpad first.

- Runs in Safari/Chrome on macOS today, iPad later (Pointer Events already cover
  Apple Pencil — we use them from the start so pen support isn't a rewrite).
- Can be wrapped as a native Mac/Windows app later with **Tauri** (small, fast) for
  Steam / Mac App Store distribution, reusing 100% of the code.
- No UI framework for the editor: the canvas is the product and the chrome is small.
  Plain TypeScript keeps it fast and dependency‑light. (A framework may be used for
  the future website — gallery, accounts — which is a separate surface.)

## 4. Core architecture

```
            ┌──────────────── Document (pure data, serializable) ─────────────┐
            │ settings: yardsPerPixel, size, background, palette              │
            │ layers[]: Underlay | Raster(paint) | Vector(features) | Holes   │
            │ holes[]: number, par, tee/green, centerline                     │
            └──────────────────────────────────────────────────────────────────┘
                     ▲ mutations only via History (undoable)
   Tools ────────────┘                     │
 (pointer events → edits)                  ▼
                               Rasterizer (doc pixels, typed arrays)
                                           │  dirty‑rect re‑render
                                           ▼
                        Offscreen "doc canvas" (1 px = 1 doc pixel)
                                           │  drawImage, smoothing OFF
                                           ▼
                     View (pan/zoom) + Overlays at screen res
                     (selection handles, ruler, cursors, grid)
```

### 4.1 Coordinates
- **World units = yards.** Origin at the top‑left of the document; +x right, +y down.
- **Doc pixel grid**: `yardsPerPixel` (default **1.0**; 0.5 for "detail" docs).
  A 1 yd pixel matches the scale of hand‑drawn Paint courses (a green ≈ 30 px).
- Vector geometry is stored in **yards** (resolution‑independent).
  Raster paint is stored in **doc pixels** (it *is* pixels).
- Later, `doc.geo = { origin: lat/lon, rotationDeg }` maps yards ↔ lat/lon for
  satellite and elevation overlays. Fictional courses just don't set `geo`.

### 4.2 Surfaces & palette
A **surface** is a golf‑meaningful material: Fairway, Green, Tee, Bunker, Waste,
Water, Fescue, Rough (2nd cut), Trees, Path, Out‑of‑bounds, plus plain colors.
Each surface has: fill color, optional outline, optional pixel pattern (water
ripples, fescue speckle) and a z‑priority (green draws above fairway, bunker
above both, …). Patterns are deterministic per world pixel so they never "swim".

Raster layers store **palette indices** (Uint8, 0 = transparent), not RGB. This
enforces the retro palette and lets a theme recolor the whole course.

### 4.3 Vector features
```ts
Feature { id, surface, points: Vec2[] /* yards */, closed, smooth, holeId? }
```
- `smooth: true` renders through a closed Catmull‑Rom spline → organic golf shapes
  from few control points. Control points are what the user drags.
- Created by: **Freehand Shape** (draw a loop → simplified with Ramer–Douglas–Peucker
  → editable shape), **Polygon** (click points), later **Trace** (convert painted
  pixels into a shape).

### 4.4 Rendering ("the pixel look")
We rasterize ourselves (scanline fill) instead of using canvas paths, because
canvas anti‑aliases edges and blurs the palette. Per dirty rect:
1. Clear to background.
2. For each layer bottom→top: raster layers blit palette indices; vector layers
   scanline‑fill each feature (z‑sorted by surface priority, then creation order)
   into a feature‑id buffer.
3. Outline pass: a pixel becomes the outline color where its feature differs from a
   lower neighbor (4‑connected) and the surface wants an outline → the black
   "Paint" outlines seen in hand drawings, always 1 px, at any zoom.
4. Write RGBA into the doc canvas; the view scales it with smoothing **off**.

Only the dirty rectangle is re‑rasterized on edits, so dragging a point is cheap.

### 4.5 History (undo/redo)
One entry per user gesture. Entry = vector snapshot before/after (small) + raster
patches (dirty rect before/after bytes). Unlimited within a memory budget.

### 4.6 Files
- `.fairway` file = JSON (`version`, settings, layers, holes). Raster layers are
  stored as run‑length‑encoded base64. Versioned with migrations from day one.
- Autosave to IndexedDB every few seconds; "Open recent".
- Export PNG at 1×/2×/4× pixel scale.

## 5. Tools (v0.1)

**Painting is the primary workflow** (user preference): brush is the default tool, painted
surfaces get automatic Paint‑style outlines (per‑layer toggle), right‑click paints a
second surface (X swaps), and every smart feature must work on painted pixels too.
Shapes are optional, for when drag‑point editing is wanted.

| Tool | Key | Behavior |
|---|---|---|
| Select / Edit points | V | Click shape to select; drag shape; drag points; click on an edge to insert a point; ⌫ deletes point/shape |
| Freehand Shape | F | Draw a loop with the current surface → editable shape. Hold ⌘ to edit points without switching tools (plain drags always draw — decided after testing: handles intercepting new loops was confusing) |
| Polygon Shape | P | Click points, double‑click / Enter to close |
| Pencil | N | 1‑px freehand pixels on the active paint layer |
| Brush | B | Round brush, size 1–15 |
| Spray / Trees | T | Spray tree clumps (pixel stamps) |
| Fill bucket | G | Fills the area bounded by anything *visible* (pencil lines, other surfaces), written to the active paint layer |
| Magic wand | W | Select a painted area → area/size, recolor via swatch, delete, or “Make shape” (trace → editable shape) |
| Eraser | E | Erases paint pixels |
| Eyedropper | I | Pick surface under cursor |
| Ruler | M | Click‑click‑click like Google Maps measure; yards per leg + total |
| Hand | Space‑drag | Pan (also two‑finger trackpad scroll); pinch / ⌘‑scroll zoom |

The **palette** is surfaces, not raw colors (a row of plain colors is still there).
Active surface is shown like Paint's fg/bg swatch.

## 6. Roadmap

- **v0.1 Core** — this doc's §4–5: canvas, surfaces, shapes + paint, layers, undo,
  ruler, save/open/autosave, PNG export.
- **v0.1.x polish backlog** — Add‑to / cut‑from shape (⇧/⌥ + freehand, boolean ops:
  bite a bunker out of a fairway); Trace (painted pixels → shape); rectangle & ellipse
  shape tools; selection marquee for painted pixels; app icon + offline PWA.
- **v0.2 Holes & yardage** — Hole tool (tee → aim points → green), par, auto
  yardage along centerline, distance arcs, scorecard panel; image underlay with
  opacity and "set scale by known distance".
- **v0.3 Real land** — place a document on a map (US); satellite underlay
  (Esri World Imagery / USGS NAIP — *not* Google, whose terms forbid tracing).
- **v0.4 Terrain** — USGS 3DEP elevation → contour + hillshade layers; per‑hole
  elevation change; paintable fictional terrain (raise/lower brush).
- **v0.5 Strategy mode** — shot‑pattern ellipses (by handicap + club) placed on
  targets; % of pattern in hazards. Model is pluggable so a full club/dispersion
  model can replace the simple one later. (Do not use the "DECADE" trademark.)
- **v0.6+** — iPad + Pencil polish, accounts, cloud saves, share gallery, paid tier,
  Tauri desktop build.

## 7. Monetization notes
Free core editor; paid tier for satellite/terrain overlays, strategy mode, hi‑res
export, unlimited cloud courses. Map/terrain API costs scale with paid usage.
Community gallery is the growth engine.

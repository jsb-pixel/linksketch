/**
 * "Crisp shapes" view option: when zoomed in, shapes are drawn as smooth curves at
 * screen resolution instead of enlarged pixels. Paint layers stay pixelated, and the
 * stacking order of layers is unchanged. Exports are not affected — they are always
 * the pixel drawing.
 */
import { catmullRomClosed, rectIntersect } from '../geom/geom';
import { surfaceById, surfaceCode, surfaceColor, surfacePixel, rgbCss } from '../model/surfaces';
import type { CourseDoc, Feature, RasterLayer, Rect, Vec2 } from '../model/types';
import { flatten, renderRegion, sortedFeatures } from './raster';

/** Crisp drawing starts at this zoom; below it a doc pixel is too small to tell. */
export const CRISP_MIN_ZOOM = 2;

/**
 * A shape's outline in doc pixels, sampled finely enough to look smooth at `zoom`
 * (about one point every two screen pixels). Straight‑edged shapes are returned as is.
 */
export function crispOutline(f: Feature, ypp: number, zoom: number): Vec2[] {
  const pts = f.points.map((p) => ({ x: p.x / ypp, y: p.y / ypp }));
  if (!f.smooth || pts.length < 3) return pts;
  return catmullRomClosed(pts, Math.max(0.05, Math.min(1.5, 2 / zoom))).poly;
}

// Pattern tiles: 56 px repeats the water dashes exactly (14 across, 7 down).
const TILE = 56;
let patternKey = '';
const patterns = new Map<number, CanvasPattern | null>();

function fillFor(ctx: CanvasRenderingContext2D, doc: CourseDoc, surface: string): string | CanvasPattern {
  const s = surfaceById(surface);
  if (!s || s.pattern === 'none') return rgbCss(surfaceColor(surface));
  const key = JSON.stringify(doc.colors);
  if (key !== patternKey) {
    patternKey = key;
    patterns.clear();
  }
  const code = surfaceCode(surface);
  let p = patterns.get(code);
  if (p === undefined) {
    const c = document.createElement('canvas');
    c.width = c.height = TILE;
    const cx = c.getContext('2d')!;
    const img = cx.createImageData(TILE, TILE);
    const u32 = new Uint32Array(img.data.buffer);
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) u32[y * TILE + x] = surfacePixel(code, x, y);
    cx.putImageData(img, 0, 0);
    p = ctx.createPattern(c, 'repeat');
    patterns.set(code, p);
  }
  return p ?? rgbCss(surfaceColor(surface));
}

interface PaintCache {
  rev: number;
  key: string;
  canvas: HTMLCanvasElement;
}
const paintCache = new WeakMap<RasterLayer, PaintCache>();

/** The visible part of one paint layer, rendered on its own (cached until it changes). */
function paintCanvas(doc: CourseDoc, layer: RasterLayer, r: Rect, rev: number): HTMLCanvasElement {
  const key = `${r.x},${r.y},${r.w},${r.h}`;
  const hit = paintCache.get(layer);
  if (hit && hit.rev === rev && hit.key === key) return hit.canvas;
  const canvas = hit?.canvas ?? document.createElement('canvas');
  if (canvas.width !== r.w || canvas.height !== r.h) {
    canvas.width = r.w;
    canvas.height = r.h;
  }
  const data = renderRegion({ ...doc, layers: [layer] }, r);
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data.buffer), r.w, r.h), 0, 0);
  paintCache.set(layer, { rev, key, canvas });
  return canvas;
}

/** Visible doc rectangle snapped out to a coarse grid, so panning rarely re-renders paint. */
export function snapView(v: { x0: number; y0: number; x1: number; y1: number }, W: number, H: number, grid = 64): Rect | null {
  const x0 = Math.max(0, Math.floor(v.x0 / grid) * grid);
  const y0 = Math.max(0, Math.floor(v.y0 / grid) * grid);
  const x1 = Math.min(W, Math.ceil(v.x1 / grid) * grid);
  const y1 = Math.min(H, Math.ceil(v.y1 / grid) * grid);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/**
 * Draw the course's layers into `ctx`, which must already map doc pixels to the
 * screen. `view` is the visible doc‑pixel area; `rev` changes when the drawing does.
 */
export function drawCrisp(ctx: CanvasRenderingContext2D, doc: CourseDoc, view: { x0: number; y0: number; x1: number; y1: number }, zoom: number, rev: number): void {
  const r = snapView(view, doc.width, doc.height);
  if (!r) return;
  const ypp = doc.yardsPerPixel;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  for (const layer of doc.layers) {
    if (!layer.visible) continue;
    if (layer.kind === 'raster') {
      ctx.drawImage(paintCanvas(doc, layer, r, rev), r.x, r.y);
    } else if (layer.kind === 'vector') {
      for (const f of sortedFeatures(layer)) {
        const s = surfaceById(f.surface);
        if (!s) continue;
        const { bbox } = flatten(f, ypp);
        if (!rectIntersect({ x: bbox.x - 2, y: bbox.y - 2, w: bbox.w + 4, h: bbox.h + 4 }, r)) continue;
        const poly = crispOutline(f, ypp, zoom);
        if (poly.length < 3) continue;
        ctx.beginPath();
        poly.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
        ctx.fillStyle = fillFor(ctx, doc, f.surface);
        ctx.fill('evenodd');
        if (s.outline) {
          // A one‑doc‑pixel black edge, kept inside the shape like the pixel version.
          ctx.save();
          ctx.clip('evenodd');
          ctx.lineWidth = 2;
          ctx.lineJoin = 'round';
          ctx.strokeStyle = '#000';
          ctx.stroke();
          ctx.restore();
        }
      }
    }
  }
  ctx.restore();
}

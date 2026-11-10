/**
 * Our own pixel rasterizer. We don't use canvas paths for the course because canvas
 * anti‑aliases edges; we want hard, palette‑exact pixels with 1‑px Paint‑style outlines.
 */
import { bboxOf, catmullRomClosed, pointInPolygon, rectIntersect, type Flat } from '../geom/geom';
import { OUTLINE_PACKED, SURFACES, surfaceCode, surfacePixel, surfaceRank } from '../model/surfaces';
import type { CourseDoc, Feature, Rect, VectorLayer } from '../model/types';

/** surface code → draws an outline (lookup table for the hot loop). */
const surfaceOutline: boolean[] = [false, ...SURFACES.map((s) => s.outline)];

/** Sampling step of smooth outlines, in doc pixels. */
const SPLINE_STEP_PX = 1.5;

interface FlatEntry {
  ypp: number;
  smooth: boolean;
  flat: Flat;
  /** Bounding box in doc pixels. */
  bbox: Rect;
}

// Keyed by the (immutable) points array, so edits that replace `points` invalidate it.
const flatCache = new WeakMap<object, FlatEntry>();

/** Outline polygon of a feature in doc pixels (cached). */
export function flatten(f: Feature, ypp: number): FlatEntry {
  const hit = flatCache.get(f.points);
  if (hit && hit.ypp === ypp && hit.smooth === f.smooth) return hit;
  const pts = f.points.map((p) => ({ x: p.x / ypp, y: p.y / ypp }));
  const flat: Flat = f.smooth
    ? catmullRomClosed(pts, SPLINE_STEP_PX)
    : { poly: pts, span: Int32Array.from(pts, (_, i) => i) };
  const entry = { ypp, smooth: f.smooth, flat, bbox: bboxOf(flat.poly) };
  flatCache.set(f.points, entry);
  return entry;
}

/**
 * Scanline fill (even‑odd, sampled at pixel centers). Calls span(y, x0, x1) with an
 * inclusive pixel range clipped to `clip`.
 */
export function fillPolygon(
  poly: { x: number; y: number }[],
  clip: Rect,
  span: (y: number, x0: number, x1: number) => void,
): void {
  const n = poly.length;
  if (n < 3) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const yStart = Math.max(clip.y, Math.floor(minY));
  const yEnd = Math.min(clip.y + clip.h - 1, Math.ceil(maxY));
  const cx0 = clip.x;
  const cx1 = clip.x + clip.w - 1;
  const xs: number[] = [];
  for (let y = yStart; y <= yEnd; y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = poly[j];
      const b = poly[i];
      if ((a.y <= cy && b.y > cy) || (b.y <= cy && a.y > cy)) {
        xs.push(a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(cx0, Math.ceil(xs[k] - 0.5));
      const x1 = Math.min(cx1, Math.ceil(xs[k + 1] - 0.5) - 1);
      if (x1 >= x0) span(y, x0, x1);
    }
  }
}

/** Features of a layer in draw order (by surface priority, then creation order). */
export function sortedFeatures(layer: VectorLayer): Feature[] {
  return layer.features
    .map((f, i) => ({ f, i, r: surfaceRank(surfaceCode(f.surface)) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((e) => e.f);
}

/**
 * Render a doc‑pixel rectangle (integer, inside the doc) into packed RGBA words.
 * Unpainted pixels are transparent (0).
 */
export function renderRegion(doc: CourseDoc, r: Rect): Uint32Array {
  const W = doc.width;
  const H = doc.height;
  const ypp = doc.yardsPerPixel;
  const out = new Uint32Array(r.w * r.h);

  // The background is left transparent: the view draws the background color and any
  // underlay images beneath this layer stack.

  // Region plus a 1px border, so outlines at the region edge see their neighbors.
  const ex = rectIntersect({ x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 }, { x: 0, y: 0, w: W, h: H })!;
  const ox = r.x - ex.x;
  const oy = r.y - ex.y;

  for (const layer of doc.layers) {
    if (!layer.visible || (layer.kind !== 'raster' && layer.kind !== 'vector')) continue;
    let codes: Uint8Array;
    let outlines = true;
    if (layer.kind === 'raster') {
      // Copy the layer's codes for the region (+1px border) into a local buffer.
      codes = new Uint8Array(ex.w * ex.h);
      for (let y = 0; y < ex.h; y++) {
        const src = (ex.y + y) * W + ex.x;
        codes.set(layer.pixels.subarray(src, src + ex.w), y * ex.w);
      }
      outlines = layer.outline;
    } else {
      const c = rasterizeVectorLayer(layer, ex, ypp);
      if (!c) continue;
      codes = c;
    }
    composite(out, r, codes, ex, ox, oy, outlines);
  }
  return out;
}

/** Surface codes of a vector layer's features over `ex` (null if nothing there). */
function rasterizeVectorLayer(layer: VectorLayer, ex: Rect, ypp: number): Uint8Array | null {
  const codes = new Uint8Array(ex.w * ex.h);
  let any = false;
  for (const f of sortedFeatures(layer)) {
    const { flat, bbox } = flatten(f, ypp);
    if (!rectIntersect(bbox, { x: ex.x - 1, y: ex.y - 1, w: ex.w + 2, h: ex.h + 2 })) continue;
    const code = surfaceCode(f.surface);
    if (!code) continue;
    fillPolygon(flat.poly, ex, (y, x0, x1) => {
      const base = (y - ex.y) * ex.w - ex.x;
      codes.fill(code, base + x0, base + x1 + 1);
      any = true;
    });
  }
  return any ? codes : null;
}

/**
 * Color one layer's codes into `out`. A pixel becomes outline where its surface wants
 * one and a 4‑neighbor is a lower‑ranked surface (or empty) — the Paint‑style 1px edge.
 */
function composite(
  out: Uint32Array,
  r: Rect,
  codes: Uint8Array,
  ex: Rect,
  ox: number,
  oy: number,
  outlines: boolean,
): void {
  for (let y = 0; y < r.h; y++) {
    const ey = y + oy;
    for (let x = 0; x < r.w; x++) {
      const ei = ey * ex.w + x + ox;
      const c = codes[ei];
      if (!c) continue;
      let outline = false;
      if (outlines && surfaceOutline[c]) {
        const rank = surfaceRank(c);
        const ex0 = x + ox;
        // Neighbors outside the doc count as "same" (no outline at the doc edge).
        const n1 = ex0 > 0 ? codes[ei - 1] : c;
        const n2 = ex0 < ex.w - 1 ? codes[ei + 1] : c;
        const n3 = ey > 0 ? codes[ei - ex.w] : c;
        const n4 = ey < ex.h - 1 ? codes[ei + ex.w] : c;
        outline =
          (n1 !== c && surfaceRank(n1) < rank) ||
          (n2 !== c && surfaceRank(n2) < rank) ||
          (n3 !== c && surfaceRank(n3) < rank) ||
          (n4 !== c && surfaceRank(n4) < rank);
      }
      out[y * r.w + x] = outline ? OUTLINE_PACKED : surfacePixel(c, r.x + x, r.y + y);
    }
  }
}

/**
 * The surface code visible at every doc pixel (all visible layers + background).
 * Used by Fill so it respects everything on screen, like Paint.
 */
export function visibleCodes(doc: CourseDoc): Uint8Array {
  const W = doc.width;
  const H = doc.height;
  const full = { x: 0, y: 0, w: W, h: H };
  const map = new Uint8Array(W * H).fill(surfaceCode(doc.background) || surfaceCode('white'));
  for (const layer of doc.layers) {
    if (!layer.visible || (layer.kind !== 'raster' && layer.kind !== 'vector')) continue;
    const codes = layer.kind === 'raster' ? layer.pixels : rasterizeVectorLayer(layer, full, doc.yardsPerPixel);
    if (!codes) continue;
    for (let i = 0; i < map.length; i++) if (codes[i]) map[i] = codes[i];
  }
  return map;
}

/** Is a doc point inside the feature's rendered outline? */
export function featureContains(f: Feature, px: { x: number; y: number }, ypp: number): boolean {
  const { flat, bbox } = flatten(f, ypp);
  if (px.x < bbox.x || px.y < bbox.y || px.x > bbox.x + bbox.w || px.y > bbox.y + bbox.h) return false;
  return pointInPolygon(px, flat.poly);
}

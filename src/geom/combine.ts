/**
 * Combining shapes: the union of several features' outlines as one new outline.
 *
 * Done on a fine pixel mask (a few sub‑pixels per doc pixel) rather than with exact
 * polygon clipping: robust for messy freehand loops, and the app draws in pixels anyway.
 *
 * Freehand loops often cross themselves (the end overshoots the start, or a smooth curve
 * makes a tiny kink), so each loop is filled by winding number — every part it encloses
 * counts — and stray specks left over are dropped as long as every shape mostly joins
 * the main piece.
 */
import { traceOutline, type Region } from '../render/regions';
import { flatten } from '../render/raster';
import type { Feature, Vec2 } from '../model/types';

const MAX_MASK = 6_000_000;
/** A shape counts as joined if at least this share of it is in the main piece. */
const JOINED_SHARE = 0.6;

export type CombineResult = { ok: true; points: Vec2[]; smooth: boolean } | { ok: false; reason: 'apart' | 'empty' };

/** Nonzero‑winding scanline fill at pixel centres; calls span(y, x0, x1) inclusive. */
function fillNonzero(poly: Vec2[], W: number, H: number, span: (y: number, x0: number, x1: number) => void): void {
  const n = poly.length;
  if (n < 3) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const xs: { x: number; d: number }[] = [];
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(H - 1, Math.ceil(maxY)); y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const a = poly[j];
      const b = poly[i];
      if (a.y <= cy && b.y > cy) xs.push({ x: a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x), d: 1 });
      else if (b.y <= cy && a.y > cy) xs.push({ x: a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x), d: -1 });
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p.x - q.x);
    let wind = 0;
    for (let k = 0; k + 1 < xs.length; k++) {
      wind += xs[k].d;
      if (!wind) continue;
      const x0 = Math.max(0, Math.ceil(xs[k].x - 0.5));
      const x1 = Math.min(W - 1, Math.floor(xs[k + 1].x - 0.5));
      if (x1 >= x0) span(y, x0, x1);
    }
  }
}

/** Label 4‑connected pieces of a 0/1 mask. Returns labels (0 = empty) and piece sizes. */
function labelPieces(mask: Uint8Array, W: number, H: number): { labels: Int32Array; sizes: number[] } {
  const labels = new Int32Array(W * H);
  const sizes = [0];
  const stack: number[] = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || labels[s]) continue;
    const id = sizes.length;
    let size = 0;
    labels[s] = id;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % W;
      const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W];
      for (const k of nb)
        if (k >= 0 && k < mask.length && mask[k] && !labels[k]) {
          labels[k] = id;
          stack.push(k);
        }
    }
    sizes.push(size);
  }
  return { labels, sizes };
}

/** Union of the features' outlines in world yards. Fails if they don't join up. */
export function unionOutline(features: Feature[], ypp: number): CombineResult {
  const polys = features.map((f) => flatten(f, ypp).flat.poly);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const poly of polys)
    for (const p of poly) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
  if (!isFinite(x0)) return { ok: false, reason: 'empty' };
  const area = (x1 - x0 + 4) * (y1 - y0 + 4);
  const s = Math.max(1, Math.min(4, Math.floor(Math.sqrt(MAX_MASK / area))));
  const ox = Math.floor(x0) - 1;
  const oy = Math.floor(y0) - 1;
  const W = Math.ceil((x1 - ox + 1) * s) + 2;
  const H = Math.ceil((y1 - oy + 1) * s) + 2;
  const scaled = polys.map((poly) => poly.map((p) => ({ x: (p.x - ox) * s, y: (p.y - oy) * s })));
  const mask = new Uint8Array(W * H);
  for (const poly of scaled) fillNonzero(poly, W, H, (y, a, b) => mask.fill(1, y * W + a, y * W + b + 1));

  const { labels, sizes } = labelPieces(mask, W, H);
  if (sizes.length < 2) return { ok: false, reason: 'empty' };
  let main = 1;
  for (let i = 2; i < sizes.length; i++) if (sizes[i] > sizes[main]) main = i;

  // Every shape must mostly belong to the main piece; leftover specks are dropped.
  for (const poly of scaled) {
    let total = 0;
    let inMain = 0;
    fillNonzero(poly, W, H, (y, a, b) => {
      for (let i = y * W + a; i <= y * W + b; i++) {
        total++;
        if (labels[i] === main) inMain++;
      }
    });
    if (total && inMain / total < JOINED_SHARE) return { ok: false, reason: 'apart' };
  }

  // The main piece as a region for tracing.
  let rx0 = W;
  let ry0 = H;
  let rx1 = -1;
  let ry1 = -1;
  for (let i = 0; i < labels.length; i++)
    if (labels[i] === main) {
      const x = i % W;
      const y = (i - x) / W;
      if (x < rx0) rx0 = x;
      if (x > rx1) rx1 = x;
      if (y < ry0) ry0 = y;
      if (y > ry1) ry1 = y;
    }
  const rect = { x: rx0, y: ry0, w: rx1 - rx0 + 1, h: ry1 - ry0 + 1 };
  const rmask = new Uint8Array(rect.w * rect.h);
  for (let y = 0; y < rect.h; y++)
    for (let x = 0; x < rect.w; x++) if (labels[(y + ry0) * W + x + rx0] === main) rmask[y * rect.w + x] = 1;
  const region: Region = { rect, mask: rmask, count: sizes[main] };

  // Simplify to about ¾ of a doc pixel so the result has a sensible number of points.
  const poly = traceOutline(region, 0.75 * s);
  if (poly.length < 3) return { ok: false, reason: 'empty' };
  const points = poly.map((p) => ({ x: (p.x / s + ox) * ypp, y: (p.y / s + oy) * ypp }));
  const smooth = features.some((f) => f.smooth);
  return { ok: true, points, smooth };
}

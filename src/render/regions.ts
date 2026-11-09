/**
 * Pixel regions: flood selection (fill + magic wand), outlines for display, and
 * tracing a painted region into a polygon (paint → editable shape).
 */
import { simplifyClosed, polygonArea } from '../geom/geom';
import type { Rect, Vec2 } from '../model/types';

export interface Region {
  /** Bounding box in doc pixels. */
  rect: Rect;
  /** 1 = inside, rect.w × rect.h. */
  mask: Uint8Array;
  /** Number of pixels inside. */
  count: number;
}

/** 4‑connected flood of pixels equal to codes[start] (scanline algorithm). */
export function floodRegion(codes: Uint8Array, W: number, H: number, x: number, y: number): Region | null {
  if (x < 0 || y < 0 || x >= W || y >= H) return null;
  const target = codes[y * W + x];
  const seen = new Uint8Array(W * H);
  let x0 = x;
  let x1 = x;
  let y0 = y;
  let y1 = y;
  let count = 0;
  const stack: number[] = [x, y];
  const match = (i: number) => !seen[i] && codes[i] === target;
  while (stack.length) {
    const sy = stack.pop()!;
    let sx = stack.pop()!;
    if (!match(sy * W + sx)) continue;
    while (sx > 0 && match(sy * W + sx - 1)) sx--;
    let up = false;
    let down = false;
    for (; sx < W && match(sy * W + sx); sx++) {
      seen[sy * W + sx] = 1;
      count++;
      if (sx < x0) x0 = sx;
      if (sx > x1) x1 = sx;
      if (sy < y0) y0 = sy;
      if (sy > y1) y1 = sy;
      if (sy > 0) {
        const t = match((sy - 1) * W + sx);
        if (t && !up) stack.push(sx, sy - 1);
        up = t;
      }
      if (sy < H - 1) {
        const t = match((sy + 1) * W + sx);
        if (t && !down) stack.push(sx, sy + 1);
        down = t;
      }
    }
  }
  const rect = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  const mask = new Uint8Array(rect.w * rect.h);
  for (let j = 0; j < rect.h; j++) {
    const src = (y0 + j) * W + x0;
    mask.set(seen.subarray(src, src + rect.w), j * rect.w);
  }
  return { rect, mask, count };
}

/** Call fn(docIndex) for every pixel inside the region. */
export function forEachPixel(r: Region, W: number, fn: (i: number) => void): void {
  const { rect, mask } = r;
  for (let j = 0; j < rect.h; j++)
    for (let i = 0; i < rect.w; i++) if (mask[j * rect.w + i]) fn((rect.y + j) * W + rect.x + i);
}

const inside = (r: Region, x: number, y: number) =>
  x >= 0 && y >= 0 && x < r.rect.w && y < r.rect.h && r.mask[y * r.rect.w + x] === 1;

/** Boundary segments of the region (doc‑pixel coords), merged into runs. For drawing. */
export function regionEdges(r: Region): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  const { w, h } = r.rect;
  const ox = r.rect.x;
  const oy = r.rect.y;
  // horizontal edges
  for (let y = 0; y <= h; y++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const edge = x < w && inside(r, x, y) !== inside(r, x, y - 1);
      if (edge && start < 0) start = x;
      if (!edge && start >= 0) {
        out.push([ox + start, oy + y, ox + x, oy + y]);
        start = -1;
      }
    }
  }
  // vertical edges
  for (let x = 0; x <= w; x++) {
    let start = -1;
    for (let y = 0; y <= h; y++) {
      const edge = y < h && inside(r, x, y) !== inside(r, x - 1, y);
      if (edge && start < 0) start = y;
      if (!edge && start >= 0) {
        out.push([ox + x, oy + start, ox + x, oy + y]);
        start = -1;
      }
    }
  }
  return out;
}

/**
 * Trace the outer boundary of a region into a polygon (doc pixels), simplified with
 * tolerance `eps`. Holes are ignored (shapes don't have holes).
 */
export function traceOutline(r: Region, eps = 1): Vec2[] {
  const { w } = r.rect;
  // Directed boundary edges, clockwise around inside pixels, keyed by start vertex.
  const next = new Map<number, number[]>();
  const key = (x: number, y: number) => y * (w + 2) + x;
  const add = (ax: number, ay: number, bx: number, by: number) => {
    const k = key(ax, ay);
    const v = key(bx, by);
    const list = next.get(k);
    if (list) list.push(v);
    else next.set(k, [v]);
  };
  for (let y = 0; y < r.rect.h; y++)
    for (let x = 0; x < w; x++) {
      if (!inside(r, x, y)) continue;
      if (!inside(r, x, y - 1)) add(x, y, x + 1, y);
      if (!inside(r, x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!inside(r, x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!inside(r, x - 1, y)) add(x, y + 1, x, y);
    }
  // Chain edges into loops; keep the largest (the outer boundary).
  let best: Vec2[] = [];
  let bestArea = -1;
  for (const startKey of [...next.keys()]) {
    while (next.get(startKey)?.length) {
      const loop: Vec2[] = [];
      let k = startKey;
      for (let guard = 0; guard < 4 * r.mask.length + 8; guard++) {
        loop.push({ x: (k % (w + 2)) + r.rect.x, y: Math.floor(k / (w + 2)) + r.rect.y });
        const list = next.get(k);
        if (!list?.length) break;
        const v = list.pop()!;
        if (!list.length) next.delete(k);
        k = v;
        if (k === startKey) break;
      }
      const a = polygonArea(loop);
      if (a > bestArea) {
        bestArea = a;
        best = loop;
      }
    }
  }
  return simplifyClosed(best, eps);
}

/**
 * Terrain: a heightfield (feet) on a regular grid laid over the course.
 *
 * Grid point (i, j) sits at doc pixel (i·cell, j·cell). The grid covers the whole doc
 * (w = ⌈W/cell⌉+1 points across). Heights are plain feet above sea level for real
 * courses, or relative feet for sculpted (fictional) ones.
 */
import type { Vec2 } from '../model/types';

export type TerrainSource = 'usgs' | 'sculpted';

export interface Terrain {
  /** Doc pixels between grid points. */
  cell: number;
  w: number;
  h: number;
  /** Feet, row‑major, w × h. Edited in place by the terrain brush. */
  heights: Float32Array;
  source: TerrainSource;
  /** Change counter for render caches (not saved). */
  rev?: number;
}

/** Grid spacing that keeps the grid around ≤ 200k points. */
export function pickCell(docW: number, docH: number): number {
  return Math.max(2, Math.ceil(Math.sqrt((docW * docH) / 200_000)));
}

export function createTerrain(docW: number, docH: number, source: TerrainSource, fill = 0): Terrain {
  const cell = pickCell(docW, docH);
  const w = Math.ceil(docW / cell) + 1;
  const h = Math.ceil(docH / cell) + 1;
  return { cell, w, h, heights: new Float32Array(w * h).fill(fill), source, rev: 0 };
}

export function touch(t: Terrain): void {
  t.rev = (t.rev ?? 0) + 1;
}

/** Bilinear height at a doc‑pixel position (clamped to the grid). */
export function heightAtPx(t: Terrain, p: Vec2): number {
  const gx = Math.max(0, Math.min(t.w - 1, p.x / t.cell));
  const gy = Math.max(0, Math.min(t.h - 1, p.y / t.cell));
  const i = Math.min(t.w - 2, Math.floor(gx));
  const j = Math.min(t.h - 2, Math.floor(gy));
  const fx = gx - i;
  const fy = gy - j;
  const H = t.heights;
  const a = H[j * t.w + i];
  const b = H[j * t.w + i + 1];
  const c = H[(j + 1) * t.w + i];
  const d = H[(j + 1) * t.w + i + 1];
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

export function minMax(t: Terrain): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const v of t.heights) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

/**
 * Terrain for a resized doc. `nx, ny` is where the new top‑left sits in old doc pixels.
 * Points outside the old area take the nearest edge height.
 */
export function resampleTerrain(t: Terrain, nx: number, ny: number, newW: number, newH: number): Terrain {
  const out = createTerrain(newW, newH, t.source);
  for (let j = 0; j < out.h; j++)
    for (let i = 0; i < out.w; i++) out.heights[j * out.w + i] = heightAtPx(t, { x: nx + i * out.cell, y: ny + j * out.cell });
  return out;
}

// ---------------------------------------------------------------- file encoding
/** Quantize to Int16 steps above a base (0.05 ft steps unless the range is huge). */
export function encodeTerrain(t: Terrain): { cell: number; w: number; h: number; source: TerrainSource; base: number; step: number; data: Int16Array } {
  const { min, max } = minMax(t);
  const step = Math.max(0.05, (max - min) / 65000);
  const base = min;
  const data = new Int16Array(t.heights.length);
  for (let i = 0; i < data.length; i++) data[i] = Math.round((t.heights[i] - base) / step) - 32768;
  return { cell: t.cell, w: t.w, h: t.h, source: t.source, base, step, data };
}

export function decodeTerrain(e: { cell: number; w: number; h: number; source: TerrainSource; base: number; step: number; data: Int16Array }): Terrain {
  const heights = new Float32Array(e.w * e.h);
  for (let i = 0; i < heights.length; i++) heights[i] = e.base + (e.data[i] + 32768) * e.step;
  return { cell: e.cell, w: e.w, h: e.h, heights, source: e.source, rev: 0 };
}

// ---------------------------------------------------------------- shaping brush
export type BrushMode = 'raise' | 'lower' | 'smooth' | 'flatten';

/**
 * One brush dab centred at doc pixel `c` with radius `rPx` (doc px).
 * `amount` is feet at the centre per dab (raise/lower) or 0–1 blend (smooth/flatten).
 * Returns false if the dab missed the grid.
 */
export function dab(t: Terrain, c: Vec2, rPx: number, mode: BrushMode, amount: number, target = 0): boolean {
  const r = rPx / t.cell;
  const gx = c.x / t.cell;
  const gy = c.y / t.cell;
  const i0 = Math.max(0, Math.floor(gx - r));
  const i1 = Math.min(t.w - 1, Math.ceil(gx + r));
  const j0 = Math.max(0, Math.floor(gy - r));
  const j1 = Math.min(t.h - 1, Math.ceil(gy + r));
  if (i1 < i0 || j1 < j0) return false;
  const H = t.heights;
  const src = mode === 'smooth' ? H.slice() : H;
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(i - gx, j - gy);
      if (d > r) continue;
      const wgt = 0.5 * (1 + Math.cos((Math.PI * d) / r));
      const k = j * t.w + i;
      if (mode === 'raise') H[k] += amount * wgt;
      else if (mode === 'lower') H[k] -= amount * wgt;
      else if (mode === 'flatten') H[k] += (target - H[k]) * amount * wgt;
      else {
        let sum = 0;
        let n = 0;
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const ii = i + di;
            const jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= t.w || jj >= t.h) continue;
            sum += src[jj * t.w + ii];
            n++;
          }
        H[k] += (sum / n - src[k]) * amount * wgt;
      }
    }
  touch(t);
  return true;
}

// ---------------------------------------------------------------- contours
/**
 * Contour line segments (doc px) every `interval` feet via marching squares.
 * Returns minor and major (every `majorEvery`‑th level) segment lists as flat arrays.
 */
export function contourSegments(t: Terrain, interval: number, majorEvery = 5): { minor: Float32Array; major: Float32Array } {
  const minor: number[] = [];
  const major: number[] = [];
  const H = t.heights;
  const c = t.cell;
  for (let j = 0; j + 1 < t.h; j++)
    for (let i = 0; i + 1 < t.w; i++) {
      const a = H[j * t.w + i]; // top-left
      const b = H[j * t.w + i + 1]; // top-right
      const d = H[(j + 1) * t.w + i]; // bottom-left
      const e = H[(j + 1) * t.w + i + 1]; // bottom-right
      const lo = Math.min(a, b, d, e);
      const hi = Math.max(a, b, d, e);
      for (let lv = Math.ceil(lo / interval) * interval; lv <= hi; lv += interval) {
        if (lv === lo && lv === hi) continue;
        const pts: number[] = [];
        // edges: top (a→b), right (b→e), bottom (d→e), left (a→d)
        const cross = (p: number, q: number, x0: number, y0: number, x1: number, y1: number) => {
          if ((p < lv) !== (q < lv)) {
            const f = (lv - p) / (q - p);
            pts.push((x0 + (x1 - x0) * f) * c, (y0 + (y1 - y0) * f) * c);
          }
        };
        cross(a, b, i, j, i + 1, j);
        cross(b, e, i + 1, j, i + 1, j + 1);
        cross(d, e, i, j + 1, i + 1, j + 1);
        cross(a, d, i, j, i, j + 1);
        const out = Math.round(lv / interval) % majorEvery === 0 ? major : minor;
        if (pts.length === 4) out.push(...pts);
        else if (pts.length === 8) {
          // saddle: pair by the centre value
          const centre = (a + b + d + e) / 4;
          if ((centre < lv) === (a < lv)) out.push(pts[0], pts[1], pts[2], pts[3], pts[4], pts[5], pts[6], pts[7]);
          else out.push(pts[0], pts[1], pts[6], pts[7], pts[2], pts[3], pts[4], pts[5]);
        }
      }
    }
  return { minor: Float32Array.from(minor), major: Float32Array.from(major) };
}

// ---------------------------------------------------------------- hillshade
/**
 * Hillshade as grayscale RGBA (one pixel per grid point) for a "multiply" blend:
 * white = flat or facing the NW light (no change), darker = facing away. Multiply
 * works on white paper as well as on paint and imagery.
 */
export function hillshade(t: Terrain, yardsPerPixel: number, exaggeration = 2.5): ImageData {
  const img = new ImageData(t.w, t.h);
  const cellFt = t.cell * yardsPerPixel * 3;
  const H = t.heights;
  const L = { x: -1 / 2, y: -1 / 2, z: Math.SQRT1_2 }; // from the north‑west, 45° up
  const flat = L.z;
  for (let j = 0; j < t.h; j++)
    for (let i = 0; i < t.w; i++) {
      const l = H[j * t.w + Math.max(0, i - 1)];
      const r = H[j * t.w + Math.min(t.w - 1, i + 1)];
      const u = H[Math.max(0, j - 1) * t.w + i];
      const dn = H[Math.min(t.h - 1, j + 1) * t.w + i];
      const dzdx = ((r - l) / (2 * cellFt)) * exaggeration;
      const dzdy = ((dn - u) / (2 * cellFt)) * exaggeration;
      const len = Math.hypot(dzdx, dzdy, 1);
      const shade = (-dzdx * L.x - dzdy * L.y + L.z) / len;
      const g = Math.max(70, Math.min(255, 255 + (shade / flat - 1) * 420));
      const k = (j * t.w + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = g;
      img.data[k + 3] = 255;
    }
  return img;
}

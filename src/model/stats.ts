/** Course statistics: how much of each surface, greens, bunkers, and yardage per tee set. */
import { visibleCodes } from '../render/raster';
import { surfaceByCode, surfaceCode } from './surfaces';
import { teeSets, teeTotals } from './tees';
import type { CourseDoc } from './types';

export const SQ_YD_PER_ACRE = 4840;

export interface SurfaceStat {
  id: string;
  name: string;
  sqYd: number;
  acres: number;
}

export interface CourseStats {
  /** Surfaces that appear on the course, largest first (the empty background is not counted). */
  surfaces: SurfaceStat[];
  /** Everything painted or drawn, in acres. */
  paintedAcres: number;
  /** The whole course area, in acres. */
  propertyAcres: number;
  greensSqFt: number;
  greenCount: number;
  /** Average green size in square feet (0 without greens). */
  avgGreenSqFt: number;
  bunkerCount: number;
  bunkerSqFt: number;
  holes: number;
  par: number;
  /** Total yardage for each tee set. */
  yardage: { id: string; name: string; color: string; yards: number }[];
}

/** Specks smaller than this (in doc pixels) aren't counted as a bunker or green. */
const MIN_REGION_PX = 3;

/**
 * Count separate patches of one surface code (4‑connected), ignoring specks.
 * `codes` is a W × H map of surface codes.
 */
export function countRegions(codes: Uint8Array, W: number, H: number, code: number, minPx = MIN_REGION_PX): number {
  if (!code) return 0;
  const seen = new Uint8Array(W * H);
  const stack: number[] = [];
  let count = 0;
  for (let s = 0; s < codes.length; s++) {
    if (codes[s] !== code || seen[s]) continue;
    let size = 0;
    seen[s] = 1;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      size++;
      const x = i % W;
      if (x > 0 && codes[i - 1] === code && !seen[i - 1]) (seen[i - 1] = 1), stack.push(i - 1);
      if (x < W - 1 && codes[i + 1] === code && !seen[i + 1]) (seen[i + 1] = 1), stack.push(i + 1);
      if (i >= W && codes[i - W] === code && !seen[i - W]) (seen[i - W] = 1), stack.push(i - W);
      if (i + W < codes.length && codes[i + W] === code && !seen[i + W]) (seen[i + W] = 1), stack.push(i + W);
    }
    if (size >= minPx) count++;
  }
  return count;
}

/**
 * Stats for a course. `codes` is the composite of everything visible with 0 where
 * nothing is painted (pass it in to reuse a map you already have).
 */
export function courseStats(doc: CourseDoc, codes: Uint8Array = visibleCodes(doc, false)): CourseStats {
  const W = doc.width;
  const H = doc.height;
  const pxArea = doc.yardsPerPixel * doc.yardsPerPixel; // sq yd per pixel
  const counts = new Uint32Array(256);
  for (let i = 0; i < codes.length; i++) counts[codes[i]]++;
  const surfaces: SurfaceStat[] = [];
  let painted = 0;
  for (let c = 1; c < 256; c++) {
    if (!counts[c]) continue;
    const s = surfaceByCode(c);
    if (!s) continue;
    const sqYd = counts[c] * pxArea;
    painted += sqYd;
    surfaces.push({ id: s.id, name: s.name, sqYd, acres: sqYd / SQ_YD_PER_ACRE });
  }
  surfaces.sort((a, b) => b.sqYd - a.sqYd);
  const green = surfaceCode('green');
  const bunker = surfaceCode('bunker');
  const greensSqFt = counts[green] * pxArea * 9;
  const greenCount = countRegions(codes, W, H, green);
  const sets = teeSets(doc);
  return {
    surfaces,
    paintedAcres: painted / SQ_YD_PER_ACRE,
    propertyAcres: (W * H * pxArea) / SQ_YD_PER_ACRE,
    greensSqFt,
    greenCount,
    avgGreenSqFt: greenCount ? greensSqFt / greenCount : 0,
    bunkerCount: countRegions(codes, W, H, bunker),
    bunkerSqFt: counts[bunker] * pxArea * 9,
    holes: doc.holes.length,
    par: doc.holes.reduce((n, h) => n + h.par, 0),
    yardage: teeTotals(doc.holes, sets).map((t) => ({ id: t.set.id, name: t.set.name, color: t.set.color, yards: t.total })),
  };
}

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The stats as a spreadsheet‑friendly CSV. */
export function statsCsv(name: string, s: CourseStats): string {
  const rows: (string | number)[][] = [
    ['Course', name],
    ['Holes', s.holes],
    ['Par', s.par],
    ...s.yardage.map((y) => [`Yardage (${y.name})`, y.yards]),
    ['Property (acres)', s.propertyAcres.toFixed(2)],
    ['Painted (acres)', s.paintedAcres.toFixed(2)],
    ['Greens', s.greenCount],
    ['Greens (sq ft)', Math.round(s.greensSqFt)],
    ['Average green (sq ft)', Math.round(s.avgGreenSqFt)],
    ['Bunkers', s.bunkerCount],
    ['Bunkers (sq ft)', Math.round(s.bunkerSqFt)],
    [],
    ['Surface', 'Acres', 'Square yards'],
    ...s.surfaces.map((x) => [x.name, x.acres.toFixed(3), Math.round(x.sqYd)]),
  ];
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

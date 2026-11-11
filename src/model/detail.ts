/**
 * Changing a course's detail level (yards per pixel) without moving anything.
 *
 * World positions are in yards, so shapes, holes, underlays and the map placement
 * don't change. Paint layers are resampled: going finer splits each pixel into
 * 2×2 (or 4×4) copies, so the drawing looks exactly the same; going coarser keeps
 * the most common surface of each block. Terrain grid points sit at doc pixels, so
 * only the grid spacing is rescaled.
 */
import type { CourseDoc } from './types';

export const DETAIL_LEVELS: { ypp: number; label: string }[] = [
  { ypp: 0.5, label: '½ yard per pixel (fine detail)' },
  { ypp: 1, label: '1 yard per pixel (classic)' },
  { ypp: 2, label: '2 yards per pixel (huge areas)' },
];

export function detailPixels(doc: CourseDoc, ypp: number): { w: number; h: number } {
  const r = doc.yardsPerPixel / ypp;
  return { w: Math.max(1, Math.round(doc.width * r)), h: Math.max(1, Math.round(doc.height * r)) };
}

export function setDetail(doc: CourseDoc, ypp: number, maxPixels: number): void {
  const old = doc.yardsPerPixel;
  if (ypp === old) return;
  const { w: W, h: H } = detailPixels(doc, ypp);
  if (W * H > maxPixels)
    throw new Error(`At that detail this course would be ${W} × ${H} pixels — too large. Make the course area smaller first.`);
  const oldW = doc.width;
  const oldH = doc.height;
  const up = old / ypp; // > 1 = finer
  doc.layers = doc.layers.map((l) => {
    if (l.kind !== 'raster') return l;
    const src = l.pixels;
    const px = new Uint8Array(W * H);
    if (up >= 1) {
      for (let y = 0; y < H; y++) {
        const sy = Math.min(oldH - 1, Math.floor(y / up));
        for (let x = 0; x < W; x++) px[y * W + x] = src[sy * oldW + Math.min(oldW - 1, Math.floor(x / up))];
      }
    } else {
      const k = Math.round(1 / up);
      const counts = new Map<number, number>();
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          counts.clear();
          let best = 0;
          let bestN = 0;
          let painted = 0;
          for (let dy = 0; dy < k; dy++)
            for (let dx = 0; dx < k; dx++) {
              const sx = x * k + dx;
              const sy = y * k + dy;
              if (sx >= oldW || sy >= oldH) continue;
              const c = src[sy * oldW + sx];
              if (!c) continue;
              painted++;
              const n = (counts.get(c) ?? 0) + 1;
              counts.set(c, n);
              if (n > bestN) {
                bestN = n;
                best = c;
              }
            }
          // Keep a block painted if at least half of it was.
          px[y * W + x] = painted * 2 >= k * k ? best : 0;
        }
    }
    l.pixels = px;
    return l;
  });
  if (doc.terrain) doc.terrain = { ...doc.terrain, cell: doc.terrain.cell * up, rev: (doc.terrain.rev ?? 0) + 1 };
  doc.width = W;
  doc.height = H;
  doc.yardsPerPixel = ypp;
}

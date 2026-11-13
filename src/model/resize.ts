/**
 * Changing the course area (Paint's "canvas size", but on any side).
 *
 * `rect` is the new area expressed in the *old* doc‑pixel coordinates: x/y may be
 * negative (grow left/up) or positive (crop left/up). Everything is shifted so it
 * stays where it was relative to the ground — including the map placement.
 */
import { worldToLatLon } from '../geo/geo';
import { resampleTerrain } from '../terrain/terrain';
import type { CourseDoc, Rect } from './types';

export const MIN_SIDE_PX = 20;

export function resizeDoc(doc: CourseDoc, rect: Rect, maxPixels: number): void {
  const nx = Math.round(rect.x);
  const ny = Math.round(rect.y);
  const W = Math.max(MIN_SIDE_PX, Math.round(rect.w));
  const H = Math.max(MIN_SIDE_PX, Math.round(rect.h));
  if (W * H > maxPixels) throw new Error('That course area is too large. Use a bigger pixel size or a smaller area.');
  const oldW = doc.width;
  const oldH = doc.height;
  const k = doc.yardsPerPixel;
  const dx = -nx * k; // world shift in yards
  const dy = -ny * k;

  // Copy pixels that overlap the new area. New arrays → old ones stay valid for undo.
  const sx0 = Math.max(0, nx);
  const sy0 = Math.max(0, ny);
  const sx1 = Math.min(oldW, nx + W);
  const sy1 = Math.min(oldH, ny + H);
  doc.layers = doc.layers.map((l) => {
    if (l.kind === 'raster') {
      const px = new Uint8Array(W * H);
      if (sx1 > sx0)
        for (let y = sy0; y < sy1; y++) px.set(l.pixels.subarray(y * oldW + sx0, y * oldW + sx1), (y - ny) * W + (sx0 - nx));
      l.pixels = px;
    } else if (l.kind === 'vector') {
      l.features = l.features.map((f) => ({ ...f, points: f.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }));
    } else if (l.kind === 'image') {
      l.x += dx;
      l.y += dy;
    }
    return l;
  });
  const shift = (p: { x: number; y: number }) => ({ x: p.x + dx, y: p.y + dy });
  doc.holes = doc.holes.map((h) => ({
    ...h,
    points: h.points.map(shift),
    // Dragged shot targets and extra tees are world points too.
    ...(h.targets ? { targets: h.targets.map((t) => (t ? shift(t) : null)) } : {}),
    ...(h.tees ? { tees: Object.fromEntries(Object.entries(h.tees).map(([id, t]) => [id, shift(t)])) } : {}),
  }));
  if (doc.labels) doc.labels = doc.labels.map((l) => ({ ...l, x: l.x + dx, y: l.y + dy }));
  // The new top-left corner is the old point (nx, ny).
  if (doc.geo) {
    const ll = worldToLatLon(doc.geo, { x: nx * k, y: ny * k });
    doc.geo = { lat: ll.lat, lon: ll.lon };
  }
  if (doc.terrain) doc.terrain = resampleTerrain(doc.terrain, nx, ny, W, H);
  doc.width = W;
  doc.height = H;
}

/** Small pure helpers for the view transform (screen = rotate(px) · zoom + pan). */
import type { Vec2 } from '../model/types';

/**
 * New pan after the doc's origin moves by `shift` doc pixels (a resize that adds or
 * crops on the left/top), so everything stays where it was on screen — also when the
 * view is rotated.
 */
export function panAfterOriginShift(pan: Vec2, shift: Vec2, zoom: number, rotationDeg: number): Vec2 {
  const r = (rotationDeg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: pan.x + (shift.x * c - shift.y * s) * zoom, y: pan.y + (shift.x * s + shift.y * c) * zoom };
}

/** Largest canvas most browsers will make (Safari is the strictest). */
export const CANVAS_LIMITS = { maxSide: 16384, maxArea: 16384 * 16384 };
export const SAFARI_CANVAS_LIMITS = { maxSide: 16384, maxArea: 16_777_216 * 4 };

/** Will a canvas of this size work? */
export function fitsCanvas(w: number, h: number, limits = CANVAS_LIMITS): boolean {
  return w > 0 && h > 0 && w <= limits.maxSide && h <= limits.maxSide && w * h <= limits.maxArea;
}

/** How long a failed map tile stays "failed" before it is tried again. */
export const TILE_RETRY_MS = 15_000;
export function tileRetryDue(failedAt: number, now: number): boolean {
  return now - failedAt >= TILE_RETRY_MS;
}

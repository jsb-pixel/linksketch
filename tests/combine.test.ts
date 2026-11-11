import { describe, expect, it } from 'vitest';
import { unionOutline } from '../src/geom/combine';
import { polygonArea, pointInPolygon } from '../src/geom/geom';
import type { Feature } from '../src/model/types';

const rect = (id: string, x: number, y: number, w: number, h: number, smooth = false): Feature => ({
  id,
  surface: 'fairway',
  smooth,
  points: [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ],
});

describe('combine shapes', () => {
  it('merges two overlapping halves into one outline covering both', () => {
    const res = unionOutline([rect('a', 10, 10, 40, 20), rect('b', 40, 10, 40, 20)], 1);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // Union is 70 × 20 = 1400 sq yd.
    expect(Math.abs(polygonArea(res.points))).toBeGreaterThan(1350);
    expect(Math.abs(polygonArea(res.points))).toBeLessThan(1450);
    expect(pointInPolygon({ x: 15, y: 20 }, res.points)).toBe(true);
    expect(pointInPolygon({ x: 75, y: 20 }, res.points)).toBe(true);
    expect(pointInPolygon({ x: 90, y: 20 }, res.points)).toBe(false);
    expect(res.smooth).toBe(false);
  });

  it('merges shapes that just touch, in yards at any pixel size', () => {
    const res = unionOutline([rect('a', 0, 0, 30, 30), rect('b', 30, 0, 30, 30, true)], 2);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.smooth).toBe(true);
    expect(Math.abs(polygonArea(res.points))).toBeGreaterThan(1700);
  });

  it('refuses shapes that are apart', () => {
    const res = unionOutline([rect('a', 0, 0, 20, 20), rect('b', 40, 0, 20, 20)], 1);
    expect(res).toEqual({ ok: false, reason: 'apart' });
  });

  it('handles a freehand loop whose end overshoots the start (crosses itself)', () => {
    // Loop around a 40 × 30 area, then the pen carries on past the start: the closing
    // edge crosses the first edge and makes a small twisted lobe.
    const loop: Feature = {
      id: 'loop',
      surface: 'fairway',
      smooth: true,
      points: [
        { x: 2, y: 0 },
        { x: 40, y: 0 },
        { x: 40, y: 30 },
        { x: 0, y: 30 },
        { x: 0, y: 4 },
        { x: 6, y: -4 },
      ],
    };
    const res = unionOutline([loop, rect('b', 35, 5, 40, 20)], 1);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(pointInPolygon({ x: 20, y: 15 }, res.points)).toBe(true);
    expect(pointInPolygon({ x: 70, y: 15 }, res.points)).toBe(true);
  });

  it('fills a figure‑8 overlap of a single loop (nonzero), not as a hole', () => {
    // Pentagram‑style loop: even‑odd would leave the middle empty.
    const star: Feature = {
      id: 'star',
      surface: 'green',
      smooth: false,
      points: [
        { x: 50, y: 0 },
        { x: 79, y: 90 },
        { x: 2, y: 35 },
        { x: 98, y: 35 },
        { x: 21, y: 90 },
      ],
    };
    const res = unionOutline([star, rect('b', 40, 40, 20, 20)], 1);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(pointInPolygon({ x: 50, y: 50 }, res.points)).toBe(true);
  });
});

import type { Rect, Vec2 } from '../model/types';

export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

export function projectOnSegment(p: Vec2, a: Vec2, b: Vec2): { t: number; point: Vec2; d: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const point = { x: a.x + t * dx, y: a.y + t * dy };
  return { t, point, d: dist(p, point) };
}

/** Ramer–Douglas–Peucker simplification of an open polyline. */
export function rdp(points: Vec2[], eps: number): Vec2[] {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = projectOnSegment(points[i], points[s], points[e]).d;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > eps) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Simplify a closed loop (first point is not repeated at the end). */
export function simplifyClosed(points: Vec2[], eps: number): Vec2[] {
  if (points.length < 4) return points.slice();
  let k = 0;
  let far = -1;
  for (let i = 1; i < points.length; i++) {
    const d = dist(points[0], points[i]);
    if (d > far) {
      far = d;
      k = i;
    }
  }
  const a = rdp(points.slice(0, k + 1), eps);
  const b = rdp([...points.slice(k), points[0]], eps);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}

/** Drop consecutive points closer than minDist. */
export function dedupe(points: Vec2[], minDist: number): Vec2[] {
  const out: Vec2[] = [];
  for (const p of points) if (!out.length || dist(out[out.length - 1], p) >= minDist) out.push(p);
  return out;
}

export interface Flat {
  /** Dense outline polygon. */
  poly: Vec2[];
  /** For each poly vertex, the control‑point span (i → i+1) it came from. */
  span: Int32Array;
}

/**
 * Closed centripetal Catmull–Rom spline through `pts`, sampled roughly every `step` units.
 * Centripetal parameterization avoids loops/cusps when control points bunch up.
 */
export function catmullRomClosed(pts: Vec2[], step: number): Flat {
  const n = pts.length;
  if (n < 3) return { poly: pts.slice(), span: new Int32Array(n).map((_, i) => i) };
  const poly: Vec2[] = [];
  const spans: number[] = [];
  const knot = (a: Vec2, b: Vec2) => Math.max(Math.sqrt(dist(a, b)), 1e-4);
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const t0 = 0;
    const t1 = t0 + knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);
    const samples = Math.max(1, Math.min(64, Math.ceil(dist(p1, p2) / step)));
    for (let s = 0; s < samples; s++) {
      const t = t1 + ((t2 - t1) * s) / samples;
      const lerp = (a: Vec2, b: Vec2, ta: number, tb: number): Vec2 => {
        const u = (t - ta) / (tb - ta);
        return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
      };
      const a1 = lerp(p0, p1, t0, t1);
      const a2 = lerp(p1, p2, t1, t2);
      const a3 = lerp(p2, p3, t2, t3);
      const b1 = lerp(a1, a2, t0, t2);
      const b2 = lerp(a2, a3, t1, t3);
      poly.push(lerp(b1, b2, t1, t2));
      spans.push(i);
    }
  }
  return { poly, span: Int32Array.from(spans) };
}

/** Absolute area (shoelace). */
export function polygonArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  return Math.abs(a / 2);
}

/** Even‑odd point in polygon. */
export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function pathLength(pts: Vec2[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += dist(pts[i - 1], pts[i]);
  return l;
}

export function bboxOf(pts: Vec2[]): Rect {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  if (x0 === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function rectUnion(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function rectIntersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x && y1 > y ? { x, y, w: x1 - x, h: y1 - y } : null;
}

/** Snap a float rect outwards to whole pixels, pad it, and clip to [0,W)×[0,H). */
export function pixelRect(r: Rect, pad: number, W: number, H: number): Rect | null {
  const x0 = Math.max(0, Math.floor(r.x - pad));
  const y0 = Math.max(0, Math.floor(r.y - pad));
  const x1 = Math.min(W, Math.ceil(r.x + r.w + pad));
  const y1 = Math.min(H, Math.ceil(r.y + r.h + pad));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/**
 * Layout maths for exports (hole pages and the presentation sheet). Everything here is
 * pure — no canvas — so it can be unit tested. Drawing lives in `draw.ts`.
 */
import { dist } from '../geom/geom';
import type { Vec2 } from '../model/types';

// ---------------------------------------------------------------- scale bar
const NICE = [5, 10, 25, 50, 100, 200, 250, 500, 1000, 2000];

/** The longest round number of yards whose bar fits in `maxPx`. */
export function niceScaleBar(pxPerYard: number, maxPx: number): { yards: number; px: number } {
  let yards = NICE[0];
  for (const n of NICE) if (n * pxPerYard <= maxPx) yards = n;
  return { yards, px: yards * pxPerYard };
}

// ---------------------------------------------------------------- line of play
export interface LinePos {
  /** Yards along the line of play from its start to the nearest point on it. */
  along: number;
  /** Yards off the line: positive = right of the direction of play, negative = left. */
  offset: number;
}

/** Where a point sits relative to a line of play (nearest segment). */
export function alongLine(line: Vec2[], p: Vec2): LinePos {
  let best: LinePos = { along: 0, offset: Infinity };
  let run = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i];
    const b = line[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (len * len)));
    const qx = a.x + dx * t;
    const qy = a.y + dy * t;
    const d = Math.hypot(p.x - qx, p.y - qy);
    if (d < Math.abs(best.offset)) {
      // Screen coordinates have +y down, so "right of travel" is the positive cross product.
      const cross = dx * (p.y - a.y) - dy * (p.x - a.x);
      best = { along: run + t * len, offset: cross >= 0 ? d : -d };
    }
    run += len;
  }
  return best.offset === Infinity ? { along: 0, offset: 0 } : best;
}

/** The point `yards` along a line of play, and the direction of play there. */
export function pointAlong(line: Vec2[], yards: number): { point: Vec2; dir: Vec2 } {
  let left = Math.max(0, yards);
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i];
    const b = line[i + 1];
    const len = dist(a, b);
    if (len < 1e-9) continue;
    const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    if (left <= len || i === line.length - 2) {
      const t = Math.min(left, len);
      return { point: { x: a.x + dir.x * t, y: a.y + dir.y * t }, dir };
    }
    left -= len;
  }
  return { point: line[0] ?? { x: 0, y: 0 }, dir: { x: 0, y: -1 } };
}

export function lineLength(line: Vec2[]): number {
  let l = 0;
  for (let i = 1; i < line.length; i++) l += dist(line[i - 1], line[i]);
  return l;
}

/** Marks every `step` yards back from the green (50, 100, 150 …), short of the tee. */
export function greenTicks(line: Vec2[], step = 50): { yards: number; point: Vec2; dir: Vec2 }[] {
  const total = lineLength(line);
  const out: { yards: number; point: Vec2; dir: Vec2 }[] = [];
  for (let y = step; y <= total - 30; y += step) out.push({ yards: y, ...pointAlong(line, total - y) });
  return out;
}

/**
 * Where the tee shot is expected to land: the first aim point of a dog‑leg, or
 * `driveYards` down a straight hole that is long enough. Par 3s have none.
 */
export function landingZone(line: Vec2[], driveYards = 250): { point: Vec2; dir: Vec2; yards: number } | null {
  const total = lineLength(line);
  if (line.length > 2) {
    const yards = dist(line[0], line[1]);
    const d = pointAlong(line, yards - 0.01).dir;
    return { point: line[1], dir: d, yards };
  }
  if (total < driveYards + 60) return null;
  return { ...pointAlong(line, driveYards), yards: driveYards };
}

// ---------------------------------------------------------------- hazards
export type HazardKind = 'sand' | 'water';

export interface HazardNote {
  kind: HazardKind;
  /** Yards from the tee to reach the hazard, and to carry it. */
  reach: number;
  carry: number;
  /** Which side of the line of play it is on (C = it crosses the line). */
  side: 'L' | 'R' | 'C';
  /** Middle of the part near the line, in yards. */
  at: Vec2;
  /** Size of the part near the line, in square yards. */
  area: number;
}

export interface HazardOptions {
  /** How far either side of the line of play counts, in yards. */
  corridor?: number;
  /** Surface codes that are sand / water. */
  sand: number[];
  water: number[];
  /** Ignore patches smaller than this many square yards. */
  minArea?: number;
  max?: number;
}

/**
 * Bunkers and water in play on a hole, with the distances a yardage book shows.
 * `codes` is the W × H composite surface map; `line` is the line of play in yards.
 */
export function findHazards(codes: Uint8Array, W: number, H: number, ypp: number, line: Vec2[], o: HazardOptions): HazardNote[] {
  const corridor = o.corridor ?? 45;
  const total = lineLength(line);
  if (line.length < 2 || total < 1) return [];
  const kindOf = new Uint8Array(256);
  for (const c of o.sand) kindOf[c] = 1;
  for (const c of o.water) kindOf[c] = 2;
  // Only look near the hole.
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of line) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const px0 = Math.max(0, Math.floor((x0 - corridor) / ypp));
  const py0 = Math.max(0, Math.floor((y0 - corridor) / ypp));
  const px1 = Math.min(W - 1, Math.ceil((x1 + corridor) / ypp));
  const py1 = Math.min(H - 1, Math.ceil((y1 + corridor) / ypp));
  const w = px1 - px0 + 1;
  const h = py1 - py0 + 1;
  if (w <= 0 || h <= 0) return [];
  const seen = new Uint8Array(w * h);
  const notes: HazardNote[] = [];
  const stack: number[] = [];
  for (let s = 0; s < w * h; s++) {
    if (seen[s]) continue;
    const k = kindOf[codes[(py0 + ((s / w) | 0)) * W + px0 + (s % w)]];
    if (!k) continue;
    let n = 0;
    let reach = Infinity;
    let carry = -Infinity;
    let sx = 0;
    let sy = 0;
    let minOff = Infinity;
    let maxOff = -Infinity;
    seen[s] = 1;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      const lx = i % w;
      const ly = (i / w) | 0;
      const world = { x: (px0 + lx + 0.5) * ypp, y: (py0 + ly + 0.5) * ypp };
      const pos = alongLine(line, world);
      if (Math.abs(pos.offset) <= corridor) {
        n++;
        if (pos.along < reach) reach = pos.along;
        if (pos.along > carry) carry = pos.along;
        if (pos.offset < minOff) minOff = pos.offset;
        if (pos.offset > maxOff) maxOff = pos.offset;
        sx += world.x;
        sy += world.y;
      }
      const tryPush = (j: number, jx: number, jy: number) => {
        if (seen[j] || kindOf[codes[(py0 + jy) * W + px0 + jx]] !== k) return;
        seen[j] = 1;
        stack.push(j);
      };
      if (lx > 0) tryPush(i - 1, lx - 1, ly);
      if (lx < w - 1) tryPush(i + 1, lx + 1, ly);
      if (ly > 0) tryPush(i - w, lx, ly - 1);
      if (ly < h - 1) tryPush(i + w, lx, ly + 1);
    }
    const area = n * ypp * ypp;
    if (!n || area < (o.minArea ?? 12)) continue;
    // Behind the tee or well past the green: not in play.
    if (carry < 25 || reach > total + 12) continue;
    notes.push({
      kind: k === 1 ? 'sand' : 'water',
      // Distances were taken at pixel centres; the hazard's edges are half a pixel further out.
      reach: Math.max(0, Math.round(reach - ypp / 2)),
      carry: Math.round(carry + ypp / 2),
      side: minOff < 0 && maxOff > 0 ? 'C' : maxOff <= 0 ? 'L' : 'R',
      at: { x: sx / n, y: sy / n },
      area,
    });
  }
  notes.sort((a, b) => b.area - a.area);
  return notes.slice(0, o.max ?? 10).sort((a, b) => a.reach - b.reach);
}

/**
 * Width of the fairway across the line of play at `at` (yards), measured outwards
 * until the surface stops being short grass. Null if `at` isn't on short grass.
 */
export function fairwayWidth(codes: Uint8Array, W: number, H: number, ypp: number, at: Vec2, dir: Vec2, short: number[], maxEachSide = 90): { width: number; left: Vec2; right: Vec2 } | null {
  const ok = (p: Vec2) => {
    const x = Math.floor(p.x / ypp);
    const y = Math.floor(p.y / ypp);
    return x >= 0 && y >= 0 && x < W && y < H && short.includes(codes[y * W + x]);
  };
  if (!ok(at)) return null;
  // Perpendicular to play: right = (−dir.y, dir.x) with +y down.
  const nx = -dir.y;
  const ny = dir.x;
  const step = Math.min(0.5, ypp / 2);
  const walk = (sign: number) => {
    let d = 0;
    while (d + step <= maxEachSide && ok({ x: at.x + nx * sign * (d + step), y: at.y + ny * sign * (d + step) })) d += step;
    return d;
  };
  const r = walk(1);
  const l = walk(-1);
  return { width: Math.round(l + r), left: { x: at.x - nx * l, y: at.y - ny * l }, right: { x: at.x + nx * r, y: at.y + ny * r } };
}

// ---------------------------------------------------------------- hole page frame
export interface Frame {
  /** Clockwise turn in radians that points the hole up the page. */
  angle: number;
  /** Page pixels per yard. */
  scale: number;
  /** Course yards → page pixels. */
  toPage: (w: Vec2) => Vec2;
  /** The canvas transform that maps yards to page pixels: [a, b, c, d, e, f]. */
  matrix: [number, number, number, number, number, number];
}

export interface FrameOptions {
  /** Yards of margin around the hole: beside it, beyond the green, behind the tee. */
  side?: number;
  top?: number;
  bottom?: number;
  /** Largest scale allowed (page px per yard), so a short par 3 isn't blown up absurdly. */
  maxScale?: number;
}

/**
 * Fit a hole into a rectangle of the page with the tee at the bottom and the green at
 * the top. `points` are every point to keep in view (line of play plus all tees).
 */
export function holeFrame(tee: Vec2, green: Vec2, points: Vec2[], plot: { x: number; y: number; w: number; h: number }, o: FrameOptions = {}): Frame {
  // Rotate so the tee → green direction becomes "up" (−y).
  const heading = Math.atan2(green.y - tee.y, green.x - tee.x);
  const angle = -Math.PI / 2 - heading;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const rot = (p: Vec2) => ({ x: p.x * c - p.y * s, y: p.x * s + p.y * c });
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of [tee, green, ...points]) {
    const r = rot(p);
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x);
    y1 = Math.max(y1, r.y);
  }
  x0 -= o.side ?? 55;
  x1 += o.side ?? 55;
  y0 -= o.top ?? 40;
  y1 += o.bottom ?? 30;
  const scale = Math.min(plot.w / (x1 - x0), plot.h / (y1 - y0), o.maxScale ?? 6);
  // Centred in the plot.
  const ox = plot.x + (plot.w - (x1 - x0) * scale) / 2 - x0 * scale;
  const oy = plot.y + (plot.h - (y1 - y0) * scale) / 2 - y0 * scale;
  return {
    angle,
    scale,
    toPage: (w) => {
      const r = rot(w);
      return { x: r.x * scale + ox, y: r.y * scale + oy };
    },
    matrix: [c * scale, s * scale, -s * scale, c * scale, ox, oy],
  };
}

// ---------------------------------------------------------------- presentation sheet
export interface SheetLayout {
  width: number;
  height: number;
  /** Where the course picture goes. */
  map: { x: number; y: number; w: number; h: number };
  title: { x: number; y: number; h: number };
  /** Base size everything else is scaled from (px). */
  unit: number;
  legend: { x: number; y: number; cols: number; rows: number; colW: number; rowH: number };
  /** Bottom strip: scale bar on the left, north arrow on the right. */
  footer: { x: number; y: number; w: number; h: number };
}

/** Lay out a presentation sheet around a course picture of mapW × mapH pixels. */
export function sheetLayout(mapW: number, mapH: number, legendItems: number): SheetLayout {
  const unit = Math.max(12, Math.round(Math.max(mapW, mapH) / 90));
  const margin = unit * 2;
  const titleH = unit * 5;
  const colW = unit * 11;
  const rowH = Math.round(unit * 1.9);
  const cols = Math.max(1, Math.min(legendItems || 1, Math.floor(mapW / colW)));
  const rows = Math.ceil(legendItems / cols);
  const legendH = rows * rowH;
  const footerH = unit * 4;
  const width = mapW + margin * 2;
  const mapY = margin + titleH;
  const legendY = mapY + mapH + unit * 1.5;
  const footerY = legendY + legendH + (rows ? unit : 0);
  return {
    width,
    height: Math.round(footerY + footerH + margin),
    map: { x: margin, y: mapY, w: mapW, h: mapH },
    title: { x: margin, y: margin, h: titleH },
    unit,
    legend: { x: margin, y: Math.round(legendY), cols, rows, colW, rowH },
    footer: { x: margin, y: Math.round(footerY), w: mapW, h: footerH },
  };
}

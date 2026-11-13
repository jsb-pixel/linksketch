/**
 * Builds the fictional sample course that ships with Linksketch
 * (public/samples/sample-course.fairway) using the app's own model code.
 *
 *   npx vite-node scripts/make-sample.ts
 *
 * The course is made up — nine holes on an imaginary piece of sandy ground. It is used
 * for "File → Open sample course", for the website's screenshots and for tests.
 * Everything is deterministic, so running this twice gives the same file.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDoc, createTerrainLayer } from '../src/model/doc';
import { serialize } from '../src/model/io';
import { surfaceCode } from '../src/model/surfaces';
import { createTerrain } from '../src/terrain/terrain';
import type { Feature, Hole, RasterLayer, Vec2, VectorLayer } from '../src/model/types';
import { alongLine, lineLength, pointAlong } from '../src/export/layout';
import { suggestPar } from '../src/model/doc';
import { catmullRomClosed } from '../src/geom/geom';
import { fillPolygon } from '../src/render/raster';

// ------------------------------------------------------------ helpers
let seed = 20261112;
const rnd = () => {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const r1 = (n: number) => Math.round(n * 10) / 10;
let fid = 0;
const shape = (surface: string, points: Vec2[], smooth = true): Feature => ({ id: `s${++fid}`, surface, smooth, points: points.map((p) => ({ x: r1(p.x), y: r1(p.y) })) });

/** A wobbly oval. */
function blob(cx: number, cy: number, rx: number, ry: number, rot = 0, n = 9, wobble = 0.16): Vec2[] {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + (rnd() - 0.5) * 2 * wobble;
    const x = Math.cos(a) * rx * k;
    const y = Math.sin(a) * ry * k;
    return { x: cx + x * c - y * s, y: cy + x * s + y * c };
  });
}

/** The line of play with its corners rounded off, as a dense polyline (for drawing fairways around dog‑legs). */
function rounded(line: Vec2[], radius = 80): Vec2[] {
  const out: Vec2[] = [line[0]];
  for (let i = 1; i < line.length - 1; i++) {
    const a = line[i - 1];
    const c = line[i];
    const b = line[i + 1];
    const la = Math.hypot(c.x - a.x, c.y - a.y);
    const lb = Math.hypot(b.x - c.x, b.y - c.y);
    const ra = Math.min(radius, la / 2);
    const rb = Math.min(radius, lb / 2);
    const p0 = { x: c.x + ((a.x - c.x) / la) * ra, y: c.y + ((a.y - c.y) / la) * ra };
    const p1 = { x: c.x + ((b.x - c.x) / lb) * rb, y: c.y + ((b.y - c.y) / lb) * rb };
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      out.push({ x: (1 - t) ** 2 * p0.x + 2 * t * (1 - t) * c.x + t * t * p1.x, y: (1 - t) ** 2 * p0.y + 2 * t * (1 - t) * c.y + t * t * p1.y });
    }
  }
  out.push(line[line.length - 1]);
  return out;
}

/** A ribbon along a line of play from `from` to `to` yards, `half` yards either side (it swells in the middle). */
function ribbon(straight: Vec2[], from: number, to: number, half: number, step = 34): Vec2[] {
  const line = rounded(straight);
  // Rounding shortens the line a little; keep the ends where they were asked for.
  to -= lineLength(straight) - lineLength(line);
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  const n = Math.max(2, Math.round((to - from) / step));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const { point, dir } = pointAlong(line, from + (to - from) * t);
    const w = half * (0.62 + 0.5 * Math.sin(Math.PI * t)) * (0.9 + rnd() * 0.2);
    left.push({ x: point.x + dir.y * w, y: point.y - dir.x * w });
    right.push({ x: point.x - dir.y * w, y: point.y + dir.x * w });
  }
  return [...left, ...right.reverse()];
}

/** A point `along` yards down the line and `side` yards to the right of it (negative = left). */
function beside(line: Vec2[], along: number, side: number): Vec2 {
  const { point, dir } = pointAlong(line, along);
  return { x: point.x - dir.y * side, y: point.y + dir.x * side };
}

// ------------------------------------------------------------ the routing
interface Plan {
  line: Vec2[];
  /** Bunkers: [yards along, yards right of the line, long radius, short radius]. */
  bunkers: [number, number, number, number][];
  /** Yards in front of the back tee for the Middle and Forward tees. */
  tees: [number, number];
}
const P = (x: number, y: number): Vec2 => ({ x, y });
const plans: Plan[] = [
  { line: [P(140, 860), P(180, 620), P(300, 500)], bunkers: [[232, 30, 13, 8], [250, -34, 11, 7], [392, 24, 9, 7]], tees: [28, 62] },
  { line: [P(360, 440), P(500, 360)], bunkers: [[150, 22, 10, 7], [168, -22, 9, 6]], tees: [18, 42] },
  { line: [P(560, 300), P(780, 230), P(980, 170), P(1090, 140)], bunkers: [[245, -32, 14, 8], [430, 30, 13, 8], [448, -36, 10, 7], [540, 24, 9, 7]], tees: [30, 75] },
  { line: [P(1180, 210), P(1300, 420), P(1340, 560)], bunkers: [[236, -32, 12, 8], [372, 24, 9, 7], [380, -24, 9, 6]], tees: [26, 58] },
  { line: [P(1330, 640), P(1250, 810)], bunkers: [[176, 24, 11, 7], [196, -18, 8, 6], [160, -26, 8, 6]], tees: [20, 48] },
  { line: [P(1180, 880), P(940, 860), P(780, 880)], bunkers: [[238, -30, 13, 8], [384, -24, 9, 7]], tees: [28, 64] },
  { line: [P(720, 800), P(660, 600), P(760, 470), P(880, 440)], bunkers: [[214, -34, 13, 8], [360, 30, 12, 8], [478, -24, 9, 7], [486, 26, 9, 6]], tees: [30, 70] },
  { line: [P(940, 480), P(1070, 650), P(1090, 780)], bunkers: [[206, 32, 12, 8], [330, -24, 9, 7]], tees: [24, 56] },
  { line: [P(620, 920), P(400, 900), P(240, 880)], bunkers: [[224, 32, 13, 8], [226, -34, 11, 7], [366, 24, 9, 7]], tees: [26, 60] },
];

const doc = createDoc({ name: 'Kestrel Dunes (sample)', widthYards: 1500, heightYards: 1000, yardsPerPixel: 1, background: 'grass' });
const base = doc.layers[0] as RasterLayer;
const shapes = doc.layers[1] as VectorLayer;
const detail = doc.layers[2] as RasterLayer;
const W = doc.width;
const H = doc.height;
doc.teeSets = [
  { id: 'back', name: 'Back', color: '#111111' },
  { id: 'middle', name: 'Middle', color: '#1565c0' },
  { id: 'forward', name: 'Forward', color: '#c62828' },
];

const features: Feature[] = [];
const holes: Hole[] = [];
plans.forEach((plan, i) => {
  const { line } = plan;
  const total = lineLength(line);
  const green = line[line.length - 1];
  const last = pointAlong(line, total - 1).dir;
  const rot = Math.atan2(last.y, last.x);
  const par3 = line.length === 2 && total < 260;
  // Rough frames the hole; the fairway runs from in front of the tees to the green's apron.
  features.push(shape('rough', ribbon(line, -22, total + 34, par3 ? 44 : 58)));
  features.push(shape('fairway', par3 ? ribbon(line, total - 62, total - 6, 19, 20) : ribbon(line, 92, total - 8, 31)));
  features.push(shape('green', blob(green.x, green.y, 19 + rnd() * 4, 15 + rnd() * 3, rot, 9, 0.12)));
  for (const [along, side, a, b] of plan.bunkers) {
    const at = beside(line, along, side);
    features.push(shape('bunker', blob(at.x, at.y, a, b, rot + (rnd() - 0.5), 8, 0.2)));
  }
  // Tee boxes: a rectangle per tee set, square to the line of play.
  const first = pointAlong(line, 1).dir;
  const box = (c: Vec2) => {
    const fx = first.x * 7;
    const fy = first.y * 7;
    const sx = -first.y * 5;
    const sy = first.x * 5;
    return [P(c.x - fx - sx, c.y - fy - sy), P(c.x + fx - sx, c.y + fy - sy), P(c.x + fx + sx, c.y + fy + sy), P(c.x - fx + sx, c.y - fy + sy)];
  };
  const middle = pointAlong(line, plan.tees[0]).point;
  const forward = pointAlong(line, plan.tees[1]).point;
  for (const t of [line[0], middle, forward]) features.push(shape('tee', box(t), false));
  holes.push({
    id: `h${i + 1}`,
    number: i + 1,
    par: suggestPar(total),
    points: line.map((p) => ({ ...p })),
    tees: { middle: { x: r1(middle.x), y: r1(middle.y) }, forward: { x: r1(forward.x), y: r1(forward.y) } },
  });
});

// Water: three ponds that come into play.
features.push(shape('water', blob(412, 356, 44, 26, -0.5, 10, 0.14))); // short‑left of the 2nd green
features.push(shape('water', blob(1128, 404, 74, 50, 0.3, 11, 0.14))); // between the 4th and 8th
features.push(shape('water', blob(858, 944, 52, 24, 0.1, 10, 0.14))); // right of the 6th green
// Clubhouse and a practice green by the first tee.
features.push(shape('gray', [P(52, 906), P(112, 906), P(112, 948), P(52, 948)], false));
features.push(shape('green', blob(92, 800, 22, 16, 0.3, 8, 0.1)));
features.push(shape('path', [P(112, 920), P(150, 902), P(152, 876), P(146, 876), P(144, 898), P(112, 912)], false));
shapes.features = features;
doc.holes = holes;
doc.labels = [
  { id: 't1', x: 82, y: 962, text: 'Clubhouse', size: 14 },
  { id: 't2', x: 92, y: 772, text: 'Practice green', size: 10 },
  { id: 't3', x: 1128, y: 404, text: 'Heron Pond', size: 12 },
];

// ------------------------------------------------------------ painted detail
// Distance from any hole's line of play, to keep trees and fescue off the short grass.
const clear = (p: Vec2) => Math.min(...plans.map((pl) => Math.abs(alongLine(pl.line, p).offset)));
const wet = (p: Vec2) => [[412, 356, 60], [1128, 404, 95], [858, 944, 66], [82, 880, 80]].some(([x, y, r]) => Math.hypot(p.x - x, p.y - y) < r);
const fescue = surfaceCode('fescue');
const trees = surfaceCode('trees');
/** Paint a soft‑edged solid patch (the surface's own pixel pattern gives it texture). */
function patch(layer: RasterLayer, c: Vec2, rx: number, ry: number, code: number, keepOff: number): void {
  const outline = catmullRomClosed(blob(c.x, c.y, rx, ry, rnd() * Math.PI, 9, 0.22), 2).poly;
  fillPolygon(outline, { x: 0, y: 0, w: W, h: H }, (y, x0, x1) => {
    for (let x = x0; x <= x1; x++) if (clear(P(x, y)) > keepOff) layer.pixels[y * W + x] = code;
  });
}
// Fescue: drifts between the holes.
for (let n = 0; n < 150; n++) {
  const c = P(rnd() * W, rnd() * H);
  if (clear(c) < 74 || wet(c)) continue;
  patch(base, c, 30 + rnd() * 60, 18 + rnd() * 30, fescue, 64);
}
// Trees: clumps, mostly around the edge of the property.
for (let n = 0; n < 260; n++) {
  const edge = rnd() < 0.55;
  const c = edge ? (rnd() < 0.5 ? P(rnd() * W, rnd() < 0.5 ? rnd() * 60 : H - rnd() * 60) : P(rnd() < 0.5 ? rnd() * 60 : W - rnd() * 60, rnd() * H)) : P(rnd() * W, rnd() * H);
  if (clear(c) < 78 || wet(c)) continue;
  patch(detail, c, 7 + rnd() * 12, 6 + rnd() * 10, trees, 60);
}

// ------------------------------------------------------------ terrain: gentle dunes
// A coarse grid (every 10 yd) keeps the sample file small; dunes this gentle don't need more.
const cell = 10;
const t = { ...createTerrain(W, H, 'sculpted', 0), cell, w: Math.ceil(W / cell) + 1, h: Math.ceil(H / cell) + 1 };
t.heights = new Float32Array(t.w * t.h);
for (let j = 0; j < t.h; j++)
  for (let i = 0; i < t.w; i++) {
    const x = i * t.cell;
    const y = j * t.cell;
    const h =
      18 +
      9 * Math.sin(x / 170 + 0.6) * Math.cos(y / 140 - 0.4) +
      6 * Math.sin((x + y) / 95) +
      4 * Math.cos((x - 1.7 * y) / 60) +
      (x / W) * 14 -
      (y / H) * 8;
    t.heights[j * t.w + i] = Math.round(h * 10) / 10;
  }
doc.terrain = t;
// Off by default so the sample opens as a clean drawing; turn it on in the Layers panel.
doc.layers = [...doc.layers, { ...createTerrainLayer(), visible: false, interval: 5, opacity: 0.6 }];

const out = join(dirname(fileURLToPath(import.meta.url)), '../public/samples/sample-course.fairway');
// Stable ids so the file doesn't change from run to run.
doc.layers.forEach((l, i) => (l.id = `layer${i + 1}`));
writeFileSync(out, serialize(doc));
const yards = holes.reduce((n, h) => n + Math.round(lineLength(h.points)), 0);
console.log(`wrote ${out}: ${holes.length} holes, par ${holes.reduce((n, h) => n + h.par, 0)}, ${yards} yd, ${features.length} shapes`);

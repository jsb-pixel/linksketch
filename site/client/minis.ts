/**
 * The home page's "minis": three small live toys built from the real Linksketch code —
 * the same rasterizer, surfaces and strategy maths as the editor.
 */
import { createDoc } from '../../src/model/doc';
import { rgbCss, surfaceByCode, surfaceById, surfaceCode, surfaceColor } from '../../src/model/surfaces';
import type { CourseDoc, Feature, RasterLayer, Vec2, VectorLayer } from '../../src/model/types';
import { renderRegion, visibleCodes } from '../../src/render/raster';
import { drawShots } from '../../src/strategy/draw';
import { DEFAULT_PLAYERS, landingOdds, OUTCOMES, planShots, troubleShare } from '../../src/strategy/strategy';
import { drawFlag, drawPlayLine } from '../../src/editor/holes';

const W = 140; // yards across each mini (the canvas is 3 screen pixels per yard)
const H = 100;
const K = 3;

const blob = (cx: number, cy: number, rx: number, ry: number, rot = 0, n = 9): Vec2[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + 0.12 * Math.sin(3 * a + cx);
    const x = Math.cos(a) * rx * k;
    const y = Math.sin(a) * ry * k;
    return { x: cx + x * Math.cos(rot) - y * Math.sin(rot), y: cy + x * Math.sin(rot) + y * Math.cos(rot) };
  });

let seq = 0;
const shape = (surface: string, points: Vec2[]): Feature => ({ id: `m${++seq}`, surface, smooth: true, points });

/** A small course: one green with a bunker and a pond, and a strip of fairway. */
function scene(): CourseDoc {
  const doc = createDoc({ widthYards: W, heightYards: H, background: 'grass' });
  (doc.layers[1] as VectorLayer).features = [
    shape('rough', blob(70, 52, 74, 44, 0.05, 11)),
    shape('fairway', blob(42, 58, 44, 17, -0.1)),
    shape('green', blob(98, 46, 21, 16, -0.3)),
    shape('bunker', blob(92, 70, 11, 6, 0.3)),
    shape('bunker', blob(120, 34, 7, 5, 0.2)),
    shape('water', blob(74, 22, 20, 9, -0.2)),
  ];
  return doc;
}

/** Paint a doc onto a canvas at K screen pixels per doc pixel, hard‑edged. */
function paintDoc(ctx: CanvasRenderingContext2D, doc: CourseDoc, buf: HTMLCanvasElement): void {
  const data = renderRegion(doc, { x: 0, y: 0, w: doc.width, h: doc.height });
  buf.width = doc.width;
  buf.height = doc.height;
  buf.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data.buffer), doc.width, doc.height), 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = rgbCss(surfaceColor(doc.background));
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.drawImage(buf, 0, 0, doc.width * K, doc.height * K);
}

/** Pointer position in yards. */
function yardsAt(canvas: HTMLCanvasElement, e: PointerEvent): Vec2 {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
}

/** Dragging with mouse, touch or pen; arrow keys move 2 yards for keyboard users. */
function draggable(canvas: HTMLCanvasElement, get: () => Vec2, set: (p: Vec2) => void, grab = 16): void {
  let on = false;
  const clamp = (p: Vec2) => ({ x: Math.max(2, Math.min(W - 2, p.x)), y: Math.max(2, Math.min(H - 2, p.y)) });
  canvas.addEventListener('pointerdown', (e) => {
    const p = yardsAt(canvas, e);
    const g = get();
    if (grab < 999 && Math.hypot(p.x - g.x, p.y - g.y) > grab) return;
    on = true;
    canvas.setPointerCapture(e.pointerId);
    set(clamp(p));
  });
  canvas.addEventListener('pointermove', (e) => on && set(clamp(yardsAt(canvas, e))));
  const end = () => (on = false);
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('keydown', (e) => {
    const d: Record<string, [number, number]> = { ArrowLeft: [-2, 0], ArrowRight: [2, 0], ArrowUp: [0, -2], ArrowDown: [0, 2] };
    const m = d[e.key];
    if (!m) return;
    e.preventDefault();
    const g = get();
    set(clamp({ x: g.x + m[0], y: g.y + m[1] }));
  });
}

const toScreen = (w: Vec2): Vec2 => ({ x: w.x * K, y: w.y * K });

// ---------------------------------------------------------------- 1. shot pattern
function patternMini(el: HTMLElement): void {
  const canvas = el.querySelector('canvas')!;
  const out = el.querySelector<HTMLElement>('[data-out]')!;
  const ctx = canvas.getContext('2d')!;
  const buf = document.createElement('canvas');
  const doc = scene();
  const codes = visibleCodes(doc);
  const surfaceAt = (w: Vec2): string | null => {
    const x = Math.floor(w.x);
    const y = Math.floor(w.y);
    if (x < 0 || y < 0 || x >= W || y >= H) return null;
    return surfaceByCode(codes[y * W + x])?.id ?? 'rough';
  };
  const tee = { x: -150, y: 62 }; // off to the left: a 240‑odd yard approach line
  let target = { x: 98, y: 46 };
  const player = { ...DEFAULT_PLAYERS[1], maxYards: 400 };
  const draw = () => {
    paintDoc(ctx, doc, buf);
    const hole = { id: 'm', number: 1, par: 4, points: [tee, target] };
    const [s] = planShots(hole, player);
    // A mid‑iron's spread, whatever the made‑up distance.
    s.sigmaSide = 9;
    s.sigmaDepth = 5.4;
    const odds = landingOdds(s, surfaceAt);
    drawPlayLine(ctx, [toScreen({ x: 0, y: s.from.y + ((target.y - s.from.y) * (0 - s.from.x)) / (target.x - s.from.x) }), toScreen(target)], false, 1.2);
    drawShots(ctx, player, [s], [odds], { toScreen, unitsPerYard: K, labels: false });
    drawFlag(ctx, toScreen({ x: 98, y: 46 }), 1.3);
    const top = odds.slice(0, 4).map((o) => `${Math.round(o.share * 100)}% ${OUTCOMES[o.outcome].label}`);
    out.textContent = `${Math.round(troubleShare(odds) * 100)}% trouble — ${top.join(', ')}`;
    out.dataset.trouble = String(Math.round(troubleShare(odds) * 100));
  };
  draggable(canvas, () => target, (p) => {
    target = p;
    draw();
  }, 999);
  draw();
}

// ---------------------------------------------------------------- 2. pixel paint
function paintMini(el: HTMLElement): void {
  const canvas = el.querySelector('canvas')!;
  const out = el.querySelector<HTMLElement>('[data-out]')!;
  const swatches = el.querySelector<HTMLElement>('[data-swatches]')!;
  const ctx = canvas.getContext('2d')!;
  const buf = document.createElement('canvas');
  const doc = createDoc({ widthYards: W / 2, heightYards: H / 2, background: 'grass' }); // chunkier pixels: 6 screen px each
  const layer = doc.layers[0] as RasterLayer;
  const DW = doc.width;
  const DH = doc.height;
  let surface = 'green';
  const dab = (cx: number, cy: number, r: number, code: number) => {
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++)
        if (x >= 0 && y >= 0 && x < DW && y < DH && (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) layer.pixels[y * DW + x] = code;
  };
  // Start with something on the canvas: a fairway leading to a green and a bunker.
  for (let x = 4; x < 40; x++) dab(x, 30 - x * 0.12, 6, surfaceCode('fairway'));
  dab(48, 22, 9, surfaceCode('green'));
  dab(57, 33, 3.5, surfaceCode('bunker'));
  const draw = () => {
    const data = renderRegion(doc, { x: 0, y: 0, w: DW, h: DH });
    buf.width = DW;
    buf.height = DH;
    buf.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data.buffer), DW, DH), 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = rgbCss(surfaceColor('grass'));
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(buf, 0, 0, canvas.width, canvas.height);
    const n = layer.pixels.reduce((t, v) => t + (v === surfaceCode('green') ? 1 : 0), 0);
    out.textContent = `Green: ${(n * 9).toLocaleString()} sq ft`;
    out.dataset.painted = String(layer.pixels.reduce((t, v) => t + (v ? 1 : 0), 0));
  };
  for (const id of ['green', 'fairway', 'bunker', 'water']) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mini-swatch';
    b.style.background = rgbCss(surfaceColor(id));
    b.title = surfaceById(id)!.name;
    b.setAttribute('aria-label', `Paint ${surfaceById(id)!.name}`);
    b.setAttribute('aria-pressed', String(id === surface));
    b.addEventListener('click', () => {
      surface = id;
      swatches.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    });
    swatches.append(b);
  }
  let last: Vec2 | null = null;
  let cursor = { x: W / 2, y: H / 2 };
  const stroke = (p: Vec2) => {
    const q = { x: p.x / 2, y: p.y / 2 };
    const from = last ?? q;
    const steps = Math.max(1, Math.ceil(Math.hypot(q.x - from.x, q.y - from.y)));
    for (let i = 0; i <= steps; i++) dab(from.x + ((q.x - from.x) * i) / steps, from.y + ((q.y - from.y) * i) / steps, 2.6, surfaceCode(surface));
    last = q;
    cursor = p;
    draw();
  };
  draggable(canvas, () => cursor, stroke, 999);
  canvas.addEventListener('pointerdown', (e) => {
    last = null;
    stroke(yardsAt(canvas, e));
  });
  canvas.addEventListener('pointerup', () => (last = null));
  draw();
}

// ---------------------------------------------------------------- 3. yardage ruler
function rulerMini(el: HTMLElement): void {
  const canvas = el.querySelector('canvas')!;
  const out = el.querySelector<HTMLElement>('[data-out]')!;
  const ctx = canvas.getContext('2d')!;
  const buf = document.createElement('canvas');
  const doc = scene();
  const pin = { x: 98, y: 46 };
  let ball = { x: 30, y: 62 };
  const draw = () => {
    paintDoc(ctx, doc, buf);
    const p = toScreen(pin);
    const b = toScreen(ball);
    const d = Math.hypot(ball.x - pin.x, ball.y - pin.y);
    // Arcs every 25 yards from the pin, facing the ball.
    const dir = Math.atan2(b.y - p.y, b.x - p.x);
    ctx.save();
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let r = 25; r <= 125; r += 25) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * K, dir - 0.5, dir + 0.5);
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      const lx = p.x + Math.cos(dir + 0.5) * r * K;
      const ly = p.y + Math.sin(dir + 0.5) * r * K;
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(lx - 13, ly - 8, 26, 16);
      ctx.fillStyle = '#fff';
      ctx.fillText(String(r), lx, ly + 0.5);
    }
    ctx.restore();
    drawPlayLine(ctx, [b, p], true, 1.2);
    drawFlag(ctx, p, 1.3);
    ctx.beginPath();
    ctx.arc(b.x, b.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#000';
    ctx.stroke();
    out.textContent = `${Math.round(d)} yards to the pin`;
    out.dataset.yards = String(Math.round(d));
  };
  draggable(canvas, () => ball, (p) => {
    ball = p;
    draw();
  }, 999);
  draw();
}

export function startMinis(els: NodeListOf<HTMLElement>, _reducedMotion: boolean): void {
  for (const el of els) {
    const kind = el.dataset.mini;
    if (kind === 'pattern') patternMini(el);
    else if (kind === 'paint') paintMini(el);
    else if (kind === 'ruler') rulerMini(el);
    el.classList.add('ready');
  }
}

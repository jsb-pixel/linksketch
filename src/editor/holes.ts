/** Drawing holes (line of play, tee marker, flag, yardage) and distance arcs. */
import { dist, pathLength } from '../geom/geom';
import type { Hole, Vec2 } from '../model/types';

export const TEE_ARCS = [150, 200, 250, 300];
export const GREEN_ARCS = [50, 100, 150, 200];

export const holeYards = (h: Hole): number => Math.round(pathLength(h.points));

export interface HoleDrawOptions {
  toScreen: (w: Vec2) => Vec2;
  /** Canvas units per yard (for arc radii). */
  unitsPerYard: number;
  selectedId?: string | null;
  arcsFromTee?: boolean;
  arcsToGreen?: boolean;
  /** Draw edit handles on the selected hole. */
  handles?: boolean;
  /** Multiplies label/marker sizes (export at 2× / 4×). */
  uiScale?: number;
}

export function drawHoles(ctx: CanvasRenderingContext2D, holes: Hole[], o: HoleDrawOptions): void {
  const k = o.uiScale ?? 1;
  const sorted = [...holes].sort((a, b) => (a.id === o.selectedId ? 1 : 0) - (b.id === o.selectedId ? 1 : 0));
  for (const h of sorted) {
    if (h.points.length < 2) continue;
    const sel = h.id === o.selectedId;
    if (sel) drawArcs(ctx, h, o, k);
    drawPlayLine(ctx, h.points.map(o.toScreen), sel, k);
    const scr = h.points.map(o.toScreen);
    drawFlag(ctx, scr[scr.length - 1], k);
    drawTee(ctx, scr[0], h.number, k);
    drawLabel(ctx, h, scr, k, sel);
    if (sel && o.handles) {
      ctx.save();
      for (const s of scr) {
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#000';
        ctx.fillRect(Math.round(s.x - 3.5), Math.round(s.y - 3.5), 7, 7);
        ctx.strokeRect(Math.round(s.x - 3.5) + 0.5, Math.round(s.y - 3.5) + 0.5, 6, 6);
      }
      ctx.restore();
    }
  }
}

/** Line of play for a hole being drawn (or any polyline). */
export function drawPlayLine(ctx: CanvasRenderingContext2D, scr: Vec2[], selected: boolean, k = 1): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  scr.forEach((s, i) => (i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y)));
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 3.5 * k;
  ctx.stroke();
  ctx.setLineDash([6 * k, 4 * k]);
  ctx.strokeStyle = selected ? '#0a64ff' : 'rgba(0,0,0,0.85)';
  ctx.lineWidth = 1.5 * k;
  ctx.stroke();
  ctx.setLineDash([]);
  for (const s of scr.slice(1, -1)) {
    ctx.beginPath();
    ctx.arc(s.x, s.y, 3 * k, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 1 * k;
    ctx.strokeStyle = '#000';
    ctx.stroke();
  }
  ctx.restore();
}

function drawTee(ctx: CanvasRenderingContext2D, s: Vec2, n: number, k: number): void {
  ctx.save();
  ctx.font = `bold ${11 * k}px system-ui, sans-serif`;
  const text = String(n);
  const w = Math.max(16 * k, ctx.measureText(text).width + 8 * k);
  const hgt = 15 * k;
  ctx.fillStyle = '#000';
  ctx.fillRect(Math.round(s.x - w / 2), Math.round(s.y - hgt / 2), w, hgt);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1 * k;
  ctx.strokeRect(Math.round(s.x - w / 2) + 0.5, Math.round(s.y - hgt / 2) + 0.5, w - 1, hgt - 1);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, s.x, s.y + 0.5 * k);
  ctx.restore();
}

function drawFlag(ctx: CanvasRenderingContext2D, s: Vec2, k: number): void {
  ctx.save();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1.5 * k;
  ctx.beginPath();
  ctx.moveTo(s.x, s.y);
  ctx.lineTo(s.x, s.y - 18 * k);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(s.x, s.y - 18 * k);
  ctx.lineTo(s.x + 10 * k, s.y - 14.5 * k);
  ctx.lineTo(s.x, s.y - 11 * k);
  ctx.closePath();
  ctx.fillStyle = '#ed1c24';
  ctx.fill();
  ctx.lineWidth = 1 * k;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(s.x, s.y, 2.5 * k, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawLabel(ctx: CanvasRenderingContext2D, h: Hole, scr: Vec2[], k: number, sel: boolean): void {
  // Put the label behind the tee, away from the line of play.
  const a = scr[0];
  const b = scr[1];
  const d = dist(a, b) || 1;
  const ux = (a.x - b.x) / d;
  const uy = (a.y - b.y) / d;
  const text = `${holeYards(h)} yd · Par ${h.par}`;
  ctx.save();
  ctx.font = `bold ${11 * k}px system-ui, sans-serif`;
  const w = ctx.measureText(text).width + 10 * k;
  const hgt = 16 * k;
  const cx = a.x + ux * (18 * k + w / 2 * Math.abs(ux));
  const cy = a.y + uy * (18 * k + hgt / 2 * Math.abs(uy) + 4 * k);
  ctx.fillStyle = sel ? '#0a64ff' : 'rgba(255,255,255,0.92)';
  ctx.fillRect(Math.round(cx - w / 2), Math.round(cy - hgt / 2), w, hgt);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(cx - w / 2) + 0.5, Math.round(cy - hgt / 2) + 0.5, w - 1, hgt - 1);
  ctx.fillStyle = sel ? '#fff' : '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy + 0.5 * k);
  ctx.restore();
}

function drawArcs(ctx: CanvasRenderingContext2D, h: Hole, o: HoleDrawOptions, k: number): void {
  const pts = h.points;
  const set = (center: Vec2, toward: Vec2, radii: number[], color: string) => {
    const c = o.toScreen(center);
    const t = o.toScreen(toward);
    const dir = Math.atan2(t.y - c.y, t.x - c.x);
    const span = (35 * Math.PI) / 180;
    ctx.save();
    ctx.font = `bold ${10 * k}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const r of radii) {
      const rs = r * o.unitsPerYard;
      ctx.beginPath();
      ctx.arc(c.x, c.y, rs, dir - span, dir + span);
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 3 * k;
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5 * k;
      ctx.stroke();
      const lx = c.x + Math.cos(dir + span) * rs;
      const ly = c.y + Math.sin(dir + span) * rs;
      const label = String(r);
      const w = ctx.measureText(label).width + 6 * k;
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(lx - w / 2, ly - 7 * k, w, 14 * k);
      ctx.fillStyle = color;
      ctx.fillText(label, lx, ly + 0.5 * k);
    }
    ctx.restore();
  };
  if (o.arcsFromTee) set(pts[0], pts[1], TEE_ARCS, '#ffeb3b');
  if (o.arcsToGreen) set(pts[pts.length - 1], pts[pts.length - 2], GREEN_ARCS, '#ffffff');
}

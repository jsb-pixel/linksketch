/** Text labels on the course (for presentation drawings). */
import type { TextLabel, Vec2 } from './types';

/** Sizes offered when placing a label: text height in yards. */
export const LABEL_SIZES: { size: number; name: string }[] = [
  { size: 8, name: 'Small (8 yd tall)' },
  { size: 14, name: 'Medium (14 yd)' },
  { size: 24, name: 'Large (24 yd)' },
  { size: 40, name: 'Title (40 yd)' },
];

/** Rough width of a label in yards (bold sans is about 0.58 × its height per letter). */
export function labelWidth(l: Pick<TextLabel, 'text' | 'size'>): number {
  return Math.max(l.size * 0.6, l.text.length * l.size * 0.58);
}

/** The label under a course point (top‑most = last drawn), or null. */
export function hitLabel(labels: TextLabel[] | undefined, w: Vec2, slopYards = 0): TextLabel | null {
  if (!labels) return null;
  for (let i = labels.length - 1; i >= 0; i--) {
    const l = labels[i];
    const hw = labelWidth(l) / 2 + slopYards;
    const hh = l.size * 0.65 + slopYards;
    if (Math.abs(w.x - l.x) <= hw && Math.abs(w.y - l.y) <= hh) return l;
  }
  return null;
}

export interface LabelDrawOptions {
  toScreen: (w: Vec2) => Vec2;
  unitsPerYard: number;
  selectedId?: string | null;
  /** Rotation of the target in radians (labels stay upright on the course: 0 = north up). */
  angle?: number;
}

/** Draw labels: bold black text with a white halo, centred on their position. */
export function drawLabels(ctx: CanvasRenderingContext2D, labels: TextLabel[] | undefined, o: LabelDrawOptions): void {
  if (!labels?.length) return;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  for (const l of labels) {
    const px = l.size * o.unitsPerYard;
    if (px < 3) continue; // too small to read at this zoom
    const s = o.toScreen(l);
    ctx.save();
    ctx.translate(s.x, s.y);
    if (o.angle) ctx.rotate(o.angle);
    ctx.font = `bold ${px}px "Helvetica Neue", Arial, system-ui, sans-serif`;
    ctx.lineWidth = Math.max(2, px * 0.22);
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.strokeText(l.text, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillText(l.text, 0, 0);
    if (l.id === o.selectedId) {
      const w = ctx.measureText(l.text).width + px * 0.5;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = '#0a64ff';
      ctx.strokeRect(-w / 2, -px * 0.7, w, px * 1.4);
    }
    ctx.restore();
  }
  ctx.restore();
}

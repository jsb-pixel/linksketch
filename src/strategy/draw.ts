/** Drawing landing patterns (soft ovals with 1σ / 2σ rings). */
import type { Vec2 } from '../model/types';
import { OUTCOMES, troubleShare, type Odds, type PlayerProfile, type Shot } from './strategy';

type Box = { x: number; y: number; w: number; h: number };

export interface StrategyDrawOptions {
  toScreen: (w: Vec2) => Vec2;
  unitsPerYard: number;
  /** Multiplies label sizes (export at 2× / 4×). */
  uiScale?: number;
  labels?: boolean;
  /** Label boxes already drawn this pass (shared across players), to avoid overlaps. */
  placed?: Box[];
  /** Short labels ("235 · 18%") for when several players are shown together. */
  compact?: boolean;
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function drawShots(
  ctx: CanvasRenderingContext2D,
  player: PlayerProfile,
  shots: Shot[],
  odds: (Odds | null)[],
  o: StrategyDrawOptions,
): void {
  const k = o.uiScale ?? 1;
  const u = o.unitsPerYard;
  for (const s of shots) {
    const c = o.toScreen(s.center);
    const ahead = o.toScreen({ x: s.center.x + s.dir.x, y: s.center.y + s.dir.y });
    const ang = Math.atan2(ahead.y - c.y, ahead.x - c.x);
    const rd = s.sigmaDepth * u;
    const rs = s.sigmaSide * u;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(ang);
    // Soft fill: a radial gradient squashed into the oval.
    ctx.save();
    ctx.rotate(s.tilt);
    ctx.scale(rd, rs);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 2);
    g.addColorStop(0, rgba(player.color, 0.42));
    g.addColorStop(0.5, rgba(player.color, 0.22));
    g.addColorStop(1, rgba(player.color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    for (const [m, dash] of [
      [1, [] as number[]],
      [2, [4 * k, 3 * k]],
    ] as const) {
      ctx.beginPath();
      ctx.ellipse(0, 0, rd * m, rs * m, s.tilt, 0, Math.PI * 2);
      ctx.setLineDash(dash);
      ctx.lineWidth = 3 * k;
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.stroke();
      ctx.lineWidth = 1.25 * k;
      ctx.strokeStyle = player.color;
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
    // Aimed off the line of play: show the actual line of the shot.
    if (s.custom) {
      const f = o.toScreen(s.from);
      ctx.save();
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(f.x, f.y);
      ctx.lineTo(c.x, c.y);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 3 * k;
      ctx.stroke();
      ctx.strokeStyle = player.color;
      ctx.lineWidth = 1.25 * k;
      ctx.stroke();
      ctx.restore();
    }
    // Centre mark.
    ctx.save();
    ctx.fillStyle = player.color;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5 * k;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 3 * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // Short of the target: dotted line to where they wanted to be.
    if (s.short > 1) {
      const t = o.toScreen(s.target);
      ctx.save();
      ctx.setLineDash([2 * k, 3 * k]);
      ctx.strokeStyle = player.color;
      ctx.lineWidth = 1.5 * k;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(t.x, t.y);
      ctx.stroke();
      ctx.restore();
    }
    const od = odds[s.index];
    if (o.labels !== false && od) drawLabel(ctx, s, od, c, ang, rs * 2, player, k, o.placed ?? [], !!o.compact);
  }
}

/** Label text for a shot. Compact = just distance and trouble share. */
export function shotLabel(s: Shot, od: Odds, compact: boolean): string {
  const trouble = Math.round(troubleShare(od) * 100);
  if (compact) return `${s.extra ? '+ ' : ''}${Math.round(s.yards)} · ${trouble}%`;
  const top = od.filter((x) => OUTCOMES[x.outcome].bad && x.share >= 0.03).slice(0, 2);
  const detail = top.map((x) => `${Math.round(x.share * 100)}% ${OUTCOMES[x.outcome].label}`).join(' · ');
  return `${s.extra ? '+ ' : ''}${Math.round(s.yards)} yd${s.short > 1 ? ` (${Math.round(s.short)} short)` : ''} · ${trouble}% trouble${detail ? ` — ${detail}` : ''}`;
}

function drawLabel(ctx: CanvasRenderingContext2D, s: Shot, od: Odds, c: Vec2, ang: number, off: number, p: PlayerProfile, k: number, placed: Box[], compact: boolean): void {
  const trouble = Math.round(troubleShare(od) * 100);
  const text = shotLabel(s, od, compact);
  ctx.save();
  ctx.font = `bold ${10 * k}px system-ui, sans-serif`;
  const w = ctx.measureText(text).width + 8 * k;
  const h = 15 * k;
  // To the right of the line of play (screen space), clear of the 2σ oval.
  const nx = -Math.sin(ang);
  const ny = Math.cos(ang);
  const d = off + 10 * k + (Math.abs(nx) * w) / 2 + (Math.abs(ny) * h) / 2;
  const x = c.x + nx * d;
  let y = c.y + ny * d;
  // Slide down past labels already drawn (several players / shots near the green).
  const hit = (yy: number) => placed.some((b) => Math.abs(b.x - x) * 2 < b.w + w && Math.abs(b.y - yy) * 2 < b.h + h + 2 * k);
  for (let n = 0; n < 20 && hit(y); n++) y += h + 2 * k;
  placed.push({ x, y, w, h });
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillRect(Math.round(x - w / 2), Math.round(y - h / 2), w, h);
  ctx.strokeStyle = p.color;
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(x - w / 2) + 0.5, Math.round(y - h / 2) + 0.5, w - 1, h - 1);
  ctx.fillStyle = trouble >= 25 ? '#b71c1c' : '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5 * k);
  ctx.restore();
}

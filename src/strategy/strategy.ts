/**
 * Strategy mode: where shots land for different players, and what they land in.
 *
 * Simple model (by design — room for wind, slope and roll later):
 * - Each leg of a hole's line of play (tee → aim point → … → green) is one planned shot,
 *   played from where the previous shot finished on average. A shot can be aimed
 *   elsewhere (`hole.targets[i]`, e.g. the middle of the green instead of the flag).
 * - A player hits at most `maxYards`; a longer leg means the shot finishes short, and
 *   extra shots are added (straight at the green) until the green is reached.
 * - Landing spots spread as a 2‑D normal distribution around the target. A player's
 *   pattern *width* is given in yards for the driver and for a 150‑yd approach; other
 *   distances interpolate (shorter than 150 scales down in proportion). Width means the
 *   dashed 2σ oval, so 1σ sideways = width / 4. Long/short spread = sideways × depthRatio.
 * - Patterns are tilted: a right‑hander misses short‑right and long‑left (fades lose
 *   distance, draws run out). Left‑handers are mirrored.
 * - The drawn ovals are 1σ (≈39% of shots) and 2σ (≈86%).
 * - Hazard odds come from a fixed set of quasi‑random samples, so numbers are stable
 *   from frame to frame.
 */
import type { Hole, Vec2 } from '../model/types';

export interface PlayerProfile {
  id: string;
  name: string;
  /** Longest shot (driver, carry + roll) in yards. */
  maxYards: number;
  /** Driver pattern width in yards (dashed oval, ≈ 9 in 10 shots). */
  driverWidth: number;
  /** Pattern width for a 150‑yd approach, yards. */
  approachWidth: number;
  /** Long/short spread as a share of the sideways spread. */
  depthRatio: number;
  /** Degrees the pattern is turned: short‑right → long‑left for a right‑hander. */
  tilt: number;
  lefty: boolean;
  color: string;
}

// Starting points (editable per course): rough estimates from published shot data.
export const DEFAULT_PLAYERS: PlayerProfile[] = [
  { id: 'scratch', name: 'Scratch', maxYards: 265, driverWidth: 60, approachWidth: 24, depthRatio: 0.6, tilt: 15, lefty: false, color: '#1565c0' },
  { id: 'mid', name: '10 handicap', maxYards: 235, driverWidth: 75, approachWidth: 36, depthRatio: 0.6, tilt: 15, lefty: false, color: '#e65100' },
  { id: 'high', name: '20 handicap', maxYards: 205, driverWidth: 90, approachWidth: 48, depthRatio: 0.6, tilt: 15, lefty: false, color: '#c62828' },
];

/** Pattern width (yards) for a shot of `yards` by this player. */
export function patternWidth(p: PlayerProfile, yards: number): number {
  const A = 150;
  if (p.maxYards <= A) return (p.driverWidth * yards) / p.maxYards;
  if (yards <= A) return (p.approachWidth * yards) / A;
  const t = Math.min(1, (yards - A) / (p.maxYards - A));
  return p.approachWidth + (p.driverWidth - p.approachWidth) * t;
}

/** Smallest spread, so short pitches don't collapse to a dot. */
const MIN_SIGMA = 1.5;

export interface Shot {
  index: number;
  from: Vec2;
  /** Intended target (the next point on the line of play). */
  target: Vec2;
  /** Centre of the landing pattern (short of the target if out of range). */
  center: Vec2;
  /** Unit vector of play. */
  dir: Vec2;
  yards: number;
  /** Yards short of the target when the leg is longer than the player's range. */
  short: number;
  sigmaSide: number;
  sigmaDepth: number;
  /** Pattern turn in radians (+ = right end short, as for a right‑hander). */
  tilt: number;
  toGreen: boolean;
  /** Added because the player couldn't reach the green in the planned shots. */
  extra: boolean;
  /** Aimed at a dragged target rather than the line of play. */
  custom: boolean;
}

export function planShots(hole: Hole, p: PlayerProfile): Shot[] {
  const out: Shot[] = [];
  const pts = hole.points;
  if (pts.length < 2) return out;
  const green = pts[pts.length - 1];
  let from = pts[0];
  const add = (planned: Vec2, toGreen: boolean, extra: boolean): boolean => {
    const custom = hole.targets?.[out.length] ?? null;
    const target = custom ?? planned;
    const dx = target.x - from.x;
    const dy = target.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) return false;
    const dir = { x: dx / len, y: dy / len };
    const yards = Math.min(len, p.maxYards);
    const center = { x: from.x + dir.x * yards, y: from.y + dir.y * yards };
    out.push({
      index: out.length,
      from,
      target,
      center,
      dir,
      yards,
      short: len - yards,
      sigmaSide: Math.max(MIN_SIGMA, patternWidth(p, yards) / 4),
      sigmaDepth: Math.max(MIN_SIGMA, (patternWidth(p, yards) / 4) * p.depthRatio),
      tilt: ((p.lefty ? -1 : 1) * p.tilt * Math.PI) / 180,
      toGreen,
      extra,
      custom: !!custom,
    });
    // The next shot is played from where this one finishes on average.
    from = center;
    return true;
  };
  for (let i = 1; i < pts.length; i++) add(pts[i], i === pts.length - 1, false);
  // Can't get there in the planned shots: keep going straight at the green.
  for (let n = 0; n < 4 && out.length && out[out.length - 1].short > 1; n++) add(green, true, true);
  return out;
}

/**
 * Cache key for a shot's landing odds: everything `samplePoint` reads. (Tilt matters —
 * a left‑hander's pattern is the mirror image with the same centre and spreads.)
 */
export function shotKey(s: Shot): string {
  return [s.center.x.toFixed(2), s.center.y.toFixed(2), s.dir.x.toFixed(4), s.dir.y.toFixed(4), s.sigmaSide.toFixed(2), s.sigmaDepth.toFixed(2), s.tilt.toFixed(4)].join(',');
}

/**
 * Shot targets are stored by shot number (shot k is played to point k+1), so they
 * must follow when a point is added to or taken out of the line of play.
 */
export function targetsAfterPointRemoved(targets: (Vec2 | null)[] | undefined, pointIndex: number): (Vec2 | null)[] | undefined {
  if (!targets) return undefined;
  const out = targets.slice();
  out.splice(Math.max(0, pointIndex - 1), 1);
  return trimTargets(out);
}
export function targetsAfterPointInserted(targets: (Vec2 | null)[] | undefined, pointIndex: number): (Vec2 | null)[] | undefined {
  if (!targets) return undefined;
  const out = targets.slice();
  const at = Math.max(0, pointIndex - 1);
  while (out.length < at) out.push(null);
  out.splice(at, 0, null);
  return trimTargets(out);
}
function trimTargets(out: (Vec2 | null)[]): (Vec2 | null)[] | undefined {
  while (out.length && !out[out.length - 1]) out.pop();
  return out.length ? out : undefined;
}

// ---------------------------------------------------------------- outcomes
export type Outcome = 'fairway' | 'green' | 'rough' | 'fescue' | 'sand' | 'water' | 'trees' | 'other' | 'out';

export const OUTCOMES: Record<Outcome, { label: string; color: string; bad: boolean }> = {
  green: { label: 'green', color: '#4caf50', bad: false },
  fairway: { label: 'fairway', color: '#7cb342', bad: false },
  rough: { label: 'rough', color: '#558b2f', bad: false },
  fescue: { label: 'fescue', color: '#9e9d24', bad: true },
  sand: { label: 'sand', color: '#d7b56d', bad: true },
  water: { label: 'water', color: '#1e88e5', bad: true },
  trees: { label: 'trees', color: '#1b5e20', bad: true },
  other: { label: 'other', color: '#8d6e63', bad: false },
  out: { label: 'off course', color: '#757575', bad: true },
};

/** Which outcome a surface id counts as. Unpainted ground and plain colors count as rough. */
export function outcomeOf(surface: string | null): Outcome {
  switch (surface) {
    case null:
      return 'out';
    case 'fairway':
    case 'tee':
      return 'fairway';
    case 'green':
      return 'green';
    case 'fescue':
      return 'fescue';
    case 'bunker':
    case 'waste':
      return 'sand';
    case 'water':
      return 'water';
    case 'trees':
      return 'trees';
    case 'dirt':
    case 'path':
      return 'other';
    default:
      return 'rough';
  }
}

/** Standard‑normal sample pairs from a Halton sequence (fixed, so results are stable). */
function halton(i: number, b: number): number {
  let f = 1;
  let r = 0;
  while (i > 0) {
    f /= b;
    r += f * (i % b);
    i = Math.floor(i / b);
  }
  return r;
}
const SAMPLES: [number, number][] = [];
for (let i = 1; i <= 800; i++) {
  const u = halton(i, 2);
  const v = halton(i, 3);
  const r = Math.sqrt(-2 * Math.log(1 - u * 0.9999));
  SAMPLES.push([r * Math.cos(2 * Math.PI * v), r * Math.sin(2 * Math.PI * v)]);
}

/** Landing spot for a sample (z1 along the line of play, z2 sideways). */
export function samplePoint(s: Shot, z1: number, z2: number): Vec2 {
  const a = z1 * s.sigmaDepth;
  const b = z2 * s.sigmaSide; // + = right of the line of play
  // Turn the pattern: misses to the right come up short, misses left run long.
  const c = Math.cos(s.tilt);
  const n = Math.sin(s.tilt);
  const along = a * c - b * n;
  const side = a * n + b * c;
  return { x: s.center.x + s.dir.x * along - s.dir.y * side, y: s.center.y + s.dir.y * along + s.dir.x * side };
}

export type Odds = { outcome: Outcome; share: number }[];

/** Share of shots finishing in each outcome, largest first. `surfaceAt` returns null off the course. */
export function landingOdds(s: Shot, surfaceAt: (w: Vec2) => string | null): Odds {
  const counts = new Map<Outcome, number>();
  for (const [z1, z2] of SAMPLES) {
    const o = outcomeOf(surfaceAt(samplePoint(s, z1, z2)));
    counts.set(o, (counts.get(o) ?? 0) + 1);
  }
  return [...counts]
    .map(([outcome, n]) => ({ outcome, share: n / SAMPLES.length }))
    .sort((a, b) => b.share - a.share);
}

/** Share of shots that finish somewhere bad (sand, water, trees, fescue, off course). */
export const troubleShare = (odds: Odds): number => odds.reduce((t, o) => t + (OUTCOMES[o.outcome].bad ? o.share : 0), 0);

/** Validate player profiles from a file; falls back to the defaults. */
export function parsePlayers(v: unknown): PlayerProfile[] | undefined {
  if (!Array.isArray(v) || !v.length) return undefined;
  const out: PlayerProfile[] = [];
  for (const p of v as Record<string, unknown>[]) {
    const def = DEFAULT_PLAYERS.find((d) => d.id === p?.id) ?? DEFAULT_PLAYERS[1];
    const num = (x: unknown, lo: number, hi: number, d: number) => (x !== null && x !== '' && Number.isFinite(+(x as number)) ? Math.max(lo, Math.min(hi, +(x as number))) : d);
    out.push({
      id: String(p?.id ?? def.id),
      name: String(p?.name ?? def.name).slice(0, 40),
      maxYards: num(p?.maxYards, 50, 400, def.maxYards),
      driverWidth: num(p?.driverWidth, 4, 300, def.driverWidth),
      approachWidth: num(p?.approachWidth, 2, 200, def.approachWidth),
      depthRatio: num(p?.depthRatio, 0.1, 3, def.depthRatio),
      tilt: num(p?.tilt, -45, 45, def.tilt),
      lefty: p?.lefty === true,
      color: typeof p?.color === 'string' && /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : def.color,
    });
  }
  return out;
}

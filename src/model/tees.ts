/**
 * Tee sets (Back / Middle / Forward …).
 *
 * A course has a list of tee sets, longest first. The first set always tees off from
 * the start of each hole's line of play (`hole.points[0]`). Every other set stores
 * just its own tee position per hole (`hole.tees[setId]`) and then follows the same
 * line of play from the first aim point (or the green) on. A set with no tee placed
 * on a hole plays from the first set's tee.
 */
import { pathLength } from '../geom/geom';
import type { CourseDoc, Hole, TeeSet, Vec2 } from './types';

/** The set used when a course hasn't defined any. */
export const DEFAULT_TEE_SET: TeeSet = { id: 'default', name: 'Tees', color: '#000000' };

/** Suggestions for new sets, in the order they are usually added. */
export const TEE_PRESETS: { name: string; color: string }[] = [
  { name: 'Back', color: '#111111' },
  { name: 'Middle', color: '#1565c0' },
  { name: 'Forward', color: '#c62828' },
  { name: 'Senior', color: '#f9a825' },
  { name: 'Junior', color: '#2e7d32' },
];

export const MAX_TEE_SETS = 6;

export function teeSets(doc: Pick<CourseDoc, 'teeSets'>): TeeSet[] {
  return doc.teeSets?.length ? doc.teeSets : [DEFAULT_TEE_SET];
}

/** Does this set tee off from the start of the line of play? */
const isFirst = (sets: TeeSet[], setId: string | null | undefined) => !setId || sets[0]?.id === setId || !sets.some((s) => s.id === setId);

/** Where a set tees off on a hole. */
export function teeOf(hole: Hole, setId: string | null | undefined, sets: TeeSet[]): Vec2 {
  if (isFirst(sets, setId)) return hole.points[0];
  return hole.tees?.[setId!] ?? hole.points[0];
}

/** Has this set been given its own tee on the hole? */
export function hasOwnTee(hole: Hole, setId: string, sets: TeeSet[]): boolean {
  return !isFirst(sets, setId) && !!hole.tees?.[setId];
}

/** The line of play for a set: its tee, then the shared aim points and green. */
export function linePoints(hole: Hole, setId: string | null | undefined, sets: TeeSet[]): Vec2[] {
  return [teeOf(hole, setId, sets), ...hole.points.slice(1)];
}

export function yardsFor(hole: Hole, setId: string | null | undefined, sets: TeeSet[]): number {
  return Math.round(pathLength(linePoints(hole, setId, sets)));
}

export interface SetTotals {
  set: TeeSet;
  /** Holes 1–9, holes 10+, and everything. */
  out: number;
  in: number;
  total: number;
}

/** Scorecard totals for every tee set. */
export function teeTotals(holes: Hole[], sets: TeeSet[]): SetTotals[] {
  return sets.map((set) => {
    let out = 0;
    let inn = 0;
    for (const h of holes) {
      const y = yardsFor(h, set.id, sets);
      if (h.number <= 9) out += y;
      else inn += y;
    }
    return { set, out, in: inn, total: out + inn };
  });
}

/** A hole with one set's tee moved (or cleared with null). Returns the same hole if nothing changes. */
export function withTee(hole: Hole, setId: string, sets: TeeSet[], at: Vec2 | null): Hole {
  if (isFirst(sets, setId)) return at ? { ...hole, points: [at, ...hole.points.slice(1)] } : hole;
  const tees = { ...(hole.tees ?? {}) };
  if (at) tees[setId] = at;
  else if (setId in tees) delete tees[setId];
  else return hole;
  return Object.keys(tees).length ? { ...hole, tees } : withoutTees(hole);
}

function withoutTees(hole: Hole): Hole {
  const { tees: _drop, ...rest } = hole;
  void _drop;
  return rest;
}

/**
 * Replace the course's tee sets, keeping every hole consistent:
 * - tees of sets that no longer exist are dropped;
 * - if a different set is now first, its placed tees become the start of each line of
 *   play, and the old first set (if it still exists) keeps its tees as its own.
 * Pass an empty list to go back to a single unnamed set.
 */
export function applyTeeSets(doc: Pick<CourseDoc, 'teeSets' | 'holes'>, next: TeeSet[]): { teeSets: TeeSet[] | undefined; holes: Hole[] } {
  const before = teeSets(doc);
  const after = next.slice(0, MAX_TEE_SETS);
  const oldFirst = before[0].id;
  const newFirst = after[0]?.id ?? oldFirst;
  const alive = new Set(after.map((s) => s.id));
  const holes = doc.holes.map((h) => {
    let points = h.points;
    const tees: Record<string, Vec2> = {};
    for (const [id, p] of Object.entries(h.tees ?? {})) if (alive.has(id)) tees[id] = p;
    if (newFirst !== oldFirst) {
      const promoted = tees[newFirst];
      if (promoted) {
        // The old first set keeps playing from where it was.
        if (alive.has(oldFirst)) tees[oldFirst] = h.points[0];
        points = [promoted, ...h.points.slice(1)];
      }
      delete tees[newFirst];
    }
    const changed = points !== h.points || JSON.stringify(tees) !== JSON.stringify(h.tees ?? {});
    if (!changed) return h;
    const base = withoutTees({ ...h, points });
    return Object.keys(tees).length ? { ...base, tees } : base;
  });
  return { teeSets: after.length ? after : undefined, holes };
}

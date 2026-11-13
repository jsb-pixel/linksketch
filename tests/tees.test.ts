import { describe, expect, it } from 'vitest';
import { createDoc } from '../src/model/doc';
import { History } from '../src/model/history';
import { deserialize, serialize } from '../src/model/io';
import { resizeDoc } from '../src/model/resize';
import { applyTeeSets, hasOwnTee, linePoints, teeOf, teeSets, teeTotals, withTee, yardsFor, DEFAULT_TEE_SET } from '../src/model/tees';
import type { Hole, TeeSet } from '../src/model/types';
import { DEFAULT_PLAYERS, planShots } from '../src/strategy/strategy';

const back: TeeSet = { id: 'b', name: 'Back', color: '#111111' };
const mid: TeeSet = { id: 'm', name: 'Middle', color: '#1565c0' };
const fwd: TeeSet = { id: 'f', name: 'Forward', color: '#c62828' };
const sets = [back, mid, fwd];
// 400 yd from the back tee: tee (100,500) → aim (100,250) → green (100,100).
const hole: Hole = { id: 'h1', number: 1, par: 4, points: [{ x: 100, y: 500 }, { x: 100, y: 250 }, { x: 100, y: 100 }], tees: { m: { x: 100, y: 460 } } };

describe('tee sets', () => {
  it('a course without tee sets has one unnamed set that plays the line as drawn', () => {
    const doc = createDoc();
    expect(teeSets(doc)).toEqual([DEFAULT_TEE_SET]);
    expect(yardsFor(hole, 'default', teeSets(doc))).toBe(400);
    expect(yardsFor(hole, null, teeSets(doc))).toBe(400);
  });

  it('the first set tees off from the start of the line; others from their own tee', () => {
    expect(teeOf(hole, 'b', sets)).toEqual({ x: 100, y: 500 });
    expect(teeOf(hole, 'm', sets)).toEqual({ x: 100, y: 460 });
    expect(linePoints(hole, 'm', sets)).toEqual([{ x: 100, y: 460 }, { x: 100, y: 250 }, { x: 100, y: 100 }]);
    expect(yardsFor(hole, 'b', sets)).toBe(400);
    expect(yardsFor(hole, 'm', sets)).toBe(360);
  });

  it('a set with no tee placed on a hole plays from the first set’s tee', () => {
    expect(hasOwnTee(hole, 'f', sets)).toBe(false);
    expect(hasOwnTee(hole, 'm', sets)).toBe(true);
    expect(hasOwnTee(hole, 'b', sets)).toBe(false);
    expect(yardsFor(hole, 'f', sets)).toBe(400);
    expect(yardsFor(hole, 'gone', sets)).toBe(400);
  });

  it('yardage follows a dog‑leg from the set’s own tee', () => {
    const dog: Hole = { id: 'd', number: 2, par: 4, points: [{ x: 0, y: 300 }, { x: 0, y: 0 }, { x: 400, y: 0 }], tees: { m: { x: 30, y: 40 } } };
    expect(yardsFor(dog, 'b', sets)).toBe(700);
    expect(yardsFor(dog, 'm', sets)).toBe(450); // 50 (3‑4‑5 triangle) + 400
  });

  it('totals split front and back nines per set', () => {
    const h10: Hole = { id: 'h10', number: 10, par: 3, points: [{ x: 0, y: 150 }, { x: 0, y: 0 }], tees: { f: { x: 0, y: 100 } } };
    const t = teeTotals([hole, h10], sets);
    expect(t.map((x) => [x.set.name, x.out, x.in, x.total])).toEqual([
      ['Back', 400, 150, 550],
      ['Middle', 360, 150, 510],
      ['Forward', 400, 100, 500],
    ]);
  });

  it('withTee moves, places and clears tees without touching the original hole', () => {
    const moved = withTee(hole, 'm', sets, { x: 90, y: 450 });
    expect(moved.tees).toEqual({ m: { x: 90, y: 450 } });
    expect(hole.tees).toEqual({ m: { x: 100, y: 460 } });
    expect(withTee(hole, 'f', sets, { x: 100, y: 400 }).tees).toEqual({ m: { x: 100, y: 460 }, f: { x: 100, y: 400 } });
    const cleared = withTee(hole, 'm', sets, null);
    expect('tees' in cleared).toBe(false);
    expect(withTee(hole, 'f', sets, null)).toBe(hole);
    // The first set's tee is the start of the line of play.
    expect(withTee(hole, 'b', sets, { x: 100, y: 520 }).points[0]).toEqual({ x: 100, y: 520 });
  });

  it('removing a set drops its tees; removing the first promotes the next', () => {
    const doc = { teeSets: sets, holes: [hole] };
    const noMid = applyTeeSets(doc, [back, fwd]);
    expect(noMid.teeSets).toEqual([back, fwd]);
    expect('tees' in noMid.holes[0]).toBe(false);
    expect(noMid.holes[0].points).toBe(hole.points);

    const noBack = applyTeeSets(doc, [mid, fwd]);
    expect(noBack.holes[0].points[0]).toEqual({ x: 100, y: 460 });
    expect('tees' in noBack.holes[0]).toBe(false);
    expect(yardsFor(noBack.holes[0], 'm', noBack.teeSets!)).toBe(360);
  });

  it('reordering keeps every set’s yardage', () => {
    const doc = { teeSets: sets, holes: [hole] };
    const swapped = applyTeeSets(doc, [mid, back, fwd]);
    const s = swapped.teeSets!;
    expect(yardsFor(swapped.holes[0], 'm', s)).toBe(360);
    expect(yardsFor(swapped.holes[0], 'b', s)).toBe(400);
    expect(swapped.holes[0].tees).toEqual({ b: { x: 100, y: 500 } });
  });

  it('adding the first named set changes nothing on the ground', () => {
    const plain: Hole = { ...hole };
    delete plain.tees;
    const r = applyTeeSets({ teeSets: undefined, holes: [plain] }, [back]);
    expect(r.teeSets).toEqual([back]);
    expect(r.holes[0]).toBe(plain);
    expect(applyTeeSets({ teeSets: [back], holes: [plain] }, []).teeSets).toBeUndefined();
  });

  it('strategy plays the first shot from the chosen tee', () => {
    const p = DEFAULT_PLAYERS[0];
    const fromBack = planShots(hole, p);
    const fromMid = planShots(hole, p, teeOf(hole, 'm', sets));
    expect(fromBack[0].from).toEqual({ x: 100, y: 500 });
    expect(fromMid[0].from).toEqual({ x: 100, y: 460 });
    expect(fromMid[0].yards).toBe(210);
  });
});

describe('tee sets in files, undo and resize', () => {
  const make = () => {
    const doc = createDoc({ widthYards: 300, heightYards: 600 });
    doc.teeSets = sets.map((s) => ({ ...s }));
    doc.holes = [hole];
    return doc;
  };

  it('round‑trips through the file format', () => {
    const back2 = deserialize(serialize(make()));
    expect(back2.teeSets).toEqual(sets);
    expect(back2.holes[0].tees).toEqual({ m: { x: 100, y: 460 } });
  });

  it('files without tee sets still open, with none', () => {
    const doc = createDoc();
    doc.holes = [{ id: 'h', number: 1, par: 3, points: [{ x: 1, y: 1 }, { x: 1, y: 150 }] }];
    const j = JSON.parse(serialize(doc));
    expect('teeSets' in j).toBe(false);
    const again = deserialize(JSON.stringify(j));
    expect(again.teeSets).toBeUndefined();
    expect(again.holes[0].tees).toBeUndefined();
  });

  it('ignores broken tee data in a file', () => {
    const j = JSON.parse(serialize(make()));
    j.teeSets = [{ id: 'b', name: 'Back', color: 'red' }, { id: 'b', name: 'Dup', color: '#000000' }, { name: 'No id' }];
    j.holes[0].tees = { m: ['x', 3], f: [100, 400] };
    const d = deserialize(JSON.stringify(j));
    expect(d.teeSets).toEqual([{ id: 'b', name: 'Back', color: '#1565c0' }]);
    expect(d.holes[0].tees).toEqual({ f: { x: 100, y: 400 } });
  });

  it('moving a tee and editing the sets are undo steps', () => {
    const doc = make();
    const hist = new History(doc);
    hist.begin('Move tee');
    hist.snapshotHoles();
    doc.holes = doc.holes.map((h) => withTee(h, 'm', sets, { x: 80, y: 470 }));
    expect(hist.commit()).toBe(true);
    hist.begin('Tee sets');
    hist.snapshotTeeSets();
    hist.snapshotHoles();
    const r = applyTeeSets(doc, [back]);
    doc.teeSets = r.teeSets;
    doc.holes = r.holes;
    expect(hist.commit()).toBe(true);
    expect(doc.holes[0].tees).toBeUndefined();
    hist.undo();
    expect(doc.teeSets).toEqual(sets);
    expect(doc.holes[0].tees).toEqual({ m: { x: 80, y: 470 } });
    hist.undo();
    expect(doc.holes[0].tees).toEqual({ m: { x: 100, y: 460 } });
  });

  it('resizing the course moves tees with their holes', () => {
    const doc = make();
    resizeDoc(doc, { x: -10, y: -20, w: 320, h: 640 }, 1e7);
    expect(doc.holes[0].tees).toEqual({ m: { x: 110, y: 480 } });
    expect(yardsFor(doc.holes[0], 'm', sets)).toBe(360);
  });
});

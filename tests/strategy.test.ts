import { describe, expect, it } from 'vitest';
import { DEFAULT_PLAYERS, landingOdds, outcomeOf, parsePlayers, patternWidth, planShots, samplePoint, troubleShare } from '../src/strategy/strategy';
import { createDoc } from '../src/model/doc';
import { History } from '../src/model/history';
import { deserialize, serialize } from '../src/model/io';
import { setDetail } from '../src/model/detail';
import { surfaceCode } from '../src/model/surfaces';
import type { Hole } from '../src/model/types';

const [scratch, mid, high] = DEFAULT_PLAYERS;
const par4: Hole = { id: 'h', number: 1, par: 4, points: [{ x: 100, y: 500 }, { x: 100, y: 250 }, { x: 100, y: 100 }] };

describe('strategy shots', () => {
  it('plans one shot per leg, finishing short when out of range', () => {
    const s = planShots(par4, high);
    expect(s).toHaveLength(2);
    expect(s[0].yards).toBe(205);
    expect(s[0].short).toBe(45);
    expect(s[0].center).toEqual({ x: 100, y: 295 });
    expect(s[1].toGreen).toBe(true);
    expect(planShots(par4, scratch)[0].short).toBe(0);
    // The approach is played from where the drive finished, not the aim point.
    expect(s[1].from).toEqual({ x: 100, y: 295 });
    expect(s[1].yards).toBe(195);
  });

  it('a shot can be aimed away from the line of play (e.g. middle of the green)', () => {
    const hole: Hole = { ...par4, targets: [null, { x: 110, y: 110 }] };
    const s = planShots(hole, scratch);
    expect(s[0].custom).toBe(false);
    expect(s[1].custom).toBe(true);
    expect(s[1].center.x).toBeCloseTo(110, 5);
    expect(s[1].center.y).toBeCloseTo(110, 5);
    expect(s[1].target).toEqual({ x: 110, y: 110 });
    // Saved with the course; unset targets stay unset.
    const doc = createDoc({ widthYards: 300, heightYards: 600 });
    doc.holes = [hole, { ...par4, id: 'h2', number: 2 }];
    const back = deserialize(serialize(doc));
    expect(back.holes[0].targets).toEqual([null, { x: 110, y: 110 }]);
    expect(back.holes[1].targets).toBeUndefined();
  });

  it('adds shots when the green is out of reach', () => {
    const par5: Hole = { id: 'p5', number: 2, par: 5, points: [{ x: 0, y: 600 }, { x: 0, y: 0 }] };
    const s = planShots(par5, high);
    expect(s.map((x) => x.extra)).toEqual([false, true, true]);
    expect(s.map((x) => Math.round(x.yards))).toEqual([205, 205, 190]);
    expect(s[2].short).toBe(0);
  });

  it('pattern widths are in yards: driver and 150‑yd approach, blended between', () => {
    expect(patternWidth(scratch, scratch.maxYards)).toBe(60);
    expect(patternWidth(scratch, 150)).toBe(24);
    expect(patternWidth(scratch, 75)).toBe(12);
    expect(patternWidth(scratch, 207.5)).toBeCloseTo(42, 5);
    const drive = planShots(par4, scratch)[0]; // 250 of 265
    expect(drive.sigmaSide * 4).toBeCloseTo(patternWidth(scratch, 250), 5);
    expect(planShots(par4, high)[0].sigmaSide).toBeGreaterThan(planShots(par4, scratch)[0].sigmaSide);
  });

  it('right‑hander patterns run short‑right to long‑left; lefties mirror', () => {
    const s = planShots(par4, mid)[0]; // playing north (‑y): right = +x, long = ‑y
    const right = samplePoint(s, 0, 1);
    expect(right.x).toBeGreaterThan(s.center.x);
    expect(right.y).toBeGreaterThan(s.center.y); // short
    const left = samplePoint(s, 0, -1);
    expect(left.y).toBeLessThan(s.center.y); // long
    const l = planShots(par4, { ...mid, lefty: true })[0];
    expect(samplePoint(l, 0, 1).y).toBeLessThan(l.center.y); // right miss runs long
    expect(Math.hypot(right.x - s.center.x, right.y - s.center.y)).toBeCloseTo(s.sigmaSide, 5);
  });

  it('odds reflect what is under the pattern', () => {
    const s = planShots(par4, mid)[0];
    // Fairway 30 yd wide down the middle, water to the left, rough to the right.
    const odds = landingOdds(s, (w) => (Math.abs(w.x - 100) <= 15 ? 'fairway' : w.x < 100 ? 'water' : 'rough'));
    const share = (o: string) => odds.find((x) => x.outcome === o)?.share ?? 0;
    expect(share('fairway')).toBeGreaterThan(0.5);
    expect(share('water')).toBeGreaterThan(0.1);
    expect(Math.abs(share('water') - share('rough'))).toBeLessThan(0.05); // symmetric
    expect(troubleShare(odds)).toBeCloseTo(share('water'), 5);
    expect(odds.reduce((t, o) => t + o.share, 0)).toBeCloseTo(1, 5);
  });

  it('classifies surfaces', () => {
    expect(outcomeOf('bunker')).toBe('sand');
    expect(outcomeOf('tee')).toBe('fairway');
    expect(outcomeOf('white')).toBe('rough');
    expect(outcomeOf(null)).toBe('out');
  });

  it('player edits are saved and undoable', () => {
    const doc = createDoc({ widthYards: 50, heightYards: 50 });
    const hist = new History(doc);
    hist.begin('players');
    hist.snapshotPlayers();
    doc.players = DEFAULT_PLAYERS.map((p) => ({ ...p, maxYards: p.maxYards + 10 }));
    expect(hist.commit()).toBe(true);
    const back = deserialize(serialize(doc));
    expect(back.players?.[0].maxYards).toBe(275);
    hist.undo();
    expect(doc.players).toBeUndefined();
    expect(parsePlayers([{ id: 'x', maxYards: 99999, driverWidth: 'junk' }])?.[0]).toMatchObject({ maxYards: 400, driverWidth: 75, lefty: false });
  });
});

describe('detail level', () => {
  it('splits pixels going finer and keeps the drawing in place', () => {
    const doc = createDoc({ widthYards: 10, heightYards: 6 });
    const base = doc.layers.find((l) => l.kind === 'raster')!;
    if (base.kind !== 'raster') throw 0;
    base.pixels[2 * 10 + 3] = surfaceCode('bunker'); // yard (3,2)
    setDetail(doc, 0.5, 1e6);
    expect([doc.width, doc.height, doc.yardsPerPixel]).toEqual([20, 12, 0.5]);
    const at = (x: number, y: number) => (base.kind === 'raster' ? base.pixels[y * 20 + x] : -1);
    expect([at(6, 4), at(7, 4), at(6, 5), at(7, 5)]).toEqual(Array(4).fill(surfaceCode('bunker')));
    expect(at(8, 4)).toBe(0);
    setDetail(doc, 1, 1e6);
    expect(base.pixels[2 * 10 + 3]).toBe(surfaceCode('bunker'));
    expect(base.pixels.filter(Boolean)).toHaveLength(1);
  });

  it('is one undo step and refuses sizes that are too big', () => {
    const doc = createDoc({ widthYards: 40, heightYards: 40 });
    const hist = new History(doc);
    hist.begin('detail');
    hist.snapshotDoc();
    setDetail(doc, 0.5, 1e6);
    hist.commit();
    hist.undo();
    expect([doc.width, doc.yardsPerPixel]).toEqual([40, 1]);
    expect(() => setDetail(doc, 0.5, 100)).toThrow(/too large/);
  });
});

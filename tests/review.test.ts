/**
 * Regression tests for the bugs found in the Phase 0 review (docs/REVIEW.md).
 * Each one failed before its fix.
 */
import { describe, expect, it } from 'vitest';
import { createDoc } from '../src/model/doc';
import { History } from '../src/model/history';
import { deserialize, serialize } from '../src/model/io';
import { resizeDoc } from '../src/model/resize';
import type { Hole, RasterLayer } from '../src/model/types';
import { DEFAULT_PLAYERS, planShots, shotKey, targetsAfterPointInserted, targetsAfterPointRemoved } from '../src/strategy/strategy';
import { shotLabel } from '../src/strategy/draw';
import { fitsCanvas, panAfterOriginShift, SAFARI_CANVAS_LIMITS, tileRetryDue, TILE_RETRY_MS } from '../src/editor/viewmath';

const par4: Hole = { id: 'h', number: 1, par: 4, points: [{ x: 100, y: 500 }, { x: 100, y: 250 }, { x: 100, y: 100 }] };

describe('R1 — dragging a shot target is an undo step', () => {
  it('records a change that only touches hole.targets', () => {
    const doc = createDoc({ widthYards: 300, heightYards: 600 });
    doc.holes = [par4];
    const hist = new History(doc);
    hist.begin('Move shot target');
    hist.snapshotHoles();
    doc.holes = doc.holes.map((h) => ({ ...h, targets: [null, { x: 120, y: 110 }] }));
    expect(hist.commit()).toBe(true);
    expect(hist.undoLabel).toBe('Move shot target');
    hist.undo();
    expect(doc.holes[0].targets).toBeUndefined();
    hist.redo();
    expect(doc.holes[0].targets).toEqual([null, { x: 120, y: 110 }]);
  });
});

describe('R2 — resizing the course keeps shot targets on the ground', () => {
  it('shifts targets with the hole when the area grows left/up', () => {
    const doc = createDoc({ widthYards: 300, heightYards: 600 });
    doc.holes = [{ ...par4, targets: [null, { x: 120, y: 110 }] }];
    resizeDoc(doc, { x: -50, y: -20, w: 350, h: 620 }, 1e7);
    expect(doc.holes[0].points[2]).toEqual({ x: 150, y: 120 });
    expect(doc.holes[0].targets).toEqual([null, { x: 170, y: 130 }]);
  });
});

describe('R3 — odds cache key covers the pattern tilt', () => {
  it('a left‑hander and a right‑hander never share cached odds', () => {
    const righty = DEFAULT_PLAYERS[1];
    const lefty = { ...righty, lefty: true };
    const a = planShots(par4, righty)[0];
    const b = planShots(par4, lefty)[0];
    expect(a.center).toEqual(b.center);
    expect(shotKey(a)).not.toBe(shotKey(b));
    expect(shotKey(a)).toBe(shotKey(planShots(par4, { ...righty })[0]));
  });
});

describe('R5 — shot targets follow when aim points are added or removed', () => {
  const t = { x: 1, y: 2 };
  it('removing an aim point drops the shot that was played to it', () => {
    // shots: 0 → point 1, 1 → point 2, 2 → point 3. Remove point 1.
    expect(targetsAfterPointRemoved([null, t, null], 1)).toEqual([t]);
    expect(targetsAfterPointRemoved([t], 1)).toBeUndefined();
    expect(targetsAfterPointRemoved(undefined, 1)).toBeUndefined();
  });
  it('inserting an aim point pushes later shots back by one', () => {
    // A target on shot 1 (to the green); insert a new point at index 1.
    expect(targetsAfterPointInserted([null, t], 1)).toEqual([null, null, t]);
    expect(targetsAfterPointInserted([t], 2)).toEqual([t]);
  });
});

describe('R6 — course name, background and layer switches are undo steps', () => {
  it('undoes a rename and an outline switch', () => {
    const doc = createDoc();
    const hist = new History(doc);
    const paint = doc.layers[0] as RasterLayer;
    hist.begin('Course properties');
    hist.snapshotMeta();
    doc.name = 'Sandy Hollow';
    doc.background = 'grass';
    paint.outline = false;
    expect(hist.commit()).toBe(true);
    hist.undo();
    expect([doc.name, doc.background, paint.outline]).toEqual(['Untitled course', 'white', true]);
    hist.redo();
    expect([doc.name, doc.background, paint.outline]).toEqual(['Sandy Hollow', 'grass', false]);
  });
  it('records nothing when nothing changed', () => {
    const doc = createDoc();
    const hist = new History(doc);
    hist.begin('Course properties');
    hist.snapshotMeta();
    expect(hist.commit()).toBe(false);
  });
});

describe('R7 — undo history has a memory budget', () => {
  it('drops the oldest steps once big fills exceed the budget, keeping the newest', () => {
    const doc = createDoc({ widthYards: 200, heightYards: 100 }); // 20,000 px per layer
    const layer = doc.layers[0] as RasterLayer;
    const hist = new History(doc, 200, 100_000); // room for two whole‑layer steps (2 × 40 KB)
    for (let i = 1; i <= 5; i++) {
      hist.begin(`Fill ${i}`);
      hist.snapshotRaster(layer);
      layer.pixels.fill(i);
      hist.markRaster(layer, { x: 0, y: 0, w: doc.width, h: doc.height });
      hist.commit();
    }
    expect(hist.bytes).toBeLessThanOrEqual(100_000);
    expect(hist.undoLabel).toBe('Fill 5');
    let steps = 0;
    while (hist.undo()) steps++;
    expect(steps).toBe(2);
    expect(layer.pixels[0]).toBe(3);
  });
  it('always keeps the last step even if it alone is over budget', () => {
    const doc = createDoc({ widthYards: 200, heightYards: 100 });
    const layer = doc.layers[0] as RasterLayer;
    const hist = new History(doc, 200, 10);
    hist.begin('Fill');
    hist.snapshotRaster(layer);
    layer.pixels.fill(4);
    hist.markRaster(layer, { x: 0, y: 0, w: doc.width, h: doc.height });
    hist.commit();
    expect(hist.canUndo).toBe(true);
  });
});

describe('R8 — damaged files open safely', () => {
  it('drops points that are not numbers instead of poisoning the drawing', () => {
    const doc = createDoc({ widthYards: 100, heightYards: 100 });
    doc.holes = [{ id: 'h', number: 1, par: 3, points: [{ x: 10, y: 90 }, { x: 10, y: 10 }] }];
    const j = JSON.parse(serialize(doc));
    j.holes[0].points.push(['oops', null]);
    j.holes.push({ id: 'bad', number: 2, par: 4, points: [[1, 2], ['x', 'y']] });
    j.layers[1].features = [
      { id: 'a', surface: 'green', smooth: true, points: [[1, 1], [9, 1], [9, 9], [null, 'q']] },
      { id: 'b', surface: 'green', smooth: true, points: [[1, 1], ['n', 1]] },
    ];
    const back = deserialize(JSON.stringify(j));
    expect(back.holes).toHaveLength(1);
    expect(back.holes[0].points).toEqual([{ x: 10, y: 90 }, { x: 10, y: 10 }]);
    const shapes = back.layers.find((l) => l.kind === 'vector');
    expect(shapes?.kind === 'vector' && shapes.features.map((f) => [f.id, f.points.length])).toEqual([['a', 3]]);
  });
  it('refuses a file whose size would exhaust memory', () => {
    const j = JSON.parse(serialize(createDoc({ widthYards: 100, heightYards: 100 })));
    j.width = 100_000;
    j.height = 100_000;
    expect(() => deserialize(JSON.stringify(j))).toThrow(/too large/);
  });
});

describe('R9 — failed map tiles are retried', () => {
  it('only after the retry delay', () => {
    expect(tileRetryDue(1000, 1000 + TILE_RETRY_MS - 1)).toBe(false);
    expect(tileRetryDue(1000, 1000 + TILE_RETRY_MS)).toBe(true);
  });
});

describe('R15 — export refuses pictures the browser cannot make', () => {
  it('knows the canvas limits', () => {
    expect(fitsCanvas(2000, 1400)).toBe(true);
    expect(fitsCanvas(8000, 5600)).toBe(true);
    expect(fitsCanvas(8000, 5600, SAFARI_CANVAS_LIMITS)).toBe(true);
    expect(fitsCanvas(20000, 100)).toBe(false);
    expect(fitsCanvas(16000, 16000, SAFARI_CANVAS_LIMITS)).toBe(false);
    expect(fitsCanvas(0, 10)).toBe(false);
  });
});

describe('R26 — resizing with a rotated view does not make the course jump', () => {
  it('keeps a ground point at the same screen position', () => {
    const zoom = 2;
    const rot = 90;
    const pan = { x: 300, y: 200 };
    const screenOf = (px: { x: number; y: number }, p: { x: number; y: number }) => {
      const r = (rot * Math.PI) / 180;
      return { x: (px.x * Math.cos(r) - px.y * Math.sin(r)) * zoom + p.x, y: (px.x * Math.sin(r) + px.y * Math.cos(r)) * zoom + p.y };
    };
    // Crop 40 px off the left and 10 off the top: old pixel (100, 50) becomes (60, 40).
    const before = screenOf({ x: 100, y: 50 }, pan);
    const after = screenOf({ x: 60, y: 40 }, panAfterOriginShift(pan, { x: 40, y: 10 }, zoom, rot));
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });
  it('matches the old behaviour when the view is not rotated', () => {
    expect(panAfterOriginShift({ x: 5, y: 7 }, { x: 10, y: -4 }, 3, 0)).toEqual({ x: 35, y: -5 });
  });
});

describe('R18 — "All players" uses short labels', () => {
  it('compact labels carry only distance and trouble share', () => {
    const s = planShots(par4, DEFAULT_PLAYERS[0])[0];
    const odds = [
      { outcome: 'fairway' as const, share: 0.7 },
      { outcome: 'sand' as const, share: 0.2 },
      { outcome: 'water' as const, share: 0.1 },
    ];
    expect(shotLabel(s, odds, true)).toBe('250 · 30%');
    expect(shotLabel(s, odds, false)).toBe('250 yd · 30% trouble — 20% sand · 10% water');
  });
});

describe('R16 — undoing a brush stroke re-renders only what it touched', () => {
  it('reports the stroke rectangle for paint‑only steps and nothing for others', () => {
    const doc = createDoc({ widthYards: 200, heightYards: 100 });
    const layer = doc.layers[0] as RasterLayer;
    const hist = new History(doc);
    hist.begin('Brush');
    hist.snapshotRaster(layer);
    layer.pixels[5 * 200 + 10] = 3;
    hist.markRaster(layer, { x: 10, y: 5, w: 4, h: 3 });
    hist.commit();
    hist.begin('Course properties');
    hist.snapshotMeta();
    doc.name = 'X';
    hist.commit();
    hist.undo();
    expect(hist.lastRect).toBeNull();
    hist.undo();
    expect(hist.lastRect).toEqual({ x: 10, y: 5, w: 4, h: 3 });
    hist.redo();
    expect(hist.lastRect).toEqual({ x: 10, y: 5, w: 4, h: 3 });
  });
});

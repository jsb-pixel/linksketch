import { describe, expect, it } from 'vitest';
import { holeClimb, playsLike } from '../src/editor/holes';
import { createDoc, createTerrainLayer } from '../src/model/doc';
import { History } from '../src/model/history';
import { deserialize, serialize } from '../src/model/io';
import { resizeDoc } from '../src/model/resize';
import {
  contourSegments,
  createTerrain,
  dab,
  decodeTerrain,
  encodeTerrain,
  heightAtPx,
  minMax,
  pickCell,
} from '../src/terrain/terrain';

/** A tilted plane: height = x/10 feet. */
function plane(W = 200, H = 120) {
  const t = createTerrain(W, H, 'usgs');
  for (let j = 0; j < t.h; j++) for (let i = 0; i < t.w; i++) t.heights[j * t.w + i] = (i * t.cell) / 10 + 100;
  return t;
}

describe('terrain grid', () => {
  it('keeps the grid around 200k points', () => {
    expect(pickCell(2000, 1400)).toBe(4);
    expect(pickCell(300, 200)).toBe(2);
  });

  it('bilinear sampling is exact on a plane', () => {
    const t = plane();
    expect(heightAtPx(t, { x: 37.3, y: 50 })).toBeCloseTo(103.73, 4);
  });

  it('file encoding keeps heights within 0.03 ft', () => {
    const t = plane();
    t.heights[5] = 412.37;
    const back = decodeTerrain(encodeTerrain(t));
    for (let i = 0; i < t.heights.length; i++) expect(Math.abs(back.heights[i] - t.heights[i])).toBeLessThan(0.03);
  });

  it('contours of a plane are straight north–south lines at the right x', () => {
    const t = plane();
    const { minor, major } = contourSegments(t, 2, 5);
    expect(minor.length + major.length).toBeGreaterThan(0);
    for (const seg of [minor, major])
      for (let i = 0; i < seg.length; i += 4) {
        expect(seg[i]).toBeCloseTo(seg[i + 2], 5); // vertical
        const h = seg[i] / 10 + 100;
        expect(Math.abs(h / 2 - Math.round(h / 2))).toBeLessThan(1e-4); // on a 2 ft level
      }
  });
});

describe('terrain brush', () => {
  it('raise lifts the centre most and leaves far ground alone', () => {
    const t = createTerrain(200, 200, 'sculpted');
    dab(t, { x: 100, y: 100 }, 20, 'raise', 1);
    expect(heightAtPx(t, { x: 100, y: 100 })).toBeCloseTo(1, 5);
    expect(heightAtPx(t, { x: 112, y: 100 })).toBeGreaterThan(0);
    expect(heightAtPx(t, { x: 112, y: 100 })).toBeLessThan(1);
    expect(heightAtPx(t, { x: 150, y: 150 })).toBe(0);
  });

  it('flatten pulls toward the target, smooth reduces a spike', () => {
    const t = plane();
    for (let k = 0; k < 40; k++) dab(t, { x: 100, y: 60 }, 30, 'flatten', 0.5, 105);
    expect(heightAtPx(t, { x: 100, y: 60 })).toBeCloseTo(105, 1);
    const s = createTerrain(100, 100, 'sculpted');
    s.heights[(25) * s.w + 25] = 10;
    dab(s, { x: 50, y: 50 }, 20, 'smooth', 1);
    expect(minMax(s).max).toBeLessThan(10);
  });

  it('brush strokes are undoable', () => {
    const doc = createDoc({ widthYards: 100, heightYards: 100 });
    doc.terrain = createTerrain(100, 100, 'sculpted');
    const h = new History(doc);
    h.begin('shape');
    h.snapshotTerrain();
    dab(doc.terrain, { x: 50, y: 50 }, 15, 'raise', 3);
    expect(h.commit()).toBe(true);
    h.undo();
    expect(minMax(doc.terrain).max).toBe(0);
    h.redo();
    expect(minMax(doc.terrain).max).toBeCloseTo(3, 5);
  });
});

describe('terrain in courses', () => {
  it('is saved in the file with its layer settings', () => {
    const doc = createDoc({ widthYards: 200, heightYards: 120 });
    doc.terrain = plane();
    const layer = { ...createTerrainLayer(), interval: 5, showShade: false };
    doc.layers = [...doc.layers, layer];
    const back = deserialize(serialize(doc));
    expect(back.terrain!.w).toBe(doc.terrain.w);
    expect(heightAtPx(back.terrain!, { x: 60, y: 30 })).toBeCloseTo(106, 1);
    expect(back.layers.at(-1)).toMatchObject({ kind: 'terrain', interval: 5, showShade: false });
  });

  it('follows the ground when the course area grows left', () => {
    const doc = createDoc({ widthYards: 200, heightYards: 120 });
    doc.terrain = plane();
    resizeDoc(doc, { x: -40, y: 0, w: 240, h: 120 }, 1e7);
    // old x=60 is now x=100
    expect(heightAtPx(doc.terrain!, { x: 100, y: 30 })).toBeCloseTo(106, 1);
  });

  it('hole climb and plays-like yardage', () => {
    const t = plane();
    const hole = { id: 'h', number: 1, par: 4, points: [{ x: 10, y: 50 }, { x: 190, y: 50 }] };
    const climb = holeClimb(hole, (w) => heightAtPx(t, w))!;
    expect(climb).toBeCloseTo(18, 3);
    expect(playsLike(400, 18)).toBe(406);
    expect(playsLike(400, -30)).toBe(390);
  });
});

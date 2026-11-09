import { describe, expect, it } from 'vitest';
import { catmullRomClosed, polygonArea, rdp, simplifyClosed, pointInPolygon } from '../src/geom/geom';
import { createDoc } from '../src/model/doc';
import { History } from '../src/model/history';
import { deserialize, rleDecode, rleEncode, serialize } from '../src/model/io';
import { OUTLINE_PACKED, surfaceCode, surfacePixel } from '../src/model/surfaces';
import { fillPolygon, renderRegion } from '../src/render/raster';
import type { VectorLayer } from '../src/model/types';

const square = (x: number, y: number, s: number) => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
];

describe('geometry', () => {
  it('rdp keeps endpoints and drops collinear points', () => {
    const pts = Array.from({ length: 11 }, (_, i) => ({ x: i, y: 0 }));
    expect(rdp(pts, 0.1)).toEqual([pts[0], pts[10]]);
  });

  it('simplifyClosed reduces a dense circle but keeps its shape', () => {
    const circle = Array.from({ length: 360 }, (_, i) => ({
      x: 50 + 40 * Math.cos((i * Math.PI) / 180),
      y: 50 + 40 * Math.sin((i * Math.PI) / 180),
    }));
    const s = simplifyClosed(circle, 1);
    expect(s.length).toBeLessThan(40);
    expect(s.length).toBeGreaterThan(8);
    expect(polygonArea(s)).toBeGreaterThan(Math.PI * 40 * 40 * 0.95);
  });

  it('closed spline passes through its control points', () => {
    const ctrl = square(0, 0, 10);
    const { poly, span } = catmullRomClosed(ctrl, 1);
    for (const c of ctrl) expect(poly.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < 1e-9)).toBe(true);
    expect(span.length).toBe(poly.length);
  });

  it('area and containment', () => {
    expect(polygonArea(square(0, 0, 10))).toBe(100);
    expect(pointInPolygon({ x: 5, y: 5 }, square(0, 0, 10))).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, square(0, 0, 10))).toBe(false);
  });
});

describe('rasterizer', () => {
  it('fills exactly the pixels whose centers are inside', () => {
    let count = 0;
    fillPolygon(square(2, 2, 4), { x: 0, y: 0, w: 20, h: 20 }, (_y, x0, x1) => (count += x1 - x0 + 1));
    expect(count).toBe(16);
  });

  it('outlines the green where it sits on the fairway, not the fairway under it', () => {
    const doc = createDoc({ widthYards: 40, heightYards: 40 });
    const layer = doc.layers.find((l) => l.kind === 'vector') as VectorLayer;
    layer.features = [
      { id: 'g', surface: 'green', points: square(10, 10, 10), smooth: false },
      { id: 'f', surface: 'fairway', points: square(0, 0, 40), smooth: false },
    ];
    const out = renderRegion(doc, { x: 0, y: 0, w: 40, h: 40 });
    const at = (x: number, y: number) => out[y * 40 + x];
    expect(at(10, 15)).toBe(OUTLINE_PACKED); // green edge
    expect(at(15, 15)).toBe(surfacePixel(surfaceCode('green'), 15, 15)); // green inside
    expect(at(9, 15)).toBe(surfacePixel(surfaceCode('fairway'), 9, 15)); // fairway next to green
    expect(at(5, 5)).toBe(surfacePixel(surfaceCode('fairway'), 5, 5));
  });

  it('partial region renders match the full render', () => {
    const doc = createDoc({ widthYards: 60, heightYards: 60 });
    const layer = doc.layers.find((l) => l.kind === 'vector') as VectorLayer;
    layer.features = [{ id: 'w', surface: 'water', points: square(5, 5, 30), smooth: true }];
    const full = renderRegion(doc, { x: 0, y: 0, w: 60, h: 60 });
    const part = renderRegion(doc, { x: 10, y: 3, w: 25, h: 20 });
    for (let y = 0; y < 20; y++) for (let x = 0; x < 25; x++) expect(part[y * 25 + x]).toBe(full[(y + 3) * 60 + x + 10]);
  });
});

describe('history', () => {
  it('undoes and redoes vector and raster edits', () => {
    const doc = createDoc({ widthYards: 20, heightYards: 20 });
    const h = new History(doc);
    const vec = doc.layers[1] as VectorLayer;
    const ras = doc.layers[0];
    if (ras.kind !== 'raster') throw new Error();

    h.begin('add');
    h.snapshotVector(vec);
    vec.features = [{ id: 'a', surface: 'green', points: square(0, 0, 5), smooth: true }];
    expect(h.commit()).toBe(true);

    h.begin('paint');
    h.snapshotRaster(ras);
    ras.pixels[5 * 20 + 5] = 3;
    h.markRaster(ras, { x: 5, y: 5, w: 1, h: 1 });
    h.commit();

    h.undo();
    expect(ras.pixels[105]).toBe(0);
    h.undo();
    expect(vec.features.length).toBe(0);
    h.redo();
    h.redo();
    expect(vec.features.length).toBe(1);
    expect(ras.pixels[105]).toBe(3);
  });

  it('does not record no-op gestures', () => {
    const doc = createDoc({ widthYards: 20, heightYards: 20 });
    const h = new History(doc);
    h.begin('nothing');
    h.snapshotVector(doc.layers[1] as VectorLayer);
    expect(h.commit()).toBe(false);
    expect(h.canUndo).toBe(false);
  });
});

describe('file format', () => {
  it('RLE round-trips', () => {
    const data = new Uint8Array(1000);
    data.fill(7, 100, 700);
    data[999] = 2;
    expect(rleDecode(rleEncode(data), data.length)).toEqual(data);
  });

  it('serialize → deserialize preserves the course', () => {
    const doc = createDoc({ name: 'Test National', widthYards: 50, heightYards: 30, yardsPerPixel: 0.5 });
    (doc.layers[1] as VectorLayer).features = [{ id: 'a', surface: 'bunker', points: square(1, 2, 3), smooth: true }];
    const ras = doc.layers[0];
    if (ras.kind === 'raster') ras.pixels[42] = surfaceCode('trees');
    const back = deserialize(serialize(doc));
    expect(back.name).toBe('Test National');
    expect(back.width).toBe(100);
    expect(back.yardsPerPixel).toBe(0.5);
    expect((back.layers[1] as VectorLayer).features[0]).toEqual((doc.layers[1] as VectorLayer).features[0]);
    const r = back.layers[0];
    expect(r.kind === 'raster' && r.pixels[42]).toBe(surfaceCode('trees'));
  });

  it('rejects files that are not courses', () => {
    expect(() => deserialize('{"hello":1}')).toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { geoWithPointAt, worldToLatLon } from '../src/geo/geo';
import { createDoc, createImageLayer } from '../src/model/doc';
import { History } from '../src/model/history';
import { resizeDoc } from '../src/model/resize';
import type { RasterLayer, VectorLayer } from '../src/model/types';

function setup() {
  const doc = createDoc({ widthYards: 100, heightYards: 80 });
  const ras = doc.layers[0] as RasterLayer;
  ras.pixels[10 * 100 + 20] = 7; // pixel at (20, 10)
  (doc.layers[1] as VectorLayer).features = [{ id: 'f', surface: 'green', smooth: false, points: [{ x: 30, y: 30 }, { x: 40, y: 30 }, { x: 40, y: 40 }] }];
  doc.holes = [{ id: 'h', number: 1, par: 4, points: [{ x: 50, y: 70 }, { x: 50, y: 10 }] }];
  const img = createImageLayer('u', 'data:,', 10, 10, { x: 5, y: 6 });
  doc.layers = [img, ...doc.layers];
  doc.geo = geoWithPointAt(36.5, -121.9, { x: 50, y: 40 });
  return { doc, img };
}

describe('resizing the course area', () => {
  it('growing left/up shifts everything so it stays put on the ground', () => {
    const { doc, img } = setup();
    const before = worldToLatLon(doc.geo!, { x: 30, y: 30 });
    resizeDoc(doc, { x: -25, y: -15, w: 150, h: 120 }, 1e7);
    expect([doc.width, doc.height]).toEqual([150, 120]);
    const ras = doc.layers[1] as RasterLayer;
    expect(ras.pixels[(10 + 15) * 150 + 20 + 25]).toBe(7);
    const f = (doc.layers[2] as VectorLayer).features[0];
    expect(f.points[0]).toEqual({ x: 55, y: 45 });
    expect(doc.holes[0].points[0]).toEqual({ x: 75, y: 85 });
    expect([img.x, img.y]).toEqual([30, 21]);
    // The same ground point is still under the shape's first point.
    const after = worldToLatLon(doc.geo!, f.points[0]);
    expect(after.lat).toBeCloseTo(before.lat, 7);
    expect(after.lon).toBeCloseTo(before.lon, 7);
  });

  it('cropping drops pixels outside the new area', () => {
    const { doc } = setup();
    resizeDoc(doc, { x: 30, y: 0, w: 50, h: 80 }, 1e7);
    const ras = doc.layers[1] as RasterLayer;
    expect(ras.pixels.every((v) => v === 0)).toBe(true);
  });

  it('refuses areas over the size limit', () => {
    const { doc } = setup();
    expect(() => resizeDoc(doc, { x: 0, y: 0, w: 5000, h: 5000 }, 1e6)).toThrow();
  });

  it('is one undo step that restores everything', () => {
    const { doc, img } = setup();
    const hist = new History(doc);
    const geo0 = { ...doc.geo! };
    hist.begin('resize');
    hist.snapshotDoc();
    resizeDoc(doc, { x: -10, y: -10, w: 200, h: 200 }, 1e7);
    expect(hist.commit()).toBe(true);
    hist.undo();
    expect([doc.width, doc.height]).toEqual([100, 80]);
    expect((doc.layers[1] as RasterLayer).pixels[10 * 100 + 20]).toBe(7);
    expect((doc.layers[2] as VectorLayer).features[0].points[0]).toEqual({ x: 30, y: 30 });
    expect(doc.holes[0].points[0]).toEqual({ x: 50, y: 70 });
    expect([img.x, img.y]).toEqual([5, 6]);
    expect(doc.geo).toEqual(geo0);
    hist.redo();
    expect(doc.width).toBe(200);
  });

  it('older paint undo still works after undoing a resize', () => {
    const doc = createDoc({ widthYards: 50, heightYards: 50 });
    const ras = doc.layers[0] as RasterLayer;
    const hist = new History(doc);
    hist.begin('paint');
    hist.snapshotRaster(ras);
    ras.pixels[5 * 50 + 5] = 3;
    hist.markRaster(ras, { x: 5, y: 5, w: 1, h: 1 });
    hist.commit();
    hist.begin('resize');
    hist.snapshotDoc();
    resizeDoc(doc, { x: -5, y: -5, w: 70, h: 70 }, 1e7);
    hist.commit();
    hist.undo(); // resize
    hist.undo(); // paint
    expect(ras.pixels[5 * 50 + 5]).toBe(0);
    expect(doc.width).toBe(50);
  });
});

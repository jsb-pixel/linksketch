import { describe, expect, it } from 'vitest';
import { polygonArea } from '../src/geom/geom';
import { createDoc } from '../src/model/doc';
import { OUTLINE_PACKED, surfaceCode, surfacePixel } from '../src/model/surfaces';
import type { RasterLayer } from '../src/model/types';
import { renderRegion, visibleCodes } from '../src/render/raster';
import { floodRegion, regionEdges, traceOutline } from '../src/render/regions';

function paintRect(layer: RasterLayer, W: number, x: number, y: number, w: number, h: number, code: number) {
  for (let j = y; j < y + h; j++) layer.pixels.fill(code, j * W + x, j * W + x + w);
}

describe('painted surfaces', () => {
  it('get automatic outlines when the layer has outlines on', () => {
    const doc = createDoc({ widthYards: 30, heightYards: 30 });
    const base = doc.layers[0] as RasterLayer;
    const fw = surfaceCode('fairway');
    paintRect(base, 30, 5, 5, 10, 10, fw);
    let out = renderRegion(doc, { x: 0, y: 0, w: 30, h: 30 });
    expect(out[10 * 30 + 5]).toBe(OUTLINE_PACKED);
    expect(out[10 * 30 + 10]).toBe(surfacePixel(fw, 10, 10));
    base.outline = false;
    out = renderRegion(doc, { x: 0, y: 0, w: 30, h: 30 });
    expect(out[10 * 30 + 5]).toBe(surfacePixel(fw, 5, 10));
  });

  it('a black pencil line does not get outlined, and fairway beside it does not either', () => {
    const doc = createDoc({ widthYards: 30, heightYards: 30 });
    const base = doc.layers[0] as RasterLayer;
    paintRect(base, 30, 0, 0, 30, 30, surfaceCode('fairway'));
    paintRect(base, 30, 10, 0, 1, 30, surfaceCode('black'));
    const out = renderRegion(doc, { x: 0, y: 0, w: 30, h: 30 });
    expect(out[5 * 30 + 9]).toBe(surfacePixel(surfaceCode('fairway'), 9, 5));
  });
});

describe('regions', () => {
  it('flood fill stops at a different surface', () => {
    const W = 20;
    const codes = new Uint8Array(W * W);
    for (let y = 0; y < W; y++) codes[y * W + 10] = 5; // wall
    const r = floodRegion(codes, W, W, 2, 2)!;
    expect(r.count).toBe(10 * 20);
    expect(r.rect).toEqual({ x: 0, y: 0, w: 10, h: 20 });
  });

  it('visibleCodes merges layers and background', () => {
    const doc = createDoc({ widthYards: 10, heightYards: 10 });
    paintRect(doc.layers[0] as RasterLayer, 10, 0, 0, 5, 10, surfaceCode('green'));
    paintRect(doc.layers[2] as RasterLayer, 10, 4, 0, 2, 10, surfaceCode('bunker'));
    const v = visibleCodes(doc);
    expect(v[0]).toBe(surfaceCode('green'));
    expect(v[4]).toBe(surfaceCode('bunker'));
    expect(v[9]).toBe(surfaceCode('white'));
  });

  it('traces a painted blob into a polygon with the same area', () => {
    const W = 40;
    const codes = new Uint8Array(W * W);
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++) if ((x - 20) ** 2 + (y - 20) ** 2 < 15 ** 2) codes[y * W + x] = 1;
    const r = floodRegion(codes, W, W, 20, 20)!;
    const poly = traceOutline(r, 1);
    expect(poly.length).toBeGreaterThan(6);
    expect(Math.abs(polygonArea(poly) - r.count) / r.count).toBeLessThan(0.05);
    expect(regionEdges(r).length).toBeGreaterThan(4);
  });

  it('traces the outer boundary of a ring (ignores the hole)', () => {
    const W = 12;
    const codes = new Uint8Array(W * W);
    for (let y = 1; y < 11; y++) for (let x = 1; x < 11; x++) codes[y * W + x] = 1;
    for (let y = 4; y < 8; y++) for (let x = 4; x < 8; x++) codes[y * W + x] = 0;
    const r = floodRegion(codes, W, W, 1, 1)!;
    expect(polygonArea(traceOutline(r, 0.1))).toBe(100);
  });
});

import { describe, expect, it } from 'vitest';
import { createDoc } from '../src/model/doc';
import { countRegions, courseStats, statsCsv, SQ_YD_PER_ACRE } from '../src/model/stats';
import { surfaceCode } from '../src/model/surfaces';
import type { RasterLayer, VectorLayer } from '../src/model/types';

function paintRect(l: RasterLayer, W: number, x0: number, y0: number, w: number, h: number, id: string) {
  const c = surfaceCode(id);
  for (let y = y0; y < y0 + h; y++) l.pixels.fill(c, y * W + x0, y * W + x0 + w);
}

describe('course stats', () => {
  it('counts separate patches and ignores specks', () => {
    const W = 10;
    const H = 6;
    const codes = new Uint8Array(W * H);
    const put = (x: number, y: number, v = 5) => (codes[y * W + x] = v);
    // An L‑shaped patch (4 px), a far patch (3 px in a row), a diagonal neighbour (1 px speck).
    put(0, 0), put(1, 0), put(1, 1), put(1, 2);
    put(6, 4), put(7, 4), put(8, 4);
    put(3, 3);
    expect(countRegions(codes, W, H, 5)).toBe(2);
    expect(countRegions(codes, W, H, 5, 1)).toBe(3);
    expect(countRegions(codes, W, H, 9)).toBe(0);
    expect(countRegions(codes, W, H, 0)).toBe(0);
  });

  it('measures surfaces in acres, greens in square feet, and counts bunkers', () => {
    const doc = createDoc({ widthYards: 440, heightYards: 220 }); // 96,800 sq yd = 20 acres
    const W = doc.width;
    const base = doc.layers[0] as RasterLayer;
    paintRect(base, W, 0, 0, 220, 110, 'fairway'); // 24,200 sq yd = 5 acres
    paintRect(base, W, 300, 10, 30, 20, 'green'); // 600 sq yd = 5,400 sq ft
    paintRect(base, W, 300, 100, 20, 30, 'green'); // 600 sq yd
    paintRect(base, W, 10, 10, 10, 10, 'bunker'); // on top of fairway: replaces 100 sq yd
    paintRect(base, W, 250, 150, 10, 5, 'bunker');
    paintRect(base, W, 400, 200, 8, 4, 'bunker');
    const s = courseStats(doc);
    expect(s.propertyAcres).toBeCloseTo(20, 6);
    const fairway = s.surfaces.find((x) => x.id === 'fairway')!;
    expect(fairway.sqYd).toBe(24200 - 100);
    expect(fairway.acres).toBeCloseTo((24200 - 100) / SQ_YD_PER_ACRE, 6);
    expect(s.surfaces[0].id).toBe('fairway'); // largest first
    expect(s.surfaces.some((x) => x.id === 'white')).toBe(false); // empty paper isn't a surface
    expect(s.greenCount).toBe(2);
    expect(s.greensSqFt).toBe(1200 * 9);
    expect(s.avgGreenSqFt).toBe(5400);
    expect(s.bunkerCount).toBe(3);
    expect(s.bunkerSqFt).toBe((100 + 50 + 32) * 9);
    expect(s.paintedAcres).toBeCloseTo((24200 + 1200 + 50 + 32) / SQ_YD_PER_ACRE, 6);
  });

  it('respects the pixel size and includes shapes and layer visibility', () => {
    const doc = createDoc({ widthYards: 200, heightYards: 100, yardsPerPixel: 2 });
    (doc.layers[1] as VectorLayer).features = [
      { id: 'g', surface: 'green', smooth: false, points: [{ x: 20, y: 20 }, { x: 60, y: 20 }, { x: 60, y: 60 }, { x: 20, y: 60 }] },
    ];
    expect(courseStats(doc).greensSqFt).toBe(40 * 40 * 9);
    doc.layers[1].visible = false;
    expect(courseStats(doc).greenCount).toBe(0);
  });

  it('totals yardage and par per tee set', () => {
    const doc = createDoc();
    doc.teeSets = [
      { id: 'b', name: 'Back', color: '#111111' },
      { id: 'f', name: 'Forward', color: '#c62828' },
    ];
    doc.holes = [
      { id: '1', number: 1, par: 4, points: [{ x: 0, y: 400 }, { x: 0, y: 0 }], tees: { f: { x: 0, y: 320 } } },
      { id: '2', number: 2, par: 3, points: [{ x: 50, y: 150 }, { x: 50, y: 0 }] },
    ];
    const s = courseStats(doc);
    expect([s.holes, s.par]).toEqual([2, 7]);
    expect(s.yardage.map((y) => [y.name, y.yards])).toEqual([
      ['Back', 550],
      ['Forward', 470],
    ]);
  });

  it('an empty course has empty stats', () => {
    const s = courseStats(createDoc({ widthYards: 100, heightYards: 100 }));
    expect(s.surfaces).toEqual([]);
    expect([s.paintedAcres, s.greensSqFt, s.avgGreenSqFt, s.bunkerCount, s.holes, s.par]).toEqual([0, 0, 0, 0, 0, 0]);
    expect(s.yardage).toEqual([{ id: 'default', name: 'Tees', color: '#000000', yards: 0 }]);
  });

  it('exports CSV with quoting', () => {
    const doc = createDoc({ widthYards: 100, heightYards: 100, name: 'Pine "Top", NC' });
    paintRect(doc.layers[0] as RasterLayer, doc.width, 0, 0, 10, 10, 'water');
    const csv = statsCsv(doc.name, courseStats(doc));
    expect(csv.split('\n')[0]).toBe('Course,"Pine ""Top"", NC"');
    expect(csv).toContain('Surface,Acres,Square yards\nWater,0.021,100\n');
    expect(csv).toContain('Yardage (Tees),0');
  });
});

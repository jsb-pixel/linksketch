import { describe, expect, it } from 'vitest';
import { pickZoom } from '../src/editor/maptiles';
import {
  geoWithPointAt,
  groundYards,
  mercToWorld,
  parseCoords,
  worldToLatLon,
  worldToMerc,
} from '../src/geo/geo';
import { createDoc, createMapLayer } from '../src/model/doc';
import { History } from '../src/model/history';
import { deserialize, serialize } from '../src/model/io';

describe('geo placement', () => {
  const g = geoWithPointAt(33.503, -82.0222, { x: 1000, y: 700 });

  it('puts the chosen point at the course center', () => {
    const c = worldToLatLon(g, { x: 1000, y: 700 });
    expect(c.lat).toBeCloseTo(33.503, 7);
    expect(c.lon).toBeCloseTo(-82.0222, 7);
  });

  it('course yards match real ground distance (within 0.2%)', () => {
    for (const [a, b] of [
      [{ x: 0, y: 0 }, { x: 2000, y: 0 }],
      [{ x: 0, y: 0 }, { x: 0, y: 1400 }],
      [{ x: 300, y: 200 }, { x: 1700, y: 1300 }],
    ]) {
      const yd = Math.hypot(b.x - a.x, b.y - a.y);
      const real = groundYards(worldToLatLon(g, a), worldToLatLon(g, b));
      expect(Math.abs(real - yd) / yd).toBeLessThan(0.002);
    }
  });

  it('world ↔ mercator round-trips', () => {
    const w = { x: 123.4, y: 567.8 };
    const back = mercToWorld(g, worldToMerc(g, w));
    expect(back.x).toBeCloseTo(w.x, 6);
    expect(back.y).toBeCloseTo(w.y, 6);
  });

  it('picks sharper tiles when zoomed in, capped at the source max', () => {
    const near = pickZoom({ geo: g, unitsPerYard: 4, dpr: 2 }, 16);
    const far = pickZoom({ geo: g, unitsPerYard: 0.02, dpr: 2 }, 16);
    expect(near).toBe(16);
    expect(far).toBeLessThan(near);
  });
});

describe('parseCoords', () => {
  it.each([
    ['33.503, -82.0222', 33.503, -82.0222],
    ['33.503 -82.0222', 33.503, -82.0222],
    ['https://www.google.com/maps/@36.5681,-121.9503,16z', 36.5681, -121.9503],
    ['https://www.google.com/maps/place/X/@36.5,-121.9,17z/data=!3m1!4b1!4m6!3m5!1s0x0!8m2!3d36.5681!4d-121.9503', 36.5681, -121.9503],
    ['https://maps.google.com/?q=40.1,-75.2', 40.1, -75.2],
  ])('%s', (text, lat, lon) => {
    expect(parseCoords(text)).toEqual({ lat, lon });
  });
  it('rejects plain words', () => expect(parseCoords('Pebble Beach')).toBeNull());
});

describe('geo in documents', () => {
  it('placement and map layer are saved and undoable', () => {
    const doc = createDoc({ widthYards: 100, heightYards: 100 });
    const h = new History(doc);
    h.begin('place');
    h.snapshotGeo();
    h.snapshotLayers();
    doc.geo = { lat: 40, lon: -75 };
    doc.layers = [createMapLayer('esri'), ...doc.layers];
    expect(h.commit()).toBe(true);
    const back = deserialize(serialize(doc));
    expect(back.geo).toEqual({ lat: 40, lon: -75 });
    expect(back.layers[0]).toMatchObject({ kind: 'map', source: 'esri', opacity: 1 });
    h.undo();
    expect(doc.geo).toBeUndefined();
    expect(doc.layers.some((l) => l.kind === 'map')).toBe(false);
  });
});

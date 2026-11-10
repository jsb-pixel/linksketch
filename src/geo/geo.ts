/**
 * Placing a course on the Earth.
 *
 * The course keeps its own yard coordinates (origin top‑left, +y down, north up).
 * `GeoRef` pins that origin to a latitude/longitude. Map tiles are Web Mercator, so we
 * map yards ↔ mercator meters with the mercator scale factor at the course's latitude
 * (1 / cos φ). Across a golf property (a few km) the error is far below a yard.
 */
import type { Vec2 } from '../model/types';

export interface GeoRef {
  /** Latitude/longitude of the course's top‑left corner (yard 0,0). */
  lat: number;
  lon: number;
}

export const R = 6378137; // WGS84 / Web Mercator radius, meters
export const YARD_M = 0.9144;
const D2R = Math.PI / 180;

export const mercX = (lon: number) => R * lon * D2R;
export const mercY = (lat: number) => R * Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2));
export const lonOf = (mx: number) => mx / R / D2R;
export const latOf = (my: number) => (2 * Math.atan(Math.exp(my / R)) - Math.PI / 2) / D2R;

/** Mercator meters per yard at the course. */
export const mercPerYard = (g: GeoRef) => YARD_M / Math.cos(g.lat * D2R);

export function worldToMerc(g: GeoRef, w: Vec2): Vec2 {
  const k = mercPerYard(g);
  return { x: mercX(g.lon) + w.x * k, y: mercY(g.lat) - w.y * k };
}

export function mercToWorld(g: GeoRef, m: Vec2): Vec2 {
  const k = mercPerYard(g);
  return { x: (m.x - mercX(g.lon)) / k, y: (mercY(g.lat) - m.y) / k };
}

export function worldToLatLon(g: GeoRef, w: Vec2): { lat: number; lon: number } {
  const m = worldToMerc(g, w);
  return { lat: latOf(m.y), lon: lonOf(m.x) };
}

/** GeoRef that puts (lat, lon) at world point `at` (e.g. the course center). */
export function geoWithPointAt(lat: number, lon: number, at: Vec2): GeoRef {
  // mercator scale uses the origin latitude; iterate once so the two agree.
  let g: GeoRef = { lat, lon };
  for (let i = 0; i < 3; i++) {
    const k = mercPerYard(g);
    g = { lat: latOf(mercY(lat) + at.y * k), lon: lonOf(mercX(lon) - at.x * k) };
  }
  return g;
}

/** Ground distance in yards between two lat/lons (haversine) — used to sanity‑check. */
export function groundYards(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = (b.lat - a.lat) * D2R;
  const dLon = (b.lon - a.lon) * D2R;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * D2R) * Math.cos(b.lat * D2R) * Math.sin(dLon / 2) ** 2;
  return (2 * 6371008.8 * Math.asin(Math.sqrt(h))) / YARD_M;
}

/**
 * Read coordinates from what someone pastes: "33.503, -82.022", a Google Maps link
 * (…/@33.503,-82.022,17z or …!3d33.503!4d-82.022), or a geo: URI.
 */
export function parseCoords(text: string): { lat: number; lon: number } | null {
  const t = text.trim();
  const num = '(-?\\d{1,3}(?:\\.\\d+)?)';
  const patterns = [
    new RegExp(`!3d${num}!4d${num}`),
    new RegExp(`@${num},${num}`),
    new RegExp(`[?&](?:q|query|ll|center)=${num},\\s*${num}`),
    new RegExp(`^geo:${num},${num}`),
    new RegExp(`^${num}\\s*[,\\s]\\s*${num}$`),
  ];
  for (const re of patterns) {
    const m = t.match(re);
    if (m) {
      const lat = +m[1];
      const lon = +m[2];
      if (Math.abs(lat) <= 85 && Math.abs(lon) <= 180) return { lat, lon };
    }
  }
  return null;
}

export function formatLatLon(p: { lat: number; lon: number }): string {
  return `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`;
}

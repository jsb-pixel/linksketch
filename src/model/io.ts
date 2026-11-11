import { parsePlayers } from '../strategy/strategy';
/**
 * File format (.fairway): JSON. Raster layers are run‑length encoded + base64.
 * The file carries its own surface table so palette reordering never corrupts files.
 */
import { SURFACES, surfaceCode, type ColorMap, type RGB } from './surfaces';
import type { CourseDoc, Layer } from './types';
import { decodeTerrain, encodeTerrain, type Terrain } from '../terrain/terrain';

export const FILE_EXT = '.fairway';
// Internal IDs keep the original working name so existing saves and autosaves still open.
const FORMAT = 'fairway-paint';
const VERSION = 1;

// ---------- RLE (count:1..255, value) pairs ----------
export function rleEncode(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const v = data[i];
    let run = 1;
    while (run < 255 && i + run < data.length && data[i + run] === v) run++;
    out.push(run, v);
    i += run;
  }
  return Uint8Array.from(out);
}

export function rleDecode(rle: Uint8Array, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let o = 0;
  for (let i = 0; i + 1 < rle.length && o < length; i += 2) {
    const n = Math.min(rle[i], length - o);
    out.fill(rle[i + 1], o, o + n);
    o += n;
  }
  return out;
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// ---------- serialize ----------
export function serialize(doc: CourseDoc): string {
  return JSON.stringify({
    format: FORMAT,
    version: VERSION,
    name: doc.name,
    width: doc.width,
    height: doc.height,
    yardsPerPixel: doc.yardsPerPixel,
    background: doc.background,
    colors: doc.colors,
    geo: doc.geo,
    terrain: doc.terrain ? terrainToJson(doc.terrain) : undefined,
    players: doc.players,
    surfaceTable: SURFACES.map((s) => s.id),
    layers: doc.layers.map((l) => {
      const base = { id: l.id, name: l.name, visible: l.visible, locked: l.locked, kind: l.kind };
      if (l.kind === 'map') return { ...base, source: l.source, opacity: l.opacity };
      if (l.kind === 'terrain') {
        const { showShade, showContours, interval, opacity } = l;
        return { ...base, showShade, showContours, interval, opacity };
      }
      if (l.kind === 'image') {
        const { src, imgW, imgH, x, y, scale, rotation, opacity, above } = l;
        return { ...base, src, imgW, imgH, x, y, scale, rotation, opacity, above };
      }
      return l.kind === 'raster'
        ? { ...base, outline: l.outline, rle: toBase64(rleEncode(l.pixels)) }
        : {
            ...base,
            features: l.features.map((f) => ({
              ...f,
              points: f.points.map((p) => [round3(p.x), round3(p.y)]),
            })),
          };
    }),
    holes: doc.holes.map((h) => ({
      ...h,
      points: h.points.map((p) => [round3(p.x), round3(p.y)]),
      targets: h.targets?.some(Boolean) ? h.targets.map((p) => (p ? [round3(p.x), round3(p.y)] : null)) : undefined,
    })),
  });
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function deserialize(text: string): CourseDoc {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j: any = JSON.parse(text);
  if (j?.format !== FORMAT) throw new Error('This is not a Linksketch course file.');
  if (j.version > VERSION) throw new Error('This file was made with a newer version of Linksketch.');
  const W = j.width | 0;
  const H = j.height | 0;
  if (W <= 0 || H <= 0) throw new Error('Invalid course size.');
  // Map file surface codes → current codes.
  const table: string[] = j.surfaceTable ?? [];
  const remap = new Uint8Array(256);
  table.forEach((id, i) => (remap[i + 1] = surfaceCode(id)));

  const layers: Layer[] = (j.layers ?? []).map((l: any): Layer => {
    const base = { id: String(l.id), name: String(l.name), visible: !!l.visible, locked: !!l.locked };
    if (l.kind === 'terrain') {
      return {
        ...base,
        kind: 'terrain',
        showShade: l.showShade !== false,
        showContours: l.showContours !== false,
        interval: [0.5, 1, 2, 5, 10, 20].includes(+l.interval) ? +l.interval : 2,
        opacity: Math.max(0, Math.min(1, Number.isFinite(+l.opacity) ? +l.opacity : 0.8)),
      };
    }
    if (l.kind === 'map') {
      return {
        ...base,
        kind: 'map',
        source: l.source === 'esri' ? 'esri' : 'usgs',
        opacity: Math.max(0, Math.min(1, Number.isFinite(+l.opacity) ? +l.opacity : 1)),
      };
    }
    if (l.kind === 'image') {
      const num = (v: unknown, d: number) => (Number.isFinite(+(v as number)) ? +(v as number) : d);
      return {
        ...base,
        kind: 'image',
        src: String(l.src ?? ''),
        imgW: num(l.imgW, 1),
        imgH: num(l.imgH, 1),
        x: num(l.x, 0),
        y: num(l.y, 0),
        scale: num(l.scale, 1) || 1,
        rotation: num(l.rotation, 0),
        opacity: Math.max(0, Math.min(1, num(l.opacity, 0.6))),
        above: !!l.above,
      };
    }
    if (l.kind === 'raster') {
      const px = rleDecode(fromBase64(l.rle ?? ''), W * H);
      for (let i = 0; i < px.length; i++) if (px[i]) px[i] = remap[px[i]];
      return { ...base, kind: 'raster', outline: l.outline ?? true, pixels: px };
    }
    return {
      ...base,
      kind: 'vector',
      features: (l.features ?? []).map((f: any) => ({
        id: String(f.id),
        surface: String(f.surface),
        smooth: !!f.smooth,
        points: (f.points ?? []).map((p: [number, number]) => ({ x: +p[0], y: +p[1] })),
      })),
    };
  });

  return {
    name: String(j.name ?? 'Untitled course'),
    width: W,
    height: H,
    yardsPerPixel: +j.yardsPerPixel || 1,
    background: String(j.background ?? 'white'),
    colors: parseColors(j.colors),
    terrain: terrainFromJson(j.terrain),
    players: parsePlayers(j.players),
    geo:
      j.geo && Number.isFinite(+j.geo.lat) && Number.isFinite(+j.geo.lon) && Math.abs(+j.geo.lat) < 85
        ? { lat: +j.geo.lat, lon: +j.geo.lon }
        : undefined,
    layers,
    holes: Array.isArray(j.holes)
      ? j.holes
          .map((h: any) => ({
            id: String(h.id),
            number: Math.max(1, Math.round(+h.number) || 1),
            par: Math.max(3, Math.min(6, Math.round(+h.par) || 4)),
            points: (h.points ?? []).map((p: [number, number] | { x: number; y: number }) =>
              Array.isArray(p) ? { x: +p[0], y: +p[1] } : { x: +p.x, y: +p.y },
            ),
            ...(Array.isArray(h.targets)
              ? {
                  targets: h.targets.slice(0, 12).map((p: unknown) =>
                    Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1]) ? { x: +p[0], y: +p[1] } : null,
                  ),
                }
              : {}),
          }))
          .filter((h: { points: unknown[] }) => h.points.length >= 2)
      : [],
  };
}

function terrainToJson(t: Terrain) {
  const e = encodeTerrain(t);
  return { ...e, data: toBase64(new Uint8Array(e.data.buffer)) };
}

function terrainFromJson(j: any): Terrain | undefined {
  if (!j || !(j.w > 1) || !(j.h > 1) || !(j.cell > 0)) return undefined;
  const bytes = fromBase64(String(j.data ?? ''));
  if (bytes.length !== j.w * j.h * 2) return undefined;
  const data = new Int16Array(bytes.buffer, bytes.byteOffset, j.w * j.h);
  return decodeTerrain({ cell: +j.cell, w: +j.w, h: +j.h, source: j.source === 'usgs' ? 'usgs' : 'sculpted', base: +j.base || 0, step: +j.step || 0.05, data });
}

function parseColors(c: unknown): ColorMap {
  const out: ColorMap = {};
  if (!c || typeof c !== 'object') return out;
  const rgb = (v: unknown): RGB | undefined =>
    Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n))
      ? [clamp(v[0]), clamp(v[1]), clamp(v[2])]
      : undefined;
  for (const [id, val] of Object.entries(c as Record<string, { color?: unknown; color2?: unknown }>)) {
    if (!surfaceCode(id)) continue;
    const color = rgb(val?.color);
    if (!color) continue;
    const color2 = rgb(val?.color2);
    out[id] = color2 ? { color, color2 } : { color };
  }
  return out;
}
const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));

// ---------- autosave (IndexedDB) ----------
const DB = 'fairway-paint'; // see FORMAT note above
const STORE = 'kv';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  const v = await new Promise<T | undefined>((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return v;
}

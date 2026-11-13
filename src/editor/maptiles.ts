/** Satellite map tiles (Web Mercator XYZ) drawn under the course. */
import { R, mercToWorld, mercPerYard, worldToMerc, type GeoRef } from '../geo/geo';
import type { MapSource, Vec2 } from '../model/types';
import { tileRetryDue } from './viewmath';

export interface SourceInfo {
  id: MapSource;
  name: string;
  url: (z: number, x: number, y: number) => string;
  /** Deepest zoom with real imagery (beyond it we enlarge). */
  maxZoom: number;
  attribution: string;
  license: string;
}

export const MAP_SOURCES: Record<MapSource, SourceInfo> = {
  usgs: {
    id: 'usgs',
    name: 'USGS aerial (public domain)',
    url: (z, x, y) => `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/${z}/${y}/${x}`,
    maxZoom: 16,
    attribution: 'Imagery: USDA, USGS The National Map',
    license: 'US government public domain — free to trace and to use commercially.',
  },
  esri: {
    id: 'esri',
    name: 'Esri World Imagery (sharper, personal use)',
    url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    maxZoom: 19,
    attribution: 'Imagery: Esri, Vantor, Earthstar Geographics, and the GIS User Community',
    license: 'Free for personal, non‑commercial use. Selling work traced from it needs an Esri license.',
  },
};

const WORLD = 2 * Math.PI * R;
const CACHE_MAX = 400;
/** A failed tile remembers when it failed, so it is tried again later (e.g. back online). */
const cache = new Map<string, HTMLImageElement | { failedAt: number }>();
const failed = (v: HTMLImageElement | { failedAt: number }): v is { failedAt: number } => 'failedAt' in v;

function tile(src: SourceInfo, z: number, x: number, y: number, onLoad: () => void): HTMLImageElement | null {
  const key = `${src.id}/${z}/${x}/${y}`;
  const hit = cache.get(key);
  if (hit && !(failed(hit) && tileRetryDue(hit.failedAt, performance.now()))) {
    // refresh LRU order
    cache.delete(key);
    cache.set(key, hit);
    return failed(hit) || !hit.complete || !hit.naturalWidth ? null : hit;
  }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = onLoad;
  img.onerror = () => cache.set(key, { failedAt: performance.now() });
  img.src = src.url(z, x, y);
  cache.set(key, img);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return null;
}

/** Cached tile only (no network) — for drawing a blurry placeholder while loading. */
function cachedTile(src: SourceInfo, z: number, x: number, y: number): HTMLImageElement | null {
  const hit = cache.get(`${src.id}/${z}/${x}/${y}`);
  return hit && !failed(hit) && hit.complete && hit.naturalWidth ? hit : null;
}

export interface MapDrawOptions {
  geo: GeoRef;
  source: MapSource;
  opacity: number;
  /** World (yards) → canvas CSS px. */
  toScreen: (w: Vec2) => Vec2;
  /** CSS px per yard. */
  unitsPerYard: number;
  /** Visible world rectangle in yards. */
  view: { x: number; y: number; w: number; h: number };
  /** Device pixels per CSS unit of the target context (dpr × zoom when drawing in doc space). */
  dpr: number;
  /** Grow each tile by this much (in target units) so neighbours never show a seam. */
  seam?: number;
  onLoad: () => void;
}

/** Best zoom for the current view: about one tile pixel per device pixel. */
export function pickZoom(o: Pick<MapDrawOptions, 'geo' | 'unitsPerYard' | 'dpr'>, maxZoom: number): number {
  const mercPerDevicePx = mercPerYard(o.geo) / (o.unitsPerYard * o.dpr);
  const z = Math.ceil(Math.log2(WORLD / 256 / mercPerDevicePx));
  return Math.max(1, Math.min(maxZoom, z));
}

export function drawMap(ctx: CanvasRenderingContext2D, o: MapDrawOptions): void {
  const src = MAP_SOURCES[o.source];
  let z = pickZoom(o, src.maxZoom);
  const a = worldToMerc(o.geo, { x: o.view.x, y: o.view.y });
  const b = worldToMerc(o.geo, { x: o.view.x + o.view.w, y: o.view.y + o.view.h });
  let range: { x0: number; x1: number; y0: number; y1: number };
  // Keep the tile count sane on huge zoomed-out views.
  for (;;) {
    const size = WORLD / 2 ** z;
    range = {
      x0: Math.floor((a.x + WORLD / 2) / size),
      x1: Math.floor((b.x + WORLD / 2) / size),
      y0: Math.floor((WORLD / 2 - a.y) / size),
      y1: Math.floor((WORLD / 2 - b.y) / size),
    };
    if ((range.x1 - range.x0 + 1) * (range.y1 - range.y0 + 1) <= 160 || z <= 1) break;
    z--;
  }
  const n = 2 ** z;
  // Tiles overlap by a hair to hide gaps. Drawn straight at partial opacity, those
  // overlaps would show as lines along every tile edge, so a faded map is drawn at
  // full strength off‑screen first, then faded once as a whole.
  const out = ctx;
  if (o.opacity < 1) {
    const sc = scratchCanvas(out.canvas.width, out.canvas.height);
    ctx = sc.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, sc.width, sc.height);
    ctx.setTransform(out.getTransform());
  }
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  for (let ty = Math.max(0, range.y0); ty <= Math.min(n - 1, range.y1); ty++) {
    for (let tx = range.x0; tx <= range.x1; tx++) {
      const wx = ((tx % n) + n) % n;
      const rect = tileRect(o, z, tx, ty);
      const img = tile(src, z, wx, ty, o.onLoad);
      if (img) {
        ctx.drawImage(img, rect.x, rect.y, rect.w, rect.h);
        continue;
      }
      // Placeholder: part of a cached ancestor tile, enlarged.
      for (let up = 1; up <= 6 && z - up >= 0; up++) {
        const k = 2 ** up;
        const px = Math.floor(wx / k);
        const py = Math.floor(ty / k);
        const anc = cachedTile(src, z - up, px, py);
        if (!anc) continue;
        const s = 256 / k;
        ctx.drawImage(anc, (wx - px * k) * s, (ty - py * k) * s, s, s, rect.x, rect.y, rect.w, rect.h);
        break;
      }
    }
  }
  ctx.restore();
  if (ctx !== out) {
    out.save();
    out.setTransform(1, 0, 0, 1, 0, 0);
    out.globalAlpha *= o.opacity;
    out.drawImage(ctx.canvas, 0, 0);
    out.restore();
  }
}

let scratch: HTMLCanvasElement | null = null;
function scratchCanvas(w: number, h: number): HTMLCanvasElement {
  scratch ??= document.createElement('canvas');
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  }
  return scratch;
}

function tileRect(o: MapDrawOptions, z: number, tx: number, ty: number) {
  const size = WORLD / 2 ** z;
  const tl = o.toScreen(mercToWorld(o.geo, { x: -WORLD / 2 + tx * size, y: WORLD / 2 - ty * size }));
  const br = o.toScreen(mercToWorld(o.geo, { x: -WORLD / 2 + (tx + 1) * size, y: WORLD / 2 - (ty + 1) * size }));
  const s = o.seam ?? 0.5;
  return { x: tl.x - s, y: tl.y - s, w: br.x - tl.x + 2 * s, h: br.y - tl.y + 2 * s };
}

/** Small attribution box (required by the imagery providers). */
export function drawAttribution(ctx: CanvasRenderingContext2D, text: string, w: number, h: number): void {
  ctx.save();
  ctx.font = '10px system-ui, sans-serif';
  const tw = ctx.measureText(text).width + 8;
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.fillRect(w - tw - 2, h - 16, tw, 14);
  ctx.fillStyle = '#000';
  ctx.fillText(text, w - tw + 2, h - 5.5);
  ctx.restore();
}

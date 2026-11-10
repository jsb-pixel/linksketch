import type { CourseDoc, Feature, Hole, ImageLayer, ImagePlacement, Layer, MapLayer, RasterLayer, Rect, VectorLayer } from './types';
import type { GeoRef } from '../geo/geo';
import { rectUnion } from '../geom/geom';
import type { ColorMap } from './surfaces';

const cloneColors = (c: ColorMap): ColorMap => JSON.parse(JSON.stringify(c));
/** Everything a course resize touches (arrays are replaced, never mutated, so refs suffice). */
interface DocState {
  width: number;
  height: number;
  geo: GeoRef | undefined;
  holes: Hole[];
  layers: Layer[];
  parts: Map<Layer, { pixels?: Uint8Array; features?: Feature[]; x?: number; y?: number }>;
}
function captureDoc(doc: CourseDoc): DocState {
  const parts: DocState['parts'] = new Map();
  for (const l of doc.layers) {
    if (l.kind === 'raster') parts.set(l, { pixels: l.pixels });
    else if (l.kind === 'vector') parts.set(l, { features: l.features });
    else if (l.kind === 'image') parts.set(l, { x: l.x, y: l.y });
  }
  return { width: doc.width, height: doc.height, geo: doc.geo && { ...doc.geo }, holes: doc.holes, layers: doc.layers.slice(), parts };
}
function restoreDoc(doc: CourseDoc, s: DocState): void {
  doc.width = s.width;
  doc.height = s.height;
  doc.geo = s.geo && { ...s.geo };
  doc.holes = s.holes;
  doc.layers = s.layers.slice();
  for (const [l, p] of s.parts) Object.assign(l, p);
}

type MapProps = Pick<MapLayer, 'source' | 'opacity'>;
const sameGeo = (a?: GeoRef, b?: GeoRef) => (!a && !b) || (!!a && !!b && a.lat === b.lat && a.lon === b.lon);
const cloneHoles = (hs: Hole[]): Hole[] => hs.map((h) => ({ ...h }));
const placementOf = (l: ImageLayer): ImagePlacement => ({
  x: l.x,
  y: l.y,
  scale: l.scale,
  rotation: l.rotation,
  opacity: l.opacity,
  above: l.above,
});
const samePlacement = (a: ImagePlacement, b: ImagePlacement) =>
  (Object.keys(a) as (keyof ImagePlacement)[]).every((k) => a[k] === b[k]);

interface VectorChange {
  layer: VectorLayer;
  before: Feature[];
  after: Feature[];
}
interface RasterChange {
  layer: RasterLayer;
  rect: Rect;
  before: Uint8Array;
  after: Uint8Array;
}
interface Entry {
  label: string;
  vector: VectorChange[];
  raster: RasterChange[];
  layers?: { before: Layer[]; after: Layer[] };
  colors?: { before: ColorMap; after: ColorMap };
  holes?: { before: Hole[]; after: Hole[] };
  geo?: { before: GeoRef | undefined; after: GeoRef | undefined };
  maps: { layer: MapLayer; before: MapProps; after: MapProps }[];
  docState?: { before: DocState; after: DocState };
  images: { layer: ImageLayer; before: ImagePlacement; after: ImagePlacement }[];
}

interface Pending {
  label: string;
  vector: Map<VectorLayer, Feature[]>;
  raster: Map<RasterLayer, { copy: Uint8Array; dirty: Rect | null }>;
  layers?: Layer[];
  colors?: ColorMap;
  holes?: Hole[];
  geo?: { value: GeoRef | undefined };
  maps: Map<MapLayer, MapProps>;
  docState?: DocState;
  images: Map<ImageLayer, ImagePlacement>;
}

const cloneFeatures = (fs: Feature[]): Feature[] => fs.map((f) => ({ ...f }));

function sliceRect(px: Uint8Array, W: number, r: Rect): Uint8Array {
  const out = new Uint8Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) out.set(px.subarray((r.y + y) * W + r.x, (r.y + y) * W + r.x + r.w), y * r.w);
  return out;
}
function writeRect(px: Uint8Array, W: number, r: Rect, data: Uint8Array): void {
  for (let y = 0; y < r.h; y++) px.set(data.subarray(y * r.w, (y + 1) * r.w), (r.y + y) * W + r.x);
}

/**
 * Undo/redo. Usage: begin(label) → snapshot* / markRaster* → mutate doc → commit().
 * One entry per user gesture. Feature points are immutable arrays, so a shallow
 * feature copy is a full snapshot.
 */
export class History {
  private undoStack: Entry[] = [];
  private redoStack: Entry[] = [];
  private pending: Pending | null = null;
  /** Called after commit/undo/redo. */
  onChange: () => void = () => {};

  constructor(private doc: CourseDoc, private limit = 200) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  get undoLabel(): string | undefined {
    return this.undoStack[this.undoStack.length - 1]?.label;
  }
  get redoLabel(): string | undefined {
    return this.redoStack[this.redoStack.length - 1]?.label;
  }
  get inTransaction(): boolean {
    return this.pending !== null;
  }

  begin(label: string): void {
    if (this.pending) this.commit();
    this.pending = { label, vector: new Map(), raster: new Map(), images: new Map(), maps: new Map() };
  }

  snapshotVector(layer: VectorLayer): void {
    const p = this.need();
    if (!p.vector.has(layer)) p.vector.set(layer, cloneFeatures(layer.features));
  }

  snapshotRaster(layer: RasterLayer): void {
    const p = this.need();
    if (!p.raster.has(layer)) p.raster.set(layer, { copy: layer.pixels.slice(), dirty: null });
  }

  /** Record that pixels inside `r` (integer, clipped) of a snapshotted layer changed. */
  markRaster(layer: RasterLayer, r: Rect): void {
    const e = this.need().raster.get(layer);
    if (e) e.dirty = rectUnion(e.dirty, r);
  }

  snapshotColors(): void {
    const p = this.need();
    if (!p.colors) p.colors = cloneColors(this.doc.colors);
  }

  snapshotHoles(): void {
    const p = this.need();
    if (!p.holes) p.holes = cloneHoles(this.doc.holes);
  }

  /** Snapshot for whole‑course operations (resize). Use alone in its transaction. */
  snapshotDoc(): void {
    const p = this.need();
    if (!p.docState) p.docState = captureDoc(this.doc);
  }

  snapshotGeo(): void {
    const p = this.need();
    if (!p.geo) p.geo = { value: this.doc.geo && { ...this.doc.geo } };
  }

  snapshotMap(layer: MapLayer): void {
    const p = this.need();
    if (!p.maps.has(layer)) p.maps.set(layer, { source: layer.source, opacity: layer.opacity });
  }

  snapshotImage(layer: ImageLayer): void {
    const p = this.need();
    if (!p.images.has(layer)) p.images.set(layer, placementOf(layer));
  }

  snapshotLayers(): void {
    const p = this.need();
    if (!p.layers) p.layers = this.doc.layers.slice();
  }

  /** Finish the gesture. Returns false if nothing changed. */
  commit(): boolean {
    const p = this.pending;
    if (!p) return false;
    this.pending = null;
    const entry: Entry = { label: p.label, vector: [], raster: [], images: [], maps: [] };
    for (const [layer, before] of p.vector) {
      const changed =
        before.length !== layer.features.length ||
        before.some((f, i) => {
          const g = layer.features[i];
          return f.id !== g.id || f.points !== g.points || f.surface !== g.surface || f.smooth !== g.smooth;
        });
      if (changed) entry.vector.push({ layer, before, after: cloneFeatures(layer.features) });
    }
    for (const [layer, { copy, dirty }] of p.raster) {
      if (!dirty) continue;
      entry.raster.push({
        layer,
        rect: dirty,
        before: sliceRect(copy, this.doc.width, dirty),
        after: sliceRect(layer.pixels, this.doc.width, dirty),
      });
    }
    if (p.layers) {
      const after = this.doc.layers.slice();
      if (after.length !== p.layers.length || after.some((l, i) => l !== p.layers![i])) {
        entry.layers = { before: p.layers, after };
      }
    }
    if (p.colors && JSON.stringify(p.colors) !== JSON.stringify(this.doc.colors)) {
      entry.colors = { before: p.colors, after: cloneColors(this.doc.colors) };
    }
    if (p.holes) {
      const now = this.doc.holes;
      const changed =
        p.holes.length !== now.length ||
        p.holes.some((h, i) => {
          const g = now[i];
          return h.id !== g.id || h.points !== g.points || h.par !== g.par || h.number !== g.number;
        });
      if (changed) entry.holes = { before: p.holes, after: cloneHoles(now) };
    }
    if (p.docState) {
      const after = captureDoc(this.doc);
      const b = p.docState;
      if (b.width !== after.width || b.height !== after.height || !sameGeo(b.geo, after.geo) || [...after.parts].some(([l, v]) => {
        const o = b.parts.get(l);
        return !o || o.pixels !== v.pixels || o.features !== v.features || o.x !== v.x || o.y !== v.y;
      }))
        entry.docState = { before: b, after };
    }
    if (p.geo && !sameGeo(p.geo.value, this.doc.geo)) entry.geo = { before: p.geo.value, after: this.doc.geo && { ...this.doc.geo } };
    for (const [layer, before] of p.maps) {
      const after = { source: layer.source, opacity: layer.opacity };
      if (before.source !== after.source || before.opacity !== after.opacity) entry.maps.push({ layer, before, after });
    }
    for (const [layer, before] of p.images) {
      const after = placementOf(layer);
      if (!samePlacement(before, after)) entry.images.push({ layer, before, after });
    }
    if (!entry.vector.length && !entry.raster.length && !entry.layers && !entry.colors && !entry.holes && !entry.images.length && !entry.geo && !entry.maps.length && !entry.docState)
      return false;
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.onChange();
    return true;
  }

  /** Cancel the gesture and restore what it changed. */
  abort(): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    for (const [layer, before] of p.vector) layer.features = cloneFeatures(before);
    for (const [layer, { copy }] of p.raster) layer.pixels.set(copy);
    if (p.layers) this.doc.layers = p.layers.slice();
    if (p.colors) this.doc.colors = cloneColors(p.colors);
    if (p.holes) this.doc.holes = cloneHoles(p.holes);
    for (const [layer, before] of p.images) Object.assign(layer, before);
    for (const [layer, before] of p.maps) Object.assign(layer, before);
    if (p.geo) this.doc.geo = p.geo.value;
    if (p.docState) restoreDoc(this.doc, p.docState);
  }

  undo(): boolean {
    if (this.pending) this.commit();
    const e = this.undoStack.pop();
    if (!e) return false;
    this.apply(e, 'before');
    this.redoStack.push(e);
    this.onChange();
    return true;
  }

  redo(): boolean {
    const e = this.redoStack.pop();
    if (!e) return false;
    this.apply(e, 'after');
    this.undoStack.push(e);
    this.onChange();
    return true;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.pending = null;
  }

  private apply(e: Entry, side: 'before' | 'after'): void {
    if (e.docState) restoreDoc(this.doc, e.docState[side]);
    if (e.layers) this.doc.layers = e.layers[side].slice();
    if (e.colors) this.doc.colors = cloneColors(e.colors[side]);
    if (e.holes) this.doc.holes = cloneHoles(e.holes[side]);
    for (const im of e.images) Object.assign(im.layer, im[side]);
    for (const m of e.maps) Object.assign(m.layer, m[side]);
    if (e.geo) this.doc.geo = e.geo[side] && { ...e.geo[side]! };
    for (const v of e.vector) v.layer.features = cloneFeatures(v[side]);
    for (const r of e.raster) writeRect(r.layer.pixels, this.doc.width, r.rect, r[side]);
  }

  private need(): Pending {
    if (!this.pending) throw new Error('History: no transaction in progress');
    return this.pending;
  }
}

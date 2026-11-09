import type { CourseDoc, Feature, Layer, RasterLayer, Rect, VectorLayer } from './types';
import { rectUnion } from '../geom/geom';
import type { ColorMap } from './surfaces';

const cloneColors = (c: ColorMap): ColorMap => JSON.parse(JSON.stringify(c));

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
}

interface Pending {
  label: string;
  vector: Map<VectorLayer, Feature[]>;
  raster: Map<RasterLayer, { copy: Uint8Array; dirty: Rect | null }>;
  layers?: Layer[];
  colors?: ColorMap;
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
    this.pending = { label, vector: new Map(), raster: new Map() };
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

  snapshotLayers(): void {
    const p = this.need();
    if (!p.layers) p.layers = this.doc.layers.slice();
  }

  /** Finish the gesture. Returns false if nothing changed. */
  commit(): boolean {
    const p = this.pending;
    if (!p) return false;
    this.pending = null;
    const entry: Entry = { label: p.label, vector: [], raster: [] };
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
    if (!entry.vector.length && !entry.raster.length && !entry.layers && !entry.colors) return false;
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
    if (e.layers) this.doc.layers = e.layers[side].slice();
    if (e.colors) this.doc.colors = cloneColors(e.colors[side]);
    for (const v of e.vector) v.layer.features = cloneFeatures(v[side]);
    for (const r of e.raster) writeRect(r.layer.pixels, this.doc.width, r.rect, r[side]);
  }

  private need(): Pending {
    if (!this.pending) throw new Error('History: no transaction in progress');
    return this.pending;
  }
}

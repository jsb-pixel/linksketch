import type { PlayerProfile } from '../strategy/strategy';
import type { CourseDoc, Feature, Hole, ImageLayer, ImagePlacement, Layer, MapLayer, RasterLayer, Rect, TeeSet, TextLabel, VectorLayer } from './types';
import type { GeoRef } from '../geo/geo';
import { touch, type Terrain } from '../terrain/terrain';
import { rectUnion } from '../geom/geom';
import type { ColorMap } from './surfaces';

const cloneColors = (c: ColorMap): ColorMap => JSON.parse(JSON.stringify(c));
/** Everything a course resize touches (arrays are replaced, never mutated, so refs suffice). */
const clonePlayers = (p: PlayerProfile[] | undefined) => p && p.map((x) => ({ ...x }));

interface DocState {
  ypp: number;
  width: number;
  height: number;
  geo: GeoRef | undefined;
  terrain: Terrain | undefined;
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
  return { ypp: doc.yardsPerPixel, width: doc.width, height: doc.height, geo: doc.geo && { ...doc.geo }, terrain: doc.terrain, holes: doc.holes, layers: doc.layers.slice(), parts };
}
function restoreDoc(doc: CourseDoc, s: DocState): void {
  doc.yardsPerPixel = s.ypp;
  doc.width = s.width;
  doc.height = s.height;
  doc.geo = s.geo && { ...s.geo };
  doc.terrain = s.terrain;
  if (s.terrain) touch(s.terrain);
  doc.holes = s.holes;
  doc.layers = s.layers.slice();
  for (const [l, p] of s.parts) Object.assign(l, p);
}

/** Terrain object + a copy of its heights (the brush edits heights in place). */
interface TerrainSnap {
  terrain: Terrain | undefined;
  heights: Float32Array | undefined;
}
const snapTerrain = (t: Terrain | undefined): TerrainSnap => ({ terrain: t, heights: t?.heights.slice() });
function sameTerrain(a: TerrainSnap, b: TerrainSnap): boolean {
  if (a.terrain !== b.terrain) return false;
  if (!a.heights || !b.heights) return a.heights === b.heights;
  for (let i = 0; i < a.heights.length; i++) if (a.heights[i] !== b.heights[i]) return false;
  return true;
}
function restoreTerrain(doc: CourseDoc, s: TerrainSnap): void {
  doc.terrain = s.terrain;
  if (s.terrain && s.heights) {
    s.terrain.heights.set(s.heights);
    touch(s.terrain);
  }
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

/** Course name/background and per-layer name + outline switch. */
interface MetaState {
  name: string;
  background: string;
  layers: Map<Layer, { name: string; outline?: boolean }>;
}
function captureMeta(doc: CourseDoc): MetaState {
  const layers: MetaState['layers'] = new Map();
  for (const l of doc.layers) layers.set(l, l.kind === 'raster' ? { name: l.name, outline: l.outline } : { name: l.name });
  return { name: doc.name, background: doc.background, layers };
}
function restoreMeta(doc: CourseDoc, m: MetaState): void {
  doc.name = m.name;
  doc.background = m.background;
  for (const [l, v] of m.layers) Object.assign(l, v);
}
function sameMeta(a: MetaState, b: MetaState): boolean {
  if (a.name !== b.name || a.background !== b.background) return false;
  for (const [l, v] of b.layers) {
    const o = a.layers.get(l);
    if (o && (o.name !== v.name || o.outline !== v.outline)) return false;
  }
  return true;
}

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
  players?: { before: PlayerProfile[] | undefined; after: PlayerProfile[] | undefined };
  holes?: { before: Hole[]; after: Hole[] };
  geo?: { before: GeoRef | undefined; after: GeoRef | undefined };
  terrain?: { before: TerrainSnap; after: TerrainSnap };
  maps: { layer: MapLayer; before: MapProps; after: MapProps }[];
  docState?: { before: DocState; after: DocState };
  images: { layer: ImageLayer; before: ImagePlacement; after: ImagePlacement }[];
  meta?: { before: MetaState; after: MetaState };
  tees?: { before: TeeSet[] | undefined; after: TeeSet[] | undefined };
  labels?: { before: TextLabel[] | undefined; after: TextLabel[] | undefined };
  /** Rough memory held by this entry, for the history budget. */
  bytes: number;
}

interface Pending {
  label: string;
  vector: Map<VectorLayer, Feature[]>;
  raster: Map<RasterLayer, { copy: Uint8Array; dirty: Rect | null }>;
  layers?: Layer[];
  colors?: ColorMap;
  players?: { value: PlayerProfile[] | undefined };
  holes?: Hole[];
  geo?: { value: GeoRef | undefined };
  terrain?: TerrainSnap;
  maps: Map<MapLayer, MapProps>;
  docState?: DocState;
  images: Map<ImageLayer, ImagePlacement>;
  meta?: MetaState;
  tees?: { value: TeeSet[] | undefined };
  labels?: { value: TextLabel[] | undefined };
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

  /**
   * `limit` caps the number of steps; `byteBudget` caps the memory they hold (big fills
   * and resizes keep whole copies of paint layers). The newest step is always kept.
   */
  constructor(private doc: CourseDoc, private limit = 200, private byteBudget = 256 * 1024 * 1024) {}

  /** Approximate memory held by the undo and redo stacks. */
  get bytes(): number {
    let n = 0;
    for (const e of this.undoStack) n += e.bytes;
    for (const e of this.redoStack) n += e.bytes;
    return n;
  }

  private trim(): void {
    while (this.undoStack.length > this.limit) this.undoStack.shift();
    let total = this.bytes;
    while (this.undoStack.length > 1 && total > this.byteBudget) total -= this.undoStack.shift()!.bytes;
  }

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

  snapshotPlayers(): void {
    const p = this.need();
    if (!p.players) p.players = { value: clonePlayers(this.doc.players) };
  }

  snapshotTerrain(): void {
    const p = this.need();
    if (!p.terrain) p.terrain = snapTerrain(this.doc.terrain);
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

  /** Course name, background, layer names and outline switches. */
  snapshotMeta(): void {
    const p = this.need();
    if (!p.meta) p.meta = captureMeta(this.doc);
  }

  snapshotTeeSets(): void {
    const p = this.need();
    if (!p.tees) p.tees = { value: this.doc.teeSets && this.doc.teeSets.map((t) => ({ ...t })) };
  }

  snapshotLabels(): void {
    const p = this.need();
    if (!p.labels) p.labels = { value: this.doc.labels && this.doc.labels.map((t) => ({ ...t })) };
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
    const entry: Entry = { label: p.label, vector: [], raster: [], images: [], maps: [], bytes: 0 };
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
          return h.id !== g.id || h.points !== g.points || h.par !== g.par || h.number !== g.number || h.targets !== g.targets || h.tees !== g.tees;
        });
      if (changed) entry.holes = { before: p.holes, after: cloneHoles(now) };
    }
    if (p.docState) {
      const after = captureDoc(this.doc);
      const b = p.docState;
      if (b.ypp !== after.ypp || b.width !== after.width || b.height !== after.height || !sameGeo(b.geo, after.geo) || b.terrain !== after.terrain || [...after.parts].some(([l, v]) => {
        const o = b.parts.get(l);
        return !o || o.pixels !== v.pixels || o.features !== v.features || o.x !== v.x || o.y !== v.y;
      }))
        entry.docState = { before: b, after };
    }
    if (p.terrain) {
      const after = snapTerrain(this.doc.terrain);
      if (!sameTerrain(p.terrain, after)) entry.terrain = { before: p.terrain, after };
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
    if (p.players && JSON.stringify(p.players.value) !== JSON.stringify(this.doc.players))
      entry.players = { before: p.players.value, after: clonePlayers(this.doc.players) };
    if (p.meta) {
      const after = captureMeta(this.doc);
      if (!sameMeta(p.meta, after)) entry.meta = { before: p.meta, after };
    }
    if (p.tees && JSON.stringify(p.tees.value) !== JSON.stringify(this.doc.teeSets))
      entry.tees = { before: p.tees.value, after: this.doc.teeSets && this.doc.teeSets.map((t) => ({ ...t })) };
    if (p.labels && JSON.stringify(p.labels.value) !== JSON.stringify(this.doc.labels))
      entry.labels = { before: p.labels.value, after: this.doc.labels && this.doc.labels.map((t) => ({ ...t })) };
    if (!entry.vector.length && !entry.raster.length && !entry.layers && !entry.colors && !entry.players && !entry.holes && !entry.images.length && !entry.geo && !entry.maps.length && !entry.docState && !entry.terrain && !entry.meta && !entry.tees && !entry.labels)
      return false;
    entry.bytes = entryBytes(entry);
    this.undoStack.push(entry);
    this.trim();
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
    if (p.players) this.doc.players = clonePlayers(p.players.value);
    if (p.holes) this.doc.holes = cloneHoles(p.holes);
    for (const [layer, before] of p.images) Object.assign(layer, before);
    for (const [layer, before] of p.maps) Object.assign(layer, before);
    if (p.geo) this.doc.geo = p.geo.value;
    if (p.docState) restoreDoc(this.doc, p.docState);
    if (p.terrain) restoreTerrain(this.doc, p.terrain);
    if (p.meta) restoreMeta(this.doc, p.meta);
    if (p.tees) this.doc.teeSets = p.tees.value;
    if (p.labels) this.doc.labels = p.labels.value;
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

  /**
   * Doc pixels touched by the last undo/redo when it only changed paint (the usual
   * case for brush work), so the view can re-render just that; null = everything.
   */
  lastRect: Rect | null = null;

  private apply(e: Entry, side: 'before' | 'after'): void {
    const paintOnly =
      e.raster.length > 0 && !e.vector.length && !e.layers && !e.colors && !e.docState && !e.meta && !e.terrain && !e.images.length && !e.maps.length;
    this.lastRect = paintOnly ? e.raster.reduce<Rect | null>((r, c) => rectUnion(r, c.rect), null) : null;
    if (e.docState) restoreDoc(this.doc, e.docState[side]);
    if (e.terrain) restoreTerrain(this.doc, e.terrain[side]);
    if (e.layers) this.doc.layers = e.layers[side].slice();
    if (e.colors) this.doc.colors = cloneColors(e.colors[side]);
    if (e.players) this.doc.players = clonePlayers(e.players[side]);
    if (e.holes) this.doc.holes = cloneHoles(e.holes[side]);
    for (const im of e.images) Object.assign(im.layer, im[side]);
    for (const m of e.maps) Object.assign(m.layer, m[side]);
    if (e.geo) this.doc.geo = e.geo[side] && { ...e.geo[side]! };
    for (const v of e.vector) v.layer.features = cloneFeatures(v[side]);
    for (const r of e.raster) writeRect(r.layer.pixels, this.doc.width, r.rect, r[side]);
    if (e.meta) restoreMeta(this.doc, e.meta[side]);
    if (e.tees) this.doc.teeSets = e.tees[side] && e.tees[side]!.map((t) => ({ ...t }));
    if (e.labels) this.doc.labels = e.labels[side] && e.labels[side]!.map((t) => ({ ...t }));
  }

  private need(): Pending {
    if (!this.pending) throw new Error('History: no transaction in progress');
    return this.pending;
  }
}

/** Rough bytes an entry keeps alive (typed arrays dominate; everything else is small). */
function entryBytes(e: Entry): number {
  let n = 512;
  for (const r of e.raster) n += r.before.length + r.after.length;
  for (const v of e.vector) n += (v.before.length + v.after.length) * 64;
  if (e.terrain) n += ((e.terrain.before.heights?.length ?? 0) + (e.terrain.after.heights?.length ?? 0)) * 4;
  if (e.docState) {
    for (const s of [e.docState.before, e.docState.after]) {
      for (const p of s.parts.values()) n += p.pixels?.length ?? 0;
      n += (s.terrain?.heights.length ?? 0) * 4;
    }
  }
  return n;
}

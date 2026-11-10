import { dist, pixelRect, rectUnion } from '../geom/geom';
import { findLayer } from '../model/doc';
import { History } from '../model/history';
import { surfaceByCode, surfaceById } from '../model/surfaces';
import type { CourseDoc, Feature, Hole, ImageLayer, ImagePlacement, Layer, MapLayer, MapSource, RasterLayer, Rect, TerrainLayer, Vec2, VectorLayer } from '../model/types';
import { drawHoles } from './holes';
import { drawUnderlay, drawUnderlayFrame } from './underlay';
import { drawAttribution, drawMap, MAP_SOURCES } from './maptiles';
import { drawTerrain } from '../terrain/render';
import { heightAtPx, minMax, type BrushMode, type Terrain } from '../terrain/terrain';
import { ELEVATION_ATTRIBUTION, fetchUsgsTerrain } from '../terrain/usgs';
import { geoWithPointAt } from '../geo/geo';
import { featureContains, flatten, renderRegion, sortedFeatures } from '../render/raster';
import { forEachPixel, regionEdges, traceOutline, type Region } from '../render/regions';
import { applyColors, rgbCss, surfaceCode, surfaceColor, type ColorMap, type SurfaceColors } from '../model/surfaces';
import { createMapLayer, createTerrainLayer, MAX_DOC_PIXELS, uid } from '../model/doc';
import { MIN_SIDE_PX, resizeDoc } from '../model/resize';

export type ToolId =
  | 'select'
  | 'freehand'
  | 'polygon'
  | 'pencil'
  | 'brush'
  | 'spray'
  | 'fill'
  | 'wand'
  | 'eraser'
  | 'picker'
  | 'ruler'
  | 'zoom'
  | 'hand'
  | 'hole'
  | 'underlay'
  | 'scale'
  | 'terrain';

export interface PointerInfo {
  /** CSS px relative to the canvas. */
  screen: Vec2;
  /** Doc pixels (float). */
  px: Vec2;
  /** Yards. */
  world: Vec2;
  button: number;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  /** 1 = single click, 2 = double click … */
  clicks: number;
  pressure: number;
}

export interface Tool {
  id: ToolId;
  name: string;
  /** Single‑key shortcut (lowercase). */
  key: string;
  hint: string;
  cursor: string;
  /** Show the brush size option. */
  usesBrush?: boolean;
  /** Right‑click (or ⌃‑click) uses the secondary surface. */
  secondaryButton?: boolean;
  down?(e: PointerInfo): void;
  move?(e: PointerInfo, dragging: boolean): void;
  up?(e: PointerInfo): void;
  /** Escape / tool switch. */
  cancel?(): void;
  /** Return true if handled. */
  keydown?(e: KeyboardEvent): boolean;
  /** Draw screen‑space overlay (context already in CSS px). */
  overlay?(ctx: CanvasRenderingContext2D): void;
}

export interface Selection {
  layerId: string;
  featureId: string;
  point: number | null;
}

/** A selected area of painted pixels (magic wand). */
export interface PixelSelection extends Region {
  layerId: string;
  code: number;
  /** Outline segments for drawing, in doc pixels. */
  edges: [number, number, number, number][];
}

export type EditorEvent = 'holes' | 'palette' | 'doc' | 'selection' | 'tool' | 'surface' | 'view' | 'status' | 'history' | 'options';

export interface Ruler {
  points: Vec2[];
  live: Vec2 | null;
  active: boolean;
}

type DocHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
const HANDLE_CURSORS: Record<DocHandle, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
};

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 40;

export class Editor {
  doc!: CourseDoc;
  history!: History;

  readonly ctx: CanvasRenderingContext2D;
  readonly docCanvas = document.createElement('canvas');
  private readonly docCtx: CanvasRenderingContext2D;

  zoom = 1;
  panX = 0;
  panY = 0;

  tools = new Map<ToolId, Tool>();
  tool!: Tool;
  /** Tool to return to after a one‑shot tool (eyedropper). */
  previousTool: ToolId = 'select';

  surface = 'fairway';
  /** Right‑click surface (like Paint's background color). */
  surface2 = 'rough';
  brushSize = 3;
  smoothShapes = true;
  // View preferences (remembered in this browser).
  showYardGrid = false;
  yardGridSize: 25 | 50 | 100 = 100;
  /** Zoom at which the pixel grid appears; 0 = never. */
  pixelGridZoom = 8;
  showHoles = true;
  arcsFromTee = true;
  arcsToGreen = true;
  selectedHoleId: string | null = null;

  activeLayerId: string | null = null;
  selection: Selection | null = null;
  region: PixelSelection | null = null;
  ruler: Ruler = { points: [], live: null, active: false };
  hover: PointerInfo | null = null;
  message = '';

  private dirty: Rect | null = null;
  private frameRequested = false;
  private listeners = new Map<EditorEvent, Set<() => void>>();
  private dpr = 1;
  private cssW = 0;
  private cssH = 0;

  // pointer state
  private pointerDown = false;
  private panning: { x: number; y: number; px: number; py: number } | null = null;
  private spaceHeld = false;
  private lastClick = { t: 0, x: 0, y: 0, n: 0 };

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
    this.docCtx = this.docCanvas.getContext('2d', { willReadFrequently: false })!;
    this.loadViewPrefs();
    this.bindEvents();
  }

  // ---------------------------------------------------------------- events
  on(ev: EditorEvent, fn: () => void): void {
    if (!this.listeners.has(ev)) this.listeners.set(ev, new Set());
    this.listeners.get(ev)!.add(fn);
  }
  emit(...evs: EditorEvent[]): void {
    for (const ev of evs) this.listeners.get(ev)?.forEach((fn) => fn());
  }
  setMessage(msg: string): void {
    this.message = msg;
    this.emit('status');
  }

  // ---------------------------------------------------------------- document
  setDoc(doc: CourseDoc): void {
    this.tool?.cancel?.();
    this.doc = doc;
    this.history = new History(doc);
    this.history.onChange = () => {
      this.syncCanvasSize();
      if (this.selectedHoleId && !this.doc.holes.some((h) => h.id === this.selectedHoleId)) this.selectedHoleId = null;
      this.requestFrame();
      this.syncColors();
      this.validateSelection();
      this.validateRegion();
      this.emit('history', 'doc', 'selection');
    };
    this.appliedColors = '';
    this.syncColors();
    this.docCanvas.width = doc.width;
    this.docCanvas.height = doc.height;
    this.selection = null;
    this.region = null;
    this.selectedHoleId = null;
    this.ruler = { points: [], live: null, active: false };
    this.activeLayerId = doc.layers.find((l) => l.kind === 'vector')?.id ?? doc.layers[0]?.id ?? null;
    this.invalidate();
    this.fit();
    this.emit('doc', 'selection', 'history', 'view');
  }

  // ---------------------------------------------------------------- holes
  selectedHole(): Hole | null {
    return this.doc.holes.find((h) => h.id === this.selectedHoleId) ?? null;
  }

  selectHole(id: string | null): void {
    this.selectedHoleId = id;
    this.emit('selection', 'holes');
    this.requestFrame();
  }

  /** Change a hole as one undo step. */
  updateHole(id: string, label: string, fn: (h: Hole) => Partial<Hole>): void {
    const i = this.doc.holes.findIndex((h) => h.id === id);
    if (i < 0) return;
    this.history.begin(label);
    this.history.snapshotHoles();
    const holes = this.doc.holes.slice();
    holes[i] = { ...holes[i], ...fn(holes[i]) };
    this.doc.holes = holes;
    this.history.commit();
    this.emit('holes', 'selection');
  }

  /** Give a hole a number, swapping with whichever hole had it. */
  renumberHole(id: string, n: number): void {
    const h = this.doc.holes.find((x) => x.id === id);
    if (!h || n < 1 || n === h.number) return;
    this.history.begin('Renumber hole');
    this.history.snapshotHoles();
    const old = h.number;
    this.doc.holes = this.doc.holes.map((x) => (x.id === id ? { ...x, number: n } : x.number === n ? { ...x, number: old } : x));
    this.history.commit();
    this.emit('holes', 'selection');
  }

  deleteHole(id: string): void {
    this.history.begin('Delete hole');
    this.history.snapshotHoles();
    this.doc.holes = this.doc.holes.filter((h) => h.id !== id);
    this.history.commit();
    if (this.selectedHoleId === id) this.selectedHoleId = null;
    this.emit('holes', 'selection');
  }

  /** Pan so a world point is in the middle of the view. */
  centerOn(w: Vec2): void {
    const p = this.worldToPx(w);
    this.panX = this.cssW / 2 - (p.x * this.cos - p.y * this.sin) * this.zoom;
    this.panY = this.cssH / 2 - (p.x * this.sin + p.y * this.cos) * this.zoom;
    this.emit('view');
    this.requestFrame();
  }

  /** World rectangle currently visible. */
  /** World rectangle covering everything visible (its bounding box when rotated). */
  visibleWorld(): { x: number; y: number; w: number; h: number } {
    const pts = [
      { x: 0, y: 0 },
      { x: this.cssW, y: 0 },
      { x: this.cssW, y: this.cssH },
      { x: 0, y: this.cssH },
    ].map((s) => this.pxToWorld(this.screenToPx(s)));
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }

  // ---------------------------------------------------------------- underlays
  // ---------------------------------------------------------------- real-world placement
  mapLayer(): MapLayer | null {
    return (this.doc.layers.find((l) => l.kind === 'map') as MapLayer) ?? null;
  }

  /** Put the course on Earth with (lat, lon) at the middle of the course. */
  placeOnMap(lat: number, lon: number, source: MapSource): void {
    const k = this.doc.yardsPerPixel;
    const center = { x: (this.doc.width * k) / 2, y: (this.doc.height * k) / 2 };
    this.history.begin('Place on map');
    this.history.snapshotGeo();
    this.history.snapshotLayers();
    this.doc.geo = geoWithPointAt(lat, lon, center);
    let map = this.mapLayer();
    if (map) {
      this.history.snapshotMap(map);
      map.source = source;
      map.visible = true;
    } else {
      map = createMapLayer(source);
      this.doc.layers = [map, ...this.doc.layers];
    }
    this.history.commit();
    this.activeLayerId = map.id;
    this.emit('doc', 'selection');
    this.fit();
  }

  removeFromMap(): void {
    this.history.begin('Remove from map');
    this.history.snapshotGeo();
    this.history.snapshotLayers();
    this.doc.geo = undefined;
    this.doc.layers = this.doc.layers.filter((l) => l.kind !== 'map');
    this.history.commit();
    this.emit('doc', 'selection');
    this.requestFrame();
  }

  updateMap(l: MapLayer, label: string, change: Partial<Pick<MapLayer, 'source' | 'opacity'>>): void {
    this.history.begin(label);
    this.history.snapshotMap(l);
    Object.assign(l, change);
    this.history.commit();
    this.emit('selection');
    this.requestFrame();
  }

  // ---------------------------------------------------------------- terrain
  terrainBrush: BrushMode = 'raise';

  terrainLayer(): TerrainLayer | null {
    return (this.doc.layers.find((l) => l.kind === 'terrain') as TerrainLayer) ?? null;
  }

  /** Ground height in feet at a world point, or null without terrain. */
  elevationAt(w: Vec2): number | null {
    const t = this.doc.terrain;
    return t ? heightAtPx(t, this.worldToPx(w)) : null;
  }

  /** Install a terrain (replacing any) as one undo step, adding the layer if needed. */
  setTerrain(t: Terrain | undefined, label: string): void {
    this.history.begin(label);
    this.history.snapshotTerrain();
    this.history.snapshotLayers();
    this.doc.terrain = t;
    if (t && !this.terrainLayer()) this.doc.layers = [...this.doc.layers, createTerrainLayer()];
    if (!t) this.doc.layers = this.doc.layers.filter((l) => l.kind !== 'terrain');
    this.history.commit();
    this.emit('doc', 'selection', 'holes');
    this.requestFrame();
  }

  /** Download real elevation for a course placed on the map. */
  async importTerrain(): Promise<void> {
    if (!this.doc.geo) {
      this.setMessage('Place the course on the map first (Map → Place course on map…).');
      return;
    }
    this.setMessage('Downloading elevation from USGS 3DEP…');
    try {
      const t = await fetchUsgsTerrain(this.doc.geo, this.doc.width, this.doc.height, this.doc.yardsPerPixel);
      this.setTerrain(t, 'Import elevation');
      const { min, max } = minMax(t);
      this.setMessage(`Elevation loaded: ${Math.round(min)}–${Math.round(max)} ft (${Math.round(max - min)} ft of relief).`);
    } catch (err) {
      this.setMessage((err as Error).message);
    }
  }

  /** Change how terrain is shown (view setting, not an undo step). */
  updateTerrainLayer(change: Partial<Pick<TerrainLayer, 'showShade' | 'showContours' | 'interval' | 'opacity'>>): void {
    const l = this.terrainLayer();
    if (!l) return;
    Object.assign(l, change);
    this.emit('selection', 'history');
    this.requestFrame();
  }

  /** The underlay that underlay tools act on: active layer, else top‑most visible. */
  activeImage(): ImageLayer | null {
    const a = this.activeLayer;
    if (a?.kind === 'image') return a;
    return ([...this.doc.layers].reverse().find((l) => l.kind === 'image' && l.visible) as ImageLayer) ?? null;
  }

  /** Change an underlay's placement as one undo step. */
  updateImage(l: ImageLayer, label: string, change: Partial<ImagePlacement>): void {
    this.history.begin(label);
    this.history.snapshotImage(l);
    Object.assign(l, change);
    this.history.commit();
    this.emit('selection');
    this.requestFrame();
  }

  get activeLayer(): Layer | undefined {
    return findLayer(this.doc, this.activeLayerId);
  }

  setActiveLayer(id: string): void {
    this.activeLayerId = id;
    if (this.selection && this.selection.layerId !== id) this.select(null);
    this.emit('doc');
  }

  /**
   * Layer a tool should draw into: the active layer if it is the right kind and
   * editable, otherwise the top‑most suitable one (which becomes active).
   */
  targetLayer(kind: 'raster'): RasterLayer | null;
  targetLayer(kind: 'vector'): VectorLayer | null;
  targetLayer(kind: 'raster' | 'vector'): Layer | null {
    const ok = (l: Layer | undefined) => !!l && l.kind === kind && l.visible && !l.locked;
    let layer = this.activeLayer;
    if (!ok(layer)) {
      layer = [...this.doc.layers].reverse().find(ok);
      if (layer) {
        this.activeLayerId = layer.id;
        this.emit('doc');
      }
    }
    if (!layer) {
      this.setMessage(
        kind === 'raster'
          ? 'No visible, unlocked paint layer — add one in the Layers panel.'
          : 'No visible, unlocked shape layer — add one in the Layers panel.',
      );
      return null;
    }
    return layer;
  }

  // ---------------------------------------------------------------- selection
  select(sel: Selection | null): void {
    this.selection = sel;
    if (sel) this.region = null;
    this.emit('selection');
    this.requestFrame();
  }

  selected(): { layer: VectorLayer; feature: Feature } | null {
    const s = this.selection;
    if (!s) return null;
    const layer = findLayer(this.doc, s.layerId);
    if (!layer || layer.kind !== 'vector') return null;
    const feature = layer.features.find((f) => f.id === s.featureId);
    return feature ? { layer, feature } : null;
  }

  private validateSelection(): void {
    const sel = this.selected();
    if (this.selection && !sel) this.selection = null;
    else if (sel && this.selection!.point !== null && this.selection!.point >= sel.feature.points.length) {
      this.selection!.point = null;
    }
  }

  setRegion(r: PixelSelection | null): void {
    this.region = r;
    if (r) this.selection = null;
    this.emit('selection');
    this.requestFrame();
  }

  makePixelSelection(layerId: string, code: number, r: Region): PixelSelection {
    return { ...r, layerId, code, edges: regionEdges(r) };
  }

  /** Drop the pixel selection if its pixels were changed by something else (undo etc.). */
  private validateRegion(): void {
    const r = this.region;
    if (!r) return;
    const layer = findLayer(this.doc, r.layerId);
    let ok = !!layer && layer.kind === 'raster';
    if (ok && layer?.kind === 'raster') forEachPixel(r, this.doc.width, (i) => (ok &&= layer.pixels[i] === r.code));
    if (!ok) this.region = null;
  }

  private regionLayer(): RasterLayer | null {
    const l = this.region && findLayer(this.doc, this.region.layerId);
    return l && l.kind === 'raster' && !l.locked ? l : null;
  }

  /** Repaint the selected pixels with another surface. */
  recolorRegion(id: string): void {
    const r = this.region;
    const layer = this.regionLayer();
    const code = surfaceCode(id);
    if (!r || !layer || !code || code === r.code) return;
    this.history.begin('Recolor area');
    this.history.snapshotRaster(layer);
    forEachPixel(r, this.doc.width, (i) => (layer.pixels[i] = code));
    this.history.markRaster(layer, r.rect);
    r.code = code;
    this.history.commit();
    this.invalidate(r.rect);
    this.emit('selection');
  }

  eraseRegion(): void {
    const r = this.region;
    const layer = this.regionLayer();
    if (!r || !layer) return;
    this.history.begin('Erase area');
    this.history.snapshotRaster(layer);
    forEachPixel(r, this.doc.width, (i) => (layer.pixels[i] = 0));
    this.history.markRaster(layer, r.rect);
    this.region = null;
    this.history.commit();
    this.invalidate(r.rect);
  }

  /** Turn the selected painted area into an editable shape (one undo step). */
  regionToShape(): void {
    const r = this.region;
    const layer = this.regionLayer();
    if (!r || !layer) return;
    const vec = this.targetLayer('vector');
    if (!vec) return;
    const poly = traceOutline(r, 1.2);
    if (poly.length < 3) return this.setMessage('That area is too small to turn into a shape.');
    const surface = surfaceByCode(r.code)?.id ?? this.surface;
    const k = this.doc.yardsPerPixel;
    const f: Feature = { id: uid('F'), surface, smooth: poly.length > 12, points: poly.map((p) => ({ x: p.x * k, y: p.y * k })) };
    this.history.begin('Convert to shape');
    this.history.snapshotRaster(layer);
    this.history.snapshotVector(vec);
    forEachPixel(r, this.doc.width, (i) => (layer.pixels[i] = 0));
    this.history.markRaster(layer, r.rect);
    vec.features = [...vec.features, f];
    this.region = null;
    this.history.commit();
    this.invalidate(r.rect);
    this.invalidateFeature(f);
    this.activeLayerId = vec.id;
    this.setTool('select');
    this.select({ layerId: vec.id, featureId: f.id, point: null });
    this.emit('doc');
  }

  /** Top‑most editable feature under a world point. */
  hitFeature(world: Vec2): { layer: VectorLayer; feature: Feature } | null {
    const px = this.worldToPx(world);
    for (let i = this.doc.layers.length - 1; i >= 0; i--) {
      const layer = this.doc.layers[i];
      if (layer.kind !== 'vector' || !layer.visible || layer.locked) continue;
      const fs = sortedFeatures(layer);
      for (let j = fs.length - 1; j >= 0; j--) {
        if (featureContains(fs[j], px, this.doc.yardsPerPixel)) return { layer, feature: fs[j] };
      }
    }
    return null;
  }

  /** Surface visible at a world point (top‑most visible layer). */
  surfaceAt(world: Vec2): string {
    const px = this.worldToPx(world);
    const x = Math.floor(px.x);
    const y = Math.floor(px.y);
    if (x < 0 || y < 0 || x >= this.doc.width || y >= this.doc.height) return this.doc.background;
    for (let i = this.doc.layers.length - 1; i >= 0; i--) {
      const layer = this.doc.layers[i];
      if (!layer.visible || (layer.kind !== 'raster' && layer.kind !== 'vector')) continue;
      if (layer.kind === 'raster') {
        const c = layer.pixels[y * this.doc.width + x];
        if (c) return surfaceByCode(c)?.id ?? this.doc.background;
      } else {
        const fs = sortedFeatures(layer);
        for (let j = fs.length - 1; j >= 0; j--) {
          if (featureContains(fs[j], { x: x + 0.5, y: y + 0.5 }, this.doc.yardsPerPixel)) return fs[j].surface;
        }
      }
    }
    return this.doc.background;
  }

  // ---------------------------------------------------------------- tools & options
  registerTool(t: Tool): void {
    this.tools.set(t.id, t);
  }

  setTool(id: ToolId): void {
    const next = this.tools.get(id);
    if (!next || next === this.tool) return;
    this.tool?.cancel?.();
    if (this.tool && this.tool.id !== 'picker') this.previousTool = this.tool.id;
    this.tool = next;
    this.updateCursor();
    this.emit('tool', 'status');
    this.requestFrame();
  }

  setSurface(id: string, secondary = false): void {
    if (!surfaceById(id)) return;
    if (secondary) {
      this.surface2 = id;
      this.emit('surface');
      return;
    }
    this.surface = id;
    // With a painted area selected, picking a swatch repaints it.
    if (this.region && this.tool.id === 'wand') this.recolorRegion(id);
    // With the Select tool, picking a swatch recolors the selected shape.
    const sel = this.selected();
    if (this.tool.id === 'select' && sel && sel.feature.surface !== id) {
      this.history.begin('Change surface');
      this.history.snapshotVector(sel.layer);
      sel.feature.surface = id;
      this.invalidateFeature(sel.feature);
      this.history.commit();
    }
    this.emit('surface', 'selection');
  }

  swapSurfaces(): void {
    [this.surface, this.surface2] = [this.surface2, this.surface];
    this.emit('surface');
  }

  private appliedColors = '';

  /** Install the course's colors if they changed; re-render everything. */
  syncColors(): void {
    const key = JSON.stringify(this.doc.colors);
    if (key === this.appliedColors) return;
    this.appliedColors = key;
    applyColors(this.doc.colors);
    this.invalidate();
    this.emit('palette');
  }

  /**
   * Change course colors as one undo step. `null` resets a surface to its default.
   * Pass replace=true to start from an empty map (applying a theme).
   */
  setColors(changes: Record<string, SurfaceColors | null>, label: string, replace = false): void {
    this.history.begin(label);
    this.history.snapshotColors();
    const next: ColorMap = replace ? {} : { ...this.doc.colors };
    for (const [id, v] of Object.entries(changes)) {
      if (v) next[id] = v;
      else delete next[id];
    }
    this.doc.colors = next;
    this.history.commit();
    this.syncColors();
  }

  /** Live preview without recording history (dialogs call setColors to commit). */
  previewColors(map: ColorMap): void {
    this.doc.colors = map;
    this.syncColors();
  }

  setBrushSize(n: number): void {
    this.brushSize = Math.max(1, Math.min(40, Math.round(n)));
    this.emit('options');
    this.requestFrame();
  }

  // ---------------------------------------------------------------- commands
  undo(): void {
    this.tool.cancel?.();
    if (this.history.undo()) this.invalidate();
  }
  redo(): void {
    this.tool.cancel?.();
    if (this.history.redo()) this.invalidate();
  }

  deleteSelection(): void {
    if (this.region) return this.eraseRegion();
    const sel = this.selected();
    if (!sel) return;
    this.history.begin('Delete shape');
    this.history.snapshotVector(sel.layer);
    this.invalidateFeature(sel.feature);
    sel.layer.features = sel.layer.features.filter((f) => f !== sel.feature);
    this.history.commit();
    this.select(null);
  }

  duplicateSelection(): void {
    const sel = this.selected();
    if (!sel) return;
    const off = 10;
    const copy: Feature = {
      ...sel.feature,
      id: `${sel.feature.id}_c${Date.now().toString(36)}`,
      points: sel.feature.points.map((p) => ({ x: p.x + off, y: p.y + off })),
    };
    this.history.begin('Duplicate shape');
    this.history.snapshotVector(sel.layer);
    sel.layer.features = [...sel.layer.features, copy];
    this.history.commit();
    this.invalidateFeature(copy);
    this.select({ layerId: sel.layer.id, featureId: copy.id, point: null });
  }

  setSelectedSmooth(smooth: boolean): void {
    const sel = this.selected();
    if (!sel || sel.feature.smooth === smooth) return;
    this.history.begin(smooth ? 'Smooth shape' : 'Sharpen shape');
    this.history.snapshotVector(sel.layer);
    this.invalidateFeature(sel.feature);
    sel.feature.smooth = smooth;
    this.invalidateFeature(sel.feature);
    this.history.commit();
  }

  clearRuler(): void {
    this.ruler = { points: [], live: null, active: false };
    this.emit('status');
    this.requestFrame();
  }

  // ---------------------------------------------------------------- coordinates
  screenToPx(s: Vec2): Vec2 {
    const dx = (s.x - this.panX) / this.zoom;
    const dy = (s.y - this.panY) / this.zoom;
    return { x: dx * this.cos + dy * this.sin, y: -dx * this.sin + dy * this.cos };
  }
  pxToScreen(p: Vec2): Vec2 {
    return {
      x: (p.x * this.cos - p.y * this.sin) * this.zoom + this.panX,
      y: (p.x * this.sin + p.y * this.cos) * this.zoom + this.panY,
    };
  }
  worldToPx(w: Vec2): Vec2 {
    const k = this.doc.yardsPerPixel;
    return { x: w.x / k, y: w.y / k };
  }
  pxToWorld(p: Vec2): Vec2 {
    const k = this.doc.yardsPerPixel;
    return { x: p.x * k, y: p.y * k };
  }
  worldToScreen(w: Vec2): Vec2 {
    return this.pxToScreen(this.worldToPx(w));
  }

  // ---------------------------------------------------------------- view
  zoomAt(screen: Vec2, z: number): void {
    this.viewAt(screen, z, this.rotation);
  }

  /** Set zoom and rotation, keeping the course point under `screen` fixed. */
  viewAt(screen: Vec2, z: number, rotationDeg: number): void {
    z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
    const p = this.screenToPx(screen);
    this.zoom = z;
    this.setRotationValue(rotationDeg);
    this.panX = screen.x - (p.x * this.cos - p.y * this.sin) * z;
    this.panY = screen.y - (p.x * this.sin + p.y * this.cos) * z;
    this.emit('view');
    this.requestFrame();
  }

  /** View rotation in degrees (clockwise). Only the view turns — the course does not. */
  rotation = 0;
  private cos = 1;
  private sin = 0;
  private setRotationValue(deg: number): void {
    let d = ((deg % 360) + 360) % 360;
    if (d > 180) d -= 360;
    if (Math.abs(d) < 1e-9) d = 0;
    this.rotation = d;
    const r = (d * Math.PI) / 180;
    this.cos = Math.cos(r);
    this.sin = Math.sin(r);
    if (Math.abs(this.cos) < 1e-12) this.cos = 0;
    if (Math.abs(this.sin) < 1e-12) this.sin = 0;
  }

  /** Rotate the view about the middle of the window. */
  rotateView(deg: number, at?: Vec2): void {
    this.viewAt(at ?? { x: this.cssW / 2, y: this.cssH / 2 }, this.zoom, deg);
  }

  /** Turn the view so the selected hole plays straight up the screen. */
  pointHoleUp(): void {
    const h = this.selectedHole();
    if (!h || h.points.length < 2) return this.setMessage('Select a hole first (Hole tool or the Scorecard).');
    const a = h.points[0];
    const b = h.points[h.points.length - 1];
    const ang = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    const mid = this.worldToScreen({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    this.viewAt(mid, this.zoom, -90 - ang);
    this.centerOn({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }

  zoomStep(dir: 1 | -1, at?: Vec2): void {
    const steps = [0.1, 0.125, 0.25, 0.33, 0.5, 0.67, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 40];
    const cur = this.zoom;
    const next =
      dir > 0 ? steps.find((s) => s > cur * 1.01) ?? ZOOM_MAX : [...steps].reverse().find((s) => s < cur / 1.01) ?? ZOOM_MIN;
    this.zoomAt(at ?? { x: this.cssW / 2, y: this.cssH / 2 }, next);
  }

  fit(): void {
    if (!this.doc || !this.cssW) return;
    const W = this.doc.width;
    const H = this.doc.height;
    const ex = Math.abs(W * this.cos) + Math.abs(H * this.sin);
    const ey = Math.abs(W * this.sin) + Math.abs(H * this.cos);
    const z = Math.min((this.cssW - 40) / ex, (this.cssH - 40) / ey);
    this.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
    const cx = W / 2;
    const cy = H / 2;
    this.panX = Math.round(this.cssW / 2 - (cx * this.cos - cy * this.sin) * this.zoom);
    this.panY = Math.round(this.cssH / 2 - (cx * this.sin + cy * this.cos) * this.zoom);
    this.emit('view');
    this.requestFrame();
  }

  actualSize(): void {
    this.zoomAt({ x: this.cssW / 2, y: this.cssH / 2 }, 1);
  }

  // ---------------------------------------------------------------- rendering
  /** Mark doc pixels for re‑render (whole doc if no rect). */
  invalidate(r?: Rect | null): void {
    if (!this.doc) return;
    const full = { x: 0, y: 0, w: this.doc.width, h: this.doc.height };
    const pr = r ? pixelRect(r, 0, this.doc.width, this.doc.height) : full;
    if (pr) this.dirty = rectUnion(this.dirty, pr);
    this.requestFrame();
  }

  invalidateFeature(f: Feature): void {
    const { bbox } = flatten(f, this.doc.yardsPerPixel);
    this.invalidate({ x: bbox.x - 2, y: bbox.y - 2, w: bbox.w + 4, h: bbox.h + 4 });
  }

  requestFrame(): void {
    if (this.frameRequested) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      this.draw();
    });
  }

  /** Re‑render pending dirty pixels right now (used by export). */
  flushRender(): void {
    if (!this.dirty) return;
    const r = this.dirty;
    this.dirty = null;
    const data = renderRegion(this.doc, r);
    this.docCtx.putImageData(new ImageData(new Uint8ClampedArray(data.buffer), r.w, r.h), r.x, r.y);
  }

  private draw(): void {
    this.flushRender();
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    const W = this.doc.width;
    const H = this.doc.height;
    const ypp = this.doc.yardsPerPixel;
    const images = this.doc.layers.filter((l): l is ImageLayer => l.kind === 'image' && l.visible);
    const geo = this.doc.geo;
    const maps = geo ? this.doc.layers.filter((l): l is MapLayer => l.kind === 'map' && l.visible) : [];

    // Everything that belongs to the course is drawn in doc‑pixel space under the view
    // transform (pan · rotate · zoom), so map, underlays and paint turn together.
    ctx.save();
    this.applyView(ctx);
    const inPx = (w: Vec2) => ({ x: w.x / ypp, y: w.y / ypp });
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(3 / this.zoom, 3 / this.zoom, W, H);
    ctx.fillStyle = rgbCss(surfaceColor(this.doc.background));
    ctx.fillRect(0, 0, W, H);
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();
    for (const l of this.doc.layers) {
      if (!l.visible) continue;
      if (l.kind === 'map' && geo) {
        drawMap(ctx, {
          geo,
          source: l.source,
          opacity: l.opacity,
          toScreen: inPx,
          unitsPerYard: 1 / ypp,
          view: this.visibleWorld(),
          dpr: this.dpr * this.zoom,
          seam: 0.6 / this.zoom,
          onLoad: () => this.requestFrame(),
        });
      } else if (l.kind === 'image' && !l.above) drawUnderlay(ctx, l, inPx, 1 / ypp, () => this.requestFrame());
    }
    ctx.imageSmoothingEnabled = this.zoom < 1;
    ctx.imageSmoothingQuality = 'medium';
    ctx.drawImage(this.docCanvas, 0, 0, W, H);
    for (const l of images) if (l.above) drawUnderlay(ctx, l, inPx, 1 / ypp, () => this.requestFrame());
    const tl = this.terrainLayer();
    if (tl?.visible && this.doc.terrain) {
      drawTerrain(ctx, this.doc.terrain, tl, ypp, 1 / this.zoom, this.pointerDown && this.tool.id === 'terrain');
    }
    if (this.pixelGridZoom && this.zoom >= this.pixelGridZoom) this.drawGrid(1, 'rgba(0,0,0,0.12)');
    if (this.showYardGrid) this.drawGrid(this.yardGridSize / ypp, 'rgba(0,0,0,0.35)');
    ctx.restore();
    if (this.showYardGrid) this.drawGridLabels(this.yardGridSize / ypp);

    const toScreen = (w: Vec2) => this.worldToScreen(w);
    const upy = this.zoom / ypp;

    if (this.showHoles)
      drawHoles(ctx, this.doc.holes, {
        toScreen,
        unitsPerYard: upy,
        selectedId: this.selectedHoleId,
        arcsFromTee: this.arcsFromTee,
        arcsToGreen: this.arcsToGreen,
        handles: this.tool.id === 'hole',
        elevation: this.doc.terrain ? (w) => this.elevationAt(w) : undefined,
      });
    const img = this.activeImage();
    if (img && (this.tool.id === 'underlay' || this.tool.id === 'scale' || this.activeLayer === img)) {
      drawUnderlayFrame(ctx, img, toScreen);
    }

    this.drawSelection(ctx);
    this.drawRegion(ctx);
    this.drawRuler(ctx);
    this.tool.overlay?.(ctx);
    this.drawDocHandles(ctx);
    const credits = maps.map((m) => MAP_SOURCES[m.source].attribution);
    if (tl?.visible && this.doc.terrain?.source === 'usgs') credits.push(ELEVATION_ATTRIBUTION);
    if (credits.length) drawAttribution(ctx, [...new Set(credits)].join(' · '), this.cssW, this.cssH);
  }

  setYardGrid(size: 0 | 25 | 50 | 100): void {
    this.showYardGrid = size > 0;
    if (size) this.yardGridSize = size;
    this.saveViewPrefs();
    this.requestFrame();
  }

  toggleYardGrid(): void {
    this.setYardGrid(this.showYardGrid ? 0 : this.yardGridSize);
  }

  setHoleView(change: Partial<Pick<Editor, 'showHoles' | 'arcsFromTee' | 'arcsToGreen'>>): void {
    Object.assign(this, change);
    this.saveViewPrefs();
    this.requestFrame();
  }

  setPixelGridZoom(z: number): void {
    this.pixelGridZoom = z;
    this.saveViewPrefs();
    this.requestFrame();
  }

  private loadViewPrefs(): void {
    try {
      const p = JSON.parse(localStorage.getItem('fairway-view') ?? '{}');
      if (typeof p.showYardGrid === 'boolean') this.showYardGrid = p.showYardGrid;
      if ([25, 50, 100].includes(p.yardGridSize)) this.yardGridSize = p.yardGridSize;
      if (typeof p.pixelGridZoom === 'number') this.pixelGridZoom = p.pixelGridZoom;
      for (const k of ['showHoles', 'arcsFromTee', 'arcsToGreen'] as const) if (typeof p[k] === 'boolean') this[k] = p[k];
    } catch {
      /* storage unavailable — use defaults */
    }
  }

  private saveViewPrefs(): void {
    try {
      const { showYardGrid, yardGridSize, pixelGridZoom, showHoles, arcsFromTee, arcsToGreen } = this;
      localStorage.setItem(
        'fairway-view',
        JSON.stringify({ showYardGrid, yardGridSize, pixelGridZoom, showHoles, arcsFromTee, arcsToGreen }),
      );
    } catch {
      /* ignore */
    }
  }

  /** Pan · rotate · zoom (· device pixel ratio): doc pixels → canvas. */
  private applyView(ctx: CanvasRenderingContext2D): void {
    const d = this.dpr;
    const z = this.zoom;
    // Snap the origin to device pixels when unrotated so pixel art stays crisp.
    const e = this.rotation === 0 ? Math.round(this.panX * d) : this.panX * d;
    const f = this.rotation === 0 ? Math.round(this.panY * d) : this.panY * d;
    ctx.setTransform(d * z * this.cos, d * z * this.sin, -d * z * this.sin, d * z * this.cos, e, f);
  }

  /** Visible doc‑pixel bounds (clipped to the doc). */
  private visiblePx(): { x0: number; y0: number; x1: number; y1: number } {
    const pts = [
      { x: 0, y: 0 },
      { x: this.cssW, y: 0 },
      { x: this.cssW, y: this.cssH },
      { x: 0, y: this.cssH },
    ].map((s) => this.screenToPx(s));
    return {
      x0: Math.max(0, Math.min(...pts.map((p) => p.x))),
      y0: Math.max(0, Math.min(...pts.map((p) => p.y))),
      x1: Math.min(this.doc.width, Math.max(...pts.map((p) => p.x))),
      y1: Math.min(this.doc.height, Math.max(...pts.map((p) => p.y))),
    };
  }

  /** Grid lines in doc‑pixel space (call with the view transform applied). */
  private drawGrid(stepPx: number, color: string): void {
    const ctx = this.ctx;
    const v = this.visiblePx();
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1 / this.zoom;
    ctx.beginPath();
    for (let gx = Math.ceil(v.x0 / stepPx) * stepPx; gx <= v.x1; gx += stepPx) {
      ctx.moveTo(gx, v.y0);
      ctx.lineTo(gx, v.y1);
    }
    for (let gy = Math.ceil(v.y0 / stepPx) * stepPx; gy <= v.y1; gy += stepPx) {
      ctx.moveTo(v.x0, gy);
      ctx.lineTo(v.x1, gy);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Yard labels along the course's top edge (screen space, so text stays upright). */
  private drawGridLabels(stepPx: number): void {
    if (stepPx * this.zoom <= 40) return;
    const ctx = this.ctx;
    const v = this.visiblePx();
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.font = '10px system-ui, sans-serif';
    for (let gx = Math.ceil(v.x0 / stepPx) * stepPx; gx <= v.x1; gx += stepPx) {
      const s = this.pxToScreen({ x: gx, y: v.y0 });
      ctx.fillText(`${Math.round(gx * this.doc.yardsPerPixel)}`, s.x + 2, s.y + 10);
    }
    ctx.restore();
  }

  private drawSelection(ctx: CanvasRenderingContext2D): void {
    const sel = this.selected();
    if (!sel) return;
    const { flat } = flatten(sel.feature, this.doc.yardsPerPixel);
    ctx.save();
    ctx.beginPath();
    flat.poly.forEach((p, i) => {
      const s = this.pxToScreen(p);
      if (i) ctx.lineTo(s.x, s.y);
      else ctx.moveTo(s.x, s.y);
    });
    ctx.closePath();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#000';
    ctx.stroke();
    ctx.setLineDash([]);
    const showHandles = ['select', 'freehand', 'polygon'].includes(this.tool.id);
    if (showHandles) {
      sel.feature.points.forEach((p, i) => {
        const s = this.worldToScreen(p);
        const r = 3.5;
        ctx.fillStyle = this.selection?.point === i ? '#0a64ff' : '#fff';
        ctx.strokeStyle = '#000';
        ctx.fillRect(Math.round(s.x - r), Math.round(s.y - r), r * 2, r * 2);
        ctx.strokeRect(Math.round(s.x - r) + 0.5, Math.round(s.y - r) + 0.5, r * 2 - 1, r * 2 - 1);
      });
    }
    ctx.restore();
  }

  private drawRegion(ctx: CanvasRenderingContext2D): void {
    const r = this.region;
    if (!r) return;
    ctx.save();
    ctx.beginPath();
    for (const [x0, y0, x1, y1] of r.edges) {
      const a = this.pxToScreen({ x: x0, y: y0 });
      const b = this.pxToScreen({ x: x1, y: y1 });
      ctx.moveTo(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5);
      ctx.lineTo(Math.round(b.x) + 0.5, Math.round(b.y) + 0.5);
    }
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = '#000';
    ctx.stroke();
    ctx.restore();
  }

  private drawRuler(ctx: CanvasRenderingContext2D): void {
    const pts = [...this.ruler.points];
    if (this.ruler.active && this.ruler.live) pts.push(this.ruler.live);
    if (!pts.length) return;
    const scr = pts.map((p) => this.worldToScreen(p));
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    scr.forEach((s, i) => (i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y)));
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = '#ffeb3b';
    ctx.lineWidth = 2;
    ctx.stroke();
    for (const s of scr) {
      ctx.beginPath();
      ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#000';
      ctx.stroke();
    }
    ctx.font = 'bold 11px system-ui, sans-serif';
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = dist(pts[i - 1], pts[i]);
      total += d;
      if (pts.length > 2 && (scr[i].x - scr[i - 1].x) ** 2 + (scr[i].y - scr[i - 1].y) ** 2 > 50 * 50) {
        this.label(ctx, `${Math.round(d)}`, (scr[i - 1].x + scr[i].x) / 2, (scr[i - 1].y + scr[i].y) / 2, false);
      }
    }
    if (pts.length > 1) {
      const last = scr[scr.length - 1];
      this.label(ctx, `${Math.round(total)} yd`, last.x + 10, last.y - 12, true);
    }
    ctx.restore();
  }

  private label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, strong: boolean): void {
    const w = ctx.measureText(text).width + 8;
    ctx.fillStyle = strong ? '#000' : 'rgba(255,255,255,0.9)';
    ctx.fillRect(Math.round(x - (strong ? 0 : w / 2)), Math.round(y - 8), w, 16);
    ctx.fillStyle = strong ? '#fff' : '#000';
    ctx.fillText(text, Math.round(x - (strong ? 0 : w / 2) + 4), Math.round(y + 4));
  }

  // ---------------------------------------------------------------- input
  updateCursor(): void {
    this.canvas.style.cursor = this.panning ? 'grabbing' : this.spaceHeld ? 'grab' : this.tool?.cursor ?? 'default';
  }

  private info(e: PointerEvent | MouseEvent, clicks = 1): PointerInfo {
    const r = this.canvas.getBoundingClientRect();
    const screen = { x: e.clientX - r.left, y: e.clientY - r.top };
    const px = this.screenToPx(screen);
    return {
      screen,
      px,
      world: this.pxToWorld(px),
      button: e.button,
      shift: e.shiftKey,
      alt: e.altKey,
      meta: e.metaKey || e.ctrlKey,
      clicks,
      pressure: 'pressure' in e ? (e as PointerEvent).pressure : 0.5,
    };
  }

  private bindEvents(): void {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      c.focus();
      if (e.button === 1 || this.spaceHeld || this.tool.id === 'hand') {
        this.panning = { x: e.clientX, y: e.clientY, px: this.panX, py: this.panY };
        this.updateCursor();
        return;
      }
      if (e.button === 0) {
        const hh = this.hitDocHandle({ x: e.clientX - c.getBoundingClientRect().left, y: e.clientY - c.getBoundingClientRect().top });
        if (hh) {
          this.resizeDrag = { handle: hh, rect: { x: 0, y: 0, w: this.doc.width, h: this.doc.height } };
          return;
        }
      }
      let button = e.button;
      if (button === 0 && e.ctrlKey && this.tool.secondaryButton) button = 2; // ⌃‑click on a Mac
      if (button !== 0 && !(button === 2 && this.tool.secondaryButton)) return;
      const now = performance.now();
      const lc = this.lastClick;
      const n = now - lc.t < 400 && Math.hypot(e.clientX - lc.x, e.clientY - lc.y) < 6 ? lc.n + 1 : 1;
      this.lastClick = { t: now, x: e.clientX, y: e.clientY, n };
      this.pointerDown = true;
      this.tool.down?.({ ...this.info(e, n), button });
      this.requestFrame();
    });

    c.addEventListener('pointermove', (e) => {
      if (this.panning) {
        this.panX = this.panning.px + e.clientX - this.panning.x;
        this.panY = this.panning.py + e.clientY - this.panning.y;
        this.emit('view');
        this.requestFrame();
        return;
      }
      const info = this.info(e);
      this.hover = info;
      if (this.resizeDrag) {
        this.dragResize(info.px);
        this.requestFrame();
        return;
      }
      this.tool.move?.(info, this.pointerDown);
      if (!this.pointerDown) {
        const hh = this.hitDocHandle(info.screen);
        if (hh) {
          this.canvas.style.cursor = HANDLE_CURSORS[hh];
          this.handleHover = true;
        } else if (this.handleHover) {
          this.handleHover = false;
          this.updateCursor();
        }
      }
      this.emit('status');
      this.requestFrame();
    });

    const end = (e: PointerEvent) => {
      if (this.panning) {
        this.panning = null;
        this.updateCursor();
        return;
      }
      if (this.resizeDrag) {
        const r = this.resizeDrag.rect;
        this.resizeDrag = null;
        if (r.x !== 0 || r.y !== 0 || r.w !== this.doc.width || r.h !== this.doc.height) this.resizeCourse(r);
        this.requestFrame();
        return;
      }
      if (!this.pointerDown) return;
      this.pointerDown = false;
      this.tool.up?.(this.info(e));
      this.requestFrame();
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('pointerleave', () => {
      if (!this.pointerDown) {
        this.hover = null;
        this.emit('status');
        this.requestFrame();
      }
    });

    c.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const k = e.deltaMode === 1 ? 16 : 1;
        const r = c.getBoundingClientRect();
        const at = { x: e.clientX - r.left, y: e.clientY - r.top };
        if (e.ctrlKey || e.metaKey) {
          // trackpad pinch (Chrome) or ⌘+scroll
          this.zoomAt(at, this.zoom * Math.exp(-e.deltaY * k * 0.01));
        } else {
          this.panX -= e.deltaX * k;
          this.panY -= e.deltaY * k;
          this.emit('view');
          this.requestFrame();
        }
      },
      { passive: false },
    );

    // Safari trackpad pinch
    let gestureZoom = 1;
    let gestureRot = 0;
    c.addEventListener('gesturestart', (e) => {
      e.preventDefault();
      gestureZoom = this.zoom;
      gestureRot = this.rotation;
    });
    c.addEventListener('gesturechange', (e) => {
      e.preventDefault();
      const ge = e as unknown as { scale: number; rotation: number; clientX: number; clientY: number };
      const r = c.getBoundingClientRect();
      // Trackpad pinch zooms; two‑finger twist rotates (Safari).
      this.viewAt({ x: ge.clientX - r.left, y: ge.clientY - r.top }, gestureZoom * ge.scale, gestureRot + (ge.rotation || 0));
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && !isTyping(e)) {
        if (!this.spaceHeld) {
          this.spaceHeld = true;
          this.updateCursor();
        }
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.spaceHeld = false;
        this.updateCursor();
      }
    });

    new ResizeObserver(() => this.resize()).observe(c.parentElement!);
  }

  // ---------------------------------------------------------------- course area resize
  private resizeDrag: { handle: DocHandle; rect: Rect } | null = null;
  private handleHover = false;

  /** Change the course area. `rect` is in current doc pixels (x/y may be negative). */
  resizeCourse(rect: Rect): boolean {
    this.tool.cancel?.();
    this.history.begin('Resize course area');
    this.history.snapshotDoc();
    try {
      resizeDoc(this.doc, rect, MAX_DOC_PIXELS);
    } catch (err) {
      this.history.abort();
      this.setMessage((err as Error).message);
      return false;
    }
    this.history.commit();
    // Keep the content where it was on screen.
    this.panX += Math.round(rect.x) * this.zoom;
    this.panY += Math.round(rect.y) * this.zoom;
    this.region = null;
    this.clearRuler();
    this.syncCanvasSize();
    const k = this.doc.yardsPerPixel;
    this.setMessage(`Course area is now ${Math.round(this.doc.width * k)} × ${Math.round(this.doc.height * k)} yd.`);
    this.emit('doc', 'view', 'selection', 'holes');
    return true;
  }

  /** Make the course area exactly the part of the course visible in the window. */
  fitAreaToView(): boolean {
    const v = this.visibleWorld();
    const k = this.doc.yardsPerPixel;
    return this.resizeCourse({ x: v.x / k, y: v.y / k, w: v.w / k, h: v.h / k });
  }

  /** After undo/redo of a resize the offscreen canvas must match the doc. */
  private syncCanvasSize(): void {
    if (this.docCanvas.width === this.doc.width && this.docCanvas.height === this.doc.height) return;
    this.docCanvas.width = this.doc.width;
    this.docCanvas.height = this.doc.height;
    this.dirty = null;
    this.invalidate();
  }

  private docHandles(): [DocHandle, Vec2][] {
    const W = this.doc.width;
    const H = this.doc.height;
    const o = 5 / this.zoom; // 5 screen px outside the edge
    const at = (x: number, y: number) => this.pxToScreen({ x, y });
    return [
      ['nw', at(-o, -o)],
      ['n', at(W / 2, -o)],
      ['ne', at(W + o, -o)],
      ['e', at(W + o, H / 2)],
      ['se', at(W + o, H + o)],
      ['s', at(W / 2, H + o)],
      ['sw', at(-o, H + o)],
      ['w', at(-o, H / 2)],
    ];
  }

  private hitDocHandle(s: Vec2): DocHandle | null {
    if (this.spaceHeld || this.tool.id === 'hand') return null;
    for (const [hnd, p] of this.docHandles()) if (Math.abs(p.x - s.x) <= 6 && Math.abs(p.y - s.y) <= 6) return hnd;
    return null;
  }

  private dragResize(p: Vec2): void {
    const d = this.resizeDrag!;
    const W = this.doc.width;
    const H = this.doc.height;
    const r = { x: 0, y: 0, w: W, h: H };
    const px = Math.round(p.x);
    const py = Math.round(p.y);
    if (d.handle.includes('w')) {
      r.x = Math.min(px, W - MIN_SIDE_PX);
      r.w = W - r.x;
    }
    if (d.handle.includes('e')) r.w = Math.max(MIN_SIDE_PX, px);
    if (d.handle.includes('n')) {
      r.y = Math.min(py, H - MIN_SIDE_PX);
      r.h = H - r.y;
    }
    if (d.handle.includes('s')) r.h = Math.max(MIN_SIDE_PX, py);
    d.rect = r;
  }

  private drawDocHandles(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    for (const [, p] of this.docHandles()) {
      ctx.fillStyle = '#000080';
      ctx.fillRect(Math.round(p.x - 3), Math.round(p.y - 3), 6, 6);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(p.x - 3) - 0.5, Math.round(p.y - 3) - 0.5, 7, 7);
    }
    const d = this.resizeDrag;
    if (d) {
      const r = d.rect;
      const c = [
        { x: r.x, y: r.y },
        { x: r.x + r.w, y: r.y },
        { x: r.x + r.w, y: r.y + r.h },
        { x: r.x, y: r.y + r.h },
      ].map((p) => this.pxToScreen(p));
      ctx.beginPath();
      c.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
      const k = this.doc.yardsPerPixel;
      const text = `${Math.round(r.w * k)} × ${Math.round(r.h * k)} yd`;
      ctx.font = 'bold 11px system-ui, sans-serif';
      const tw = ctx.measureText(text).width + 8;
      const at = c[2];
      ctx.fillStyle = '#000';
      ctx.fillRect(Math.round(at.x - tw), Math.round(at.y + 8), tw, 16);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, Math.round(at.x - tw + 4), Math.round(at.y + 20));
    }
    ctx.restore();
  }

  private resize(): void {
    const host = this.canvas.parentElement!;
    const first = this.cssW === 0;
    this.dpr = window.devicePixelRatio || 1;
    this.cssW = host.clientWidth;
    this.cssH = host.clientHeight;
    this.canvas.width = Math.round(this.cssW * this.dpr);
    this.canvas.height = Math.round(this.cssH * this.dpr);
    this.canvas.style.width = `${this.cssW}px`;
    this.canvas.style.height = `${this.cssH}px`;
    if (first && this.doc) this.fit();
    this.requestFrame();
  }
}

export function isTyping(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

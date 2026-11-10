import { dedupe, dist, pathLength, simplifyClosed } from '../geom/geom';
import { suggestPar, uid } from '../model/doc';
import { rgbCss, surfaceCode, surfaceColor } from '../model/surfaces';
import type { Feature, ImageLayer, RasterLayer, Rect, Vec2, VectorLayer } from '../model/types';
import { dialog, field } from '../ui/ui';
import { worldToLatLon, type GeoRef } from '../geo/geo';
import { createTerrain, dab, heightAtPx, type BrushMode } from '../terrain/terrain';
import { drawPlayLine } from './holes';
import { flatten, visibleCodes } from '../render/raster';
import { floodRegion, forEachPixel } from '../render/regions';
import type { Editor, PointerInfo, Tool } from './editor';

const HANDLE_RADIUS = 7; // screen px

// =====================================================================
// Shape editing (shared by Select and the shape tools)
// =====================================================================

/** Index of the selected shape's control point under the cursor, or -1. */
function hitHandle(ed: Editor, screen: Vec2): number {
  const sel = ed.selected();
  if (!sel) return -1;
  let best = -1;
  let bestD = HANDLE_RADIUS;
  sel.feature.points.forEach((p, i) => {
    const d = dist(ed.worldToScreen(p), screen);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** Nearest point on the rendered outline, and which control span it belongs to. */
function nearestOnOutline(ed: Editor, f: Feature, screen: Vec2): { span: number; world: Vec2; d: number } {
  const { flat } = flatten(f, ed.doc.yardsPerPixel);
  let best = { span: 0, world: f.points[0], d: Infinity };
  const n = flat.poly.length;
  for (let i = 0; i < n; i++) {
    const a = ed.pxToScreen(flat.poly[i]);
    const b = ed.pxToScreen(flat.poly[(i + 1) % n]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((screen.x - a.x) * dx + (screen.y - a.y) * dy) / l2)) : 0;
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    const d = dist(q, screen);
    if (d < best.d) {
      best = { span: flat.span[i], world: ed.pxToWorld(ed.screenToPx(q)), d };
    }
  }
  return best;
}

type DragMode =
  | { kind: 'point'; index: number }
  | { kind: 'move'; start: Vec2; orig: Vec2[] }
  | null;

/** Point/shape dragging, insertion and deletion on the selected shape. */
class ShapeEditor {
  drag: DragMode = null;
  private moved = false;

  constructor(private ed: Editor) {}

  /** Try to start editing at the pointer. Returns true if it took the event. */
  down(e: PointerInfo, allowSelectOther: boolean): boolean {
    const ed = this.ed;
    const sel = ed.selected();
    const h = hitHandle(ed, e.screen);
    if (sel && h >= 0) {
      if (e.alt) {
        this.deletePoint(h);
        return true;
      }
      ed.selection!.point = h;
      ed.emit('selection');
      ed.history.begin('Move point');
      ed.history.snapshotVector(sel.layer);
      this.drag = { kind: 'point', index: h };
      this.moved = false;
      return true;
    }
    // Double‑click on/near the outline of the selected shape inserts a point.
    if (sel && e.clicks >= 2) {
      const near = nearestOnOutline(ed, sel.feature, e.screen);
      if (near.d <= HANDLE_RADIUS * 1.5) {
        ed.history.begin('Add point');
        ed.history.snapshotVector(sel.layer);
        const pts = sel.feature.points.slice();
        pts.splice(near.span + 1, 0, near.world);
        sel.feature.points = pts;
        ed.invalidateFeature(sel.feature);
        ed.selection!.point = near.span + 1;
        ed.emit('selection');
        this.drag = { kind: 'point', index: near.span + 1 };
        this.moved = true;
        return true;
      }
    }
    if (!allowSelectOther) return false;
    const hit = ed.hitFeature(e.world);
    if (hit) {
      if (ed.activeLayerId !== hit.layer.id) ed.setActiveLayer(hit.layer.id);
      ed.select({ layerId: hit.layer.id, featureId: hit.feature.id, point: null });
      ed.history.begin('Move shape');
      ed.history.snapshotVector(hit.layer);
      this.drag = { kind: 'move', start: e.world, orig: hit.feature.points };
      this.moved = false;
      return true;
    }
    return false;
  }

  move(e: PointerInfo): void {
    const sel = this.ed.selected();
    if (!this.drag || !sel) return;
    const f = sel.feature;
    this.ed.invalidateFeature(f);
    if (this.drag.kind === 'point') {
      const pts = f.points.slice();
      pts[this.drag.index] = clampWorld(this.ed, e.world);
      f.points = pts;
    } else {
      const dx = e.world.x - this.drag.start.x;
      const dy = e.world.y - this.drag.start.y;
      f.points = this.drag.orig.map((p) => ({ x: p.x + dx, y: p.y + dy }));
    }
    this.moved = true;
    this.ed.invalidateFeature(f);
    this.ed.emit('selection');
  }

  up(): void {
    if (!this.drag) return;
    this.drag = null;
    if (this.moved) this.ed.history.commit();
    else this.ed.history.abort();
  }

  cancel(): void {
    if (!this.drag) return;
    this.drag = null;
    this.ed.history.abort();
    this.ed.invalidate();
  }

  deletePoint(i: number): void {
    const sel = this.ed.selected();
    if (!sel) return;
    if (sel.feature.points.length <= 3) {
      this.ed.deleteSelection();
      return;
    }
    this.ed.history.begin('Delete point');
    this.ed.history.snapshotVector(sel.layer);
    this.ed.invalidateFeature(sel.feature);
    sel.feature.points = sel.feature.points.filter((_, k) => k !== i);
    this.ed.invalidateFeature(sel.feature);
    this.ed.history.commit();
    this.ed.selection!.point = null;
    this.ed.emit('selection');
  }

  nudge(dx: number, dy: number): void {
    const sel = this.ed.selected();
    if (!sel) return;
    const k = this.ed.doc.yardsPerPixel;
    this.ed.history.begin('Nudge');
    this.ed.history.snapshotVector(sel.layer);
    this.ed.invalidateFeature(sel.feature);
    const pi = this.ed.selection!.point;
    sel.feature.points = sel.feature.points.map((p, i) =>
      pi === null || pi === i ? { x: p.x + dx * k, y: p.y + dy * k } : p,
    );
    this.ed.invalidateFeature(sel.feature);
    this.ed.history.commit();
  }

  /** Shared keys for tools that show handles. */
  keydown(e: KeyboardEvent): boolean {
    const sel = this.ed.selection;
    if (!sel) return false;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (sel.point !== null) this.deletePoint(sel.point);
      else this.ed.deleteSelection();
      return true;
    }
    const step = e.shiftKey ? 10 : 1;
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (arrows[e.key]) {
      this.nudge(...arrows[e.key]);
      return true;
    }
    return false;
  }
}

function clampWorld(ed: Editor, w: Vec2): Vec2 {
  const k = ed.doc.yardsPerPixel;
  return {
    x: Math.max(0, Math.min(ed.doc.width * k, w.x)),
    y: Math.max(0, Math.min(ed.doc.height * k, w.y)),
  };
}

function addFeature(ed: Editor, layer: VectorLayer, f: Feature, label: string): void {
  ed.history.begin(label);
  ed.history.snapshotVector(layer);
  layer.features = [...layer.features, f];
  ed.history.commit();
  ed.invalidateFeature(f);
  ed.select({ layerId: layer.id, featureId: f.id, point: null });
}

// =====================================================================
// Tools
// =====================================================================

export class SelectTool implements Tool {
  id = 'select' as const;
  name = 'Select / Edit points';
  key = 'v';
  cursor = 'default';
  hint = 'Click a shape to select · drag to move · drag a point to reshape · double‑click outline to add a point · ⌥‑click point or ⌫ to delete';
  readonly edit: ShapeEditor;

  constructor(private ed: Editor) {
    this.edit = new ShapeEditor(ed);
  }

  down(e: PointerInfo): void {
    if (!this.edit.down(e, true)) this.ed.select(null);
  }
  move(e: PointerInfo, dragging: boolean): void {
    if (dragging) this.edit.move(e);
    else this.ed.canvas.style.cursor = hitHandle(this.ed, e.screen) >= 0 ? 'move' : 'default';
  }
  up(): void {
    this.edit.up();
  }
  cancel(): void {
    this.edit.cancel();
  }
  keydown(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' && this.ed.selection) {
      this.ed.select(null);
      return true;
    }
    return this.edit.keydown(e);
  }
}

/** Draw a loop freehand → it becomes an editable, smooth shape. */
export class FreehandShapeTool implements Tool {
  id = 'freehand' as const;
  name = 'Freehand shape';
  key = 'f';
  cursor = 'crosshair';
  hint = 'Draw a closed loop to make a shape (fairway, green, bunker…) · hold ⌘ to drag points / move shapes · V switches to Select';
  private pts: Vec2[] | null = null;
  private edit: ShapeEditor;

  constructor(private ed: Editor) {
    this.edit = new ShapeEditor(ed);
  }

  down(e: PointerInfo): void {
    // ⌘ temporarily turns the shape tools into Select, so plain drags always draw.
    if (e.meta && this.edit.down(e, true)) return;
    if (!this.ed.targetLayer('vector')) return;
    this.pts = [e.world];
  }
  move(e: PointerInfo, dragging: boolean): void {
    if (this.edit.drag) return this.edit.move(e);
    if (!dragging || !this.pts) return;
    const last = this.pts[this.pts.length - 1];
    if (dist(this.ed.worldToScreen(last), e.screen) >= 1) this.pts.push(clampWorld(this.ed, e.world));
  }
  up(): void {
    if (this.edit.drag) return this.edit.up();
    const pts = this.pts;
    this.pts = null;
    if (!pts) return;
    const ed = this.ed;
    const k = ed.doc.yardsPerPixel;
    if (pts.length < 3 || pathLength(pts) < (6 / ed.zoom) * k) {
      // A click (not a loop) on a shape selects it — handy without switching tools.
      const hit = ed.hitFeature(pts[0]);
      ed.select(hit ? { layerId: hit.layer.id, featureId: hit.feature.id, point: null } : null);
      return;
    }
    const eps = Math.max(0.75 * k, (2.5 / ed.zoom) * k);
    const simplified = simplifyClosed(dedupe(pts, eps / 2), eps);
    if (simplified.length < 3) return;
    const layer = ed.targetLayer('vector');
    if (!layer) return;
    addFeature(ed, layer, { id: uid('F'), surface: ed.surface, points: simplified, smooth: ed.smoothShapes }, 'Draw shape');
  }
  cancel(): void {
    this.pts = null;
    this.edit.cancel();
  }
  keydown(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' && this.pts) {
      this.pts = null;
      return true;
    }
    return this.edit.keydown(e);
  }
  overlay(ctx: CanvasRenderingContext2D): void {
    if (!this.pts || this.pts.length < 2) return;
    const scr = this.pts.map((p) => this.ed.worldToScreen(p));
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    scr.forEach((s, i) => (i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y)));
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = rgbCss(surfaceColor(this.ed.surface));
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(scr[scr.length - 1].x, scr[scr.length - 1].y);
    ctx.lineTo(scr[0].x, scr[0].y);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }
}

/** Click points for a straight‑edged shape (tees, paths, buildings). */
export class PolygonShapeTool implements Tool {
  id = 'polygon' as const;
  name = 'Polygon shape';
  key = 'p';
  cursor = 'crosshair';
  hint = 'Click to add corners · click the first point, double‑click or Enter to finish · Esc cancels · hold ⌘ to edit points';
  private pts: Vec2[] = [];
  private live: Vec2 | null = null;
  private edit: ShapeEditor;

  constructor(private ed: Editor) {
    this.edit = new ShapeEditor(ed);
  }

  down(e: PointerInfo): void {
    if (!this.pts.length && e.meta && this.edit.down(e, true)) return;
    if (!this.pts.length && !this.ed.targetLayer('vector')) return;
    const p = clampWorld(this.ed, e.world);
    if (this.pts.length >= 3) {
      const first = this.ed.worldToScreen(this.pts[0]);
      if (dist(first, e.screen) <= HANDLE_RADIUS || e.clicks >= 2) return this.finish();
    }
    this.pts.push(p);
  }
  move(e: PointerInfo): void {
    if (this.edit.drag) return this.edit.move(e);
    this.live = clampWorld(this.ed, e.world);
  }
  up(): void {
    if (this.edit.drag) this.edit.up();
  }
  private finish(): void {
    const pts = dedupe(this.pts, 0.01);
    this.pts = [];
    if (pts.length < 3) return;
    const layer = this.ed.targetLayer('vector');
    if (!layer) return;
    addFeature(this.ed, layer, { id: uid('F'), surface: this.ed.surface, points: pts, smooth: false }, 'Draw polygon');
  }
  cancel(): void {
    this.pts = [];
    this.edit.cancel();
  }
  keydown(e: KeyboardEvent): boolean {
    if (this.pts.length) {
      if (e.key === 'Enter') {
        this.finish();
        return true;
      }
      if (e.key === 'Escape') {
        this.pts = [];
        return true;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        this.pts.pop();
        return true;
      }
      return false;
    }
    return this.edit.keydown(e);
  }
  overlay(ctx: CanvasRenderingContext2D): void {
    if (!this.pts.length) return;
    const scr = this.pts.map((p) => this.ed.worldToScreen(p));
    if (this.live) scr.push(this.ed.worldToScreen(this.live));
    ctx.save();
    ctx.beginPath();
    scr.forEach((s, i) => (i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y)));
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    for (const s of scr.slice(0, this.pts.length)) {
      ctx.fillRect(Math.round(s.x) - 3, Math.round(s.y) - 3, 6, 6);
      ctx.strokeRect(Math.round(s.x) - 2.5, Math.round(s.y) - 2.5, 5, 5);
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------- painting

/** Accumulates pixel writes for one gesture: invalidation + undo bookkeeping. */
class Stroke {
  private dirty: { x0: number; y0: number; x1: number; y1: number } | null = null;
  readonly W: number;
  readonly H: number;

  constructor(private ed: Editor, readonly layer: RasterLayer, readonly code: number) {
    this.W = ed.doc.width;
    this.H = ed.doc.height;
  }

  set(x: number, y: number, v = this.code): void {
    if (x < 0 || y < 0 || x >= this.W || y >= this.H) return;
    this.layer.pixels[y * this.W + x] = v;
    const d = this.dirty;
    if (!d) this.dirty = { x0: x, y0: y, x1: x, y1: y };
    else {
      if (x < d.x0) d.x0 = x;
      if (y < d.y0) d.y0 = y;
      if (x > d.x1) d.x1 = x;
      if (y > d.y1) d.y1 = y;
    }
  }

  /** Push accumulated changes to the screen and to undo history. */
  flush(): void {
    const d = this.dirty;
    if (!d) return;
    this.dirty = null;
    const r: Rect = { x: d.x0, y: d.y0, w: d.x1 - d.x0 + 1, h: d.y1 - d.y0 + 1 };
    this.ed.history.markRaster(this.layer, r);
    this.ed.invalidate(r);
  }
}

function beginStroke(ed: Editor, label: string, code: number): Stroke | null {
  const layer = ed.targetLayer('raster');
  if (!layer) return null;
  ed.history.begin(label);
  ed.history.snapshotRaster(layer);
  return new Stroke(ed, layer, code);
}

function stampOffsets(size: number, square: boolean): [number, number][] {
  const out: [number, number][] = [];
  const c = (size - 1) / 2;
  const r2 = (size / 2) ** 2;
  for (let j = 0; j < size; j++)
    for (let i = 0; i < size; i++) if (square || (i - c) ** 2 + (j - c) ** 2 <= r2) out.push([i, j]);
  return out;
}

/** Walk a straight line in doc pixels, calling fn for each step. */
function walkLine(a: Vec2, b: Vec2, fn: (x: number, y: number) => void): void {
  let x0 = Math.floor(a.x);
  let y0 = Math.floor(a.y);
  const x1 = Math.floor(b.x);
  const y1 = Math.floor(b.y);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    fn(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

abstract class StampTool implements Tool {
  abstract id: 'pencil' | 'brush' | 'eraser';
  abstract name: string;
  abstract key: string;
  abstract hint: string;
  cursor = 'crosshair';
  usesBrush = true;
  secondaryButton = true;
  protected stroke: Stroke | null = null;
  protected last: Vec2 | null = null;
  /** Last point of the previous stroke, for shift‑click straight lines. */
  protected prevEnd: Vec2 | null = null;

  constructor(protected ed: Editor) {}

  protected abstract size(): number;
  protected square(): boolean {
    return false;
  }
  protected code(button: number): number {
    return surfaceCode(button === 2 ? this.ed.surface2 : this.ed.surface);
  }

  private stamp(x: number, y: number): void {
    const s = this.size();
    const off = Math.floor((s - 1) / 2);
    for (const [i, j] of stampOffsets(s, this.square())) this.stroke!.set(x - off + i, y - off + j);
  }

  down(e: PointerInfo): void {
    this.stroke = beginStroke(this.ed, this.name, this.code(e.button));
    if (!this.stroke) return;
    const start = e.shift && this.prevEnd ? this.prevEnd : e.px;
    walkLine(start, e.px, (x, y) => this.stamp(x, y));
    this.last = e.px;
    this.stroke.flush();
  }
  move(e: PointerInfo, dragging: boolean): void {
    if (!dragging || !this.stroke || !this.last) return;
    walkLine(this.last, e.px, (x, y) => this.stamp(x, y));
    this.last = e.px;
    this.stroke.flush();
  }
  up(): void {
    if (!this.stroke) return;
    this.stroke.flush();
    this.ed.history.commit();
    this.prevEnd = this.last;
    this.stroke = null;
    this.last = null;
  }
  cancel(): void {
    if (this.stroke) {
      this.ed.history.abort();
      this.ed.invalidate();
    }
    this.stroke = null;
  }
  overlay(ctx: CanvasRenderingContext2D): void {
    const h = this.ed.hover;
    if (!h) return;
    const s = this.size();
    const off = Math.floor((s - 1) / 2);
    const x0 = Math.floor(h.px.x) - off;
    const y0 = Math.floor(h.px.y) - off;
    ctx.save();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (this.square() || s <= 2) {
      // a square of doc pixels — turns with the view
      const c = [
        { x: x0, y: y0 },
        { x: x0 + s, y: y0 },
        { x: x0 + s, y: y0 + s },
        { x: x0, y: y0 + s },
      ].map((p) => this.ed.pxToScreen(p));
      c.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
    } else {
      const c = this.ed.pxToScreen({ x: x0 + s / 2, y: y0 + s / 2 });
      ctx.arc(c.x, c.y, (s * this.ed.zoom) / 2, 0, Math.PI * 2);
    }
    ctx.stroke();
    ctx.restore();
  }
}

export class PencilTool extends StampTool {
  id = 'pencil' as const;
  name = 'Pencil';
  key = 'n';
  hint = 'Draw single pixels (right‑click = 2nd surface) · ⇧‑click draws a straight line from the last point';
  usesBrush = false;
  protected size(): number {
    return 1;
  }
}

export class BrushTool extends StampTool {
  id = 'brush' as const;
  name = 'Brush';
  key = 'b';
  hint = 'Paint with the selected surface · right‑click paints the 2nd surface · [ ] size · ⇧‑click straight line · X swaps surfaces';
  protected size(): number {
    return this.ed.brushSize;
  }
}

export class EraserTool extends StampTool {
  id = 'eraser' as const;
  name = 'Eraser';
  key = 'e';
  hint = 'Erase painted pixels on the active paint layer · [ and ] change size';
  protected size(): number {
    return Math.max(2, this.ed.brushSize * 2);
  }
  protected square(): boolean {
    return true;
  }
  secondaryButton = false;
  protected code(): number {
    return 0;
  }
}

export class SprayTool implements Tool {
  id = 'spray' as const;
  name = 'Spray (trees, fescue)';
  key = 't';
  cursor = 'crosshair';
  usesBrush = true;
  secondaryButton = true;
  hint = 'Spray scattered pixels — great for trees and fescue (pick the Trees or Fescue swatch)';
  private stroke: Stroke | null = null;
  private at: Vec2 | null = null;
  private timer = 0;

  constructor(private ed: Editor) {}

  private radius(): number {
    return this.ed.brushSize * 2 + 3;
  }

  private puff(): void {
    if (!this.stroke || !this.at) return;
    const r = this.radius();
    const n = Math.round(r * r * 0.06) + 2;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * r;
      this.stroke.set(Math.floor(this.at.x + Math.cos(a) * d), Math.floor(this.at.y + Math.sin(a) * d));
    }
    this.stroke.flush();
  }

  down(e: PointerInfo): void {
    this.stroke = beginStroke(this.ed, 'Spray', surfaceCode(e.button === 2 ? this.ed.surface2 : this.ed.surface));
    if (!this.stroke) return;
    this.at = e.px;
    this.puff();
    this.timer = window.setInterval(() => this.puff(), 30);
  }
  move(e: PointerInfo, dragging: boolean): void {
    if (dragging && this.stroke) this.at = e.px;
  }
  up(): void {
    window.clearInterval(this.timer);
    if (!this.stroke) return;
    this.stroke.flush();
    this.ed.history.commit();
    this.stroke = null;
  }
  cancel(): void {
    window.clearInterval(this.timer);
    if (this.stroke) {
      this.ed.history.abort();
      this.ed.invalidate();
    }
    this.stroke = null;
  }
  overlay(ctx: CanvasRenderingContext2D): void {
    const h = this.ed.hover;
    if (!h) return;
    const s = this.ed.pxToScreen(h.px);
    ctx.save();
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = '#000';
    ctx.beginPath();
    ctx.arc(s.x, s.y, this.radius() * this.ed.zoom, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

export class FillTool implements Tool {
  id = 'fill' as const;
  name = 'Fill';
  key = 'g';
  cursor = 'crosshair';
  secondaryButton = true;
  hint = 'Fill the area you click, bounded by anything visible (outlines, other surfaces) · right‑click fills with the 2nd surface';

  constructor(private ed: Editor) {}

  down(e: PointerInfo): void {
    const ed = this.ed;
    const W = ed.doc.width;
    const H = ed.doc.height;
    const code = surfaceCode(e.button === 2 ? ed.surface2 : ed.surface);
    const vis = visibleCodes(ed.doc);
    const region = floodRegion(vis, W, H, Math.floor(e.px.x), Math.floor(e.px.y));
    if (!region || vis[Math.floor(e.px.y) * W + Math.floor(e.px.x)] === code) return;
    const stroke = beginStroke(ed, 'Fill', code);
    if (!stroke) return;
    forEachPixel(region, W, (i) => (stroke.layer.pixels[i] = code));
    ed.history.markRaster(stroke.layer, region.rect);
    ed.history.commit();
    ed.invalidate(region.rect);
  }
}

/** Select a painted area: see its size, recolor it, delete it or turn it into a shape. */
export class WandTool implements Tool {
  id = 'wand' as const;
  name = 'Magic wand (select painted area)';
  key = 'w';
  cursor = 'crosshair';
  hint = 'Click a painted area to select it · click a swatch to recolor · ⌫ deletes · use Info → “Make shape” for drag‑point editing';

  constructor(private ed: Editor) {}

  down(e: PointerInfo): void {
    const ed = this.ed;
    const x = Math.floor(e.px.x);
    const y = Math.floor(e.px.y);
    const W = ed.doc.width;
    if (x < 0 || y < 0 || x >= W || y >= ed.doc.height) return ed.setRegion(null);
    for (let i = ed.doc.layers.length - 1; i >= 0; i--) {
      const layer = ed.doc.layers[i];
      if (!layer.visible || (layer.kind !== 'raster' && layer.kind !== 'vector')) continue;
      if (layer.kind === 'vector') {
        // A shape on top of the paint: select the shape instead.
        const hit = ed.hitFeature(e.world);
        if (hit && hit.layer === layer) {
          ed.select({ layerId: layer.id, featureId: hit.feature.id, point: null });
          return;
        }
        continue;
      }
      const code = layer.pixels[y * W + x];
      if (!code) continue;
      const region = floodRegion(layer.pixels, W, ed.doc.height, x, y);
      if (!region) return;
      if (ed.activeLayerId !== layer.id) ed.setActiveLayer(layer.id);
      ed.setRegion(ed.makePixelSelection(layer.id, code, region));
      return;
    }
    ed.setRegion(null);
    ed.select(null);
    ed.setMessage('Nothing painted here.');
  }

  keydown(e: KeyboardEvent): boolean {
    if (!this.ed.region) return false;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      this.ed.eraseRegion();
      return true;
    }
    if (e.key === 'Escape') {
      this.ed.setRegion(null);
      return true;
    }
    return false;
  }
}

export class PickerTool implements Tool {
  id = 'picker' as const;
  name = 'Pick surface';
  key = 'i';
  cursor = 'copy';
  hint = 'Click to pick the surface under the cursor';

  constructor(private ed: Editor) {}

  down(e: PointerInfo): void {
    this.ed.setSurface(this.ed.surfaceAt(e.world));
    this.ed.setTool(this.ed.previousTool);
  }
}

/** Google‑Maps‑style measuring: click, click, click; double‑click/Enter to finish. */
export class RulerTool implements Tool {
  id = 'ruler' as const;
  name = 'Measure distance';
  key = 'm';
  cursor = 'crosshair';
  hint = 'Click to measure · keep clicking for more legs · double‑click or Enter to finish · Esc clears';

  constructor(private ed: Editor) {}

  down(e: PointerInfo): void {
    const r = this.ed.ruler;
    const p = e.world;
    if (!r.active) {
      this.ed.ruler = { points: [p], live: p, active: true };
    } else if (e.clicks >= 2) {
      r.active = false;
      r.live = null;
    } else {
      r.points.push(p);
    }
    this.ed.emit('status');
  }
  move(e: PointerInfo): void {
    if (this.ed.ruler.active) {
      this.ed.ruler.live = e.world;
      this.ed.emit('status');
    }
  }
  keydown(e: KeyboardEvent): boolean {
    const r = this.ed.ruler;
    if (e.key === 'Enter' && r.active) {
      r.active = false;
      r.live = null;
      this.ed.emit('status');
      return true;
    }
    if (e.key === 'Escape' && (r.points.length || r.active)) {
      this.ed.clearRuler();
      return true;
    }
    if ((e.key === 'Backspace' || e.key === 'Delete') && r.points.length) {
      r.points.pop();
      if (!r.points.length) this.ed.clearRuler();
      this.ed.emit('status');
      return true;
    }
    return false;
  }
}

export class ZoomTool implements Tool {
  id = 'zoom' as const;
  name = 'Zoom';
  key = 'z';
  cursor = 'zoom-in';
  hint = 'Click to zoom in · ⌥‑click to zoom out';

  constructor(private ed: Editor) {}

  down(e: PointerInfo): void {
    this.ed.zoomStep(e.alt ? -1 : 1, e.screen);
  }
}

export class HandTool implements Tool {
  id = 'hand' as const;
  name = 'Hand (pan)';
  key = 'h';
  cursor = 'grab';
  hint = 'Drag to pan · tip: hold Space with any tool, or scroll with two fingers';
}

// ---------------------------------------------------------------- holes

/** Click tee → aim points → green. Drag points to edit. */
export class HoleTool implements Tool {
  id = 'hole' as const;
  name = 'Hole (tee → aim points → green)';
  key = 'o';
  cursor = 'crosshair';
  hint = 'Click the tee, click aim points, double‑click (or Enter) on the green · drag points to edit · 3/4/5 sets par · ⌫ deletes hole';
  private pts: Vec2[] = [];
  private live: Vec2 | null = null;
  private drag: { id: string; index: number; moved: boolean } | null = null;

  constructor(private ed: Editor) {}

  /** Hole point near the cursor (selected hole first). */
  private hitPoint(screen: Vec2): { id: string; index: number } | null {
    const holes = [...this.ed.doc.holes].sort((a, b) => (b.id === this.ed.selectedHoleId ? 1 : 0) - (a.id === this.ed.selectedHoleId ? 1 : 0));
    for (const h of holes)
      for (let i = 0; i < h.points.length; i++)
        if (dist(this.ed.worldToScreen(h.points[i]), screen) <= HANDLE_RADIUS) return { id: h.id, index: i };
    return null;
  }

  /** Hole whose line passes near the cursor, with the leg index. */
  private hitLine(screen: Vec2): { id: string; leg: number; at: Vec2 } | null {
    for (const h of this.ed.doc.holes)
      for (let i = 0; i + 1 < h.points.length; i++) {
        const a = this.ed.worldToScreen(h.points[i]);
        const b = this.ed.worldToScreen(h.points[i + 1]);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const l2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((screen.x - a.x) * dx + (screen.y - a.y) * dy) / l2));
        const q = { x: a.x + t * dx, y: a.y + t * dy };
        if (dist(q, screen) <= 6) return { id: h.id, leg: i, at: this.ed.pxToWorld(this.ed.screenToPx(q)) };
      }
    return null;
  }

  down(e: PointerInfo): void {
    const ed = this.ed;
    const p = clampWorld(ed, e.world);
    if (this.pts.length) {
      if (e.clicks >= 2) return this.finish();
      this.pts.push(p);
      return;
    }
    const hp = this.hitPoint(e.screen);
    if (hp) {
      const hole = ed.doc.holes.find((h) => h.id === hp.id)!;
      ed.selectHole(hp.id);
      if (e.alt) {
        if (hole.points.length > 2) ed.updateHole(hp.id, 'Delete hole point', (h) => ({ points: h.points.filter((_, i) => i !== hp.index) }));
        return;
      }
      ed.history.begin('Move hole point');
      ed.history.snapshotHoles();
      this.drag = { ...hp, moved: false };
      return;
    }
    const hl = this.hitLine(e.screen);
    if (hl) {
      ed.selectHole(hl.id);
      if (e.clicks >= 2) ed.updateHole(hl.id, 'Add aim point', (h) => ({ points: [...h.points.slice(0, hl.leg + 1), hl.at, ...h.points.slice(hl.leg + 1)] }));
      return;
    }
    ed.selectHole(null);
    this.pts = [p];
    this.live = p;
  }

  move(e: PointerInfo, dragging: boolean): void {
    const ed = this.ed;
    if (this.drag && dragging) {
      const d = this.drag;
      ed.doc.holes = ed.doc.holes.map((h) =>
        h.id === d.id ? { ...h, points: h.points.map((q, i) => (i === d.index ? clampWorld(ed, e.world) : q)) } : h,
      );
      d.moved = true;
      ed.emit('holes', 'selection');
      return;
    }
    if (this.pts.length) this.live = clampWorld(ed, e.world);
    else ed.canvas.style.cursor = this.hitPoint(e.screen) ? 'move' : this.hitLine(e.screen) ? 'pointer' : ed.cursorCss(this.cursor);
  }

  up(): void {
    if (!this.drag) return;
    const moved = this.drag.moved;
    this.drag = null;
    if (moved) this.ed.history.commit();
    else this.ed.history.abort();
    this.ed.emit('holes', 'selection');
  }

  private finish(): void {
    const ed = this.ed;
    const pts = dedupe(this.pts, 0.5);
    this.pts = [];
    this.live = null;
    if (pts.length < 2) return ed.setMessage('A hole needs at least a tee and a green.');
    const used = new Set(ed.doc.holes.map((h) => h.number));
    let n = 1;
    while (used.has(n)) n++;
    const hole = { id: uid('H'), number: n, par: suggestPar(pathLength(pts)), points: pts };
    ed.history.begin('Add hole');
    ed.history.snapshotHoles();
    ed.doc.holes = [...ed.doc.holes, hole];
    ed.history.commit();
    ed.selectHole(hole.id);
  }

  cancel(): void {
    this.pts = [];
    this.live = null;
    if (this.drag) {
      this.drag = null;
      this.ed.history.abort();
    }
  }

  keydown(e: KeyboardEvent): boolean {
    const ed = this.ed;
    if (this.pts.length) {
      if (e.key === 'Enter') {
        this.finish();
        return true;
      }
      if (e.key === 'Escape') {
        this.cancel();
        return true;
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        this.pts.pop();
        return true;
      }
      return false;
    }
    const sel = ed.selectedHole();
    if (!sel) return false;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      ed.deleteHole(sel.id);
      return true;
    }
    if (['3', '4', '5', '6'].includes(e.key)) {
      ed.updateHole(sel.id, 'Set par', () => ({ par: +e.key }));
      return true;
    }
    if (e.key === 'Escape') {
      ed.selectHole(null);
      return true;
    }
    return false;
  }

  overlay(ctx: CanvasRenderingContext2D): void {
    if (!this.pts.length) return;
    const pts = this.live ? [...this.pts, this.live] : this.pts;
    const scr = pts.map((p) => this.ed.worldToScreen(p));
    drawPlayLine(ctx, scr, true);
    const last = scr[scr.length - 1];
    const text = `${Math.round(pathLength(pts))} yd`;
    ctx.save();
    ctx.font = 'bold 11px system-ui, sans-serif';
    const w = ctx.measureText(text).width + 8;
    ctx.fillStyle = '#000';
    ctx.fillRect(Math.round(last.x + 10), Math.round(last.y - 20), w, 16);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, Math.round(last.x + 14), Math.round(last.y - 8));
    ctx.restore();
  }
}

// ---------------------------------------------------------------- underlays

/** Drag the underlay image around; arrows nudge it. */
export class UnderlayTool implements Tool {
  id = 'underlay' as const;
  name = 'Move underlay image';
  key = 'u';
  cursor = 'move';
  hint = 'Drag to move the underlay image (or the satellite map, if that layer is selected) · arrows nudge (⇧ = 10 yd)';
  private drag: { layer: ImageLayer; start: Vec2; ox: number; oy: number } | null = null;
  private mapDrag: { start: Vec2; geo: GeoRef } | null = null;

  /** With the map layer selected, this tool slides the map under the course. */
  private mapMode(): boolean {
    return this.ed.activeLayer?.kind === 'map' && !!this.ed.doc.geo;
  }

  constructor(private ed: Editor) {}

  private target(): ImageLayer | null {
    const l = this.ed.activeImage();
    if (!l) this.ed.setMessage('No underlay yet — use File → Import underlay image, drag a picture in, or paste one (⌘V).');
    else if (l.locked) {
      this.ed.setMessage('The underlay is locked — unlock it in the Layers panel.');
      return null;
    }
    return l;
  }

  down(e: PointerInfo): void {
    if (this.mapMode()) {
      if (this.ed.activeLayer?.locked) return this.ed.setMessage('The map is locked — unlock it in the Layers panel.');
      this.ed.history.begin('Move map');
      this.ed.history.snapshotGeo();
      this.mapDrag = { start: e.world, geo: { ...this.ed.doc.geo! } };
      return;
    }
    const l = this.target();
    if (!l) return;
    if (this.ed.activeLayerId !== l.id) this.ed.setActiveLayer(l.id);
    this.ed.history.begin('Move underlay');
    this.ed.history.snapshotImage(l);
    this.drag = { layer: l, start: e.world, ox: l.x, oy: l.y };
  }
  move(e: PointerInfo, dragging: boolean): void {
    const m = this.mapDrag;
    if (m && dragging) {
      const ll = worldToLatLon(m.geo, { x: m.start.x - e.world.x, y: m.start.y - e.world.y });
      this.ed.doc.geo = { lat: ll.lat, lon: ll.lon };
      return;
    }
    const d = this.drag;
    if (!d || !dragging) return;
    d.layer.x = d.ox + e.world.x - d.start.x;
    d.layer.y = d.oy + e.world.y - d.start.y;
  }
  up(): void {
    if (!this.drag && !this.mapDrag) return;
    this.drag = null;
    this.mapDrag = null;
    this.ed.history.commit();
    this.ed.emit('selection');
  }
  cancel(): void {
    if (this.drag || this.mapDrag) this.ed.history.abort();
    this.drag = null;
    this.mapDrag = null;
  }
  keydown(e: KeyboardEvent): boolean {
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const a = arrows[e.key];
    if (!a) return false;
    const step0 = e.shiftKey ? 10 : 1;
    if (this.mapMode()) {
      const g = this.ed.doc.geo!;
      this.ed.history.begin('Nudge map');
      this.ed.history.snapshotGeo();
      const ll = worldToLatLon(g, { x: -a[0] * step0, y: -a[1] * step0 });
      this.ed.doc.geo = { lat: ll.lat, lon: ll.lon };
      this.ed.history.commit();
      return true;
    }
    const l = this.target();
    if (!l) return true;
    const step = e.shiftKey ? 10 : 1;
    this.ed.updateImage(l, 'Nudge underlay', { x: l.x + a[0] * step, y: l.y + a[1] * step });
    return true;
  }
}

/** Click two points on the underlay a known distance apart, then type the real distance. */
export class ScaleTool implements Tool {
  id = 'scale' as const;
  name = 'Set underlay scale';
  key = 'k';
  cursor = 'crosshair';
  hint = 'Click two points on the underlay that you know the real distance between (e.g. a hole’s tee and green) — then type it in yards';
  private a: Vec2 | null = null;
  private live: Vec2 | null = null;

  constructor(private ed: Editor) {}

  down(e: PointerInfo): void {
    const l = this.ed.activeImage();
    if (!l) return this.ed.setMessage('No underlay yet — import an image first (File → Import underlay image).');
    if (!this.a) {
      this.a = e.world;
      this.live = e.world;
      return;
    }
    const a = this.a;
    const b = e.world;
    this.a = null;
    this.live = null;
    const measured = dist(a, b);
    if (measured < 1e-6) return;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.step = '1';
    input.value = String(Math.round(measured));
    const body = document.createElement('div');
    body.className = 'form';
    body.append(
      field('Real distance', input, `Right now this line measures ${Math.round(measured)} yd on the course.`),
    );
    dialog('Set underlay scale', body, [
      {
        label: 'Apply',
        primary: true,
        onClick: () => {
          const target = +input.value;
          if (!(target > 0)) return false;
          const k = target / measured;
          // Scale the image about point A so A stays put.
          this.ed.updateImage(l, 'Set underlay scale', {
            scale: l.scale * k,
            x: a.x + (l.x - a.x) * k,
            y: a.y + (l.y - a.y) * k,
          });
          this.ed.setMessage(`Underlay scaled: that line is now ${Math.round(target)} yd. Check another distance with the ruler (M).`);
        },
      },
      { label: 'Cancel', onClick: () => {} },
    ]);
  }
  move(e: PointerInfo): void {
    if (this.a) this.live = e.world;
  }
  cancel(): void {
    this.a = null;
    this.live = null;
  }
  keydown(e: KeyboardEvent): boolean {
    if (e.key === 'Escape' && this.a) {
      this.cancel();
      return true;
    }
    return false;
  }
  overlay(ctx: CanvasRenderingContext2D): void {
    if (!this.a || !this.live) return;
    const a = this.ed.worldToScreen(this.a);
    const b = this.ed.worldToScreen(this.live);
    ctx.save();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#000';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ff40c0';
    ctx.stroke();
    ctx.font = 'bold 11px system-ui, sans-serif';
    const text = `${Math.round(dist(this.a, this.live))} yd now`;
    const w = ctx.measureText(text).width + 8;
    ctx.fillStyle = '#000';
    ctx.fillRect(b.x + 10, b.y - 20, w, 16);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, b.x + 14, b.y - 8);
    ctx.restore();
  }
}

// ---------------------------------------------------------------- terrain

/** Shape the ground: raise, lower, smooth or flatten (mode in tool options; ⌥ inverts). */
export class TerrainTool implements Tool {
  id = 'terrain' as const;
  name = 'Shape terrain';
  key = 'd';
  cursor = 'crosshair';
  usesBrush = true;
  hint = 'Drag to shape the ground (mode in the tool options) · ⌥ = opposite of raise/lower · [ ] size · hold still to keep working';
  private at: Vec2 | null = null;
  private last: Vec2 | null = null;
  private target = 0;
  private timer = 0;
  private alt = false;

  constructor(private ed: Editor) {}

  private radiusPx(): number {
    return (this.ed.brushSize * 4) / this.ed.doc.yardsPerPixel;
  }

  private mode(): BrushMode {
    const m = this.ed.terrainBrush;
    if (this.alt && m === 'raise') return 'lower';
    if (this.alt && m === 'lower') return 'raise';
    return m;
  }

  private apply(p: Vec2): void {
    const t = this.ed.doc.terrain;
    if (!t) return;
    const m = this.mode();
    const amount = m === 'raise' || m === 'lower' ? 0.35 : m === 'smooth' ? 0.5 : 0.3;
    dab(t, p, this.radiusPx(), m, amount, this.target);
    this.ed.requestFrame();
  }

  down(e: PointerInfo): void {
    const ed = this.ed;
    if (!ed.doc.terrain) {
      ed.setTerrain(createTerrain(ed.doc.width, ed.doc.height, 'sculpted', 0), 'Start terrain');
      ed.setMessage('Started a flat terrain at 0 ft. Turn on contours/shading in the Terrain menu to see your shaping.');
    }
    const tl = ed.terrainLayer();
    if (tl && !tl.visible) {
      tl.visible = true;
      ed.emit('doc');
    }
    this.alt = e.alt;
    ed.history.begin('Shape terrain');
    ed.history.snapshotTerrain();
    this.target = heightAtPx(ed.doc.terrain!, e.px);
    this.at = e.px;
    this.last = e.px;
    this.apply(e.px);
    this.timer = window.setInterval(() => this.at && this.apply(this.at), 60);
  }

  move(e: PointerInfo, dragging: boolean): void {
    if (!dragging || !this.last) return;
    const step = Math.max(1, this.radiusPx() / 4);
    const d = dist(this.last, e.px);
    for (let s = step; s <= d; s += step) {
      const f = s / d;
      this.apply({ x: this.last.x + (e.px.x - this.last.x) * f, y: this.last.y + (e.px.y - this.last.y) * f });
    }
    if (d >= step) this.last = e.px;
    this.at = e.px;
  }

  up(): void {
    window.clearInterval(this.timer);
    if (!this.at) return;
    this.at = null;
    this.last = null;
    this.ed.history.commit();
    this.ed.emit('holes', 'selection');
    this.ed.requestFrame();
  }

  cancel(): void {
    window.clearInterval(this.timer);
    if (this.at) {
      this.ed.history.abort();
      this.ed.requestFrame();
    }
    this.at = null;
    this.last = null;
  }

  overlay(ctx: CanvasRenderingContext2D): void {
    const h = this.ed.hover;
    if (!h) return;
    const s = this.ed.pxToScreen(h.px);
    const r = this.radiusPx() * this.ed.zoom;
    ctx.save();
    ctx.strokeStyle = '#5c3412';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.arc(s.x, s.y, r / 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

export function registerAllTools(ed: Editor): void {
  for (const T of [
    SelectTool,
    FreehandShapeTool,
    PolygonShapeTool,
    PencilTool,
    BrushTool,
    SprayTool,
    FillTool,
    WandTool,
    EraserTool,
    PickerTool,
    RulerTool,
    ZoomTool,
    HandTool,
    HoleTool,
    UnderlayTool,
    ScaleTool,
    TerrainTool,
  ]) {
    ed.registerTool(new T(ed));
  }
}

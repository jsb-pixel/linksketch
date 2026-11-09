import { dedupe, dist, pathLength, simplifyClosed } from '../geom/geom';
import { uid } from '../model/doc';
import { rgbCss, surfaceById, surfaceCode } from '../model/surfaces';
import type { Feature, RasterLayer, Rect, Vec2, VectorLayer } from '../model/types';
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
    ctx.strokeStyle = rgbCss(surfaceById(this.ed.surface)!.color);
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
    const tl = this.ed.pxToScreen({ x: Math.floor(h.px.x) - off, y: Math.floor(h.px.y) - off });
    const w = s * this.ed.zoom;
    ctx.save();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    if (this.square() || s <= 2) ctx.strokeRect(Math.round(tl.x) + 0.5, Math.round(tl.y) + 0.5, Math.round(w), Math.round(w));
    else {
      ctx.beginPath();
      ctx.arc(tl.x + w / 2, tl.y + w / 2, w / 2, 0, Math.PI * 2);
      ctx.stroke();
    }
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
      if (!layer.visible) continue;
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
  ]) {
    ed.registerTool(new T(ed));
  }
}

/**
 * Drawing the exports: the plain course picture, the presentation sheet (title,
 * legend, scale bar, north arrow) and yardage‑book hole pages. Layout maths is in
 * `layout.ts`; this file only paints.
 */
import type { Editor } from '../editor/editor';
import { drawFlag, drawHoles, drawPlayLine, drawTeeMarker, holeClimb, playsLike } from '../editor/holes';
import { drawLabels } from '../model/labels';
import { courseStats, type CourseStats } from '../model/stats';
import { rgbCss, surfaceById, surfaceCode, surfaceColor, surfacePixel } from '../model/surfaces';
import { linePoints, teeOf, yardsFor } from '../model/tees';
import type { Hole, Vec2 } from '../model/types';
import { visibleCodes } from '../render/raster';
import { drawShots } from '../strategy/draw';
import { drawTerrain } from '../terrain/render';
import { fairwayWidth, findHazards, greenTicks, holeFrame, landingZone, niceScaleBar, sheetLayout } from './layout';
import { buildPdf, type PdfPage } from './pdf';

const FONT = '"Helvetica Neue", Arial, system-ui, sans-serif';

/** Hole pages are US Letter at 150 dpi. */
export const HOLE_PAGE = { w: 1275, h: 1650 };
const PLOT = { x: 70, y: 215, w: 1135, h: 1265 };

function newCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w);
  canvas.height = Math.round(h);
  return { canvas, ctx: canvas.getContext('2d')! };
}

// ---------------------------------------------------------------- course picture
/**
 * Paint the course at `scale` output pixels per doc pixel with its top‑left at (0, 0):
 * background, drawing, terrain, holes, strategy for the selected hole, and labels.
 * Underlays and the satellite map are reference material and are never exported.
 */
export function drawCourse(ctx: CanvasRenderingContext2D, ed: Editor, scale: number, uiScale = Math.max(1, scale / 1.5)): void {
  const doc = ed.doc;
  ed.flushRender();
  const w = doc.width * scale;
  const h = doc.height * scale;
  ctx.save();
  ctx.fillStyle = rgbCss(surfaceColor(doc.background));
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(ed.docCanvas, 0, 0, w, h);
  const tl = ed.terrainLayer();
  if (tl?.visible && doc.terrain) {
    ctx.save();
    ctx.scale(scale, scale);
    drawTerrain(ctx, doc.terrain, tl, doc.yardsPerPixel, 1 / scale);
    ctx.restore();
  }
  const k = scale / doc.yardsPerPixel;
  const toScreen = (p: Vec2) => ({ x: p.x * k, y: p.y * k });
  const hole = ed.selectedHole();
  if (ed.showHoles && ed.showStrategy && hole) {
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const all = ed.strategyFor(hole);
    for (const r of all) drawShots(ctx, r.player, r.shots, r.odds, { toScreen, unitsPerYard: k, uiScale, placed, compact: all.length > 1 });
  }
  if (ed.showHoles && doc.holes.length) {
    drawHoles(ctx, doc.holes, {
      toScreen,
      unitsPerYard: k,
      uiScale,
      elevation: doc.terrain ? (p) => ed.elevationAt(p) : undefined,
      sets: ed.teeSets,
      activeSetId: ed.activeTeeSetId,
    });
  }
  if (ed.showLabels) drawLabels(ctx, doc.labels, { toScreen, unitsPerYard: k });
  ctx.restore();
}

// ---------------------------------------------------------------- shared furniture
/** North arrow centred at (x, y); `angle` turns it (0 = north is up the page). */
function drawNorthArrow(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, angle = 0): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size * 0.42, size * 0.55);
  ctx.lineTo(0, size * 0.25);
  ctx.lineTo(-size * 0.42, size * 0.55);
  ctx.closePath();
  ctx.fillStyle = '#000';
  ctx.fill();
  // Left half white, the classic two‑tone arrow.
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(0, size * 0.25);
  ctx.lineTo(-size * 0.42, size * 0.55);
  ctx.closePath();
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.lineWidth = Math.max(1, size * 0.06);
  ctx.strokeStyle = '#000';
  ctx.stroke();
  ctx.restore();
  // The letter sits beyond the tip but stays upright.
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.font = `bold ${Math.round(size * 0.7)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('N', x + Math.sin(angle) * size * 1.45, y - Math.cos(angle) * size * 1.45);
  ctx.restore();
}

/** Checkered scale bar with its left end at (x, y). */
function drawScaleBar(ctx: CanvasRenderingContext2D, x: number, y: number, pxPerYard: number, maxPx: number, unit: number): void {
  const bar = niceScaleBar(pxPerYard, maxPx);
  const h = Math.max(4, Math.round(unit * 0.45));
  ctx.save();
  const parts = 4;
  for (let i = 0; i < parts; i++) {
    ctx.fillStyle = i % 2 ? '#fff' : '#000';
    ctx.fillRect(x + (bar.px * i) / parts, y, bar.px / parts, h);
  }
  ctx.strokeStyle = '#000';
  ctx.lineWidth = Math.max(1, unit * 0.08);
  ctx.strokeRect(x, y, bar.px, h);
  ctx.fillStyle = '#000';
  ctx.font = `${Math.round(unit)}px ${FONT}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText('0', x, y + h + unit * 0.3);
  ctx.textAlign = 'right';
  ctx.fillText(`${bar.yards} yards`, x + bar.px, y + h + unit * 0.3);
  ctx.restore();
}

/** A small square of a surface, with its pixel pattern. */
function drawSwatch(ctx: CanvasRenderingContext2D, id: string, x: number, y: number, size: number): void {
  const n = 12;
  const { canvas, ctx: c } = newCanvas(n, n);
  const img = c.createImageData(n, n);
  const u32 = new Uint32Array(img.data.buffer);
  const code = surfaceCode(id);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) u32[j * n + i] = surfacePixel(code, i + 3, j + 1);
  c.putImageData(img, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, x, y, size, size);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = Math.max(1, size / 14);
  ctx.strokeRect(x, y, size, size);
  ctx.restore();
}

/** Text in a white box; returns the box. `align` is where (x, y) sits in it. */
function boxed(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, align: 'left' | 'center' | 'right' = 'center', color = '#000'): { x: number; y: number; w: number; h: number } {
  ctx.save();
  ctx.font = `bold ${size}px ${FONT}`;
  const w = ctx.measureText(text).width + size * 0.7;
  const h = size * 1.45;
  const left = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.fillRect(left, y - h / 2, w, h);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.strokeRect(left, y - h / 2, w, h);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + w / 2, y + size * 0.04);
  ctx.restore();
  return { x: left, y: y - h / 2, w, h };
}

// ---------------------------------------------------------------- presentation sheet
/** What the legend shows: surfaces actually on the course, golf surfaces first. */
export function legendItems(stats: CourseStats): { id: string; name: string; acres: number }[] {
  const rank = (id: string) => (surfaceById(id)?.kind === 'golf' ? 0 : 1);
  return stats.surfaces
    .filter((s) => s.acres >= 0.005)
    .sort((a, b) => rank(a.id) - rank(b.id) || b.sqYd - a.sqYd)
    .slice(0, 18);
}

/** The whole course on a sheet with a title block, legend, scale bar and north arrow. */
export function renderPresentation(ed: Editor, scale: number): HTMLCanvasElement {
  const doc = ed.doc;
  const stats = courseStats(doc);
  const items = legendItems(stats);
  const L = sheetLayout(doc.width * scale, doc.height * scale, items.length);
  const { canvas, ctx } = newCanvas(L.width, L.height);
  const u = L.unit;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, L.width, L.height);

  // Title block.
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = `bold ${Math.round(u * 2.6)}px ${FONT}`;
  ctx.fillText(doc.name, L.title.x, L.title.y + u * 2.5, L.map.w);
  const facts: string[] = [];
  if (stats.holes) facts.push(`${stats.holes} hole${stats.holes > 1 ? 's' : ''}`, `Par ${stats.par}`);
  for (const y of stats.yardage) if (y.yards) facts.push(stats.yardage.length > 1 ? `${y.name} ${y.yards.toLocaleString()} yd` : `${y.yards.toLocaleString()} yards`);
  facts.push(`${stats.propertyAcres.toFixed(0)} acres`);
  ctx.font = `${Math.round(u * 1.15)}px ${FONT}`;
  ctx.fillStyle = '#333';
  ctx.fillText(facts.join('   ·   '), L.title.x, L.title.y + u * 4.2, L.map.w);

  // The course.
  ctx.save();
  ctx.translate(L.map.x, L.map.y);
  ctx.beginPath();
  ctx.rect(0, 0, L.map.w, L.map.h);
  ctx.clip();
  // Hole numbers and yardages sized to read on the sheet, whatever the course size.
  drawCourse(ctx, ed, scale, Math.max(1, u / 13));
  ctx.restore();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = Math.max(2, u * 0.12);
  ctx.strokeRect(L.map.x, L.map.y, L.map.w, L.map.h);

  // Legend.
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  items.forEach((it, i) => {
    const x = L.legend.x + (i % L.legend.cols) * L.legend.colW;
    const y = L.legend.y + Math.floor(i / L.legend.cols) * L.legend.rowH;
    const sw = Math.round(u * 1.3);
    drawSwatch(ctx, it.id, x, y, sw);
    ctx.fillStyle = '#000';
    ctx.font = `${Math.round(u * 1.05)}px ${FONT}`;
    ctx.fillText(it.name, x + sw + u * 0.5, y + sw / 2, L.legend.colW - sw - u);
  });

  // Footer: scale bar, credit, north arrow.
  const fy = L.footer.y;
  drawScaleBar(ctx, L.footer.x, fy + u * 0.6, scale / doc.yardsPerPixel, Math.min(L.map.w * 0.3, u * 30), u);
  drawNorthArrow(ctx, L.footer.x + L.footer.w - u * 1.6, fy + u * 2.6, u * 1.5);
  ctx.fillStyle = '#555';
  ctx.font = `${Math.round(u * 0.9)}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Drawn with Linksketch', L.footer.x + L.footer.w / 2, fy + u * 3.2);
  return canvas;
}

// ---------------------------------------------------------------- hole pages
/**
 * One hole as a yardage‑book page: tee at the bottom, green at the top, distances to
 * reach and carry each hazard, yards to the green, fairway width at the landing zone,
 * and the strategy patterns if they are showing.
 */
export function renderHolePage(ed: Editor, hole: Hole, codes: Uint8Array = visibleCodes(ed.doc)): HTMLCanvasElement {
  ed.flushRender();
  const doc = ed.doc;
  const ypp = doc.yardsPerPixel;
  const sets = ed.teeSets;
  const activeId = ed.activeTeeSetId;
  const active = sets.find((s) => s.id === activeId) ?? sets[0];
  const line = linePoints(hole, activeId, sets);
  const green = hole.points[hole.points.length - 1];
  const tees = sets.map((s) => teeOf(hole, s.id, sets));
  const f = holeFrame(hole.points[0], green, [...hole.points, ...tees], PLOT);
  const { canvas, ctx } = newCanvas(HOLE_PAGE.w, HOLE_PAGE.h);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, HOLE_PAGE.w, HOLE_PAGE.h);

  // ---- header
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = `800 96px ${FONT}`;
  ctx.fillText(`HOLE ${hole.number}`, PLOT.x, 118);
  ctx.textAlign = 'right';
  ctx.font = `800 64px ${FONT}`;
  ctx.fillText(`PAR ${hole.par}`, PLOT.x + PLOT.w, 96);
  ctx.font = `26px ${FONT}`;
  ctx.fillStyle = '#444';
  const climb = holeClimb(hole, doc.terrain ? (p) => ed.elevationAt(p) : undefined);
  const yards = yardsFor(hole, activeId, sets);
  const sub = climb !== null && Math.abs(climb) >= 1 ? `${climb > 0 ? 'Uphill' : 'Downhill'} ${Math.round(Math.abs(climb))} ft · plays ${playsLike(yards, climb)} yd` : doc.name;
  ctx.fillText(sub, PLOT.x + PLOT.w, 134);
  // Yardage for every tee set.
  ctx.textAlign = 'left';
  ctx.font = `bold 30px ${FONT}`;
  let tx = PLOT.x;
  for (const set of sets) {
    const named = sets.length > 1 || !!doc.teeSets?.length;
    const text = named ? `${set.name} ${yardsFor(hole, set.id, sets)}` : `${yardsFor(hole, set.id, sets)} yards`;
    if (named) {
      ctx.fillStyle = '#000';
      ctx.fillRect(tx, 160, 26, 26);
      ctx.fillStyle = set.color;
      ctx.fillRect(tx + 3, 163, 20, 20);
      tx += 36;
    }
    ctx.fillStyle = '#000';
    ctx.fillText(text, tx, 184);
    tx += ctx.measureText(text).width + 34;
  }

  // ---- the hole
  ctx.save();
  ctx.beginPath();
  ctx.rect(PLOT.x, PLOT.y, PLOT.w, PLOT.h);
  ctx.clip();
  ctx.fillStyle = '#e8e8e1';
  ctx.fillRect(PLOT.x, PLOT.y, PLOT.w, PLOT.h);
  ctx.save();
  ctx.transform(...f.matrix);
  ctx.scale(ypp, ypp); // doc pixels → yards → page
  ctx.fillStyle = rgbCss(surfaceColor(doc.background));
  ctx.fillRect(0, 0, doc.width, doc.height);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(ed.docCanvas, 0, 0);
  const tl = ed.terrainLayer();
  if (tl?.visible && doc.terrain) drawTerrain(ctx, doc.terrain, tl, ypp, 1 / (f.scale * ypp));
  ctx.restore();

  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const clear = (b: { x: number; y: number; w: number; h: number }) => !placed.some((p) => b.x < p.x + p.w + 6 && p.x < b.x + b.w + 6 && b.y < p.y + p.h + 6 && p.y < b.y + b.h + 6);

  // Strategy patterns, if they are showing in the editor (under the numbers).
  if (ed.showStrategy && ed.showHoles) {
    const all = ed.strategyFor(hole);
    for (const r of all) drawShots(ctx, r.player, r.shots, r.odds, { toScreen: f.toPage, unitsPerYard: f.scale, uiScale: 2, placed, compact: true });
  }

  // Yards to the green: a tick across the line of play every 50.
  for (const t of greenTicks(line)) {
    const c = f.toPage(t.point);
    const a = f.toPage({ x: t.point.x - t.dir.y * 9, y: t.point.y + t.dir.x * 9 });
    const b = f.toPage({ x: t.point.x + t.dir.y * 9, y: t.point.y - t.dir.x * 9 });
    ctx.save();
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
    // Number on the left of the line.
    const left = b.x < a.x ? b : a;
    placed.push(boxed(ctx, String(t.yards), left.x - 8, left.y + (left.y - c.y) * 0.2, 22, 'right'));
  }

  // Fairway width where the tee shot lands.
  const lz = landingZone(line);
  const short = [surfaceCode('fairway'), surfaceCode('tee')];
  const fw = lz && fairwayWidth(codes, doc.width, doc.height, ypp, lz.point, lz.dir, short);
  if (fw && fw.width >= 8) {
    const a = f.toPage(fw.left);
    const b = f.toPage(fw.right);
    ctx.save();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.strokeStyle = '#0a3d91';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 6]);
    ctx.stroke();
    ctx.restore();
    const right = a.x > b.x ? a : b;
    // Step up past anything already there (a strategy label often sits just right of the fairway).
    let wy = right.y;
    for (let n = 0; n < 8 && !clear({ x: right.x + 10, y: wy - 16, w: 130, h: 32 }); n++) wy -= 36;
    placed.push(boxed(ctx, `${fw.width} wide`, right.x + 10, wy, 22, 'left', '#0a3d91'));
  }

  // Hazards: yards from the tee to reach, and to carry.
  const hazards = findHazards(codes, doc.width, doc.height, ypp, line, { sand: [surfaceCode('bunker'), surfaceCode('waste')], water: [surfaceCode('water')] });
  for (const hz of hazards) {
    const c = f.toPage(hz.at);
    const text = hz.carry - hz.reach < 6 ? String(hz.reach) : `${hz.reach}–${hz.carry}`;
    const color = hz.kind === 'water' ? '#0d47a1' : '#6d4c00';
    const dirX = hz.side === 'L' ? -1 : 1;
    ctx.save();
    ctx.font = `bold 22px ${FONT}`;
    const w = ctx.measureText(text).width + 22 * 0.7;
    ctx.restore();
    // Outside the hazard, away from the line of play; slide down past other labels.
    const off = Math.max(46, Math.sqrt(hz.area) * f.scale * 0.6 + 26);
    let x = c.x + dirX * off;
    x = Math.max(PLOT.x + w / 2 + 6, Math.min(PLOT.x + PLOT.w - w / 2 - 6, x));
    let y = c.y;
    for (let n = 0; n < 12 && !clear({ x: x - w / 2, y: y - 16, w, h: 32 }); n++) y += 36;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
    placed.push(boxed(ctx, text, x, y, 22, 'center', color));
  }

  // Line of play, tees and flag on top.
  drawPlayLine(ctx, line.map(f.toPage), false, 2.2);
  sets.forEach((set, i) => drawTeeMarker(ctx, f.toPage(tees[i]), sets.length > 1 || doc.teeSets?.length ? set.color : '#000', 2.2, set.id === activeId));
  drawFlag(ctx, f.toPage(green), 2.4);
  ctx.restore();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.strokeRect(PLOT.x, PLOT.y, PLOT.w, PLOT.h);

  // ---- footer
  const fy = PLOT.y + PLOT.h + 30;
  drawScaleBar(ctx, PLOT.x, fy, f.scale, 320, 22);
  drawNorthArrow(ctx, PLOT.x + PLOT.w - 50, fy + 60, 26, f.angle);
  ctx.fillStyle = '#444';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `20px ${FONT}`;
  const from = sets.length > 1 || doc.teeSets?.length ? `the ${active.name} tee` : 'the tee';
  ctx.fillText(`Boxes by hazards: yards from ${from} to reach – to carry.`, HOLE_PAGE.w / 2 + 40, fy + 20);
  ctx.fillText('Ticks across the hole: yards to the middle of the green.', HOLE_PAGE.w / 2 + 40, fy + 48);
  ctx.font = `bold 20px ${FONT}`;
  ctx.fillText(`${doc.name} · Linksketch`, HOLE_PAGE.w / 2 + 40, fy + 86);
  return canvas;
}

const toBlob = (c: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('This browser could not make that picture.'))), type, quality));

export const canvasPng = (c: HTMLCanvasElement) => toBlob(c, 'image/png');

/** Every hole (in order) as one printable PDF, one page each. */
export async function holePagesPdf(ed: Editor): Promise<Blob> {
  const codes = visibleCodes(ed.doc);
  const pages: PdfPage[] = [];
  for (const hole of [...ed.doc.holes].sort((a, b) => a.number - b.number)) {
    const canvas = renderHolePage(ed, hole, codes);
    const jpeg = new Uint8Array(await (await toBlob(canvas, 'image/jpeg', 0.9)).arrayBuffer());
    pages.push({ jpeg, width: canvas.width, height: canvas.height });
  }
  return new Blob([buildPdf(pages)], { type: 'application/pdf' });
}

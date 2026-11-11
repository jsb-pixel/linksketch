import { dist, polygonArea, pathLength } from '../geom/geom';
import { holeYards, playsLike } from '../editor/holes';
import { minMax, type BrushMode } from '../terrain/terrain';
import { MAP_SOURCES } from '../editor/maptiles';
import { formatLatLon, worldToLatLon } from '../geo/geo';
import type { Hole, MapSource } from '../model/types';
import { OUTCOMES, troubleShare } from '../strategy/strategy';
import type { Editor, ToolId } from '../editor/editor';
import { createRasterLayer, createVectorLayer } from '../model/doc';
import { SURFACES, customSlotUsed, surfaceById, surfaceCode, surfaceColor, surfacePixel, rgbCss } from '../model/surfaces';
import { flatten } from '../render/raster';
import { TOOL_ICONS } from './icons';

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { class?: string; dataset?: Record<string, string> } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  const { class: cls, dataset, ...rest } = props;
  if (cls) el.className = cls;
  if (dataset) Object.assign(el.dataset, dataset);
  Object.assign(el, rest);
  el.append(...children);
  return el;
}

const TOOL_ORDER: ToolId[] = [
  'brush',
  'pencil',
  'spray',
  'fill',
  'eraser',
  'wand',
  'picker',
  'ruler',
  'hole',
  'terrain',
  'select',
  'freehand',
  'polygon',
  'underlay',
  'scale',
  'zoom',
  'hand',
];

/** Format an area in square yards the way golf people talk about it. */
export function formatArea(sqYd: number): string {
  const sqFt = sqYd * 9;
  if (sqYd < 4840 * 0.5) return `${Math.round(sqFt).toLocaleString()} sq ft`;
  return `${(sqYd / 4840).toFixed(2)} acres`;
}

// =====================================================================
// Menus
// =====================================================================
export interface MenuItem {
  label: string;
  shortcut?: string;
  action?: () => void;
  enabled?: () => boolean;
  checked?: () => boolean;
  separator?: boolean;
}

export function buildMenuBar(menus: { title: string; items: MenuItem[] }[]): void {
  const bar = $('#menubar');
  let open: HTMLElement | null = null;
  const close = () => {
    open?.classList.remove('open');
    open = null;
  };
  for (const m of menus) {
    const title = h('div', { class: 'menu-title', textContent: m.title });
    const list = h('div', { class: 'menu-list' });
    const wrap = h('div', { class: 'menu' }, title, list);
    const render = () => {
      list.replaceChildren(
        ...m.items.map((it) => {
          if (it.separator) return h('hr');
          const enabled = it.enabled ? it.enabled() : true;
          const row = h(
            'div',
            { class: `menu-item${enabled ? '' : ' disabled'}` },
            h('span', { class: 'check', textContent: it.checked?.() ? '✓' : '' }),
            h('span', { class: 'label', textContent: it.label }),
            h('span', { class: 'shortcut', textContent: it.shortcut ?? '' }),
          );
          row.addEventListener('pointerup', () => {
            if (!enabled) return;
            close();
            it.action?.();
          });
          return row;
        }),
      );
    };
    title.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (open === wrap) return close();
      close();
      render();
      wrap.classList.add('open');
      open = wrap;
    });
    title.addEventListener('pointerenter', () => {
      if (open && open !== wrap) {
        close();
        render();
        wrap.classList.add('open');
        open = wrap;
      }
    });
    bar.append(wrap);
  }
  document.addEventListener('pointerdown', (e) => {
    if (open && !open.contains(e.target as Node)) close();
  });
}

// =====================================================================
// Toolbox + tool options
// =====================================================================
export function buildToolbox(ed: Editor): void {
  const box = $('#toolbox');
  const buttons = new Map<ToolId, HTMLButtonElement>();
  for (const id of TOOL_ORDER) {
    const t = ed.tools.get(id)!;
    const b = h('button', {
      class: 'tool',
      title: `${t.name} (${t.key.toUpperCase()})`,
      innerHTML: TOOL_ICONS[id],
    });
    b.addEventListener('click', () => ed.setTool(id));
    buttons.set(id, b);
    box.append(b);
  }
  const sync = () => buttons.forEach((b, id) => b.classList.toggle('active', ed.tool.id === id));
  ed.on('tool', sync);
  sync();

  const opts = $('#tool-options');
  const render = () => {
    opts.replaceChildren();
    const t = ed.tool;
    if (t.usesBrush) {
      const sizes = [1, 2, 3, 5, 8, 12];
      const grid = h('div', { class: 'sizes' });
      for (const s of sizes) {
        const b = h('button', { class: `size${ed.brushSize === s ? ' active' : ''}`, title: `${s}px` });
        const dot = h('span');
        const d = Math.min(14, s + 1);
        dot.style.width = dot.style.height = `${d}px`;
        b.append(dot);
        b.addEventListener('click', () => ed.setBrushSize(s));
        grid.append(b);
      }
      opts.append(grid, h('div', { class: 'opt-note', textContent: t.id === 'terrain' ? `${ed.brushSize * 4} yd` : `${ed.brushSize}px` }));
    }
    if (t.id === 'terrain') {
      const modes: [BrushMode, string, string][] = [
        ['raise', '▲', 'Raise'],
        ['lower', '▼', 'Lower'],
        ['smooth', '≈', 'Smooth'],
        ['flatten', '▬', 'Flatten (to the height where you start)'],
      ];
      const box = h('div', { class: 'sizes' });
      for (const [m, icon, title] of modes) {
        const b = h('button', { class: `size mode${ed.terrainBrush === m ? ' active' : ''}`, title, textContent: icon });
        b.addEventListener('click', () => {
          ed.terrainBrush = m;
          ed.emit('options');
        });
        box.append(b);
      }
      opts.prepend(box);
    }
    if (t.id === 'freehand') {
      const cb = h('input', { type: 'checkbox', checked: ed.smoothShapes });
      cb.addEventListener('change', () => {
        ed.smoothShapes = cb.checked;
        ed.emit('options');
      });
      opts.append(h('label', { class: 'opt' }, cb, 'Smooth'));
    }
  };
  ed.on('tool', render);
  ed.on('options', render);
  render();
}

// =====================================================================
// Palette (surfaces)
// =====================================================================
export const toHex = (c: readonly number[]) => `#${c.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
export const fromHex = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

function swatchCanvas(id: string, size = 16): HTMLCanvasElement {
  const c = h('canvas', { width: size, height: size });
  const ctx = c.getContext('2d')!;
  const s = surfaceById(id)!;
  if (s.kind === 'custom' && !customSlotUsed(id)) {
    // empty slot: light checkerboard
    for (let y = 0; y < size; y += 4)
      for (let x = 0; x < size; x += 4) {
        ctx.fillStyle = (x + y) % 8 ? '#ffffff' : '#d8d8d8';
        ctx.fillRect(x, y, 4, 4);
      }
    return c;
  }
  const img = ctx.createImageData(size, size);
  const u32 = new Uint32Array(img.data.buffer);
  const code = surfaceCode(id);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const edge = s.outline && (x === 0 || y === 0 || x === size - 1 || y === size - 1);
      u32[y * size + x] = edge ? 0xff000000 : surfacePixel(code, x + 3, y + 1);
    }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Open the system color picker next to `anchor`; calls onPick with the chosen color. */
export function pickColor(anchor: HTMLElement, initial: readonly number[], onPick: (rgb: [number, number, number]) => void, onLive?: (rgb: [number, number, number]) => void): void {
  const input = h('input', { type: 'color', value: toHex(initial) });
  const r = anchor.getBoundingClientRect();
  Object.assign(input.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: '1px', height: '1px', opacity: '0', border: '0', padding: '0' });
  document.body.append(input);
  if (onLive) input.addEventListener('input', () => onLive(fromHex(input.value)));
  input.addEventListener('change', () => {
    onPick(fromHex(input.value));
    input.remove();
  });
  input.addEventListener('blur', () => setTimeout(() => input.remove(), 500));
  input.click();
}

export function buildPalette(ed: Editor): void {
  const pal = $('#palette');
  const current = h('div', { class: 'current', title: 'Left / right surfaces · click to swap (X)' });
  const currentName = h('div', { class: 'current-name' });
  current.addEventListener('click', () => ed.swapSurfaces());
  const golfRow = h('div', { class: 'swatches golf' });
  const colorRow = h('div', { class: 'swatches colors' });
  const customRow = h('div', { class: 'swatches custom', title: 'Custom colors — click an empty box to choose a color, double‑click to change it' });
  const all = new Map<string, HTMLButtonElement>();

  const editColor = (id: string, b: HTMLElement, thenSelect: boolean) =>
    pickColor(b, surfaceColor(id), (rgb) => {
      const old = ed.doc.colors[id];
      ed.setColors({ [id]: { ...old, color: rgb } }, `Color: ${surfaceById(id)!.name}`);
      if (thenSelect) ed.setSurface(id);
    });

  for (const s of SURFACES) {
    const b = h('button', { class: 'swatch' });
    b.addEventListener('click', () => {
      if (s.kind === 'custom' && !customSlotUsed(s.id)) return editColor(s.id, b, true);
      ed.setSurface(s.id);
    });
    b.addEventListener('dblclick', () => editColor(s.id, b, false));
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (s.kind === 'custom' && !customSlotUsed(s.id)) return;
      ed.setSurface(s.id, true);
    });
    all.set(s.id, b);
    (s.kind === 'golf' ? golfRow : s.kind === 'color' ? colorRow : customRow).append(b);
  }
  pal.append(h('div', { class: 'current-wrap' }, current, currentName), golfRow, colorRow, customRow);

  const renderSwatches = () =>
    all.forEach((b, id) => {
      const s = surfaceById(id)!;
      const empty = s.kind === 'custom' && !customSlotUsed(id);
      b.replaceChildren(swatchCanvas(id));
      if (s.kind === 'golf') b.append(h('span', { class: 'swatch-label', textContent: s.name.split(' ')[0] }));
      b.title = empty
        ? `${s.name} (empty) — click to choose a color`
        : `${s.name} — click: left · right‑click: right · double‑click: change color`;
    });

  const sync = () => {
    const fg = swatchCanvas(ed.surface, 22);
    fg.className = 'fg';
    const bgc = swatchCanvas(ed.surface2, 22);
    bgc.className = 'bg';
    current.replaceChildren(bgc, fg);
    currentName.replaceChildren(
      h('div', { textContent: surfaceById(ed.surface)!.name }),
      h('div', { class: 'second', textContent: `Right: ${surfaceById(ed.surface2)!.name}` }),
    );
    all.forEach((b, id) => {
      b.classList.toggle('active', id === ed.surface);
      b.classList.toggle('active2', id === ed.surface2 && id !== ed.surface);
    });
  };
  ed.on('surface', sync);
  ed.on('palette', () => {
    renderSwatches();
    sync();
  });
  renderSwatches();
  sync();
}

// =====================================================================
// Layers panel
// =====================================================================
export function buildLayersPanel(ed: Editor): void {
  const panel = $('#layers-panel');
  const list = h('div', { class: 'layer-list' });
  const btn = (label: string, title: string, fn: (e: MouseEvent) => void) => {
    const b = h('button', { class: 'small', textContent: label, title });
    b.addEventListener('click', fn);
    return b;
  };
  const structural = (label: string, fn: () => void) => {
    ed.history.begin(label);
    ed.history.snapshotLayers();
    fn();
    ed.history.commit();
    ed.invalidate();
    ed.emit('doc');
  };
  const actions = h(
    'div',
    { class: 'layer-actions' },
    btn('+ Paint', 'New paint (pixel) layer', () =>
      structural('Add paint layer', () => {
        const l = createRasterLayer(`Paint ${ed.doc.layers.length + 1}`, ed.doc.width, ed.doc.height);
        insertAboveActive(l);
      }),
    ),
    btn('+ Shapes', 'New shape layer', () =>
      structural('Add shape layer', () => {
        const l = createVectorLayer(`Shapes ${ed.doc.layers.length + 1}`);
        insertAboveActive(l);
      }),
    ),
    btn('+ Image', 'Import an underlay image to trace (or paste with ⌘V / drag one in)', () =>
      window.dispatchEvent(new Event('fairway:import-image')),
    ),
    btn('▲', 'Bring the selected layer up (draws on top of the one above). ⇧‑click: to the very top. Or drag layers in the list.', (e) => moveActive(1, e.shiftKey)),
    btn('▼', 'Send the selected layer down (draws underneath). ⇧‑click: to the very bottom.', (e) => moveActive(-1, e.shiftKey)),
    btn('✕', 'Delete layer', () => {
      const l = ed.activeLayer;
      if (!l || ed.doc.layers.length <= 1) return;
      if (!confirm(`Delete layer "${l.name}"? (You can undo this.)`)) return;
      structural('Delete layer', () => {
        const i = ed.doc.layers.indexOf(l);
        ed.doc.layers = ed.doc.layers.filter((x) => x !== l);
        ed.activeLayerId = ed.doc.layers[Math.max(0, i - 1)].id;
        ed.select(null);
      });
    }),
  );

  function insertAboveActive(l: (typeof ed.doc.layers)[number]) {
    const i = ed.activeLayer ? ed.doc.layers.indexOf(ed.activeLayer) : ed.doc.layers.length - 1;
    const layers = ed.doc.layers.slice();
    layers.splice(i + 1, 0, l);
    ed.doc.layers = layers;
    ed.activeLayerId = l.id;
  }
  function moveActive(dir: 1 | -1, all = false) {
    const l = ed.activeLayer;
    if (!l) return;
    const i = ed.doc.layers.indexOf(l);
    moveLayer(l.id, all ? (dir > 0 ? ed.doc.layers.length - 1 : 0) : i + dir);
  }
  /** Put a layer at index `to` (0 = bottom). */
  function moveLayer(id: string, to: number) {
    const i = ed.doc.layers.findIndex((x) => x.id === id);
    const j = Math.max(0, Math.min(ed.doc.layers.length - 1, to));
    if (i < 0 || i === j) return;
    structural('Reorder layers', () => {
      const layers = ed.doc.layers.slice();
      const [l] = layers.splice(i, 1);
      layers.splice(j, 0, l);
      ed.doc.layers = layers;
      ed.activeLayerId = id;
    });
  }
  let dragId: string | null = null;

  panel.append(h('div', { class: 'panel-title', textContent: 'Layers' }), list, actions);

  const render = () => {
    list.replaceChildren(
      ...[...ed.doc.layers].reverse().map((l) => {
        const eye = h('button', {
          class: `icon-btn${l.visible ? '' : ' off'}`,
          title: l.visible ? 'Hide' : 'Show',
          textContent: l.visible ? '👁' : '–',
        });
        eye.addEventListener('click', (e) => {
          e.stopPropagation();
          l.visible = !l.visible;
          ed.invalidate();
          if (!l.visible && ed.selection?.layerId === l.id) ed.select(null);
          render();
        });
        const lock = h('button', {
          class: `icon-btn${l.locked ? '' : ' off'}`,
          title: l.locked ? 'Unlock' : 'Lock',
          textContent: l.locked ? '🔒' : '🔓',
        });
        lock.addEventListener('click', (e) => {
          e.stopPropagation();
          l.locked = !l.locked;
          if (l.locked && ed.selection?.layerId === l.id) ed.select(null);
          render();
        });
        let outline: HTMLElement | string = '';
        if (l.kind === 'raster') {
          const ob = h('button', {
            class: `icon-btn outline-btn${l.outline ? '' : ' off'}`,
            title: l.outline ? 'Auto outlines on (click to turn off)' : 'Auto outlines off (click to turn on)',
            textContent: '▢',
          });
          ob.addEventListener('click', (e) => {
            e.stopPropagation();
            l.outline = !l.outline;
            ed.invalidate();
            ed.emit('history');
            render();
          });
          outline = ob;
        }
        const kind = h('span', {
          class: 'kind',
          title: {
            raster: 'Paint layer (pixels)',
            vector: 'Shape layer (editable shapes)',
            image: 'Underlay image (reference only — not exported)',
            map: 'Satellite map (reference only — not exported)',
            terrain: 'Terrain — hillshade and contours (drawn over your course)',
          }[l.kind],
          textContent: { raster: '▦', vector: '◆', image: '🖼', map: '🌎', terrain: '⛰' }[l.kind],
        });
        const name = h('span', { class: 'name', textContent: l.name });
        const count = l.kind === 'vector' ? h('span', { class: 'count', textContent: `${l.features.length}` }) : '';
        const row = h('div', { class: `layer${l.id === ed.activeLayerId ? ' active' : ''}` }, eye, lock, kind, name, count, outline);
        row.addEventListener('click', () => ed.setActiveLayer(l.id));
        // Drag a row to change the stacking order (top of the list draws on top).
        row.draggable = true;
        row.addEventListener('dragstart', (e) => {
          dragId = l.id;
          e.dataTransfer?.setData('text/plain', l.name);
          if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
          row.classList.add('dragging');
        });
        row.addEventListener('dragend', () => {
          dragId = null;
          list.querySelectorAll('.layer').forEach((r) => r.classList.remove('dragging', 'drop-above', 'drop-below'));
        });
        const above = (e: DragEvent) => {
          const r = row.getBoundingClientRect();
          return e.clientY < r.top + r.height / 2;
        };
        row.addEventListener('dragover', (e) => {
          if (!dragId || dragId === l.id) return;
          e.preventDefault();
          row.classList.toggle('drop-above', above(e));
          row.classList.toggle('drop-below', !above(e));
        });
        row.addEventListener('dragleave', () => row.classList.remove('drop-above', 'drop-below'));
        row.addEventListener('drop', (e) => {
          e.preventDefault();
          const id = dragId;
          if (!id || id === l.id) return;
          const from = ed.doc.layers.findIndex((x) => x.id === id);
          let to = ed.doc.layers.indexOf(l) + (above(e) ? 1 : 0); // list is shown top‑first
          if (from < to) to--;
          moveLayer(id, to);
        });
        row.addEventListener('dblclick', () => {
          const n = prompt('Layer name', l.name);
          if (n && n.trim()) {
            l.name = n.trim();
            render();
          }
        });
        return row;
      }),
    );
  };
  ed.on('doc', render);
  render();
}

// =====================================================================
// Info panel (selection / ruler / course)
// =====================================================================
export function buildInfoPanel(ed: Editor): void {
  const panel = $('#info-panel');
  const body = h('div', { class: 'info-body' });
  panel.append(h('div', { class: 'panel-title', textContent: 'Info' }), body);

  const row = (k: string, v: string) => h('div', { class: 'kv' }, h('span', { textContent: k }), h('b', { textContent: v }));

  const render = () => {
    const parts: Node[] = [];
    const hole = ed.selectedHole();
    if (hole) {
      parts.push(h('div', { class: 'info-head', textContent: `Hole ${hole.number}` }));
      parts.push(row('Yardage', `${holeYards(hole)} yd`));
      if (ed.doc.terrain) {
        const tee = ed.elevationAt(hole.points[0])!;
        const green = ed.elevationAt(hole.points[hole.points.length - 1])!;
        const climb = green - tee;
        parts.push(row('Tee → green', `${Math.round(tee)} → ${Math.round(green)} ft`));
        parts.push(
          row(
            climb >= 0 ? 'Uphill' : 'Downhill',
            `${Math.round(Math.abs(climb))} ft · plays ${playsLike(holeYards(hole), climb)} yd`,
          ),
        );
      }
      const num = h('input', { type: 'number', min: '1', max: '36', value: String(hole.number), class: 'num' });
      num.addEventListener('change', () => ed.renumberHole(hole.id, Math.round(+num.value)));
      const par = h('select', { class: 'num' });
      for (const p of [3, 4, 5, 6]) par.append(h('option', { value: String(p), textContent: String(p), selected: p === hole.par }));
      par.addEventListener('change', () => ed.updateHole(hole.id, 'Set par', () => ({ par: +par.value })));
      parts.push(h('div', { class: 'kv' }, h('span', { textContent: 'Number' }), num));
      parts.push(h('div', { class: 'kv' }, h('span', { textContent: 'Par' }), par));
      if (hole.points.length > 2) {
        const legs = hole.points.slice(1).map((p, i) => Math.round(dist(hole.points[i], p)));
        parts.push(row('Legs', legs.join(' + ')));
      }
      const del = h('button', { class: 'small', textContent: 'Delete hole' });
      del.addEventListener('click', () => ed.deleteHole(hole.id));
      const up = h('button', { class: 'small', textContent: 'Point up', title: 'Rotate the view so this hole plays straight up' });
      up.addEventListener('click', () => ed.pointHoleUp());
      parts.push(h('div', { class: 'btn-row' }, up, del));
      parts.push(...strategySection(ed, hole));
    }
    const active = ed.activeLayer;
    if (active?.kind === 'map') {
      const l = active;
      parts.push(h('div', { class: 'info-head', textContent: 'Satellite map' }));
      if (ed.doc.geo) {
        const k = ed.doc.yardsPerPixel;
        const c = worldToLatLon(ed.doc.geo, { x: (ed.doc.width * k) / 2, y: (ed.doc.height * k) / 2 });
        parts.push(row('Center', formatLatLon(c)));
      }
      const src = h('select');
      for (const s of Object.values(MAP_SOURCES)) src.append(h('option', { value: s.id, textContent: s.name, selected: s.id === l.source }));
      src.addEventListener('change', () => ed.updateMap(l, 'Imagery source', { source: src.value as MapSource }));
      parts.push(src);
      parts.push(h('div', { class: 'tip', textContent: MAP_SOURCES[l.source].license }));
      const op = h('input', { type: 'range', min: '0', max: '100', value: String(Math.round(l.opacity * 100)) });
      let before = l.opacity;
      op.addEventListener('pointerdown', () => (before = l.opacity));
      op.addEventListener('input', () => {
        l.opacity = +op.value / 100;
        ed.requestFrame();
      });
      op.addEventListener('change', () => {
        const v = l.opacity;
        l.opacity = before;
        ed.updateMap(l, 'Map opacity', { opacity: v });
      });
      parts.push(h('div', { class: 'kv' }, h('span', { textContent: 'Opacity' }), op));
      const relocate = h('button', { class: 'small', textContent: 'Change location…' });
      relocate.addEventListener('click', () => window.dispatchEvent(new Event('fairway:place-on-map')));
      const move = h('button', { class: 'small', textContent: 'Slide', title: 'Drag the map under the course (U)' });
      move.addEventListener('click', () => ed.setTool('underlay'));
      parts.push(h('div', { class: 'btn-row' }, relocate, move));
    }
    if (active?.kind === 'terrain' && ed.doc.terrain) {
      const l = active;
      const t = ed.doc.terrain;
      const { min, max } = minMax(t);
      parts.push(h('div', { class: 'info-head', textContent: 'Terrain' }));
      parts.push(row('Source', t.source === 'usgs' ? 'USGS 3DEP (real)' : 'Sculpted'));
      parts.push(row('Range', `${Math.round(min)}–${Math.round(max)} ft`));
      parts.push(row('Grid', `every ${Math.round(t.cell * ed.doc.yardsPerPixel)} yd`));
      const shade = h('input', { type: 'checkbox', checked: l.showShade });
      shade.addEventListener('change', () => ed.updateTerrainLayer({ showShade: shade.checked }));
      const cont = h('input', { type: 'checkbox', checked: l.showContours });
      cont.addEventListener('change', () => ed.updateTerrainLayer({ showContours: cont.checked }));
      parts.push(h('label', { class: 'opt' }, shade, 'Hillshade'), h('label', { class: 'opt' }, cont, 'Contour lines'));
      const iv = h('select', { class: 'num' });
      for (const v of [0.5, 1, 2, 5, 10, 20]) iv.append(h('option', { value: String(v), textContent: `${v} ft`, selected: v === l.interval }));
      iv.addEventListener('change', () => ed.updateTerrainLayer({ interval: +iv.value }));
      parts.push(h('div', { class: 'kv' }, h('span', { textContent: 'Contour every' }), iv));
      const op = h('input', { type: 'range', min: '10', max: '100', value: String(Math.round(l.opacity * 100)) });
      op.addEventListener('input', () => {
        l.opacity = +op.value / 100;
        ed.requestFrame();
      });
      op.addEventListener('change', () => ed.updateTerrainLayer({ opacity: +op.value / 100 }));
      parts.push(h('div', { class: 'kv' }, h('span', { textContent: 'Strength' }), op));
      const shape = h('button', { class: 'small', textContent: 'Shape (D)' });
      shape.addEventListener('click', () => ed.setTool('terrain'));
      parts.push(h('div', { class: 'btn-row' }, shape));
    }
    if (active?.kind === 'image') {
      const l = active;
      parts.push(h('div', { class: 'info-head', textContent: 'Underlay image' }));
      const op = h('input', { type: 'range', min: '0', max: '100', value: String(Math.round(l.opacity * 100)) });
      op.addEventListener('input', () => {
        l.opacity = +op.value / 100;
        ed.requestFrame();
      });
      let before = l.opacity;
      op.addEventListener('pointerdown', () => (before = l.opacity));
      op.addEventListener('change', () => {
        const v = l.opacity;
        l.opacity = before;
        ed.updateImage(l, 'Underlay opacity', { opacity: v });
      });
      parts.push(h('div', { class: 'kv' }, h('span', { textContent: 'Opacity' }), op));
      const rot = h('input', { type: 'number', step: '0.5', value: String(+l.rotation.toFixed(2)), class: 'num' });
      rot.addEventListener('change', () => ed.updateImage(l, 'Rotate underlay', { rotation: +rot.value || 0 }));
      parts.push(h('div', { class: 'kv' }, h('span', { textContent: 'Rotation °' }), rot));
      parts.push(row('Scale', `1 px = ${l.scale < 1 ? l.scale.toFixed(3) : l.scale.toFixed(2)} yd`));
      const above = h('input', { type: 'checkbox', checked: l.above });
      above.addEventListener('change', () => ed.updateImage(l, 'Underlay on top', { above: above.checked }));
      parts.push(h('label', { class: 'opt' }, above, 'Show above drawing'));
      const setScale = h('button', { class: 'small', textContent: 'Set scale…', title: 'Click two points a known distance apart' });
      setScale.addEventListener('click', () => ed.setTool('scale'));
      const move = h('button', { class: 'small', textContent: 'Move', title: 'Drag the image (U)' });
      move.addEventListener('click', () => ed.setTool('underlay'));
      parts.push(h('div', { class: 'btn-row' }, setScale, move));
    }
    const sel = ed.selected();
    if (sel && ed.multiSelected) {
      const shapes = ed.selectedShapes();
      const ypp = ed.doc.yardsPerPixel;
      let area = 0;
      for (const s of shapes) area += polygonArea(flatten(s.feature, ypp).flat.poly) * ypp * ypp;
      parts.push(h('div', { class: 'info-head', textContent: `${shapes.length} shapes selected` }));
      parts.push(row('Total area', formatArea(area)));
      const comb = h('button', { class: 'small', textContent: 'Combine', title: 'Merge into one shape (⌘J). The shapes must touch or overlap.' });
      comb.addEventListener('click', () => ed.combineSelection());
      const mv = h('button', { class: 'small', textContent: 'Move by…', title: 'Move an exact number of yards' });
      mv.addEventListener('click', () => window.dispatchEvent(new Event('fairway:move-shapes')));
      parts.push(h('div', { class: 'btn-row' }, comb, mv));
      const dup = h('button', { class: 'small', textContent: 'Duplicate' });
      dup.addEventListener('click', () => ed.duplicateSelection());
      const del = h('button', { class: 'small', textContent: 'Delete' });
      del.addEventListener('click', () => ed.deleteSelection());
      parts.push(h('div', { class: 'btn-row' }, dup, del));
      parts.push(h('div', { class: 'tip', textContent: 'Drag any of them to move the group. Arrow keys nudge 1 yd (⇧ 10 yd). ⇧‑click a shape to add or remove it.' }));
    } else if (sel) {
      const f = sel.feature;
      const ypp = ed.doc.yardsPerPixel;
      const { flat, bbox } = flatten(f, ypp);
      const area = polygonArea(flat.poly) * ypp * ypp;
      parts.push(h('div', { class: 'info-head', textContent: `${surfaceById(f.surface)?.name ?? f.surface} shape` }));
      parts.push(row('Area', formatArea(area)));
      parts.push(row('Size', `${Math.round(bbox.w * ypp)} × ${Math.round(bbox.h * ypp)} yd`));
      parts.push(row('Points', `${f.points.length}`));
      const cb = h('input', { type: 'checkbox', checked: f.smooth });
      cb.addEventListener('change', () => ed.setSelectedSmooth(cb.checked));
      parts.push(h('label', { class: 'opt' }, cb, 'Smooth curves'));
      const del = h('button', { class: 'small', textContent: 'Delete shape' });
      del.addEventListener('click', () => ed.deleteSelection());
      const dup = h('button', { class: 'small', textContent: 'Duplicate' });
      dup.addEventListener('click', () => ed.duplicateSelection());
      parts.push(h('div', { class: 'btn-row' }, dup, del));
      if (ed.tool.id === 'select') parts.push(h('div', { class: 'tip', textContent: 'Tip: click a palette swatch to change this shape’s surface.' }));
    }
    const reg = ed.region;
    if (reg) {
      const ypp = ed.doc.yardsPerPixel;
      const name = SURFACES[reg.code - 1]?.name ?? 'Painted';
      parts.push(h('div', { class: 'info-head', textContent: `${name} (painted)` }));
      parts.push(row('Area', formatArea(reg.count * ypp * ypp)));
      parts.push(row('Size', `${Math.round(reg.rect.w * ypp)} × ${Math.round(reg.rect.h * ypp)} yd`));
      const mk = h('button', { class: 'small', textContent: 'Make shape', title: 'Turn into an editable shape with drag points' });
      mk.addEventListener('click', () => ed.regionToShape());
      const del = h('button', { class: 'small', textContent: 'Delete' });
      del.addEventListener('click', () => ed.eraseRegion());
      parts.push(h('div', { class: 'btn-row' }, mk, del));
      parts.push(h('div', { class: 'tip', textContent: 'Tip: click a palette swatch to repaint this area.' }));
    }
    const r = ed.ruler;
    if (r.points.length) {
      const pts = r.active && r.live ? [...r.points, r.live] : r.points;
      parts.push(h('div', { class: 'info-head', textContent: 'Measurement' }));
      parts.push(row('Total', `${Math.round(pathLength(pts))} yd`));
      if (ed.doc.terrain && pts.length > 1) {
        const climb = ed.elevationAt(pts[pts.length - 1])! - ed.elevationAt(pts[0])!;
        parts.push(row('Elevation change', `${climb >= 0 ? '+' : '−'}${Math.round(Math.abs(climb))} ft`));
      }
      if (pts.length > 2) parts.push(row('Legs', `${pts.length - 1}`));
      const clr = h('button', { class: 'small', textContent: 'Clear' });
      clr.addEventListener('click', () => ed.clearRuler());
      parts.push(h('div', { class: 'btn-row' }, clr));
    }
    const d = ed.doc;
    parts.push(h('div', { class: 'info-head', textContent: 'Course' }));
    parts.push(row('Name', d.name));
    parts.push(row('Area', `${Math.round(d.width * d.yardsPerPixel)} × ${Math.round(d.height * d.yardsPerPixel)} yd`));
    parts.push(row('1 pixel', `${d.yardsPerPixel} yd`));
    body.replaceChildren(...parts);
  };
  ed.on('selection', render);
  ed.on('doc', render);
  ed.on('tool', render);
  ed.on('holes', render);
  // ruler updates arrive as 'status' (frequent) — only re-render when a ruler exists
  ed.on('status', () => {
    if (ed.ruler.points.length || body.querySelector('.info-head')?.textContent === 'Measurement') render();
  });
  render();
}

// =====================================================================
// Scorecard
// =====================================================================
export function buildScorecard(ed: Editor): void {
  const panel = $('#scorecard-panel');
  const body = h('div', { class: 'scorecard' });
  panel.append(h('div', { class: 'panel-title', textContent: 'Scorecard' }), body);
  const render = () => {
    const holes = [...ed.doc.holes].sort((a, b) => a.number - b.number);
    if (!holes.length) {
      body.replaceChildren(h('div', { class: 'tip', textContent: 'No holes yet. Pick the Hole tool (O): click the tee, any aim points, then double‑click the green.' }));
      return;
    }
    const table = h('table');
    table.append(h('tr', {}, h('th', { textContent: 'Hole' }), h('th', { textContent: 'Par' }), h('th', { textContent: 'Yards' })));
    const total = (hs: typeof holes, label: string) =>
      h(
        'tr',
        { class: 'total' },
        h('td', { textContent: label }),
        h('td', { textContent: String(hs.reduce((n, x) => n + x.par, 0)) }),
        h('td', { textContent: hs.reduce((n, x) => n + holeYards(x), 0).toLocaleString() }),
      );
    const front = holes.filter((x) => x.number <= 9);
    const back = holes.filter((x) => x.number > 9);
    const split = front.length > 0 && back.length > 0;
    for (const x of holes) {
      const tr = h(
        'tr',
        { class: x.id === ed.selectedHoleId ? 'sel' : '' },
        h('td', { textContent: String(x.number) }),
        h('td', { textContent: String(x.par) }),
        h('td', { textContent: holeYards(x).toLocaleString() }),
      );
      tr.addEventListener('click', () => {
        ed.selectHole(x.id);
        const mid = x.points[Math.floor(x.points.length / 2)];
        ed.centerOn(mid);
      });
      table.append(tr);
      if (split && x === front[front.length - 1]) table.append(total(front, 'Out'));
    }
    if (split) table.append(total(back, 'In'));
    table.append(total(holes, 'Total'));
    body.replaceChildren(table);
  };
  ed.on('holes', render);
  ed.on('history', render);
  ed.on('doc', render);
  render();
}

// =====================================================================
// Status bar
// =====================================================================
export function buildStatusBar(ed: Editor): void {
  const bar = $('#statusbar');
  const hint = h('div', { class: 'cell grow' });
  const pos = h('div', { class: 'cell', title: 'Cursor position (yards)' });
  const layer = h('div', { class: 'cell', title: 'Active layer' });
  const zoom = h('div', { class: 'cell', title: 'Zoom' });
  const rot = h('input', { type: 'number', step: '1', class: 'rot', title: 'View rotation in degrees (R / ⇧R turns 15°)' });
  rot.addEventListener('change', () => {
    ed.rotateView(+rot.value || 0);
    rot.blur();
  });
  const rotCell = h('label', { class: 'cell rot-cell', title: 'View rotation' }, '↻ ', rot, '°');
  bar.append(hint, layer, pos, rotCell, zoom);
  const render = () => {
    hint.textContent = ed.message || ed.tool.hint;
    const hv = ed.hover;
    pos.textContent = hv
      ? `${Math.round(hv.world.x)}, ${Math.round(hv.world.y)} yd${ed.doc.terrain ? `  ·  ${Math.round(ed.elevationAt(hv.world)!)} ft` : ''}${
          ed.doc.geo ? `  ·  ${formatLatLon(worldToLatLon(ed.doc.geo, hv.world))}` : ''
        }`
      : '';
    layer.textContent = ed.activeLayer ? `${ed.activeLayer.kind === 'raster' ? '▦' : '◆'} ${ed.activeLayer.name}` : '';
    zoom.textContent = `${Math.round(ed.zoom * 100)}%`;
    if (document.activeElement !== rot) rot.value = String(Math.round(ed.rotation * 10) / 10);
  };
  ed.on('status', render);
  ed.on('view', render);
  ed.on('doc', render);
  ed.on('tool', () => {
    ed.message = '';
    render();
  });
  render();
}

// =====================================================================
// Dialogs
// =====================================================================
export function dialog(title: string, content: HTMLElement, buttons: { label: string; primary?: boolean; onClick: () => boolean | void }[]): () => void {
  const overlay = h('div', { class: 'modal-overlay' });
  const btnRow = h('div', { class: 'dialog-buttons' });
  const win = h(
    'div',
    { class: 'window dialog' },
    h('div', { class: 'title-bar', textContent: title }),
    h('div', { class: 'dialog-body' }, content),
    btnRow,
  );
  const close = () => overlay.remove();
  for (const b of buttons) {
    const el = h('button', { textContent: b.label, class: b.primary ? 'primary' : '' });
    el.addEventListener('click', () => {
      if (b.onClick() !== false) close();
    });
    btnRow.append(el);
  }
  overlay.append(win);
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const cancel = buttons.find((b) => /cancel|close/i.test(b.label));
      cancel?.onClick();
      close();
    }
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') {
      const primary = buttons.find((b) => b.primary);
      if (primary && primary.onClick() !== false) close();
    }
    e.stopPropagation();
  });
  document.body.append(overlay);
  (win.querySelector('input, select, button') as HTMLElement | null)?.focus();
  return close;
}

export function field(label: string, input: HTMLElement, note?: string): HTMLElement {
  return h('label', { class: 'field' }, h('span', { textContent: label }), input, note ? h('small', { textContent: note }) : '');
}

export { h, rgbCss };

// =====================================================================
// Strategy (part of the hole info)
// =====================================================================
function strategySection(ed: Editor, hole: Hole): Node[] {
  const parts: Node[] = [h('div', { class: 'info-head', textContent: 'Strategy' })];
  const cb = h('input', { type: 'checkbox', checked: ed.showStrategy });
  cb.addEventListener('change', () => ed.setStrategy({ show: cb.checked }));
  parts.push(h('label', { class: 'opt' }, cb, 'Show landing patterns (S)'));
  const sel = h('select', { class: 'player-select' });
  for (const p of ed.players) sel.append(h('option', { value: p.id, textContent: p.name, selected: p.id === ed.strategyPlayer }));
  sel.append(h('option', { value: 'all', textContent: 'All players', selected: ed.strategyPlayer === 'all' }));
  sel.addEventListener('change', () => ed.setStrategy({ player: sel.value, show: true }));
  const edit = h('button', { class: 'small', textContent: 'Players…', title: 'Distances and accuracy for each player' });
  edit.addEventListener('click', () => window.dispatchEvent(new Event('fairway:players')));
  parts.push(h('div', { class: 'kv' }, sel, edit));
  if (!ed.showStrategy) return parts;
  const results = ed.strategyFor(hole);
  for (const r of results) {
    if (ed.strategyPlayer === 'all') {
      const name = h('div', { class: 'strat-player', textContent: r.player.name });
      name.style.color = r.player.color;
      parts.push(name);
    }
    for (const shot of r.shots) {
      const od = r.odds[shot.index];
      const title = `Shot ${shot.index + 1}${shot.extra ? ' (extra)' : ''} · ${Math.round(shot.yards)} yd${shot.toGreen && shot.short <= 1 ? ' to green' : ''}`;
      parts.push(h('div', { class: 'strat-shot' }, h('span', { textContent: title }), h('span', { class: 'strat-trouble', textContent: `${Math.round(troubleShare(od) * 100)}% trouble` })));
      const bar = h('div', { class: 'strat-bar' });
      for (const o of od) {
        const seg = h('span', { title: `${Math.round(o.share * 100)}% ${OUTCOMES[o.outcome].label}` });
        seg.style.width = `${o.share * 100}%`;
        seg.style.background = OUTCOMES[o.outcome].color;
        bar.append(seg);
      }
      parts.push(bar);
      const text = od.filter((o) => o.share >= 0.02).map((o) => `${Math.round(o.share * 100)}% ${OUTCOMES[o.outcome].label}`).join(' · ');
      parts.push(h('div', { class: 'strat-text', textContent: text }));
      if (shot.custom && r === results[0]) {
        const reset = h('button', { class: 'small', textContent: 'Aim at line of play', title: 'Undo the dragged target (or double‑click the oval’s centre)' });
        reset.addEventListener('click', () => ed.setShotTarget(hole.id, shot.index, null));
        parts.push(h('div', { class: 'btn-row' }, reset));
      }
      if (shot.short > 1)
        parts.push(h('div', { class: 'strat-text warn', textContent: `Can’t reach: finishes ${Math.round(shot.short)} yd short of the ${shot.toGreen ? 'green' : 'target'}.` }));
    }
  }
  parts.push(h('div', { class: 'tip', textContent: 'Ovals hold about 4 in 10 (solid) and 9 in 10 (dashed) shots. Drag an oval’s centre dot to aim that shot somewhere else, such as the middle of the green (Select or Hole tool). Double‑click the dot to reset.' }));
  return parts;
}

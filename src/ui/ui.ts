import { polygonArea, pathLength } from '../geom/geom';
import type { Editor, ToolId } from '../editor/editor';
import { createRasterLayer, createVectorLayer } from '../model/doc';
import { SURFACES, surfaceById, surfaceCode, surfacePixel, rgbCss } from '../model/surfaces';
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
  'select',
  'freehand',
  'polygon',
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
      opts.append(grid, h('div', { class: 'opt-note', textContent: `${ed.brushSize}px` }));
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
function swatchCanvas(id: string, size = 16): HTMLCanvasElement {
  const c = h('canvas', { width: size, height: size });
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const u32 = new Uint32Array(img.data.buffer);
  const code = surfaceCode(id);
  const s = surfaceById(id)!;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const edge = s.outline && (x === 0 || y === 0 || x === size - 1 || y === size - 1);
      u32[y * size + x] = edge ? 0xff000000 : surfacePixel(code, x + 3, y + 1);
    }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function buildPalette(ed: Editor): void {
  const pal = $('#palette');
  const current = h('div', { class: 'current', title: 'Left‑click / right‑click surfaces · click to swap (X)' });
  const currentName = h('div', { class: 'current-name' });
  current.addEventListener('click', () => ed.swapSurfaces());
  const golfRow = h('div', { class: 'swatches golf' });
  const colorRow = h('div', { class: 'swatches colors' });
  const all = new Map<string, HTMLElement>();
  for (const s of SURFACES) {
    const b = h('button', { class: 'swatch', title: s.name });
    b.append(swatchCanvas(s.id));
    if (s.kind === 'golf') b.append(h('span', { class: 'swatch-label', textContent: s.name.split(' ')[0] }));
    b.title = `${s.name} — click: left surface · right‑click: right surface`;
    b.addEventListener('click', () => ed.setSurface(s.id));
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      ed.setSurface(s.id, true);
    });
    all.set(s.id, b);
    (s.kind === 'golf' ? golfRow : colorRow).append(b);
  }
  pal.append(h('div', { class: 'current-wrap' }, current, currentName), golfRow, colorRow);
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
  sync();
}

// =====================================================================
// Layers panel
// =====================================================================
export function buildLayersPanel(ed: Editor): void {
  const panel = $('#layers-panel');
  const list = h('div', { class: 'layer-list' });
  const btn = (label: string, title: string, fn: () => void) => {
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
    btn('▲', 'Move layer up', () => moveActive(1)),
    btn('▼', 'Move layer down', () => moveActive(-1)),
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
  function moveActive(dir: 1 | -1) {
    const l = ed.activeLayer;
    if (!l) return;
    const i = ed.doc.layers.indexOf(l);
    const j = i + dir;
    if (j < 0 || j >= ed.doc.layers.length) return;
    structural('Reorder layers', () => {
      const layers = ed.doc.layers.slice();
      [layers[i], layers[j]] = [layers[j], layers[i]];
      ed.doc.layers = layers;
    });
  }

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
          title: l.kind === 'raster' ? 'Paint layer (pixels)' : 'Shape layer (editable shapes)',
          textContent: l.kind === 'raster' ? '▦' : '◆',
        });
        const name = h('span', { class: 'name', textContent: l.name });
        const count = l.kind === 'vector' ? h('span', { class: 'count', textContent: `${l.features.length}` }) : '';
        const row = h('div', { class: `layer${l.id === ed.activeLayerId ? ' active' : ''}` }, eye, lock, kind, name, count, outline);
        row.addEventListener('click', () => ed.setActiveLayer(l.id));
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
    const sel = ed.selected();
    if (sel) {
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
  // ruler updates arrive as 'status' (frequent) — only re-render when a ruler exists
  ed.on('status', () => {
    if (ed.ruler.points.length || body.querySelector('.info-head')?.textContent === 'Measurement') render();
  });
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
  bar.append(hint, layer, pos, zoom);
  const render = () => {
    hint.textContent = ed.message || ed.tool.hint;
    const hv = ed.hover;
    pos.textContent = hv ? `${Math.round(hv.world.x)}, ${Math.round(hv.world.y)} yd` : '';
    layer.textContent = ed.activeLayer ? `${ed.activeLayer.kind === 'raster' ? '▦' : '◆'} ${ed.activeLayer.name}` : '';
    zoom.textContent = `${Math.round(ed.zoom * 100)}%`;
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
    if (e.key === 'Escape') close();
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

import { Editor, isTyping, type ToolId } from './editor/editor';
import { registerAllTools } from './editor/tools';
import { createDoc, MAX_DOC_PIXELS } from './model/doc';
import { deserialize, FILE_EXT, idbGet, idbSet, serialize } from './model/io';
import { SURFACES, rgbCss, surfaceById, surfaceColor, surfaceColor2, type ColorMap } from './model/surfaces';
import { createImageLayer } from './model/doc';
import { drawHoles } from './editor/holes';
import { loadImageBlob } from './editor/underlay';
import { drawTerrain } from './terrain/render';
import { createTerrain } from './terrain/terrain';
import { MAP_SOURCES } from './editor/maptiles';
import { formatLatLon, parseCoords } from './geo/geo';
import type { MapSource } from './model/types';
import { THEMES } from './model/themes';
import {
  buildInfoPanel,
  buildLayersPanel,
  buildMenuBar,
  buildPalette,
  buildScorecard,
  buildStatusBar,
  buildToolbox,
  dialog,
  field,
  fromHex,
  h,
  toHex,
} from './ui/ui';

const AUTOSAVE_KEY = 'autosave';
const AUTOSAVE_DELAY = 1500;

// File System Access API (Chrome/Edge). Safari falls back to download/upload.
interface FileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(d: Blob | string): Promise<void>; close(): Promise<void> }>;
}
type PickerWindow = Window & {
  showSaveFilePicker?: (o: unknown) => Promise<FileHandle>;
  showOpenFilePicker?: (o: unknown) => Promise<FileHandle[]>;
};
const win = window as PickerWindow;
const PICKER_TYPES = [{ description: 'Fairway Paint course', accept: { 'application/json': [FILE_EXT] } }];

export class App {
  readonly ed: Editor;
  private fileHandle: FileHandle | null = null;
  private autosaveTimer = 0;
  private unsaved = false;

  constructor() {
    this.ed = new Editor(document.querySelector('#view') as HTMLCanvasElement);
    registerAllTools(this.ed);
    this.ed.setTool('brush');
    this.ed.setDoc(createDoc());

    buildMenuBar(this.menus());
    buildToolbox(this.ed);
    buildPalette(this.ed);
    buildLayersPanel(this.ed);
    buildInfoPanel(this.ed);
    buildStatusBar(this.ed);
    buildScorecard(this.ed);
    this.bindImageInput();
    this.bindKeys();

    this.ed.on('history', () => {
      this.unsaved = true;
      this.updateTitle();
      this.scheduleAutosave();
    });
    this.ed.on('doc', () => this.updateTitle());
    this.updateTitle();
    void this.restoreAutosave();
  }

  // ------------------------------------------------------------ files
  private updateTitle(): void {
    document.title = `${this.unsaved ? '• ' : ''}${this.ed.doc.name} — Fairway Paint`;
  }

  private scheduleAutosave(): void {
    window.clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => {
      idbSet(AUTOSAVE_KEY, serialize(this.ed.doc)).catch((err) => console.warn('Autosave failed', err));
    }, AUTOSAVE_DELAY);
  }

  private async restoreAutosave(): Promise<void> {
    try {
      const text = await idbGet<string>(AUTOSAVE_KEY);
      if (!text) return;
      this.ed.setDoc(deserialize(text));
      this.ed.setMessage('Restored your last session (autosaved).');
    } catch (err) {
      console.warn('Could not restore autosave', err);
    }
  }

  newCourseDialog(): void {
    const name = h('input', { value: 'Untitled course' });
    const size = h('select');
    const presets: [string, number, number][] = [
      ['Single hole / short course — 800 × 600 yd', 800, 600],
      ['9 holes — 1500 × 1000 yd', 1500, 1000],
      ['18 holes — 2000 × 1400 yd', 2000, 1400],
      ['Big property — 3000 × 2000 yd', 3000, 2000],
    ];
    presets.forEach(([label], i) => size.append(h('option', { value: String(i), textContent: label })));
    size.value = '2';
    const detail = h('select');
    detail.append(
      h('option', { value: '1', textContent: '1 pixel = 1 yard (classic)' }),
      h('option', { value: '0.5', textContent: '1 pixel = ½ yard (more detail)' }),
      h('option', { value: '2', textContent: '1 pixel = 2 yards (huge areas)' }),
    );
    const bg = h('select');
    bg.append(h('option', { value: 'white', textContent: 'White paper' }), h('option', { value: 'grass', textContent: 'Grass' }));
    const form = h(
      'div',
      { class: 'form' },
      field('Course name', name),
      field('Property size', size),
      field('Pixel size', detail, 'Distances are always measured in yards.'),
      field('Background', bg),
    );
    dialog('New course', form, [
      {
        label: 'Create',
        primary: true,
        onClick: () => {
          const [, w, hgt] = presets[+size.value];
          const ypp = +detail.value;
          if ((w / ypp) * (hgt / ypp) > MAX_DOC_PIXELS) {
            alert('That size is too big at this pixel size. Pick a smaller property or a bigger pixel.');
            return false;
          }
          if (this.unsaved && !confirm('Start a new course? Unsaved changes to the current course will be lost (it stays in autosave until you draw in the new one).'))
            return false;
          this.fileHandle = null;
          this.unsaved = false;
          this.ed.setDoc(createDoc({ name: name.value.trim() || 'Untitled course', widthYards: w, heightYards: hgt, yardsPerPixel: ypp, background: bg.value }));
          this.scheduleAutosave();
        },
      },
      { label: 'Cancel', onClick: () => {} },
    ]);
  }

  /** Pick a theme and tweak every golf surface's colors, with live preview. */
  courseColorsDialog(): void {
    const ed = this.ed;
    const original: ColorMap = JSON.parse(JSON.stringify(ed.doc.colors));
    let working: ColorMap = JSON.parse(JSON.stringify(original));
    const golf = SURFACES.filter((s) => s.kind === 'golf');

    const theme = h('select');
    theme.append(h('option', { value: '', textContent: '— keep current —' }));
    for (const t of THEMES) theme.append(h('option', { value: t.id, textContent: `${t.name} — ${t.description}` }));

    const rows = h('div', { class: 'color-rows' });
    const preview = () => {
      ed.previewColors(JSON.parse(JSON.stringify(working)));
      renderRows();
    };
    const renderRows = () => {
      rows.replaceChildren(
        ...golf.map((s) => {
          const main = h('input', { type: 'color', value: toHex(surfaceColor(s.id)), title: 'Main color' });
          main.addEventListener('input', () => {
            working[s.id] = { ...working[s.id], color: fromHex(main.value) };
            ed.previewColors(JSON.parse(JSON.stringify(working)));
          });
          const cells: (HTMLElement | string)[] = [h('span', { textContent: s.name }), main];
          if (s.pattern !== 'none') {
            const det = h('input', { type: 'color', value: toHex(surfaceColor2(s.id)), title: 'Pattern / detail color' });
            det.addEventListener('input', () => {
              working[s.id] = { color: working[s.id]?.color ?? surfaceColor(s.id), color2: fromHex(det.value) };
              ed.previewColors(JSON.parse(JSON.stringify(working)));
            });
            cells.push(det);
          } else cells.push(h('span'));
          const reset = h('button', { class: 'small', textContent: 'Reset', title: 'Back to the default color' });
          reset.disabled = !working[s.id];
          reset.addEventListener('click', () => {
            delete working[s.id];
            preview();
          });
          cells.push(reset);
          return h('div', { class: 'color-row' }, ...cells);
        }),
      );
    };
    theme.addEventListener('change', () => {
      const t = THEMES.find((x) => x.id === theme.value);
      if (!t) return;
      // Themes replace golf colors but keep custom-slot colors.
      const keep = Object.fromEntries(Object.entries(working).filter(([id]) => surfaceById(id)?.kind !== 'golf'));
      working = { ...keep, ...JSON.parse(JSON.stringify(t.colors)) };
      preview();
    });
    renderRows();

    const body = h(
      'div',
      { class: 'form' },
      field('Preset', theme),
      h('div', { class: 'color-head' }, h('span', { textContent: 'Surface' }), h('span', { textContent: 'Color' }), h('span', { textContent: 'Detail' }), h('span')),
      rows,
      h('small', { textContent: 'Colors are saved with this course. Plain and custom colors: double‑click their swatch.' }),
    );
    dialog('Course colors', body, [
      {
        label: 'OK',
        primary: true,
        onClick: () => {
          const final = working;
          ed.previewColors(original); // so the undo step records the real "before"
          ed.setColors(final, 'Change course colors', true);
        },
      },
      { label: 'Cancel', onClick: () => ed.previewColors(original) },
    ]);
  }

  // ------------------------------------------------------------ underlay import
  async importImage(blob: Blob): Promise<void> {
    const ed = this.ed;
    try {
      const { src, w, h: hgt } = await loadImageBlob(blob);
      const k = ed.doc.yardsPerPixel;
      const docW = ed.doc.width * k;
      const docH = ed.doc.height * k;
      const v = ed.visibleWorld();
      const x0 = Math.max(0, v.x);
      const y0 = Math.max(0, v.y);
      const vw = Math.min(docW, v.x + v.w) - x0;
      const vh = Math.min(docH, v.y + v.h) - y0;
      const scale = Math.min((vw * 0.9) / w, (vh * 0.9) / hgt);
      const layer = createImageLayer(`Underlay ${ed.doc.layers.filter((l) => l.kind === 'image').length + 1}`, src, w, hgt, {
        scale,
        x: x0 + (vw - w * scale) / 2,
        y: y0 + (vh - hgt * scale) / 2,
      });
      ed.history.begin('Import underlay');
      ed.history.snapshotLayers();
      ed.doc.layers = [layer, ...ed.doc.layers];
      ed.history.commit();
      ed.setActiveLayer(layer.id);
      ed.setTool('scale');
      ed.setMessage('Underlay added. Now click two points you know the distance between (Set scale), or press U to move it.');
    } catch (err) {
      alert(`Could not import image: ${(err as Error).message}`);
    }
  }

  async importImageDialog(): Promise<void> {
    try {
      await this.importImage(await pickFile('image/*'));
    } catch (err) {
      if ((err as Error).name !== 'AbortError') alert((err as Error).message);
    }
  }

  /** Paste (⌘V) a screenshot or drop an image file onto the canvas. */
  private bindImageInput(): void {
    window.addEventListener('paste', (e) => {
      if (isTyping(e)) return;
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) {
        e.preventDefault();
        void this.importImage(file);
      }
    });
    const ws = document.querySelector('#workspace') as HTMLElement;
    ws.addEventListener('dragover', (e) => {
      if ([...(e.dataTransfer?.items ?? [])].some((i) => i.kind === 'file')) {
        e.preventDefault();
        ws.classList.add('drop');
      }
    });
    ws.addEventListener('dragleave', () => ws.classList.remove('drop'));
    ws.addEventListener('drop', (e) => {
      ws.classList.remove('drop');
      const file = [...(e.dataTransfer?.files ?? [])][0];
      if (!file) return;
      e.preventDefault();
      if (file.type.startsWith('image/')) void this.importImage(file);
      else if (file.name.endsWith(FILE_EXT)) void file.text().then((t) => this.loadText(t, file.name));
    });
    window.addEventListener('fairway:import-image', () => void this.importImageDialog());
    window.addEventListener('fairway:place-on-map', () => this.placeOnMapDialog());
  }

  private loadText(text: string, name: string): void {
    if (this.unsaved && !confirm('Open another course? Unsaved changes to the current course will be lost.')) return;
    try {
      this.fileHandle = null;
      this.unsaved = false;
      this.ed.setDoc(deserialize(text));
      this.scheduleAutosave();
      this.ed.setMessage(`Opened ${name}`);
    } catch (err) {
      alert(`Could not open: ${(err as Error).message}`);
    }
  }

  // ------------------------------------------------------------ real-world placement
  placeOnMapDialog(): void {
    const ed = this.ed;
    const query = h('input', { placeholder: 'e.g. Pebble Beach Golf Links, an address, or 36.568, -121.950', class: 'wide' });
    const go = h('button', { textContent: 'Search' });
    const results = h('div', { class: 'results' });
    const source = h('select');
    for (const s of Object.values(MAP_SOURCES)) source.append(h('option', { value: s.id, textContent: s.name }));
    source.value = ed.mapLayer()?.source ?? 'usgs';
    const license = h('small');
    const syncLicense = () => (license.textContent = MAP_SOURCES[source.value as MapSource].license);
    source.addEventListener('change', syncLicense);
    syncLicense();
    let chosen: { lat: number; lon: number; label: string } | null = null;

    const choose = (c: { lat: number; lon: number; label: string }, row?: HTMLElement) => {
      chosen = c;
      results.querySelectorAll('.result').forEach((r) => r.classList.remove('sel'));
      row?.classList.add('sel');
    };
    const show = (items: { lat: number; lon: number; label: string; golf?: boolean }[], note?: string) => {
      results.replaceChildren();
      if (note) results.append(h('div', { class: 'tip', textContent: note }));
      items.forEach((it, i) => {
        const r = h('div', { class: 'result', textContent: `${it.golf ? '⛳ ' : ''}${it.label}` });
        r.addEventListener('click', () => choose(it, r));
        r.addEventListener('dblclick', () => {
          choose(it, r);
          place();
        });
        results.append(r);
        if (i === 0) choose(it, r);
      });
    };
    const search = async () => {
      const q = query.value.trim();
      if (!q) return;
      const c = parseCoords(q);
      if (c) return show([{ ...c, label: `Coordinates ${formatLatLon(c)}` }]);
      show([], 'Searching…');
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&countrycodes=us&q=${encodeURIComponent(q)}`;
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(`search service answered ${res.status}`);
        const data: { lat: string; lon: string; display_name: string; type?: string; category?: string }[] = await res.json();
        if (!data.length) return show([], 'No US places found. Try the course name plus its town, or paste coordinates.');
        const items = data.map((d) => ({ lat: +d.lat, lon: +d.lon, label: d.display_name, golf: d.type === 'golf_course' }));
        items.sort((a, b) => Number(!!b.golf) - Number(!!a.golf));
        show(items);
      } catch (err) {
        show([], `Search failed (${(err as Error).message}). You can paste coordinates or a Google Maps link instead.`);
      }
    };
    go.addEventListener('click', () => void search());
    query.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        void search();
      }
    });
    const place = () => {
      if (!chosen) return false;
      ed.placeOnMap(chosen.lat, chosen.lon, source.value as MapSource);
      this.ed.setMessage(`Course placed at ${formatLatLon(chosen)}. Distances now match the real ground. Press U with the map layer selected to slide it.`);
      closeDlg();
      return true;
    };
    const body = h(
      'div',
      { class: 'form' },
      h('div', { class: 'search-row' }, query, go),
      h('small', { textContent: 'Search uses OpenStreetMap. You can also paste coordinates or a Google Maps link (only the coordinates are read).' }),
      results,
      field('Imagery', source),
      license,
      h('small', { textContent: 'The middle of your course goes on the chosen spot. Your drawing does not move.' }),
    );
    const buttons = [
      { label: 'Place course here', primary: true, onClick: () => place() },
      ...(ed.doc.geo
        ? [
            {
              label: 'Remove from map',
              onClick: () => {
                ed.removeFromMap();
              },
            },
          ]
        : []),
      { label: 'Cancel', onClick: () => {} },
    ];
    const closeDlg = dialog('Place course on map', body, buttons);
    query.focus();
  }

  /** Exact course area in yards, growing/shrinking from a chosen anchor. */
  courseSizeDialog(): void {
    const ed = this.ed;
    const k = ed.doc.yardsPerPixel;
    const w = h('input', { type: 'number', min: '20', step: '10', value: String(Math.round(ed.doc.width * k)), class: 'num' });
    const ht = h('input', { type: 'number', min: '20', step: '10', value: String(Math.round(ed.doc.height * k)), class: 'num' });
    // 3×3 anchor: which part of the current course stays put.
    let anchor = { ax: 0.5, ay: 0.5 };
    const grid = h('div', { class: 'anchor-grid' });
    const cells: HTMLButtonElement[] = [];
    for (let j = 0; j < 3; j++)
      for (let i = 0; i < 3; i++) {
        const b = h('button', { class: 'anchor', title: 'Keep this side fixed' });
        b.addEventListener('click', () => {
          anchor = { ax: i / 2, ay: j / 2 };
          cells.forEach((c) => c.classList.toggle('active', c === b));
        });
        if (i === 1 && j === 1) b.classList.add('active');
        cells.push(b);
        grid.append(b);
      }
    const body = h(
      'div',
      { class: 'form' },
      field('Width (yd)', w),
      field('Height (yd)', ht),
      field('Anchor', grid, 'Where the current course stays. Middle = grow evenly on all sides.'),
      h('small', {
        textContent: `Max about ${Math.round(Math.sqrt(MAX_DOC_PIXELS) * k).toLocaleString()} × ${Math.round(Math.sqrt(MAX_DOC_PIXELS) * k).toLocaleString()} yd at ${k} yd per pixel. Tip: you can also drag the small handles around the course edge.`,
      }),
    );
    dialog('Course size', body, [
      {
        label: 'OK',
        primary: true,
        onClick: () => {
          const nw = Math.round(+w.value / k);
          const nh = Math.round(+ht.value / k);
          if (!(nw > 0 && nh > 0)) return false;
          return ed.resizeCourse({
            x: (ed.doc.width - nw) * anchor.ax,
            y: (ed.doc.height - nh) * anchor.ay,
            w: nw,
            h: nh,
          });
        },
      },
      { label: 'Cancel', onClick: () => {} },
    ]);
  }

  courseProperties(): void {
    const name = h('input', { value: this.ed.doc.name });
    const bg = h('select');
    bg.append(h('option', { value: 'white', textContent: 'White paper' }), h('option', { value: 'grass', textContent: 'Grass' }));
    bg.value = this.ed.doc.background;
    dialog('Course properties', h('div', { class: 'form' }, field('Course name', name), field('Background', bg)), [
      {
        label: 'OK',
        primary: true,
        onClick: () => {
          this.ed.doc.name = name.value.trim() || this.ed.doc.name;
          this.ed.doc.background = bg.value;
          this.ed.invalidate();
          this.unsaved = true;
          this.scheduleAutosave();
          this.ed.emit('doc');
        },
      },
      { label: 'Cancel', onClick: () => {} },
    ]);
  }

  private fileName(): string {
    return `${this.ed.doc.name.replace(/[^\w\- ]+/g, '').trim() || 'course'}${FILE_EXT}`;
  }

  async save(as = false): Promise<void> {
    const text = serialize(this.ed.doc);
    try {
      if (win.showSaveFilePicker) {
        if (!this.fileHandle || as) {
          this.fileHandle = await win.showSaveFilePicker({ suggestedName: this.fileName(), types: PICKER_TYPES });
        }
        const w = await this.fileHandle.createWritable();
        await w.write(text);
        await w.close();
      } else {
        download(new Blob([text], { type: 'application/json' }), this.fileName());
      }
      this.unsaved = false;
      this.updateTitle();
      this.ed.setMessage(`Saved ${this.fileHandle?.name ?? this.fileName()}`);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') alert(`Could not save: ${(err as Error).message}`);
    }
  }

  async open(): Promise<void> {
    if (this.unsaved && !confirm('Open another course? Unsaved changes to the current course will be lost.')) return;
    try {
      let file: File;
      let handle: FileHandle | null = null;
      if (win.showOpenFilePicker) {
        [handle] = await win.showOpenFilePicker({ types: PICKER_TYPES });
        file = await handle.getFile();
      } else {
        file = await pickFile(`${FILE_EXT},application/json`);
      }
      const doc = deserialize(await file.text());
      this.fileHandle = handle;
      this.unsaved = false;
      this.ed.setDoc(doc);
      this.scheduleAutosave();
      this.ed.setMessage(`Opened ${file.name}`);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') alert(`Could not open: ${(err as Error).message}`);
    }
  }

  exportPng(scale: number): void {
    const ed = this.ed;
    ed.flushRender();
    const c = document.createElement('canvas');
    c.width = ed.doc.width * scale;
    c.height = ed.doc.height * scale;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = rgbCss(surfaceColor(ed.doc.background));
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(ed.docCanvas, 0, 0, c.width, c.height);
    const tl = ed.terrainLayer();
    if (tl?.visible && ed.doc.terrain) {
      ctx.save();
      ctx.scale(scale, scale);
      drawTerrain(ctx, ed.doc.terrain, tl, ed.doc.yardsPerPixel, 1 / scale);
      ctx.restore();
    }
    // Underlays are reference material and are never exported. Holes are, if shown.
    if (ed.showHoles && ed.doc.holes.length) {
      const k = scale / ed.doc.yardsPerPixel;
      drawHoles(ctx, ed.doc.holes, {
        toScreen: (w) => ({ x: w.x * k, y: w.y * k }),
        unitsPerYard: k,
        uiScale: Math.max(1, scale / 1.5),
        elevation: ed.doc.terrain ? (w) => ed.elevationAt(w) : undefined,
      });
    }
    c.toBlob((b) => b && download(b, this.fileName().replace(FILE_EXT, scale > 1 ? `@${scale}x.png` : '.png')), 'image/png');
  }

  // ------------------------------------------------------------ menus & keys
  private menus() {
    const ed = this.ed;
    return [
      {
        title: 'File',
        items: [
          { label: 'New course…', action: () => this.newCourseDialog() },
          { label: 'Open…', shortcut: '⌘O', action: () => void this.open() },
          { separator: true, label: '' },
          { label: 'Save', shortcut: '⌘S', action: () => void this.save() },
          { label: 'Save as…', shortcut: '⇧⌘S', action: () => void this.save(true) },
          { separator: true, label: '' },
          { label: 'Import underlay image…', action: () => void this.importImageDialog() },
          { separator: true, label: '' },
          { label: 'Export PNG (1×)', action: () => this.exportPng(1) },
          { label: 'Export PNG (2×)', action: () => this.exportPng(2) },
          { label: 'Export PNG (4×)', action: () => this.exportPng(4) },
          { separator: true, label: '' },
          { label: 'Course properties…', action: () => this.courseProperties() },
          { label: 'Course size…', action: () => this.courseSizeDialog() },
          { label: 'Fit course area to view', action: () => ed.fitAreaToView() },
        ],
      },
      {
        title: 'Edit',
        items: [
          { label: 'Undo', shortcut: '⌘Z', enabled: () => ed.history.canUndo, action: () => ed.undo() },
          { label: 'Redo', shortcut: '⇧⌘Z', enabled: () => ed.history.canRedo, action: () => ed.redo() },
          { separator: true, label: '' },
          { label: 'Duplicate shape', shortcut: '⌘D', enabled: () => !!ed.selected(), action: () => ed.duplicateSelection() },
          { label: 'Delete selection', shortcut: '⌫', enabled: () => !!ed.selected() || !!ed.region, action: () => ed.deleteSelection() },
          { label: 'Painted area → shape', enabled: () => !!ed.region, action: () => ed.regionToShape() },
          {
            label: 'Deselect',
            shortcut: 'Esc',
            enabled: () => !!ed.selection || !!ed.region,
            action: () => {
              ed.select(null);
              ed.setRegion(null);
            },
          },
          { separator: true, label: '' },
          { label: 'Swap left/right surfaces', shortcut: 'X', action: () => ed.swapSurfaces() },
          { separator: true, label: '' },
          { label: 'Clear measurement', enabled: () => ed.ruler.points.length > 0, action: () => ed.clearRuler() },
        ],
      },
      {
        title: 'Colors',
        items: [
          { label: 'Course colors…', action: () => this.courseColorsDialog() },
          ...THEMES.map((t) => ({
            label: `    ${t.name}`,
            action: () => {
              const keep = Object.fromEntries(Object.entries(ed.doc.colors).filter(([id]) => surfaceById(id)?.kind !== 'golf'));
              ed.setColors({ ...keep, ...JSON.parse(JSON.stringify(t.colors)) }, `Theme: ${t.name}`, true);
            },
          })),
          { separator: true, label: '' },
          { label: 'Swap left/right surfaces', shortcut: 'X', action: () => ed.swapSurfaces() },
        ],
      },
      {
        title: 'Map',
        items: [
          { label: 'Place course on map…', action: () => this.placeOnMapDialog() },
          { label: 'Fit course area to view', action: () => ed.fitAreaToView() },
          {
            label: 'Select map layer',
            enabled: () => !!ed.mapLayer(),
            action: () => ed.setActiveLayer(ed.mapLayer()!.id),
          },
          {
            label: 'Remove from map',
            enabled: () => !!ed.doc.geo,
            action: () => ed.removeFromMap(),
          },
        ],
      },
      {
        title: 'Terrain',
        items: [
          {
            label: 'Import real elevation (USGS)',
            enabled: () => !!ed.doc.geo,
            action: () => {
              if (ed.doc.terrain && !confirm('Replace the current terrain with real elevation? (You can undo this.)')) return;
              void ed.importTerrain();
            },
          },
          {
            label: 'Start flat terrain',
            action: () => {
              if (ed.doc.terrain && !confirm('Replace the current terrain with flat ground? (You can undo this.)')) return;
              ed.setTerrain(createTerrain(ed.doc.width, ed.doc.height, 'sculpted', 0), 'Start terrain');
              ed.setTool('terrain');
            },
          },
          { label: 'Shape terrain', shortcut: 'D', action: () => ed.setTool('terrain') },
          {
            label: 'Select terrain layer',
            enabled: () => !!ed.terrainLayer(),
            action: () => ed.setActiveLayer(ed.terrainLayer()!.id),
          },
          { separator: true, label: '' },
          {
            label: 'Hillshade',
            enabled: () => !!ed.terrainLayer(),
            checked: () => !!ed.terrainLayer()?.showShade,
            action: () => ed.updateTerrainLayer({ showShade: !ed.terrainLayer()!.showShade }),
          },
          {
            label: 'Contour lines',
            enabled: () => !!ed.terrainLayer(),
            checked: () => !!ed.terrainLayer()?.showContours,
            action: () => ed.updateTerrainLayer({ showContours: !ed.terrainLayer()!.showContours }),
          },
          ...[1, 2, 5, 10].map((v) => ({
            label: `    Every ${v} ft`,
            enabled: () => !!ed.terrainLayer(),
            checked: () => ed.terrainLayer()?.interval === v,
            action: () => ed.updateTerrainLayer({ interval: v, showContours: true }),
          })),
          { separator: true, label: '' },
          { label: 'Remove terrain', enabled: () => !!ed.doc.terrain, action: () => ed.setTerrain(undefined, 'Remove terrain') },
        ],
      },
      {
        title: 'View',
        items: [
          { label: 'Show holes', checked: () => ed.showHoles, action: () => ed.setHoleView({ showHoles: !ed.showHoles }) },
          {
            label: '    Distance arcs from tee',
            checked: () => ed.arcsFromTee,
            action: () => ed.setHoleView({ arcsFromTee: !ed.arcsFromTee }),
          },
          {
            label: '    Distance arcs to green',
            checked: () => ed.arcsToGreen,
            action: () => ed.setHoleView({ arcsToGreen: !ed.arcsToGreen }),
          },
          { separator: true, label: '' },
          { label: 'Zoom in', shortcut: '⌘+', action: () => ed.zoomStep(1) },
          { label: 'Zoom out', shortcut: '⌘−', action: () => ed.zoomStep(-1) },
          { label: 'Zoom to fit', shortcut: '⌘0', action: () => ed.fit() },
          { separator: true, label: '' },
          { label: 'Rotate view 15° clockwise', shortcut: 'R', action: () => ed.rotateView(ed.rotation + 15) },
          { label: 'Rotate view 15° counter‑clockwise', shortcut: '⇧R', action: () => ed.rotateView(ed.rotation - 15) },
          { label: 'Rotate view 90° clockwise', action: () => ed.rotateView(ed.rotation + 90) },
          { label: 'Point selected hole up', enabled: () => !!ed.selectedHole(), action: () => ed.pointHoleUp() },
          { label: 'Reset rotation (north up)', enabled: () => ed.rotation !== 0, action: () => ed.rotateView(0) },
          { label: 'Actual pixels', shortcut: '⌘1', action: () => ed.actualSize() },
          { separator: true, label: '' },
          { label: 'Show yard grid', shortcut: '⌘\'', checked: () => ed.showYardGrid, action: () => ed.toggleYardGrid() },
          ...([100, 50, 25] as const).map((n) => ({
            label: `    Grid every ${n} yd`,
            checked: () => ed.showYardGrid && ed.yardGridSize === n,
            action: () => ed.setYardGrid(n),
          })),
          { separator: true, label: '' },
          ...[4, 8, 12, 16].map((z) => ({
            label: `Pixel grid from ${z * 100}% zoom`,
            checked: () => ed.pixelGridZoom === z,
            action: () => ed.setPixelGridZoom(z),
          })),
          { label: 'Pixel grid off', checked: () => ed.pixelGridZoom === 0, action: () => ed.setPixelGridZoom(0) },
        ],
      },
      {
        title: 'Help',
        items: [
          { label: 'Keyboard shortcuts', action: () => this.shortcutsDialog() },
          { label: 'About Fairway Paint', action: () => this.aboutDialog() },
        ],
      },
    ];
  }

  private bindKeys(): void {
    const ed = this.ed;
    window.addEventListener('keydown', (e) => {
      if (isTyping(e) || document.querySelector('.modal-overlay')) return;
      const meta = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (meta) {
        const map: Record<string, () => void> = {
          z: () => (e.shiftKey ? ed.redo() : ed.undo()),
          y: () => ed.redo(),
          s: () => void this.save(e.shiftKey),
          o: () => void this.open(),
          d: () => ed.duplicateSelection(),
          '0': () => ed.fit(),
          '1': () => ed.actualSize(),
          '=': () => ed.zoomStep(1),
          '+': () => ed.zoomStep(1),
          '-': () => ed.zoomStep(-1),
          "'": () => ed.toggleYardGrid(),
        };
        if (map[k]) {
          e.preventDefault();
          map[k]();
        }
        return;
      }
      if (ed.tool.keydown?.(e)) {
        e.preventDefault();
        ed.requestFrame();
        return;
      }
      if (e.key === 'Escape') {
        ed.select(null);
        ed.setRegion(null);
        return;
      }
      if (k === 'x') return ed.swapSurfaces();
      if (k === 'r' && !e.altKey) {
        e.preventDefault();
        return ed.rotateView(ed.rotation + (e.shiftKey ? -15 : 15));
      }
      if (e.key === '[') return ed.setBrushSize(ed.brushSize - 1);
      if (e.key === ']') return ed.setBrushSize(ed.brushSize + 1);
      if (e.key === '+' || e.key === '=') return ed.zoomStep(1);
      if (e.key === '-') return ed.zoomStep(-1);
      for (const t of ed.tools.values()) {
        if (t.key === k && !e.altKey) {
          ed.setTool(t.id as ToolId);
          e.preventDefault();
          return;
        }
      }
    });
  }

  private shortcutsDialog(): void {
    const rows: [string, string][] = [
      ...[...this.ed.tools.values()].map((t): [string, string] => [t.key.toUpperCase(), t.name]),
      ['Space + drag', 'Pan (any tool)'],
      ['Two‑finger scroll', 'Pan'],
      ['Pinch / ⌘ + scroll', 'Zoom'],
      ['[ / ]', 'Brush size'],
      ['Right‑click / ⌃‑click', 'Paint with the right surface'],
      ['X', 'Swap left/right surfaces'],
      ['R / ⇧R', 'Rotate the view 15° (trackpad twist in Safari)'],
      ['⌘Z / ⇧⌘Z', 'Undo / Redo'],
      ['⌘D', 'Duplicate shape'],
      ['⌫', 'Delete shape or point'],
      ['Arrows', 'Nudge shape/point (⇧ = 10 px)'],
      ['⌥‑click point', 'Delete point'],
      ['Double‑click outline', 'Add point'],
      ['⌘S / ⌘O', 'Save / Open'],
      ['⌘0 / ⌘1', 'Fit / Actual pixels'],
      ['⌘V', 'Paste a screenshot as an underlay'],
      ['3 / 4 / 5 / 6', 'Set par of the selected hole (Hole tool)'],
    ];
    const table = h('table', { class: 'shortcuts' });
    for (const [k, v] of rows) table.append(h('tr', {}, h('td', {}, h('kbd', { textContent: k })), h('td', { textContent: v })));
    dialog('Keyboard shortcuts', table, [{ label: 'Close', primary: true, onClick: () => {} }]);
  }

  private aboutDialog(): void {
    dialog(
      'About Fairway Paint',
      h(
        'div',
        { class: 'about' },
        h('p', { textContent: 'Fairway Paint v0.1 — a pixel‑art golf course design tool.' }),
        h('p', { textContent: 'Every pixel has a real size, so shapes, areas and measurements are in yards.' }),
        h('p', { textContent: 'Your work autosaves in this browser. Use File → Save to keep a .fairway file.' }),
      ),
      [{ label: 'OK', primary: true, onClick: () => {} }],
    );
  }
}

function download(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function pickFile(accept: string): Promise<File> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => (input.files?.[0] ? resolve(input.files[0]) : reject(Object.assign(new Error('cancelled'), { name: 'AbortError' })));
    input.click();
  });
}

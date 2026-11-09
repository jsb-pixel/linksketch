import { Editor, isTyping, type ToolId } from './editor/editor';
import { registerAllTools } from './editor/tools';
import { createDoc, MAX_DOC_PIXELS } from './model/doc';
import { deserialize, FILE_EXT, idbGet, idbSet, serialize } from './model/io';
import {
  buildInfoPanel,
  buildLayersPanel,
  buildMenuBar,
  buildPalette,
  buildStatusBar,
  buildToolbox,
  dialog,
  field,
  h,
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
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(ed.docCanvas, 0, 0, c.width, c.height);
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
          { label: 'Export PNG (1×)', action: () => this.exportPng(1) },
          { label: 'Export PNG (2×)', action: () => this.exportPng(2) },
          { label: 'Export PNG (4×)', action: () => this.exportPng(4) },
          { separator: true, label: '' },
          { label: 'Course properties…', action: () => this.courseProperties() },
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
        title: 'View',
        items: [
          { label: 'Zoom in', shortcut: '⌘+', action: () => ed.zoomStep(1) },
          { label: 'Zoom out', shortcut: '⌘−', action: () => ed.zoomStep(-1) },
          { label: 'Zoom to fit', shortcut: '⌘0', action: () => ed.fit() },
          { label: 'Actual pixels', shortcut: '⌘1', action: () => ed.actualSize() },
          { separator: true, label: '' },
          {
            label: '100‑yard grid',
            shortcut: '⌘\'',
            checked: () => ed.showYardGrid,
            action: () => {
              ed.showYardGrid = !ed.showYardGrid;
              ed.requestFrame();
            },
          },
          {
            label: 'Pixel grid (when zoomed in)',
            checked: () => ed.showPixelGrid,
            action: () => {
              ed.showPixelGrid = !ed.showPixelGrid;
              ed.requestFrame();
            },
          },
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
          "'": () => {
            ed.showYardGrid = !ed.showYardGrid;
            ed.requestFrame();
          },
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
      ['⌘Z / ⇧⌘Z', 'Undo / Redo'],
      ['⌘D', 'Duplicate shape'],
      ['⌫', 'Delete shape or point'],
      ['Arrows', 'Nudge shape/point (⇧ = 10 px)'],
      ['⌥‑click point', 'Delete point'],
      ['Double‑click outline', 'Add point'],
      ['⌘S / ⌘O', 'Save / Open'],
      ['⌘0 / ⌘1', 'Fit / Actual pixels'],
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

/**
 * Surfaces = the "palette". Each surface is a golf material (or a plain color) with a
 * fill, an optional 1‑px black outline, an optional pixel pattern and a z‑priority.
 *
 * Raster layers store a surface *code* per pixel (index in SURFACES + 1). The order of
 * this list may change between versions — files store a surface table to stay stable.
 */

export type RGB = readonly [number, number, number];
export type Pattern = 'none' | 'water' | 'speckle' | 'trees' | 'dots';

export interface Surface {
  id: string;
  name: string;
  kind: 'golf' | 'color' | 'custom';
  color: RGB;
  color2?: RGB;
  pattern: Pattern;
  outline: boolean;
  /** Higher draws on top within a shape layer. */
  priority: number;
}

const golf = (
  id: string,
  name: string,
  color: RGB,
  priority: number,
  outline: boolean,
  pattern: Pattern = 'none',
  color2?: RGB,
): Surface => ({ id, name, kind: 'golf', color, color2, pattern, outline, priority });

const plain = (id: string, name: string, color: RGB): Surface => ({
  id,
  name,
  kind: 'color',
  color,
  pattern: 'none',
  outline: false,
  priority: 80,
});

export const SURFACES: readonly Surface[] = [
  golf('fairway', 'Fairway', [106, 163, 57], 20, true),
  golf('green', 'Green', [143, 178, 112], 40, true),
  golf('tee', 'Tee', [70, 106, 48], 30, true),
  golf('bunker', 'Bunker', [226, 212, 150], 50, true),
  golf('waste', 'Waste area', [204, 188, 134], 25, true, 'dots', [158, 138, 92]),
  golf('water', 'Water', [40, 125, 255], 45, true, 'water', [12, 44, 120]),
  golf('rough', 'Rough', [22, 112, 24], 10, true),
  golf('fescue', 'Fescue', [168, 160, 92], 8, false, 'speckle', [104, 118, 52]),
  golf('trees', 'Trees', [34, 122, 34], 70, false, 'trees', [10, 72, 12]),
  golf('dirt', 'Dirt / creek bed', [132, 82, 42], 26, true),
  golf('path', 'Cart path', [186, 186, 186], 60, true),
  golf('grass', 'Grass', [150, 198, 102], 1, false),
  plain('black', 'Black', [0, 0, 0]),
  plain('white', 'White', [255, 255, 255]),
  plain('gray', 'Gray', [128, 128, 128]),
  plain('silver', 'Light gray', [192, 192, 192]),
  plain('maroon', 'Maroon', [128, 0, 0]),
  plain('red', 'Red', [237, 28, 36]),
  plain('brown', 'Brown', [128, 64, 0]),
  plain('orange', 'Orange', [255, 140, 0]),
  plain('yellow', 'Yellow', [255, 230, 0]),
  plain('olive', 'Olive', [128, 128, 0]),
  plain('dkgreen', 'Dark green', [0, 100, 0]),
  plain('lime', 'Lime', [0, 220, 0]),
  plain('teal', 'Teal', [0, 128, 128]),
  plain('navy', 'Navy', [0, 0, 128]),
  plain('blue', 'Blue', [0, 90, 255]),
  plain('purple', 'Purple', [128, 0, 128]),
];

/** Number of user‑defined color slots. */
export const CUSTOM_SLOTS = 6;
const CUSTOM: Surface[] = Array.from({ length: CUSTOM_SLOTS }, (_, i) => ({
  id: `custom${i + 1}`,
  name: `Custom ${i + 1}`,
  kind: 'custom',
  color: [255, 255, 255],
  pattern: 'none',
  outline: false,
  priority: 80,
}));
// Appended so existing surface codes never shift.
(SURFACES as Surface[]).push(...CUSTOM);

export const OUTLINE_RGB: RGB = [0, 0, 0];

/** surface id → code (1‑based; 0 means "nothing"). */
const CODE = new Map<string, number>(SURFACES.map((s, i) => [s.id, i + 1]));

export function surfaceCode(id: string): number {
  return CODE.get(id) ?? 0;
}

export function surfaceByCode(code: number): Surface | undefined {
  return SURFACES[code - 1];
}

export function surfaceById(id: string): Surface | undefined {
  const c = CODE.get(id);
  return c ? SURFACES[c - 1] : undefined;
}

/** Sort key used for stacking & outline decisions. */
export function surfaceRank(code: number): number {
  const s = SURFACES[code - 1];
  return s ? s.priority * 256 + code : 0;
}

/** Pack RGBA into a little‑endian ImageData word. */
export function pack(r: number, g: number, b: number, a = 255): number {
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

const C1 = new Uint32Array(SURFACES.length + 1);
const C2 = new Uint32Array(SURFACES.length + 1);
const PAT = new Uint8Array(SURFACES.length + 1);
const PATTERN_IDS: Record<Pattern, number> = { none: 0, water: 1, speckle: 2, trees: 3, dots: 4 };
SURFACES.forEach((s, i) => (PAT[i + 1] = PATTERN_IDS[s.pattern]));

// ---------------------------------------------------------------- course colors
/** Per‑course color override for one surface. */
export interface SurfaceColors {
  color: RGB;
  color2?: RGB;
}
export type ColorMap = Record<string, SurfaceColors>;

let overrides: ColorMap = {};

/** Effective main color (course override or default). */
export function surfaceColor(id: string): RGB {
  return overrides[id]?.color ?? surfaceById(id)?.color ?? [255, 0, 255];
}
/** Effective pattern/detail color. */
export function surfaceColor2(id: string): RGB {
  const s = surfaceById(id);
  return overrides[id]?.color2 ?? (overrides[id] && !s?.color2 ? overrides[id].color : s?.color2 ?? surfaceColor(id));
}
/** Has a custom slot been given a color in this course? */
export function customSlotUsed(id: string): boolean {
  return !!overrides[id];
}

/** Install a course's colors into the render tables. */
export function applyColors(map: ColorMap): void {
  overrides = map;
  SURFACES.forEach((s, i) => {
    C1[i + 1] = pack(...surfaceColor(s.id));
    C2[i + 1] = pack(...surfaceColor2(s.id));
  });
}
applyColors({});
export const OUTLINE_PACKED = pack(...OUTLINE_RGB);

/** Deterministic per‑pixel hash so patterns never "swim" when re-rendered. */
export function hash2(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Packed color of a surface at doc pixel (x, y), pattern applied. */
export function surfacePixel(code: number, x: number, y: number): number {
  switch (PAT[code]) {
    case 1: {
      // water: short dark dashes on staggered rows
      const row = Math.floor(y / 7);
      return y % 7 === 3 && (x + row * 5) % 14 < 4 ? C2[code] : C1[code];
    }
    case 2:
      return hash2(x, y) % 4 === 0 ? C2[code] : C1[code];
    case 3:
      return hash2(x, y) % 3 === 0 ? C2[code] : C1[code];
    case 4:
      return hash2(x, y) % 9 === 0 ? C2[code] : C1[code];
    default:
      return C1[code];
  }
}

export function rgbCss(c: RGB): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

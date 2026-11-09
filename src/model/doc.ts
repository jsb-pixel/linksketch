import type { CourseDoc, ImageLayer, ImagePlacement, Layer, RasterLayer, VectorLayer } from './types';

let seq = 0;
export function uid(prefix: string): string {
  seq = (seq + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function createRasterLayer(name: string, w: number, h: number): RasterLayer {
  return { id: uid('L'), kind: 'raster', name, visible: true, locked: false, outline: true, pixels: new Uint8Array(w * h) };
}

export function createVectorLayer(name: string): VectorLayer {
  return { id: uid('L'), kind: 'vector', name, visible: true, locked: false, features: [] };
}

export function createImageLayer(name: string, src: string, imgW: number, imgH: number, placement: Partial<ImagePlacement> = {}): ImageLayer {
  return {
    id: uid('L'),
    kind: 'image',
    name,
    visible: true,
    locked: false,
    src,
    imgW,
    imgH,
    x: 0,
    y: 0,
    scale: 1,
    rotation: 0,
    opacity: 0.6,
    above: false,
    ...placement,
  };
}

/** Par guess from yardage (men's USGA guidelines). */
export function suggestPar(yards: number): number {
  return yards <= 250 ? 3 : yards <= 470 ? 4 : yards <= 690 ? 5 : 6;
}

export interface NewDocOptions {
  name?: string;
  /** Course area in yards. */
  widthYards?: number;
  heightYards?: number;
  yardsPerPixel?: number;
  background?: string;
}

export const MAX_DOC_PIXELS = 12_000_000;

export function createDoc(opts: NewDocOptions = {}): CourseDoc {
  const ypp = opts.yardsPerPixel ?? 1;
  const width = Math.round((opts.widthYards ?? 2000) / ypp);
  const height = Math.round((opts.heightYards ?? 1400) / ypp);
  if (width * height > MAX_DOC_PIXELS) throw new Error('Course is too large for this pixel size.');
  return {
    name: opts.name ?? 'Untitled course',
    width,
    height,
    yardsPerPixel: ypp,
    background: opts.background ?? 'white',
    colors: {},
    layers: [
      createRasterLayer('Base paint', width, height),
      createVectorLayer('Course shapes'),
      createRasterLayer('Detail paint', width, height),
    ],
    holes: [],
  };
}

export function findLayer(doc: CourseDoc, id: string | null | undefined): Layer | undefined {
  return doc.layers.find((l) => l.id === id);
}

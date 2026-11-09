/** Underlay images: loading, drawing and coordinate mapping. */
import type { ImageLayer, Vec2 } from '../model/types';

const MAX_SIDE = 4096;
const cache = new Map<string, HTMLImageElement>();

/** Decoded image for a data URL; calls onReady once it finishes loading. */
export function getImage(src: string, onReady: () => void): HTMLImageElement | null {
  let img = cache.get(src);
  if (!img) {
    img = new Image();
    img.onload = onReady;
    img.src = src;
    cache.set(src, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

/** Read an image file/blob, shrink huge ones, and return a compact data URL. */
export async function loadImageBlob(blob: Blob): Promise<{ src: string; w: number; h: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('That file is not an image this browser can read.'));
      im.src = url;
    });
    const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k));
    const h = Math.max(1, Math.round(img.naturalHeight * k));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return { src: c.toDataURL('image/jpeg', 0.88), w, h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Image pixel → world yards. */
export function imageToWorld(l: ImageLayer, p: Vec2): Vec2 {
  const a = (l.rotation * Math.PI) / 180;
  const x = p.x * l.scale;
  const y = p.y * l.scale;
  return { x: l.x + x * Math.cos(a) - y * Math.sin(a), y: l.y + x * Math.sin(a) + y * Math.cos(a) };
}

/** World yards → image pixel. */
export function worldToImage(l: ImageLayer, w: Vec2): Vec2 {
  const a = (-l.rotation * Math.PI) / 180;
  const dx = w.x - l.x;
  const dy = w.y - l.y;
  return { x: (dx * Math.cos(a) - dy * Math.sin(a)) / l.scale, y: (dx * Math.sin(a) + dy * Math.cos(a)) / l.scale };
}

export function imageContains(l: ImageLayer, w: Vec2): boolean {
  const p = worldToImage(l, w);
  return p.x >= 0 && p.y >= 0 && p.x <= l.imgW && p.y <= l.imgH;
}

/**
 * Draw an underlay. `toScreen` maps yards → canvas units; `unitsPerYard` is the
 * matching scale factor.
 */
export function drawUnderlay(
  ctx: CanvasRenderingContext2D,
  l: ImageLayer,
  toScreen: (w: Vec2) => Vec2,
  unitsPerYard: number,
  onReady: () => void,
): void {
  const img = getImage(l.src, onReady);
  if (!img) return;
  const o = toScreen({ x: l.x, y: l.y });
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.rotate((l.rotation * Math.PI) / 180);
  const k = l.scale * unitsPerYard;
  ctx.scale(k, k);
  ctx.globalAlpha = l.opacity;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, l.imgW, l.imgH);
  ctx.restore();
}

/** Dashed frame around the active underlay so it can be found and moved. */
export function drawUnderlayFrame(ctx: CanvasRenderingContext2D, l: ImageLayer, toScreen: (w: Vec2) => Vec2): void {
  const corners = [
    { x: 0, y: 0 },
    { x: l.imgW, y: 0 },
    { x: l.imgW, y: l.imgH },
    { x: 0, y: l.imgH },
  ].map((p) => toScreen(imageToWorld(l, p)));
  ctx.save();
  ctx.beginPath();
  corners.forEach((c, i) => (i ? ctx.lineTo(c.x, c.y) : ctx.moveTo(c.x, c.y)));
  ctx.closePath();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = '#0a64ff';
  ctx.stroke();
  ctx.restore();
}

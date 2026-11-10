/** Drawing terrain (hillshade + contour lines) in doc‑pixel space, with caches. */
import type { TerrainLayer } from '../model/types';
import { contourSegments, hillshade, type Terrain } from './terrain';

interface Cache {
  rev: number;
  builtAt: number;
  ypp: number;
  shade?: HTMLCanvasElement;
  contours: Map<number, { minor: Path2D; major: Path2D }>;
}
const caches = new WeakMap<Terrain, Cache>();

function cacheFor(t: Terrain, ypp: number, allowStale: boolean): Cache {
  let c = caches.get(t);
  const fresh = c && c.rev === (t.rev ?? 0) && c.ypp === ypp;
  // While a brush stroke is in progress, rebuild at most ~8×/s.
  if (c && !fresh && allowStale && c.ypp === ypp && performance.now() - c.builtAt < 120) return c;
  if (!c || !fresh) {
    c = { rev: t.rev ?? 0, ypp, builtAt: performance.now(), contours: new Map() };
    caches.set(t, c);
  }
  return c;
}

function shadeCanvas(t: Terrain, c: Cache): HTMLCanvasElement {
  if (!c.shade) {
    const cv = document.createElement('canvas');
    cv.width = t.w;
    cv.height = t.h;
    cv.getContext('2d')!.putImageData(hillshade(t, c.ypp), 0, 0);
    c.shade = cv;
  }
  return c.shade;
}

function contourPaths(t: Terrain, c: Cache, interval: number): { minor: Path2D; major: Path2D } {
  let p = c.contours.get(interval);
  if (!p) {
    const seg = contourSegments(t, interval);
    const toPath = (a: Float32Array) => {
      const path = new Path2D();
      for (let i = 0; i < a.length; i += 4) {
        path.moveTo(a[i], a[i + 1]);
        path.lineTo(a[i + 2], a[i + 3]);
      }
      return path;
    };
    p = { minor: toPath(seg.minor), major: toPath(seg.major) };
    c.contours.set(interval, p);
  }
  return p;
}

/**
 * Draw terrain. The context must already map doc pixels → target (view or export);
 * `pxPerTargetUnit` converts a 1‑unit line width on the target into doc pixels.
 */
export function drawTerrain(
  ctx: CanvasRenderingContext2D,
  t: Terrain,
  layer: TerrainLayer,
  ypp: number,
  pxPerTargetUnit: number,
  allowStale = false,
): void {
  const c = cacheFor(t, ypp, allowStale);
  ctx.save();
  if (layer.showShade) {
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = 'multiply';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // Shade pixels are centred on grid points.
    ctx.drawImage(shadeCanvas(t, c), -t.cell / 2, -t.cell / 2, t.w * t.cell, t.h * t.cell);
    ctx.globalCompositeOperation = 'source-over';
  }
  if (layer.showContours) {
    const p = contourPaths(t, c, layer.interval);
    ctx.globalAlpha = Math.min(1, layer.opacity + 0.15);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(92, 52, 18, 0.75)';
    ctx.lineWidth = 1 * pxPerTargetUnit;
    ctx.stroke(p.minor);
    ctx.strokeStyle = 'rgba(70, 36, 8, 0.95)';
    ctx.lineWidth = 1.8 * pxPerTargetUnit;
    ctx.stroke(p.major);
  }
  ctx.restore();
}

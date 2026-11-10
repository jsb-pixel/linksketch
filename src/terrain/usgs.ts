/**
 * Real elevation from USGS 3DEP (public domain): best available DEM, often 1 m lidar.
 * We ask the ImageServer for raw float32 meters on exactly our grid (Web Mercator bbox).
 */
import { worldToMerc, type GeoRef } from '../geo/geo';
import { createTerrain, type Terrain } from './terrain';

const SERVICE = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage';
const FT_PER_M = 3.280839895;

export const ELEVATION_ATTRIBUTION = 'Elevation: USGS 3D Elevation Program (3DEP)';

/** Fetch a terrain grid covering the whole course. Throws with a readable message. */
export async function fetchUsgsTerrain(geo: GeoRef, docW: number, docH: number, yardsPerPixel: number): Promise<Terrain> {
  const t = createTerrain(docW, docH, 'usgs');
  // Grid points are pixel centres of the requested image, so pad the bbox by half a cell.
  const halfYd = (t.cell * yardsPerPixel) / 2;
  const a = worldToMerc(geo, { x: -halfYd, y: -halfYd });
  const b = worldToMerc(geo, { x: ((t.w - 1) * t.cell) * yardsPerPixel + halfYd, y: ((t.h - 1) * t.cell) * yardsPerPixel + halfYd });
  const params = new URLSearchParams({
    bbox: `${a.x},${b.y},${b.x},${a.y}`,
    bboxSR: '3857',
    imageSR: '3857',
    size: `${t.w},${t.h}`,
    format: 'bsq',
    pixelType: 'F32',
    interpolation: 'RSP_BilinearInterpolation',
    f: 'image',
  });
  let res: Response;
  try {
    res = await fetch(`${SERVICE}?${params}`);
  } catch {
    throw new Error('Could not reach the USGS elevation service. Check your internet connection.');
  }
  if (!res.ok) throw new Error(`USGS elevation service answered ${res.status}.`);
  const buf = await res.arrayBuffer();
  const n = t.w * t.h;
  if (buf.byteLength < n * 4) throw new Error('USGS returned no elevation for this area (it covers the US only).');
  const meters = new Float32Array(buf.slice(0, n * 4)); // little‑endian floats, then a validity bitmask
  let valid = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = meters[i];
    if (Number.isFinite(v) && v > -500 && v < 9000) {
      valid++;
      sum += v;
    }
  }
  if (valid < n * 0.5) throw new Error('No elevation data here — 3DEP covers the United States only.');
  const fallback = sum / valid;
  for (let i = 0; i < n; i++) {
    const v = meters[i];
    t.heights[i] = (Number.isFinite(v) && v > -500 && v < 9000 ? v : fallback) * FT_PER_M;
  }
  return t;
}

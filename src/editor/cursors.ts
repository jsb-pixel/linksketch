/**
 * Precision cursors for drawing tools. The exact point is marked by four small ticks
 * with an open centre, so the pixel you are over stays visible.
 */
export type CursorStyle = 'offset' | 'gap' | 'standard';

export const CURSOR_STYLES: { id: CursorStyle; name: string }[] = [
  { id: 'offset', name: 'Offset pointer (arrow beside the point)' },
  { id: 'gap', name: 'Open crosshair' },
  { id: 'standard', name: 'Standard crosshair' },
];

/** Four ticks around (c, c), leaving a gap of `gap` px on each side. */
function ticks(c: number, gap: number, len: number): string {
  const lines = [
    [c, c - gap - len, c, c - gap],
    [c, c + gap, c, c + gap + len],
    [c - gap - len, c, c - gap, c],
    [c + gap, c, c + gap + len, c],
  ];
  const d = lines.map(([x1, y1, x2, y2]) => `M${x1 + 0.5} ${y1 + 0.5}L${x2 + 0.5} ${y2 + 0.5}`).join('');
  return `<path d="${d}" stroke="#fff" stroke-width="3" stroke-linecap="square"/><path d="${d}" stroke="#000" stroke-width="1"/>`;
}

function svgCursor(size: number, body: string, hot: number, fallback: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">${body}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hot} ${hot}, ${fallback}`;
}

// Hotspot at (8,8); arrow starts 5 px down‑right of it.
const OFFSET = svgCursor(
  32,
  `${ticks(8, 2, 4)}<path d="M13.5 13.5V28.5L17.5 24.5L20.5 31L23.5 29.6L20.6 23.2H26.2Z" fill="#fff" stroke="#000" stroke-width="1" stroke-linejoin="round" shape-rendering="geometricPrecision"/>`,
  8,
  'crosshair',
);

const GAP = svgCursor(24, ticks(12, 3, 6), 12, 'crosshair');

/** CSS cursor for a tool's logical cursor name under the chosen style. */
export function cssCursor(name: string, style: CursorStyle): string {
  if (name !== 'crosshair' && name !== 'copy') return name;
  if (style === 'offset') return OFFSET;
  if (style === 'gap') return GAP;
  return 'crosshair';
}

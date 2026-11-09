import type { ToolId } from '../editor/editor';

/** Tiny 16×16 pixel‑style icons for the toolbox. */
const svg = (body: string) =>
  `<svg viewBox="0 0 16 16" width="16" height="16" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

export const TOOL_ICONS: Record<ToolId, string> = {
  select: svg(
    '<path d="M3 1v12l3-3 2 5 2-1-2-5h4z" fill="#fff" stroke="#000" stroke-width="1" stroke-linejoin="miter"/>',
  ),
  freehand: svg(
    '<path d="M3 5c2-4 9-3 10 1s-1 8-5 8-5-2-6-4 0-3 1-5z" fill="#6aa339" stroke="#000"/><rect x="7" y="6" width="3" height="3" fill="#8fb270" stroke="#000"/>',
  ),
  polygon: svg('<path d="M2 12 5 3 13 5 14 13z" fill="#466a30" stroke="#000"/>'),
  pencil: svg(
    '<path d="M11 1l4 4-9 9H2v-4z" fill="#ffd34d" stroke="#000"/><path d="M2 10l4 4" stroke="#000"/><rect x="2" y="13" width="2" height="2" fill="#000"/>',
  ),
  brush: svg(
    '<rect x="9" y="1" width="3" height="7" fill="#a0522d" stroke="#000" transform="rotate(35 10 4)"/><path d="M4 9c2-1 4 0 4 2s-2 4-6 4c1-1 0-5 2-6z" fill="#6aa339" stroke="#000"/>',
  ),
  spray: svg(
    '<rect x="8" y="5" width="6" height="10" fill="#c0c0c0" stroke="#000"/><rect x="9" y="2" width="3" height="3" fill="#000"/><g fill="#227a22"><rect x="2" y="2" width="1" height="1"/><rect x="4" y="4" width="1" height="1"/><rect x="1" y="6" width="1" height="1"/><rect x="5" y="1" width="1" height="1"/><rect x="3" y="8" width="1" height="1"/><rect x="6" y="6" width="1" height="1"/></g>',
  ),
  fill: svg(
    '<path d="M3 7l5-5 6 6-5 5z" fill="#fff" stroke="#000"/><path d="M3 7h11l-5 5z" fill="#6aa339"/><path d="M14 9c1 2 1 4 0 4s-1-2 0-4z" fill="#287dff" stroke="#000" stroke-width=".5"/>',
  ),
  wand: svg(
    '<path d="M2 14 11 5" stroke="#000" stroke-width="2"/><path d="M12 1v2M12 7v2M9 4h2M14 4h2M10 2l1 1M14 6l1 1M14 2l-1 1" stroke="#c08000"/><rect x="11" y="3" width="2" height="2" fill="#ffd34d"/>',
  ),
  hole: svg(
    '<rect x="1" y="11" width="5" height="4" fill="#466a30" stroke="#000"/><path d="M4 11 9 6 12 4" stroke="#000" stroke-dasharray="2 1" fill="none"/><path d="M12 1v8" stroke="#000"/><path d="M12 1l4 1.5-4 1.5z" fill="#ed1c24" stroke="#000" stroke-width=".5"/>',
  ),
  underlay: svg(
    '<rect x="1" y="3" width="11" height="9" fill="#9cc7e8" stroke="#000"/><path d="M1 10l3-3 3 2 2-2 3 3" fill="#6aa339" stroke="#000" stroke-width=".7"/><path d="M13 9v6M10 12h6M13 9l-1 1M13 9l1 1M13 15l-1-1M13 15l1-1" stroke="#000"/>',
  ),
  scale: svg(
    '<rect x="1" y="9" width="14" height="5" fill="#ff9be0" stroke="#000"/><path d="M4 9v2M7 9v3M10 9v2M13 9v3" stroke="#000"/><path d="M2 5h12M2 5l2-2M2 5l2 2M14 5l-2-2M14 5l-2 2" stroke="#000"/>',
  ),
  eraser: svg('<path d="M2 11l6-6 6 6-3 3H5z" fill="#ffb6c1" stroke="#000"/><path d="M5 8l6 6" stroke="#000"/>'),
  picker: svg(
    '<path d="M3 13l7-7 1 1-7 7H3z" fill="#fff" stroke="#000"/><rect x="10" y="2" width="4" height="4" fill="#000" transform="rotate(45 12 4)"/>',
  ),
  ruler: svg(
    '<rect x="1" y="5" width="14" height="6" fill="#ffeb3b" stroke="#000"/><path d="M4 5v3M7 5v2M10 5v3M13 5v2" stroke="#000"/>',
  ),
  zoom: svg(
    '<circle cx="6.5" cy="6.5" r="4.5" fill="#cfe8ff" stroke="#000"/><path d="M10 10l5 5" stroke="#000" stroke-width="2"/>',
  ),
  hand: svg(
    '<path d="M4 8V4a1 1 0 0 1 2 0v3V2a1 1 0 0 1 2 0v5V3a1 1 0 0 1 2 0v5V5a1 1 0 0 1 2 0v6c0 3-2 4-4 4H8c-2 0-3-1-4-3L2 9a1 1 0 0 1 2-1z" fill="#fff" stroke="#000" stroke-width=".8"/>',
  ),
};

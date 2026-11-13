/**
 * Technical illustrations for the site, written by hand as SVG (no image files).
 *
 * One blue line colour with light blue fills, drawn on an isometric grid. The helpers
 * below project "ground" coordinates (x east, y south, z up) to the page, so each
 * figure is described the way you would describe the scene.
 */

const C = Math.cos(Math.PI / 6);
const S = 0.5;

type P3 = [number, number, number?];

/** Isometric projection: ground (x, y) and height z → page (px, py). */
function iso([x, y, z = 0]: P3): [number, number] {
  return [(x - y) * C, (x + y) * S - z];
}
const f1 = (n: number) => (Math.round(n * 10) / 10).toString();
const pt = (p: P3) => iso(p).map(f1).join(' ');
const poly = (ps: P3[]) => `M${ps.map(pt).join('L')}Z`;
const line = (ps: P3[]) => `M${ps.map(pt).join('L')}`;

/** An oval lying on the ground (optionally wobbly, turned and raised). */
function oval(cx: number, cy: number, rx: number, ry: number, o: { rot?: number; z?: number; wobble?: number[]; n?: number } = {}): P3[] {
  const n = o.n ?? 40;
  const c = Math.cos(o.rot ?? 0);
  const s = Math.sin(o.rot ?? 0);
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const k = o.wobble ? 1 + o.wobble.reduce((t, w, j) => t + w * Math.sin((j + 2) * a + j), 0) : 1;
    const x = Math.cos(a) * rx * k;
    const y = Math.sin(a) * ry * k;
    return [cx + x * c - y * s, cy + x * s + y * c, o.z ?? 0] as P3;
  });
}

const path = (d: string, cls: string, extra = '') => `<path d="${d}" class="${cls}"${extra ? ` ${extra}` : ''}/>`;
const text = (p: P3, t: string, anchor = 'start', dx = 0, dy = 0) => {
  const [x, y] = iso(p);
  return `<text x="${f1(x + dx)}" y="${f1(y + dy)}" text-anchor="${anchor}">${t}</text>`;
};

/** A flagstick with a pennant at ground point (x, y). */
function flag(x: number, y: number, h = 46): string {
  const top: P3 = [x, y, h];
  const [tx, ty] = iso(top);
  return (
    path(line([[x, y, 0], top]), 'ln') +
    `<path d="M${f1(tx)} ${f1(ty)}l16 5l-16 6z" class="fill ln"/>` +
    path(poly(oval(x, y, 2.4, 2.4, { n: 12 })), 'ink')
  );
}

/** A slab of ground: top face plus the two visible sides. */
function slab(x0: number, y0: number, x1: number, y1: number, t = 10): string {
  return (
    path(poly([[x0, y1, 0], [x1, y1, 0], [x1, y1, -t], [x0, y1, -t]]), 'side') +
    path(poly([[x1, y0, 0], [x1, y1, 0], [x1, y1, -t], [x1, y0, -t]]), 'side2') +
    path(poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]), 'ground')
  );
}

function svg(viewBox: string, body: string, title: string): string {
  return `<svg class="ill" viewBox="${viewBox}" role="img" aria-label="${title}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

// ---------------------------------------------------------------- figures

/** Hero: a green complex — green, bunkers, flag, a tee in the distance, contour lines. */
function greenComplex(): string {
  const w = [0.05, 0.04, 0.03];
  let b = slab(-150, -110, 150, 110, 14);
  // Contour lines across the ground.
  for (const [r, cx, cy] of [[128, 20, 6], [108, 24, 4], [88, 28, 2]] as const) b += path(poly(oval(cx, cy, r, r * 0.66, { wobble: [0.06, 0.03], rot: 0.2 })), 'contour');
  // Fairway ribbon running back to the tee.
  b += path(poly([[-150, 44], [-96, 30], [-40, 26], [-6, 36], [-10, 70], [-50, 78], [-100, 80], [-150, 86]]), 'fill ln');
  // Tee box, far left.
  b += path(poly([[-142, 54], [-122, 54], [-122, 72], [-142, 72]]), 'ink-soft ln');
  // Green and its bunkers.
  b += path(poly(oval(58, 30, 62, 44, { wobble: w, rot: -0.3 })), 'fill2 ln');
  b += path(poly(oval(58, 30, 46, 31, { wobble: w, rot: -0.3 })), 'contour');
  b += path(poly(oval(-8, -18, 20, 12, { wobble: [0.1, 0.06], rot: 0.5 })), 'sand ln');
  b += path(poly(oval(104, 82, 24, 12, { wobble: [0.1, 0.05], rot: -0.2 })), 'sand ln');
  b += path(poly(oval(118, -14, 14, 10, { wobble: [0.1, 0.05] })), 'sand ln');
  // Line of play and a shot pattern landing on the green.
  b += path(line([[-132, 63], [-40, 50], [62, 28]]), 'dash');
  b += path(poly(oval(62, 28, 34, 22, { rot: -0.5 })), 'dash');
  b += path(poly(oval(62, 28, 17, 11, { rot: -0.5 })), 'ln');
  b += flag(62, 28);
  return svg('-275 -150 550 300', b, 'An isometric drawing of a golf green with three bunkers, a flagstick and a shot pattern');
}

/** FIG: the pixel grid — one pixel is one yard. */
function scaleGrid(): string {
  const n = 8;
  const u = 26;
  let b = slab(0, 0, n * u, n * u, 10);
  for (let i = 1; i < n; i++) {
    b += path(line([[i * u, 0], [i * u, n * u]]), 'grid');
    b += path(line([[0, i * u], [n * u, i * u]]), 'grid');
  }
  // A few painted pixels: a rough circle of "green".
  const on = ['..####..', '.######.', '########', '########', '########', '.######.', '..####..'];
  on.forEach((row, j) =>
    [...row].forEach((ch, i) => {
      if (ch === '#') b += path(poly([[i * u, (j + 0.5) * u], [(i + 1) * u, (j + 0.5) * u], [(i + 1) * u, (j + 1.5) * u], [i * u, (j + 1.5) * u]]), 'fill2 grid');
    }),
  );
  // Dimension line along the front edge of one pixel.
  b += path(line([[0, n * u + 14], [u, n * u + 14]]), 'ln') + path(line([[0, n * u + 8], [0, n * u + 20]]), 'ln') + path(line([[u, n * u + 8], [u, n * u + 20]]), 'ln');
  b += text([u / 2, n * u + 14], '1 YD', 'middle', -4, 24);
  b += path(line([[n * u + 14, 0], [n * u + 14, n * u]]), 'ln') + path(line([[n * u + 8, 0], [n * u + 20, 0]]), 'ln') + path(line([[n * u + 8, n * u], [n * u + 20, n * u]]), 'ln');
  b += text([n * u + 14, (n * u) / 2], `${n} YD`, 'start', 14, 4);
  return svg('-200 -20 420 290', b, 'A grid of pixels, each one yard across, with a round green painted on it');
}

/** FIG: a pixel brush laying down fairway. */
function brush(): string {
  const u = 22;
  let b = slab(0, 0, 9 * u, 7 * u, 10);
  for (let i = 1; i < 9; i++) b += path(line([[i * u, 0], [i * u, 7 * u]]), 'grid');
  for (let j = 1; j < 7; j++) b += path(line([[0, j * u], [9 * u, j * u]]), 'grid');
  // A painted stroke, three pixels wide, with a stepped edge.
  const cells: [number, number][] = [];
  for (let i = 0; i < 6; i++) for (let k = 0; k < 3; k++) cells.push([i, 2 + k + (i > 3 ? 1 : 0)]);
  for (const [i, j] of cells) b += path(poly([[i * u, j * u], [(i + 1) * u, j * u], [(i + 1) * u, (j + 1) * u], [i * u, (j + 1) * u]]), 'fill grid');
  // The brush: a square ferrule and a handle rising from the last stamp.
  const bx = 5.5 * u;
  const by = 4.5 * u;
  b += path(poly(oval(bx, by, u * 1.5, u * 1.5, { n: 20 })), 'dash');
  b += path(poly([[bx - 8, by - 8, 0], [bx + 8, by - 8, 0], [bx + 8, by + 8, 0], [bx - 8, by + 8, 0]]), 'ink-soft ln');
  b += path(poly([[bx - 8, by + 8, 0], [bx + 8, by + 8, 0], [bx + 8, by + 8, 34], [bx - 8, by + 8, 34]]), 'fill2 ln');
  b += path(poly([[bx + 8, by - 8, 0], [bx + 8, by + 8, 0], [bx + 8, by + 8, 34], [bx + 8, by - 8, 34]]), 'side2 ln');
  b += path(poly([[bx - 8, by - 8, 34], [bx + 8, by - 8, 34], [bx + 8, by + 8, 34], [bx - 8, by + 8, 34]]), 'fill ln');
  b += path(poly([[bx - 4, by + 4, 34], [bx + 4, by + 4, 34], [bx + 4, by + 4, 120], [bx - 4, by + 4, 120]]), 'ground ln');
  b += path(poly([[bx + 4, by - 4, 34], [bx + 4, by + 4, 34], [bx + 4, by + 4, 120], [bx + 4, by - 4, 120]]), 'side ln');
  return svg('-150 -130 330 300', b, 'A square brush painting a strip of fairway pixels on a grid');
}

/** FIG: a hole's line of play — tee, aim point, green. */
function holeLine(): string {
  let b = slab(0, 0, 300, 200, 10);
  b += path(poly([[20, 150], [70, 128], [150, 120], [196, 96], [214, 50], [250, 44], [262, 78], [236, 132], [170, 160], [90, 166], [30, 176]]), 'fill ln');
  b += path(poly(oval(244, 44, 26, 20, { wobble: [0.06, 0.04] })), 'fill2 ln');
  b += path(poly(oval(206, 138, 15, 9, { wobble: [0.1], rot: 0.4 })), 'sand ln');
  b += path(poly([[22, 152], [40, 152], [40, 168], [22, 168]]), 'ink-soft ln');
  b += path(line([[31, 160], [186, 132], [244, 44]]), 'dash');
  for (const [x, y] of [[31, 160], [186, 132]]) b += path(poly(oval(x, y, 4, 4, { n: 12 })), 'ink');
  b += flag(244, 44, 40);
  b += text([31, 160], 'TEE', 'end', -10, 4) + text([186, 132], 'AIM POINT', 'start', 4, 22) + text([244, 44], 'GREEN', 'start', 22, -30);
  b += text([108, 146], '158 YD', 'middle', 0, -8) + text([215, 88], '105 YD', 'start', 10, 0);
  return svg('-190 -60 480 300', b, 'A dog-leg golf hole with its line of play from the tee through an aim point to the green');
}

/** FIG: three tee sets on one hole. */
function teeBox(): string {
  let b = slab(0, 0, 300, 150, 10);
  b += path(poly([[150, 48], [220, 40], [300, 44], [300, 108], [220, 112], [150, 104]]), 'fill ln');
  const tees: [number, string, string][] = [[26, 'BACK', 'ink'], [74, 'MIDDLE', 'fill2'], [118, 'FORWARD', 'sand']];
  for (const [x, name, cls] of tees) {
    b += path(poly([[x - 12, 62], [x + 12, 62], [x + 12, 90], [x - 12, 90]]), 'ground ln');
    b += path(poly([[x - 5, 71, 0], [x + 5, 71, 0], [x + 5, 81, 0], [x - 5, 81, 0]]), `${cls} ln`);
    b += path(line([[x, 76], [262, 76]]), 'dash');
    b += text([x, 90], name, 'middle', -6, 26);
  }
  b += path(poly(oval(262, 76, 4, 4, { n: 12 })), 'ink');
  b += text([262, 76], 'FIRST AIM POINT', 'start', 8, -14);
  return svg('-150 -40 430 270', b, 'Three tee boxes, back, middle and forward, each playing to the same first aim point');
}

/** FIG: distance arcs from the tee and to the green. */
function arcs(): string {
  let b = slab(0, 0, 320, 160, 10);
  b += path(poly([[40, 60], [280, 56], [280, 104], [40, 100]]), 'fill ln');
  b += path(poly(oval(290, 80, 20, 16)), 'fill2 ln');
  b += path(line([[24, 80], [290, 80]]), 'dash');
  const arc = (cx: number, r: number, dir: 1 | -1): P3[] => Array.from({ length: 13 }, (_, i) => {
    const a = ((i - 6) / 6) * 0.6;
    return [cx + dir * Math.cos(a) * r, 80 + Math.sin(a) * r] as P3;
  });
  for (const r of [110, 150, 190]) b += path(line(arc(24, r, 1)), 'ln');
  for (const r of [50, 90]) b += path(line(arc(290, r, -1)), 'contour');
  b += text([134, 80 + 66], '150', 'middle', -4, 14) + text([174, 80 + 86], '200', 'middle', -4, 14) + text([214, 80 + 106], '250', 'middle', -4, 14);
  b += text([240, 80 - 30], '50', 'middle', 6, -10) + text([200, 80 - 52], '100', 'middle', 6, -10);
  b += path(poly([[14, 72], [32, 72], [32, 88], [14, 88]]), 'ink-soft ln') + flag(290, 80, 36);
  return svg('-160 -50 460 290', b, 'A golf hole with distance arcs measured out from the tee and back from the green');
}

/** FIG: contour lines over a small hill. */
function contours(): string {
  let b = slab(0, 0, 260, 200, 10);
  const levels = [[100, 0], [80, 12], [60, 24], [42, 36], [24, 48]];
  levels.forEach(([r, z], i) => {
    const o = oval(130 + i * 6, 100 - i * 4, r, r * 0.72, { wobble: [0.08, 0.05, 0.03], rot: 0.3, z });
    b += path(poly(o), i === 0 ? 'fill contour' : i % 2 ? 'fill2 ln' : 'fill ln');
  });
  b += path(line([[154, 84, 48], [154, 84, 84]]), 'ln') + text([154, 84, 84], '48 FT', 'middle', 0, -6);
  b += text([30, 170], '0 FT', 'start', 0, 0);
  return svg('-190 -110 430 310', b, 'Contour lines stacked into a small hill, each line at a different height');
}

/** FIG: the shot pattern — two rings around the target. */
function patternOval(): string {
  let b = slab(0, 0, 300, 180, 10);
  b += path(poly([[0, 52], [300, 44], [300, 132], [0, 128]]), 'fill');
  b += path(line([[20, 90], [200, 90]]), 'dash');
  b += path(poly(oval(200, 90, 48, 80)), 'fill2 dash');
  b += path(poly(oval(200, 90, 24, 40)), 'fill ln');
  b += path(poly(oval(200, 90, 4, 4, { n: 12 })), 'ink');
  b += path(poly([[12, 82], [28, 82], [28, 98], [12, 98]]), 'ink-soft ln');
  // Width dimension across the dashed ring.
  b += path(line([[262, 10], [262, 170]]), 'ln') + path(line([[254, 10], [270, 10]]), 'ln') + path(line([[254, 170], [270, 170]]), 'ln');
  b += text([262, 90], 'WIDTH', 'start', 14, -2) + text([262, 90], '9 IN 10', 'start', 14, 14);
  b += text([200, 90], '4 IN 10', 'middle', -4, -34);
  b += text([110, 90], 'LINE OF PLAY', 'middle', 0, -8);
  return svg('-170 -40 460 290', b, 'A shot pattern drawn as two ovals around the target: the inner holds 4 shots in 10, the outer 9 in 10');
}

/** FIG: the tilt — short-right to long-left. */
function tilt(): string {
  let b = slab(0, 0, 300, 190, 10);
  b += path(line([[20, 95], [280, 95]]), 'dash');
  // Playing towards +x, "right" is +y. Short-right → long-left means the long axis runs from (−x, +y) to (+x, −y).
  b += path(poly(oval(180, 95, 44, 78, { rot: 0.26 })), 'fill2 dash');
  b += path(poly(oval(180, 95, 22, 39, { rot: 0.26 })), 'fill ln');
  // The long axis: from short‑right (+y side, nearer the tee) to long‑left.
  b += path(line([[180 - Math.sin(0.26) * 86, 95 + Math.cos(0.26) * 86], [180 + Math.sin(0.26) * 86, 95 - Math.cos(0.26) * 86]]), 'ln');
  b += path(poly(oval(180, 95, 4, 4, { n: 12 })), 'ink');
  b += path(poly([[12, 87], [28, 87], [28, 103], [12, 103]]), 'ink-soft ln');
  b += text([150, 178], 'SHORT RIGHT', 'middle', -30, 10) + text([214, 12], 'LONG LEFT', 'middle', 34, -4);
  b += text([70, 95], 'LINE OF PLAY', 'middle', 0, -8);
  return svg('-180 -50 460 300', b, 'A shot pattern tilted so that misses to the right finish short and misses to the left finish long');
}

/** FIG: sample dots over a green, a bunker and water. */
function odds(): string {
  let b = slab(0, 0, 300, 190, 10);
  b += path(poly(oval(170, 95, 54, 40, { wobble: [0.05, 0.03] })), 'fill2 ln');
  b += path(poly(oval(122, 150, 26, 14, { wobble: [0.1], rot: 0.2 })), 'sand ln');
  b += path(poly(oval(232, 40, 40, 24, { wobble: [0.08, 0.04], rot: -0.3 })), 'water ln');
  b += path(poly(oval(170, 95, 46, 76, { rot: 0.26 })), 'dash');
  // Evenly spread sample points (the same kind of sequence the app uses).
  const halton = (i: number, base: number) => {
    let f = 1;
    let r = 0;
    while (i > 0) {
      f /= base;
      r += f * (i % base);
      i = Math.floor(i / base);
    }
    return r;
  };
  let dots = '';
  for (let i = 1; i <= 90; i++) {
    const u = halton(i, 2);
    const v = halton(i, 3);
    const r = Math.sqrt(-2 * Math.log(1 - u * 0.999));
    const a = r * Math.cos(2 * Math.PI * v) * 12;
    const s = r * Math.sin(2 * Math.PI * v) * 20;
    const c = Math.cos(0.26);
    const n = Math.sin(0.26);
    const [x, y] = iso([170 + a * c - s * n, 95 + a * n + s * c]);
    dots += `<circle cx="${f1(x)}" cy="${f1(y)}" r="2" class="ink"/>`;
  }
  b += dots + flag(176, 90, 36);
  b += text([122, 150], 'SAND', 'end', -30, 12) + text([232, 40], 'WATER', 'start', 40, -6) + text([170, 95], 'GREEN', 'start', 62, 26);
  return svg('-180 -50 460 300', b, 'Sample landing spots scattered over a green, a bunker and a pond');
}

export const ILLUSTRATIONS: Record<string, () => string> = {
  'green-complex': greenComplex,
  'scale-grid': scaleGrid,
  brush,
  'hole-line': holeLine,
  'tee-box': teeBox,
  arcs,
  contours,
  'pattern-oval': patternOval,
  tilt,
  odds,
};

/** The pixel flag mark used beside the wordmark. */
export const PIXEL_FLAG = `<svg class="pixel-flag" viewBox="0 0 12 14" aria-hidden="true" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><path d="M2 0h1v14H2z" fill="currentColor"/><path d="M3 0h7v1H9v1H8v1H7v1H6v1H3z" fill="#2b4bff"/><path d="M0 13h5v1H0z" fill="currentColor"/></svg>`;

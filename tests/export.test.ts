import { describe, expect, it } from 'vitest';
import { alongLine, fairwayWidth, findHazards, greenTicks, holeFrame, landingZone, lineLength, niceScaleBar, pointAlong, sheetLayout } from '../src/export/layout';
import { buildPdf, LETTER } from '../src/export/pdf';
import { hitLabel, labelWidth } from '../src/model/labels';
import { createDoc } from '../src/model/doc';
import { History } from '../src/model/history';
import { deserialize, serialize } from '../src/model/io';
import { resizeDoc } from '../src/model/resize';

const FAIRWAY = 1;
const SAND = 4;
const WATER = 6;

/** A W × H code map with rectangles painted in (x, y, w, h in pixels). */
function grid(W: number, H: number, rects: [number, number, number, number, number][]): Uint8Array {
  const g = new Uint8Array(W * H);
  for (const [x, y, w, h, c] of rects) for (let j = y; j < y + h; j++) g.fill(c, j * W + x, j * W + x + w);
  return g;
}

describe('scale bar', () => {
  it('picks the longest round length that fits', () => {
    expect(niceScaleBar(2, 300)).toEqual({ yards: 100, px: 200 });
    expect(niceScaleBar(1, 300)).toEqual({ yards: 250, px: 250 });
    expect(niceScaleBar(0.5, 120)).toEqual({ yards: 200, px: 100 });
    expect(niceScaleBar(40, 100).yards).toBe(5); // never less than the smallest bar
  });
});

describe('line of play maths', () => {
  // Straight up the page: tee at the bottom (y = 400), green at the top (y = 0).
  const line = [{ x: 100, y: 400 }, { x: 100, y: 0 }];
  it('measures distance along and to each side', () => {
    expect(alongLine(line, { x: 100, y: 300 })).toEqual({ along: 100, offset: 0 });
    // Playing up the page, +x is to the right.
    expect(alongLine(line, { x: 130, y: 150 })).toEqual({ along: 250, offset: 30 });
    expect(alongLine(line, { x: 80, y: 150 })).toEqual({ along: 250, offset: -20 });
    // Behind the tee clamps to the tee.
    expect(alongLine(line, { x: 100, y: 450 }).along).toBe(0);
  });
  it('follows a dog‑leg', () => {
    const dog = [{ x: 0, y: 300 }, { x: 0, y: 0 }, { x: 200, y: 0 }];
    expect(lineLength(dog)).toBe(500);
    const p = alongLine(dog, { x: 150, y: 10 });
    expect(p.along).toBe(450);
    expect(p.offset).toBe(10); // playing east, south is to the right
    expect(pointAlong(dog, 400)).toEqual({ point: { x: 100, y: 0 }, dir: { x: 1, y: 0 } });
    expect(pointAlong(dog, 9999).point).toEqual({ x: 200, y: 0 });
  });
  it('marks every 50 yards back from the green, stopping short of the tee', () => {
    const t = greenTicks(line);
    expect(t.map((x) => x.yards)).toEqual([50, 100, 150, 200, 250, 300, 350]);
    expect(t[2].point).toEqual({ x: 100, y: 150 });
  });
  it('finds the landing zone', () => {
    expect(landingZone([{ x: 0, y: 160 }, { x: 0, y: 0 }])).toBeNull(); // par 3
    expect(landingZone(line)?.point).toEqual({ x: 100, y: 150 });
    const dog = landingZone([{ x: 0, y: 300 }, { x: 0, y: 60 }, { x: 200, y: 60 }]);
    expect(dog?.point).toEqual({ x: 0, y: 60 });
    expect(dog?.yards).toBe(240);
    expect(dog?.dir.y).toBe(-1); // direction of the tee shot, not of the next leg
  });
});

describe('hazard notes', () => {
  const W = 200;
  const H = 420;
  const line = [{ x: 100, y: 400 }, { x: 100, y: 0 }];
  const opts = { sand: [SAND], water: [WATER] };
  it('reports reach and carry from the tee, and the side', () => {
    const codes = grid(W, H, [
      [115, 160, 12, 20, SAND], // right of the line, 220–240 yd from the tee
      [70, 250, 15, 10, SAND], // left, 140–150 yd
      [60, 60, 80, 15, WATER], // crosses the line, 325–340 yd
    ]);
    const notes = findHazards(codes, W, H, 1, line, opts);
    expect(notes.map((n) => [n.kind, n.side, n.reach, n.carry])).toEqual([
      ['sand', 'L', 140, 150],
      ['sand', 'R', 220, 240],
      ['water', 'C', 325, 340],
    ]);
    expect(notes[1].at.x).toBeCloseTo(121, 0);
  });
  it('ignores hazards outside the corridor, behind the tee, and specks', () => {
    const codes = grid(W, H, [
      [170, 200, 20, 20, SAND], // 70+ yd right: out of play
      [95, 405, 10, 10, SAND], // behind the tee
      [110, 300, 2, 2, SAND], // 4 sq yd speck
    ]);
    expect(findHazards(codes, W, H, 1, line, opts)).toEqual([]);
  });
  it('only measures the part of a big lake that is near the hole', () => {
    const codes = grid(W, H, [[120, 0, 80, 420, WATER]]); // a lake down the whole right side
    const [lake] = findHazards(codes, W, H, 1, line, opts);
    expect(lake.side).toBe('R');
    expect(lake.reach).toBeLessThanOrEqual(1);
    expect(lake.carry).toBeGreaterThanOrEqual(399);
    expect(lake.area).toBeLessThan(80 * 420); // just the 45‑yd corridor's share
  });
  it('works at half‑yard detail', () => {
    const codes = grid(W * 2, H * 2, [[230, 320, 24, 40, SAND]]); // same right‑hand bunker, in ½‑yd pixels
    const [b] = findHazards(codes, W * 2, H * 2, 0.5, line, opts);
    expect([b.side, b.reach, b.carry]).toEqual(['R', 220, 240]);
  });
});

describe('fairway width', () => {
  const W = 200;
  const H = 420;
  const codes = grid(W, H, [[84, 100, 38, 250, FAIRWAY]]); // fairway from x = 84 to 122
  it('measures across the line of play', () => {
    const r = fairwayWidth(codes, W, H, 1, { x: 100, y: 150 }, { x: 0, y: -1 }, [FAIRWAY])!;
    expect(r.width).toBe(38);
    // Walked in half‑yard steps, so the ends are within half a yard of the edges.
    expect(Math.abs(r.left.x - 84)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(r.right.x - 122)).toBeLessThanOrEqual(0.5);
  });
  it('is null off the fairway', () => {
    expect(fairwayWidth(codes, W, H, 1, { x: 30, y: 150 }, { x: 0, y: -1 }, [FAIRWAY])).toBeNull();
    expect(fairwayWidth(codes, W, H, 1, { x: -5, y: 150 }, { x: 0, y: -1 }, [FAIRWAY])).toBeNull();
  });
});

describe('hole page frame', () => {
  const plot = { x: 50, y: 100, w: 600, h: 900 };
  it('puts the tee at the bottom and the green at the top, whatever way the hole runs', () => {
    for (const [tee, green] of [
      [{ x: 100, y: 500 }, { x: 100, y: 100 }], // north
      [{ x: 100, y: 100 }, { x: 500, y: 100 }], // east
      [{ x: 400, y: 80 }, { x: 60, y: 420 }], // south‑west
    ]) {
      const f = holeFrame(tee, green, [tee, green], plot);
      const t = f.toPage(tee);
      const g = f.toPage(green);
      expect(g.y).toBeLessThan(t.y);
      expect(g.x).toBeCloseTo(t.x, 6);
      for (const p of [t, g]) {
        expect(p.x).toBeGreaterThanOrEqual(plot.x);
        expect(p.x).toBeLessThanOrEqual(plot.x + plot.w);
        expect(p.y).toBeGreaterThanOrEqual(plot.y);
        expect(p.y).toBeLessThanOrEqual(plot.y + plot.h);
      }
      // Distances are preserved up to the scale.
      expect(Math.hypot(t.x - g.x, t.y - g.y) / f.scale).toBeCloseTo(Math.hypot(tee.x - green.x, tee.y - green.y), 6);
    }
  });
  it('the canvas matrix agrees with toPage', () => {
    const f = holeFrame({ x: 400, y: 80 }, { x: 60, y: 420 }, [{ x: 300, y: 300 }], plot);
    const [a, b, c, d, e, g] = f.matrix;
    const w = { x: 123, y: 45 };
    expect(a * w.x + c * w.y + e).toBeCloseTo(f.toPage(w).x, 6);
    expect(b * w.x + d * w.y + g).toBeCloseTo(f.toPage(w).y, 6);
  });
  it('keeps a dog‑leg corner and other tees in view, and caps the zoom on short holes', () => {
    const tee = { x: 0, y: 300 };
    const green = { x: 250, y: 0 };
    const corner = { x: -80, y: 20 };
    const f = holeFrame(tee, green, [corner], plot);
    const c = f.toPage(corner);
    expect(c.x).toBeGreaterThan(plot.x);
    expect(c.x).toBeLessThan(plot.x + plot.w);
    expect(holeFrame({ x: 0, y: 20 }, { x: 0, y: 0 }, [], plot, { maxScale: 3 }).scale).toBe(3);
  });
});

describe('presentation sheet', () => {
  it('leaves room for the title, legend and footer around the map', () => {
    const l = sheetLayout(2000, 1400, 9);
    expect(l.map).toMatchObject({ w: 2000, h: 1400 });
    expect(l.width).toBe(2000 + l.map.x * 2);
    expect(l.title.y + l.title.h).toBeLessThanOrEqual(l.map.y);
    expect(l.legend.y).toBeGreaterThan(l.map.y + l.map.h);
    expect(l.legend.cols * l.legend.rows).toBeGreaterThanOrEqual(9);
    expect(l.legend.cols * l.legend.colW).toBeLessThanOrEqual(l.map.w);
    expect(l.footer.y).toBeGreaterThanOrEqual(l.legend.y + l.legend.rows * l.legend.rowH);
    expect(l.height).toBeGreaterThan(l.footer.y + l.footer.h);
  });
  it('copes with a tiny course and with no legend at all', () => {
    const l = sheetLayout(200, 150, 14);
    expect(l.legend.cols).toBeGreaterThanOrEqual(1);
    expect(l.legend.cols * l.legend.rows).toBeGreaterThanOrEqual(14);
    expect(sheetLayout(800, 600, 0).legend.rows).toBe(0);
  });
});

describe('PDF writer', () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const text = (b: Uint8Array) => new TextDecoder('latin1').decode(b);
  it('writes one page per picture with a valid cross‑reference table', () => {
    const pdf = buildPdf([
      { jpeg, width: 1275, height: 1650 },
      { jpeg, width: 1275, height: 1650 },
      { jpeg, width: 800, height: 400 },
    ]);
    const s = text(pdf);
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(s.match(/\/Type \/Page /g)).toHaveLength(3);
    expect(s).toContain('/Count 3');
    expect(s).toContain(`/MediaBox [0 0 ${LETTER.w} ${LETTER.h}]`);
    // Every xref entry points at the start of its object.
    const xrefAt = Number(s.match(/startxref\n(\d+)/)![1]);
    expect(s.slice(xrefAt, xrefAt + 4)).toBe('xref');
    const entries = [...s.slice(xrefAt).matchAll(/(\d{10}) 00000 n /g)].map((m) => Number(m[1]));
    expect(entries).toHaveLength(2 + 3 * 3);
    entries.forEach((off, i) => expect(s.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    // The JPEG bytes are embedded untouched.
    const at = s.indexOf('stream\n') + 7;
    expect([...pdf.subarray(at, at + jpeg.length)]).toEqual([...jpeg]);
    expect(s).toContain(`/Length ${jpeg.length} >>`);
  });
  it('fits a wide picture on the page without stretching it', () => {
    const s = text(buildPdf([{ jpeg, width: 800, height: 400 }]));
    expect(s).toContain('q 612.00 0 0 306.00 0.00 243.00 cm /Im0 Do Q');
  });
});

describe('text labels', () => {
  const labels = [
    { id: 'a', x: 100, y: 100, text: 'Clubhouse', size: 10 },
    { id: 'b', x: 104, y: 102, text: '7', size: 10 },
  ];
  it('hit‑tests by the size of the text, top‑most first', () => {
    expect(labelWidth(labels[0])).toBeCloseTo(52.2, 1);
    expect(hitLabel(labels, { x: 104, y: 101 })?.id).toBe('b');
    expect(hitLabel(labels, { x: 80, y: 100 })?.id).toBe('a');
    expect(hitLabel(labels, { x: 80, y: 108 })).toBeNull();
    expect(hitLabel(labels, { x: 80, y: 108 }, 3)?.id).toBe('a');
    expect(hitLabel(undefined, { x: 0, y: 0 })).toBeNull();
  });
  it('are saved, undone and moved with the course', () => {
    const doc = createDoc({ widthYards: 300, heightYards: 200 });
    const hist = new History(doc);
    hist.begin('Add label');
    hist.snapshotLabels();
    doc.labels = [{ id: 'a', x: 100.1234, y: 50, text: 'Pond', size: 14 }];
    expect(hist.commit()).toBe(true);
    const again = deserialize(serialize(doc));
    expect(again.labels).toEqual([{ id: 'a', x: 100.123, y: 50, text: 'Pond', size: 14 }]);
    resizeDoc(doc, { x: -20, y: -10, w: 320, h: 210 }, 1e7);
    expect(doc.labels![0]).toMatchObject({ x: 120.1234, y: 60 });
    hist.undo();
    expect(doc.labels).toBeUndefined();
    expect(deserialize(serialize(doc)).labels).toBeUndefined();
  });
  it('drops broken labels from a file', () => {
    const j = JSON.parse(serialize(createDoc()));
    j.labels = [{ id: 'x', x: 'no', y: 1, text: 'bad' }, { id: 'y', x: 5, y: 6, text: '   ' }, { id: 'z', x: 5, y: 6, text: 'ok', size: 9999 }];
    expect(deserialize(JSON.stringify(j)).labels).toEqual([{ id: 'z', x: 5, y: 6, text: 'ok', size: 200 }]);
  });
});

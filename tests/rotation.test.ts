// @vitest-environment node
import { describe, expect, it } from 'vitest';

// The view math lives on Editor (DOM-bound); test the same formulas in isolation.
function view(zoom: number, deg: number, panX: number, panY: number) {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return {
    toScreen: (p: { x: number; y: number }) => ({ x: (p.x * cos - p.y * sin) * zoom + panX, y: (p.x * sin + p.y * cos) * zoom + panY }),
    toPx: (s: { x: number; y: number }) => {
      const dx = (s.x - panX) / zoom;
      const dy = (s.y - panY) / zoom;
      return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
    },
  };
}

describe('view rotation math', () => {
  it('screen ↔ course round-trips at any angle', () => {
    for (const deg of [0, 15, 90, -37.5, 180]) {
      const v = view(2.5, deg, 100, -40);
      const p = { x: 123.4, y: -56.7 };
      const back = v.toPx(v.toScreen(p));
      expect(back.x).toBeCloseTo(p.x, 9);
      expect(back.y).toBeCloseTo(p.y, 9);
    }
  });

  it('90° clockwise turns course-right into screen-down', () => {
    const v = view(1, 90, 0, 0);
    const s = v.toScreen({ x: 10, y: 0 });
    expect(s.x).toBeCloseTo(0, 9);
    expect(s.y).toBeCloseTo(10, 9);
  });

  it('“point hole up” angle makes tee→green point up the screen', () => {
    const tee = { x: 100, y: 100 };
    const green = { x: 400, y: 250 };
    const ang = (Math.atan2(green.y - tee.y, green.x - tee.x) * 180) / Math.PI;
    const v = view(1, -90 - ang, 0, 0);
    const a = v.toScreen(tee);
    const b = v.toScreen(green);
    expect(b.x - a.x).toBeCloseTo(0, 6);
    expect(b.y).toBeLessThan(a.y);
  });
});

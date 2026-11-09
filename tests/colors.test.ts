import { afterEach, describe, expect, it } from 'vitest';
import { createDoc } from '../src/model/doc';
import { History } from '../src/model/history';
import { deserialize, serialize } from '../src/model/io';
import { applyColors, pack, surfaceById, surfaceCode, surfacePixel } from '../src/model/surfaces';
import { THEMES } from '../src/model/themes';

afterEach(() => applyColors({}));

describe('course colors', () => {
  it('overrides change rendered pixels and reset cleanly', () => {
    const fw = surfaceCode('fairway');
    const before = surfacePixel(fw, 0, 0);
    applyColors({ fairway: { color: [1, 2, 3] } });
    expect(surfacePixel(fw, 0, 0)).toBe(pack(1, 2, 3));
    applyColors({});
    expect(surfacePixel(fw, 0, 0)).toBe(before);
  });

  it('custom slots exist after the built-in surfaces (codes stay stable)', () => {
    expect(surfaceCode('fairway')).toBe(1);
    expect(surfaceCode('custom1')).toBeGreaterThan(surfaceCode('purple'));
    expect(surfaceById('custom6')?.kind).toBe('custom');
  });

  it('every theme only references real golf surfaces', () => {
    for (const t of THEMES)
      for (const id of Object.keys(t.colors)) expect(surfaceById(id)?.kind, `${t.id}:${id}`).toBe('golf');
  });

  it('colors are saved in the file and undoable', () => {
    const doc = createDoc({ widthYards: 10, heightYards: 10 });
    const h = new History(doc);
    h.begin('theme');
    h.snapshotColors();
    doc.colors = { green: { color: [9, 9, 9] }, custom2: { color: [200, 10, 10] } };
    expect(h.commit()).toBe(true);
    expect(deserialize(serialize(doc)).colors).toEqual(doc.colors);
    h.undo();
    expect(doc.colors).toEqual({});
    h.redo();
    expect(doc.colors.custom2.color).toEqual([200, 10, 10]);
  });

  it('ignores junk colors in files', () => {
    const doc = createDoc({ widthYards: 10, heightYards: 10 });
    const j = JSON.parse(serialize(doc));
    j.colors = { fairway: { color: [999, -5, 10] }, nope: { color: [1, 1, 1] }, green: { color: 'red' } };
    expect(deserialize(JSON.stringify(j)).colors).toEqual({ fairway: { color: [255, 0, 10] } });
  });
});

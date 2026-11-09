import { describe, expect, it } from 'vitest';
import { holeYards } from '../src/editor/holes';
import { imageContains, imageToWorld, worldToImage } from '../src/editor/underlay';
import { createDoc, createImageLayer, suggestPar } from '../src/model/doc';
import { History } from '../src/model/history';
import { deserialize, serialize } from '../src/model/io';
import { renderRegion, visibleCodes } from '../src/render/raster';

describe('holes', () => {
  it('yardage follows the line of play through aim points', () => {
    const h = { id: 'h', number: 1, par: 4, points: [{ x: 0, y: 0 }, { x: 0, y: 300 }, { x: 100, y: 300 }] };
    expect(holeYards(h)).toBe(400);
  });

  it('suggests par from yardage', () => {
    expect(suggestPar(180)).toBe(3);
    expect(suggestPar(410)).toBe(4);
    expect(suggestPar(560)).toBe(5);
  });

  it('hole edits are undoable and saved in the file', () => {
    const doc = createDoc({ widthYards: 50, heightYards: 50 });
    const hist = new History(doc);
    hist.begin('add');
    hist.snapshotHoles();
    doc.holes = [{ id: 'a', number: 1, par: 4, points: [{ x: 1, y: 2 }, { x: 30, y: 40 }] }];
    expect(hist.commit()).toBe(true);
    hist.begin('par');
    hist.snapshotHoles();
    doc.holes = [{ ...doc.holes[0], par: 5 }];
    hist.commit();
    expect(deserialize(serialize(doc)).holes).toEqual(doc.holes);
    hist.undo();
    expect(doc.holes[0].par).toBe(4);
    hist.undo();
    expect(doc.holes).toEqual([]);
  });
});

describe('underlay', () => {
  const l = createImageLayer('u', 'data:,', 200, 100, { x: 50, y: 20, scale: 0.5, rotation: 30 });

  it('image ↔ world mapping round-trips, with rotation and scale', () => {
    const p = { x: 120, y: 33 };
    const back = worldToImage(l, imageToWorld(l, p));
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
    expect(imageToWorld(l, { x: 0, y: 0 })).toEqual({ x: 50, y: 20 });
    expect(imageContains(l, imageToWorld(l, { x: 199, y: 99 }))).toBe(true);
    expect(imageContains(l, imageToWorld(l, { x: 201, y: 50 }))).toBe(false);
  });

  it('set-scale math keeps the anchor point fixed', () => {
    // Same formula ScaleTool uses: scale about point A by k.
    const a = imageToWorld(l, { x: 10, y: 10 });
    const k = 1.7;
    const scaled = { ...l, scale: l.scale * k, x: a.x + (l.x - a.x) * k, y: a.y + (l.y - a.y) * k };
    const a2 = imageToWorld(scaled, { x: 10, y: 10 });
    expect(a2.x).toBeCloseTo(a.x, 9);
    expect(a2.y).toBeCloseTo(a.y, 9);
  });

  it('placement changes are undoable; layer is saved; pixel pipeline ignores it', () => {
    const doc = createDoc({ widthYards: 20, heightYards: 20 });
    const img = createImageLayer('u', 'data:image/png;base64,AAAA', 10, 10);
    doc.layers = [img, ...doc.layers];
    const hist = new History(doc);
    hist.begin('move');
    hist.snapshotImage(img);
    img.x = 7;
    img.opacity = 0.3;
    expect(hist.commit()).toBe(true);
    const back = deserialize(serialize(doc)).layers[0];
    expect(back).toMatchObject({ kind: 'image', x: 7, opacity: 0.3, src: img.src });
    hist.undo();
    expect(img.x).toBe(0);
    expect(img.opacity).toBe(0.6);
    expect(() => renderRegion(doc, { x: 0, y: 0, w: 20, h: 20 })).not.toThrow();
    expect(() => visibleCodes(doc)).not.toThrow();
  });

  it('background renders transparent so underlays can show through', () => {
    const doc = createDoc({ widthYards: 10, heightYards: 10 });
    expect(renderRegion(doc, { x: 0, y: 0, w: 10, h: 10 }).every((v) => v === 0)).toBe(true);
  });
});

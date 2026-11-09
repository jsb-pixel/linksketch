import type { ColorMap } from './surfaces';

/** Course color presets. Only golf surfaces are themed; plain/custom colors are untouched. */
export interface Theme {
  id: string;
  name: string;
  description: string;
  colors: ColorMap;
}

export const THEMES: Theme[] = [
  { id: 'classic', name: 'Classic', description: 'The default Paint look', colors: {} },
  {
    id: 'lush',
    name: 'Lush parkland',
    description: 'Deep, well‑watered greens',
    colors: {
      fairway: { color: [62, 150, 38] },
      green: { color: [110, 196, 82] },
      tee: { color: [46, 118, 36] },
      rough: { color: [14, 92, 22] },
      fescue: { color: [128, 150, 70], color2: [80, 110, 40] },
      trees: { color: [20, 100, 28], color2: [6, 60, 12] },
      grass: { color: [118, 186, 80] },
      water: { color: [30, 110, 230], color2: [10, 40, 110] },
    },
  },
  {
    id: 'links',
    name: 'Links (baked out)',
    description: 'Firm, dry, golden‑brown seaside turf',
    colors: {
      fairway: { color: [168, 172, 96] },
      green: { color: [150, 170, 98] },
      tee: { color: [136, 146, 80] },
      rough: { color: [118, 124, 62] },
      fescue: { color: [200, 182, 112], color2: [150, 132, 72] },
      bunker: { color: [222, 204, 152] },
      waste: { color: [196, 176, 124], color2: [150, 130, 86] },
      trees: { color: [72, 100, 52], color2: [42, 66, 30] },
      grass: { color: [182, 176, 112] },
      water: { color: [70, 112, 160], color2: [30, 60, 100] },
    },
  },
  {
    id: 'desert',
    name: 'Desert',
    description: 'Green ribbons through sand and scrub',
    colors: {
      fairway: { color: [104, 168, 62] },
      green: { color: [130, 190, 96] },
      waste: { color: [222, 192, 142], color2: [186, 150, 100] },
      bunker: { color: [242, 226, 184] },
      fescue: { color: [196, 168, 108], color2: [140, 120, 70] },
      trees: { color: [96, 120, 64], color2: [60, 80, 40] },
      grass: { color: [210, 184, 138] },
      dirt: { color: [168, 110, 66] },
    },
  },
];

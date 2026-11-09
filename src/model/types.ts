import type { ColorMap } from './surfaces';

/** A point. Units depend on context: "world" points are yards, "px" points are doc pixels. */
export interface Vec2 {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** An editable shape (fairway, green, bunker …). Points are in yards. */
export interface Feature {
  id: string;
  surface: string;
  /** Control points in yards. Treat as immutable: replace the array, never mutate it. */
  points: Vec2[];
  /** Render through a smooth spline (organic) instead of straight edges. */
  smooth: boolean;
}

interface LayerBase {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
}

/** Freehand pixels. One byte per doc pixel = surface code (0 = transparent). */
export interface RasterLayer extends LayerBase {
  kind: 'raster';
  pixels: Uint8Array;
  /** Draw automatic 1px black outlines around painted surfaces that have one. */
  outline: boolean;
}

export interface VectorLayer extends LayerBase {
  kind: 'vector';
  features: Feature[];
}

export type Layer = RasterLayer | VectorLayer;

/** Reserved for v0.2 (hole tool / yardages). */
export interface Hole {
  id: string;
  number: number;
  par: number;
  /** Tee → aim points → green center, in yards. */
  points: Vec2[];
}

export interface CourseDoc {
  name: string;
  /** Size in doc pixels. */
  width: number;
  height: number;
  /** Size of one doc pixel in yards. */
  yardsPerPixel: number;
  /** Surface id used for the empty background. */
  background: string;
  /** Course color overrides (themes, custom colors). */
  colors: ColorMap;
  /** Bottom → top. */
  layers: Layer[];
  holes: Hole[];
}

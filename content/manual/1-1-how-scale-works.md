---
title: How scale works
part: Drawing
order: 1.1
summary: Every pixel has a real size, so anything you draw can be measured.
---
Linksketch looks like a paint program, but its canvas is a map. A course is measured in **yards**, and the pixel grid is laid over that: by default, **one pixel is one yard**.

{{fig scale-grid | PIXEL GRID | One pixel covers one square yard. A green about thirty yards across is about thirty pixels across.}}

That one decision is why the rest of the app can exist. The ruler, hole yardages, areas in acres, real aerial photos underneath, and shot patterns in yards all follow from knowing how big a pixel is. Nothing needs calibrating.

## Choosing the pixel size

When you make a new course, or later under **File → Detail**, you pick one of three sizes:

| Pixel size | Good for |
|---|---|
| 1 yard | The classic look. An 18-hole course is about 2,000 × 1,400 pixels. |
| ½ yard | Fine detail: bunker fingers, a single green complex, a short course. |
| 2 yards | Very large properties. |

Changing the detail level later does not move anything. Going finer splits each pixel into four identical ones, so the drawing looks exactly the same. Going coarser keeps the most common surface in each block. Shapes, holes and the map placement are stored in yards, so they are untouched.

## Two kinds of drawing, one scale

**Paint** is stored as pixels. **Shapes** and **holes** are stored as points in yards, and turned into pixels when drawn. Both sit on the same grid, which is why a painted bunker and a shape bunker measure the same.

The size of the whole course area is also in yards. Drag the small handles around its edge, or use **File → Course size**, to grow or crop it on any side. Everything stays where it was on the ground.

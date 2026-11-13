---
title: Painting with surfaces
part: Drawing
order: 1.2
summary: The palette is fairway, green and bunker — not colors. Outlines draw themselves.
---
In Paint you pick a color. In Linksketch you pick a **surface**: Fairway, Green, Tee, Bunker, Waste area, Water, Rough, Fescue, Trees, Dirt, Cart path. A row of plain colors is there too, for everything else.

{{fig brush | BRUSH [ B ]| The brush paints the left surface; right-click paints the second one. Press X to swap them.}}

Each surface knows three things about itself: its color, whether it has a **pixel pattern** (water ripples, fescue speckle, tree texture), and whether it gets a **black outline**.

## Outlines draw themselves

Hand-drawn Paint courses have a one-pixel black line around each fairway and green. Linksketch adds that line for you, wherever a surface meets a lower one. It is always exactly one pixel, at any zoom. Each paint layer has a small outline switch in the Layers panel; the *Detail paint* layer starts with it off, because bunker fingers and tree specks read better without.

## The tools

| Tool | Key | What it does |
|---|---|---|
| Brush | B | Round brush. `[` and `]` change the size. Shift-click draws a straight line from the last point. |
| Pencil | N | Single pixels. |
| Spray | T | Scattered pixels: good for trees and fescue. |
| Fill | G | Fills the area you click, bounded by anything visible. |
| Eraser | E | Removes paint. |
| Magic wand | W | Selects a painted area: see its size, recolor it, delete it, or turn it into a shape. |
| Eyedropper | I | Picks the surface under the cursor. |

Because paint is stored as surfaces rather than colors, a course can be **re-themed** in one step. **Colors → Course colors** offers presets (lush parkland, baked-out links, desert) and lets you tune any surface. The drawing does not change; only how it is shown.

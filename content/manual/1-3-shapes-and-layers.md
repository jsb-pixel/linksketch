---
title: Shapes and layers
part: Drawing
order: 1.3
summary: Shapes can be reshaped by dragging points. Layers decide what draws on top.
---
Painting is the main way to work, but sometimes you want an outline you can adjust. That is what **shapes** are for.

Draw a loop with the **Freehand shape** tool (F) and it becomes a smooth shape with a handful of control points. Drag a point to reshape it, double-click the outline to add one, and ⌥-click a point to remove it. The **Polygon** tool (P) makes straight-edged shapes such as tee boxes and buildings.

## Working with several shapes

- **Shift-click** or drag a box with the Select tool (V) to select more than one.
- Drag any of them to move the group; arrow keys nudge one yard (ten with Shift).
- **Edit → Move shapes by…** moves an exact distance, in yards east and north.
- **Combine shapes** (⌘J) merges shapes that touch into one.

Going the other way, the magic wand's **Make shape** turns a painted area into a shape.

## Layers

A new course has three layers: *Base paint*, *Course shapes*, and *Detail paint* on top. Paint on the base, keep adjustable outlines in the middle, and add the fiddly bits last.

Within a shape layer, surfaces also have a natural order: a bunker draws over a green, which draws over a fairway, which draws over rough. You rarely need to think about it.

## Crisp shapes

Zoomed far in, shapes show their pixels like everything else. **View → Crisp shapes when zoomed in** draws them as smooth curves instead, from 200% zoom upward. Paint stays pixelated, and exports are always the true pixel drawing.

{{fig shot:crisp | VIEW OPTION | The same green at 800% zoom: as pixels, and with crisp shapes switched on.}}

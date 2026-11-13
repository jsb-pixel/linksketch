---
title: "v0.1 — A paint program that knows what a fairway is"
date: 2026-11-09
order: 1
tags: [linksketch, devlog]
summary: The first version: a Paint-style canvas where the palette is fairway, green and bunker instead of plain colors, and every pixel is one yard.
---
<!-- TODO(owner): this devlog was drafted from the project's change history. Rewrite it in your own words if you like. -->

Linksketch started under the working name *Fairway Paint*, and the name says most of it. Open it and you get what jspaint gives you: a toolbox, a palette, a canvas. No sign-up and no wizard.

Two things are different from a paint program.

**The palette is surfaces, not colors.** You pick Fairway, Green, Bunker, Water, Fescue or Trees. Each one has its own color, an optional pixel pattern (water ripples, fescue speckle) and a black one-pixel outline drawn for you, the way hand-drawn Paint courses are outlined.

**Every pixel has a real size.** A new course is in yards from the start: one pixel is one yard. A green is about thirty pixels across, which happens to be the scale people already draw at. That single decision is what makes everything later possible: a ruler, yardages, real maps.

What was in v0.1:

- Brush, pencil, spray, fill, eraser and eyedropper on paint layers.
- Shapes you can reshape by dragging points, for when you want that.
- A magic wand that selects a painted area, tells you its size, and can turn it into a shape.
- A ruler that measures in yards.
- Layers, undo for everything, autosave in the browser, `.fairway` files and PNG export.

The pixel look is not a filter. The app has its own small rasterizer, because the browser's drawing tools blur edges and I wanted hard, palette-exact pixels at any zoom.

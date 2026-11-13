---
title: Terrain and contours
part: Maps & Terrain
order: 3.2
summary: A height map in feet, shown as hillshade and contour lines.
---
A course can carry a **height map**: the height of the ground, in feet, on a grid laid over the course.

{{fig contours | CONTOUR LINES | Each line joins points of equal height. Lines close together mean a steep slope.}}

## Getting terrain

- **Real land.** For a course placed on the map, **Terrain → Import real elevation (USGS)** downloads it from the 3D Elevation Program. The data is public domain and covers the United States.
- **Imagined land.** **Terrain → Start flat terrain**, then shape it with the **Shape terrain** tool (D): raise, lower, smooth, or flatten to the height where you started the stroke. Hold ⌥ to do the opposite of raise or lower.

## Reading it

Terrain draws over the course in two ways, each with its own switch:

- **Hillshade** darkens slopes that face away from a light in the north-west. It gives an immediate sense of shape.
- **Contour lines** every 1, 2, 5 or 10 feet, with every fifth line heavier.

## What uses it

Once terrain exists, the status bar shows the height under the cursor, the ruler reports the climb, and each hole shows its rise or fall and what it plays like.

Terrain follows the course when you resize it, is saved in the file, and every brush stroke can be undone.

{{fig shot:terrain | TERRAIN LAYER | The sample course with hillshade and five-foot contours switched on.}}

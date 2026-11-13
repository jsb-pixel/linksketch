---
title: "Selecting several shapes, and combining them"
date: 2026-11-10
order: 1
tags: [linksketch, devlog]
summary: Shift-click or drag a box to select many shapes, move them together by an exact number of yards, and merge overlapping shapes into one.
---
<!-- TODO(owner): drafted from the change history. Rewrite in your own words if you like. -->

Small things that make shape editing less fiddly:

- **Select several shapes** with shift-click or by dragging a box around them. ⌘A selects them all.
- Drag any one to **move the group**, nudge with the arrow keys, or type an exact distance: "20 yards east, 5 north".
- **Combine shapes** (⌘J) merges shapes that touch into a single outline. It is done on a fine pixel mask rather than with exact geometry, which sounds crude but copes with messy freehand loops that exact methods choke on.
- Layers can be **reordered by dragging**.

Also new: a precision cursor that sits beside the point you are painting instead of on top of it, and an outline around the exact pixel under the pointer when zoomed in.

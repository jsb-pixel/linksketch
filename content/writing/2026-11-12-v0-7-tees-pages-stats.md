---
title: "v0.7 — Tee sets, yardage-book pages, stats, and a hard look at the code"
date: 2026-11-12
order: 1
tags: [linksketch, devlog]
summary: Multiple tee sets with a scorecard column each, printable hole pages, course stats, a presentation sheet, text labels, an installable app — and twenty-one bugs fixed.
---
<!-- TODO(owner): drafted from the change history. Rewrite in your own words if you like. -->

This is the version where the roadmap ran out.

**Tee sets.** Name and color them per course (Back, Middle, Forward…). Each set has its own tee on each hole and its own column on the scorecard. Click a column to play from that set; yardages and strategy follow.

**Hole pages.** Any hole exports as a yardage-book page: tee at the bottom, yards to reach and to carry each bunker and pond, yards to the green every fifty, fairway width where the tee shot lands, and the strategy ovals if they are on. All holes export together as one PDF.

**Course stats.** Acres of each surface, square feet of greens, number of bunkers, total yardage per tee set. In the Info panel, and as a CSV.

**Presentation sheet.** The whole course with a title block, a legend of the surfaces actually used, a scale bar and a north arrow. A new Text tool adds labels.

**Smaller things.** An option to draw shapes as smooth curves when zoomed in. The editor installs like an app and opens offline (maps and elevation still need a connection). A sample course under *File → Open sample course*.

**And a review.** Before adding any of this, every file was read with fresh eyes. Twenty-one real bugs turned up, mostly where two features met: dragging a shot target could not be undone, resizing the course left targets behind, strategy odds went stale when a player was edited. Each fix has a test that fails without it. The app also gained end-to-end tests that drive a real browser.

---
title: How hazard odds are counted
part: Strategy
order: 4.3
summary: Eight hundred sample shots, each one checked against what you drew.
---
Beside each oval is a line such as *235 yd · 23% trouble — 14% sand · 6% water*. Those numbers are counted, not estimated.

{{fig odds | SAMPLING | Each dot is one sample shot. The app looks up the surface under every dot and adds them up.}}

## The count

For each shot, the app places **800 landing spots** following the shot's pattern. For every spot it looks up which surface is there, using everything visible on the course: paint, shapes and all.

Each surface counts as one outcome:

| Surface | Outcome |
|---|---|
| Fairway, tee | Fairway |
| Green | Green |
| Bunker, waste area | Sand |
| Water | Water |
| Trees | Trees |
| Fescue | Fescue |
| Outside the course area | Off course |
| Anything else | Rough |

**Trouble** is sand, water, trees, fescue and off course added together.

## Why the numbers hold still

The 800 spots are not random. They come from a fixed, evenly spread sequence, so the same hole always gives the same numbers, and nudging a bunker by a yard changes the result by a little rather than making it jump about.

With 800 samples, one sample is an eighth of a percent, so differences of a point or two are real.

## Aiming somewhere else

Drag the dot at the centre of an oval to aim that shot away from the line of play, for example at the middle of the green rather than the flag. The odds update as you drag, and the next shot plays from the new spot. Double-click the dot to put it back.

{{fig shot:strategy | STRATEGY MODE | The sample course's fourth hole for a 10 handicap, with the odds for each shot.}}

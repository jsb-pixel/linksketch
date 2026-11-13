---
title: How the shot pattern is modeled
part: Strategy
order: 4.1
summary: Shots spread around their target. The spread is an oval, measured in yards.
---
Nobody hits the ball exactly where they aim. Hit the same shot a hundred times and the balls finish in a cloud around the target. Strategy mode draws that cloud.

{{fig pattern-oval | SHOT PATTERN | The solid ring holds about 4 shots in 10. The dashed ring holds about 9 in 10, and its width is the number you set for each player.}}

## Shots

Each leg of a hole's line of play is one planned shot. It is played from where the previous shot finished on average, towards the next point on the line.

A player has a **longest shot**. If a leg is longer than that, the shot finishes short of its target, and the next one starts from there. If the planned shots run out before the green, extra ones are added.

## The oval

The cloud is modeled as a bell curve in two directions: sideways, and long-or-short. That makes an oval.

You describe a player by the **width of their pattern in yards**:

| Player | Longest shot | Driver width | 150-yard width |
|---|---|---|---|
| Scratch | 265 yd | 60 yd | 24 yd |
| 10 handicap | 235 yd | 75 yd | 36 yd |
| 20 handicap | 205 yd | 90 yd | 48 yd |

Width means the **dashed ring**, which holds about nine shots in ten. In-between distances blend between the two widths, and shots shorter than 150 yards shrink in proportion.

The long-or-short spread is 60% of the sideways spread. Players are usually better at distance than at direction.

These are starting points, drawn from published shot data. Edit them for the course under **Strategy → Players**.

## What is left out

Wind, slope, roll and the lie are not modeled. The pattern is where shots finish on flat, calm ground. That is enough to compare two versions of a hole honestly.

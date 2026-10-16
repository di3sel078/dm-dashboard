# Contrast audit (WCAG 2.1 AA)

The thresholds are 4.5:1 for normal text and 3:1 for large text (at least 24px regular, or at least 18.66px bold).

**How the ratios were computed:**
- Ratios use the WCAG relative-luminance formula. They are worked out from the token values in `variables.css`.
- Where a background is a translucent tint over a surface (for example the amber chip wash on `--bg-1`), the tint is alpha-blended first and the text is measured against the result.
- Cards use a gradient from `--bg-3` to `--bg-2`. Each pair is checked against the lighter stop, which is the worst case for light text.

## Changes made

| Token | Before | After | Why |
| --- | --- | --- | --- |
| `--text-3` | `#6f6a62` | `#9a948b` | Failed on every surface (2.68 to 3.24). Used for hints and small labels. |
| `--text-2` | `#a39d93` | `#b3ada3` | Passed, but only 4.69 on `--bg-4`. Raised for margin, and to stay one step lighter than the new `--text-3`. |
| `--red-200` | `#ef5350` | `#f4736f` | Used as text for the enemy subtitle, to-hit, negative modifiers and the damage button. Failed on raised surfaces (4.12 on `--bg-3`). |
| Font sizes | 0.55rem, 0.58rem, 0.6rem, 0.68rem | `--fs-2xs` (0.7rem) | The smallest label size is now 0.7rem. `--fs-xs` rose from 0.72rem to 0.75rem. |

## Results

| Text token | Background | Used for | Before | After | Result |
| --- | --- | --- | --- | --- | --- |
| `--text-0` | `--bg-3` | Primary text on raised surfaces | 12.75 | 12.75 | Pass |
| `--text-1` | `--bg-3` | Secondary text | 9.36 | 9.36 | Pass |
| `--text-1` | `--bg-4` | Secondary text on hover | 8.24 | 8.24 | Pass |
| `--text-1` | `--bg-1` | Combat log text | 11.35 | 11.35 | Pass |
| `--text-2` | `--bg-0` | Muted text on page floor | 7.12 | 8.60 | Pass |
| `--text-2` | `--bg-1` | Muted text in wells | 6.47 | 7.81 | Pass |
| `--text-2` | `--bg-2` | Muted text on cards | 5.91 | 7.14 | Pass |
| `--text-2` | `--bg-3` | Muted text on raised surfaces | 5.33 | 6.44 | Pass |
| `--text-2` | `--bg-4` | Muted text on hover | 4.69 | 5.67 | Pass |
| `--text-2` | `--bg-1` + `--amber-glow-soft` | Muted text in tinted chips | n/a | 5.87 | Pass |
| `--text-3` | `--bg-0` | Hints on page floor | n/a | 6.37 | Pass |
| `--text-3` | `--bg-1` | Hints and labels in wells | 3.24 | 5.79 | Fail → Pass |
| `--text-3` | `--bg-2` | Hints and labels on cards | 2.97 | 5.29 | Fail → Pass |
| `--text-3` | `--bg-3` | Hints and labels on raised surfaces | 2.68 | 4.77 | Fail → Pass |
| `--red-200` | `--bg-2` | Negative modifiers, damage button | n/a | 5.70 | Pass |
| `--red-200` | `--bg-3` | Enemy subtitle, to-hit | 4.12 | 5.15 | Fail → Pass |
| `--red-200` | `--bg-4` | Red text on hover surfaces | n/a | 4.53 | Pass |
| `--red-200` | `--red-900` | Down tag, danger hover | 4.66 | 5.83 | Pass |
| `--text-0` | `--red-700` | Primary button, darkest stop | 8.89 | 8.89 | Pass |
| `--text-0` | `--red-400` | Primary button, lightest stop | 4.99 | 4.99 | Pass |
| `--text-0` | `--red-800` | Danger button | 11.48 | 11.48 | Pass |
| `--text-0` | `--bg-turn-enemy` | Current enemy card | n/a | 13.78 | Pass |
| `--text-0` | `--blue-tint` | Current PC card | n/a | 13.42 | Pass |
| `--text-0` | `--bg-0` | Dead tag | 17.02 | 17.02 | Pass |
| `--gold-400` | `--bg-3` | Section titles, lair subtitle | 7.63 | 7.63 | Pass |
| `--gold-400` | `--bg-1` | Legendary label, drawer titles | n/a | 9.26 | Pass |
| `--gold-500` | `--bg-2` | Gold labels and borders | 6.58 | 6.58 | Pass |
| `--amber-300` | `--bg-1` + `--amber-glow-soft` | Condition chips | 9.27 | 9.27 | Pass |
| `--amber-300` | `--bg-3` | Bloodied label, save-attack text | n/a | 10.17 | Pass |
| `--purple-300` | `--bg-1` + `--purple-glow-soft` | Concentration chips | 5.49 | 5.49 | Pass |
| `--purple-300` | `--bg-2` + `--purple-glow-soft` | Concentration save banner | n/a | 4.98 | Pass |
| `--green-300` | `--bg-1` | Healthy HP, success pips | 10.59 | 10.59 | Pass |
| `--green-300` | `--bg-3` | Heal button | n/a | 8.73 | Pass |
| `--blue-300` | `--bg-1` + `--blue-glow-soft` | Ready chip | 6.79 | 6.79 | Pass |
| `--blue-400` | `--bg-1` | Spell slot title | 7.86 | 7.86 | Pass |
| `--cyan-400` | `--bg-1` | Temp HP | 9.47 | 9.47 | Pass |

"n/a" means the pair didn't exist before this upgrade, or wasn't part of the original audit.

## Known exceptions

1. **`--text-3` on `--bg-4` is 4.20.** `--text-3` is not used on `--bg-4`. Hover states that switch to `--bg-4` also switch the text to `--text-0` or `--text-1`.
2. **Disabled controls** (`opacity: 0.45`) are exempt under WCAG 1.4.3 (inactive user interface components).
3. **Down and Dead cards are dimmed on purpose,** so they read as out of the fight at a glance. Their opacity was raised from 0.55 to 0.7 (Down) and from 0.45 to 0.6 (Dead). This keeps primary text above 4.5:1. Muted labels inside a dimmed card can still drop below 4.5:1. The state is never shown by dimming alone: every such card also carries a text tag ("Down", "Dying", "Stable", "Dead"), and its HP bar has an `aria-valuetext`.
4. **Gradient text** (the round number and brand title) is display text of 24px and up. Its darkest stop is still above 3:1.

## How to re-check

Change a token in `variables.css`, then recompute the pairs above with any WCAG contrast checker. When a pair sits on a tinted chip, blend the tint over the surface first.

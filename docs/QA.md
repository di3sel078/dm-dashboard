# QA checklist

The Phase 5 run, recorded on 2026-10-16.

## How it was tested

| Method | What it covers | How to rerun |
| --- | --- | --- |
| Rules tests | 71 tests of the pure logic in `rules.js`, including all 18 SRD stat blocks | `node tests/rules.test.js`, or open `tests/rules.test.html` |
| Scripted UI run | 42 checks that drive the real page (clicks, keys, dialogs, storage) in jsdom | `tests/ui/qa-run.js` (see `tests/ui/README.md`) |
| Migration run | Boots with a v1 save and exercises the Phase 1 rules through the cards | `tests/ui/migration.js` |
| Screenshots | Headless Firefox at 1440, 1200, 900 and 600 px wide; full and compact views; player view; library | Done by hand during development (not scripted) |

Nobody clicked through a real browser by hand. The items in "Still needs a human" below are the ones automation can't settle.

## Scripted run: 42 of 42 passed

The scenario:
- The 18 SRD monsters are added from an empty enemy library.
- Four PCs are built in the builder: Aria, with Perception expertise; Brom, with fire resistance; Cass, a caster; and Dain, a Warlock with short-rest Pact slots.
- One encounter holds the 4 PCs, an Adult Red Dragon (legendary 3, resistance 3), 2 Skeletons and a lair action.
- The fight runs from round 1 into round 4, with a reload in the middle.

| Area | Check | Result |
| --- | --- | --- |
| Setup | Add SRD starter monsters from the empty enemy library | Pass |
| Setup | Create 4 PCs in the builder (fire resistance, short-rest Pact slots, skill expertise) | Pass |
| Setup | Create the encounter: 4 PCs, legendary dragon, 2 skeletons, lair action | Pass |
| Initiative | Roll Initiative (grouped): enemies rolled, PCs untouched, the skeletons share one roll | Pass |
| Initiative | Type PC initiatives; per-card roll button | Pass |
| Turn order | Surprise toggle in round 1 disables the reaction chip | Pass |
| Layout | Compact view toggle persists | Pass |
| Damage | Fire against the fire-immune dragon deals 0, and the toast shows "30 fire, immune: 0" | Pass |
| Damage | Vulnerability doubles (bludgeoning against a skeleton) | Pass |
| Damage | Resistance halves, rounding down (13 fire against Brom deals 6) | Pass |
| Concentration | Damage to a concentrating caster shows a persistent DC chip that counts stacked saves | Pass |
| Conditions | Condition immunity blocks Poisoned on a skeleton, with a toast | Pass |
| Conditions | A 2-round duration shows rounds remaining on the chip | Pass |
| Notes | DM notes are saved and previewed on the card; legendary text shows in the detail view | Pass |
| Legendary | Spend legendary actions and legendary resistance by clicking pips | Pass |
| Action economy | Reaction, bonus action and ready toggles | Pass |
| Rolls | To-hit and damage rolls from the card are logged | Pass |
| Dice | d20 with advantage; free-text `2d6+3`; `process.exit()` is rejected by the parser | Pass |
| Turn order | Surprise is cleared by round 2, and the reaction chip works again | Pass |
| Death & dying | A PC at 0 HP becomes Unconscious automatically, loses concentration and shows a Dying tag | Pass |
| Death & dying | Damage at 0 HP adds 1 failure, a crit adds 2, and the card reads Dead (visually distinct from Stable) | Pass |
| Undo | Ctrl+Z brings the PC back from Dead to Dying | Pass |
| Healing | Healing from 0 resets death saves and removes the automatic Unconscious | Pass |
| Healing | Healing caps at max HP; Temp keeps the higher value and toasts when a grant is ignored | Pass |
| Death & dying | Massive damage (overflow at least max HP) kills outright; undo restores | Pass |
| Exhaustion | Cumulative effect text is shown; level 6 reads Dead | Pass |
| Turn order | Delay moves the current combatant after a later one | Pass |
| Remove | Removing a combatant shows an Undo toast with no confirm; Undo restores them | Pass |
| Recharge | Marking Fire Breath spent makes it roll automatically on the dragon's turn | Pass |
| Legendary | Legendary actions refill on the dragon's own turn; legendary resistance does not | Pass |
| Persistence | A reload mid-fight keeps round, turn, HP, conditions and log | Pass |
| Conditions | Frightened (2 rounds) expires and the expiry is logged | Pass |
| Economy | Aria's reaction resets at the start of her own turn | Pass |
| Rounds | More than 3 full rounds completed (ended in round 4) | Pass |
| Rests | A short rest restores only Pact (short-rest) slots and recharge abilities | Pass |
| Rests | A long rest restores HP and legendary resistance and skips creatures at 0 HP (the preview says so) | Pass |
| Log | The log holds damage, heal, condition, turn, roll, recharge, death and concentration entries | Pass |
| Encounters | Duplicate encounter resets to round 1 at full HP | Pass |
| Data | Export, then Import with Replace (confirmed) | Pass |
| Data | Re-imported library and encounters match the export byte for byte | Pass |
| Player view | Shows round, order, PC HP and enemy bands only; no AC, HP numbers, notes, attacks or lair text; the DM UI is never rendered | Pass |
| Runtime | No script errors during the whole run | Pass |

These are also covered in the earlier phase checks: v1 save migration through the real boot (v1 left untouched), malformed and newer-schema imports rejected with state untouched, Merge import, the storage-full toast with Export and the "Not saved" indicator, focus restore and focus trap, the `?` shortcut, arrow keys being opt-in, and live-region announcements.

## Visual checks (headless Firefox screenshots)

| Width | View | Result |
| --- | --- | --- |
| 1440 | Full cards, 12 combatants | Pass. HP block sits right under the header; AC, actions and legendary pips follow. |
| 1440 | Compact, 12 combatants | Pass after fixes. One row per combatant, about 125px tall, no horizontal scroll. |
| 1200 | Full | Pass. Tracker bar goes to a single centred column; cards reflow to 3 columns. |
| 900 | Full | Pass. Tracker actions wrap, cards drop to 2 columns, tabs fit. |
| 600 | Full | Pass. Single column, brand title hidden, the round number shrinks, tabs fit. |
| 1440 | Player view | Pass after a fix. Large type, the current-turn highlight, enemies as bands only. |
| 1440 | Library with 18 SRD monsters | Pass after a fix. Search, sort and filters render; rows are readable. |

The detail and builder dialogs couldn't be screenshotted (headless capture doesn't open them). Their 900px and 600px rules (single-column detail grid; full-screen modals at 600px) are untested visually.

## Issues found and fixed during verification

| Found in | Issue | Fix |
| --- | --- | --- |
| Phase 2 | Ctrl+Z did nothing while focus sat in an empty field | An empty field now hands Ctrl+Z to app undo; a field with text keeps its own undo |
| Phase 2 | The dice parser accepted `2d6 3` as `2d63` | Whitespace is only allowed around `+` and `-` |
| Phase 3 | The compact layout let HP controls overflow into the AC column | Reworked the compact grid with `min-width: 0` and wrapping HP controls |
| Phase 3 | Long names ignored the 1–2 line clamp (the name is now a button) | The clamp moved onto the button |
| Phase 3 | The compact init box was too narrow for 2 digits and the spinner | Hid the label and roll icon in compact; kept the full width |
| Phase 4 | The player-view health pill stretched full width | `align-self: flex-start` |
| Phase 4 | Library metadata wrapped mid-pair ("HP" over "59"), and ⚔ rendered as a stray "x" | `nowrap` per pair; the word "Attacks" instead of the glyph |
| Phase 5 | No app bugs. The only failures in the first QA attempts were test timing (async dialogs) | Fixed in the script |

## Still needs a human

1. **Two real windows.** The player window updates through `BroadcastChannel` plus `storage` events. jsdom tested the `storage` path only.
2. **Opening from `file://`.** Chrome shares localStorage between `file://` pages. Firefox and Safari can isolate each file. I haven't checked the Player View there. If it stays on "Waiting for the DM…", serve the folder (for example `python3 -m http.server`) and open `http://localhost:8000/`.
3. **Screen reader pass** (VoiceOver or NVDA): turn announcements, HP band announcements, and the dialogs.
4. **Touch.** The amount and initiative fields use native number spinners, which are small on touch screens. The numeric keypad still works.
5. **Dialogs at 900px and 600px** (see Visual checks).

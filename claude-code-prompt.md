# Task: Upgrade the DM Dashboard (D&D 5e, 2014 rules) to fix review findings

You are working on a vanilla HTML/CSS/JS D&D 5e initiative and combat tracker. Files: `index.html`, `styles.css`, `variables.css`, `main.js`. State lives in localStorage under `dm-dashboard-state-v1`. The target ruleset is the 2014 Player's Handbook, Dungeon Master's Guide and Monster Manual, NOT the 2024 revision.

Work in the phases below, in order. Finish and verify each phase before starting the next, and make one git commit per phase (initialize git first if there is no repo).

## Hard constraints (do not violate)

1. No build step, no framework, no npm dependencies at runtime. Keep it openable via `index.html` with only the existing Google Fonts link as an external resource.
2. Keep the existing architecture: IIFE in `main.js` with the 7 numbered sections, every mutation goes through `commit()`, templates in the library are separate from encounter instances, `normalizeTemplate` and `normalizeInstance` act as the migration layer.
3. Every new color, spacing, radius, font size, shadow and duration is a token in `variables.css`. `styles.css` must never hard-code a value that should be a token. While you are in there, replace the existing hard-coded leftovers (for example `#a5d6a7`, `#7cb342`, `#ffca28`, `#302020`, `rgba(...)` literals) with tokens.
4. Preserve the visual identity: dark near-black surfaces, blood red accent, gold ornaments, Cinzel display and Inter body, red for enemies, white/blue for PCs, gold for lair actions.
5. Do not break existing saved data. Bump the storage key to `dm-dashboard-state-v2`, and on load, if v2 is absent but v1 exists, migrate v1 through the normalizers into v2 (keep v1 untouched as a backup). All new fields must have safe defaults in the normalizers.
6. Escape all user-provided text with `escapeHtml`. No `innerHTML` with unescaped user data.
7. Do not add comments narrating what you changed. Keep the existing comment style (short, explains why).
8. If you are not certain what the 2014 rules say about something, do NOT guess. Put it in a list called "Rules to verify" in your final report and implement the most conservative behavior. Do not silently import 2024 rules.

## Phase 0: Read and plan

Read all four files fully. Then write `docs/PLAN.md` (create the folder) containing: the data model changes you intend (new fields on templates and instances), the new `ui` state fields, and the migration approach. Do not ask for approval, just proceed after writing it.

## Phase 1: Rules correctness fixes (existing behavior that is wrong or risky)

1. **Healing at full HP.** Remove the behavior where healing a creature at max HP adds temp HP. Healing caps at max HP. Add a separate explicit "Temp" button or action for granting temp HP. Temp HP does not stack in the rules: when granting temp HP, keep the higher of the old and new value, and tell the DM via toast when the new value was ignored.
2. **Damage at 0 HP and massive damage (PCs).** `adjustHp` currently discards overflow. Make it return a result object `{ absorbedByTemp, hpLost, overflow, droppedToZero, instantDeath }`. Rules to implement:
   - If damage reduces a PC to 0 HP and the remaining overflow damage is greater than or equal to the PC's max HP, the PC dies instantly (set death saves fail to 3 and show Dead).
   - If a PC is already at 0 HP and takes damage, add one death save failure. Add a "Critical hit" toggle next to the damage controls that makes that count two failures. Damage at 0 HP that is greater than or equal to max HP is instant death.
   - If a PC drops to 0 HP, automatically add the Unconscious condition (and remove it when HP goes above 0, unless the DM added it separately; track this with an `autoUnconscious` flag on the instance).
   - Healing a PC from 0 HP resets death saves (already done), removes the auto Unconscious, and keeps Prone as is (do not auto-add Prone, the rules do not auto-add it as a condition).
   - Monsters at 0 HP are simply dead or down. Keep the Down tag, do not give them death saves.
   - A PC with 3 failures shows Dead and should be visually distinct from Stable. The turn banner should note when the current combatant is Dead or Unconscious.
3. **Concentration.**
   - Remove the cap at 30 on the save DC. 2014 rule: DC is 10 or half the damage taken, whichever is higher. Flag in "Rules to verify" if you find anything contradicting this.
   - Make the concentration save prompt persistent, not a 3 second toast: add a small dismissible banner chip on the card ("Concentration save DC 14") that stays until dismissed or until the next damage replaces it. Stack multiple damage instances by showing the latest DC and a count.
   - Dropping to 0 HP or being incapacitated or unconscious ends concentration automatically (already done for 0 HP, extend to the Incapacitated, Paralyzed, Petrified, Stunned and Unconscious conditions).
4. **Initiative bonus for enemies.** Add an editable `initBonus` field for enemies in the builder (blank falls back to the DEX modifier, same as PCs), update `initBonusOf`, the normalizers, the picker label, and the detail modal.
5. **Exhaustion (2014, six levels).** Show the effect text for the current level in the detail modal and as a tooltip on the card chip: 1 disadvantage on ability checks, 2 speed halved, 3 disadvantage on attack rolls and saving throws, 4 hit point maximum halved, 5 speed reduced to 0, 6 death. At level 6 mark the creature Dead. Do not auto-modify HP max, just show the warning.
6. **Condition effects.** Add a `CONDITION_EFFECTS` constant with a one-line summary of each 2014 condition from the PHB appendix, shown as tooltips on condition chips and as short text in the detail modal. Include Exhaustion separately as above.
7. **Lazy Encounter Benchmark wording.** Rename the tier label "Potentially deadly" to "Over benchmark" and make the tooltip clear this is a rough heuristic, not the DMG XP budget. Show the single-monster warning only when exactly one enemy type is dominating, and word it as a hint. Keep the math.
8. **Spell slot recovery.** Add `recovery: "long" | "short"` per spell slot level (default "long"; allow Warlock-style "short" in the builder). See Phase 2 for the rest buttons.

## Phase 2: Missing combat features (2014 DM essentials)

Add these in order. Each needs builder fields, normalizers with defaults, card and detail UI, and persistence.

1. **Legendary actions and legendary resistance.**
   - Template fields: `legendaryActions` (count per round, default 0 meaning none; typical is 3) and `legendaryResistance` (uses per day, default 0).
   - Instance fields: `legendaryActionsLeft` and `legendaryResistanceLeft`.
   - UI: pips on the card like spell slots. Legendary action pips refill automatically at the start of that creature's own turn (in `nextTurn`, same place recharges roll). Legendary resistance pips do not auto-refill. Also allow a manual spend via clicking pips.
2. **Damage resistances, immunities and vulnerabilities, and condition immunities.**
   - Template fields: arrays of damage types (use the existing `DAMAGE_TYPES`; also allow a free-text "nonmagical bludgeoning, piercing and slashing" style note as plain text, not mechanics).
   - The damage control gets an optional damage type selector. When a type is chosen, resistance halves (round down), vulnerability doubles, immunity reduces to 0, and the toast shows the math ("12 fire, resistant: 6"). With no type selected, apply raw damage. Order of operations per the PHB: apply the type modifiers first, then temp HP, then HP.
   - Condition immunities block adding that condition via the toggle (show a toast explaining why).
3. **Action economy tracking.** Per instance: `reactionUsed` and `bonusActionUsed` booleans shown as small toggle chips on the card. Reaction resets at the start of that creature's own turn. Bonus action also resets at the start of its own turn. Both reset on Next Turn for the creature whose turn begins, not globally.
4. **Condition durations.** Each active condition can optionally have a duration in rounds: `{ name, endsOnRound }` or `null` for indefinite. Setting a duration happens in the detail modal (small number input "ends after N rounds" when toggling on). On round advance, when `enc.round` passes `endsOnRound`, remove the condition and toast it. Chips on the card show remaining rounds. Keep backward compatibility: migrate existing `conditions` string arrays.
5. **Traits and actions text.** Add free-text multi-line fields to enemy templates: `traits`, `actions`, `reactions`, `legendaryText`. Render them as readable sections in the detail modal (preserve line breaks, escape HTML). Add an optional `multiattack` single-line text field shown at the top of Attacks.
6. **Saving-throw attacks.** Extend attack entries with a `kind` of `"attack"` (to-hit, current behavior) or `"save"` (breath weapons and similar) with `saveDc`, `saveAbility`, `halfOnSave`. Auto-fill DC from 8 + proficiency + ability modifier with the same override-or-auto pattern as to-hit. Cards show "DC 15 DEX, half on save" instead of a to-hit.
7. **Saving throws, senses, and stat block completeness.**
   - Saving throw proficiencies per ability (checkboxes in the builder, shown as bonuses on the detail modal).
   - Fields: `senses` (text), `languages` (text), `creatureType` (text), `alignment` (text), and a computed read-only passive Perception (10 + Perception bonus, using the existing skill proficiency logic; allow proficiency or expertise).
   - XP by CR table (2014 DMG, including CR 0 = 0 or 10 XP, so verify and flag it) shown on the enemy detail and used for the encounter XP total.
8. **Per-combatant notes.** A short DM notes field per instance (for tactics like "retreats at half HP"), editable in the detail modal, with a one-line preview on the card when non-empty.
9. **Rests.** Encounter-level buttons: "Short Rest" and "Long Rest". Long rest restores all HP, clears temp HP, restores all spell slots, resets death saves and legendary resistance, removes exhaustion level 1, and resets recharges. Short rest restores only slots marked `recovery: "short"` and resets recharges. Both show a confirm dialog listing what changes.
10. **Initiative roller.** In the encounter header add "Roll Initiative": rolls d20 + `initBonusOf` for each enemy (with an option "group identical monsters" that shares one roll per template) and leaves PCs untouched, since players roll their own. Show the roll breakdown in the combat log. Add a small "roll" button next to each initiative input for single rolls.
11. **Dice roller and combat log.**
    - A compact dice roller (d4, d6, d8, d10, d12, d20, d100, plus a free-text expression like `2d6+3`) with advantage and disadvantage for d20 rolls. Parse expressions with a small safe parser (no `eval`, no `Function`).
    - Clicking an attack's to-hit or damage on a card rolls it and logs the result.
    - A combat log panel (collapsible drawer) recording damage, healing, conditions, turn changes, rolls and recharge results, stored per encounter and capped at 300 entries.
12. **Turn order controls.** Manual reorder is currently only via initiative numbers. Add "Delay" (move the current combatant after a chosen combatant, which changes their initiative to just below that target) and a "Ready action" flag chip. Add a surprise toggle for round 1 per combatant (surprised creatures cannot act or react until their turn ends in round 1; show a chip and skip the reaction toggle until round 2).
13. **Undo.** Implement an undo stack (last 30 mutations) for HP changes, turn advancement, add and remove combatant, and condition changes. Snapshot the active encounter before each `commit()` that goes through a user action. Ctrl or Cmd+Z undoes, and a toast with an "Undo" button appears after destructive actions such as removing a combatant. Replace the confirm dialog for removing a combatant with that toast (keep the confirm for deleting a whole encounter or a library entry).

## Phase 3: UX and design fixes

1. **Card hierarchy.** Restructure the combatant card so HP is the most prominent element: HP bar and numbers directly under the header, then AC, then conditions. Move the six ability mods, skills, speed and attacks into a collapsible section within the card (default collapsed in compact mode, expanded in full mode).
2. **Compact combat view.** Add a toggle in the tracker bar between Full and Compact. Compact shows only: initiative, name, AC, HP bar and numbers, damage/heal controls, condition chips, concentration chip, legendary/reaction pips. Persist the choice in `state.ui`. Compact mode should fit 10 or more combatants on a 1440px-wide screen without scrolling horizontally.
3. **Damage and heal controls.** Replace the ambiguous glyph-only `−` and `+` with clearly labeled buttons ("Damage" in red, "Heal" in green), larger touch targets (at least 40px tall), and the damage type selector from Phase 2. Keep Enter for damage and Shift+Enter for heal, and display that hint in a tooltip.
4. **Card click behavior.** Opening the detail modal on any card click competes with inline inputs. Change it so only the card header (name area) and the expand icon open the modal.
5. **Contrast and legibility.** Audit every text and background pair against WCAG AA (4.5:1 for normal text, 3:1 for large text). Raise `--text-3` and `--text-2` where needed and increase the smallest labels (currently 0.55rem to 0.6rem) to a minimum of 0.7rem. Write the audit results as a table in `docs/CONTRAST.md` (token pairs, ratio, pass or fail, fix applied).
6. **Number input spinners.** Restore them for the HP delta field and the initiative field only, or add small stepper buttons, so mouse and touch users can adjust values.
7. **Responsive layout.** Add breakpoints at 1200px, 900px and 600px. Specifically: the tracker bar becomes a single column; `.detail-summary` becomes 2 or 3 columns; `.attack-row` becomes a two-row grid; `.skill-grid` drops to 2 then 1 column; `.library-columns` stacks; `.modal` goes full width on small screens; topbar tabs scroll horizontally if needed. Update the file header comment that says "Desktop-only by design".
8. **Keyboard shortcuts.** Add a "?" shortcut and a small keyboard icon in the topbar that opens a shortcuts dialog. Include: N or right arrow for next turn, P or left arrow for previous, Ctrl or Cmd+Z undo, D to open the dice roller, L to toggle the log. Do not hijack arrow keys while the page is scrolled and nothing is focused if that conflicts with scrolling: instead use only N and P and make the arrow keys opt-in via a setting.
9. **Accessibility.**
   - HP bar gets `role="progressbar"` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax` and a text label.
   - Status that currently relies on color alone (HP state, turn highlight, Down) gets a text or icon equivalent.
   - Add an `aria-live="polite"` region that announces turn changes ("Round 3, Goblin 2's turn") and HP threshold changes.
   - Focus is trapped and restored correctly in all dialogs, and every icon-only button keeps an `aria-label`.
   - Respect `prefers-reduced-motion` (already present, keep it working with new animations).
10. **Empty states and polish.** Add hover and focus styles for every new control, make sure the new components use the same motion tokens, and keep the card entrance animation from replaying on every re-render (currently each `commit()` rebuilds all cards, so animations can flicker). Fix this by only animating newly added cards, or by diffing and updating cards in place where practical.

## Phase 4: Data safety, library and sharing

1. **Export and import.** Buttons in the Library header and in a new Settings menu: "Export all data (JSON)" downloads a versioned file (`schemaVersion` field) and "Import" validates it, previews counts (encounters, PCs, enemies), and offers Merge or Replace. Run imports through the normalizers and reject anything malformed without touching existing data.
2. **Duplicate encounter.** Add "Duplicate" to the encounter card. The copy resets round to 1, HP to full, slots, recharges, conditions and the clock, but keeps combatants and initiative.
3. **Library management.** Search box, filter by CR range for enemies and by class for PCs, sort options (name, CR, level, HP), and duplicate-template action. Add a "Clone as variant" action that opens the builder prefilled.
4. **SRD starter content.** Do NOT scrape or download anything. Instead create `data/srd-starter.js` containing a small hand-written starter set of about 15 common monsters from the freely licensed 5e SRD (for example goblin, orc, skeleton, zombie, wolf, bandit, ogre, owlbear, young green dragon), with correct 2014 stat values. Include the required Creative Commons attribution text in the UI footer or settings and in a `LICENSE-SRD.md`. Offer a one-click "Add starter monsters to library" button shown only when the enemy library is empty. Put anything whose stats you are not sure of in "Rules to verify" and leave it out.
5. **Player-facing view.** Add a "Player View" button that opens a second window via `?view=player` (same file, same origin) which reads state through `localStorage` plus a `BroadcastChannel` for live updates. It shows only: round, turn order with names, PC HP, enemy health as bands (Unharmed, Hurt, Bloodied at or below half, Critical at or below a quarter, Down), conditions and the current-turn highlight. It must never show enemy AC, exact HP, stats, notes, attacks or lair text. Large type, readable from across a table.
6. **Safe storage.** Handle `QuotaExceededError` with a clear toast and an offer to export. Add a "last saved" indicator in the topbar.

## Phase 5: Verification

1. Add `tests/rules.test.html` (a no-dependency page that runs in the browser, or a Node script if you extract the pure logic into `rules.js` loaded by both). Cover at minimum: `adjustHp` (temp HP absorb, massive damage instant death, damage at 0 HP adding failures, crit double failures, healing cap), resistance and vulnerability rounding, concentration DC (including damage of 1, 19, 20 and 80 to prove there is no cap at 30), recharge parsing, proficiency by CR for every CR from 0 to 30, initiative tie-break order, XP totals, Lazy Benchmark tiers, condition duration expiry on round advance, rest behavior, and the v1 to v2 migration (including a fixture of a v1 save file).
2. Run through a manual checklist and record it in `docs/QA.md`: create an encounter with 4 PCs and a legendary boss with a lair action, run 3 full rounds, use every new feature at least once, reload mid-fight and confirm state persists, import and export round trip, player view shows no hidden info, and resize the window to 1200, 900 and 600 pixels wide.
3. Fix every issue found, then re-run the tests.

## Final report (print this at the end)

1. A short summary per phase of what changed, with file names.
2. A "Rules to verify" list: every rule, table value or stat you were not 100 percent sure of, citing the book and page if you know it, and saying plainly if you do not.
3. Anything from this brief you did not do, and why.
4. Known limitations and suggested next steps.

Do not stop to ask questions unless a decision would be destructive or irreversible. Otherwise choose the simplest option that fits the constraints, note it in the report, and keep going.

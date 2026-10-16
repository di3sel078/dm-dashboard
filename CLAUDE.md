# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

DM Dashboard is a D&D 5e combat and encounter tracker that follows the **2014** PHB, DMG and MM (not the 2024 revision). It is a static site with no dependencies:

- [index.html](index.html), [rules.js](rules.js), [main.js](main.js), [styles.css](styles.css), [variables.css](variables.css)
- [data/srd-starter.js](data/srd-starter.js), an optional starter monster set

There is no build step, package manager or linter. Run it by opening `index.html` in a browser, or serve the folder (`python3 -m http.server`) so the Player View window can share storage. The only network resource is Google Fonts (Cinzel, Inter).

Git: if the `/usr/bin/git` shim complains about the Xcode licence, use `/Applications/Xcode.app/Contents/Developer/usr/bin/git`.

## Tests

- `node tests/rules.test.js` runs the rules tests with no dependencies. `tests/rules.test.html` runs the same file in a browser.
- `tests/ui/` holds optional jsdom scripts that drive the real page. See `tests/ui/README.md`. jsdom is installed temporarily and is never a project dependency.
- `docs/QA.md` is the manual and scripted checklist. `docs/CONTRAST.md` is the WCAG audit. `docs/PLAN.md` describes the data model.

## Architecture

**rules.js** holds the pure logic, exposed as `window.DMRules` (and as `module.exports` for Node). It has no DOM access, storage or timers:
- constants (`CONDITION_EFFECTS`, `XP_BY_CR`, …)
- the normalizers and `migrateState`
- `adjustHp`, `applyDamage`, `applyHealing`, `afterHpChange`
- conditions, turn order, `delayTurn`, `rollInitiative`, `applyRest`
- the dice parser, combat log helpers, import validation, `duplicateEncounter`, `filterLibrary`
- `playerProjection`

Functions that need randomness take an `rng`. Side effects the DM should hear about come back as `{ kind, text }` events, not toasts.

**main.js** is a single IIFE with numbered sections: constants → state and storage → domain helpers → rendering → dialogs → event wiring → boot.

- **State** is one object, `{ creatureLibrary: {pcs, enemies}, encounters, ui }`. It is saved to `localStorage` under `dm-dashboard-state-v2` with `schemaVersion` and `savedAt`. On first load, a v1 save (`dm-dashboard-state-v1`) is migrated through the normalizers; the v1 key is left as a backup.
- **All mutations go through `commit()`**, which saves and then re-renders. Pass `commit({ undo: "label" })` for anything in the encounter that the DM may want to undo. The previous snapshot of the active encounter is pushed onto a 30-step undo stack. Rule events go through `announce(events)`, which logs them to `enc.log` (capped at 300) and toasts them.
- **Normalisation is the schema.** `normalizeTemplate`, `normalizeInstance`, `normalizeEncounter` and `normalizeUi` in rules.js default every field. They are the migration layer for old saves and for imports. When you add a field, give it a default there and add a test.
- **Templates and instances:** the library holds templates. `instantiate()` makes combatant instances, which carry encounter state:
  - HP, conditions as `{name, endsOnRound}`, death saves, `autoUnconscious`
  - `concentrationCheck`, legendary pips, `reactionUsed` / `bonusActionUsed` / `readied` / `surprised`
  - `notes`, `initRank`

  `templateFromInstance()` strips that state again. A `lair` combatant represents lair actions.
- **Rendering** is a full re-render from template strings. Always escape user text with `escapeHtml`. Focus is restored after a re-render with a data-attribute selector, and only newly added cards animate.
- **Per-combatant actions** use event delegation. `applyCombatantAction` returns `false`, `true` (changed) or an undo label; the cards and the detail dialog share it.
- **Dialogs** are native `<dialog>` elements opened with `openModal()`, which records the opener, restores focus on close and traps Tab. `promptDialog`, `confirmDialog` and `choiceDialog` return promises.
- **Player View** is `index.html?view=player` (`PLAYER_MODE`). It never renders the DM screen, never saves, and only draws `R.playerProjection(state)`. It refreshes on a `BroadcastChannel("dm-dashboard")` ping and on `storage` events.

## Styling conventions

[variables.css](variables.css) holds every design token: colors, shade and glow shadows, spacing, radii, font sizes (no label smaller than `--fs-2xs`, 0.7rem), durations and layout sizes. [styles.css](styles.css) must not hard-code those values, so add a token first. Text colors are tuned for WCAG AA; re-check `docs/CONTRAST.md` before changing them.

The theme is dark with blood-red accents and gold ornaments. Enemies are red, PCs are white or blue, and lair actions are gold. Semantic colors: green for healing and healthy, amber for wounded and conditions, cyan for temp HP, purple for concentration, blue for the PC turn highlight and spell slots.

Breakpoints are 1200px, 900px and 600px. The compact card layout is `.card-grid.is-compact`.

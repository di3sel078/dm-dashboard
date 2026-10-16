# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

DM Dashboard is a D&D combat/encounter tracker. It is a zero-dependency static site: [index.html](index.html), [main.js](main.js), [styles.css](styles.css), [variables.css](variables.css). There is no build step, package manager, linter, or test suite, and the directory is not a git repo. Run it by opening `index.html` in a browser (or any static server, e.g. `python3 -m http.server`). Only Google Fonts (Cinzel, Inter) load from the network.

## Architecture

**main.js** is a single IIFE with numbered sections (see the header comment): constants/utilities → state & storage → domain helpers → rendering → dialogs → event wiring → boot.

- **State** is one object `{ creatureLibrary: {pcs, enemies}, encounters, ui }`, persisted to `localStorage` under `dm-dashboard-state-v1`. The `ui` slice (current view, active encounter id) is persisted too.
- **All mutations go through `commit()`**, which calls `saveState()` then `renderAll()`. Mutate state, then call `commit()`. Rendering is full re-render via template-string HTML (`escapeHtml` for user text), not a virtual DOM.
- **Normalisation is the schema.** `normalizeTemplate`, `normalizeInstance`, `normalizeEncounter` and `loadState` coerce and default every field, so they double as the migration layer. When adding a field, add its default there so old saved data loads.
- **Templates vs. instances:** the library holds creature *templates* (PC or enemy). `instantiate()` clones a template into a *combatant instance* (with `instanceId`, `templateId`, current HP, spell slots, recharges, conditions, etc.) inside an encounter. A special `lair` combatant type represents lair actions (`LAIR_INITIATIVE`).
- **Combat flow:** `sortEncounter` orders combatants by initiative; `nextTurn`/`prevTurn` advance `currentTurnIndex` and `round`. Each encounter has its own clock (`elapsedMs` + `startedAt`). `encounterDifficulty` computes difficulty.
- **Per-combatant actions** are handled by event delegation: `combatantFromEvent` resolves the card, and `applyCombatantAction` switches on a button's `data-*` action. The same actions work from the card and the detail dialog.
- **Dialogs** use native `<dialog>` elements declared in `index.html` (creature builder, detail, picker, prompt, confirm, plus a toast helper). `promptDialog` and `confirmDialog` are promise-based.
- Views are the three tabs (`encounters`, `active`, `library`), toggled via `state.ui.view`; the matching `<section id="view-…">` elements live in `index.html`.

## Styling conventions

[variables.css](variables.css) holds all design tokens (colors, spacing, radii, font sizes, shadows). [styles.css](styles.css) consumes them and is meant to never hard-code values, so add new tokens to variables.css first. The theme is dark with blood-red accents; semantic colors are used consistently (green = healing/healthy, amber = wounded/conditions, cyan = temp HP, purple = concentration, blue = PC turn highlight/spell slots).

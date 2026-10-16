# Upgrade plan: 2014 rules fixes and DM essentials

Target ruleset: 2014 PHB, DMG and MM. Nothing from the 2024 revision.

## File layout

| File | Role |
| --- | --- |
| `rules.js` (new) | Pure logic with no DOM access: constants, math, normalizers, HP and damage rules, conditions, turn order, rests, dice parser, XP, difficulty, v1 to v2 migration, import validation. UMD wrapper: `window.DMRules` in the browser, `module.exports` in Node. |
| `main.js` | Still one IIFE with the 7 numbered sections. Holds state, storage, undo, rendering, dialogs and events. Pulls its rules from `DMRules`. |
| `data/srd-starter.js` (new) | Hand-written SRD 5.1 starter monsters, exposed as `window.DM_SRD_STARTER`. |
| `tests/rules.test.js` and `tests/rules.test.html` (new) | Tests with no dependencies. The same test file runs in Node (`node tests/rules.test.js`) and in the browser. |

I'm splitting the pure rules into `rules.js` because the brief allows it for testability. The normalizers stay the migration layer. They live in `rules.js` so that Node can test them, and `main.js` section 2 calls them.

## Data model

### Template fields (library stat blocks)

Shared by PCs and enemies:

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `initBonus` | number or `null` | `null` | Blank means DEX modifier, worked out at read time. Enemies gain it now. PCs already had it, saved as a number. |
| `saves` | ability key[] | `[]` | Saving throw proficiencies. |
| `skills` | skill key[] | `[]` | Now on PCs too, for passive Perception. |
| `expertise` | skill key[] | `[]` | Subset of `skills`, adds proficiency twice. |
| `senses`, `languages` | string | `""` | |
| `damageResistances`, `damageImmunities`, `damageVulnerabilities` | damage type[] | `[]` | From `DAMAGE_TYPES`. |
| `damageNotes` | string | `""` | Plain text with no mechanics, e.g. "nonmagical bludgeoning, piercing and slashing". |
| `conditionImmunities` | (condition or `"Exhaustion"`)[] | `[]` | |
| `spellSlots[].recovery` | `"long"` or `"short"` | `"long"` | |

Enemies only:

| Field | Type | Default |
| --- | --- | --- |
| `creatureType`, `alignment` | string | `""` |
| `legendaryActions` | int ≥ 0 | `0` (none) |
| `legendaryResistance` | int ≥ 0 | `0` |
| `traits`, `actions`, `reactions`, `legendaryText` | multi-line string | `""` |
| `multiattack` | string | `""` |
| `attacks[].kind` | `"attack"` or `"save"` | `"attack"` |
| `attacks[].saveDc`, `attacks[].autoSaveDc` | number, boolean | auto: 8 + prof + ability mod |
| `attacks[].saveAbility` | ability key | `"dex"` |
| `attacks[].halfOnSave` | boolean | `false` |
| `attacks[].note` | string | `""`, e.g. "plus 2d6 poison" |

### Instance fields (combatants in an encounter)

| Field | Type | Default |
| --- | --- | --- |
| `conditions` | `{ name, endsOnRound }[]` | `[]`. Old string arrays become `{ name, endsOnRound: null }`. `endsOnRound` is the last round the condition is active; it expires when `enc.round > endsOnRound`. |
| `autoUnconscious` | boolean | `false` |
| `concentrationCheck` | `{ dc, count }` or `null` | `null` |
| `legendaryActionsLeft` | int | `legendaryActions` |
| `legendaryResistanceLeft` | int | `legendaryResistance` |
| `reactionUsed`, `bonusActionUsed`, `readied`, `surprised` | boolean | `false` |
| `notes` | string | `""`. DM notes for creatures; lair actions already use `notes`. |
| `initRank` | number | `0`. Tie-break override set by Delay, reset when the initiative input changes. |

### Encounter fields

| Field | Type | Default |
| --- | --- | --- |
| `log` | `{ id, at, round, kind, text }[]` | `[]`, capped at 300 |

### `ui` state (persisted)

| Field | Default |
| --- | --- |
| `cardMode` | `"full"` (or `"compact"`) |
| `arrowKeys` | `false` (opt-in arrow key turn control) |
| `logOpen`, `diceOpen` | `false` |
| `groupInitiative` | `true` (PHB p.189: one roll per group of identical creatures) |
| `librarySearch`, `libraryClass`, `librarySort` | `""`, `""`, `"name"` |
| `libraryCrMin`, `libraryCrMax` | `""` |

Saved payload: `{ schemaVersion: 2, savedAt, creatureLibrary, encounters, ui }`.

## Migration

1. The storage key becomes `dm-dashboard-state-v2`.
2. On load, if v2 exists, parse it and run it through the normalizers.
3. If v2 is absent and `dm-dashboard-state-v1` exists, parse v1, run it through the same normalizers, write the result to v2 and leave v1 untouched as a backup.
4. If neither exists, start with the default state.
5. Every new field gets a default in `normalizeTemplate`, `normalizeInstance`, `normalizeEncounter` or `normalizeUi`, so old and partial data loads. Import files go through the same path (`migrateState`). Malformed import files are rejected before anything is written.

## Undo

The undo history lives in memory, not in storage, and holds the last 30 snapshots of the active encounter. After each save, a snapshot of the active encounter (as JSON) is kept. A `commit({ undo: "label" })` pushes the previous snapshot before saving. Undo restores the snapshot but keeps the live clock.

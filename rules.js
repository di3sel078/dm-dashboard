/* ==========================================================================
   DM Dashboard — Rules (D&D 5e, 2014 PHB / DMG / MM)
   Pure logic only: no DOM, no storage, no timers. Loaded by index.html as
   window.DMRules and by the Node tests via require().
   Functions that need randomness take an rng (defaults to Math.random) so
   tests can make them deterministic. Functions that cause side effects the
   DM should hear about return an array of { kind, text } events instead of
   toasting directly.
   ========================================================================== */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DMRules = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- Constants ---------- */

  const STAT_KEYS = ["str", "dex", "con", "int", "wis", "cha"];
  const STAT_NAMES = {
    str: "Strength", dex: "Dexterity", con: "Constitution",
    int: "Intelligence", wis: "Wisdom", cha: "Charisma",
  };

  const SKILLS = [
    ["acrobatics", "Acrobatics", "dex"], ["animalHandling", "Animal Handling", "wis"],
    ["arcana", "Arcana", "int"], ["athletics", "Athletics", "str"],
    ["deception", "Deception", "cha"], ["history", "History", "int"],
    ["insight", "Insight", "wis"], ["intimidation", "Intimidation", "cha"],
    ["investigation", "Investigation", "int"], ["medicine", "Medicine", "wis"],
    ["nature", "Nature", "int"], ["perception", "Perception", "wis"],
    ["performance", "Performance", "cha"], ["persuasion", "Persuasion", "cha"],
    ["religion", "Religion", "int"], ["sleightOfHand", "Sleight of Hand", "dex"],
    ["stealth", "Stealth", "dex"], ["survival", "Survival", "wis"],
  ].map(([key, name, ability]) => ({ key, name, ability }));
  const SKILL_BY_KEY = Object.fromEntries(SKILLS.map((s) => [s.key, s]));

  const CONDITIONS = [
    "Blinded", "Charmed", "Deafened", "Frightened", "Grappled", "Incapacitated", "Invisible",
    "Paralyzed", "Petrified", "Poisoned", "Prone", "Restrained", "Stunned", "Unconscious",
  ];

  /** One-line summaries of PHB Appendix A (2014). */
  const CONDITION_EFFECTS = {
    Blinded: "Can't see; auto-fails checks that need sight. Attacks against it have advantage; its attacks have disadvantage.",
    Charmed: "Can't attack the charmer or target it with harmful effects; the charmer has advantage on social checks against it.",
    Deafened: "Can't hear; auto-fails checks that need hearing.",
    Frightened: "Disadvantage on ability checks and attacks while the source is in sight; can't willingly move closer to it.",
    Grappled: "Speed 0. Ends if the grappler is incapacitated or the creature is moved out of reach.",
    Incapacitated: "Can't take actions or reactions.",
    Invisible: "Can't be seen without magic or a special sense. Attacks against it have disadvantage; its attacks have advantage.",
    Paralyzed: "Incapacitated; can't move or speak; auto-fails STR and DEX saves. Attacks against it have advantage; hits from within 5 ft. are crits.",
    Petrified: "Turned to stone and incapacitated; auto-fails STR and DEX saves; resistance to all damage; immune to poison and disease. Attacks against it have advantage.",
    Poisoned: "Disadvantage on attack rolls and ability checks.",
    Prone: "Can only crawl; standing costs half its speed; disadvantage on attacks. Attacks against it have advantage within 5 ft., disadvantage beyond.",
    Restrained: "Speed 0; disadvantage on attacks and DEX saves. Attacks against it have advantage.",
    Stunned: "Incapacitated; can't move; speaks falteringly; auto-fails STR and DEX saves. Attacks against it have advantage.",
    Unconscious: "Incapacitated; can't move or speak; drops what it holds and falls prone; auto-fails STR and DEX saves. Attacks against it have advantage; hits from within 5 ft. are crits.",
  };

  /** PHB p.291. Effects are cumulative: a creature suffers its level and every level below. */
  const EXHAUSTION_EFFECTS = [
    null,
    "Disadvantage on ability checks",
    "Speed halved",
    "Disadvantage on attack rolls and saving throws",
    "Hit point maximum halved",
    "Speed reduced to 0",
    "Death",
  ];

  /** Conditions that include being incapacitated, which ends concentration (PHB p.203). */
  const INCAPACITATING = ["Incapacitated", "Paralyzed", "Petrified", "Stunned", "Unconscious"];

  const CLASSES = [
    "Artificer", "Barbarian", "Bard", "Cleric", "Druid", "Fighter", "Monk",
    "Paladin", "Ranger", "Rogue", "Sorcerer", "Warlock", "Wizard", "Other",
  ];
  const CR_OPTIONS = ["0", "1/8", "1/4", "1/2", ...Array.from({ length: 30 }, (_, i) => String(i + 1))];
  const DAMAGE_TYPES = [
    "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
    "piercing", "poison", "psychic", "radiant", "slashing", "thunder",
  ];
  const LAIR_INITIATIVE = 20;

  /* ---------- Utilities ---------- */

  const uuid = () =>
    (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() :
      "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      }));

  const toInt = (value, fallback = 0) => {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : fallback;
  };
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const clone = (obj) => JSON.parse(JSON.stringify(obj));
  const isBlank = (v) => v === null || v === undefined || String(v).trim() === "";

  const modifier = (score) => Math.floor((toInt(score, 10) - 10) / 2);
  const formatMod = (m) => (m >= 0 ? `+${m}` : `−${Math.abs(m)}`);
  const formatNum = (n) => String(+n.toFixed(2));

  /** "1/4" → 0.25, "" → 0 */
  const parseCr = (cr) => {
    const s = String(cr ?? "");
    if (s.includes("/")) {
      const [n, d] = s.split("/").map(Number);
      return d ? n / d : 0;
    }
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : 0;
  };
  /** MM p.8: +2 at CR 0–4, +3 at 5–8, … +9 at 29–30. */
  const profFromCr = (cr) => 2 + Math.floor((Math.max(parseCr(cr), 1) - 1) / 4);

  const rechargeLabel = (min) => (min >= 6 ? "6" : `${min}–6`);
  const rollDie = (sides, rng = Math.random) => 1 + Math.floor(rng() * sides);

  /** Blank (null) means "use the DEX modifier", for PCs and enemies alike. */
  const initBonusOf = (c) => (c && c.type !== "lair" && Number.isFinite(c.initBonus) ? c.initBonus : modifier(c?.stats?.dex));

  /** PHB p.15: +2 at levels 1–4, rising by 1 every four levels. */
  const profFromLevel = (level) => 2 + Math.floor((clamp(toInt(level, 1), 1, 20) - 1) / 4);
  const profOf = (c) => (c?.type === "pc" ? profFromLevel(c.level) : profFromCr(c?.cr));

  /** Ability mod, plus proficiency if proficient, plus it again with expertise. */
  const skillBonus = (c, key) => {
    const skill = SKILL_BY_KEY[key];
    if (!skill) return 0;
    const prof = profOf(c);
    const proficient = (c.skills || []).includes(key);
    const expert = proficient && (c.expertise || []).includes(key);
    return modifier(c.stats?.[skill.ability]) + (proficient ? prof : 0) + (expert ? prof : 0);
  };
  const saveBonus = (c, ability) =>
    modifier(c.stats?.[ability]) + ((c.saves || []).includes(ability) ? profOf(c) : 0);
  /** PHB p.175: 10 + Wisdom (Perception) bonus. Advantage/disadvantage (±5) is not modelled. */
  const passivePerception = (c) => 10 + skillBonus(c, "perception");
  /** DC 8 + proficiency + ability modifier (MM p.11 "Saving Throws" for monster abilities). */
  const autoSaveDc = (c, ability) => 8 + profOf(c) + modifier(c.stats?.[ability]);

  /** DMG p.275 / MM p.9. CR 0 is 10 XP when it has effective attacks, else 0; we use 10. */
  const XP_BY_CR = {
    "0": 10, "1/8": 25, "1/4": 50, "1/2": 100,
    1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300, 7: 2900, 8: 3900, 9: 5000, 10: 5900,
    11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000, 16: 15000, 17: 18000, 18: 20000,
    19: 22000, 20: 25000, 21: 33000, 22: 41000, 23: 50000, 24: 62000, 25: 75000, 26: 90000,
    27: 105000, 28: 120000, 29: 135000, 30: 155000,
  };
  const xpForCr = (cr) => (isBlank(cr) ? 0 : XP_BY_CR[String(cr)] ?? 0);
  /** Raw XP of the enemies, with no DMG group multiplier. */
  const encounterXp = (enc) =>
    enc.combatants.filter((c) => c.type === "enemy").reduce((sum, c) => sum + xpForCr(c.cr), 0);

  /* ---------- Normalisation (doubles as the migration layer) ---------- */

  const pickList = (list, allowed) =>
    [...new Set((Array.isArray(list) ? list : []).filter((x) => allowed.includes(x)))];
  const text = (v) => String(v ?? "");

  function normalizeAttack(a = {}) {
    return {
      name: String(a.name ?? "").trim() || "Attack",
      kind: a.kind === "save" ? "save" : "attack",
      ability: STAT_KEYS.includes(a.ability) ? a.ability : "str",
      toHit: toInt(a.toHit, 0),
      saveDc: Math.max(0, toInt(a.saveDc, 10)),
      saveAbility: STAT_KEYS.includes(a.saveAbility) ? a.saveAbility : "dex",
      halfOnSave: !!a.halfOnSave,
      dmgDice: String(a.dmgDice ?? "").trim(),
      dmgBonus: toInt(a.dmgBonus, 0),
      dmgType: String(a.dmgType ?? "").trim(),
      note: String(a.note ?? "").trim(),
      autoToHit: a.autoToHit !== false,
      autoDmg: a.autoDmg !== false,
      autoSaveDc: a.autoSaveDc !== false,
    };
  }

  /** v1 stored conditions as names; v2 stores { name, endsOnRound } (null = indefinite). */
  function normalizeConditions(list) {
    const byName = new Map();
    (Array.isArray(list) ? list : []).forEach((x) => {
      const name = typeof x === "string" ? x : x?.name;
      if (!CONDITIONS.includes(name)) return;
      const ends = typeof x === "object" && !isBlank(x.endsOnRound) ? toInt(x.endsOnRound, null) : null;
      byName.set(name, { name, endsOnRound: ends });
    });
    return CONDITIONS.filter((n) => byName.has(n)).map((n) => byName.get(n));
  }

  const LOG_CAP = 300;
  const LOG_KINDS = ["damage", "heal", "condition", "turn", "roll", "recharge", "death", "concentration", "info"];
  function normalizeLog(list) {
    return (Array.isArray(list) ? list : [])
      .filter((e) => e && typeof e === "object" && !isBlank(e.text))
      .slice(-LOG_CAP)
      .map((e) => ({
        id: e.id || uuid(),
        at: Number.isFinite(e.at) ? e.at : 0,
        round: Math.max(1, toInt(e.round, 1)),
        kind: LOG_KINDS.includes(e.kind) ? e.kind : "info",
        text: String(e.text),
      }));
  }

  function normalizeSpellSlot(s = {}) {
    const max = Math.max(0, toInt(s.max, 0));
    return {
      level: clamp(toInt(s.level, 1), 1, 9),
      max,
      current: clamp(toInt(s.current, 0), 0, max),
      recovery: s.recovery === "short" ? "short" : "long",
    };
  }

  /**
   * Fill in every field a stat block of this type should have.
   * Doubles as the migration path for data saved by earlier versions.
   */
  function normalizeTemplate(t = {}, type) {
    const stats = {};
    STAT_KEYS.forEach((k) => { stats[k] = clamp(toInt(t.stats?.[k], 10), 1, 30); });
    const skills = pickList(t.skills, SKILLS.map((s) => s.key));
    const block = {
      ...t,
      name: String(t.name ?? "").trim() || "Unnamed",
      hp: { max: Math.max(0, toInt(t.hp?.max, 0)) },
      ac: Math.max(0, toInt(t.ac, 10)),
      speed: String(t.speed ?? "").trim(),
      stats,
      initBonus: isBlank(t.initBonus) ? null : toInt(t.initBonus, null),
      saves: pickList(t.saves, STAT_KEYS),
      skills,
      expertise: pickList(t.expertise, skills),
      senses: text(t.senses).trim(),
      languages: text(t.languages).trim(),
      damageResistances: pickList(t.damageResistances, DAMAGE_TYPES),
      damageImmunities: pickList(t.damageImmunities, DAMAGE_TYPES),
      damageVulnerabilities: pickList(t.damageVulnerabilities, DAMAGE_TYPES),
      damageNotes: text(t.damageNotes).trim(),
      conditionImmunities: pickList(t.conditionImmunities, [...CONDITIONS, "Exhaustion"]),
      spellSlots: (Array.isArray(t.spellSlots) ? t.spellSlots : [])
        .filter((s) => s && typeof s === "object")
        .map(normalizeSpellSlot)
        .sort((a, b) => a.level - b.level),
    };
    if (type === "pc") {
      block.level = clamp(toInt(t.level, 1), 1, 20);
      block.cls = String(t.cls ?? "");
      block.race = String(t.race ?? "").trim();
    } else {
      block.cr = CR_OPTIONS.includes(String(t.cr)) ? String(t.cr) : "";
      block.creatureType = text(t.creatureType).trim();
      block.alignment = text(t.alignment).trim();
      block.attacks = (Array.isArray(t.attacks) ? t.attacks : []).filter((a) => a && typeof a === "object").map(normalizeAttack);
      block.recharges = (Array.isArray(t.recharges) ? t.recharges : []).filter((r) => r && typeof r === "object").map((r) => ({
        name: String(r.name ?? "").trim() || "Ability",
        min: clamp(toInt(r.min, 5), 2, 6),
      }));
      block.legendaryActions = clamp(toInt(t.legendaryActions, 0), 0, 9);
      block.legendaryResistance = clamp(toInt(t.legendaryResistance, 0), 0, 9);
      block.multiattack = text(t.multiattack).trim();
      block.traits = text(t.traits);
      block.actions = text(t.actions);
      block.reactions = text(t.reactions);
      block.legendaryText = text(t.legendaryText);
    }
    return block;
  }

  /** Fields that exist only on combatants, never on library templates. */
  const INSTANCE_ONLY = [
    "instanceId", "templateId", "initiative", "initRank", "conditions", "autoUnconscious", "exhaustion",
    "concentration", "concentrationCheck", "deathSaves", "legendaryActionsLeft", "legendaryResistanceLeft",
    "reactionUsed", "bonusActionUsed", "readied", "surprised", "notes",
  ];
  /** Strip encounter-only state so a combatant can be saved back as a template. */
  function templateFromInstance(c) {
    const t = clone(c);
    INSTANCE_ONLY.forEach((k) => delete t[k]);
    t.hp = { max: c.hp.max };
    (t.recharges || []).forEach((r) => { delete r.available; delete r.lastRoll; });
    return normalizeTemplate(t, c.type);
  }

  /** A combatant: a normalised stat block plus encounter-only state. */
  function normalizeInstance(c = {}) {
    if (c.type === "lair") {
      return {
        instanceId: c.instanceId || uuid(),
        templateId: null,
        type: "lair",
        name: String(c.name ?? "").trim() || "Lair Action",
        initiative: toInt(c.initiative, LAIR_INITIATIVE),
        initRank: Number.isFinite(c.initRank) ? c.initRank : 0,
        notes: String(c.notes ?? ""),
      };
    }
    const type = c.type === "pc" ? "pc" : "enemy";
    const base = normalizeTemplate(c, type);
    delete base.id;
    const max = base.hp.max;
    const check = c.concentrationCheck;
    const la = base.legendaryActions || 0;
    const lr = base.legendaryResistance || 0;
    return {
      ...base,
      instanceId: c.instanceId || uuid(),
      templateId: c.templateId ?? null,
      type,
      initiative: toInt(c.initiative, 0),
      initRank: Number.isFinite(c.initRank) ? c.initRank : 0,
      hp: {
        max,
        current: Math.max(0, toInt(c.hp?.current, max)),
        temp: Math.max(0, toInt(c.hp?.temp, 0)),
      },
      recharges: (base.recharges || []).map((r, i) => ({
        ...r,
        available: c.recharges?.[i]?.available !== false,
        lastRoll: toInt(c.recharges?.[i]?.lastRoll, 0) || null,
      })),
      conditions: normalizeConditions(c.conditions),
      autoUnconscious: !!c.autoUnconscious,
      exhaustion: clamp(toInt(c.exhaustion, 0), 0, 6),
      concentration: { active: !!c.concentration?.active, spell: String(c.concentration?.spell ?? "") },
      concentrationCheck: check && toInt(check.dc, 0) > 0
        ? { dc: toInt(check.dc, 10), count: Math.max(1, toInt(check.count, 1)) }
        : null,
      deathSaves: {
        success: clamp(toInt(c.deathSaves?.success, 0), 0, 3),
        fail: clamp(toInt(c.deathSaves?.fail, 0), 0, 3),
      },
      legendaryActionsLeft: clamp(toInt(c.legendaryActionsLeft, la), 0, la),
      legendaryResistanceLeft: clamp(toInt(c.legendaryResistanceLeft, lr), 0, lr),
      reactionUsed: !!c.reactionUsed,
      bonusActionUsed: !!c.bonusActionUsed,
      readied: !!c.readied,
      surprised: !!c.surprised,
      notes: text(c.notes),
    };
  }

  function normalizeEncounter(enc = {}) {
    return {
      ...enc,
      id: enc.id || uuid(),
      name: String(enc.name ?? "").trim() || "Encounter",
      round: Math.max(1, toInt(enc.round, 1)),
      currentTurnIndex: Math.max(0, toInt(enc.currentTurnIndex, 0)),
      combatants: (Array.isArray(enc.combatants) ? enc.combatants : [])
        .filter((c) => c && typeof c === "object")
        .map(normalizeInstance),
      clock: {
        elapsedMs: Math.max(0, Number(enc.clock?.elapsedMs) || 0),
        startedAt: Number.isFinite(enc.clock?.startedAt) ? enc.clock.startedAt : null,
      },
      log: normalizeLog(enc.log),
    };
  }

  const VIEWS = ["encounters", "active", "library"];
  const LIBRARY_SORTS = ["name", "cr", "level", "hp"];

  function normalizeUi(ui = {}) {
    const crOrBlank = (v) => (CR_OPTIONS.includes(String(v)) ? String(v) : "");
    return {
      ...ui,
      view: VIEWS.includes(ui.view) ? ui.view : "encounters",
      activeEncounterId: typeof ui.activeEncounterId === "string" ? ui.activeEncounterId : null,
      cardMode: ui.cardMode === "compact" ? "compact" : "full",
      arrowKeys: !!ui.arrowKeys,
      logOpen: !!ui.logOpen,
      diceOpen: !!ui.diceOpen,
      groupInitiative: ui.groupInitiative !== false,
      librarySearch: text(ui.librarySearch),
      libraryClass: CLASSES.includes(ui.libraryClass) ? ui.libraryClass : "",
      libraryCrMin: crOrBlank(ui.libraryCrMin),
      libraryCrMax: crOrBlank(ui.libraryCrMax),
      librarySort: LIBRARY_SORTS.includes(ui.librarySort) ? ui.librarySort : "name",
    };
  }
  const defaultState = () => ({
    creatureLibrary: { pcs: [], enemies: [] },
    encounters: [],
    ui: normalizeUi(),
  });

  /**
   * Turn any saved or imported payload (v1 or v2) into a clean v2 state.
   * Unknown fields are kept, missing ones are defaulted.
   */
  function migrateState(parsed) {
    const lib = (list, type) =>
      (Array.isArray(list) ? list : [])
        .filter((t) => t && typeof t === "object")
        .map((t) => ({ ...normalizeTemplate(t, type), id: t.id || uuid() }));
    const out = {
      creatureLibrary: {
        pcs: lib(parsed?.creatureLibrary?.pcs, "pc"),
        enemies: lib(parsed?.creatureLibrary?.enemies, "enemy"),
      },
      encounters: (Array.isArray(parsed?.encounters) ? parsed.encounters : [])
        .filter((e) => e && typeof e === "object")
        .map(normalizeEncounter),
      ui: normalizeUi(parsed?.ui || {}),
    };
    if (out.ui.activeEncounterId && !out.encounters.some((e) => e.id === out.ui.activeEncounterId)) {
      out.ui.activeEncounterId = null;
    }
    out.encounters.forEach(sortEncounter);
    return out;
  }

  /* ---------- Building combatants ---------- */

  /** Clone a template into a fresh combatant at full HP, full slots, everything recharged. */
  function instantiate(template, type, initiative, templateId = null) {
    const src = normalizeTemplate(clone(template), type);
    return normalizeInstance({
      ...src,
      instanceId: uuid(),
      templateId,
      type,
      initiative: toInt(initiative, 0),
      hp: { max: src.hp.max, current: src.hp.max, temp: 0 },
      spellSlots: src.spellSlots.map((s) => ({ ...s, current: s.max })),
    });
  }

  const makeLair = () => normalizeInstance({ type: "lair", initiative: LAIR_INITIATIVE });

  /**
   * Ensure duplicate names get numbered: Goblin, Goblin → Goblin 1, Goblin 2.
   * Returns the name to use for a new combatant and renames an existing
   * un-numbered twin in place if needed.
   */
  function uniqueName(enc, baseName) {
    const base = baseName.trim();
    const pattern = new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: (\\d+))?$`);
    const twins = enc.combatants.filter((c) => pattern.test(c.name));
    if (twins.length === 0) return base;

    let highest = 0;
    twins.forEach((c) => {
      const m = c.name.match(pattern);
      const n = m && m[1] ? toInt(m[1], 0) : 0;
      if (n === 0) { c.name = `${base} 1`; highest = Math.max(highest, 1); }
      else highest = Math.max(highest, n);
    });
    return `${base} ${highest + 1}`;
  }

  /* ---------- Turn order ---------- */

  /**
   * Sort by initiative desc. Ties: lair actions lose (MM p.11), then a Delay
   * rank if one was set, then higher initiative bonus, then higher DEX score,
   * then stable insertion order.
   * Keeps currentTurnIndex pointing at the same combatant it did before the sort.
   */
  function sortEncounter(enc) {
    // Before the first "Next Turn" (round 1, pointer at the top) the DM is still
    // setting up, so the pointer stays on whoever ends up first after sorting.
    const settingUp = enc.round === 1 && enc.currentTurnIndex === 0;
    const currentId = settingUp ? null : (enc.combatants[enc.currentTurnIndex]?.instanceId ?? null);
    const isLair = (c) => (c.type === "lair" ? 1 : 0);
    enc.combatants.sort((a, b) =>
      (b.initiative - a.initiative) ||
      (isLair(a) - isLair(b)) ||
      ((b.initRank || 0) - (a.initRank || 0)) ||
      (initBonusOf(b) - initBonusOf(a)) ||
      (toInt(b.stats?.dex, 10) - toInt(a.stats?.dex, 10)));
    if (currentId) {
      const idx = enc.combatants.findIndex((c) => c.instanceId === currentId);
      enc.currentTurnIndex = idx >= 0 ? idx : 0;
    }
    if (enc.combatants.length === 0) enc.currentTurnIndex = 0;
    else enc.currentTurnIndex = clamp(enc.currentTurnIndex, 0, enc.combatants.length - 1);
  }

  /** Roll a d6 for each spent recharge ability; a roll ≥ min recharges it (MM p.11). */
  function rollRecharges(c, rng = Math.random) {
    const events = [];
    (c?.recharges || []).forEach((r) => {
      if (r.available) return;
      const roll = rollDie(6, rng);
      r.lastRoll = roll;
      r.available = roll >= r.min;
      events.push({ kind: "recharge", text: `${c.name}: ${r.name} ${r.available ? "recharged" : "not recharged"} (rolled ${roll})` });
    });
    return events;
  }

  /**
   * Start of a creature's own turn: its reaction returns (PHB p.190), a
   * readied action lapses (PHB p.193), legendary actions refill (MM p.11),
   * and spent recharge abilities roll.
   */
  function startTurn(c, rng = Math.random) {
    if (!c || c.type === "lair") return [];
    c.reactionUsed = false;
    c.bonusActionUsed = false;
    c.readied = false;
    c.legendaryActionsLeft = c.legendaryActions || 0;
    return rollRecharges(c, rng);
  }

  /** Remove conditions whose last round has passed. */
  function expireConditions(enc) {
    const events = [];
    enc.combatants.forEach((c) => {
      if (c.type === "lair") return;
      const expired = c.conditions.filter((x) => x.endsOnRound !== null && enc.round > x.endsOnRound);
      expired.forEach((x) => events.push(...removeCondition(c, x.name, { reason: "ends" })));
    });
    return events;
  }

  const turnText = (enc) => {
    const c = enc.combatants[enc.currentTurnIndex];
    return c ? `Round ${enc.round}, ${c.name}'s turn` : `Round ${enc.round}`;
  };

  /** Returns { events, newRound }. */
  function nextTurn(enc, rng = Math.random) {
    const events = [];
    if (!enc.combatants.length) return { events, newRound: false };
    // Surprise lasts until the end of the creature's first turn (PHB p.189).
    const ending = enc.combatants[enc.currentTurnIndex];
    if (ending?.surprised && enc.round === 1) ending.surprised = false;
    enc.currentTurnIndex += 1;
    let newRound = false;
    if (enc.currentTurnIndex >= enc.combatants.length) {
      enc.currentTurnIndex = 0;
      enc.round += 1;
      newRound = true;
      enc.combatants.forEach((c) => { if (c.type !== "lair") c.surprised = false; });
      events.push(...expireConditions(enc));
    }
    events.unshift({ kind: "turn", text: turnText(enc) });
    events.push(...startTurn(enc.combatants[enc.currentTurnIndex], rng));
    return { events, newRound };
  }

  /** Steps the pointer back only. Undo is the way to reverse turn effects. */
  function prevTurn(enc) {
    if (!enc.combatants.length) return { newRound: false, events: [] };
    enc.currentTurnIndex -= 1;
    let newRound = false;
    if (enc.currentTurnIndex < 0) {
      enc.currentTurnIndex = enc.combatants.length - 1;
      if (enc.round > 1) { enc.round -= 1; newRound = true; }
    }
    return { newRound, events: [{ kind: "turn", text: `Back to ${turnText(enc)}` }] };
  }

  /**
   * Delay (a DM convenience; the 2014 core rules only have Ready): move the
   * current combatant to act right after a combatant later in this round.
   * Their initiative becomes the target's, ordered just below it.
   */
  function delayTurn(enc, targetId, rng = Math.random) {
    const idx = enc.currentTurnIndex;
    const cur = enc.combatants[idx];
    const tIdx = enc.combatants.findIndex((c) => c.instanceId === targetId);
    if (!cur || tIdx <= idx) return null;
    const target = enc.combatants[tIdx];
    const nextId = enc.combatants[idx + 1].instanceId;
    const group = enc.combatants.filter((c) => c !== cur && c.initiative === target.initiative);
    group.forEach((c, i) => { c.initRank = group.length - i; });
    cur.initiative = target.initiative;
    cur.initRank = target.initRank - 0.5;
    sortEncounter(enc);
    enc.currentTurnIndex = enc.combatants.findIndex((c) => c.instanceId === nextId);
    return [
      { kind: "turn", text: `${cur.name} delays until after ${target.name}.` },
      { kind: "turn", text: turnText(enc) },
      ...startTurn(enc.combatants[enc.currentTurnIndex], rng),
    ];
  }

  /* ---------- Initiative rolls ---------- */

  const groupKey = (c) => c.templateId || c.name.replace(/\s+\d+$/, "");

  function rollInitiativeFor(c, rng = Math.random) {
    const d20 = rollDie(20, rng);
    const bonus = initBonusOf(c);
    c.initiative = d20 + bonus;
    c.initRank = 0;
    return { d20, bonus, total: c.initiative };
  }

  /**
   * Roll for every enemy, leaving PCs (players roll their own) and lair
   * actions alone. Grouped: one roll per group of identical creatures (PHB p.189).
   */
  function rollInitiative(enc, { group = true, rng = Math.random } = {}) {
    const enemies = enc.combatants.filter((c) => c.type === "enemy");
    const groups = new Map();
    enemies.forEach((c) => {
      const k = group ? groupKey(c) : c.instanceId;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    });
    const events = [];
    groups.forEach((members) => {
      const r = rollInitiativeFor(members[0], rng);
      members.slice(1).forEach((m) => { m.initiative = r.total; m.initRank = 0; });
      const who = members.length > 1 ? `${members[0].name.replace(/\s+\d+$/, "")} ×${members.length}` : members[0].name;
      events.push({ kind: "roll", text: `Initiative ${who}: d20 (${r.d20}) ${formatMod(r.bonus)} = ${r.total}` });
    });
    sortEncounter(enc);
    return events;
  }

  /* ---------- Conditions ---------- */

  const hasCondition = (c, name) => (c.conditions || []).some((x) => x.name === name);
  const conditionNames = (c) => (c.conditions || []).map((x) => x.name);
  const isImmuneTo = (c, name) => (c.conditionImmunities || []).includes(name);
  /** Rounds left including the current one, or null when indefinite. */
  const roundsLeft = (cond, round) => (cond.endsOnRound === null ? null : cond.endsOnRound - round + 1);

  /** Concentration ends when the creature is incapacitated (PHB p.203). */
  function endConcentration(c, reason) {
    if (!c.concentration?.active) return [];
    c.concentration.active = false;
    c.concentrationCheck = null;
    return [{ kind: "concentration", text: `${c.name} ${reason} and loses concentration.` }];
  }

  /**
   * Returns { blocked, events }. A duration of N rounds lasts through round
   * (current + N − 1) and expires when the next round begins after that.
   */
  function addCondition(c, name, { rounds = null, round = 1 } = {}) {
    if (!CONDITIONS.includes(name) || hasCondition(c, name)) return { blocked: false, events: [] };
    if (isImmuneTo(c, name)) {
      return { blocked: true, events: [{ kind: "condition", text: `${c.name} is immune to ${name.toLowerCase()}.` }] };
    }
    const n = toInt(rounds, 0);
    const endsOnRound = n > 0 ? round + n - 1 : null;
    c.conditions = normalizeConditions([...c.conditions, { name, endsOnRound }]);
    const events = [{ kind: "condition", text: `${c.name} is ${name.toLowerCase()}${n > 0 ? ` for ${n} round${n === 1 ? "" : "s"}` : ""}.` }];
    if (INCAPACITATING.includes(name)) events.push(...endConcentration(c, `is ${name.toLowerCase()}`));
    return { blocked: false, events };
  }

  function removeCondition(c, name, { reason = "" } = {}) {
    if (!hasCondition(c, name)) return [];
    c.conditions = c.conditions.filter((x) => x.name !== name);
    if (name === "Unconscious") c.autoUnconscious = false;
    return [{ kind: "condition", text: reason === "ends" ? `${c.name}: ${name} ends.` : `${c.name} is no longer ${name.toLowerCase()}.` }];
  }

  function toggleCondition(c, name, opts) {
    if (hasCondition(c, name)) return { blocked: false, events: removeCondition(c, name) };
    return addCondition(c, name, opts);
  }

  /** Cumulative list of exhaustion effects at the given level. */
  const exhaustionEffects = (level) => EXHAUSTION_EFFECTS.slice(1, clamp(toInt(level, 0), 0, 6) + 1);

  /** Returns { blocked, events }. Long rest and DM edits go through here too. */
  function changeExhaustion(c, delta) {
    const before = c.exhaustion;
    if (delta > 0 && isImmuneTo(c, "Exhaustion")) {
      return { blocked: true, events: [{ kind: "condition", text: `${c.name} is immune to exhaustion.` }] };
    }
    c.exhaustion = clamp(before + toInt(delta, 0), 0, 6);
    const events = [];
    if (c.exhaustion !== before) {
      events.push({ kind: "condition", text: `${c.name}: exhaustion ${before} → ${c.exhaustion}${c.exhaustion === 6 ? ". Dead." : ""}` });
    }
    return { blocked: false, events };
  }

  /* ---------- Hit points ---------- */

  /** PHB p.197: three failures, or exhaustion level 6 (PHB p.291). Monsters at 0 HP are just Down. */
  const isDead = (c) =>
    c.type !== "lair" && (c.exhaustion >= 6 || (c.type === "pc" && c.deathSaves.fail >= 3));
  const isStable = (c) =>
    c.type === "pc" && c.hp.current <= 0 && !isDead(c) && c.deathSaves.success >= 3;

  /** PHB p.203: DC 10 or half the damage taken, whichever is higher. No upper cap. */
  const concentrationDc = (damage) => Math.max(10, Math.floor(Math.max(0, toInt(damage, 0)) / 2));

  /**
   * Apply damage (delta < 0) or healing (delta > 0).
   * Damage drains temp HP first, then HP, and floors at 0. Healing caps at max
   * and never becomes temp HP. For PCs this also applies the dying rules
   * (PHB p.197): massive damage, and failures for damage taken at 0 HP.
   */
  function adjustHp(c, delta, { crit = false } = {}) {
    const result = {
      absorbedByTemp: 0, hpLost: 0, overflow: 0, healed: 0,
      droppedToZero: false, instantDeath: false, failuresAdded: 0,
    };
    if (!c || c.type === "lair") return result;
    const max = Math.max(0, toInt(c.hp.max, 0));
    const cur = Math.max(0, toInt(c.hp.current, 0));
    const temp = Math.max(0, toInt(c.hp.temp, 0));
    const amount = Math.abs(toInt(delta, 0));

    if (delta > 0) {
      result.healed = Math.max(0, Math.min(max - cur, amount));
      c.hp.current = cur + result.healed;
      return result;
    }
    if (delta === 0) return result;

    result.absorbedByTemp = Math.min(temp, amount);
    c.hp.temp = temp - result.absorbedByTemp;
    const remaining = amount - result.absorbedByTemp;
    result.hpLost = Math.min(cur, remaining);
    result.overflow = remaining - result.hpLost;
    c.hp.current = cur - result.hpLost;
    result.droppedToZero = cur > 0 && c.hp.current === 0;

    if (c.type === "pc" && !isDead(c)) {
      const wasDown = cur === 0;
      if (result.droppedToZero && result.overflow >= max) {
        result.instantDeath = true;
      } else if (wasDown && remaining > 0) {
        if (remaining >= max) {
          result.instantDeath = true;
        } else {
          // A stable creature that takes damage starts dying again; becoming
          // stable reset both counters, so it starts from zero.
          if (c.deathSaves.success >= 3) c.deathSaves = { success: 0, fail: 0 };
          result.failuresAdded = crit ? 2 : 1;
          c.deathSaves.fail = Math.min(3, c.deathSaves.fail + result.failuresAdded);
        }
      }
      if (result.instantDeath) c.deathSaves.fail = 3;
    }
    return result;
  }

  /**
   * Side effects of HP changing. Above 0: death saves reset and an automatic
   * Unconscious is lifted. At 0: PCs fall unconscious; anyone concentrating stops.
   */
  function afterHpChange(c) {
    const events = [];
    if (!c || c.type === "lair") return events;
    if (c.hp.current > 0) {
      c.deathSaves = { success: 0, fail: 0 };
      if (c.autoUnconscious) {
        c.autoUnconscious = false;
        if (hasCondition(c, "Unconscious")) {
          c.conditions = c.conditions.filter((x) => x.name !== "Unconscious");
          events.push({ kind: "condition", text: `${c.name} regains consciousness.` });
        }
      }
      return events;
    }
    events.push(...endConcentration(c, "drops to 0 HP"));
    // Falling unconscious at 0 HP is part of the dying rules, so it ignores condition immunity.
    if (c.type === "pc" && !hasCondition(c, "Unconscious")) {
      c.conditions = normalizeConditions([...c.conditions, { name: "Unconscious", endsOnRound: null }]);
      c.autoUnconscious = true;
      events.push({ kind: "condition", text: `${c.name} falls unconscious.` });
    }
    return events;
  }

  /** Temp HP doesn't stack (PHB p.198): keep the higher value. */
  function grantTempHp(c, amount) {
    const previous = Math.max(0, toInt(c.hp.temp, 0));
    const value = Math.max(0, toInt(amount, 0));
    const applied = value > previous;
    if (applied) c.hp.temp = value;
    return { applied, previous, value };
  }

  /**
   * PHB p.197: immunity → 0; resistance halves (round down); vulnerability
   * doubles. Resistance applies before vulnerability, and several instances
   * of the same one count once. Returns { amount, defense, note }.
   */
  function damageAfterDefenses(amount, type, c) {
    const raw = Math.max(0, toInt(amount, 0));
    if (!type || !DAMAGE_TYPES.includes(type)) return { amount: raw, defense: null, note: "" };
    if ((c.damageImmunities || []).includes(type)) {
      return { amount: 0, defense: "immune", note: `${raw} ${type}, immune: 0` };
    }
    const resistant = (c.damageResistances || []).includes(type);
    const vulnerable = (c.damageVulnerabilities || []).includes(type);
    let out = raw;
    if (resistant) out = Math.floor(out / 2);
    if (vulnerable) out *= 2;
    const defense = resistant && vulnerable ? "resistant and vulnerable" : resistant ? "resistant" : vulnerable ? "vulnerable" : null;
    return { amount: out, defense, note: defense ? `${raw} ${type}, ${defense}: ${out}` : `${raw} ${type}` };
  }

  /**
   * Damage the way the DM enters it (PHB order): type modifiers, then temp
   * HP, then HP, then the dying rules, then concentration.
   * Returns { raw, amount, note, result, events }.
   */
  function applyDamage(c, amount, { crit = false, type = "" } = {}) {
    const raw = Math.max(0, toInt(amount, 0));
    const def = damageAfterDefenses(raw, type, c);
    const dmg = def.amount;
    const wasConcentrating = !!c.concentration?.active;
    const result = adjustHp(c, -dmg, { crit });
    const events = [];
    if (result.instantDeath) {
      events.push({ kind: "death", text: `${c.name} dies outright from massive damage.` });
    } else if (result.failuresAdded) {
      const f = c.deathSaves.fail;
      events.push({
        kind: "death",
        text: `${c.name} takes damage at 0 HP: ${result.failuresAdded === 2 ? "two death save failures (critical hit)" : "one death save failure"}${f >= 3 ? ". Dead." : ` (${f}/3).`}`,
      });
    }
    events.push(...afterHpChange(c));
    if (wasConcentrating && c.concentration.active && dmg > 0) {
      const dc = concentrationDc(dmg);
      c.concentrationCheck = { dc, count: (c.concentrationCheck?.count || 0) + 1 };
      events.push({ kind: "concentration", text: `${c.name}: concentration save, DC ${dc}.` });
    }
    return { raw, amount: dmg, note: def.note, defense: def.defense, result, events };
  }

  function applyHealing(c, amount) {
    const result = adjustHp(c, Math.max(0, toInt(amount, 0)));
    return { result, events: afterHpChange(c) };
  }

  /* ---------- Rests ---------- */

  /**
   * Mutates the encounter and returns [{ name, changes: [text] }] for every
   * combatant that changed. Run it on a clone to preview.
   * Long rest (PHB p.186): needs at least 1 HP at the start; restores HP and
   * spell slots, ends temp HP (PHB p.198), reduces exhaustion by 1 (PHB p.291).
   * Legendary resistance is per day. Recharge abilities and death saves are
   * reset as a DM convenience.
   * Short rest: Warlock-style slots and recharge abilities only. Hit Dice
   * spending is not tracked.
   */
  function applyRest(enc, kind) {
    const out = [];
    enc.combatants.forEach((c) => {
      if (c.type === "lair") return;
      const changes = [];
      const spentRecharges = c.recharges.filter((r) => !r.available);
      if (kind === "long") {
        if (c.hp.current <= 0) {
          out.push({ name: c.name, changes: ["no benefit: a long rest needs at least 1 HP"] });
          return;
        }
        if (c.hp.current < c.hp.max) changes.push(`HP ${c.hp.current} → ${c.hp.max}`);
        if (c.hp.temp) changes.push(`temp HP ${c.hp.temp} → 0`);
        c.hp.current = c.hp.max;
        c.hp.temp = 0;
        const slots = c.spellSlots.filter((s) => s.current < s.max);
        if (slots.length) changes.push(`spell slots restored (${slots.map((s) => `${s.level}`).join(", ")})`);
        c.spellSlots.forEach((s) => { s.current = s.max; });
        if (c.deathSaves.success || c.deathSaves.fail) changes.push("death saves reset");
        c.deathSaves = { success: 0, fail: 0 };
        if (c.legendaryResistanceLeft < (c.legendaryResistance || 0)) changes.push("legendary resistance restored");
        c.legendaryResistanceLeft = c.legendaryResistance || 0;
        if (c.exhaustion > 0) {
          changes.push(`exhaustion ${c.exhaustion} → ${c.exhaustion - 1}`);
          c.exhaustion -= 1;
        }
      } else {
        const slots = c.spellSlots.filter((s) => s.recovery === "short" && s.current < s.max);
        if (slots.length) changes.push(`short-rest slots restored (${slots.map((s) => `${s.level}`).join(", ")})`);
        slots.forEach((s) => { s.current = s.max; });
      }
      if (spentRecharges.length) changes.push(`recharged: ${spentRecharges.map((r) => r.name).join(", ")}`);
      c.recharges.forEach((r) => { r.available = true; });
      c.legendaryActionsLeft = c.legendaryActions || 0;
      c.reactionUsed = false;
      c.bonusActionUsed = false;
      c.concentrationCheck = null;
      if (changes.length) out.push({ name: c.name, changes });
    });
    return out;
  }

  /* ---------- Dice ---------- */

  /**
   * A tiny safe parser for "2d6+3", "d20-1", "1d8 + 1d6 + 2", "d%". No eval.
   * Returns [{ sign, count, sides }] with sides 0 for a flat number, or throws.
   */
  function parseDice(expr) {
    const s = String(expr ?? "").toLowerCase().trim().replace(/\s*([+-])\s*/g, "$1").replace(/d%/g, "d100");
    if (!s || s.length > 80) throw new Error("Enter a roll like 2d6+3.");
    if (/\s/.test(s)) throw new Error(`Can't read "${expr}".`);
    const terms = [];
    const re = /([+-]?)(\d*)d(\d+)|([+-]?)(\d+)/y;
    let pos = 0;
    while (pos < s.length) {
      re.lastIndex = pos;
      const m = re.exec(s);
      if (!m || (pos > 0 && !m[1] && !m[4])) throw new Error(`Can't read "${expr}".`);
      if (m[3] !== undefined) {
        const count = m[2] === "" ? 1 : toInt(m[2], 0);
        const sides = toInt(m[3], 0);
        if (count < 1 || count > 100 || sides < 1 || sides > 1000) throw new Error("Dice must be 1–100 dice of 1–1000 sides.");
        terms.push({ sign: m[1] === "-" ? -1 : 1, count, sides });
      } else {
        const n = toInt(m[5], 0);
        if (n > 100000) throw new Error("That number is too large.");
        terms.push({ sign: m[4] === "-" ? -1 : 1, count: n, sides: 0 });
      }
      pos = re.lastIndex;
    }
    return terms;
  }

  /**
   * mode "adv" / "dis" applies only when the roll has a single d20 (PHB p.173).
   * Returns { expr, total, text, natural } (natural = the kept d20, if any).
   */
  function rollDice(expr, { mode = "normal", rng = Math.random } = {}) {
    const terms = parseDice(expr);
    const d20Terms = terms.filter((t) => t.sides === 20);
    const advApplies = mode !== "normal" && d20Terms.length === 1 && d20Terms[0].count === 1;
    let total = 0;
    let natural = null;
    const parts = terms.map((t, i) => {
      const sign = t.sign < 0 ? "−" : i ? "+" : "";
      if (!t.sides) { total += t.sign * t.count; return `${sign}${i ? " " : ""}${t.count}`; }
      let rolls = Array.from({ length: t.count }, () => rollDie(t.sides, rng));
      let label = `${t.count}d${t.sides}`;
      if (t.sides === 20 && advApplies) {
        const pair = [rolls[0], rollDie(20, rng)];
        const kept = mode === "adv" ? Math.max(...pair) : Math.min(...pair);
        label += mode === "adv" ? " (adv)" : " (dis)";
        rolls = [kept];
        natural = kept;
        total += t.sign * kept;
        return `${sign}${i ? " " : ""}${label} [${pair.join(", ")} → ${kept}]`;
      }
      if (t.sides === 20 && t.count === 1) natural = rolls[0];
      const sum = rolls.reduce((a, b) => a + b, 0);
      total += t.sign * sum;
      return `${sign}${i ? " " : ""}${label} [${rolls.join(", ")}]`;
    });
    const ignored = mode !== "normal" && !advApplies ? " (advantage needs a single d20)" : "";
    return { expr: String(expr).trim(), total, natural, text: `${parts.join(" ")} = ${total}${ignored}` };
  }

  /** "1d6+2" from an attack's dice and bonus, or "" when it has neither. */
  function attackDamageExpr(atk) {
    const bonus = toInt(atk.dmgBonus, 0);
    if (!atk.dmgDice) return bonus ? String(bonus) : "";
    return `${atk.dmgDice}${bonus > 0 ? `+${bonus}` : bonus < 0 ? `${bonus}` : ""}`;
  }

  /* ---------- Combat log ---------- */

  function pushLog(enc, kind, text, at = Date.now()) {
    if (!enc.log) enc.log = [];
    enc.log.push({ id: uuid(), at, round: enc.round, kind: LOG_KINDS.includes(kind) ? kind : "info", text: String(text) });
    if (enc.log.length > LOG_CAP) enc.log.splice(0, enc.log.length - LOG_CAP);
  }

  /* ---------- Export / import ---------- */

  const SCHEMA_VERSION = 2;

  /** The downloadable backup. UI preferences stay out of it. */
  const exportPayload = (state, now = Date.now()) => ({
    app: "dm-dashboard",
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date(now).toISOString(),
    creatureLibrary: clone(state.creatureLibrary),
    encounters: clone(state.encounters),
  });

  /**
   * Validate an import before anything touches the live state.
   * Accepts v2 exports and raw v1/v2 saves. Returns
   * { ok: true, data: { creatureLibrary, encounters }, counts } or { ok: false, error }.
   */
  function parseImport(textOrObject) {
    let obj = textOrObject;
    if (typeof obj === "string") {
      try { obj = JSON.parse(obj); } catch { return { ok: false, error: "That file isn't valid JSON." }; }
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { ok: false, error: "That file isn't a DM Dashboard export." };
    const version = obj.schemaVersion === undefined ? 1 : obj.schemaVersion;
    if (!Number.isInteger(version) || version < 1) return { ok: false, error: "The file's schemaVersion is not valid." };
    if (version > SCHEMA_VERSION) return { ok: false, error: `This file is from a newer version (schema ${version}). Update the app first.` };
    const lib = obj.creatureLibrary;
    if (lib === undefined && obj.encounters === undefined) return { ok: false, error: "The file has no library and no encounters." };
    if (lib !== undefined && (typeof lib !== "object" || lib === null || Array.isArray(lib))) return { ok: false, error: "creatureLibrary must be an object." };
    for (const key of ["pcs", "enemies"]) {
      if (lib?.[key] !== undefined && !Array.isArray(lib[key])) return { ok: false, error: `creatureLibrary.${key} must be a list.` };
    }
    if (obj.encounters !== undefined && !Array.isArray(obj.encounters)) return { ok: false, error: "encounters must be a list." };
    const bad = [...(lib?.pcs || []), ...(lib?.enemies || []), ...(obj.encounters || [])].some((x) => !x || typeof x !== "object" || Array.isArray(x));
    if (bad) return { ok: false, error: "Some entries in the file are not objects." };
    const migrated = migrateState({ creatureLibrary: lib || {}, encounters: obj.encounters || [] });
    const data = { creatureLibrary: migrated.creatureLibrary, encounters: migrated.encounters };
    return {
      ok: true,
      version,
      data,
      counts: { encounters: data.encounters.length, pcs: data.creatureLibrary.pcs.length, enemies: data.creatureLibrary.enemies.length },
    };
  }

  /** Merge keeps everything that exists; incoming items whose id is taken get a fresh id. */
  function mergeImport(state, data) {
    const ids = new Set([...state.creatureLibrary.pcs, ...state.creatureLibrary.enemies].map((t) => t.id));
    const fresh = (t) => (ids.has(t.id) ? { ...t, id: uuid() } : t);
    data.creatureLibrary.pcs.forEach((t) => { const n = fresh(t); ids.add(n.id); state.creatureLibrary.pcs.push(n); });
    data.creatureLibrary.enemies.forEach((t) => { const n = fresh(t); ids.add(n.id); state.creatureLibrary.enemies.push(n); });
    const encIds = new Set(state.encounters.map((e) => e.id));
    data.encounters.forEach((e) => state.encounters.push(encIds.has(e.id) ? { ...e, id: uuid() } : e));
    return state;
  }

  /* ---------- Encounters ---------- */

  /** A fresh copy for a rerun: same combatants and initiative, everything else reset. */
  function duplicateEncounter(enc, name = `${enc.name} (copy)`) {
    const copy = normalizeEncounter({ name, combatants: [], round: 1, currentTurnIndex: 0 });
    copy.combatants = enc.combatants.map((c) => {
      if (c.type === "lair") return normalizeInstance({ ...clone(c), instanceId: uuid() });
      const t = templateFromInstance(c);
      const inst = instantiate(t, c.type, c.initiative, c.templateId);
      inst.name = c.name;
      inst.initRank = c.initRank || 0;
      inst.notes = c.notes;
      return inst;
    });
    sortEncounter(copy);
    copy.currentTurnIndex = 0;
    return copy;
  }

  /* ---------- Library ---------- */

  /**
   * Search, filter and sort a library list. Options: { search, cls, crMin,
   * crMax, sort } where sort is "name" | "cr" | "level" | "hp".
   */
  function filterLibrary(list, type, { search = "", cls = "", crMin = "", crMax = "", sort = "name" } = {}) {
    const q = String(search).trim().toLowerCase();
    const lo = isBlank(crMin) ? -Infinity : parseCr(crMin);
    const hi = isBlank(crMax) ? Infinity : parseCr(crMax);
    const out = list.filter((t) => {
      if (q && ![t.name, t.cls, t.race, t.creatureType].some((v) => String(v || "").toLowerCase().includes(q))) return false;
      if (type === "pc" && cls && t.cls !== cls) return false;
      if (type === "enemy" && (lo > -Infinity || hi < Infinity)) {
        if (isBlank(t.cr)) return false;
        const cr = parseCr(t.cr);
        if (cr < lo || cr > hi) return false;
      }
      return true;
    });
    const byName = (a, b) => a.name.localeCompare(b.name);
    const key = {
      cr: (t) => (isBlank(t.cr) ? -1 : parseCr(t.cr)),
      level: (t) => toInt(t.level, 0),
      hp: (t) => toInt(t.hp?.max, 0),
    }[sort];
    return out.sort(key ? (a, b) => (key(b) - key(a)) || byName(a, b) : byName);
  }

  /* ---------- Player view ---------- */

  /** Enemy health as players see it: no numbers. */
  function healthBand(c) {
    if (isDead(c) || c.hp.current <= 0) return "Down";
    const max = Math.max(1, c.hp.max);
    if (c.hp.current >= max) return "Unharmed";
    if (c.hp.current <= max / 4) return "Critical";
    if (c.hp.current <= max / 2) return "Bloodied";
    return "Hurt";
  }

  /**
   * Everything the player window is allowed to know, built field by field so
   * nothing hidden (enemy AC or exact HP, stats, notes, attacks, lair text)
   * can leak through a spread.
   */
  function playerProjection(state) {
    const enc = state?.encounters?.find((e) => e.id === state.ui?.activeEncounterId);
    if (!enc) return null;
    return {
      round: enc.round,
      currentIndex: enc.combatants.length ? clamp(enc.currentTurnIndex, 0, enc.combatants.length - 1) : -1,
      combatants: enc.combatants.map((c) => {
        if (c.type === "lair") return { type: "lair", name: "Lair action" };
        const base = {
          type: c.type,
          name: c.name,
          conditions: c.conditions.map((x) => ({ name: x.name, roundsLeft: roundsLeft(x, enc.round) })),
          exhaustion: c.exhaustion,
        };
        if (c.type === "pc") {
          const status = isDead(c) ? "Dead" : c.hp.current > 0 ? null : isStable(c) ? "Stable" : "Dying";
          return { ...base, hp: { current: c.hp.current, max: c.hp.max, temp: c.hp.temp }, status };
        }
        return { ...base, band: healthBand(c) };
      }),
    };
  }

  /* ---------- Difficulty ---------- */

  /**
   * Lazy Encounter Benchmark (Sly Flourish), a rough heuristic and not the
   * DMG XP budget: a fight may be deadly when total enemy CR exceeds ¼ of total
   * PC levels (½ once PCs average 5th level+). A single monster may be deadly
   * when its CR exceeds ½ the average PC level (the full level at 5th+).
   */
  function encounterDifficulty(enc) {
    const pcs = enc.combatants.filter((c) => c.type === "pc");
    const enemies = enc.combatants.filter((c) => c.type === "enemy");
    if (!pcs.length || !enemies.length) return null;

    const totalLevels = pcs.reduce((sum, c) => sum + toInt(c.level, 1), 0);
    const avgLevel = totalLevels / pcs.length;
    const highTier = avgLevel >= 5;
    const benchmark = totalLevels * (highTier ? 0.5 : 0.25);
    const totalCr = enemies.reduce((sum, c) => sum + parseCr(c.cr), 0);
    const singleCap = highTier ? avgLevel : avgLevel / 2;
    const bigMonsters = enemies.filter((c) => parseCr(c.cr) > singleCap);
    // Group by template (or by name minus its number for one-offs) so a pack of
    // identical monsters counts as one type.
    const typeKey = (c) => c.templateId || c.name.replace(/\s+\d+$/, "");
    const bigTypes = [...new Set(bigMonsters.map(typeKey))];
    const dominant = bigTypes.length === 1 ? bigMonsters.find((c) => typeKey(c) === bigTypes[0]) : null;
    const ratio = benchmark > 0 ? totalCr / benchmark : Infinity;
    const tier = ratio > 1 ? "over" : ratio > 0.75 ? "approaching" : "under";
    return { totalCr, benchmark, totalLevels, avgLevel, singleCap, bigMonsters, dominant, tier };
  }

  return {
    STAT_KEYS, STAT_NAMES, SKILLS, SKILL_BY_KEY, CONDITIONS, CONDITION_EFFECTS, EXHAUSTION_EFFECTS,
    INCAPACITATING, CLASSES, CR_OPTIONS, DAMAGE_TYPES, LAIR_INITIATIVE, XP_BY_CR, LOG_CAP, LOG_KINDS,
    uuid, toInt, clamp, clone, isBlank, modifier, formatMod, formatNum, parseCr, profFromCr, profFromLevel,
    profOf, rechargeLabel, rollDie, initBonusOf, skillBonus, saveBonus, passivePerception, autoSaveDc,
    xpForCr, encounterXp,
    normalizeAttack, normalizeSpellSlot, normalizeConditions, normalizeLog, normalizeTemplate,
    normalizeInstance, normalizeEncounter, normalizeUi, defaultState, migrateState, templateFromInstance,
    instantiate, makeLair, uniqueName,
    sortEncounter, rollRecharges, startTurn, expireConditions, nextTurn, prevTurn, delayTurn,
    groupKey, rollInitiativeFor, rollInitiative,
    hasCondition, conditionNames, isImmuneTo, roundsLeft, addCondition, removeCondition, toggleCondition,
    endConcentration, exhaustionEffects, changeExhaustion,
    isDead, isStable, concentrationDc, adjustHp, afterHpChange, grantTempHp, damageAfterDefenses,
    applyDamage, applyHealing, applyRest,
    parseDice, rollDice, attackDamageExpr, pushLog,
    SCHEMA_VERSION, exportPayload, parseImport, mergeImport, duplicateEncounter, filterLibrary,
    healthBand, playerProjection,
    encounterDifficulty,
  };
});

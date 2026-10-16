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

  const skillBonus = (c, key) => {
    const skill = SKILL_BY_KEY[key];
    return skill ? modifier(c.stats?.[skill.ability]) + profFromCr(c.cr) : 0;
  };

  /* ---------- Normalisation (doubles as the migration layer) ---------- */

  function normalizeAttack(a = {}) {
    return {
      name: String(a.name ?? "").trim() || "Attack",
      ability: STAT_KEYS.includes(a.ability) ? a.ability : "str",
      toHit: toInt(a.toHit, 0),
      dmgDice: String(a.dmgDice ?? "").trim(),
      dmgBonus: toInt(a.dmgBonus, 0),
      dmgType: String(a.dmgType ?? "").trim(),
      autoToHit: a.autoToHit !== false,
      autoDmg: a.autoDmg !== false,
    };
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
    const block = {
      ...t,
      name: String(t.name ?? "").trim() || "Unnamed",
      hp: { max: Math.max(0, toInt(t.hp?.max, 0)) },
      ac: Math.max(0, toInt(t.ac, 10)),
      speed: String(t.speed ?? "").trim(),
      stats,
      initBonus: isBlank(t.initBonus) ? null : toInt(t.initBonus, null),
      spellSlots: (Array.isArray(t.spellSlots) ? t.spellSlots : [])
        .map(normalizeSpellSlot)
        .sort((a, b) => a.level - b.level),
    };
    if (type === "pc") {
      block.level = clamp(toInt(t.level, 1), 1, 20);
      block.cls = String(t.cls ?? "");
      block.race = String(t.race ?? "").trim();
    } else {
      block.cr = CR_OPTIONS.includes(String(t.cr)) ? String(t.cr) : "";
      block.skills = (Array.isArray(t.skills) ? t.skills : []).filter((k) => SKILL_BY_KEY[k]);
      block.attacks = (Array.isArray(t.attacks) ? t.attacks : []).map(normalizeAttack);
      block.recharges = (Array.isArray(t.recharges) ? t.recharges : []).map((r) => ({
        name: String(r.name ?? "").trim() || "Ability",
        min: clamp(toInt(r.min, 5), 2, 6),
      }));
    }
    return block;
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
        notes: String(c.notes ?? ""),
      };
    }
    const type = c.type === "pc" ? "pc" : "enemy";
    const base = normalizeTemplate(c, type);
    delete base.id;
    const max = base.hp.max;
    const check = c.concentrationCheck;
    return {
      ...base,
      instanceId: c.instanceId || uuid(),
      templateId: c.templateId ?? null,
      type,
      initiative: toInt(c.initiative, 0),
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
      conditions: (Array.isArray(c.conditions) ? c.conditions : []).filter((x) => CONDITIONS.includes(x)),
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
    };
  }

  const VIEWS = ["encounters", "active", "library"];

  function normalizeUi(ui = {}) {
    return {
      ...ui,
      view: VIEWS.includes(ui.view) ? ui.view : "encounters",
      activeEncounterId: typeof ui.activeEncounterId === "string" ? ui.activeEncounterId : null,
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
   * Sort by initiative desc. Ties: lair actions lose (MM p.11), then higher
   * initiative bonus, then higher DEX score, then stable insertion order.
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

  /** Returns { events, newRound }. */
  function nextTurn(enc, rng = Math.random) {
    const events = [];
    if (!enc.combatants.length) return { events, newRound: false };
    enc.currentTurnIndex += 1;
    let newRound = false;
    if (enc.currentTurnIndex >= enc.combatants.length) {
      enc.currentTurnIndex = 0;
      enc.round += 1;
      newRound = true;
    }
    events.push(...rollRecharges(enc.combatants[enc.currentTurnIndex], rng));
    return { events, newRound };
  }

  function prevTurn(enc) {
    if (!enc.combatants.length) return { newRound: false };
    enc.currentTurnIndex -= 1;
    let newRound = false;
    if (enc.currentTurnIndex < 0) {
      enc.currentTurnIndex = enc.combatants.length - 1;
      if (enc.round > 1) { enc.round -= 1; newRound = true; }
    }
    return { newRound };
  }

  /* ---------- Conditions ---------- */

  const hasCondition = (c, name) => (c.conditions || []).includes(name);

  /** Concentration ends when the creature is incapacitated (PHB p.203). */
  function endConcentration(c, reason) {
    if (!c.concentration?.active) return [];
    c.concentration.active = false;
    c.concentrationCheck = null;
    return [{ kind: "concentration", text: `${c.name} ${reason} and loses concentration.` }];
  }

  function addCondition(c, name) {
    if (!CONDITIONS.includes(name) || hasCondition(c, name)) return [];
    c.conditions = CONDITIONS.filter((x) => x === name || c.conditions.includes(x));
    const events = [{ kind: "condition", text: `${c.name} is ${name.toLowerCase()}.` }];
    if (INCAPACITATING.includes(name)) events.push(...endConcentration(c, `is ${name.toLowerCase()}`));
    return events;
  }

  function removeCondition(c, name) {
    if (!hasCondition(c, name)) return [];
    c.conditions = c.conditions.filter((x) => x !== name);
    if (name === "Unconscious") c.autoUnconscious = false;
    return [{ kind: "condition", text: `${c.name} is no longer ${name.toLowerCase()}.` }];
  }

  const toggleCondition = (c, name) => (hasCondition(c, name) ? removeCondition(c, name) : addCondition(c, name));

  /** Cumulative list of exhaustion effects at the given level. */
  const exhaustionEffects = (level) => EXHAUSTION_EFFECTS.slice(1, clamp(toInt(level, 0), 0, 6) + 1);

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
          c.conditions = c.conditions.filter((x) => x !== "Unconscious");
          events.push({ kind: "condition", text: `${c.name} regains consciousness.` });
        }
      }
      return events;
    }
    events.push(...endConcentration(c, "drops to 0 HP"));
    if (c.type === "pc" && !hasCondition(c, "Unconscious")) {
      c.conditions = CONDITIONS.filter((x) => x === "Unconscious" || c.conditions.includes(x));
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
   * Damage the way the DM enters it: HP rules, then dying, then concentration.
   * Returns { result, events }.
   */
  function applyDamage(c, amount, { crit = false } = {}) {
    const dmg = Math.max(0, toInt(amount, 0));
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
    return { result, events };
  }

  function applyHealing(c, amount) {
    const result = adjustHp(c, Math.max(0, toInt(amount, 0)));
    return { result, events: afterHpChange(c) };
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
    INCAPACITATING, CLASSES, CR_OPTIONS, DAMAGE_TYPES, LAIR_INITIATIVE,
    uuid, toInt, clamp, clone, isBlank, modifier, formatMod, formatNum, parseCr, profFromCr,
    rechargeLabel, rollDie, initBonusOf, skillBonus,
    normalizeAttack, normalizeSpellSlot, normalizeTemplate, normalizeInstance, normalizeEncounter,
    normalizeUi, defaultState, migrateState,
    instantiate, makeLair, uniqueName,
    sortEncounter, rollRecharges, nextTurn, prevTurn,
    hasCondition, addCondition, removeCondition, toggleCondition, endConcentration, exhaustionEffects,
    isDead, isStable, concentrationDc, adjustHp, afterHpChange, grantTempHp, applyDamage, applyHealing,
    encounterDifficulty,
  };
});

/* ==========================================================================
   DM Dashboard — Application Logic
   Sections:
     1. Constants & utilities
     2. State & storage (incl. normalisation / migration)
     3. Domain helpers (sorting, cloning, naming, HP, clock, difficulty)
     4. Rendering
     5. Dialogs (creature builder, detail, picker, prompt, confirm, toast)
     6. Event wiring
     7. Boot
   ========================================================================== */

(() => {
  "use strict";

  /* ======================================================================
     1. Constants & utilities
     ====================================================================== */

  const STORAGE_KEY = "dm-dashboard-state-v1";
  const STAT_KEYS = ["str", "dex", "con", "int", "wis", "cha"];
  const STAT_NAMES = {
    str: "Strength", dex: "Dexterity", con: "Constitution",
    int: "Intelligence", wis: "Wisdom", cha: "Charisma",
  };
  const LEVEL_LABEL = { 1: "1st", 2: "2nd", 3: "3rd" };

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

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const svg = (body, size = 15) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const ICON_TRASH = svg(`<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/>`);
  const ICON_EDIT = svg(`<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>`);
  const ICON_EXPAND = svg(`<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>`);
  const ICON_PLAY = svg(`<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>`, 14);
  const ICON_PAUSE = svg(`<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" stroke="none"/>`, 14);
  const ICON_RESET = svg(`<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>`, 14);

  const uuid = () =>
    (crypto.randomUUID ? crypto.randomUUID() :
      "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      }));

  const escapeHtml = (str) =>
    String(str ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  const toInt = (value, fallback = 0) => {
    const n = parseInt(value, 10);
    return Number.isFinite(n) ? n : fallback;
  };

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const clone = (obj) => JSON.parse(JSON.stringify(obj));

  const modifier = (score) => Math.floor((toInt(score, 10) - 10) / 2);
  const formatMod = (m) => (m >= 0 ? `+${m}` : `−${Math.abs(m)}`);
  const ordinal = (n) => LEVEL_LABEL[n] || `${n}th`;

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
  /** Proficiency bonus by CR: +2 at CR 0–4, +3 at 5–8, … +9 at 29–30. */
  const profFromCr = (cr) => 2 + Math.floor((Math.max(parseCr(cr), 1) - 1) / 4);
  const formatNum = (n) => String(+n.toFixed(2));

  const skillBonus = (c, key) => {
    const skill = SKILL_BY_KEY[key];
    return skill ? modifier(c.stats?.[skill.ability]) + profFromCr(c.cr) : 0;
  };
  const initBonusOf = (c) =>
    (c.type === "pc" ? toInt(c.initBonus, modifier(c.stats?.dex)) : modifier(c.stats?.dex));
  const rechargeLabel = (min) => (min >= 6 ? "6" : `${min}–6`);
  const rollD6 = () => 1 + Math.floor(Math.random() * 6);

  /** "1d6+2 slashing" */
  function damageText(atk) {
    const bonus = toInt(atk.dmgBonus, 0);
    const signed = bonus > 0 ? `+${bonus}` : bonus < 0 ? `−${Math.abs(bonus)}` : "";
    const roll = atk.dmgDice ? `${atk.dmgDice}${signed}` : (bonus ? String(bonus) : "");
    return [roll, atk.dmgType].filter(Boolean).join(" ");
  }

  /* ======================================================================
     2. State & storage
     ====================================================================== */

  const defaultState = () => ({
    creatureLibrary: { pcs: [], enemies: [] },
    encounters: [],
    ui: { view: "encounters", activeEncounterId: null },
  });

  let state = defaultState();

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

  /**
   * Fill in every field a stat block of this type should have.
   * Doubles as the migration path for data saved by earlier versions.
   */
  function normalizeTemplate(t, type) {
    const stats = {};
    STAT_KEYS.forEach((k) => { stats[k] = clamp(toInt(t.stats?.[k], 10), 1, 30); });
    const block = {
      ...t,
      name: String(t.name ?? "").trim() || "Unnamed",
      hp: { max: Math.max(0, toInt(t.hp?.max, 0)) },
      ac: Math.max(0, toInt(t.ac, 10)),
      speed: String(t.speed ?? "").trim(),
      stats,
      spellSlots: (Array.isArray(t.spellSlots) ? t.spellSlots : [])
        .map((s) => {
          const max = Math.max(0, toInt(s.max, 0));
          return { level: clamp(toInt(s.level, 1), 1, 9), max, current: clamp(toInt(s.current, 0), 0, max) };
        })
        .sort((a, b) => a.level - b.level),
    };
    if (type === "pc") {
      block.level = clamp(toInt(t.level, 1), 1, 20);
      block.initBonus = toInt(t.initBonus, modifier(stats.dex));
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
  function normalizeInstance(c) {
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
      exhaustion: clamp(toInt(c.exhaustion, 0), 0, 6),
      concentration: { active: !!c.concentration?.active, spell: String(c.concentration?.spell ?? "") },
      deathSaves: {
        success: clamp(toInt(c.deathSaves?.success, 0), 0, 3),
        fail: clamp(toInt(c.deathSaves?.fail, 0), 0, 3),
      },
    };
  }

  function normalizeEncounter(enc) {
    return {
      ...enc,
      id: enc.id || uuid(),
      name: String(enc.name ?? "").trim() || "Encounter",
      round: Math.max(1, toInt(enc.round, 1)),
      currentTurnIndex: Math.max(0, toInt(enc.currentTurnIndex, 0)),
      combatants: (Array.isArray(enc.combatants) ? enc.combatants : []).map(normalizeInstance),
      clock: {
        elapsedMs: Math.max(0, Number(enc.clock?.elapsedMs) || 0),
        startedAt: Number.isFinite(enc.clock?.startedAt) ? enc.clock.startedAt : null,
      },
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      const base = defaultState();
      const lib = (list, type) =>
        (Array.isArray(list) ? list : []).map((t) => ({ ...normalizeTemplate(t, type), id: t.id || uuid() }));
      return {
        creatureLibrary: {
          pcs: lib(parsed?.creatureLibrary?.pcs, "pc"),
          enemies: lib(parsed?.creatureLibrary?.enemies, "enemy"),
        },
        encounters: (Array.isArray(parsed?.encounters) ? parsed.encounters : []).map(normalizeEncounter),
        ui: { ...base.ui, ...(parsed?.ui || {}) },
      };
    } catch (err) {
      console.warn("Could not read saved state, starting fresh.", err);
      return defaultState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.error("Could not persist state.", err);
      toast("Could not save to localStorage.");
    }
  }

  /** Persist, then repaint. Every mutation funnels through here. */
  function commit() {
    saveState();
    renderAll();
  }

  const libraryList = (type) => (type === "pc" ? state.creatureLibrary.pcs : state.creatureLibrary.enemies);
  const findTemplate = (id) =>
    state.creatureLibrary.pcs.find((t) => t.id === id) ||
    state.creatureLibrary.enemies.find((t) => t.id === id) || null;
  const templateType = (id) => (state.creatureLibrary.pcs.some((t) => t.id === id) ? "pc" : "enemy");
  const findEncounter = (id) => state.encounters.find((e) => e.id === id) || null;
  const activeEncounter = () => findEncounter(state.ui.activeEncounterId);

  /* ======================================================================
     3. Domain helpers
     ====================================================================== */

  /** Build a normalised stat block from raw builder values. */
  function buildStatBlock(values, type) {
    const stats = {};
    STAT_KEYS.forEach((k) => { stats[k] = values[k]; });
    const shared = {
      name: values.name,
      hp: { max: values.hpMax },
      ac: values.ac,
      speed: values.speed,
      stats,
      spellSlots: values.spellSlots,
    };
    const specific = type === "pc" ? {
      level: values.level,
      // Blank init bonus falls back to the DEX modifier.
      initBonus: values.initBonus === "" ? undefined : values.initBonus,
      cls: values.cls,
      race: values.race,
    } : {
      cr: values.cr,
      skills: values.skills,
      attacks: (values.attacks || []).filter((a) => String(a.name).trim()),
      recharges: (values.recharges || []).filter((r) => String(r.name).trim()),
    };
    return normalizeTemplate({ ...shared, ...specific }, type);
  }

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
   * Sort by initiative desc. Ties: lair actions lose, then higher initiative
   * bonus, then higher DEX score, then stable insertion order.
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

  function addCombatantsFromTemplate(enc, templateId, initiative, count) {
    const template = findTemplate(templateId);
    if (!template) return 0;
    const type = templateType(templateId);
    const n = clamp(toInt(count, 1), 1, 20);
    for (let i = 0; i < n; i++) {
      const inst = instantiate(template, type, initiative, templateId);
      inst.name = uniqueName(enc, template.name);
      enc.combatants.push(inst);
    }
    sortEncounter(enc);
    return n;
  }

  /**
   * Damage drains temp HP first and floors at 0. Healing caps at max HP;
   * adding HP to a creature already at max adds it as temp HP instead.
   */
  function adjustHp(combatant, delta) {
    const max = Math.max(0, toInt(combatant.hp.max, 0));
    const cur = Math.max(0, toInt(combatant.hp.current, 0));
    const temp = Math.max(0, toInt(combatant.hp.temp, 0));
    if (delta < 0) {
      const absorbed = Math.min(temp, -delta);
      combatant.hp.temp = temp - absorbed;
      combatant.hp.current = Math.max(0, cur + delta + absorbed);
    } else if (cur >= max) {
      combatant.hp.temp = temp + delta;
    } else {
      combatant.hp.current = Math.min(max, cur + delta);
    }
  }

  /** Side effects of HP changing: death saves reset on recovery, 0 HP breaks concentration. */
  function afterHpChange(c) {
    if (c.type === "lair") return;
    if (c.hp.current > 0) {
      c.deathSaves = { success: 0, fail: 0 };
    } else if (c.concentration.active) {
      c.concentration.active = false;
      toast(`${c.name} drops to 0 HP and loses concentration.`);
    }
  }

  /** Roll a d6 for each spent recharge ability; a roll ≥ min recharges it. */
  function rollRecharges(c) {
    (c?.recharges || []).forEach((r) => {
      if (r.available) return;
      const roll = rollD6();
      r.lastRoll = roll;
      r.available = roll >= r.min;
      toast(`${c.name}: ${r.name} ${r.available ? "recharged" : "not recharged"} (rolled ${roll})`);
    });
  }

  /* ---------- Encounter clock ---------- */
  const clockElapsed = (enc) =>
    enc.clock.elapsedMs + (enc.clock.startedAt ? Date.now() - enc.clock.startedAt : 0);
  const clockRunning = (enc) => !!enc.clock.startedAt;

  function startClock(enc) { if (!enc.clock.startedAt) enc.clock.startedAt = Date.now(); }
  function pauseClock(enc) {
    if (!enc.clock.startedAt) return;
    enc.clock.elapsedMs = clockElapsed(enc);
    enc.clock.startedAt = null;
  }
  function resetClock(enc) { enc.clock = { elapsedMs: 0, startedAt: null }; }

  function formatClock(ms) {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  /* ---------- Turn order ---------- */
  function nextTurn(enc) {
    if (!enc.combatants.length) return;
    // The first Next Turn of a fresh encounter starts the clock.
    if (!clockRunning(enc) && enc.clock.elapsedMs === 0) startClock(enc);
    enc.currentTurnIndex += 1;
    if (enc.currentTurnIndex >= enc.combatants.length) {
      enc.currentTurnIndex = 0;
      enc.round += 1;
      roundBump = true;
    }
    rollRecharges(enc.combatants[enc.currentTurnIndex]);
  }

  function prevTurn(enc) {
    if (!enc.combatants.length) return;
    enc.currentTurnIndex -= 1;
    if (enc.currentTurnIndex < 0) {
      enc.currentTurnIndex = enc.combatants.length - 1;
      if (enc.round > 1) { enc.round -= 1; roundBump = true; }
    }
  }

  let roundBump = false;

  /**
   * Lazy Encounter Benchmark (Sly Flourish): a fight may be deadly when the
   * total enemy CR exceeds ¼ of total PC levels (½ once PCs are 5th level+).
   * A single monster may be deadly when its CR exceeds ½ the PC level
   * (the full PC level at 5th+).
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
    const ratio = benchmark > 0 ? totalCr / benchmark : Infinity;
    const tier = ratio > 1 ? "deadly" : ratio > 0.75 ? "approaching" : "under";
    return { totalCr, benchmark, totalLevels, avgLevel, singleCap, bigMonsters, tier };
  }

  /* ======================================================================
     4. Rendering
     ====================================================================== */

  function renderAll() {
    renderTabs();
    renderEncounterList();
    renderActiveEncounter();
    renderLibrary();
    renderDetail();
  }

  function renderTabs() {
    $$(".tab").forEach((tab) => tab.classList.toggle("is-active", tab.dataset.view === state.ui.view));
    $$(".view").forEach((view) => view.classList.toggle("is-active", view.dataset.view === state.ui.view));
  }

  /* ---------- Encounter list ---------- */
  function renderEncounterList() {
    const host = $("#encounter-list");
    if (!state.encounters.length) {
      host.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <div class="empty-ornament" aria-hidden="true">✦</div>
          <h2 class="empty-title">No encounters yet</h2>
          <p>Every great battle begins with a name.</p>
        </div>`;
      return;
    }
    host.innerHTML = state.encounters.map((enc) => {
      const isOpen = enc.id === state.ui.activeEncounterId;
      const pcs = enc.combatants.filter((c) => c.type === "pc").length;
      const enemies = enc.combatants.filter((c) => c.type === "enemy").length;
      return `
        <article class="encounter-card ${isOpen ? "is-open" : ""}" data-encounter-id="${enc.id}">
          ${isOpen ? `<span class="badge-open">Open</span>` : ""}
          <h3 class="encounter-card-title">${escapeHtml(enc.name)}</h3>
          <div class="encounter-meta">
            <span>Round <strong>${enc.round}</strong></span>
            <span><strong>${pcs}</strong> PC${pcs === 1 ? "" : "s"}</span>
            <span><strong>${enemies}</strong> ${enemies === 1 ? "enemy" : "enemies"}</span>
            <span><strong>${formatClock(clockElapsed(enc))}</strong></span>
          </div>
          <div class="encounter-actions">
            <button class="btn btn-primary btn-sm" type="button" data-action="open-encounter">
              ${isOpen ? "Resume" : "Open"}
            </button>
            <button class="btn btn-ghost btn-sm" type="button" data-action="rename-encounter">Rename</button>
            <span class="spacer"></span>
            <button class="icon-btn icon-btn--danger" type="button" data-action="delete-encounter" title="Delete encounter" aria-label="Delete encounter">${ICON_TRASH}</button>
          </div>
        </article>`;
    }).join("");
  }

  /* ---------- Active encounter ---------- */
  function renderActiveEncounter() {
    const enc = activeEncounter();
    $("#active-empty").classList.toggle("hidden", !!enc);
    $("#active-content").classList.toggle("hidden", !enc);
    if (!enc) return;

    $("#active-name").textContent = enc.name;
    renderClock();
    renderDifficulty(enc);

    const roundEl = $("#round-number");
    roundEl.textContent = enc.round;
    if (roundBump) {
      roundBump = false;
      roundEl.classList.remove("bump");
      void roundEl.offsetWidth; // restart animation
      roundEl.classList.add("bump");
    }

    const hasCombatants = enc.combatants.length > 0;
    $("#btn-next-turn").disabled = !hasCombatants;
    $("#btn-prev-turn").disabled = !hasCombatants;

    const count = enc.combatants.length;
    $("#tracker-count").textContent = count ? `${count} in initiative order` : "";

    const banner = $("#turn-banner");
    if (hasCombatants) {
      const cur = enc.combatants[enc.currentTurnIndex];
      const next = enc.combatants[(enc.currentTurnIndex + 1) % enc.combatants.length];
      banner.classList.toggle("is-pc", cur.type === "pc");
      banner.innerHTML = `
        <span>Now acting:</span>
        <strong>${escapeHtml(cur.name)}</strong>
        <span class="turn-tag">Up next · ${escapeHtml(next.name)}</span>`;
    } else {
      banner.innerHTML = "";
    }

    const grid = $("#combatant-cards");
    if (!hasCombatants) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <div class="empty-ornament" aria-hidden="true">⚔</div>
          <h2 class="empty-title">The field is empty</h2>
          <p>Add player characters and enemies to begin rolling initiative.</p>
        </div>`;
      return;
    }
    grid.innerHTML = enc.combatants.map((c, i) => renderCard(c, i === enc.currentTurnIndex)).join("");
  }

  /** Runs every second; touches only the clock so nothing else re-renders. */
  function renderClock() {
    const enc = activeEncounter();
    if (!enc) return;
    const running = clockRunning(enc);
    $("#clock-time").textContent = formatClock(clockElapsed(enc));
    $("#clock").classList.toggle("is-running", running);
    const toggle = $("#btn-clock-toggle");
    if (toggle.dataset.state !== String(running)) {
      toggle.dataset.state = String(running);
      toggle.innerHTML = running ? ICON_PAUSE : ICON_PLAY;
      toggle.title = running ? "Pause clock" : "Start clock";
      toggle.setAttribute("aria-label", toggle.title);
    }
  }

  function renderDifficulty(enc) {
    const el = $("#difficulty");
    const d = encounterDifficulty(enc);
    el.classList.toggle("hidden", !d);
    if (!d) return;
    const label = { under: "Under benchmark", approaching: "Approaching", deadly: "Potentially deadly" }[d.tier];
    el.className = `difficulty difficulty--${d.tier}`;
    el.innerHTML = `
      <span class="difficulty-label">Difficulty</span>
      <span>CR <b>${formatNum(d.totalCr)}</b> / ${formatNum(d.benchmark)}</span>
      <span class="difficulty-tier">${label}</span>
      ${d.bigMonsters.length ? `<span class="difficulty-warn">⚠ ${d.bigMonsters.map((c) => escapeHtml(c.name)).join(", ")}</span>` : ""}`;
    el.title =
      `Lazy Encounter Benchmark: total enemy CR ${formatNum(d.totalCr)} vs. benchmark ${formatNum(d.benchmark)} ` +
      `(${d.avgLevel >= 5 ? "½" : "¼"} of ${d.totalLevels} total PC levels).` +
      (d.bigMonsters.length ? `\nSingle monsters above CR ${formatNum(d.singleCap)} may be deadly on their own.` : "");
  }

  /* ---------- Card fragments (shared with the detail modal) ---------- */
  function subtitleFor(c) {
    if (c.type === "lair") return "Lair · loses ties";
    if (c.type === "pc") return ["PC", `Lvl ${c.level}`, c.cls, c.race].filter(Boolean).join(" · ");
    return ["Enemy", c.cr ? `CR ${c.cr}` : ""].filter(Boolean).join(" · ");
  }

  function statusChipsHtml(c) {
    const chips = [];
    if (c.concentration?.active) {
      chips.push(`<span class="chip chip--conc" title="Concentrating">◉ ${escapeHtml(c.concentration.spell || "Concentrating")}</span>`);
    }
    (c.conditions || []).forEach((cond) => chips.push(`<span class="chip chip--cond">${cond}</span>`));
    if (c.exhaustion) chips.push(`<span class="chip chip--exh">Exhaustion ${c.exhaustion}</span>`);
    return chips.length ? `<div class="card-status">${chips.join("")}</div>` : "";
  }

  function deathSavesHtml(c) {
    const ds = c.deathSaves;
    const pips = (kind) => [0, 1, 2].map((i) => `
      <button class="pip pip--${kind} ${i < ds[kind] ? "is-full" : ""}" type="button"
              data-action="death-save" data-kind="${kind}" data-index="${i}"
              aria-label="Death save ${kind} ${i + 1}"></button>`).join("");
    const status = ds.fail >= 3 ? `<span class="ds-status ds-status--dead">Dead</span>`
      : ds.success >= 3 ? `<span class="ds-status ds-status--stable">Stable</span>` : "";
    return `
      <div class="death-saves">
        <span class="ds-label">Death Saves</span>
        <span class="ds-group" title="Successes"><span class="ds-kind ds-kind--success">✓</span>${pips("success")}</span>
        <span class="ds-group" title="Failures"><span class="ds-kind ds-kind--fail">✗</span>${pips("fail")}</span>
        ${status}
      </div>`;
  }

  function spellBlockHtml(c) {
    if (!c.spellSlots?.length) return "";
    return `
      <div class="spell-block">
        <div class="spell-block-title">Spell Slots</div>
        <div class="spell-rows-card">
          ${c.spellSlots.map((s, idx) => `
            <div class="spell-row-card">
              <span class="spell-level">${ordinal(s.level)}</span>
              <div class="spell-pips">
                ${Array.from({ length: s.max }, (_, p) => `
                  <button class="pip ${p < s.current ? "is-full" : ""}" type="button"
                          data-action="toggle-pip" data-slot-index="${idx}" data-pip-index="${p}"
                          title="${p < s.current ? "Expend slot" : "Restore slot"}"
                          aria-label="${ordinal(s.level)} level slot ${p + 1}"></button>`).join("")}
              </div>
              <span class="spell-count">${s.current}/${s.max}</span>
            </div>`).join("")}
        </div>
      </div>`;
  }

  const attackHtml = (atk) => `
    <div class="attack">
      <span class="attack-name">${escapeHtml(atk.name)}</span>
      <span class="attack-hit" title="To hit">${formatMod(atk.toHit)}</span>
      <span class="attack-dmg">${escapeHtml(damageText(atk))}</span>
    </div>`;

  const skillsText = (c) =>
    (c.skills || []).map((k) => `${SKILL_BY_KEY[k].name} ${formatMod(skillBonus(c, k))}`).join(" · ");

  function rechargeChipsHtml(c) {
    if (!c.recharges?.length) return "";
    return `
      <div class="card-recharges">
        ${c.recharges.map((r, i) => `
          <button class="chip chip--recharge ${r.available ? "is-ready" : "is-spent"}" type="button"
                  data-action="toggle-recharge" data-recharge-index="${i}"
                  title="${r.available ? "Ready. Click to mark used." : `Spent. Recharges on ${rechargeLabel(r.min)}. Click to restore.`}">
            ${escapeHtml(r.name)} <small>${rechargeLabel(r.min)}</small>
          </button>`).join("")}
      </div>`;
  }

  function cardHeadHtml(c, extraTools = "") {
    return `
      <header class="card-head">
        <label class="card-initiative" title="Initiative">
          <span class="card-initiative-label">Init</span>
          <input type="number" value="${toInt(c.initiative, 0)}" data-field="initiative" aria-label="Initiative">
        </label>
        <div class="card-title-wrap">
          <h3 class="card-name" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</h3>
          <span class="card-type">${escapeHtml(subtitleFor(c))}</span>
          ${c.type !== "lair" && c.hp.current <= 0 ? `<span class="card-down-tag">Down</span>` : ""}
        </div>
        <div class="card-tools">
          <button class="icon-btn" type="button" data-action="open-detail" title="Open details" aria-label="Open details">${ICON_EXPAND}</button>
          ${extraTools}
          <button class="icon-btn icon-btn--danger" type="button" data-action="remove-instance" title="Remove from encounter" aria-label="Remove from encounter">×</button>
        </div>
      </header>`;
  }

  function renderCard(c, isCurrent) {
    if (c.type === "lair") {
      return `
        <article class="card card--lair ${isCurrent ? "is-current" : ""}" data-instance-id="${c.instanceId}">
          ${cardHeadHtml(c)}
          <p class="lair-notes ${c.notes ? "" : "is-empty"}">${c.notes ? escapeHtml(c.notes) : "Click to add lair action notes."}</p>
        </article>`;
    }

    const max = Math.max(0, toInt(c.hp.max, 0));
    const cur = Math.max(0, toInt(c.hp.current, 0));
    const temp = Math.max(0, toInt(c.hp.temp, 0));
    const pct = max > 0 ? clamp((cur / max) * 100, 0, 100) : 0;
    const barClass = pct <= 25 ? "is-critical" : pct <= 50 ? "is-wounded" : "";
    const scale = Math.max(max, cur + temp, 1);
    const isDown = cur <= 0;
    const isPc = c.type === "pc";

    const statsHtml = STAT_KEYS.map((k) => {
      const score = toInt(c.stats?.[k], 10);
      const m = modifier(score);
      const cls = m > 0 ? "is-pos" : m < 0 ? "is-neg" : "";
      return `
        <div class="stat" title="${STAT_NAMES[k]} ${score}">
          <span class="stat-label">${k.toUpperCase()}</span>
          <span class="stat-mod ${cls}">${formatMod(m)}</span>
        </div>`;
    }).join("");

    const info = [];
    if (c.speed) info.push(`<span><b>Speed</b> ${escapeHtml(c.speed)}</span>`);
    if (isPc) info.push(`<span><b>Init</b> ${formatMod(initBonusOf(c))}</span>`);
    const skills = isPc ? "" : skillsText(c);

    return `
      <article class="card card--${c.type} ${isCurrent ? "is-current" : ""} ${isDown ? "is-down" : ""}"
               data-instance-id="${c.instanceId}">
        ${cardHeadHtml(c, `<button class="icon-btn" type="button" data-action="edit-instance" title="Edit stat block" aria-label="Edit">${ICON_EDIT}</button>`)}

        ${statusChipsHtml(c)}
        ${isPc && isDown ? deathSavesHtml(c) : ""}

        <div class="card-vitals">
          <div class="ac-shield" title="Armor Class">
            <span class="ac-label">AC</span>
            <span class="ac-value">${toInt(c.ac, 10)}</span>
          </div>
          <div class="stats-row">${statsHtml}</div>
        </div>

        ${info.length ? `<div class="card-info">${info.join("")}</div>` : ""}
        ${skills ? `<div class="card-skills">${escapeHtml(skills)}</div>` : ""}
        ${c.attacks?.length ? `<div class="card-attacks">${c.attacks.map(attackHtml).join("")}</div>` : ""}
        ${rechargeChipsHtml(c)}

        <div class="hp-block">
          <div class="hp-top">
            <span class="hp-label">Hit Points</span>
            <label class="hp-temp ${temp ? "has-temp" : ""}" title="Temporary hit points">
              <span>Temp</span>
              <input type="number" min="0" value="${temp || ""}" placeholder="0" data-field="hpTemp" aria-label="Temporary HP">
            </label>
            <div class="hp-values">
              <input class="hp-cur" type="number" min="0" value="${cur}" data-field="hpCurrent" aria-label="Current HP">
              <span class="hp-sep">/</span>
              <input class="hp-max" type="number" min="0" value="${max}" data-field="hpMax" aria-label="Max HP">
            </div>
          </div>
          <div class="hp-bar">
            <div class="hp-bar-fill ${barClass}" style="width:${(cur / scale) * 100}%"></div>
            ${temp ? `<div class="hp-bar-temp" style="width:${(temp / scale) * 100}%"></div>` : ""}
          </div>
          <div class="hp-adjust">
            <button class="hp-adj-btn hp-adj-btn--dmg" type="button" data-action="damage" title="Apply damage (1 if blank)">−</button>
            <input type="number" min="0" placeholder="1" data-field="hpDelta" aria-label="Damage or healing amount">
            <button class="hp-adj-btn hp-adj-btn--heal" type="button" data-action="heal" title="Apply healing (1 if blank)">+</button>
          </div>
        </div>

        ${spellBlockHtml(c)}
      </article>`;
  }

  /* ---------- Library ---------- */
  function renderLibrary() {
    renderLibraryList("pc", $("#library-pcs"), "No player characters saved yet.");
    renderLibraryList("enemy", $("#library-enemies"), "No enemies saved yet. Every dungeon needs a few.");
  }

  function renderLibraryList(type, host, emptyText) {
    const list = libraryList(type);
    if (!list.length) {
      host.innerHTML = `<div class="empty-inline">${emptyText}</div>`;
      return;
    }
    host.innerHTML = list.map((t) => {
      const lead = type === "pc"
        ? `<span><b>Lvl ${t.level}</b>${t.cls ? ` ${escapeHtml(t.cls)}` : ""}${t.race ? ` · ${escapeHtml(t.race)}` : ""}</span>`
        : (t.cr ? `<span>CR <b>${t.cr}</b></span>` : "");
      return `
        <div class="lib-row lib-row--${type}" data-template-id="${t.id}">
          <div>
            <div class="lib-name">${escapeHtml(t.name)}</div>
            <div class="lib-meta">
              ${lead}
              <span>HP <b>${toInt(t.hp?.max, 0)}</b></span>
              <span>AC <b>${toInt(t.ac, 10)}</b></span>
              <span>${STAT_KEYS.map((k) => `${k.toUpperCase()} ${formatMod(modifier(t.stats?.[k]))}`).join(" · ")}</span>
              ${t.attacks?.length ? `<span>⚔ <b>${t.attacks.length}</b></span>` : ""}
              ${t.spellSlots?.length ? `<span>✦ <b>${t.spellSlots.length}</b> spell level${t.spellSlots.length === 1 ? "" : "s"}</span>` : ""}
            </div>
          </div>
          <div class="lib-actions">
            <button class="icon-btn" type="button" data-action="edit-template" title="Edit" aria-label="Edit">${ICON_EDIT}</button>
            <button class="icon-btn icon-btn--danger" type="button" data-action="delete-template" title="Delete" aria-label="Delete">${ICON_TRASH}</button>
          </div>
        </div>`;
    }).join("");
  }

  /* ======================================================================
     5. Dialogs
     ====================================================================== */

  /** Shared: close on backdrop click; buttons with [data-close] close too. */
  function wireDialogChrome(dialog) {
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) dialog.close("cancel");
    });
    $$("[data-close]", dialog).forEach((btn) =>
      btn.addEventListener("click", () => dialog.close("cancel")));
  }

  /* ---------- Toast ---------- */
  function toast(message) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = message;
    $("#toast-stack").appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  /* ---------- Prompt (text) ---------- */
  const promptModal = $("#prompt-modal");
  let promptResolve = null;
  let promptResult = null;

  function promptDialog({ title, label = "Name", value = "", okLabel = "OK" }) {
    return new Promise((resolve) => {
      promptResolve = resolve;
      $("#prompt-title").textContent = title;
      $("#prompt-label").textContent = label;
      $("#prompt-submit").textContent = okLabel;
      const input = $("#prompt-input");
      input.value = value;
      promptResult = null;
      promptModal.returnValue = "cancel";
      promptModal.showModal();
      requestAnimationFrame(() => { input.focus(); input.select(); });
    });
  }

  $("#prompt-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("#prompt-input").value.trim();
    if (!v) { $("#prompt-input").focus(); return; }
    promptResult = v;
    promptModal.close("ok");
  });
  promptModal.addEventListener("close", () => {
    const r = promptResolve; promptResolve = null;
    if (r) r(promptModal.returnValue === "ok" ? promptResult : null);
  });
  wireDialogChrome(promptModal);

  /* ---------- Confirm ---------- */
  const confirmModal = $("#confirm-modal");
  let confirmResolve = null;

  function confirmDialog({ title, html, okLabel = "Delete" }) {
    return new Promise((resolve) => {
      confirmResolve = resolve;
      $("#confirm-title").textContent = title;
      $("#confirm-text").innerHTML = html;
      $("#confirm-submit").textContent = okLabel;
      confirmModal.returnValue = "cancel";
      confirmModal.showModal();
      requestAnimationFrame(() => $("#confirm-submit").focus());
    });
  }

  $("#confirm-form").addEventListener("submit", (e) => {
    e.preventDefault();
    confirmModal.close("ok");
  });
  confirmModal.addEventListener("close", () => {
    const r = confirmResolve; confirmResolve = null;
    if (r) r(confirmModal.returnValue === "ok");
  });
  wireDialogChrome(confirmModal);

  /* ---------- Creature builder modal ---------- */
  const creatureModal = $("#creature-modal");
  const creatureForm = $("#creature-form");
  /** @type {{mode:string, type:string, templateId?:string, instanceId?:string}|null} */
  let creatureCtx = null;

  const abilityOptions = (selected) =>
    STAT_KEYS.map((k) => `<option value="${k}" ${k === selected ? "selected" : ""}>${k.toUpperCase()}</option>`).join("");

  function spellRowHtml(slot = { level: 1, current: 0, max: 0 }) {
    return `
      <div class="spell-row" data-row>
        <label class="field"><span class="field-label">Level</span>
          <input type="number" min="1" max="9" data-spell="level" value="${toInt(slot.level, 1)}"></label>
        <label class="field"><span class="field-label">Current</span>
          <input type="number" min="0" data-spell="current" value="${toInt(slot.current, 0)}"></label>
        <label class="field"><span class="field-label">Max</span>
          <input type="number" min="0" data-spell="max" value="${toInt(slot.max, 0)}"></label>
        <button class="icon-btn icon-btn--danger" type="button" data-action="remove-row" title="Remove level" aria-label="Remove level">×</button>
      </div>`;
  }

  function attackRowHtml(atk = normalizeAttack({ name: "" })) {
    return `
      <div class="attack-row" data-row data-auto-hit="${atk.autoToHit ? 1 : 0}" data-auto-dmg="${atk.autoDmg ? 1 : 0}">
        <label class="field"><span class="field-label">Attack</span>
          <input type="text" data-atk="name" value="${escapeHtml(atk.name === "Attack" ? "" : atk.name)}" placeholder="Scimitar" autocomplete="off"></label>
        <label class="field"><span class="field-label">Ability</span>
          <select data-atk="ability">${abilityOptions(atk.ability)}</select></label>
        <label class="field"><span class="field-label">To Hit</span>
          <input type="number" data-atk="toHit" value="${atk.toHit}" title="Auto: ability mod + proficiency. Type to override; clear to re-enable auto."></label>
        <label class="field"><span class="field-label">Dice</span>
          <input type="text" data-atk="dmgDice" value="${escapeHtml(atk.dmgDice)}" placeholder="1d6" autocomplete="off"></label>
        <label class="field"><span class="field-label">Bonus</span>
          <input type="number" data-atk="dmgBonus" value="${atk.dmgBonus}" title="Auto: ability mod. Type to override; clear to re-enable auto."></label>
        <label class="field"><span class="field-label">Type</span>
          <input type="text" data-atk="dmgType" value="${escapeHtml(atk.dmgType)}" list="damage-types" placeholder="slashing" autocomplete="off"></label>
        <button class="icon-btn icon-btn--danger" type="button" data-action="remove-row" title="Remove attack" aria-label="Remove attack">×</button>
      </div>`;
  }

  function rechargeRowHtml(r = { name: "", min: 5 }) {
    return `
      <div class="recharge-row" data-row>
        <label class="field"><span class="field-label">Ability</span>
          <input type="text" data-recharge="name" value="${escapeHtml(r.name)}" placeholder="Fire Breath" autocomplete="off"></label>
        <label class="field"><span class="field-label">Recharge</span>
          <select data-recharge="min">
            ${[6, 5, 4, 3, 2].map((n) => `<option value="${n}" ${n === r.min ? "selected" : ""}>${rechargeLabel(n)}</option>`).join("")}
          </select></label>
        <button class="icon-btn icon-btn--danger" type="button" data-action="remove-row" title="Remove ability" aria-label="Remove ability">×</button>
      </div>`;
  }

  /** Live-recalculate everything derived from ability scores and CR. */
  function refreshFormCalcs() {
    const f = creatureForm.elements;
    const prof = profFromCr(f.cr.value);
    const mods = {};
    STAT_KEYS.forEach((k) => {
      mods[k] = modifier(f[k].value);
      const el = $(`[data-mod-for="${k}"]`, creatureForm);
      el.textContent = formatMod(mods[k]);
      el.className = `stat-input-mod ${mods[k] > 0 ? "is-pos" : mods[k] < 0 ? "is-neg" : ""}`;
    });
    f.initBonus.placeholder = formatMod(mods.dex).replace("−", "-");
    $("#skills-prof-hint").textContent = `proficiency ${formatMod(prof)}`;
    $$("[data-skill-bonus]", creatureForm).forEach((el) => {
      el.textContent = formatMod(mods[SKILL_BY_KEY[el.dataset.skillBonus].ability] + prof);
    });
    $$(".attack-row", creatureForm).forEach((row) => {
      const m = mods[$('[data-atk="ability"]', row).value] ?? 0;
      const hit = $('[data-atk="toHit"]', row);
      const dmg = $('[data-atk="dmgBonus"]', row);
      if (row.dataset.autoHit === "1") hit.value = m + prof;
      if (row.dataset.autoDmg === "1") dmg.value = m;
      hit.classList.toggle("is-auto", row.dataset.autoHit === "1");
      dmg.classList.toggle("is-auto", row.dataset.autoDmg === "1");
    });
  }

  function fillCreatureForm(data, type) {
    const f = creatureForm.elements;
    const block = normalizeTemplate(data, type);
    f.name.value = data.name ?? "";
    f.hpMax.value = block.hp.max;
    f.ac.value = block.ac;
    f.speed.value = block.speed;
    f.initiative.value = toInt(data.initiative, 0);
    STAT_KEYS.forEach((k) => { f[k].value = block.stats[k]; });

    f.level.value = block.level ?? 1;
    f.initBonus.value = data.initBonus ?? "";
    f.cls.value = block.cls ?? "";
    f.race.value = block.race ?? "";

    f.cr.value = block.cr ?? "";
    $$("[data-skill]", creatureForm).forEach((cb) => { cb.checked = (block.skills || []).includes(cb.dataset.skill); });
    $("#attack-rows").innerHTML = (block.attacks || []).map(attackRowHtml).join("");
    $("#recharge-rows").innerHTML = (block.recharges || []).map(rechargeRowHtml).join("");
    $("#skills-details").open = (block.skills || []).length > 0;
    $("#attacks-details").open = (block.attacks || []).length > 0;
    $("#recharge-details").open = (block.recharges || []).length > 0;

    $("#spell-rows").innerHTML = block.spellSlots.map(spellRowHtml).join("");
    $("#spell-details").open = block.spellSlots.length > 0;
    f.saveToLibrary.checked = false;
    refreshFormCalcs();
  }

  function readCreatureForm(type) {
    const f = creatureForm.elements;
    const values = {
      name: f.name.value,
      hpMax: f.hpMax.value,
      ac: f.ac.value,
      speed: f.speed.value,
      initiative: f.initiative.value,
      level: f.level.value,
      initBonus: f.initBonus.value.trim(),
      cls: f.cls.value,
      race: f.race.value,
      cr: f.cr.value,
      skills: $$("[data-skill]", creatureForm).filter((cb) => cb.checked).map((cb) => cb.dataset.skill),
      attacks: $$(".attack-row", creatureForm).map((row) => ({
        name: $('[data-atk="name"]', row).value,
        ability: $('[data-atk="ability"]', row).value,
        toHit: $('[data-atk="toHit"]', row).value,
        dmgDice: $('[data-atk="dmgDice"]', row).value,
        dmgBonus: $('[data-atk="dmgBonus"]', row).value,
        dmgType: $('[data-atk="dmgType"]', row).value,
        autoToHit: row.dataset.autoHit === "1",
        autoDmg: row.dataset.autoDmg === "1",
      })),
      recharges: $$(".recharge-row", creatureForm).map((row) => ({
        name: $('[data-recharge="name"]', row).value,
        min: $('[data-recharge="min"]', row).value,
      })),
      spellSlots: $$(".spell-row", creatureForm).map((row) => ({
        level: $('[data-spell="level"]', row).value,
        current: $('[data-spell="current"]', row).value,
        max: $('[data-spell="max"]', row).value,
      })),
    };
    STAT_KEYS.forEach((k) => { values[k] = f[k].value; });
    return { block: buildStatBlock(values, type), initiative: toInt(values.initiative, 0), saveToLibrary: f.saveToLibrary.checked };
  }

  /**
   * Modes:
   *   library-new    { type }                  → new template in library
   *   library-edit   { type, templateId }      → edit template
   *   encounter-new  { type }                  → new one-off instance in active encounter
   *   instance-edit  { instanceId }            → edit an instance's stat block
   */
  function openCreatureModal(ctx) {
    creatureCtx = ctx;
    const typeLabel = ctx.type === "pc" ? "Player Character" : "Enemy";
    const title = {
      "library-new": `New ${typeLabel}`,
      "library-edit": `Edit ${typeLabel}`,
      "encounter-new": `Add ${typeLabel} to Encounter`,
      "instance-edit": "Edit Combatant",
    }[ctx.mode] || "Creature";
    $("#creature-modal-title").textContent = title;
    $("#creature-submit").textContent = ctx.mode === "encounter-new" ? "Add to Encounter" : "Save";

    $$("[data-for]", creatureForm).forEach((el) => el.classList.toggle("hidden", el.dataset.for !== ctx.type));
    const showInit = ctx.mode === "encounter-new" || ctx.mode === "instance-edit";
    $("#creature-initiative-field").classList.toggle("hidden", !showInit);
    $("#save-to-library-field").classList.toggle("hidden", ctx.mode !== "encounter-new");

    let seed = { name: "", hp: { max: 10 }, ac: 10, speed: "30 ft.", stats: {}, spellSlots: [], initiative: 0, level: 1, cr: "1" };
    if (ctx.mode === "library-edit") seed = findTemplate(ctx.templateId) || seed;
    if (ctx.mode === "instance-edit") {
      const enc = activeEncounter();
      seed = enc?.combatants.find((c) => c.instanceId === ctx.instanceId) || seed;
    }
    fillCreatureForm(seed, ctx.type);

    creatureModal.showModal();
    requestAnimationFrame(() => creatureForm.elements.name.focus());
  }

  creatureForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const nameInput = creatureForm.elements.name;
    if (!nameInput.value.trim()) { nameInput.focus(); nameInput.reportValidity(); return; }

    const ctx = creatureCtx;
    const { block, initiative, saveToLibrary } = readCreatureForm(ctx.type);

    if (ctx.mode === "library-new") {
      libraryList(ctx.type).push({ id: uuid(), ...block });
      toast(`${block.name} added to the library.`);
    }

    if (ctx.mode === "library-edit") {
      const t = findTemplate(ctx.templateId);
      if (t) Object.assign(t, block);
      toast(`${block.name} updated.`);
    }

    if (ctx.mode === "encounter-new") {
      const enc = activeEncounter();
      if (!enc) return;
      let templateId = null;
      if (saveToLibrary) {
        const t = { id: uuid(), ...block };
        libraryList(ctx.type).push(t);
        templateId = t.id;
      }
      const inst = instantiate(block, ctx.type, initiative, templateId);
      // A one-off keeps the spell slot counts the DM typed rather than entering full.
      inst.spellSlots = block.spellSlots.map((s) => ({ ...s }));
      inst.name = uniqueName(enc, block.name);
      enc.combatants.push(inst);
      sortEncounter(enc);
      toast(`${inst.name} joins the fray.`);
    }

    if (ctx.mode === "instance-edit") {
      const enc = activeEncounter();
      const idx = enc ? enc.combatants.findIndex((x) => x.instanceId === ctx.instanceId) : -1;
      if (idx >= 0) {
        const old = enc.combatants[idx];
        // Keep encounter state: current/temp HP (current follows max if it was full) and recharge status.
        const current = old.hp.current >= old.hp.max ? block.hp.max : Math.min(old.hp.current, block.hp.max);
        const recharges = (block.recharges || []).map((r) => {
          const prev = old.recharges?.find((p) => p.name === r.name);
          return { ...r, available: prev ? prev.available : true, lastRoll: prev?.lastRoll ?? null };
        });
        enc.combatants[idx] = normalizeInstance({
          ...old, ...block, initiative, recharges,
          hp: { max: block.hp.max, current, temp: old.hp.temp },
        });
        sortEncounter(enc);
      }
    }

    creatureModal.close("ok");
    commit();
  });

  /* Builder: repeatable rows */
  function addRow(hostSel, html, focusSel) {
    const host = $(hostSel);
    host.insertAdjacentHTML("beforeend", html);
    refreshFormCalcs();
    $$(focusSel, host).at(-1)?.focus();
  }

  $("#btn-add-spell-level").addEventListener("click", () => {
    const existing = $$('[data-spell="level"]', $("#spell-rows")).map((i) => toInt(i.value, 0));
    const nextLevel = clamp((existing.length ? Math.max(...existing) : 0) + 1, 1, 9);
    addRow("#spell-rows", spellRowHtml({ level: nextLevel, current: 1, max: 1 }), '[data-spell="max"]');
  });
  $("#btn-add-attack").addEventListener("click", () =>
    addRow("#attack-rows", attackRowHtml(), '[data-atk="name"]'));
  $("#btn-add-recharge").addEventListener("click", () =>
    addRow("#recharge-rows", rechargeRowHtml(), '[data-recharge="name"]'));

  creatureForm.addEventListener("click", (e) => {
    const btn = e.target.closest('[data-action="remove-row"]');
    if (btn) btn.closest("[data-row]").remove();
  });

  /* Builder: live calculations. Typing in an auto field takes it over. */
  creatureForm.addEventListener("input", (e) => {
    const atk = e.target.dataset?.atk;
    const row = e.target.closest(".attack-row");
    if (row && atk === "toHit") row.dataset.autoHit = "0";
    if (row && atk === "dmgBonus") row.dataset.autoDmg = "0";
    refreshFormCalcs();
  });
  /* Clearing an overridden auto field hands it back to the calculator. */
  creatureForm.addEventListener("change", (e) => {
    const atk = e.target.dataset?.atk;
    const row = e.target.closest(".attack-row");
    if (!row || e.target.value.trim() !== "") return;
    if (atk === "toHit") row.dataset.autoHit = "1";
    if (atk === "dmgBonus") row.dataset.autoDmg = "1";
    refreshFormCalcs();
  });

  wireDialogChrome(creatureModal);

  /* ---------- Detail modal ---------- */
  const detailModal = $("#detail-modal");
  let detailId = null;

  function openDetail(instanceId) {
    detailId = instanceId;
    detailModal.showModal();
    renderDetail();
  }

  function renderDetail() {
    if (!detailModal.open) return;
    const c = activeEncounter()?.combatants.find((x) => x.instanceId === detailId);
    if (!c) { detailModal.close(); return; }

    $("#detail-title").textContent = c.name;
    $("#detail-subtitle").textContent = subtitleFor(c);
    $("#detail-edit").classList.toggle("hidden", c.type === "lair");
    $("#detail-body").innerHTML = c.type === "lair" ? lairDetailHtml(c) : creatureDetailHtml(c);
  }

  function lairDetailHtml(c) {
    return `
      <section class="detail-section">
        <label class="field field-wide">
          <span class="field-label">Name</span>
          <input type="text" data-detail-field="name" value="${escapeHtml(c.name)}" autocomplete="off">
        </label>
        <label class="field field-wide">
          <span class="field-label">Lair actions</span>
          <textarea data-detail-field="notes" rows="8" placeholder="One per line. The DM picks one on initiative 20 each round.">${escapeHtml(c.notes)}</textarea>
        </label>
      </section>`;
  }

  function creatureDetailHtml(c) {
    const isPc = c.type === "pc";
    const summary = [
      ["AC", toInt(c.ac, 10)],
      ["HP", `${c.hp.current}/${c.hp.max}${c.hp.temp ? ` <small>+${c.hp.temp} temp</small>` : ""}`],
      ["Speed", escapeHtml(c.speed || "—")],
      ["Initiative", toInt(c.initiative, 0)],
      isPc ? ["Init Bonus", formatMod(initBonusOf(c))] : ["CR", c.cr ? `${c.cr} <small>prof ${formatMod(profFromCr(c.cr))}</small>` : "—"],
    ].map(([label, value]) => `
      <div class="detail-stat"><span class="detail-stat-label">${label}</span><span class="detail-stat-value">${value}</span></div>`).join("");

    const abilities = STAT_KEYS.map((k) => {
      const score = toInt(c.stats?.[k], 10);
      return `
        <div class="detail-ability" title="${STAT_NAMES[k]}">
          <span class="stat-label">${k.toUpperCase()}</span>
          <span class="detail-ability-score">${score}</span>
          <span class="detail-ability-mod">${formatMod(modifier(score))}</span>
        </div>`;
    }).join("");

    const conditions = CONDITIONS.map((cond) => `
      <button class="chip chip--toggle ${c.conditions.includes(cond) ? "is-on" : ""}" type="button"
              data-action="toggle-condition" data-condition="${cond}" aria-pressed="${c.conditions.includes(cond)}">${cond}</button>`).join("");

    const recharges = c.recharges?.length ? c.recharges.map((r, i) => `
      <div class="recharge-item ${r.available ? "is-ready" : "is-spent"}">
        <span class="recharge-name">${escapeHtml(r.name)} <small>Recharge ${rechargeLabel(r.min)}</small></span>
        <span class="recharge-state">${r.available ? "Ready" : "Spent"}${r.lastRoll ? ` · last roll ${r.lastRoll}` : ""}</span>
        <button class="btn btn-ghost btn-sm" type="button" data-action="toggle-recharge" data-recharge-index="${i}">${r.available ? "Use" : "Restore"}</button>
        ${r.available ? "" : `<button class="btn btn-ghost btn-sm" type="button" data-action="roll-recharge" data-recharge-index="${i}">Roll d6</button>`}
      </div>`).join("") : `<p class="detail-empty">No recharge abilities. Add them with Edit Stat Block.</p>`;

    // Skills, attacks and spell slots sit below the trackers, side by side when there's more than one.
    const extras = [
      !isPc && c.skills?.length ? `
        <section class="detail-section">
          <h3 class="detail-section-title">Skills</h3>
          <p class="detail-text">${escapeHtml(skillsText(c))}</p>
        </section>` : "",
      !isPc && c.attacks?.length ? `
        <section class="detail-section">
          <h3 class="detail-section-title">Attacks</h3>
          <div class="card-attacks">${c.attacks.map(attackHtml).join("")}</div>
        </section>` : "",
      spellBlockHtml(c),
    ].filter(Boolean);

    return `
      <div class="detail-summary">${summary}</div>

      <section class="detail-section">
        <h3 class="detail-section-title">Ability Scores</h3>
        <div class="detail-abilities">${abilities}</div>
      </section>

      <div class="detail-grid">
        <div class="detail-col">
          <section class="detail-section">
            <h3 class="detail-section-title">Conditions</h3>
            <div class="chip-grid">${conditions}</div>
            <div class="exhaustion">
              <span class="field-label">Exhaustion</span>
              <button class="icon-btn" type="button" data-action="exhaustion" data-delta="-1" aria-label="Decrease exhaustion">−</button>
              <span class="exhaustion-value ${c.exhaustion ? "is-on" : ""}">${c.exhaustion}</span>
              <button class="icon-btn" type="button" data-action="exhaustion" data-delta="1" aria-label="Increase exhaustion">+</button>
            </div>
          </section>
        </div>

        <div class="detail-col">
          <section class="detail-section">
            <h3 class="detail-section-title">Concentration</h3>
            <div class="concentration ${c.concentration.active ? "is-on" : ""}">
              <button class="chip chip--toggle chip--conc-toggle ${c.concentration.active ? "is-on" : ""}" type="button"
                      data-action="toggle-concentration" aria-pressed="${c.concentration.active}">
                ◉ ${c.concentration.active ? "Concentrating" : "Not concentrating"}
              </button>
              <input type="text" data-detail-field="concentrationSpell" value="${escapeHtml(c.concentration.spell)}"
                     placeholder="Spell name" autocomplete="off" aria-label="Concentration spell">
            </div>
          </section>

          ${isPc ? `
            <section class="detail-section">
              <h3 class="detail-section-title">Death Saves</h3>
              ${deathSavesHtml(c)}
              <button class="btn btn-ghost btn-sm" type="button" data-action="reset-death-saves">Reset</button>
            </section>` : `
            <section class="detail-section">
              <h3 class="detail-section-title">Recharge Abilities</h3>
              <p class="detail-hint">Spent abilities roll automatically at the start of this creature's turn.</p>
              ${recharges}
            </section>`}
        </div>
      </div>

      ${extras.length ? `<div class="detail-extras">${extras.join("")}</div>` : ""}`;
  }

  /* Detail interactions that change state (shared with cards where it makes sense). */
  function applyCombatantAction(c, btn) {
    switch (btn.dataset.action) {
      case "toggle-pip": {
        const slot = c.spellSlots?.[toInt(btn.dataset.slotIndex, -1)];
        if (!slot) return false;
        const p = toInt(btn.dataset.pipIndex, 0);
        slot.current = clamp(p < slot.current ? p : p + 1, 0, slot.max);
        return true;
      }
      case "death-save": {
        const kind = btn.dataset.kind === "fail" ? "fail" : "success";
        const i = toInt(btn.dataset.index, 0);
        c.deathSaves[kind] = i < c.deathSaves[kind] ? i : i + 1;
        return true;
      }
      case "reset-death-saves":
        c.deathSaves = { success: 0, fail: 0 };
        return true;
      case "toggle-recharge": {
        const r = c.recharges?.[toInt(btn.dataset.rechargeIndex, -1)];
        if (!r) return false;
        r.available = !r.available;
        return true;
      }
      case "roll-recharge": {
        const r = c.recharges?.[toInt(btn.dataset.rechargeIndex, -1)];
        if (!r || r.available) return false;
        const roll = rollD6();
        r.lastRoll = roll;
        r.available = roll >= r.min;
        toast(`${c.name}: ${r.name} ${r.available ? "recharged" : "not recharged"} (rolled ${roll})`);
        return true;
      }
      case "toggle-condition": {
        const cond = btn.dataset.condition;
        c.conditions = c.conditions.includes(cond)
          ? c.conditions.filter((x) => x !== cond)
          : CONDITIONS.filter((x) => x === cond || c.conditions.includes(x));
        return true;
      }
      case "exhaustion":
        c.exhaustion = clamp(c.exhaustion + toInt(btn.dataset.delta, 0), 0, 6);
        return true;
      case "toggle-concentration":
        c.concentration.active = !c.concentration.active;
        return true;
    }
    return false;
  }

  $("#detail-body").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    const c = activeEncounter()?.combatants.find((x) => x.instanceId === detailId);
    if (!btn || !c) return;
    if (applyCombatantAction(c, btn)) commit();
  });

  /* Text fields save as you type but only repaint the cards behind the
     modal on change, so focus and clicks inside the modal aren't disturbed. */
  $("#detail-body").addEventListener("input", (e) => {
    const field = e.target.dataset.detailField;
    const c = activeEncounter()?.combatants.find((x) => x.instanceId === detailId);
    if (!field || !c) return;
    if (field === "concentrationSpell") c.concentration.spell = e.target.value;
    if (field === "notes") c.notes = e.target.value;
    if (field === "name") {
      c.name = e.target.value;
      $("#detail-title").textContent = c.name || "Lair Action";
    }
    saveState();
  });
  $("#detail-body").addEventListener("change", (e) => {
    if (!e.target.dataset.detailField) return;
    const c = activeEncounter()?.combatants.find((x) => x.instanceId === detailId);
    if (c?.type === "lair" && !c.name.trim()) { c.name = "Lair Action"; saveState(); }
    renderActiveEncounter();
  });

  $("#detail-edit").addEventListener("click", () => {
    const c = activeEncounter()?.combatants.find((x) => x.instanceId === detailId);
    detailModal.close();
    if (c) openCreatureModal({ mode: "instance-edit", type: c.type, instanceId: c.instanceId });
  });

  detailModal.addEventListener("close", () => { detailId = null; });
  wireDialogChrome(detailModal);

  /* ---------- Picker (add from library) ---------- */
  const pickerModal = $("#picker-modal");
  let pickerType = "pc";

  function updatePickerInitLabel() {
    const t = findTemplate($("#picker-select").value);
    $("#picker-init-label").textContent = t
      ? `Initiative (bonus ${formatMod(initBonusOf({ ...t, type: pickerType }))})`
      : "Initiative";
  }

  function openPicker(type) {
    pickerType = type;
    const list = libraryList(type);
    $("#picker-title").textContent = type === "pc" ? "Add Player Character" : "Add Enemy";
    const select = $("#picker-select");
    select.innerHTML = list.map((t) => {
      const extra = type === "pc" ? `Lvl ${t.level}` : (t.cr ? `CR ${t.cr}` : "");
      const init = formatMod(initBonusOf({ ...t, type }));
      return `<option value="${t.id}">${escapeHtml(t.name)} — ${[extra, `HP ${toInt(t.hp?.max, 0)}`, `AC ${toInt(t.ac, 10)}`, `Init ${init}`].filter(Boolean).join(", ")}</option>`;
    }).join("");
    const empty = list.length === 0;
    $("#picker-empty").classList.toggle("hidden", !empty);
    select.disabled = empty;
    $("#picker-submit").disabled = empty;
    const f = $("#picker-form").elements;
    f.initiative.value = 0;
    f.count.value = 1;
    updatePickerInitLabel();
    pickerModal.showModal();
    requestAnimationFrame(() => (empty ? $("#picker-create-new") : select).focus());
  }

  $("#picker-select").addEventListener("change", updatePickerInitLabel);

  $("#picker-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const enc = activeEncounter();
    if (!enc) return;
    const f = e.target.elements;
    const added = addCombatantsFromTemplate(enc, f.templateId.value, f.initiative.value, f.count.value);
    pickerModal.close("ok");
    if (added) toast(`${added === 1 ? "1 combatant" : `${added} combatants`} added.`);
    commit();
  });

  $("#picker-create-new").addEventListener("click", () => {
    pickerModal.close("cancel");
    openCreatureModal({ mode: "encounter-new", type: pickerType });
  });

  wireDialogChrome(pickerModal);

  /* ======================================================================
     6. Event wiring
     ====================================================================== */

  /* ---------- Tabs ---------- */
  $$(".tab").forEach((tab) =>
    tab.addEventListener("click", () => {
      state.ui.view = tab.dataset.view;
      commit();
    }));

  /* ---------- New encounter ---------- */
  async function createEncounter() {
    const name = await promptDialog({ title: "New Encounter", label: "Encounter name", okLabel: "Create" });
    if (!name) return;
    const enc = normalizeEncounter({ id: uuid(), name, round: 1, currentTurnIndex: 0, combatants: [] });
    state.encounters.unshift(enc);
    state.ui.activeEncounterId = enc.id;
    state.ui.view = "active";
    toast(`${name} begins.`);
    commit();
  }
  $("#btn-new-encounter").addEventListener("click", createEncounter);
  $("#btn-new-encounter-from-active").addEventListener("click", createEncounter);

  /* ---------- Encounter list actions ---------- */
  $("#encounter-list").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const card = btn.closest("[data-encounter-id]");
    const enc = findEncounter(card?.dataset.encounterId);
    if (!enc) return;

    switch (btn.dataset.action) {
      case "open-encounter":
        state.ui.activeEncounterId = enc.id;
        state.ui.view = "active";
        commit();
        break;

      case "rename-encounter": {
        const name = await promptDialog({ title: "Rename Encounter", label: "Encounter name", value: enc.name, okLabel: "Rename" });
        if (name && name !== enc.name) { enc.name = name; commit(); }
        break;
      }

      case "delete-encounter": {
        const ok = await confirmDialog({
          title: "Delete Encounter",
          html: `Delete <strong>${escapeHtml(enc.name)}</strong> and all of its combatants? The library is untouched. This cannot be undone.`,
        });
        if (!ok) return;
        state.encounters = state.encounters.filter((x) => x.id !== enc.id);
        if (state.ui.activeEncounterId === enc.id) state.ui.activeEncounterId = null;
        toast(`${enc.name} deleted.`);
        commit();
        break;
      }
    }
  });

  /* ---------- Tracker controls ---------- */
  $("#btn-next-turn").addEventListener("click", () => {
    const enc = activeEncounter();
    if (!enc) return;
    nextTurn(enc);
    commit();
  });
  $("#btn-prev-turn").addEventListener("click", () => {
    const enc = activeEncounter();
    if (!enc) return;
    prevTurn(enc);
    commit();
  });
  $("#btn-add-pc").addEventListener("click", () => openPicker("pc"));
  $("#btn-add-enemy").addEventListener("click", () => openPicker("enemy"));
  $("#btn-add-lair").addEventListener("click", () => {
    const enc = activeEncounter();
    if (!enc) return;
    enc.combatants.push(makeLair());
    sortEncounter(enc);
    toast("Lair action added at initiative 20.");
    commit();
  });

  $("#btn-clock-toggle").addEventListener("click", () => {
    const enc = activeEncounter();
    if (!enc) return;
    if (clockRunning(enc)) pauseClock(enc); else startClock(enc);
    saveState();
    renderClock();
  });
  $("#btn-clock-reset").addEventListener("click", () => {
    const enc = activeEncounter();
    if (!enc) return;
    resetClock(enc);
    saveState();
    renderClock();
  });
  // Sub-second tick so the display never lags the true elapsed time by a full second.
  setInterval(renderClock, 250);

  /* Keyboard: N / → next turn, P / ← previous turn, when nothing is focused */
  document.addEventListener("keydown", (e) => {
    if (state.ui.view !== "active") return;
    if (document.querySelector("dialog[open]")) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (e.key === "n" || e.key === "ArrowRight") { e.preventDefault(); $("#btn-next-turn").click(); }
    if (e.key === "p" || e.key === "ArrowLeft") { e.preventDefault(); $("#btn-prev-turn").click(); }
  });

  /* ---------- Combatant card actions ---------- */
  const cardsHost = $("#combatant-cards");

  function combatantFromEvent(e) {
    const el = e.target.closest("[data-instance-id]");
    const enc = activeEncounter();
    if (!el || !enc) return {};
    const combatant = enc.combatants.find((c) => c.instanceId === el.dataset.instanceId);
    return { enc, combatant, el };
  }

  cardsHost.addEventListener("click", async (e) => {
    const { enc, combatant, el } = combatantFromEvent(e);
    if (!combatant) return;
    const btn = e.target.closest("[data-action]");

    // A click on the card itself (not a control) opens the detail modal.
    if (!btn) {
      if (!e.target.closest("input, button, label, select, textarea, a")) openDetail(combatant.instanceId);
      return;
    }

    switch (btn.dataset.action) {
      case "damage":
      case "heal": {
        const input = $('[data-field="hpDelta"]', el);
        const amount = Math.abs(toInt(input.value, 0)) || 1;
        if (btn.dataset.action === "damage") {
          adjustHp(combatant, -amount);
          if (combatant.concentration.active && combatant.hp.current > 0) {
            toast(`${combatant.name}: concentration save, DC ${clamp(Math.floor(amount / 2), 10, 30)}`);
          }
        } else {
          adjustHp(combatant, amount);
        }
        afterHpChange(combatant);
        commit();
        break;
      }

      case "open-detail":
        openDetail(combatant.instanceId);
        break;

      case "edit-instance":
        openCreatureModal({ mode: "instance-edit", type: combatant.type, instanceId: combatant.instanceId });
        break;

      case "remove-instance": {
        const ok = await confirmDialog({
          title: "Remove Combatant",
          html: `Remove <strong>${escapeHtml(combatant.name)}</strong> from this encounter? Their library entry, if any, stays put.`,
          okLabel: "Remove",
        });
        if (!ok) return;
        const removedIdx = enc.combatants.indexOf(combatant);
        enc.combatants.splice(removedIdx, 1);
        if (removedIdx < enc.currentTurnIndex) enc.currentTurnIndex -= 1;
        else if (removedIdx === enc.currentTurnIndex && removedIdx >= enc.combatants.length) enc.currentTurnIndex = 0;
        sortEncounter(enc);
        commit();
        break;
      }

      default:
        if (applyCombatantAction(combatant, btn)) commit();
    }
  });

  /* Inline edits commit on change (blur / Enter) */
  cardsHost.addEventListener("change", (e) => {
    const input = e.target.closest("[data-field]");
    if (!input) return;
    const { enc, combatant } = combatantFromEvent(e);
    if (!combatant) return;

    switch (input.dataset.field) {
      case "initiative":
        combatant.initiative = toInt(input.value, 0);
        sortEncounter(enc);
        commit();
        break;
      case "hpCurrent":
        combatant.hp.current = Math.max(0, toInt(input.value, 0));
        afterHpChange(combatant);
        commit();
        break;
      case "hpMax":
        combatant.hp.max = Math.max(0, toInt(input.value, 0));
        combatant.hp.current = Math.min(combatant.hp.current, combatant.hp.max);
        afterHpChange(combatant);
        commit();
        break;
      case "hpTemp":
        combatant.hp.temp = Math.max(0, toInt(input.value, 0));
        commit();
        break;
    }
  });

  /* Enter in the damage box applies damage; Shift+Enter heals */
  cardsHost.addEventListener("keydown", (e) => {
    const input = e.target.closest('[data-field="hpDelta"]');
    if (!input || e.key !== "Enter") return;
    e.preventDefault();
    const el = input.closest("[data-instance-id]");
    $(e.shiftKey ? '[data-action="heal"]' : '[data-action="damage"]', el)?.click();
  });

  /* ---------- Library actions ---------- */
  $("#btn-new-pc").addEventListener("click", () => openCreatureModal({ mode: "library-new", type: "pc" }));
  $("#btn-new-enemy").addEventListener("click", () => openCreatureModal({ mode: "library-new", type: "enemy" }));

  $(".library-columns").addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const row = btn.closest("[data-template-id]");
    const template = findTemplate(row?.dataset.templateId);
    if (!template) return;
    const type = templateType(template.id);

    if (btn.dataset.action === "edit-template") {
      openCreatureModal({ mode: "library-edit", type, templateId: template.id });
    }

    if (btn.dataset.action === "delete-template") {
      const ok = await confirmDialog({
        title: "Delete from Library",
        html: `Delete <strong>${escapeHtml(template.name)}</strong> from the library? Combatants already in encounters are unaffected.`,
      });
      if (!ok) return;
      const list = libraryList(type);
      list.splice(list.indexOf(template), 1);
      toast(`${template.name} removed from the library.`);
      commit();
    }
  });

  /* ======================================================================
     7. Boot
     ====================================================================== */

  /* Static option lists for the builder. */
  creatureForm.elements.cls.innerHTML =
    `<option value="">—</option>` + CLASSES.map((c) => `<option value="${c}">${c}</option>`).join("");
  creatureForm.elements.cr.innerHTML =
    `<option value="">—</option>` + CR_OPTIONS.map((cr) => `<option value="${cr}">${cr}</option>`).join("");
  $("#damage-types").innerHTML = DAMAGE_TYPES.map((t) => `<option value="${t}">`).join("");
  $("#skill-grid").innerHTML = SKILLS.map((s) => `
    <label class="skill-check">
      <input type="checkbox" data-skill="${s.key}">
      <span class="skill-name">${s.name} <small>${s.ability.toUpperCase()}</small></span>
      <span class="skill-bonus" data-skill-bonus="${s.key}">+0</span>
    </label>`).join("");

  state = loadState();
  if (state.ui.activeEncounterId && !findEncounter(state.ui.activeEncounterId)) {
    state.ui.activeEncounterId = null;
  }
  state.encounters.forEach(sortEncounter);
  if (!["encounters", "active", "library"].includes(state.ui.view)) state.ui.view = "encounters";
  renderAll();
})();

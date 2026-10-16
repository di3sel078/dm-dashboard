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

  const R = window.DMRules;
  const {
    STAT_KEYS, STAT_NAMES, SKILL_BY_KEY, SKILLS, CONDITIONS, CONDITION_EFFECTS, CLASSES, CR_OPTIONS,
    DAMAGE_TYPES, LAIR_INITIATIVE, uuid, toInt, clamp, modifier, formatMod, formatNum,
    profFromCr, rechargeLabel, initBonusOf, skillBonus, normalizeAttack, normalizeTemplate,
    normalizeEncounter, normalizeInstance, instantiate, makeLair, uniqueName, sortEncounter,
  } = R;

  const STORAGE_KEY = "dm-dashboard-state-v2";
  const LEGACY_STORAGE_KEY = "dm-dashboard-state-v1";
  const SCHEMA_VERSION = 2;
  const LEVEL_LABEL = { 1: "1st", 2: "2nd", 3: "3rd" };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const svg = (body, size = 15) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const ICON_TRASH = svg(`<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/>`);
  const ICON_EDIT = svg(`<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>`);
  const ICON_EXPAND = svg(`<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>`);
  const ICON_PLAY = svg(`<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>`, 14);
  const ICON_PAUSE = svg(`<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" stroke="none"/>`, 14);
  const ICON_RESET = svg(`<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>`, 14);

  const escapeHtml = (str) =>
    String(str ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  const ordinal = (n) => LEVEL_LABEL[n] || `${n}th`;

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

  let state = R.defaultState();

  const storageGet = (key) => { try { return localStorage.getItem(key); } catch { return null; } };

  /**
   * v2 if present; otherwise migrate v1 through the normalizers and write it
   * as v2. The v1 key is never touched, so it stays as a backup.
   */
  function loadState() {
    const raw = storageGet(STORAGE_KEY);
    const legacy = raw ? null : storageGet(LEGACY_STORAGE_KEY);
    if (!raw && !legacy) return R.defaultState();
    try {
      const migrated = R.migrateState(JSON.parse(raw || legacy));
      if (legacy) {
        state = migrated;
        saveState();
      }
      return migrated;
    } catch (err) {
      console.warn("Could not read saved state, starting fresh.", err);
      return R.defaultState();
    }
  }

  const serializeState = () => JSON.stringify({ schemaVersion: SCHEMA_VERSION, savedAt: Date.now(), ...state });

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, serializeState());
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
      // Blank init bonus falls back to the DEX modifier.
      initBonus: values.initBonus === "" ? null : values.initBonus,
    };
    const specific = type === "pc" ? {
      level: values.level,
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

  /** Surface rule events (from rules.js) to the DM. */
  function announce(events) {
    (events || []).forEach((ev) => toast(ev.text));
  }

  /** Damage from the card controls. Returns a short summary for the toast. */
  function damageCombatant(c, amount, { crit = false } = {}) {
    const { result, events } = R.applyDamage(c, amount, { crit });
    const parts = [`${c.name} takes ${amount}`];
    if (result.absorbedByTemp) parts.push(`${result.absorbedByTemp} absorbed by temp HP`);
    if (result.overflow && c.type === "pc" && !result.instantDeath && result.droppedToZero) parts.push(`${result.overflow} overflow`);
    toast(parts.join(", ") + ".");
    announce(events);
  }

  function healCombatant(c, amount) {
    if (R.isDead(c)) {
      toast(`${c.name} is dead. Healing has no effect; set HP directly if they are revived.`);
      return false;
    }
    const { result, events } = R.applyHealing(c, amount);
    toast(result.healed
      ? `${c.name} regains ${result.healed} HP${result.healed < amount ? ` (capped at max ${c.hp.max})` : ""}.`
      : `${c.name} is already at max HP.`);
    announce(events);
    return true;
  }

  function grantTemp(c, amount) {
    const r = R.grantTempHp(c, amount);
    toast(r.applied
      ? `${c.name} gains ${r.value} temp HP.`
      : `${c.name} keeps ${r.previous} temp HP; the new ${r.value} was ignored (temp HP doesn't stack).`);
    return r.applied;
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
    const { events, newRound } = R.nextTurn(enc);
    if (newRound) roundBump = true;
    announce(events);
  }

  function prevTurn(enc) {
    if (R.prevTurn(enc).newRound) roundBump = true;
  }

  let roundBump = false;

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
      const status = vitalStatus(cur);
      const unconscious = cur.type !== "lair" && R.hasCondition(cur, "Unconscious") && status?.key !== "dead";
      const note = status?.key === "dead" ? "Dead"
        : [status && status.key !== "unconscious" ? status.label : "", unconscious ? "Unconscious" : ""].filter(Boolean).join(" · ");
      banner.classList.toggle("is-pc", cur.type === "pc");
      banner.innerHTML = `
        <span>Now acting:</span>
        <strong>${escapeHtml(cur.name)}</strong>
        ${note ? `<span class="turn-note turn-note--${status?.key || "unconscious"}">${escapeHtml(note)}</span>` : ""}
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
    const d = R.encounterDifficulty(enc);
    el.classList.toggle("hidden", !d);
    if (!d) return;
    const label = { under: "Under benchmark", approaching: "Approaching", over: "Over benchmark" }[d.tier];
    el.className = `difficulty difficulty--${d.tier}`;
    el.innerHTML = `
      <span class="difficulty-label">Benchmark</span>
      <span>CR <b>${formatNum(d.totalCr)}</b> / ${formatNum(d.benchmark)}</span>
      <span class="difficulty-tier">${label}</span>
      ${d.dominant ? `<span class="difficulty-warn">Hint: ${escapeHtml(d.dominant.name.replace(/\s+\d+$/, ""))} may be a lot on its own</span>` : ""}`;
    el.title =
      `Lazy Encounter Benchmark (Sly Flourish): a rough heuristic, not the DMG XP budget.\n` +
      `Total enemy CR ${formatNum(d.totalCr)} vs. benchmark ${formatNum(d.benchmark)} ` +
      `(${d.avgLevel >= 5 ? "½" : "¼"} of ${d.totalLevels} total PC levels). Over the benchmark, the fight may be deadly.` +
      (d.dominant ? `\nHint: one monster type is above CR ${formatNum(d.singleCap)} and may be deadly by itself.` : "");
  }

  /* ---------- Card fragments (shared with the detail modal) ---------- */
  function subtitleFor(c) {
    if (c.type === "lair") return "Lair · loses ties";
    if (c.type === "pc") return ["PC", `Lvl ${c.level}`, c.cls, c.race].filter(Boolean).join(" · ");
    return ["Enemy", c.cr ? `CR ${c.cr}` : ""].filter(Boolean).join(" · ");
  }

  /** Dead, Stable, Dying (PCs) or Down (monsters), or null when standing. */
  function vitalStatus(c) {
    if (c.type === "lair") return null;
    if (R.isDead(c)) return { key: "dead", label: "Dead" };
    if (c.hp.current > 0) return null;
    if (c.type !== "pc") return { key: "down", label: "Down" };
    if (R.isStable(c)) return { key: "stable", label: "Stable" };
    return { key: "dying", label: "Dying" };
  }

  const exhaustionTitle = (level) =>
    R.exhaustionEffects(level).map((e, i) => `${i + 1}: ${e}`).join("\n");

  function statusChipsHtml(c) {
    const chips = [];
    if (c.concentration?.active) {
      chips.push(`<span class="chip chip--conc" title="Concentrating">◉ ${escapeHtml(c.concentration.spell || "Concentrating")}</span>`);
    }
    (c.conditions || []).forEach((cond) =>
      chips.push(`<span class="chip chip--cond" title="${escapeHtml(CONDITION_EFFECTS[cond] || "")}">${cond}</span>`));
    if (c.exhaustion) {
      chips.push(`<span class="chip chip--exh" title="${escapeHtml(`Exhaustion (cumulative)\n${exhaustionTitle(c.exhaustion)}`)}">Exhaustion ${c.exhaustion}</span>`);
    }
    const check = c.concentrationCheck;
    const banner = check && c.concentration?.active ? `
      <div class="conc-check" role="status">
        <span>Concentration save <b>DC ${check.dc}</b>${check.count > 1 ? ` <small>×${check.count} saves</small>` : ""}</span>
        <button class="icon-btn conc-check-dismiss" type="button" data-action="dismiss-conc-check"
                title="Dismiss" aria-label="Dismiss concentration save reminder">×</button>
      </div>` : "";
    return (chips.length ? `<div class="card-status">${chips.join("")}</div>` : "") + banner;
  }

  function deathSavesHtml(c) {
    const ds = c.deathSaves;
    const pips = (kind) => [0, 1, 2].map((i) => `
      <button class="pip pip--${kind} ${i < ds[kind] ? "is-full" : ""}" type="button"
              data-action="death-save" data-kind="${kind}" data-index="${i}"
              aria-label="Death save ${kind} ${i + 1}"></button>`).join("");
    const vs = vitalStatus(c);
    const status = vs && ["dead", "stable"].includes(vs.key)
      ? `<span class="ds-status ds-status--${vs.key}">${vs.label}</span>` : "";
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
              <span class="spell-level">${ordinal(s.level)}${s.recovery === "short" ? ` <abbr class="spell-recovery" title="Recovers on a short rest">SR</abbr>` : ""}</span>
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
          ${(() => { const vs = vitalStatus(c); return vs ? `<span class="card-down-tag card-down-tag--${vs.key}">${vs.label}</span>` : ""; })()}
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
    info.push(`<span><b>Init</b> ${formatMod(initBonusOf(c))}</span>`);
    const skills = isPc ? "" : skillsText(c);

    return `
      <article class="card card--${c.type} ${isCurrent ? "is-current" : ""} ${isDown ? "is-down" : ""} ${R.isDead(c) ? "is-dead" : ""}"
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
            <input type="number" min="0" placeholder="1" data-field="hpDelta"
                   aria-label="Damage, healing or temp HP amount" title="Enter applies damage, Shift+Enter heals">
            ${isPc && isDown && !R.isDead(c) ? `
              <label class="crit-toggle" title="Damage at 0 HP from a critical hit counts as two death save failures">
                <input type="checkbox" data-field="crit"> Crit
              </label>` : ""}
          </div>
          <div class="hp-adjust-btns">
            <button class="hp-adj-btn hp-adj-btn--dmg" type="button" data-action="damage" title="Apply damage, 1 if blank (Enter)">Damage</button>
            <button class="hp-adj-btn hp-adj-btn--heal" type="button" data-action="heal" title="Apply healing, 1 if blank (Shift+Enter). Caps at max HP.">Heal</button>
            <button class="hp-adj-btn hp-adj-btn--temp" type="button" data-action="temp" title="Grant temporary HP. Keeps the higher value; temp HP doesn't stack.">Temp</button>
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

  function spellRowHtml(slot = { level: 1, current: 0, max: 0, recovery: "long" }) {
    return `
      <div class="spell-row" data-row>
        <label class="field"><span class="field-label">Level</span>
          <input type="number" min="1" max="9" data-spell="level" value="${toInt(slot.level, 1)}"></label>
        <label class="field"><span class="field-label">Current</span>
          <input type="number" min="0" data-spell="current" value="${toInt(slot.current, 0)}"></label>
        <label class="field"><span class="field-label">Max</span>
          <input type="number" min="0" data-spell="max" value="${toInt(slot.max, 0)}"></label>
        <label class="field"><span class="field-label">Recovers on</span>
          <select data-spell="recovery" title="Warlock Pact Magic slots recover on a short rest">
            <option value="long" ${slot.recovery !== "short" ? "selected" : ""}>Long rest</option>
            <option value="short" ${slot.recovery === "short" ? "selected" : ""}>Short rest</option>
          </select></label>
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
    f.initBonus.value = block.initBonus ?? "";
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
        recovery: $('[data-spell="recovery"]', row).value,
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
    addRow("#spell-rows", spellRowHtml({ level: nextLevel, current: 1, max: 1, recovery: "long" }), '[data-spell="max"]');
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
      ["Init Bonus", `${formatMod(initBonusOf(c))}${c.initBonus === null ? " <small>DEX</small>" : ""}`],
      isPc ? null : ["CR", c.cr ? `${c.cr} <small>prof ${formatMod(profFromCr(c.cr))}</small>` : "—"],
    ].filter(Boolean).map(([label, value]) => `
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
              data-action="toggle-condition" data-condition="${cond}" aria-pressed="${c.conditions.includes(cond)}"
              title="${escapeHtml(CONDITION_EFFECTS[cond])}">${cond}</button>`).join("");
    const activeEffects = c.conditions.length ? `
      <ul class="effect-list">
        ${c.conditions.map((cond) => `<li><b>${cond}</b> ${escapeHtml(CONDITION_EFFECTS[cond])}</li>`).join("")}
      </ul>` : "";
    const exhaustionEffects = c.exhaustion ? `
      <ul class="effect-list effect-list--exh">
        ${R.exhaustionEffects(c.exhaustion).map((e, i) => `<li><b>Level ${i + 1}</b> ${escapeHtml(e)}${i === 3 ? " <small>(not applied automatically)</small>" : ""}</li>`).join("")}
      </ul>` : "";
    const check = c.concentrationCheck;
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
            ${activeEffects}
            <div class="exhaustion">
              <span class="field-label">Exhaustion</span>
              <button class="icon-btn" type="button" data-action="exhaustion" data-delta="-1" aria-label="Decrease exhaustion">−</button>
              <span class="exhaustion-value ${c.exhaustion ? "is-on" : ""}">${c.exhaustion}</span>
              <button class="icon-btn" type="button" data-action="exhaustion" data-delta="1" aria-label="Increase exhaustion">+</button>
            </div>
            ${exhaustionEffects}
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
            ${check && c.concentration.active ? `
              <div class="conc-check" role="status">
                <span>Concentration save <b>DC ${check.dc}</b>${check.count > 1 ? ` <small>×${check.count} saves</small>` : ""}</span>
                <button class="btn btn-ghost btn-sm" type="button" data-action="dismiss-conc-check">Dismiss</button>
              </div>` : ""}
            <p class="detail-hint">DC is 10 or half the damage taken, whichever is higher. One save per damage source.</p>
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
        announce(R.rollRecharges({ name: c.name, recharges: [r] }));
        return true;
      }
      case "toggle-condition":
        announce(R.toggleCondition(c, btn.dataset.condition));
        return true;
      case "exhaustion": {
        const before = c.exhaustion;
        c.exhaustion = clamp(c.exhaustion + toInt(btn.dataset.delta, 0), 0, 6);
        if (c.exhaustion === 6 && before < 6) toast(`${c.name} reaches exhaustion level 6 and dies.`);
        return c.exhaustion !== before;
      }
      case "toggle-concentration":
        c.concentration.active = !c.concentration.active;
        if (!c.concentration.active) c.concentrationCheck = null;
        return true;
      case "dismiss-conc-check":
        c.concentrationCheck = null;
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
      case "heal":
      case "temp": {
        const input = $('[data-field="hpDelta"]', el);
        const amount = Math.abs(toInt(input.value, 0)) || 1;
        const action = btn.dataset.action;
        if (action === "damage") {
          damageCombatant(combatant, amount, { crit: !!$('[data-field="crit"]', el)?.checked });
        } else if (action === "heal") {
          if (!healCombatant(combatant, amount)) return;
        } else if (!grantTemp(combatant, amount)) {
          return;
        }
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
        // Direct edits are corrections, so they bypass massive damage and death save rules.
        combatant.hp.current = Math.min(Math.max(0, toInt(input.value, 0)), combatant.hp.max);
        announce(R.afterHpChange(combatant));
        commit();
        break;
      case "hpMax":
        combatant.hp.max = Math.max(0, toInt(input.value, 0));
        combatant.hp.current = Math.min(combatant.hp.current, combatant.hp.max);
        announce(R.afterHpChange(combatant));
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

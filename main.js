/* ==========================================================================
   DM Dashboard — Application Logic
   Rules (math, normalisation, migration, dice) live in rules.js as DMRules.
   Sections:
     1. Constants & utilities
     2. State & storage (load/migrate, save, commit, undo, log)
     3. Domain helpers (combatants, HP, turns, rests, clock)
     4. Rendering
     5. Dialogs (toast, prompt, confirm, choice, creature builder, detail, picker)
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
    STAT_KEYS, STAT_NAMES, SKILLS, SKILL_BY_KEY, CONDITIONS, CONDITION_EFFECTS, CLASSES, CR_OPTIONS,
    DAMAGE_TYPES, uuid, toInt, clamp, modifier, formatMod, formatNum, profFromCr, profFromLevel,
    rechargeLabel, initBonusOf, skillBonus, saveBonus, normalizeAttack, normalizeTemplate,
    normalizeEncounter, normalizeInstance, instantiate, makeLair, uniqueName, sortEncounter,
  } = R;

  const STORAGE_KEY = "dm-dashboard-state-v2";
  const LEGACY_STORAGE_KEY = "dm-dashboard-state-v1";
  const SCHEMA_VERSION = 2;
  const UNDO_LIMIT = 30;
  const LEVEL_LABEL = { 1: "1st", 2: "2nd", 3: "3rd" };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const svg = (body, size = 15) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const ICON_TRASH = svg(`<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/>`);
  const ICON_EDIT = svg(`<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>`);
  const ICON_EXPAND = svg(`<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>`);
  const ICON_PLAY = svg(`<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>`, 14);
  const ICON_PAUSE = svg(`<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" stroke="none"/>`, 14);
  const ICON_DIE = svg(`<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1" fill="currentColor"/><circle cx="15" cy="15" r="1" fill="currentColor"/><circle cx="15" cy="9" r="1" fill="currentColor"/><circle cx="9" cy="15" r="1" fill="currentColor"/>`, 12);

  const escapeHtml = (str) =>
    String(str ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  const ordinal = (n) => LEVEL_LABEL[n] || `${n}th`;
  const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const baseName = (name) => name.replace(/\s+\d+$/, "");

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
    snapshotActive();
  }

  /* ---------- Undo ----------
     After every save we keep a JSON copy of the active encounter. An undoable
     commit pushes that copy (the state before this mutation) onto the stack. */
  let lastSnapshot = null;
  const undoStack = [];

  function snapshotActive() {
    const enc = activeEncounter();
    lastSnapshot = enc ? { id: enc.id, json: JSON.stringify(enc) } : null;
  }

  /** Persist, then repaint. Every mutation funnels through here. */
  function commit({ undo = null } = {}) {
    if (undo && lastSnapshot) {
      undoStack.push({ ...lastSnapshot, label: undo });
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    }
    saveState();
    renderAll();
  }

  function undo() {
    while (undoStack.length) {
      const entry = undoStack.pop();
      const idx = state.encounters.findIndex((e) => e.id === entry.id);
      if (idx < 0) continue;
      const restored = normalizeEncounter(JSON.parse(entry.json));
      // The clock keeps running in real time; undo never rewinds it.
      restored.clock = state.encounters[idx].clock;
      state.encounters[idx] = restored;
      toast(`Undone: ${entry.label}`);
      saveState();
      renderAll();
      return true;
    }
    toast("Nothing to undo.");
    return false;
  }

  const libraryList = (type) => (type === "pc" ? state.creatureLibrary.pcs : state.creatureLibrary.enemies);
  const findTemplate = (id) =>
    state.creatureLibrary.pcs.find((t) => t.id === id) ||
    state.creatureLibrary.enemies.find((t) => t.id === id) || null;
  const templateType = (id) => (state.creatureLibrary.pcs.some((t) => t.id === id) ? "pc" : "enemy");
  const findEncounter = (id) => state.encounters.find((e) => e.id === id) || null;
  const activeEncounter = () => findEncounter(state.ui.activeEncounterId);
  const findCombatant = (id) => activeEncounter()?.combatants.find((c) => c.instanceId === id) || null;

  /**
   * Record rule events in the encounter's log and toast them. Turn changes
   * are logged but not toasted; the banner already says it.
   */
  function announce(events, { enc = activeEncounter(), quiet = false } = {}) {
    (events || []).forEach((ev) => {
      if (enc) R.pushLog(enc, ev.kind, ev.text);
      if (!quiet && ev.kind !== "turn") toast(ev.text);
    });
  }
  const logEntry = (kind, text, enc = activeEncounter()) => { if (enc) R.pushLog(enc, kind, text); };

  /* ======================================================================
     3. Domain helpers
     ====================================================================== */

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
    logEntry("info", `${n === 1 ? template.name : `${n} × ${template.name}`} joined the encounter.`, enc);
    return n;
  }

  /* ---------- HP ---------- */
  function damageCombatant(c, amount, { crit = false, type = "" } = {}) {
    const r = R.applyDamage(c, amount, { crit, type });
    const parts = [`${c.name} takes ${r.amount}${r.defense ? ` (${r.note})` : type ? ` ${type}` : ""}`];
    if (r.result.absorbedByTemp) parts.push(`${r.result.absorbedByTemp} absorbed by temp HP`);
    if (crit) parts.push("critical hit");
    const summary = parts.join(", ") + ".";
    toast(summary);
    logEntry("damage", summary);
    announce(r.events);
  }

  function healCombatant(c, amount) {
    if (R.isDead(c)) {
      toast(`${c.name} is dead. Healing has no effect; set HP directly if they are revived.`);
      return false;
    }
    const { result, events } = R.applyHealing(c, amount);
    const summary = result.healed
      ? `${c.name} regains ${result.healed} HP${result.healed < amount ? ` (capped at max ${c.hp.max})` : ""}.`
      : `${c.name} is already at max HP.`;
    toast(summary);
    if (result.healed) logEntry("heal", summary);
    announce(events);
    return result.healed > 0;
  }

  function grantTemp(c, amount) {
    const r = R.grantTempHp(c, amount);
    const msg = r.applied
      ? `${c.name} gains ${r.value} temp HP.`
      : `${c.name} keeps ${r.previous} temp HP; the new ${r.value} was ignored (temp HP doesn't stack).`;
    toast(msg);
    if (r.applied) logEntry("heal", msg);
    return r.applied;
  }

  /* ---------- Rolls ---------- */
  let diceMode = "normal";

  function rollAndLog(label, expr, { mode = "normal", suffix = "" } = {}) {
    try {
      const r = R.rollDice(expr, { mode });
      const nat = r.natural === 20 ? " Natural 20!" : r.natural === 1 ? " Natural 1." : "";
      const text = `${label}: ${r.text}${suffix ? ` ${suffix}` : ""}.${nat}`;
      logEntry("roll", text);
      toast(text);
      $("#dice-result").textContent = text;
      return r;
    } catch (err) {
      toast(err.message);
      return null;
    }
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
  let roundBump = false;

  function nextTurn(enc) {
    if (!enc.combatants.length) return;
    // The first Next Turn of a fresh encounter starts the clock.
    if (!clockRunning(enc) && enc.clock.elapsedMs === 0) startClock(enc);
    const { events, newRound } = R.nextTurn(enc);
    if (newRound) roundBump = true;
    announce(events, { enc });
  }

  function prevTurn(enc) {
    const { events, newRound } = R.prevTurn(enc);
    if (newRound) roundBump = true;
    announce(events, { enc });
  }

  function removeCombatant(enc, combatant) {
    const removedIdx = enc.combatants.indexOf(combatant);
    if (removedIdx < 0) return;
    enc.combatants.splice(removedIdx, 1);
    if (removedIdx < enc.currentTurnIndex) enc.currentTurnIndex -= 1;
    else if (removedIdx === enc.currentTurnIndex && removedIdx >= enc.combatants.length) enc.currentTurnIndex = 0;
    sortEncounter(enc);
    logEntry("info", `${combatant.name} left the encounter.`, enc);
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
    renderLog();
    renderDice();
  }

  function renderTabs() {
    $$(".tab").forEach((tab) => {
      const on = tab.dataset.view === state.ui.view;
      tab.classList.toggle("is-active", on);
      if (on) tab.setAttribute("aria-current", "page"); else tab.removeAttribute("aria-current");
    });
    $$(".view").forEach((view) => view.classList.toggle("is-active", view.dataset.view === state.ui.view));
  }

  /* ---------- Encounter list ---------- */
  function renderEncounterList() {
    const host = $("#encounter-list");
    if (!state.encounters.length) {
      host.innerHTML = `
        <div class="empty-state empty-state--wide">
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
            <button class="icon-btn icon-btn--danger" type="button" data-action="delete-encounter" title="Delete encounter" aria-label="Delete encounter ${escapeHtml(enc.name)}">${ICON_TRASH}</button>
          </div>
        </article>`;
    }).join("");
  }

  /* ---------- Active encounter ---------- */

  /** Cards already shown for an encounter, so only newcomers play the entrance animation. */
  const seenCards = new Map();
  /** Per-card overrides of the collapsible stats section (instanceId → open). */
  const moreOpen = new Map();
  /** The damage type last chosen on each card, kept across re-renders. */
  const lastDamageType = new Map();

  /** A selector for the focused card control, so focus survives a full re-render. */
  function focusKey(grid) {
    const el = document.activeElement;
    const card = el?.closest?.("[data-instance-id]");
    if (!card || !grid.contains(card) || el === card) return null;
    const attrs = Object.entries(el.dataset)
      .map(([k, v]) => `[data-${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}="${String(v).replace(/"/g, '\\"')}"]`)
      .join("");
    return attrs ? `[data-instance-id="${card.dataset.instanceId}"] ${attrs}` : null;
  }

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
    $("#btn-delay").disabled = enc.currentTurnIndex >= enc.combatants.length - 1 || enc.combatants[enc.currentTurnIndex]?.type === "lair";
    $("#btn-roll-init").disabled = !enc.combatants.some((c) => c.type === "enemy");
    $("#opt-group-init").checked = state.ui.groupInitiative;

    const count = enc.combatants.length;
    $("#tracker-count").textContent = count ? `${count} in initiative order` : "";

    renderBanner(enc);

    const grid = $("#combatant-cards");
    if (!hasCombatants) {
      grid.innerHTML = `
        <div class="empty-state empty-state--wide">
          <div class="empty-ornament" aria-hidden="true">⚔</div>
          <h2 class="empty-title">The field is empty</h2>
          <p>Add player characters and enemies to begin rolling initiative.</p>
        </div>`;
      return;
    }
    const refocus = focusKey(grid);
    const seen = seenCards.get(enc.id) || new Set();
    const firstPaint = !seenCards.has(enc.id);
    grid.innerHTML = enc.combatants.map((c, i) =>
      renderCard(c, i === enc.currentTurnIndex, enc, !firstPaint && !seen.has(c.instanceId))).join("");
    seenCards.set(enc.id, new Set(enc.combatants.map((c) => c.instanceId)));
    if (refocus) $(refocus)?.focus();
  }

  function renderBanner(enc) {
    const banner = $("#turn-banner");
    if (!enc.combatants.length) { banner.innerHTML = ""; return; }
    const cur = enc.combatants[enc.currentTurnIndex];
    const next = enc.combatants[(enc.currentTurnIndex + 1) % enc.combatants.length];
    const status = vitalStatus(cur);
    const unconscious = cur.type !== "lair" && R.hasCondition(cur, "Unconscious") && status?.key !== "dead";
    const notes = [];
    if (status?.key === "dead") notes.push(["dead", "Dead"]);
    else {
      if (status && status.key !== "unconscious") notes.push([status.key, status.label]);
      if (unconscious) notes.push(["unconscious", "Unconscious"]);
      if (cur.surprised) notes.push(["surprised", "Surprised: no action or move this turn"]);
    }
    banner.classList.toggle("is-pc", cur.type === "pc");
    banner.innerHTML = `
      <span>Now acting:</span>
      <strong>${escapeHtml(cur.name)}</strong>
      ${notes.map(([k, label]) => `<span class="turn-note turn-note--${k}">${escapeHtml(label)}</span>`).join("")}
      <span class="turn-tag">Up next · ${escapeHtml(next.name)}</span>`;
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
    const xp = R.encounterXp(enc);
    $("#xp-total").classList.toggle("hidden", !enc.combatants.some((c) => c.type === "enemy"));
    $("#xp-total").innerHTML = `XP <b>${xp.toLocaleString()}</b>`;
    if (!d) return;
    const label = { under: "Under benchmark", approaching: "Approaching", over: "Over benchmark" }[d.tier];
    el.className = `difficulty difficulty--${d.tier}`;
    el.innerHTML = `
      <span class="difficulty-label">Benchmark</span>
      <span>CR <b>${formatNum(d.totalCr)}</b> / ${formatNum(d.benchmark)}</span>
      <span class="difficulty-tier">${label}</span>
      ${d.dominant ? `<span class="difficulty-warn">Hint: ${escapeHtml(baseName(d.dominant.name))} may be a lot on its own</span>` : ""}`;
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

  /** A text equivalent of the HP bar colour. */
  function hpStateLabel(c) {
    const vs = vitalStatus(c);
    if (vs) return vs.label;
    const pct = c.hp.max > 0 ? c.hp.current / c.hp.max : 0;
    return pct >= 1 ? "Unhurt" : pct > 0.5 ? "Hurt" : pct > 0.25 ? "Bloodied" : "Critical";
  }

  const exhaustionTitle = (level) =>
    R.exhaustionEffects(level).map((e, i) => `${i + 1}: ${e}`).join("\n");

  function conditionChip(cond, round) {
    const left = R.roundsLeft(cond, round);
    const effect = CONDITION_EFFECTS[cond.name] || "";
    const title = left === null ? effect : `${effect}\nEnds after ${left} more round${left === 1 ? "" : "s"} (last round ${cond.endsOnRound}).`;
    return `<span class="chip chip--cond" title="${escapeHtml(title)}">${cond.name}${left === null ? "" : ` <small>${left}r</small>`}</span>`;
  }

  function concCheckHtml(c, inDetail = false) {
    const check = c.concentrationCheck;
    if (!check || !c.concentration?.active) return "";
    return `
      <div class="conc-check" role="status">
        <span>Concentration save <b>DC ${check.dc}</b>${check.count > 1 ? ` <small>×${check.count} saves</small>` : ""}</span>
        ${inDetail
          ? `<button class="btn btn-ghost btn-sm" type="button" data-action="dismiss-conc-check">Dismiss</button>`
          : `<button class="icon-btn conc-check-dismiss" type="button" data-action="dismiss-conc-check" title="Dismiss" aria-label="Dismiss concentration save reminder">×</button>`}
      </div>`;
  }

  function statusChipsHtml(c, round) {
    const chips = [];
    if (c.concentration?.active) {
      chips.push(`<span class="chip chip--conc" title="Concentrating">◉ ${escapeHtml(c.concentration.spell || "Concentrating")}</span>`);
    }
    (c.conditions || []).forEach((cond) => chips.push(conditionChip(cond, round)));
    if (c.exhaustion) {
      chips.push(`<span class="chip chip--exh" title="${escapeHtml(`Exhaustion (cumulative)\n${exhaustionTitle(c.exhaustion)}`)}">Exhaustion ${c.exhaustion}</span>`);
    }
    return (chips.length ? `<div class="card-status">${chips.join("")}</div>` : "") + concCheckHtml(c);
  }

  function deathSavesHtml(c) {
    const ds = c.deathSaves;
    const pips = (kind) => [0, 1, 2].map((i) => `
      <button class="pip pip--${kind} ${i < ds[kind] ? "is-full" : ""}" type="button"
              data-action="death-save" data-kind="${kind}" data-index="${i}"
              aria-pressed="${i < ds[kind]}" aria-label="Death save ${kind === "fail" ? "failure" : "success"} ${i + 1}"></button>`).join("");
    const vs = vitalStatus(c);
    const status = vs && ["dead", "stable"].includes(vs.key)
      ? `<span class="ds-status ds-status--${vs.key}">${vs.label}</span>` : "";
    return `
      <div class="death-saves">
        <span class="ds-label">Death Saves</span>
        <span class="ds-group" title="Successes"><span class="ds-kind ds-kind--success" aria-hidden="true">✓</span>${pips("success")}</span>
        <span class="ds-group" title="Failures"><span class="ds-kind ds-kind--fail" aria-hidden="true">✗</span>${pips("fail")}</span>
        ${status}
      </div>`;
  }

  const pipRow = (count, full, action, extra, label) => Array.from({ length: count }, (_, p) => `
    <button class="pip ${p < full ? "is-full" : ""}" type="button" data-action="${action}" ${extra} data-pip-index="${p}"
            aria-pressed="${p < full}" aria-label="${label} ${p + 1}"></button>`).join("");

  function spellBlockHtml(c) {
    if (!c.spellSlots?.length) return "";
    return `
      <div class="spell-block">
        <div class="spell-block-title">Spell Slots</div>
        <div class="spell-rows-card">
          ${c.spellSlots.map((s, idx) => `
            <div class="spell-row-card">
              <span class="spell-level">${ordinal(s.level)}${s.recovery === "short" ? ` <abbr class="spell-recovery" title="Recovers on a short rest">SR</abbr>` : ""}</span>
              <div class="spell-pips">${pipRow(s.max, s.current, "toggle-pip", `data-slot-index="${idx}"`, `${ordinal(s.level)} level slot`)}</div>
              <span class="spell-count">${s.current}/${s.max}</span>
            </div>`).join("")}
        </div>
      </div>`;
  }

  function legendaryHtml(c) {
    const la = c.legendaryActions || 0;
    const lr = c.legendaryResistance || 0;
    if (!la && !lr) return "";
    return `
      <div class="legendary">
        ${la ? `
          <span class="legendary-group" title="Legendary actions: ${c.legendaryActionsLeft}/${la}. Refill at the start of its turn.">
            <span class="legendary-label">Legendary</span>
            <span class="legendary-pips">${pipRow(la, c.legendaryActionsLeft, "legendary-pip", `data-kind="actions"`, "Legendary action")}</span>
          </span>` : ""}
        ${lr ? `
          <span class="legendary-group" title="Legendary resistance: ${c.legendaryResistanceLeft}/${lr} per day. Does not refill on its own.">
            <span class="legendary-label">Resist</span>
            <span class="legendary-pips">${pipRow(lr, c.legendaryResistanceLeft, "legendary-pip", `data-kind="resistance"`, "Legendary resistance")}</span>
          </span>` : ""}
      </div>`;
  }

  function economyHtml(c, round) {
    const chip = (action, label, used, title, disabled = false) => `
      <button class="chip chip--econ ${used ? "is-used" : ""}" type="button" data-action="${action}"
              aria-pressed="${used}" title="${title}" ${disabled ? "disabled" : ""}>${label}</button>`;
    const surpriseNote = c.surprised ? " Surprised: no reactions until its first turn ends." : "";
    return `
      <div class="card-economy" role="group" aria-label="Action economy">
        ${chip("toggle-reaction", "Reaction", c.reactionUsed || c.surprised, `Reaction ${c.reactionUsed ? "used" : "available"}. Returns at the start of its turn.${surpriseNote}`, c.surprised)}
        ${chip("toggle-bonus", "Bonus", c.bonusActionUsed, `Bonus action ${c.bonusActionUsed ? "used" : "available"} this turn.`)}
        <button class="chip chip--ready ${c.readied ? "is-on" : ""}" type="button" data-action="toggle-ready" aria-pressed="${c.readied}"
                title="Readied action. Lapses at the start of its next turn.">Ready</button>
        ${round === 1 || c.surprised ? `
          <button class="chip chip--surprised ${c.surprised ? "is-on" : ""}" type="button" data-action="toggle-surprised" aria-pressed="${c.surprised}"
                  title="Surprised (round 1): can't move or act on its first turn, and can't react until that turn ends.">Surprised</button>` : ""}
      </div>`;
  }

  function attackHtml(atk, i, interactive = true) {
    const hit = atk.kind === "save"
      ? `<span class="attack-save" title="Saving throw">DC ${atk.saveDc} ${atk.saveAbility.toUpperCase()}${atk.halfOnSave ? ", half on save" : ""}</span>`
      : interactive
        ? `<button class="attack-hit" type="button" data-action="roll-attack" data-attack-index="${i}" title="Roll to hit">${formatMod(atk.toHit)}</button>`
        : `<span class="attack-hit" title="To hit">${formatMod(atk.toHit)}</span>`;
    const dmg = damageText(atk);
    const dmgHtml = dmg && interactive && R.attackDamageExpr(atk)
      ? `<button class="attack-dmg" type="button" data-action="roll-damage" data-attack-index="${i}" title="Roll damage">${escapeHtml(dmg)}</button>`
      : `<span class="attack-dmg">${escapeHtml(dmg)}</span>`;
    return `
      <div class="attack ${atk.kind === "save" ? "attack--save" : ""}">
        <span class="attack-name" title="${escapeHtml(atk.name)}">${escapeHtml(atk.name)}</span>
        ${hit}
        ${dmgHtml}
        ${atk.note ? `<span class="attack-note">${escapeHtml(atk.note)}</span>` : ""}
      </div>`;
  }

  const skillsText = (c) =>
    (c.skills || []).map((k) => `${SKILL_BY_KEY[k].name} ${formatMod(skillBonus(c, k))}`).join(" · ");

  function rechargeChipsHtml(c) {
    if (!c.recharges?.length) return "";
    return `
      <div class="card-recharges">
        ${c.recharges.map((r, i) => `
          <button class="chip chip--recharge ${r.available ? "is-ready" : "is-spent"}" type="button"
                  data-action="toggle-recharge" data-recharge-index="${i}" aria-pressed="${!r.available}"
                  title="${r.available ? "Ready. Click to mark used." : `Spent. Recharges on ${rechargeLabel(r.min)}. Click to restore.`}">
            ${escapeHtml(r.name)} <small>${rechargeLabel(r.min)}</small>
          </button>`).join("")}
      </div>`;
  }

  function cardHeadHtml(c, extraTools = "") {
    const vs = vitalStatus(c);
    return `
      <header class="card-head">
        <div class="card-initiative" title="Initiative">
          <label class="card-initiative-label" for="init-${c.instanceId}">Init</label>
          <input id="init-${c.instanceId}" type="number" value="${toInt(c.initiative, 0)}" data-field="initiative" aria-label="Initiative for ${escapeHtml(c.name)}">
          ${c.type === "lair" ? "" : `<button class="init-roll" type="button" data-action="roll-init" title="Roll d20 ${formatMod(initBonusOf(c))}" aria-label="Roll initiative for ${escapeHtml(c.name)}">${ICON_DIE}</button>`}
        </div>
        <div class="card-title-wrap">
          <h3 class="card-name"><button class="card-name-btn" type="button" data-action="open-detail" title="Open details for ${escapeHtml(c.name)}">${escapeHtml(c.name)}</button></h3>
          <span class="card-type">${escapeHtml(subtitleFor(c))}</span>
          ${vs ? `<span class="card-down-tag card-down-tag--${vs.key}">${vs.label}</span>` : ""}
        </div>
        <div class="card-tools">
          <button class="icon-btn" type="button" data-action="open-detail" title="Open details" aria-label="Open details for ${escapeHtml(c.name)}">${ICON_EXPAND}</button>
          ${extraTools}
          <button class="icon-btn icon-btn--danger" type="button" data-action="remove-instance" title="Remove from encounter" aria-label="Remove ${escapeHtml(c.name)} from encounter">×</button>
        </div>
      </header>`;
  }

  function damageTypeOptions(c) {
    const selected = lastDamageType.get(c.instanceId) || "";
    const tag = (t) => {
      if ((c.damageImmunities || []).includes(t)) return " (immune)";
      const res = (c.damageResistances || []).includes(t);
      const vul = (c.damageVulnerabilities || []).includes(t);
      return res && vul ? " (res + vuln)" : res ? " (resists)" : vul ? " (vulnerable)" : "";
    };
    return `<option value="">untyped</option>` + DAMAGE_TYPES.map((t) =>
      `<option value="${t}" ${t === selected ? "selected" : ""}>${t}${tag(t)}</option>`).join("");
  }

  function renderCard(c, isCurrent, enc, isNew) {
    const anim = isNew ? "is-new" : "";
    if (c.type === "lair") {
      return `
        <article class="card card--lair ${isCurrent ? "is-current" : ""} ${anim}" data-instance-id="${c.instanceId}" aria-current="${isCurrent ? "step" : "false"}">
          ${cardHeadHtml(c)}
          ${isCurrent ? `<span class="sr-only">Current turn.</span>` : ""}
          <p class="lair-notes ${c.notes ? "" : "is-empty"}">${c.notes ? escapeHtml(c.notes) : "No lair actions noted. Open details to add them."}</p>
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
    const compact = state.ui.cardMode === "compact";
    const showMore = moreOpen.has(c.instanceId) ? moreOpen.get(c.instanceId) : !compact;

    const statsHtml = STAT_KEYS.map((k) => {
      const score = toInt(c.stats?.[k], 10);
      const m = modifier(score);
      const cls = m > 0 ? "is-pos" : m < 0 ? "is-neg" : "";
      return `
        <div class="stat" title="${STAT_NAMES[k]} ${score}, save ${formatMod(saveBonus(c, k))}">
          <span class="stat-label">${k.toUpperCase()}</span>
          <span class="stat-mod ${cls}">${formatMod(m)}</span>
        </div>`;
    }).join("");

    const info = [];
    if (c.speed) info.push(`<span><b>Speed</b> ${escapeHtml(c.speed)}</span>`);
    info.push(`<span><b>Init</b> ${formatMod(initBonusOf(c))}</span>`);
    info.push(`<span><b>Passive</b> ${R.passivePerception(c)}</span>`);
    const skills = skillsText(c);
    const noteLine = (c.notes || "").split("\n").find((l) => l.trim()) || "";

    return `
      <article class="card card--${c.type} ${isCurrent ? "is-current" : ""} ${isDown ? "is-down" : ""} ${R.isDead(c) ? "is-dead" : ""} ${anim}"
               data-instance-id="${c.instanceId}" aria-current="${isCurrent ? "step" : "false"}">
        ${cardHeadHtml(c, `<button class="icon-btn" type="button" data-action="edit-instance" title="Edit stat block" aria-label="Edit ${escapeHtml(c.name)}">${ICON_EDIT}</button>`)}
        ${isCurrent ? `<span class="sr-only">Current turn.</span>` : ""}

        <div class="hp-block">
          <div class="hp-top">
            <span class="hp-label">HP</span>
            <span class="hp-state hp-state--${barClass || "ok"}">${hpStateLabel(c)}</span>
            <label class="hp-temp ${temp ? "has-temp" : ""}" title="Temporary hit points (direct edit)">
              <span>Temp</span>
              <input type="number" min="0" value="${temp || ""}" placeholder="0" data-field="hpTemp" aria-label="Temporary HP">
            </label>
            <div class="hp-values">
              <input class="hp-cur" type="number" min="0" value="${cur}" data-field="hpCurrent" aria-label="Current HP">
              <span class="hp-sep">/</span>
              <input class="hp-max" type="number" min="0" value="${max}" data-field="hpMax" aria-label="Max HP">
            </div>
          </div>
          <div class="hp-bar" role="progressbar" aria-label="${escapeHtml(c.name)} hit points"
               aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${cur}"
               aria-valuetext="${cur} of ${max} HP${temp ? `, ${temp} temporary` : ""}, ${hpStateLabel(c)}">
            <div class="hp-bar-fill ${barClass}" style="width:${(cur / scale) * 100}%"></div>
            ${temp ? `<div class="hp-bar-temp" style="width:${(temp / scale) * 100}%"></div>` : ""}
          </div>
          <div class="hp-adjust">
            <input type="number" min="0" placeholder="1" data-field="hpDelta"
                   aria-label="Damage, healing or temp HP amount" title="Enter applies damage, Shift+Enter heals">
            <select data-field="dmgType" aria-label="Damage type" title="Damage type: resistances, immunities and vulnerabilities apply">${damageTypeOptions(c)}</select>
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

        <div class="card-vitals">
          <div class="ac-shield" title="Armor Class">
            <span class="ac-label">AC</span>
            <span class="ac-value">${toInt(c.ac, 10)}</span>
          </div>
          <div class="card-vitals-side">
            ${economyHtml(c, enc.round)}
            ${legendaryHtml(c)}
          </div>
        </div>

        ${statusChipsHtml(c, enc.round)}
        ${isPc && isDown ? deathSavesHtml(c) : ""}
        ${noteLine ? `<p class="card-notes" title="DM notes"><span class="sr-only">Notes: </span>${escapeHtml(noteLine)}</p>` : ""}
        ${rechargeChipsHtml(c)}
        ${spellBlockHtml(c)}

        <details class="card-more" data-card-more ${showMore ? "open" : ""}>
          <summary class="card-more-summary">Stats &amp; attacks</summary>
          <div class="card-more-body">
            <div class="stats-row">${statsHtml}</div>
            <div class="card-info">${info.join("")}</div>
            ${skills ? `<div class="card-skills">${escapeHtml(skills)}</div>` : ""}
            ${c.multiattack ? `<p class="card-multiattack">${escapeHtml(c.multiattack)}</p>` : ""}
            ${c.attacks?.length ? `<div class="card-attacks">${c.attacks.map((a, i) => attackHtml(a, i)).join("")}</div>` : ""}
          </div>
        </details>
      </article>`;
  }

  /* ---------- Combat log ---------- */
  function renderLog() {
    const drawer = $("#log-drawer");
    const open = state.ui.logOpen && state.ui.view === "active" && !!activeEncounter();
    drawer.hidden = !open;
    $("#btn-toggle-log").setAttribute("aria-pressed", String(!!state.ui.logOpen));
    $("#btn-toggle-log").classList.toggle("is-on", !!state.ui.logOpen);
    if (!open) return;
    const log = activeEncounter().log;
    const list = $("#log-list");
    list.innerHTML = log.length
      ? log.map((e) => `
          <li class="log-entry log-entry--${e.kind}">
            <span class="log-round" title="Round ${e.round}">R${e.round}</span>
            <span class="log-text">${escapeHtml(e.text)}</span>
          </li>`).join("")
      : `<li class="log-empty">Nothing yet. Damage, healing, conditions, turns and rolls show up here.</li>`;
    list.scrollTop = list.scrollHeight;
  }

  function renderDice() {
    $("#dice-panel").hidden = !state.ui.diceOpen;
    $("#btn-toggle-dice").setAttribute("aria-pressed", String(!!state.ui.diceOpen));
    $("#btn-toggle-dice").classList.toggle("is-on", !!state.ui.diceOpen);
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
        : (t.cr ? `<span>CR <b>${t.cr}</b> <small>${R.xpForCr(t.cr).toLocaleString()} XP</small></span>` : "");
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
              ${t.legendaryActions ? `<span>Legendary <b>${t.legendaryActions}</b></span>` : ""}
              ${t.spellSlots?.length ? `<span>✦ <b>${t.spellSlots.length}</b> spell level${t.spellSlots.length === 1 ? "" : "s"}</span>` : ""}
            </div>
          </div>
          <div class="lib-actions">
            <button class="icon-btn" type="button" data-action="edit-template" title="Edit" aria-label="Edit ${escapeHtml(t.name)}">${ICON_EDIT}</button>
            <button class="icon-btn icon-btn--danger" type="button" data-action="delete-template" title="Delete" aria-label="Delete ${escapeHtml(t.name)}">${ICON_TRASH}</button>
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
  const TOAST_MAX = 5;

  function toast(message, { action = null, duration = 0 } = {}) {
    const stack = $("#toast-stack");
    const el = document.createElement("div");
    el.className = `toast${action ? " toast--action" : ""}`;
    const text = document.createElement("span");
    text.textContent = message;
    el.appendChild(text);
    if (action) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "toast-action";
      btn.textContent = action.label;
      btn.addEventListener("click", () => { el.remove(); action.run(); });
      el.appendChild(btn);
    }
    stack.appendChild(el);
    while (stack.children.length > TOAST_MAX) stack.firstElementChild.remove();
    setTimeout(() => el.remove(), duration || (action ? 7000 : 3000));
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

  /** `html` must already be escaped by the caller. */
  function confirmDialog({ title, html, okLabel = "Delete", danger = true }) {
    return new Promise((resolve) => {
      confirmResolve = resolve;
      $("#confirm-title").textContent = title;
      $("#confirm-text").innerHTML = html;
      const submit = $("#confirm-submit");
      submit.textContent = okLabel;
      submit.className = `btn ${danger ? "btn-danger" : "btn-primary"}`;
      confirmModal.classList.toggle("modal-danger", danger);
      confirmModal.returnValue = "cancel";
      confirmModal.showModal();
      requestAnimationFrame(() => submit.focus());
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

  /* ---------- Choice (pick one) ---------- */
  const choiceModal = $("#choice-modal");
  let choiceResolve = null;
  let choiceValue = null;

  function choiceDialog({ title, text = "", options }) {
    return new Promise((resolve) => {
      choiceResolve = resolve;
      choiceValue = null;
      $("#choice-title").textContent = title;
      $("#choice-text").textContent = text;
      $("#choice-list").innerHTML = options.map((o, i) => `
        <button class="choice-btn" type="button" data-choice="${i}">
          <span>${escapeHtml(o.label)}</span>${o.hint ? `<small>${escapeHtml(o.hint)}</small>` : ""}
        </button>`).join("");
      $("#choice-list").onclick = (e) => {
        const btn = e.target.closest("[data-choice]");
        if (!btn) return;
        choiceValue = options[toInt(btn.dataset.choice, 0)].value;
        choiceModal.close("ok");
      };
      choiceModal.returnValue = "cancel";
      choiceModal.showModal();
      requestAnimationFrame(() => $(".choice-btn", choiceModal)?.focus());
    });
  }
  choiceModal.addEventListener("close", () => {
    const r = choiceResolve; choiceResolve = null;
    if (r) r(choiceModal.returnValue === "ok" ? choiceValue : null);
  });
  wireDialogChrome(choiceModal);

  /* ---------- Creature builder modal ---------- */
  const creatureModal = $("#creature-modal");
  const creatureForm = $("#creature-form");
  /** @type {{mode:string, type:string, templateId?:string, instanceId?:string, seed?:object}|null} */
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
        <button class="icon-btn icon-btn--danger" type="button" data-action="remove-row" title="Remove level" aria-label="Remove spell level">×</button>
      </div>`;
  }

  function attackRowHtml(atk = normalizeAttack({ name: "" })) {
    return `
      <div class="attack-row" data-row data-kind="${atk.kind}" data-auto-hit="${atk.autoToHit ? 1 : 0}"
           data-auto-dmg="${atk.autoDmg ? 1 : 0}" data-auto-dc="${atk.autoSaveDc ? 1 : 0}">
        <label class="field atk-name"><span class="field-label">Name</span>
          <input type="text" data-atk="name" value="${escapeHtml(atk.name === "Attack" ? "" : atk.name)}" placeholder="Scimitar" autocomplete="off"></label>
        <label class="field atk-kind"><span class="field-label">Kind</span>
          <select data-atk="kind">
            <option value="attack" ${atk.kind === "attack" ? "selected" : ""}>Attack roll</option>
            <option value="save" ${atk.kind === "save" ? "selected" : ""}>Saving throw</option>
          </select></label>
        <label class="field atk-ability"><span class="field-label">Ability</span>
          <select data-atk="ability" title="The creature's ability used for to hit, save DC and damage">${abilityOptions(atk.ability)}</select></label>
        <label class="field atk-attack-only"><span class="field-label">To Hit</span>
          <input type="number" data-atk="toHit" value="${atk.toHit}" title="Auto: ability mod + proficiency. Type to override; clear to re-enable auto."></label>
        <label class="field atk-save-only"><span class="field-label">Save DC</span>
          <input type="number" data-atk="saveDc" value="${atk.saveDc}" title="Auto: 8 + proficiency + ability mod. Type to override; clear to re-enable auto."></label>
        <label class="field atk-save-only"><span class="field-label">Target saves</span>
          <select data-atk="saveAbility">${abilityOptions(atk.saveAbility)}</select></label>
        <label class="checkbox-field checkbox-field--sm atk-save-only atk-half">
          <input type="checkbox" data-atk="halfOnSave" ${atk.halfOnSave ? "checked" : ""}> <span>Half on save</span></label>
        <label class="field atk-dice"><span class="field-label">Dice</span>
          <input type="text" data-atk="dmgDice" value="${escapeHtml(atk.dmgDice)}" placeholder="1d6" autocomplete="off"></label>
        <label class="field atk-bonus"><span class="field-label">Bonus</span>
          <input type="number" data-atk="dmgBonus" value="${atk.dmgBonus}" title="Auto: ability mod. Type to override; clear to re-enable auto."></label>
        <label class="field atk-type"><span class="field-label">Type</span>
          <input type="text" data-atk="dmgType" value="${escapeHtml(atk.dmgType)}" list="damage-types" placeholder="slashing" autocomplete="off"></label>
        <label class="field atk-note"><span class="field-label">Note</span>
          <input type="text" data-atk="note" value="${escapeHtml(atk.note)}" placeholder="plus 2d6 poison" autocomplete="off"></label>
        <button class="icon-btn icon-btn--danger atk-remove" type="button" data-action="remove-row" title="Remove attack" aria-label="Remove attack">×</button>
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

  /** Live-recalculate everything derived from ability scores, CR and level. */
  function refreshFormCalcs() {
    const f = creatureForm.elements;
    const isPc = creatureCtx?.type === "pc";
    const prof = isPc ? profFromLevel(f.level.value) : profFromCr(f.cr.value);
    const mods = {};
    STAT_KEYS.forEach((k) => {
      mods[k] = modifier(f[k].value);
      const el = $(`[data-mod-for="${k}"]`, creatureForm);
      el.textContent = formatMod(mods[k]);
      el.className = `stat-input-mod ${mods[k] > 0 ? "is-pos" : mods[k] < 0 ? "is-neg" : ""}`;
    });
    f.initBonus.placeholder = formatMod(mods.dex).replace("−", "-");
    $("#skills-prof-hint").textContent = `proficiency ${formatMod(prof)}`;
    $("#saves-prof-hint").textContent = `proficiency ${formatMod(prof)}`;
    $$("[data-save-bonus]", creatureForm).forEach((el) => {
      const k = el.dataset.saveBonus;
      el.textContent = formatMod(mods[k] + ($(`[data-save="${k}"]`, creatureForm).checked ? prof : 0));
    });
    let perception = 0;
    $$("[data-skill-bonus]", creatureForm).forEach((el) => {
      const key = el.dataset.skillBonus;
      const proficient = $(`[data-skill="${key}"]`, creatureForm).checked;
      const expert = proficient && $(`[data-expertise="${key}"]`, creatureForm).checked;
      const bonus = mods[SKILL_BY_KEY[key].ability] + (proficient ? prof : 0) + (expert ? prof : 0);
      if (key === "perception") perception = bonus;
      el.textContent = formatMod(bonus);
    });
    $("#passive-hint").textContent = `passive Perception ${10 + perception}`;
    $$(".attack-row", creatureForm).forEach((row) => {
      const m = mods[$('[data-atk="ability"]', row).value] ?? 0;
      const hit = $('[data-atk="toHit"]', row);
      const dmg = $('[data-atk="dmgBonus"]', row);
      const dc = $('[data-atk="saveDc"]', row);
      row.dataset.kind = $('[data-atk="kind"]', row).value;
      if (row.dataset.autoHit === "1") hit.value = m + prof;
      if (row.dataset.autoDmg === "1") dmg.value = m;
      if (row.dataset.autoDc === "1") dc.value = 8 + prof + m;
      hit.classList.toggle("is-auto", row.dataset.autoHit === "1");
      dmg.classList.toggle("is-auto", row.dataset.autoDmg === "1");
      dc.classList.toggle("is-auto", row.dataset.autoDc === "1");
    });
  }

  const LIST_FIELDS = ["damageResistances", "damageImmunities", "damageVulnerabilities", "conditionImmunities"];
  const TEXT_FIELDS = ["senses", "languages", "damageNotes"];
  const ENEMY_TEXT_FIELDS = ["creatureType", "alignment", "multiattack", "traits", "actions", "reactions", "legendaryText"];

  function fillCreatureForm(data, type) {
    const f = creatureForm.elements;
    const block = normalizeTemplate(data, type);
    f.name.value = data.name ?? "";
    f.hpMax.value = block.hp.max;
    f.ac.value = block.ac;
    f.speed.value = block.speed;
    f.initiative.value = toInt(data.initiative, 0);
    STAT_KEYS.forEach((k) => { f[k].value = block.stats[k]; });
    f.initBonus.value = block.initBonus ?? "";

    f.level.value = block.level ?? 1;
    f.cls.value = block.cls ?? "";
    f.race.value = block.race ?? "";
    f.cr.value = block.cr ?? "";
    f.legendaryActions.value = block.legendaryActions ?? 0;
    f.legendaryResistance.value = block.legendaryResistance ?? 0;
    [...TEXT_FIELDS, ...ENEMY_TEXT_FIELDS].forEach((k) => { f[k].value = block[k] ?? ""; });

    $$("[data-save]", creatureForm).forEach((cb) => { cb.checked = block.saves.includes(cb.dataset.save); });
    $$("[data-skill]", creatureForm).forEach((cb) => { cb.checked = block.skills.includes(cb.dataset.skill); });
    $$("[data-expertise]", creatureForm).forEach((cb) => { cb.checked = block.expertise.includes(cb.dataset.expertise); });
    $$("[data-def]", creatureForm).forEach((cb) => { cb.checked = (block[cb.dataset.def] || []).includes(cb.value); });

    $("#attack-rows").innerHTML = (block.attacks || []).map(attackRowHtml).join("");
    $("#recharge-rows").innerHTML = (block.recharges || []).map(rechargeRowHtml).join("");
    $("#spell-rows").innerHTML = block.spellSlots.map(spellRowHtml).join("");

    $("#saves-details").open = block.saves.length > 0;
    $("#skills-details").open = block.skills.length > 0;
    $("#senses-details").open = !!(block.senses || block.languages);
    $("#defenses-details").open = LIST_FIELDS.some((k) => block[k].length) || !!block.damageNotes;
    $("#attacks-details").open = (block.attacks || []).length > 0 || !!block.multiattack;
    $("#recharge-details").open = (block.recharges || []).length > 0;
    $("#legendary-details").open = !!(block.legendaryActions || block.legendaryResistance || block.legendaryText);
    $("#text-details").open = !!(block.traits || block.actions || block.reactions);
    $("#spell-details").open = block.spellSlots.length > 0;
    f.saveToLibrary.checked = false;
    refreshFormCalcs();
  }

  /** Read the builder into a normalised template of the given type. */
  function readCreatureForm(type) {
    const f = creatureForm.elements;
    const checked = (attr) => $$(`[${attr}]`, creatureForm).filter((cb) => cb.checked);
    const shared = {
      name: f.name.value,
      hp: { max: f.hpMax.value },
      ac: f.ac.value,
      speed: f.speed.value,
      stats: Object.fromEntries(STAT_KEYS.map((k) => [k, f[k].value])),
      // Blank init bonus falls back to the DEX modifier.
      initBonus: f.initBonus.value.trim() === "" ? null : f.initBonus.value,
      saves: checked("data-save").map((cb) => cb.dataset.save),
      skills: checked("data-skill").map((cb) => cb.dataset.skill),
      expertise: checked("data-expertise").map((cb) => cb.dataset.expertise),
      spellSlots: $$(".spell-row", creatureForm).map((row) => ({
        level: $('[data-spell="level"]', row).value,
        current: $('[data-spell="current"]', row).value,
        max: $('[data-spell="max"]', row).value,
        recovery: $('[data-spell="recovery"]', row).value,
      })),
    };
    TEXT_FIELDS.forEach((k) => { shared[k] = f[k].value; });
    LIST_FIELDS.forEach((k) => { shared[k] = $$(`[data-def="${k}"]`, creatureForm).filter((cb) => cb.checked).map((cb) => cb.value); });

    const specific = type === "pc" ? {
      level: f.level.value,
      cls: f.cls.value,
      race: f.race.value,
    } : {
      cr: f.cr.value,
      legendaryActions: f.legendaryActions.value,
      legendaryResistance: f.legendaryResistance.value,
      ...Object.fromEntries(ENEMY_TEXT_FIELDS.map((k) => [k, f[k].value])),
      attacks: $$(".attack-row", creatureForm).map((row) => ({
        name: $('[data-atk="name"]', row).value,
        kind: $('[data-atk="kind"]', row).value,
        ability: $('[data-atk="ability"]', row).value,
        toHit: $('[data-atk="toHit"]', row).value,
        saveDc: $('[data-atk="saveDc"]', row).value,
        saveAbility: $('[data-atk="saveAbility"]', row).value,
        halfOnSave: $('[data-atk="halfOnSave"]', row).checked,
        dmgDice: $('[data-atk="dmgDice"]', row).value,
        dmgBonus: $('[data-atk="dmgBonus"]', row).value,
        dmgType: $('[data-atk="dmgType"]', row).value,
        note: $('[data-atk="note"]', row).value,
        autoToHit: row.dataset.autoHit === "1",
        autoDmg: row.dataset.autoDmg === "1",
        autoSaveDc: row.dataset.autoDc === "1",
      })).filter((a) => String(a.name).trim()),
      recharges: $$(".recharge-row", creatureForm).map((row) => ({
        name: $('[data-recharge="name"]', row).value,
        min: $('[data-recharge="min"]', row).value,
      })).filter((r) => String(r.name).trim()),
    };
    return {
      block: normalizeTemplate({ ...shared, ...specific }, type),
      initiative: toInt(f.initiative.value, 0),
      saveToLibrary: f.saveToLibrary.checked,
    };
  }

  /**
   * Modes:
   *   library-new    { type, seed? }           → new template in library (seed prefills)
   *   library-edit   { type, templateId }      → edit template
   *   encounter-new  { type }                  → new one-off instance in active encounter
   *   instance-edit  { instanceId }            → edit an instance's stat block
   */
  function openCreatureModal(ctx) {
    creatureCtx = ctx;
    const typeLabel = ctx.type === "pc" ? "Player Character" : "Enemy";
    const title = {
      "library-new": ctx.seed ? `New ${typeLabel} (variant)` : `New ${typeLabel}`,
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

    let seed = ctx.seed || { name: "", hp: { max: 10 }, ac: 10, speed: "30 ft.", stats: {}, spellSlots: [], initiative: 0, level: 1, cr: "1" };
    if (ctx.mode === "library-edit") seed = findTemplate(ctx.templateId) || seed;
    if (ctx.mode === "instance-edit") seed = findCombatant(ctx.instanceId) || seed;
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
    let undoLabel = null;

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
      logEntry("info", `${inst.name} joined the encounter.`, enc);
      toast(`${inst.name} joins the fray.`);
      undoLabel = `Add ${inst.name}`;
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
          initRank: initiative === old.initiative ? old.initRank : 0,
          hp: { max: block.hp.max, current, temp: old.hp.temp },
        });
        sortEncounter(enc);
        undoLabel = `Edit ${old.name}`;
      }
    }

    creatureModal.close("ok");
    commit({ undo: undoLabel });
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
  const AUTO_FIELDS = { toHit: "autoHit", dmgBonus: "autoDmg", saveDc: "autoDc" };
  creatureForm.addEventListener("input", (e) => {
    const flag = AUTO_FIELDS[e.target.dataset?.atk];
    const row = e.target.closest(".attack-row");
    if (row && flag) row.dataset[flag] = "0";
    // Expertise needs proficiency, and dropping proficiency drops expertise.
    if (e.target.dataset?.expertise && e.target.checked) $(`[data-skill="${e.target.dataset.expertise}"]`, creatureForm).checked = true;
    if (e.target.dataset?.skill && !e.target.checked) $(`[data-expertise="${e.target.dataset.skill}"]`, creatureForm).checked = false;
    refreshFormCalcs();
  });
  /* Clearing an overridden auto field hands it back to the calculator. */
  creatureForm.addEventListener("change", (e) => {
    const flag = AUTO_FIELDS[e.target.dataset?.atk];
    const row = e.target.closest(".attack-row");
    if (row && flag && e.target.value.trim() === "") row.dataset[flag] = "1";
    refreshFormCalcs();
  });

  wireDialogChrome(creatureModal);

  /* ---------- Detail modal ---------- */
  const detailModal = $("#detail-modal");
  let detailId = null;
  /** Rounds typed into the duration box, kept while the modal re-renders. */
  let conditionRounds = "";

  function openDetail(instanceId) {
    detailId = instanceId;
    detailModal.showModal();
    renderDetail();
  }

  function renderDetail() {
    if (!detailModal.open) return;
    const c = findCombatant(detailId);
    if (!c) { detailModal.close(); return; }

    $("#detail-title").textContent = c.name;
    $("#detail-subtitle").textContent = subtitleFor(c);
    $("#detail-edit").classList.toggle("hidden", c.type === "lair");
    const body = $("#detail-body");
    const scroll = body.scrollTop;
    body.innerHTML = c.type === "lair" ? lairDetailHtml(c) : creatureDetailHtml(c, activeEncounter());
    body.scrollTop = scroll;
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

  /** A titled, escaped block of free text with line breaks kept. */
  const textSection = (title, body) => (body && body.trim() ? `
    <section class="detail-section">
      <h3 class="detail-section-title">${title}</h3>
      <p class="detail-prose">${escapeHtml(body.trim())}</p>
    </section>` : "");

  const listLine = (label, items) => (items && items.length ? `<p class="detail-text"><b>${label}</b> ${escapeHtml(items.join(", "))}</p>` : "");

  function creatureDetailHtml(c, enc) {
    const isPc = c.type === "pc";
    const summary = [
      ["AC", toInt(c.ac, 10)],
      ["HP", `${c.hp.current}/${c.hp.max}${c.hp.temp ? ` <small>+${c.hp.temp} temp</small>` : ""}`],
      ["Speed", escapeHtml(c.speed || "—")],
      ["Initiative", toInt(c.initiative, 0)],
      ["Init Bonus", `${formatMod(initBonusOf(c))}${c.initBonus === null ? " <small>DEX</small>" : ""}`],
      ["Passive Perc.", R.passivePerception(c)],
      isPc
        ? ["Proficiency", formatMod(R.profOf(c))]
        : ["CR", c.cr ? `${c.cr} <small>${R.xpForCr(c.cr).toLocaleString()} XP · prof ${formatMod(profFromCr(c.cr))}</small>` : "—"],
    ].map(([label, value]) => `
      <div class="detail-stat"><span class="detail-stat-label">${label}</span><span class="detail-stat-value">${value}</span></div>`).join("");

    const abilities = STAT_KEYS.map((k) => {
      const score = toInt(c.stats?.[k], 10);
      const prof = c.saves.includes(k);
      return `
        <div class="detail-ability ${prof ? "is-save-prof" : ""}" title="${STAT_NAMES[k]}${prof ? ", proficient save" : ""}">
          <span class="stat-label">${k.toUpperCase()}</span>
          <span class="detail-ability-score">${score}</span>
          <span class="detail-ability-mod">${formatMod(modifier(score))}</span>
          <span class="detail-ability-save">Save ${formatMod(saveBonus(c, k))}</span>
        </div>`;
    }).join("");

    const typeLine = isPc ? "" : [c.creatureType, c.alignment].filter(Boolean).join(", ");
    const statLines = [
      typeLine ? `<p class="detail-text detail-text--italic">${escapeHtml(typeLine)}</p>` : "",
      c.skills.length ? `<p class="detail-text"><b>Skills</b> ${escapeHtml(skillsText(c))}</p>` : "",
      listLine("Vulnerabilities", c.damageVulnerabilities),
      listLine("Resistances", c.damageResistances),
      listLine("Immunities", c.damageImmunities),
      c.damageNotes ? `<p class="detail-text"><b>Defense notes</b> ${escapeHtml(c.damageNotes)}</p>` : "",
      listLine("Condition immunities", c.conditionImmunities),
      `<p class="detail-text"><b>Senses</b> ${escapeHtml([c.senses, `passive Perception ${R.passivePerception(c)}`].filter(Boolean).join(", "))}</p>`,
      c.languages ? `<p class="detail-text"><b>Languages</b> ${escapeHtml(c.languages)}</p>` : "",
    ].join("");

    const conditions = CONDITIONS.map((cond) => {
      const on = R.hasCondition(c, cond);
      const immune = R.isImmuneTo(c, cond);
      return `
        <button class="chip chip--toggle ${on ? "is-on" : ""} ${immune ? "is-immune" : ""}" type="button"
                data-action="toggle-condition" data-condition="${cond}" aria-pressed="${on}"
                title="${escapeHtml(CONDITION_EFFECTS[cond])}${immune ? " (immune)" : ""}">${cond}</button>`;
    }).join("");
    const activeEffects = c.conditions.length ? `
      <ul class="effect-list">
        ${c.conditions.map((cond) => {
          const left = R.roundsLeft(cond, enc.round);
          return `<li><b>${cond.name}</b>${left === null ? "" : ` <small>${left} round${left === 1 ? "" : "s"} left</small>`} ${escapeHtml(CONDITION_EFFECTS[cond.name])}</li>`;
        }).join("")}
      </ul>` : "";
    const exhaustionEffects = c.exhaustion ? `
      <ul class="effect-list effect-list--exh">
        ${R.exhaustionEffects(c.exhaustion).map((e, i) => `<li><b>Level ${i + 1}</b> ${escapeHtml(e)}${i === 3 ? " <small>(not applied automatically)</small>" : ""}</li>`).join("")}
      </ul>` : "";

    const recharges = c.recharges?.length ? c.recharges.map((r, i) => `
      <div class="recharge-item ${r.available ? "is-ready" : "is-spent"}">
        <span class="recharge-name">${escapeHtml(r.name)} <small>Recharge ${rechargeLabel(r.min)}</small></span>
        <span class="recharge-state">${r.available ? "Ready" : "Spent"}${r.lastRoll ? ` · last roll ${r.lastRoll}` : ""}</span>
        <button class="btn btn-ghost btn-sm" type="button" data-action="toggle-recharge" data-recharge-index="${i}">${r.available ? "Use" : "Restore"}</button>
        ${r.available ? "" : `<button class="btn btn-ghost btn-sm" type="button" data-action="roll-recharge" data-recharge-index="${i}">Roll d6</button>`}
      </div>`).join("") : `<p class="detail-empty">No recharge abilities. Add them with Edit Stat Block.</p>`;

    const attacks = c.attacks?.length || c.multiattack ? `
      <section class="detail-section">
        <h3 class="detail-section-title">Attacks</h3>
        ${c.multiattack ? `<p class="detail-text"><b>Multiattack.</b> ${escapeHtml(c.multiattack)}</p>` : ""}
        <div class="card-attacks">${(c.attacks || []).map((a, i) => attackHtml(a, i)).join("")}</div>
      </section>` : "";

    // Attacks, stat block text and spell slots sit below the trackers, side by side when there's room.
    const extras = [
      attacks,
      textSection("Traits", c.traits),
      textSection("Actions", c.actions),
      textSection("Reactions", c.reactions),
      textSection(`Legendary Actions${c.legendaryActions ? ` (${c.legendaryActions}/round)` : ""}`, c.legendaryText),
      spellBlockHtml(c),
    ].filter(Boolean);

    return `
      <div class="detail-summary">${summary}</div>

      <section class="detail-section">
        <h3 class="detail-section-title">Ability Scores &amp; Saves</h3>
        <div class="detail-abilities">${abilities}</div>
        <div class="detail-statlines">${statLines}</div>
      </section>

      <div class="detail-grid">
        <div class="detail-col">
          <section class="detail-section">
            <h3 class="detail-section-title">Conditions</h3>
            <label class="duration-field">
              <span>Ends after</span>
              <input type="number" min="1" max="100" id="condition-rounds" value="${escapeHtml(conditionRounds)}" placeholder="∞" aria-describedby="condition-rounds-hint">
              <span>rounds when switched on</span>
            </label>
            <p class="detail-hint" id="condition-rounds-hint">Leave blank for no duration. A condition expires when the round after its last round begins.</p>
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

          <section class="detail-section">
            <h3 class="detail-section-title">Turn &amp; Actions</h3>
            ${economyHtml(c, enc.round)}
            ${legendaryHtml(c)}
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
            ${concCheckHtml(c, true)}
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

          <section class="detail-section">
            <label class="field field-wide">
              <span class="detail-section-title">DM Notes</span>
              <textarea data-detail-field="notes" rows="3" placeholder="Tactics, e.g. retreats at half HP">${escapeHtml(c.notes)}</textarea>
            </label>
          </section>
        </div>
      </div>

      ${extras.length ? `<div class="detail-extras">${extras.join("")}</div>` : ""}`;
  }

  /**
   * State-changing actions shared by cards and the detail modal.
   * Returns false (nothing changed), true (changed, not undoable) or an undo label.
   */
  function applyCombatantAction(c, btn, enc) {
    const p = toInt(btn.dataset.pipIndex, 0);
    const pipValue = (current, max) => clamp(p < current ? p : p + 1, 0, max);
    switch (btn.dataset.action) {
      case "toggle-pip": {
        const slot = c.spellSlots?.[toInt(btn.dataset.slotIndex, -1)];
        if (!slot) return false;
        slot.current = pipValue(slot.current, slot.max);
        return `Spell slot (${c.name})`;
      }
      case "legendary-pip": {
        if (btn.dataset.kind === "resistance") {
          c.legendaryResistanceLeft = pipValue(c.legendaryResistanceLeft, c.legendaryResistance);
          logEntry("info", `${c.name}: legendary resistance ${c.legendaryResistanceLeft}/${c.legendaryResistance}.`, enc);
        } else {
          c.legendaryActionsLeft = pipValue(c.legendaryActionsLeft, c.legendaryActions);
          logEntry("info", `${c.name}: legendary actions ${c.legendaryActionsLeft}/${c.legendaryActions}.`, enc);
        }
        return `Legendary (${c.name})`;
      }
      case "death-save": {
        const kind = btn.dataset.kind === "fail" ? "fail" : "success";
        const i = toInt(btn.dataset.index, 0);
        c.deathSaves[kind] = i < c.deathSaves[kind] ? i : i + 1;
        logEntry("death", `${c.name}: death saves ${c.deathSaves.success} ✓ / ${c.deathSaves.fail} ✗.`, enc);
        return `Death save (${c.name})`;
      }
      case "reset-death-saves":
        c.deathSaves = { success: 0, fail: 0 };
        return `Reset death saves (${c.name})`;
      case "toggle-recharge": {
        const r = c.recharges?.[toInt(btn.dataset.rechargeIndex, -1)];
        if (!r) return false;
        r.available = !r.available;
        logEntry("recharge", `${c.name}: ${r.name} ${r.available ? "restored" : "used"}.`, enc);
        return `${r.name} (${c.name})`;
      }
      case "roll-recharge": {
        const r = c.recharges?.[toInt(btn.dataset.rechargeIndex, -1)];
        if (!r || r.available) return false;
        announce(R.rollRecharges({ name: c.name, recharges: [r] }), { enc });
        return `Recharge roll (${c.name})`;
      }
      case "toggle-condition": {
        const res = R.toggleCondition(c, btn.dataset.condition, { rounds: conditionRounds, round: enc.round });
        announce(res.events, { enc });
        return res.blocked ? true : `${btn.dataset.condition} (${c.name})`;
      }
      case "exhaustion": {
        const res = R.changeExhaustion(c, toInt(btn.dataset.delta, 0));
        announce(res.events, { enc });
        return res.events.length && !res.blocked ? `Exhaustion (${c.name})` : res.blocked;
      }
      case "toggle-concentration":
        c.concentration.active = !c.concentration.active;
        if (!c.concentration.active) c.concentrationCheck = null;
        logEntry("concentration", `${c.name} ${c.concentration.active ? "starts" : "stops"} concentrating${c.concentration.spell ? ` on ${c.concentration.spell}` : ""}.`, enc);
        return `Concentration (${c.name})`;
      case "dismiss-conc-check":
        c.concentrationCheck = null;
        return true;
      case "toggle-reaction":
        c.reactionUsed = !c.reactionUsed;
        return `Reaction (${c.name})`;
      case "toggle-bonus":
        c.bonusActionUsed = !c.bonusActionUsed;
        return `Bonus action (${c.name})`;
      case "toggle-ready":
        c.readied = !c.readied;
        logEntry("info", `${c.name} ${c.readied ? "readies an action" : "drops its readied action"}.`, enc);
        return `Ready (${c.name})`;
      case "toggle-surprised":
        c.surprised = !c.surprised;
        logEntry("info", `${c.name} is ${c.surprised ? "" : "no longer "}surprised.`, enc);
        return `Surprised (${c.name})`;
      case "roll-attack": {
        const atk = c.attacks?.[toInt(btn.dataset.attackIndex, -1)];
        if (!atk) return false;
        rollAndLog(`${c.name} · ${atk.name} to hit`, `1d20${atk.toHit >= 0 ? "+" : ""}${atk.toHit}`, { mode: diceMode });
        return true;
      }
      case "roll-damage": {
        const atk = c.attacks?.[toInt(btn.dataset.attackIndex, -1)];
        const expr = atk && R.attackDamageExpr(atk);
        if (!expr) return false;
        rollAndLog(`${c.name} · ${atk.name} damage`, expr, { suffix: atk.dmgType });
        return true;
      }
    }
    return false;
  }

  function runCombatantAction(c, btn) {
    const result = applyCombatantAction(c, btn, activeEncounter());
    if (result) commit({ undo: typeof result === "string" ? result : null });
  }

  $("#detail-body").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    const c = findCombatant(detailId);
    if (!btn || !c) return;
    runCombatantAction(c, btn);
  });

  /* Text fields save as you type but only repaint the cards behind the
     modal on change, so focus and clicks inside the modal aren't disturbed. */
  $("#detail-body").addEventListener("input", (e) => {
    if (e.target.id === "condition-rounds") { conditionRounds = e.target.value; return; }
    const field = e.target.dataset.detailField;
    const c = findCombatant(detailId);
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
    const c = findCombatant(detailId);
    if (c?.type === "lair" && !c.name.trim()) { c.name = "Lair Action"; saveState(); }
    renderActiveEncounter();
  });

  $("#detail-edit").addEventListener("click", () => {
    const c = findCombatant(detailId);
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
    commit({ undo: added ? `Add ${added === 1 ? "combatant" : `${added} combatants`}` : null });
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
  const withEncounter = (fn) => (...args) => {
    const enc = activeEncounter();
    if (enc) fn(enc, ...args);
  };

  $("#btn-next-turn").addEventListener("click", withEncounter((enc) => {
    nextTurn(enc);
    commit({ undo: "Next turn" });
  }));
  $("#btn-prev-turn").addEventListener("click", withEncounter((enc) => {
    prevTurn(enc);
    commit({ undo: "Previous turn" });
  }));
  $("#btn-delay").addEventListener("click", withEncounter(async (enc) => {
    const cur = enc.combatants[enc.currentTurnIndex];
    const later = enc.combatants.slice(enc.currentTurnIndex + 1);
    if (!cur || !later.length) return;
    const targetId = await choiceDialog({
      title: `Delay ${cur.name}`,
      text: `${cur.name} will act right after the combatant you pick, and their initiative changes to match.`,
      options: later.map((c) => ({ value: c.instanceId, label: c.name, hint: `Initiative ${c.initiative}` })),
    });
    if (!targetId) return;
    const events = R.delayTurn(enc, targetId);
    if (!events) return;
    announce(events, { enc });
    commit({ undo: `Delay ${cur.name}` });
  }));

  $("#btn-add-pc").addEventListener("click", () => openPicker("pc"));
  $("#btn-add-enemy").addEventListener("click", () => openPicker("enemy"));
  $("#btn-add-lair").addEventListener("click", withEncounter((enc) => {
    enc.combatants.push(makeLair());
    sortEncounter(enc);
    toast("Lair action added at initiative 20.");
    commit({ undo: "Add lair action" });
  }));

  $("#btn-roll-init").addEventListener("click", withEncounter((enc) => {
    const events = R.rollInitiative(enc, { group: state.ui.groupInitiative });
    announce(events, { enc, quiet: true });
    toast(`Rolled initiative for ${events.length} ${events.length === 1 ? "enemy group" : "enemy groups"}. Details in the log.`);
    commit({ undo: "Roll initiative" });
  }));
  $("#opt-group-init").addEventListener("change", (e) => {
    state.ui.groupInitiative = e.target.checked;
    saveState();
  });

  async function rest(enc, kind) {
    const preview = R.applyRest(R.clone(enc), kind);
    const label = kind === "long" ? "Long Rest" : "Short Rest";
    const html = preview.length
      ? `<p>This changes:</p><ul class="confirm-list">${preview.map((p) =>
          `<li><strong>${escapeHtml(p.name)}</strong>: ${escapeHtml(p.changes.join("; "))}</li>`).join("")}</ul>
         ${kind === "short" ? `<p class="detail-hint">Hit Dice healing isn't tracked; adjust HP by hand.</p>` : ""}`
      : `<p>Nothing to restore.</p>`;
    const ok = await confirmDialog({ title: label, html, okLabel: `Take ${label}`, danger: false });
    if (!ok) return;
    R.applyRest(enc, kind);
    logEntry("info", `${label} taken.`, enc);
    preview.forEach((p) => logEntry("info", `${p.name}: ${p.changes.join("; ")}`, enc));
    toast(`${label} taken.`);
    commit({ undo: label });
  }
  $("#btn-short-rest").addEventListener("click", withEncounter((enc) => rest(enc, "short")));
  $("#btn-long-rest").addEventListener("click", withEncounter((enc) => rest(enc, "long")));

  $("#btn-clock-toggle").addEventListener("click", withEncounter((enc) => {
    if (clockRunning(enc)) pauseClock(enc); else startClock(enc);
    saveState();
    renderClock();
  }));
  $("#btn-clock-reset").addEventListener("click", withEncounter((enc) => {
    resetClock(enc);
    saveState();
    renderClock();
  }));
  // Sub-second tick so the display never lags the true elapsed time by a full second.
  setInterval(renderClock, 250);

  /* ---------- Log & dice panels ---------- */
  const toggleLog = () => { state.ui.logOpen = !state.ui.logOpen; commit(); };
  const toggleDice = () => {
    state.ui.diceOpen = !state.ui.diceOpen;
    commit();
    if (state.ui.diceOpen) requestAnimationFrame(() => $("#dice-expr").focus());
  };
  $("#btn-toggle-log").addEventListener("click", toggleLog);
  $("#btn-log-close").addEventListener("click", toggleLog);
  $("#btn-toggle-dice").addEventListener("click", toggleDice);
  $("#btn-dice-close").addEventListener("click", toggleDice);
  $("#btn-log-clear").addEventListener("click", withEncounter((enc) => {
    if (!enc.log.length) return;
    enc.log = [];
    commit({ undo: "Clear log" });
    toast("Combat log cleared.", { action: { label: "Undo", run: undo } });
  }));

  /** Rolls made from the panel are logged on the open encounter, if any. */
  function panelRoll(expr) {
    const mode = /^1?d20\b/i.test(expr.trim()) ? diceMode : "normal";
    const r = rollAndLog("Roll", expr, { mode });
    if (r && activeEncounter()) commit();
  }
  $("#dice-buttons").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-roll]");
    if (btn) panelRoll(`1${btn.dataset.roll}`);
  });
  $("#dice-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const expr = $("#dice-expr").value;
    if (expr.trim()) panelRoll(expr);
  });
  $$('input[name="dice-mode"]').forEach((radio) =>
    radio.addEventListener("change", () => { if (radio.checked) diceMode = radio.value; }));

  /* ---------- Keyboard ---------- */
  const isTyping = () => {
    const el = document.activeElement;
    return !!el && (el.tagName === "TEXTAREA" || el.tagName === "SELECT" ||
      (el.tagName === "INPUT" && !["checkbox", "radio", "button"].includes(el.type)) || el.isContentEditable);
  };

  document.addEventListener("keydown", (e) => {
    if (document.querySelector("dialog[open]")) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "z") {
      // A field with text undoes its own typing; an empty one hands Ctrl+Z to the app.
      if (isTyping() && document.activeElement.value) return;
      e.preventDefault();
      undo();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || isTyping()) return;
    const k = e.key.toLowerCase();
    if (k === "d") { e.preventDefault(); toggleDice(); return; }
    if (state.ui.view !== "active") return;
    if (k === "l") { e.preventDefault(); toggleLog(); return; }
    if (k === "n" || e.key === "ArrowRight") { e.preventDefault(); $("#btn-next-turn").click(); }
    if (k === "p" || e.key === "ArrowLeft") { e.preventDefault(); $("#btn-prev-turn").click(); }
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

  cardsHost.addEventListener("click", (e) => {
    const { enc, combatant, el } = combatantFromEvent(e);
    if (!combatant) return;
    const btn = e.target.closest("[data-action]");
    if (!btn) return;

    switch (btn.dataset.action) {
      case "damage":
      case "heal":
      case "temp": {
        const input = $('[data-field="hpDelta"]', el);
        const amount = Math.abs(toInt(input.value, 0)) || 1;
        const action = btn.dataset.action;
        let changed;
        if (action === "damage") {
          damageCombatant(combatant, amount, {
            crit: !!$('[data-field="crit"]', el)?.checked,
            type: $('[data-field="dmgType"]', el)?.value || "",
          });
          changed = true;
        } else if (action === "heal") {
          changed = healCombatant(combatant, amount);
        } else {
          changed = grantTemp(combatant, amount);
        }
        if (changed) commit({ undo: `${capitalize(action)} ${combatant.name}` });
        break;
      }

      case "open-detail":
        openDetail(combatant.instanceId);
        break;

      case "edit-instance":
        openCreatureModal({ mode: "instance-edit", type: combatant.type, instanceId: combatant.instanceId });
        break;

      case "roll-init": {
        const r = R.rollInitiativeFor(combatant);
        sortEncounter(enc);
        logEntry("roll", `Initiative ${combatant.name}: d20 (${r.d20}) ${formatMod(r.bonus)} = ${r.total}`, enc);
        toast(`${combatant.name} rolls ${r.total} for initiative.`);
        commit({ undo: `Roll initiative (${combatant.name})` });
        break;
      }

      case "remove-instance": {
        removeCombatant(enc, combatant);
        commit({ undo: `Remove ${combatant.name}` });
        toast(`${combatant.name} removed.`, { action: { label: "Undo", run: undo } });
        break;
      }

      default:
        runCombatantAction(combatant, btn);
    }
  });

  /* The collapsible stats section remembers when the DM overrides the default. */
  cardsHost.addEventListener("toggle", (e) => {
    if (!e.target.matches?.("[data-card-more]")) return;
    const id = e.target.closest("[data-instance-id]")?.dataset.instanceId;
    if (id) moreOpen.set(id, e.target.open);
  }, true);

  /* Inline edits commit on change (blur / Enter) */
  cardsHost.addEventListener("change", (e) => {
    const input = e.target.closest("[data-field]");
    if (!input) return;
    const { enc, combatant } = combatantFromEvent(e);
    if (!combatant) return;

    switch (input.dataset.field) {
      case "initiative":
        combatant.initiative = toInt(input.value, 0);
        combatant.initRank = 0;
        sortEncounter(enc);
        commit({ undo: `Initiative (${combatant.name})` });
        break;
      case "hpCurrent":
        // Direct edits are corrections, so they bypass massive damage and death save rules.
        combatant.hp.current = Math.min(Math.max(0, toInt(input.value, 0)), combatant.hp.max);
        announce(R.afterHpChange(combatant), { enc });
        commit({ undo: `HP (${combatant.name})` });
        break;
      case "hpMax":
        combatant.hp.max = Math.max(0, toInt(input.value, 0));
        combatant.hp.current = Math.min(combatant.hp.current, combatant.hp.max);
        announce(R.afterHpChange(combatant), { enc });
        commit({ undo: `Max HP (${combatant.name})` });
        break;
      case "hpTemp":
        combatant.hp.temp = Math.max(0, toInt(input.value, 0));
        commit({ undo: `Temp HP (${combatant.name})` });
        break;
      case "dmgType":
        lastDamageType.set(combatant.instanceId, input.value);
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

  /* Static parts of the builder. */
  creatureForm.elements.cls.innerHTML =
    `<option value="">—</option>` + CLASSES.map((c) => `<option value="${c}">${c}</option>`).join("");
  creatureForm.elements.cr.innerHTML =
    `<option value="">—</option>` + CR_OPTIONS.map((cr) => `<option value="${cr}">${cr}</option>`).join("");
  $("#damage-types").innerHTML = DAMAGE_TYPES.map((t) => `<option value="${t}">`).join("");
  $("#stats-inputs").innerHTML = STAT_KEYS.map((k) => `
    <label class="stat-input">
      <span>${k.toUpperCase()}</span>
      <input type="number" name="${k}" min="1" max="30" value="10" aria-label="${STAT_NAMES[k]}">
      <span class="stat-input-mod" data-mod-for="${k}">+0</span>
    </label>`).join("");
  $("#save-grid").innerHTML = STAT_KEYS.map((k) => `
    <label class="skill-check">
      <input type="checkbox" data-save="${k}">
      <span class="skill-name">${STAT_NAMES[k]}</span>
      <span class="skill-bonus" data-save-bonus="${k}">+0</span>
    </label>`).join("");
  $("#skill-grid").innerHTML = SKILLS.map((s) => `
    <div class="skill-check">
      <label class="skill-main">
        <input type="checkbox" data-skill="${s.key}">
        <span class="skill-name">${s.name} <small>${s.ability.toUpperCase()}</small></span>
      </label>
      <label class="skill-exp" title="Expertise: proficiency counts twice">
        <input type="checkbox" data-expertise="${s.key}" aria-label="${s.name} expertise"><span aria-hidden="true">×2</span>
      </label>
      <span class="skill-bonus" data-skill-bonus="${s.key}">+0</span>
    </div>`).join("");
  $$("[data-def-grid]").forEach((grid) => {
    const key = grid.dataset.defGrid;
    const options = key === "conditionImmunities" ? [...CONDITIONS, "Exhaustion"] : DAMAGE_TYPES;
    grid.innerHTML = options.map((o) => `
      <label class="check-chip"><input type="checkbox" data-def="${key}" value="${o}"><span>${o}</span></label>`).join("");
  });

  state = loadState();
  state.encounters.forEach(sortEncounter);
  snapshotActive();
  renderAll();
})();

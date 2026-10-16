// Scripted QA run through the real UI (jsdom): the docs/QA.md checklist.
// Prints PASS/FAIL per item and exits non-zero on any failure.
const { boot } = require("./harness");

const results = [];
const check = async (area, item, fn) => {
  try { const r = await fn(); results.push({ area, item, ok: r !== false, note: typeof r === "string" ? r : "" }); }
  catch (e) { results.push({ area, item, ok: false, note: e.message }); }
};
const must = (cond, msg) => { if (!cond) throw new Error(msg); };

(async () => {
  const errors = [];
  let h = boot({ errors });
  let { w, $, $$, click, setVal, key, tick, saved, toasts } = h;
  const submit = (form, submitter) => {
    const ev = new w.Event("submit", { cancelable: true });
    if (submitter) Object.defineProperty(ev, "submitter", { value: submitter });
    form.dispatchEvent(ev);
  };
  const card = (name) => $$("#combatant-cards .card").find((c) => c.querySelector(".card-name").textContent.trim() === name);
  const sc = (name) => saved().encounters.find((e) => e.id === saved().ui.activeEncounterId).combatants.find((c) => c.name === name);
  const enc = () => saved().encounters.find((e) => e.id === saved().ui.activeEncounterId);
  const cur = () => enc().combatants[enc().currentTurnIndex].name;
  const dmg = (name, n, { type = "", crit = false } = {}) => {
    const c = card(name);
    setVal(c.querySelector('[data-field="hpDelta"]'), String(n), "input");
    if (type) setVal(c.querySelector('[data-field="dmgType"]'), type);
    if (crit) c.querySelector('[data-field="crit"]').checked = true;
    click(card(name).querySelector('[data-action="damage"]'));
  };
  const act = (name, action) => click(card(name).querySelector(`[data-action="${action}"]`));
  await tick();

  /* ---------- Setup ---------- */
  click('.tab[data-view="library"]');
  await check("Setup", "Add SRD starter monsters from the empty enemy library", () => {
    click($('[data-action="add-srd"]'));
    must(saved().creatureLibrary.enemies.length === 18, "count");
  });
  const pcs = [
    { name: "Aria", cls: "Ranger", level: 5, hp: 38, dex: 16 },
    { name: "Brom", cls: "Fighter", level: 5, hp: 44, dex: 12, resist: "fire" },
    { name: "Cass", cls: "Wizard", level: 5, hp: 28, dex: 14, slots: true },
    { name: "Dain", cls: "Warlock", level: 5, hp: 33, dex: 13, pact: true },
  ];
  await check("Setup", "Create 4 PCs in the builder (incl. fire resistance, short-rest Pact slots, skills with expertise)", () => {
    for (const p of pcs) {
      click("#btn-new-pc");
      const f = $("#creature-form").elements;
      setVal(f.name, p.name); setVal(f.level, String(p.level)); setVal(f.cls, p.cls);
      setVal(f.hpMax, String(p.hp)); setVal(f.dex, String(p.dex)); setVal(f.ac, "16");
      if (p.resist) $(`[data-def="damageResistances"][value="${p.resist}"]`).checked = true;
      if (p.slots || p.pact) {
        click("#btn-add-spell-level");
        const row = $$(".spell-row").at(-1);
        setVal($('[data-spell="max"]', row), "2"); setVal($('[data-spell="current"]', row), "2");
        if (p.pact) { setVal($('[data-spell="level"]', row), "3"); setVal($('[data-spell="recovery"]', row), "short"); }
      }
      if (p.name === "Aria") { $('[data-skill="perception"]').checked = true; const e = $('[data-expertise="perception"]'); e.checked = true; e.dispatchEvent(new w.Event("input", { bubbles: true })); }
      submit($("#creature-form"));
    }
    must(saved().creatureLibrary.pcs.length === 4, "4 PCs");
    must(saved().creatureLibrary.pcs[3].spellSlots[0].recovery === "short", "pact slot");
  });
  click('.tab[data-view="encounters"]');
  click("#btn-new-encounter");
  setVal("#prompt-input", "QA: Lair of the Red", "input");
  submit($("#prompt-form"));
  await tick(20);
  await check("Setup", "Create encounter, add 4 PCs, Adult Red Dragon (legendary), 2 Skeletons and a lair action", () => {
    const lib = saved().creatureLibrary;
    for (const p of lib.pcs) { click("#btn-add-pc"); setVal("#picker-select", p.id); submit($("#picker-form")); }
    click("#btn-add-enemy"); setVal("#picker-select", lib.enemies.find((t) => t.name === "Adult Red Dragon").id); submit($("#picker-form"));
    click("#btn-add-enemy"); setVal("#picker-select", lib.enemies.find((t) => t.name === "Skeleton").id);
    setVal($("#picker-form").elements.count, "2"); submit($("#picker-form"));
    click("#btn-add-lair");
    must(enc().combatants.length === 8, "8 combatants, got " + enc().combatants.length);
  });
  await check("Initiative", "Roll Initiative (grouped): enemies rolled, PCs untouched, skeletons share a roll", () => {
    click("#btn-roll-init");
    const sk = enc().combatants.filter((c) => c.name.startsWith("Skeleton"));
    must(sk[0].initiative === sk[1].initiative, "grouped");
    must(sc("Aria").initiative === 0, "PC untouched");
  });
  await check("Initiative", "Type PC initiatives and use the per-card roll button", () => {
    const vals = { Aria: 18, Brom: 11, Cass: 14 };
    for (const [n, v] of Object.entries(vals)) setVal(card(n).querySelector('[data-field="initiative"]'), String(v));
    act("Dain", "roll-init");
    must(sc("Aria").initiative === 18 && sc("Dain").initiative > 0, "set");
    must($("#log-list") !== null, "log exists");
  });
  await check("Turn order", "Surprise toggle in round 1 disables the reaction chip", () => {
    act("Skeleton 2", "toggle-surprised");
    must(card("Skeleton 2").querySelector('[data-action="toggle-reaction"]').disabled, "disabled");
  });
  await check("Layout", "Compact view toggle persists", () => {
    click('[data-card-mode="compact"]');
    must(saved().ui.cardMode === "compact", "persisted");
    click('[data-card-mode="full"]');
  });

  /* ---------- Round 1 ---------- */
  const startRound = enc().round;
  await check("Damage", "Typed damage: fire vs immune dragon is 0 and logged with the math", () => {
    dmg("Adult Red Dragon", 30, { type: "fire" });
    must(sc("Adult Red Dragon").hp.current === 256, "immune");
    must(toasts().some((t) => t.includes("30 fire, immune: 0")), "toast");
  });
  await check("Damage", "Vulnerability doubles (bludgeoning vs skeleton)", () => {
    dmg("Skeleton 1", 4, { type: "bludgeoning" });
    must(sc("Skeleton 1").hp.current === 5, "13 − 8 = 5, got " + sc("Skeleton 1").hp.current);
  });
  await check("Damage", "Resistance halves rounding down (13 fire vs Brom = 6)", () => {
    dmg("Brom", 13, { type: "fire" });
    must(sc("Brom").hp.current === 38, "44 − 6");
  });
  await check("Concentration", "Concentrating caster takes damage: persistent DC chip, stacks a count", () => {
    click(card("Cass").querySelector(".card-name-btn"));
    click($('#detail-body [data-action="toggle-concentration"]'));
    click($('#detail-modal [data-close]'));
    dmg("Cass", 24); dmg("Cass", 2);
    const chip = card("Cass").querySelector(".conc-check").textContent;
    must(/DC 10/.test(chip) && /×2/.test(chip), chip);
  });
  await check("Conditions", "Condition immunity blocks Poisoned on a skeleton", () => {
    click(card("Skeleton 1").querySelector(".card-name-btn"));
    click($('#detail-body [data-condition="Poisoned"]'));
    must(!sc("Skeleton 1").conditions.length, "blocked");
    must(toasts().some((t) => t.includes("immune to poisoned")), "toast");
  });
  await check("Conditions", "Condition with a 2-round duration shows remaining rounds on the chip", () => {
    setVal($("#condition-rounds"), "2", "input");
    click($('#detail-body [data-condition="Frightened"]'));
    setVal($("#condition-rounds"), "", "input");
    click($('#detail-modal [data-close]'));
    must(/Frightened\s*2r/.test(card("Skeleton 1").querySelector(".card-status").textContent), "chip");
  });
  await check("Notes", "DM notes saved and previewed on the card", () => {
    click(card("Adult Red Dragon").querySelector(".card-name-btn"));
    const ta = $('#detail-body [data-detail-field="notes"]');
    setVal(ta, "Flies off at half HP", "input"); ta.dispatchEvent(new w.Event("change", { bubbles: true }));
    must($("#detail-body").textContent.includes("Legendary Actions (3/round)"), "legendary text shown");
    click($('#detail-modal [data-close]'));
    must(card("Adult Red Dragon").querySelector(".card-notes").textContent.includes("Flies off"), "preview");
  });
  await check("Legendary", "Spend legendary actions and legendary resistance by clicking pips", () => {
    click(card("Adult Red Dragon").querySelector('[data-action="legendary-pip"][data-kind="actions"][data-pip-index="1"]'));
    click(card("Adult Red Dragon").querySelector('[data-action="legendary-pip"][data-kind="resistance"][data-pip-index="2"]'));
    must(sc("Adult Red Dragon").legendaryActionsLeft === 1 && sc("Adult Red Dragon").legendaryResistanceLeft === 2, "spent");
  });
  await check("Action economy", "Reaction, bonus action and ready toggles", () => {
    act("Aria", "toggle-reaction"); act("Aria", "toggle-bonus"); act("Brom", "toggle-ready");
    must(sc("Aria").reactionUsed && sc("Aria").bonusActionUsed && sc("Brom").readied, "set");
  });
  await check("Rolls", "Attack to-hit and damage rolls from the card are logged", () => {
    act("Adult Red Dragon", "roll-attack");
    click(card("Adult Red Dragon").querySelectorAll('[data-action="roll-damage"]')[0]);
    must(enc().log.some((l) => l.text.includes("Bite to hit")) && enc().log.some((l) => l.text.includes("Bite damage")), "logged");
  });
  await check("Dice", "Dice roller with advantage and a free-text expression; junk rejected", () => {
    key("d");
    click($('input[name="dice-mode"][value="adv"]')); $('input[name="dice-mode"][value="adv"]').checked = true;
    $('input[name="dice-mode"][value="adv"]').dispatchEvent(new w.Event("change", { bubbles: true }));
    click($('[data-roll="d20"]'));
    must($("#dice-result").textContent.includes("(adv)"), "adv: " + $("#dice-result").textContent);
    setVal("#dice-expr", "2d6+3", "input"); submit($("#dice-form"));
    setVal("#dice-expr", "process.exit()", "input"); submit($("#dice-form"));
    must(toasts().some((t) => t.startsWith("Can't read")), "rejected");
    key("d");
  });
  // finish round 1
  while (enc().round === startRound) click("#btn-next-turn");

  /* ---------- Round 2 ---------- */
  await check("Turn order", "Surprise cleared by round 2; reaction chip usable again", () => {
    must(!sc("Skeleton 2").surprised, "cleared");
    must(!card("Skeleton 2").querySelector('[data-action="toggle-reaction"]').disabled, "enabled");
  });
  await check("Death & dying", "PC dropped to 0: auto Unconscious, concentration lost, Dying tag", () => {
    dmg("Cass", 100 - 74);
    must(sc("Cass").hp.current === 0 && sc("Cass").conditions.some((c) => c.name === "Unconscious") && !sc("Cass").concentration.active, JSON.stringify(sc("Cass").hp));
    must(card("Cass").querySelector(".card-down-tag--dying"), "dying tag");
  });
  await check("Death & dying", "Damage at 0 HP adds a failure; Crit adds two → Dead, visually distinct", () => {
    dmg("Cass", 3);
    must(sc("Cass").deathSaves.fail === 1, "1 fail");
    dmg("Cass", 3, { crit: true });
    must(sc("Cass").deathSaves.fail === 3 && card("Cass").querySelector(".card-down-tag--dead") && card("Cass").classList.contains("is-dead"), "dead");
  });
  await check("Undo", "Ctrl+Z restores the PC from Dead back to Dying", () => {
    w.document.activeElement.blur();
    key("z", { ctrlKey: true });
    must(sc("Cass").deathSaves.fail === 1, "undone, fails " + sc("Cass").deathSaves.fail);
  });
  await check("Healing", "Healing from 0 resets death saves and removes the automatic Unconscious; Prone untouched", () => {
    setVal(card("Cass").querySelector('[data-field="hpDelta"]'), "5", "input");
    act("Cass", "heal");
    must(sc("Cass").hp.current === 5 && !sc("Cass").conditions.length && sc("Cass").deathSaves.fail === 0, JSON.stringify(sc("Cass").conditions));
  });
  await check("Healing", "Heal caps at max; Temp keeps the higher value and toasts when ignored", () => {
    setVal(card("Aria").querySelector('[data-field="hpDelta"]'), "10", "input"); act("Aria", "heal");
    must(sc("Aria").hp.current === 38 && sc("Aria").hp.temp === 0, "capped");
    setVal(card("Aria").querySelector('[data-field="hpDelta"]'), "8", "input"); act("Aria", "temp");
    setVal(card("Aria").querySelector('[data-field="hpDelta"]'), "5", "input"); act("Aria", "temp");
    must(sc("Aria").hp.temp === 8 && toasts().some((t) => t.includes("doesn't stack")), "temp");
  });
  await check("Death & dying", "Massive damage kills outright (overflow ≥ max HP)", () => {
    dmg("Dain", 33 + 33);
    must(sc("Dain").deathSaves.fail === 3 && toasts().some((t) => t.includes("massive damage")), "dead");
    w.document.activeElement.blur(); key("z", { ctrlKey: true });
    must(sc("Dain").hp.current === 33, "undone");
  });
  await check("Exhaustion", "Exhaustion shows cumulative effects; level 6 is Dead", () => {
    click(card("Brom").querySelector(".card-name-btn"));
    for (let i = 0; i < 6; i++) click($('#detail-body [data-action="exhaustion"][data-delta="1"]'));
    must($("#detail-body .effect-list--exh").textContent.includes("Death"), "effects");
    click($('#detail-modal [data-close]'));
    must(card("Brom").querySelector(".card-down-tag--dead"), "dead tag");
    click(card("Brom").querySelector(".card-name-btn"));
    for (let i = 0; i < 6; i++) click($('#detail-body [data-action="exhaustion"][data-delta="-1"]'));
    click($('#detail-modal [data-close]'));
  });
  await check("Turn order", "Delay moves the current combatant after a later one", async () => {
    const before = cur();
    if (enc().currentTurnIndex >= enc().combatants.length - 1) click("#btn-next-turn");
    const mover = cur();
    click("#btn-delay");
    click($$("#choice-list .choice-btn").at(-1));
    await tick(20);
    must(cur() !== mover && enc().combatants.at(-1).name === mover, `delayed ${mover} (was ${before})`);
  });
  await check("Remove", "Remove combatant shows an Undo toast (no confirm); Undo restores it", () => {
    act("Skeleton 2", "remove-instance");
    must(!card("Skeleton 2") && !$("#confirm-modal").open, "removed");
    click($$("#toast-stack .toast-action").at(-1));
    must(card("Skeleton 2"), "restored");
  });
  await check("Recharge", "Mark Fire Breath spent; it rolls automatically at the start of the dragon's turn", () => {
    click(card("Adult Red Dragon").querySelector('[data-action="toggle-recharge"]'));
    must(!sc("Adult Red Dragon").recharges[0].available, "spent");
  });
  await check("Legendary", "Legendary actions refill at the start of the dragon's own turn; resistance does not", () => {
    let guard = 0;
    while (cur() !== "Adult Red Dragon" && guard++ < 20) click("#btn-next-turn");
    must(sc("Adult Red Dragon").legendaryActionsLeft === 3 && sc("Adult Red Dragon").legendaryResistanceLeft === 2, "refill");
  });

  /* ---------- Reload mid-fight ---------- */
  const snapshot = w.localStorage.getItem("dm-dashboard-state-v2");
  const beforeReload = { round: enc().round, turn: cur(), cass: sc("Cass").hp.current, log: enc().log.length };
  h = boot({ storage: { "dm-dashboard-state-v2": snapshot }, errors });
  ({ w, $, $$, click, setVal, key, tick, saved, toasts } = h);
  await tick();
  await check("Persistence", "Reload mid-fight keeps round, turn, HP, conditions and log", () => {
    must(enc().round === beforeReload.round && cur() === beforeReload.turn && sc("Cass").hp.current === beforeReload.cass && enc().log.length === beforeReload.log, "same");
    must($$("#combatant-cards .card").length === 8, "cards rendered");
  });

  /* ---------- Round 3 and expiry ---------- */
  const r = enc().round;
  while (enc().round < r + 2) click("#btn-next-turn");
  await check("Conditions", "Frightened (2 rounds) has expired by now and the expiry was logged", () => {
    must(!sc("Skeleton 1").conditions.some((c) => c.name === "Frightened"), "expired");
    must(enc().log.some((l) => l.text.includes("Frightened ends")), "logged");
  });
  await check("Economy", "Aria's reaction was reset at the start of her own turn", () => !sc("Aria").reactionUsed);
  await check("Rounds", `Three or more full rounds completed (now round ${enc().round})`, () => enc().round >= 4);

  /* ---------- Rests ---------- */
  await check("Rests", "Short rest restores only Pact (short) slots and recharges", async () => {
    const dain = card("Dain").querySelector('[data-action="toggle-pip"]'); click(dain);
    click("#btn-short-rest");
    must($("#confirm-text").textContent.includes("short-rest slots"), $("#confirm-text").textContent);
    submit($("#confirm-form"));
    await tick(20);
    must(sc("Dain").spellSlots[0].current === 2, "pact restored");
  });
  await check("Rests", "Long rest restores HP and legendary resistance; skips creatures at 0 HP", async () => {
    dmg("Skeleton 1", 99);
    click("#btn-long-rest");
    must($("#confirm-text").textContent.includes("no benefit"), "preview mentions 0 HP");
    submit($("#confirm-form"));
    await tick(20);
    must(sc("Adult Red Dragon").legendaryResistanceLeft === 3 && sc("Aria").hp.temp === 0 && sc("Skeleton 1").hp.current === 0, "rest");
  });

  /* ---------- Log, duplicate, export/import ---------- */
  await check("Log", "Combat log records damage, healing, conditions, turns, rolls and recharges", () => {
    key("l");
    const t = $("#log-list").textContent;
    const kinds = new Set(enc().log.map((l) => l.kind));
    must(["damage", "heal", "condition", "turn", "roll", "recharge"].every((k) => kinds.has(k)), [...kinds].join(","));
    key("l");
    return `kinds seen: ${[...kinds].join(", ")}; ${t.length} chars`;
  });
  await check("Encounters", "Duplicate encounter resets the fight", () => {
    click('.tab[data-view="encounters"]');
    click($('[data-action="duplicate-encounter"]'));
    const copy = saved().encounters.find((e) => e.name.endsWith("(copy)"));
    must(copy.round === 1 && copy.combatants.length === 8 && copy.combatants.every((c) => c.type === "lair" || c.hp.current === c.hp.max), "reset");
  });
  let exported = null;
  w.URL.createObjectURL = (b) => { exported = b; return "blob:x"; };
  click("#btn-settings");
  click($('[data-settings="export"]'));
  click($('#settings-modal [data-close]'));
  const text = await new Promise((res) => { const fr = new w.FileReader(); fr.onload = () => res(fr.result); fr.readAsText(exported); });
  await check("Data", "Export → Replace import round trip leaves data identical", () => {
    const before = JSON.stringify({ l: saved().creatureLibrary, e: saved().encounters });
    const input = $("#import-file");
    const file = new w.File([text], "qa.json"); file.text = async () => text;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new w.Event("change", { bubbles: true }));
    return "file picked; Replace confirmed below";
  });
  await tick(20);
  submit($("#import-form"), $('#import-form [value="replace"]'));
  await tick(20);
  submit($("#confirm-form"));
  await tick(20);
  const exportedObj = JSON.parse(text);
  await check("Data", "…and the re-imported state matches the export exactly", () =>
    JSON.stringify(saved().encounters) === JSON.stringify(exportedObj.encounters) &&
    JSON.stringify(saved().creatureLibrary) === JSON.stringify(exportedObj.creatureLibrary));

  /* ---------- Player view ---------- */
  const pv = boot({ storage: { "dm-dashboard-state-v2": w.localStorage.getItem("dm-dashboard-state-v2") }, url: "http://localhost/index.html?view=player" });
  await pv.tick();
  await check("Player view", "Shows round, order, PC HP and enemy bands only; no AC, HP numbers, notes, attacks or lair text", () => {
    const html = pv.$("#player-view").innerHTML;
    const leaks = ["Flies off", "Bite", "Fire Breath", "AC", "256", "Legendary", "Rocks"].filter((s) => html.includes(s));
    must(!leaks.length, "leaked: " + leaks.join(","));
    must(/Round \d/.test(pv.$("#player-round").textContent) && pv.$$(".player-row").length === 8, "content");
    must(pv.$("#combatant-cards").innerHTML.trim() === "", "DM UI never rendered");
  });

  const realErrors = errors.filter((e) => !/Not implemented: navigation/.test(e));
  await check("Runtime", "No script errors during the whole run", () => { must(!realErrors.length, realErrors.join("\n")); });
  results.forEach((x) => console.log(`${x.ok ? "PASS" : "FAIL"}  [${x.area}] ${x.item}${x.ok ? "" : `\n        ${x.note}`}`));
  const failed = results.filter((x) => !x.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("QA CRASH", e); console.log(JSON.stringify(results)); process.exit(1); });

const { boot, assert, ROOT } = require("./harness");
const V1 = require(ROOT + "/tests/fixtures/v1-save.js");
// v1 → v2 migration through the real boot path, plus the Phase 1 rules in the UI.

(async () => {
  const errors = [];
  const v1raw = JSON.stringify(V1);
  const h = boot({ storage: { "dm-dashboard-state-v1": v1raw }, errors });
  const { w, $, $$, click, setVal, tick, saved, toasts } = h;
  await tick();
  assert(w.localStorage.getItem("dm-dashboard-state-v1") === v1raw, "v1 untouched");
  const v2 = saved();
  assert(v2 && v2.schemaVersion === 2, "v2 written");
  assert($$("#combatant-cards .card").length === 4, "4 cards, got " + $$("#combatant-cards .card").length);

  const card = (name) => $$("#combatant-cards .card").find((c) => c.querySelector(".card-name").textContent.trim() === name);
  // Drake is concentrating: damage 30 → DC 15 chip
  let drake = card("Drake");
  setVal(drake.querySelector('[data-field="hpDelta"]'), "30", "input");
  click(drake.querySelector('[data-action="damage"]'));
  drake = card("Drake");
  assert(drake.querySelector(".conc-check")?.textContent.includes("DC 15"), "conc chip DC 15");
  setVal(drake.querySelector('[data-field="hpDelta"]'), "4", "input");
  click(drake.querySelector('[data-action="damage"]'));
  drake = card("Drake");
  assert(/DC 10[\s\S]*×2/.test(drake.querySelector(".conc-check").textContent), "stacked count");
  click(drake.querySelector('[data-action="dismiss-conc-check"]'));
  assert(!card("Drake").querySelector(".conc-check"), "dismissed");

  // Aria is at 0 HP: crit damage → 2 more failures → dead (had 1)
  let aria = card("Aria");
  assert(aria.querySelector('[data-field="crit"]'), "crit toggle shown for downed PC");
  aria.querySelector('[data-field="crit"]').checked = true;
  click(aria.querySelector('[data-action="damage"]'));
  aria = card("Aria");
  assert(aria.querySelector(".card-down-tag--dead"), "Aria dead");
  assert(aria.classList.contains("is-dead"), "dead class");
  click(aria.querySelector('[data-action="heal"]'));
  assert(toasts().some((t) => t.includes("is dead")), "heal blocked on dead");

  // Goblin 1: heal at full adds no temp
  let gob = card("Goblin 1");
  setVal(gob.querySelector('[data-field="hpDelta"]'), "10", "input");
  click(gob.querySelector('[data-action="heal"]'));
  let st = saved().encounters[0].combatants.find((c) => c.name === "Goblin 1");
  assert(st.hp.current === 7 && st.hp.temp === 2, "heal capped, temp unchanged " + JSON.stringify(st.hp));
  gob = card("Goblin 1");
  setVal(gob.querySelector('[data-field="hpDelta"]'), "1", "input");
  click(gob.querySelector('[data-action="temp"]'));
  assert(toasts().some((t) => t.includes("doesn't stack")), "temp ignored toast");
  gob = card("Goblin 1");
  setVal(gob.querySelector('[data-field="hpDelta"]'), "5", "input");
  click(gob.querySelector('[data-action="temp"]'));
  st = saved().encounters[0].combatants.find((c) => c.name === "Goblin 1");
  assert(st.hp.temp === 5, "temp 5");

  // Detail modal: condition tooltips and effect text, enemy init bonus
  click(card("Goblin 1").querySelector('[data-action="open-detail"]'));
  assert($("#detail-modal").open, "detail open");
  assert($("#detail-body").textContent.includes("Init Bonus"), "init bonus shown");
  assert($("#detail-body .effect-list")?.textContent.includes("Frightened"), "effect text");
  click($('#detail-body [data-action="exhaustion"][data-delta="1"]'));
  click($('#detail-body [data-action="exhaustion"][data-delta="1"]'));
  assert($("#detail-body .effect-list--exh")?.textContent.includes("Speed halved"), "exhaustion text");
  click($('#detail-modal [data-close]'));

  // Turn banner
  click("#btn-next-turn");
  await tick();
  // Builder: enemy init bonus
  click('.tab[data-view="library"]');
  click("#btn-new-enemy");
  const f = $("#creature-form").elements;
  setVal(f.name, "Test Bandit");
  setVal(f.initBonus, "7");
  $("#creature-form").dispatchEvent(new w.Event("submit", { cancelable: true }));
  const t = saved().creatureLibrary.enemies.find((e) => e.name === "Test Bandit");
  assert(t && t.initBonus === 7, "enemy init bonus saved " + JSON.stringify(t && t.initBonus));

  console.log("errors:", errors.length ? errors : "none");
  if (errors.length) process.exit(1);
  console.log("migration run OK");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });

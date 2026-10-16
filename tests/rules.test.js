/* ==========================================================================
   Rules tests. No dependencies.
   Node:    node tests/rules.test.js
   Browser: open tests/rules.test.html
   ========================================================================== */

(function (root) {
  "use strict";
  const isNode = typeof module === "object" && module.exports;
  const R = isNode ? require("../rules.js") : root.DMRules;
  const V1_SAVE = isNode ? require("./fixtures/v1-save.js") : root.V1_SAVE;

  const results = [];
  function test(name, fn) {
    try { fn(); results.push({ name, ok: true }); }
    catch (err) { results.push({ name, ok: false, message: err.message }); }
  }
  const show = (v) => JSON.stringify(v);
  function eq(actual, expected, label = "") {
    if (show(actual) !== show(expected)) throw new Error(`${label} expected ${show(expected)}, got ${show(actual)}`);
  }
  function ok(cond, label = "assertion failed") { if (!cond) throw new Error(label); }

  /** A deterministic rng that returns the given d-sides faces in order. */
  const faces = (sides, ...values) => {
    let i = 0;
    return () => ((values[i++ % values.length] - 1) + 0.5) / sides;
  };

  const pc = (o = {}) => R.normalizeInstance({
    type: "pc", name: "Hero", level: 5, hp: { max: 30, current: 30, temp: 0 },
    stats: { str: 10, dex: 14, con: 12, int: 10, wis: 12, cha: 10 }, ...o,
  });
  const enemy = (o = {}) => R.normalizeInstance({
    type: "enemy", name: "Orc", cr: "1/2", hp: { max: 15, current: 15, temp: 0 },
    stats: { str: 16, dex: 12, con: 16, int: 7, wis: 11, cha: 10 }, ...o,
  });

  /* ---------- adjustHp ---------- */

  test("temp HP absorbs damage before HP", () => {
    const c = pc({ hp: { max: 30, current: 30, temp: 5 } });
    const r = R.adjustHp(c, -8);
    eq(r.absorbedByTemp, 5, "absorbed");
    eq(r.hpLost, 3, "hpLost");
    eq(c.hp, { max: 30, current: 27, temp: 0 });
  });

  test("temp HP fully absorbs small hits", () => {
    const c = pc({ hp: { max: 30, current: 30, temp: 10 } });
    const r = R.adjustHp(c, -4);
    eq([r.absorbedByTemp, r.hpLost, c.hp.temp, c.hp.current], [4, 0, 6, 30]);
  });

  test("healing caps at max HP and never becomes temp HP", () => {
    const c = pc({ hp: { max: 30, current: 25, temp: 0 } });
    const r = R.adjustHp(c, 20);
    eq([r.healed, c.hp.current, c.hp.temp], [5, 30, 0]);
    const full = pc();
    R.adjustHp(full, 10);
    eq([full.hp.current, full.hp.temp], [30, 0], "heal at full HP");
  });

  test("dropping a PC to 0 reports overflow", () => {
    const c = pc({ hp: { max: 30, current: 10, temp: 0 } });
    const r = R.adjustHp(c, -25);
    eq([r.hpLost, r.overflow, r.droppedToZero, r.instantDeath], [10, 15, true, false]);
    eq(c.deathSaves.fail, 0);
  });

  test("massive damage: overflow >= max HP kills a PC outright", () => {
    const c = pc({ hp: { max: 30, current: 10, temp: 0 } });
    const r = R.adjustHp(c, -40);
    eq([r.overflow, r.instantDeath, c.deathSaves.fail], [30, true, 3]);
    ok(R.isDead(c), "dead");
  });

  test("massive damage: overflow one short of max HP does not kill", () => {
    const c = pc({ hp: { max: 30, current: 10, temp: 0 } });
    eq(R.adjustHp(c, -39).instantDeath, false);
  });

  test("damage at 0 HP adds one death save failure", () => {
    const c = pc({ hp: { max: 30, current: 0, temp: 0 } });
    const r = R.adjustHp(c, -5);
    eq([r.failuresAdded, c.deathSaves.fail], [1, 1]);
  });

  test("critical hit at 0 HP adds two failures", () => {
    const c = pc({ hp: { max: 30, current: 0, temp: 0 }, deathSaves: { success: 0, fail: 1 } });
    const r = R.adjustHp(c, -5, { crit: true });
    eq([r.failuresAdded, c.deathSaves.fail], [2, 3]);
    ok(R.isDead(c), "three failures is dead");
  });

  test("damage at 0 HP >= max HP is instant death", () => {
    const c = pc({ hp: { max: 30, current: 0, temp: 0 } });
    eq(R.adjustHp(c, -30).instantDeath, true);
    eq(c.deathSaves.fail, 3);
  });

  test("monsters at 0 HP get no death saves", () => {
    const m = enemy({ hp: { max: 15, current: 0, temp: 0 } });
    const r = R.adjustHp(m, -50);
    eq([r.failuresAdded, r.instantDeath, m.deathSaves.fail], [0, false, 0]);
    ok(!R.isDead(m), "monster is Down, not Dead");
  });

  test("damage to a stable PC restarts death saves", () => {
    const c = pc({ hp: { max: 30, current: 0, temp: 0 }, deathSaves: { success: 3, fail: 1 } });
    ok(R.isStable(c), "stable before");
    R.adjustHp(c, -2);
    eq(c.deathSaves, { success: 0, fail: 1 });
    ok(!R.isStable(c), "no longer stable");
  });

  /* ---------- afterHpChange / applyDamage ---------- */

  test("PC at 0 HP becomes unconscious automatically, and wakes on healing", () => {
    const c = pc({ hp: { max: 30, current: 5, temp: 0 } });
    R.applyDamage(c, 5);
    ok(R.hasCondition(c, "Unconscious"), "unconscious");
    eq(c.autoUnconscious, true);
    R.applyDamage(c, 1);
    R.applyHealing(c, 4);
    ok(!R.hasCondition(c, "Unconscious"), "woke up");
    eq(c.deathSaves, { success: 0, fail: 0 }, "death saves reset");
  });

  test("an Unconscious the DM added stays after healing", () => {
    const c = pc({ hp: { max: 30, current: 5, temp: 0 }, conditions: ["Unconscious", "Prone"] });
    R.applyDamage(c, 5);
    eq(c.autoUnconscious, false);
    R.applyHealing(c, 3);
    ok(R.hasCondition(c, "Unconscious"), "still unconscious");
    ok(R.hasCondition(c, "Prone"), "prone untouched");
  });

  test("healing does not add Prone", () => {
    const c = pc({ hp: { max: 30, current: 1, temp: 0 } });
    R.applyDamage(c, 1);
    R.applyHealing(c, 1);
    ok(!R.hasCondition(c, "Prone"));
  });

  test("monsters at 0 HP are not given Unconscious", () => {
    const m = enemy();
    R.applyDamage(m, 99);
    ok(!R.hasCondition(m, "Unconscious"));
  });

  /* ---------- Temp HP ---------- */

  test("temp HP does not stack: keeps the higher value", () => {
    const c = pc({ hp: { max: 30, current: 30, temp: 8 } });
    eq(R.grantTempHp(c, 5), { applied: false, previous: 8, value: 5 });
    eq(c.hp.temp, 8);
    eq(R.grantTempHp(c, 12).applied, true);
    eq(c.hp.temp, 12);
  });

  /* ---------- Concentration ---------- */

  test("concentration DC is 10 or half the damage, with no cap at 30", () => {
    eq(R.concentrationDc(1), 10, "1 dmg");
    eq(R.concentrationDc(19), 10, "19 dmg");
    eq(R.concentrationDc(20), 10, "20 dmg");
    eq(R.concentrationDc(22), 11, "22 dmg");
    eq(R.concentrationDc(80), 40, "80 dmg");
    eq(R.concentrationDc(81), 40, "81 dmg rounds down");
  });

  test("damage sets a persistent concentration check that stacks", () => {
    const c = pc({ hp: { max: 100, current: 100, temp: 0 }, concentration: { active: true, spell: "Bless" } });
    R.applyDamage(c, 30);
    eq(c.concentrationCheck, { dc: 15, count: 1 });
    R.applyDamage(c, 4);
    eq(c.concentrationCheck, { dc: 10, count: 2 }, "latest DC, count 2");
  });

  test("dropping to 0 HP ends concentration with no save prompt", () => {
    const c = pc({ hp: { max: 10, current: 5, temp: 0 }, concentration: { active: true, spell: "Bless" } });
    R.applyDamage(c, 6);
    eq([c.concentration.active, c.concentrationCheck], [false, null]);
  });

  test("incapacitating conditions end concentration", () => {
    for (const cond of R.INCAPACITATING) {
      const c = pc({ concentration: { active: true, spell: "Haste" } });
      R.addCondition(c, cond);
      eq(c.concentration.active, false, cond);
    }
    const c = pc({ concentration: { active: true, spell: "Haste" } });
    R.addCondition(c, "Prone");
    eq(c.concentration.active, true, "Prone does not");
  });

  /* ---------- Initiative ---------- */

  test("enemy init bonus: blank falls back to DEX, explicit value wins", () => {
    eq(R.initBonusOf(enemy()), 1, "DEX 12");
    eq(R.initBonusOf(enemy({ initBonus: 5 })), 5);
    eq(R.initBonusOf(enemy({ initBonus: "" })), 1, "blank");
    eq(R.initBonusOf(pc({ initBonus: 0 })), 0, "zero is a real value");
  });

  test("initiative ties: lair loses, then init bonus, then DEX", () => {
    const enc = R.normalizeEncounter({
      combatants: [
        { type: "lair", initiative: 20 },
        enemy({ name: "Slow", initiative: 20, stats: { dex: 10 } }),
        enemy({ name: "Fast", initiative: 20, stats: { dex: 18 } }),
        enemy({ name: "Bonus", initiative: 20, initBonus: 9, stats: { dex: 8 } }),
        enemy({ name: "Same bonus lower dex", initiative: 20, initBonus: 4, stats: { dex: 16 } }),
        pc({ name: "Top", initiative: 21 }),
      ],
    });
    R.sortEncounter(enc);
    eq(enc.combatants.map((c) => c.name), ["Top", "Bonus", "Fast", "Same bonus lower dex", "Slow", "Lair Action"]);
  });

  /* ---------- Exhaustion ---------- */

  test("exhaustion effects are cumulative and level 6 is death", () => {
    eq(R.exhaustionEffects(0), []);
    eq(R.exhaustionEffects(3).length, 3);
    eq(R.exhaustionEffects(6).at(-1), "Death");
    ok(R.isDead(pc({ exhaustion: 6 })), "PC dead");
    ok(R.isDead(enemy({ exhaustion: 6 })), "enemy dead");
    ok(!R.isDead(pc({ exhaustion: 5 })), "level 5 alive");
  });

  test("every condition has an effect summary", () => {
    R.CONDITIONS.forEach((c) => ok(R.CONDITION_EFFECTS[c], c));
  });

  /* ---------- Proficiency by CR ---------- */

  test("proficiency bonus by CR for every CR from 0 to 30 (MM p.8)", () => {
    const expected = (n) => (n <= 4 ? 2 : n <= 8 ? 3 : n <= 12 ? 4 : n <= 16 ? 5 : n <= 20 ? 6 : n <= 24 ? 7 : n <= 28 ? 8 : 9);
    ["0", "1/8", "1/4", "1/2"].forEach((cr) => eq(R.profFromCr(cr), 2, `CR ${cr}`));
    for (let n = 1; n <= 30; n++) eq(R.profFromCr(String(n)), expected(n), `CR ${n}`);
  });

  /* ---------- Recharge ---------- */

  test("recharge rolls: meets the minimum to recharge", () => {
    const c = enemy({ recharges: [{ name: "Breath", min: 5, available: false }] });
    eq(R.rollRecharges(c, faces(6, 4)).length, 1);
    eq(c.recharges[0].available, false, "4 fails 5–6");
    R.rollRecharges(c, faces(6, 5));
    eq([c.recharges[0].available, c.recharges[0].lastRoll], [true, 5], "5 recharges");
  });

  test("recharge labels", () => {
    eq([R.rechargeLabel(6), R.rechargeLabel(5), R.rechargeLabel(4)], ["6", "5–6", "4–6"]);
  });

  /* ---------- Lazy Encounter Benchmark ---------- */

  test("benchmark tiers: under, approaching, over", () => {
    const party = [1, 2, 3, 4].map((i) => pc({ name: `P${i}`, level: 4 })); // 16 levels → benchmark 4
    const withCr = (...crs) => R.encounterDifficulty({
      combatants: [...party, ...crs.map((cr, i) => enemy({ name: `E${i}`, cr }))],
    });
    eq(withCr("1", "1").tier, "under", "2/4");
    eq(withCr("1", "2").tier, "under", "3/4 is exactly 0.75");
    eq(withCr("1", "2", "1/2").tier, "approaching", "3.5/4 is 0.875");
    eq(withCr("2", "2").tier, "approaching", "exactly at benchmark");
    eq(withCr("3", "2").tier, "over", "5/4");
    const high = R.encounterDifficulty({ combatants: [pc({ level: 5 }), enemy({ cr: "3" })] });
    eq(high.benchmark, 2.5, "½ of levels at 5th+");
  });

  test("single-monster hint only when exactly one enemy type dominates", () => {
    const party = [pc({ name: "A", level: 2 }), pc({ name: "B", level: 2 })]; // single cap CR 1
    const one = R.encounterDifficulty({ combatants: [...party, enemy({ name: "Ogre", cr: "2", templateId: "t-ogre" })] });
    ok(one.dominant && one.dominant.name === "Ogre", "one type");
    const two = R.encounterDifficulty({
      combatants: [...party, enemy({ name: "Ogre", cr: "2", templateId: "t-ogre" }), enemy({ name: "Troll", cr: "5", templateId: "t-troll" })],
    });
    eq(two.dominant, null, "two types");
    const pack = R.encounterDifficulty({
      combatants: [...party, enemy({ name: "Ogre 1", cr: "2", templateId: "t-ogre" }), enemy({ name: "Ogre 2", cr: "2", templateId: "t-ogre" })],
    });
    ok(pack.dominant, "a pack of one type still counts as one");
  });

  /* ---------- Spell slots ---------- */

  test("spell slot recovery defaults to long rest", () => {
    const c = pc({ spellSlots: [{ level: 1, max: 2, current: 2 }, { level: 3, max: 2, current: 1, recovery: "short" }] });
    eq(c.spellSlots.map((s) => s.recovery), ["long", "short"]);
  });

  /* ---------- Migration ---------- */

  test("v1 save migrates through the normalizers", () => {
    const s = R.migrateState(R.clone(V1_SAVE));
    eq(s.creatureLibrary.pcs.length, 1);
    eq(s.creatureLibrary.enemies.length, 2);
    eq(s.creatureLibrary.enemies[0].initBonus, null, "enemy init bonus defaults to DEX");
    eq(s.creatureLibrary.pcs[0].initBonus, 3, "PC init bonus kept");
    const enc = s.encounters[0];
    eq(enc.combatants.length, 4);
    eq(enc.round, 3);
    eq(s.ui.activeEncounterId, "enc-1");
    const aria = enc.combatants.find((c) => c.name === "Aria");
    eq(R.hasCondition(aria, "Prone"), true, "known condition kept");
    eq(aria.conditions.length, 1, "unknown condition dropped");
    eq(aria.autoUnconscious, false);
    eq(aria.concentrationCheck, null);
    eq(aria.spellSlots[0].recovery, "long");
    const drake = enc.combatants.find((c) => c.name === "Drake");
    eq(drake.recharges[0].available, false, "spent recharge kept");
    eq(enc.combatants[0].type, "lair");
    eq(enc.combatants[0].notes, "Rocks fall");
  });

  test("migration survives junk", () => {
    const s = R.migrateState({ creatureLibrary: { pcs: [null, 5, {}], enemies: "nope" }, encounters: [null, { combatants: [null] }], ui: { view: "bogus", activeEncounterId: "missing" } });
    eq(s.creatureLibrary.pcs.length, 1);
    eq(s.creatureLibrary.enemies.length, 0);
    eq(s.encounters.length, 1);
    eq(s.encounters[0].combatants.length, 0);
    eq(s.ui.view, "encounters");
    eq(s.ui.activeEncounterId, null);
  });

  /* ---------- Report ---------- */

  const failed = results.filter((r) => !r.ok);
  if (isNode) {
    results.forEach((r) => console.log(`${r.ok ? "  ok  " : "  FAIL"} ${r.name}${r.ok ? "" : `\n         ${r.message}`}`));
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    process.exitCode = failed.length ? 1 : 0;
  } else {
    root.TEST_RESULTS = results;
  }
})(typeof self !== "undefined" ? self : this);

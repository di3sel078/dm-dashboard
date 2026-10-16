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

  /* ---------- Damage types ---------- */

  test("resistance halves rounding down, vulnerability doubles, immunity zeroes", () => {
    const m = enemy({ damageResistances: ["fire"], damageVulnerabilities: ["bludgeoning"], damageImmunities: ["poison"] });
    eq(R.damageAfterDefenses(13, "fire", m).amount, 6, "13 fire resisted");
    eq(R.damageAfterDefenses(1, "fire", m).amount, 0, "1 fire resisted");
    eq(R.damageAfterDefenses(7, "bludgeoning", m).amount, 14, "vulnerable");
    eq(R.damageAfterDefenses(50, "poison", m).amount, 0, "immune");
    eq(R.damageAfterDefenses(9, "cold", m).amount, 9, "no defense");
    eq(R.damageAfterDefenses(9, "", m).amount, 9, "no type is raw");
    eq(R.damageAfterDefenses(12, "fire", m).note, "12 fire, resistant: 6");
  });

  test("resistance applies before vulnerability", () => {
    const m = enemy({ damageResistances: ["cold"], damageVulnerabilities: ["cold"] });
    eq(R.damageAfterDefenses(13, "cold", m).amount, 12, "13 → 6 → 12");
  });

  test("type modifiers apply before temp HP", () => {
    const m = enemy({ hp: { max: 15, current: 15, temp: 5 }, damageResistances: ["fire"] });
    const r = R.applyDamage(m, 20, { type: "fire" });
    eq([r.amount, r.result.absorbedByTemp, m.hp.current], [10, 5, 10]);
  });

  test("immune damage does not prompt a concentration save", () => {
    const m = enemy({ damageImmunities: ["fire"], concentration: { active: true, spell: "Web" } });
    R.applyDamage(m, 30, { type: "fire" });
    eq(m.concentrationCheck, null);
  });

  test("concentration DC uses damage after resistance", () => {
    const m = enemy({ hp: { max: 100, current: 100, temp: 0 }, damageResistances: ["fire"], concentration: { active: true, spell: "Web" } });
    R.applyDamage(m, 44, { type: "fire" });
    eq(m.concentrationCheck.dc, 11, "22 taken → DC 11");
  });

  test("condition immunity blocks the condition", () => {
    const m = enemy({ conditionImmunities: ["Poisoned", "Exhaustion"] });
    const r = R.addCondition(m, "Poisoned");
    eq([r.blocked, R.hasCondition(m, "Poisoned")], [true, false]);
    eq(R.changeExhaustion(m, 1).blocked, true);
    eq(m.exhaustion, 0);
    eq(R.changeExhaustion(m, -1).blocked, false, "lowering is never blocked");
  });

  /* ---------- Condition durations ---------- */

  test("v1 condition strings migrate to indefinite objects", () => {
    eq(R.normalizeConditions(["Prone", "Bogus", { name: "Blinded", endsOnRound: 4 }]),
      [{ name: "Blinded", endsOnRound: 4 }, { name: "Prone", endsOnRound: null }]);
  });

  test("a 2-round condition lasts through the next round and expires after it", () => {
    const enc = R.normalizeEncounter({ round: 3, combatants: [pc({ name: "A" }), enemy({ name: "B" })] });
    const a = enc.combatants[0];
    R.addCondition(a, "Blinded", { rounds: 2, round: 3 });
    eq(a.conditions[0].endsOnRound, 4);
    eq(R.roundsLeft(a.conditions[0], 3), 2);
    R.nextTurn(enc); R.nextTurn(enc); // → round 4
    eq(enc.round, 4);
    ok(R.hasCondition(a, "Blinded"), "still blinded in round 4");
    R.nextTurn(enc); const { events } = R.nextTurn(enc); // → round 5
    ok(!R.hasCondition(a, "Blinded"), "expired at round 5");
    ok(events.some((e) => e.text.includes("Blinded ends")), "expiry event");
  });

  test("indefinite conditions never expire", () => {
    const enc = R.normalizeEncounter({ combatants: [pc({ name: "A", conditions: ["Prone"] })] });
    for (let i = 0; i < 5; i++) R.nextTurn(enc);
    ok(R.hasCondition(enc.combatants[0], "Prone"));
  });

  /* ---------- Turn start effects ---------- */

  test("legendary actions refill at the start of the creature's own turn only", () => {
    const enc = R.normalizeEncounter({
      currentTurnIndex: 0,
      combatants: [
        pc({ name: "A", initiative: 20 }),
        enemy({ name: "Dragon", initiative: 10, legendaryActions: 3, legendaryActionsLeft: 0, legendaryResistance: 3, legendaryResistanceLeft: 1 }),
        pc({ name: "C", initiative: 5 }),
      ],
    });
    const dragon = enc.combatants[1];
    R.nextTurn(enc); // dragon's turn
    eq(dragon.legendaryActionsLeft, 3, "refilled");
    eq(dragon.legendaryResistanceLeft, 1, "legendary resistance does not refill");
    dragon.legendaryActionsLeft = 1;
    R.nextTurn(enc); // C's turn
    eq(dragon.legendaryActionsLeft, 1, "not refilled on someone else's turn");
  });

  test("reaction and bonus action reset only for the creature whose turn begins", () => {
    const enc = R.normalizeEncounter({
      combatants: [pc({ name: "A", reactionUsed: true }), enemy({ name: "B", reactionUsed: true, bonusActionUsed: true, readied: true })],
    });
    R.nextTurn(enc);
    const [a, b] = enc.combatants;
    eq([b.reactionUsed, b.bonusActionUsed, b.readied], [false, false, false], "B reset");
    eq(a.reactionUsed, true, "A untouched");
  });

  test("surprise ends when the creature's first turn ends", () => {
    const enc = R.normalizeEncounter({
      combatants: [pc({ name: "A", initiative: 20 }), enemy({ name: "B", initiative: 10, surprised: true }), enemy({ name: "C", initiative: 5, surprised: true })],
    });
    R.nextTurn(enc); // B's turn starts
    eq(enc.combatants[1].surprised, true, "still surprised during its turn");
    R.nextTurn(enc); // B's turn ends
    eq(enc.combatants[1].surprised, false, "B done");
    eq(enc.combatants[2].surprised, true, "C still surprised");
    R.nextTurn(enc); // round 2
    eq(enc.combatants[2].surprised, false, "cleared by round 2");
  });

  /* ---------- Delay ---------- */

  test("delay moves the current combatant to just after the target", () => {
    const enc = R.normalizeEncounter({
      round: 2,
      combatants: [
        pc({ name: "A", initiative: 18 }), enemy({ name: "B", initiative: 15 }),
        enemy({ name: "C", initiative: 12, stats: { dex: 18 } }), enemy({ name: "D", initiative: 12, stats: { dex: 8 } }),
        pc({ name: "E", initiative: 3 }),
      ],
    });
    R.sortEncounter(enc);
    R.delayTurn(enc, enc.combatants[2].instanceId); // A delays after C
    eq(enc.combatants.map((c) => c.name), ["B", "C", "A", "D", "E"]);
    eq(enc.combatants[enc.currentTurnIndex].name, "B", "B acts now");
    eq(enc.combatants[2].initiative, 12);
    eq(R.delayTurn(enc, enc.combatants[0].instanceId), null, "can't delay to an earlier combatant");
  });

  /* ---------- Initiative ---------- */

  test("initiative roll: enemies only, grouped by template", () => {
    const enc = R.normalizeEncounter({
      combatants: [
        pc({ name: "Hero", initiative: 17 }),
        { type: "lair", initiative: 20 },
        enemy({ name: "Goblin 1", templateId: "g", initBonus: 2 }),
        enemy({ name: "Goblin 2", templateId: "g", initBonus: 2 }),
        enemy({ name: "Boss", templateId: "b", initBonus: 5 }),
      ],
    });
    const events = R.rollInitiative(enc, { group: true, rng: faces(20, 10, 3) });
    const by = (n) => enc.combatants.find((c) => c.name === n);
    eq([by("Goblin 1").initiative, by("Goblin 2").initiative, by("Boss").initiative], [12, 12, 8]);
    eq(by("Hero").initiative, 17, "PC untouched");
    eq(by("Lair Action").initiative, 20, "lair untouched");
    eq(events.length, 2);
    ok(events[0].text.includes("Goblin ×2: d20 (10) +2 = 12"), events[0].text);
    R.rollInitiative(enc, { group: false, rng: faces(20, 1, 20, 5) });
    eq([by("Goblin 1").initiative, by("Goblin 2").initiative], [3, 22], "ungrouped");
  });

  /* ---------- Dice ---------- */

  test("dice parser accepts common expressions and rejects junk", () => {
    eq(R.parseDice("2d6+3"), [{ sign: 1, count: 2, sides: 6 }, { sign: 1, count: 3, sides: 0 }]);
    eq(R.parseDice("d20 - 1"), [{ sign: 1, count: 1, sides: 20 }, { sign: -1, count: 1, sides: 0 }]);
    eq(R.parseDice("d%")[0].sides, 100);
    ["", "2d", "abc", "1d6*2", "alert(1)", "1d6+", "101d6", "1d0", "2d6 3"].forEach((bad) => {
      let threw = false;
      try { R.parseDice(bad); } catch { threw = true; }
      ok(threw, `should reject "${bad}"`);
    });
  });

  test("dice totals and advantage", () => {
    eq(R.rollDice("2d6+3", { rng: faces(6, 4, 2) }).total, 9);
    eq(R.rollDice("1d8+1d6-2", { rng: () => 0.99 }).total, 8 + 6 - 2, "mixed");
    const adv = R.rollDice("d20+5", { mode: "adv", rng: faces(20, 7, 15) });
    eq([adv.total, adv.natural], [20, 15]);
    const dis = R.rollDice("d20+5", { mode: "dis", rng: faces(20, 7, 15) });
    eq(dis.total, 12);
    ok(R.rollDice("2d20", { mode: "adv", rng: faces(20, 1) }).text.includes("needs a single d20"));
  });

  test("attack damage expression", () => {
    eq(R.attackDamageExpr({ dmgDice: "1d6", dmgBonus: 2 }), "1d6+2");
    eq(R.attackDamageExpr({ dmgDice: "2d8", dmgBonus: -1 }), "2d8-1");
    eq(R.attackDamageExpr({ dmgDice: "", dmgBonus: 3 }), "3");
  });

  /* ---------- Log ---------- */

  test("combat log is capped at 300 entries", () => {
    const enc = R.normalizeEncounter({});
    for (let i = 0; i < 320; i++) R.pushLog(enc, "info", `entry ${i}`);
    eq(enc.log.length, 300);
    eq(enc.log[0].text, "entry 20");
    eq(R.normalizeEncounter({ log: enc.log.concat(enc.log) }).log.length, 300, "normalizer caps too");
  });

  /* ---------- Stat block ---------- */

  test("saves, skills, expertise and passive Perception", () => {
    const dragon = enemy({
      cr: "8", stats: { str: 19, dex: 12, con: 17, int: 16, wis: 13, cha: 15 },
      saves: ["dex", "con", "wis", "cha"], skills: ["perception", "stealth"], expertise: ["perception"],
    });
    eq(["dex", "con", "wis", "cha", "str"].map((k) => R.saveBonus(dragon, k)), [4, 6, 4, 5, 4]);
    eq(R.skillBonus(dragon, "perception"), 7, "expertise");
    eq(R.skillBonus(dragon, "stealth"), 4);
    eq(R.passivePerception(dragon), 17, "Young Green Dragon has passive 17");
    eq(R.passivePerception(pc({ stats: { wis: 14 } })), 12, "unskilled PC");
    eq(R.profOf(pc({ level: 9 })), 4, "PC prof by level");
  });

  test("save DC auto-fill is 8 + proficiency + ability", () => {
    eq(R.autoSaveDc(enemy({ cr: "8", stats: { con: 17 } }), "con"), 14);
  });

  test("save attacks normalise with sensible defaults", () => {
    const a = R.normalizeAttack({ name: "Breath", kind: "save", saveDc: 14, saveAbility: "con", halfOnSave: true });
    eq([a.kind, a.saveDc, a.saveAbility, a.halfOnSave, a.autoSaveDc], ["save", 14, "con", true, true]);
    eq(R.normalizeAttack({}).kind, "attack");
  });

  /* ---------- XP ---------- */

  test("XP by CR and encounter totals", () => {
    eq([R.xpForCr("0"), R.xpForCr("1/8"), R.xpForCr("1/4"), R.xpForCr("1/2"), R.xpForCr("1")], [10, 25, 50, 100, 200]);
    eq([R.xpForCr("8"), R.xpForCr("17"), R.xpForCr("30"), R.xpForCr("")], [3900, 18000, 155000, 0]);
    const enc = R.normalizeEncounter({ combatants: [pc(), enemy({ cr: "1/4" }), enemy({ cr: "1/4" }), enemy({ cr: "2" }), { type: "lair" }] });
    eq(R.encounterXp(enc), 550);
  });

  /* ---------- Rests ---------- */

  const restParty = () => R.normalizeEncounter({
    combatants: [
      pc({
        name: "Warlock", hp: { max: 30, current: 12, temp: 4 }, exhaustion: 2,
        spellSlots: [{ level: 1, max: 4, current: 1 }, { level: 3, max: 2, current: 0, recovery: "short" }],
      }),
      pc({ name: "Down", hp: { max: 20, current: 0, temp: 0 }, deathSaves: { success: 3, fail: 0 } }),
      enemy({
        name: "Lich", legendaryResistance: 3, legendaryResistanceLeft: 1, legendaryActions: 3, legendaryActionsLeft: 0,
        recharges: [{ name: "Breath", min: 5, available: false }],
      }),
      { type: "lair" },
    ],
  });

  test("long rest restores HP, slots, legendary resistance; exhaustion −1; ends temp HP", () => {
    const enc = restParty();
    const summary = R.applyRest(enc, "long");
    const [w, down, lich] = enc.combatants.filter((c) => c.type !== "lair");
    eq([w.hp.current, w.hp.temp, w.exhaustion], [30, 0, 1]);
    eq(w.spellSlots.map((s) => s.current), [4, 2]);
    eq([lich.legendaryResistanceLeft, lich.legendaryActionsLeft, lich.recharges[0].available], [3, 3, true]);
    eq(down.hp.current, 0, "0 HP gets no long rest benefit");
    ok(summary.find((s) => s.name === "Down").changes[0].includes("no benefit"));
  });

  test("short rest restores only short-rest slots and recharges", () => {
    const enc = restParty();
    R.applyRest(enc, "short");
    const [w, , lich] = enc.combatants.filter((c) => c.type !== "lair");
    eq(w.spellSlots.map((s) => s.current), [1, 2]);
    eq([w.hp.current, w.exhaustion], [12, 2]);
    eq([lich.recharges[0].available, lich.legendaryResistanceLeft], [true, 1]);
  });

  test("rest preview on a clone leaves the encounter alone", () => {
    const enc = restParty();
    const before = JSON.stringify(enc);
    R.applyRest(R.clone(enc), "long");
    eq(JSON.stringify(enc), before);
  });

  test("v1 fixture gains every v2 instance default", () => {
    const s = R.migrateState(R.clone(V1_SAVE));
    const gob = s.encounters[0].combatants.find((c) => c.name === "Goblin 1");
    eq(gob.conditions, [{ name: "Frightened", endsOnRound: null }]);
    eq([gob.legendaryActionsLeft, gob.reactionUsed, gob.surprised, gob.notes, gob.initRank], [0, false, false, "", 0]);
    eq(gob.attacks[0].kind, "attack");
    eq(gob.damageResistances, []);
    eq(s.encounters[0].log, []);
    eq(s.ui.cardMode, "full");
    eq(s.ui.groupInitiative, true);
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

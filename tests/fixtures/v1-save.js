/* A save file as written by the v1 app (localStorage "dm-dashboard-state-v1"). */
(function (root) {
  const V1_SAVE = {
    creatureLibrary: {
      pcs: [
        {
          id: "pc-aria",
          name: "Aria",
          hp: { max: 38 },
          ac: 15,
          speed: "30 ft.",
          stats: { str: 8, dex: 16, con: 14, int: 12, wis: 13, cha: 10 },
          spellSlots: [{ level: 1, max: 4, current: 2 }, { level: 2, max: 2, current: 2 }],
          level: 5,
          initBonus: 3,
          cls: "Ranger",
          race: "Wood Elf",
        },
      ],
      enemies: [
        {
          id: "en-goblin",
          name: "Goblin",
          hp: { max: 7 },
          ac: 15,
          speed: "30 ft.",
          stats: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
          spellSlots: [],
          cr: "1/4",
          skills: ["stealth"],
          attacks: [
            { name: "Scimitar", ability: "dex", toHit: 4, dmgDice: "1d6", dmgBonus: 2, dmgType: "slashing", autoToHit: true, autoDmg: true },
          ],
          recharges: [],
        },
        {
          id: "en-drake",
          name: "Drake",
          hp: { max: 52 },
          ac: 14,
          speed: "40 ft., fly 60 ft.",
          stats: { str: 16, dex: 12, con: 15, int: 6, wis: 10, cha: 8 },
          spellSlots: [],
          cr: "3",
          skills: [],
          attacks: [],
          recharges: [{ name: "Fire Breath", min: 5 }],
        },
      ],
    },
    encounters: [
      {
        id: "enc-1",
        name: "Ambush at the Ford",
        round: 3,
        currentTurnIndex: 1,
        clock: { elapsedMs: 125000, startedAt: null },
        combatants: [
          {
            instanceId: "i-lair", templateId: null, type: "lair", name: "Lair Action",
            initiative: 20, notes: "Rocks fall",
          },
          {
            instanceId: "i-aria", templateId: "pc-aria", type: "pc", name: "Aria", initiative: 18,
            hp: { max: 38, current: 0, temp: 0 }, ac: 15, speed: "30 ft.",
            stats: { str: 8, dex: 16, con: 14, int: 12, wis: 13, cha: 10 },
            spellSlots: [{ level: 1, max: 4, current: 1 }], level: 5, initBonus: 3, cls: "Ranger", race: "Wood Elf",
            conditions: ["Prone", "NotACondition"], exhaustion: 1,
            concentration: { active: false, spell: "Hunter's Mark" },
            deathSaves: { success: 1, fail: 1 },
          },
          {
            instanceId: "i-gob1", templateId: "en-goblin", type: "enemy", name: "Goblin 1", initiative: 12,
            hp: { max: 7, current: 3, temp: 2 }, ac: 15, speed: "30 ft.",
            stats: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 }, spellSlots: [],
            cr: "1/4", skills: ["stealth"],
            attacks: [{ name: "Scimitar", ability: "dex", toHit: 4, dmgDice: "1d6", dmgBonus: 2, dmgType: "slashing", autoToHit: true, autoDmg: true }],
            recharges: [], conditions: ["Frightened"], exhaustion: 0,
            concentration: { active: false, spell: "" }, deathSaves: { success: 0, fail: 0 },
          },
          {
            instanceId: "i-drake", templateId: "en-drake", type: "enemy", name: "Drake", initiative: 12,
            hp: { max: 52, current: 52, temp: 0 }, ac: 14, speed: "40 ft., fly 60 ft.",
            stats: { str: 16, dex: 12, con: 15, int: 6, wis: 10, cha: 8 }, spellSlots: [],
            cr: "3", skills: [], attacks: [],
            recharges: [{ name: "Fire Breath", min: 5, available: false, lastRoll: 3 }],
            conditions: [], exhaustion: 0,
            concentration: { active: true, spell: "Hold Person" }, deathSaves: { success: 0, fail: 0 },
          },
        ],
      },
    ],
    ui: { view: "active", activeEncounterId: "enc-1" },
  };
  if (typeof module === "object" && module.exports) module.exports = V1_SAVE;
  else root.V1_SAVE = V1_SAVE;
})(typeof self !== "undefined" ? self : this);

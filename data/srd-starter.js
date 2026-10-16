/* ==========================================================================
   DM Dashboard — SRD starter monsters
   A small hand-written set of 2014 (5e) monsters from the System Reference
   Document 5.1, licensed CC BY 4.0. See LICENSE-SRD.md for attribution.
   To-hit, damage bonus and save DC values are copied from the stat blocks
   rather than recomputed, so the builder's auto-fill is switched off.
   ========================================================================== */

(function (root) {
  "use strict";

  const ATTRIBUTION =
    "This work includes material taken from the System Reference Document 5.1 (“SRD 5.1”) by " +
    "Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. " +
    "The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at " +
    "https://creativecommons.org/licenses/by/4.0/legalcode.";

  /** Attack roll: name, ability, to hit, dice, bonus, type, note. */
  const hit = (name, ability, toHit, dmgDice, dmgBonus, dmgType, note = "") =>
    ({ name, kind: "attack", ability, toHit, dmgDice, dmgBonus, dmgType, note, autoToHit: false, autoDmg: false });
  /** Saving-throw effect: name, ability (for the DC), DC, target save, dice, type, half on save, note. */
  const save = (name, ability, saveDc, saveAbility, dmgDice, dmgType, halfOnSave, note = "") =>
    ({ name, kind: "save", ability, saveDc, saveAbility, dmgDice, dmgBonus: 0, dmgType, halfOnSave, note, autoSaveDc: false, autoDmg: false });
  const stats = (str, dex, con, int, wis, cha) => ({ str, dex, con, int, wis, cha });

  const PACK_TACTICS = "Pack Tactics. The creature has advantage on an attack roll against a creature if at least one of its allies is within 5 feet of the creature and the ally isn't incapacitated.";

  const MONSTERS = [
    {
      name: "Bandit", cr: "1/8", creatureType: "Medium humanoid (any race)", alignment: "any non-lawful alignment",
      ac: 12, hp: { max: 11 }, speed: "30 ft.", stats: stats(11, 12, 12, 10, 10, 10),
      languages: "any one language (usually Common)",
      attacks: [hit("Scimitar", "dex", 3, "1d6", 1, "slashing"), hit("Light Crossbow", "dex", 3, "1d8", 1, "piercing", "range 80/320 ft.")],
    },
    {
      name: "Cultist", cr: "1/8", creatureType: "Medium humanoid (any race)", alignment: "any non-good alignment",
      ac: 12, hp: { max: 9 }, speed: "30 ft.", stats: stats(11, 12, 10, 10, 11, 10),
      skills: ["deception", "religion"], languages: "any one language (usually Common)",
      traits: "Dark Devotion. The cultist has advantage on saving throws against being charmed or frightened.",
      attacks: [hit("Scimitar", "dex", 3, "1d6", 1, "slashing")],
    },
    {
      name: "Kobold", cr: "1/8", creatureType: "Small humanoid (kobold)", alignment: "lawful evil",
      ac: 12, hp: { max: 5 }, speed: "30 ft.", stats: stats(7, 15, 9, 8, 7, 8),
      senses: "darkvision 60 ft.", languages: "Common, Draconic",
      traits: "Sunlight Sensitivity. While in sunlight, the kobold has disadvantage on attack rolls, as well as on Wisdom (Perception) checks that rely on sight.\n" + PACK_TACTICS,
      attacks: [hit("Dagger", "dex", 4, "1d4", 2, "piercing"), hit("Sling", "dex", 4, "1d4", 2, "bludgeoning", "range 30/120 ft.")],
    },
    {
      name: "Goblin", cr: "1/4", creatureType: "Small humanoid (goblinoid)", alignment: "neutral evil",
      ac: 15, hp: { max: 7 }, speed: "30 ft.", stats: stats(8, 14, 10, 10, 8, 8),
      skills: ["stealth"], expertise: ["stealth"], senses: "darkvision 60 ft.", languages: "Common, Goblin",
      traits: "Nimble Escape. The goblin can take the Disengage or Hide action as a bonus action on each of its turns.",
      attacks: [hit("Scimitar", "dex", 4, "1d6", 2, "slashing"), hit("Shortbow", "dex", 4, "1d6", 2, "piercing", "range 80/320 ft.")],
    },
    {
      name: "Skeleton", cr: "1/4", creatureType: "Medium undead", alignment: "lawful evil",
      ac: 13, hp: { max: 13 }, speed: "30 ft.", stats: stats(10, 14, 15, 6, 8, 5),
      damageVulnerabilities: ["bludgeoning"], damageImmunities: ["poison"], conditionImmunities: ["Exhaustion", "Poisoned"],
      senses: "darkvision 60 ft.", languages: "understands all languages it knew in life but can't speak",
      attacks: [hit("Shortsword", "dex", 4, "1d6", 2, "piercing"), hit("Shortbow", "dex", 4, "1d6", 2, "piercing", "range 80/320 ft.")],
    },
    {
      name: "Wolf", cr: "1/4", creatureType: "Medium beast", alignment: "unaligned",
      ac: 13, hp: { max: 11 }, speed: "40 ft.", stats: stats(12, 15, 12, 3, 12, 6),
      skills: ["perception", "stealth"],
      traits: "Keen Hearing and Smell. The wolf has advantage on Wisdom (Perception) checks that rely on hearing or smell.\n" + PACK_TACTICS,
      attacks: [hit("Bite", "dex", 4, "2d4", 2, "piercing", "target: DC 11 STR save or knocked prone")],
    },
    {
      name: "Zombie", cr: "1/4", creatureType: "Medium undead", alignment: "neutral evil",
      ac: 8, hp: { max: 22 }, speed: "20 ft.", stats: stats(13, 6, 16, 3, 6, 5),
      saves: ["wis"], damageImmunities: ["poison"], conditionImmunities: ["Poisoned"],
      senses: "darkvision 60 ft.", languages: "understands the languages it knew in life but can't speak",
      traits: "Undead Fortitude. If damage reduces the zombie to 0 hit points, it must make a Constitution saving throw with a DC of 5 + the damage taken, unless the damage is radiant or from a critical hit. On a success, the zombie drops to 1 hit point instead.",
      attacks: [hit("Slam", "str", 3, "1d6", 1, "bludgeoning")],
    },
    {
      name: "Gnoll", cr: "1/2", creatureType: "Medium humanoid (gnoll)", alignment: "chaotic evil",
      ac: 15, hp: { max: 22 }, speed: "30 ft.", stats: stats(14, 12, 11, 6, 10, 7),
      senses: "darkvision 60 ft.", languages: "Gnoll",
      traits: "Rampage. When the gnoll reduces a creature to 0 hit points with a melee attack on its turn, the gnoll can take a bonus action to move up to half its speed and make a bite attack.",
      attacks: [
        hit("Bite", "str", 4, "1d4", 2, "piercing"),
        hit("Spear", "str", 4, "1d6", 2, "piercing", "or 1d8 + 2 two-handed; range 20/60 ft."),
        hit("Longbow", "dex", 3, "1d8", 1, "piercing", "range 150/600 ft."),
      ],
    },
    {
      name: "Hobgoblin", cr: "1/2", creatureType: "Medium humanoid (goblinoid)", alignment: "lawful evil",
      ac: 18, hp: { max: 11 }, speed: "30 ft.", stats: stats(13, 12, 12, 10, 10, 9),
      senses: "darkvision 60 ft.", languages: "Common, Goblin",
      traits: "Martial Advantage. Once per turn, the hobgoblin can deal an extra 7 (2d6) damage to a creature it hits with a weapon attack if that creature is within 5 feet of an ally of the hobgoblin that isn't incapacitated.",
      attacks: [
        hit("Longsword", "str", 3, "1d8", 1, "slashing", "or 1d10 + 1 two-handed"),
        hit("Longbow", "dex", 3, "1d8", 1, "piercing", "range 150/600 ft."),
      ],
    },
    {
      name: "Orc", cr: "1/2", creatureType: "Medium humanoid (orc)", alignment: "chaotic evil",
      ac: 13, hp: { max: 15 }, speed: "30 ft.", stats: stats(16, 12, 16, 7, 11, 10),
      skills: ["intimidation"], senses: "darkvision 60 ft.", languages: "Common, Orc",
      traits: "Aggressive. As a bonus action, the orc can move up to its speed toward a hostile creature that it can see.",
      attacks: [hit("Greataxe", "str", 5, "1d12", 3, "slashing"), hit("Javelin", "str", 5, "1d6", 3, "piercing", "reach 5 ft. or range 30/120 ft.")],
    },
    {
      name: "Brown Bear", cr: "1", creatureType: "Large beast", alignment: "unaligned",
      ac: 11, hp: { max: 34 }, speed: "40 ft., climb 30 ft.", stats: stats(19, 10, 16, 2, 13, 7),
      skills: ["perception"],
      traits: "Keen Smell. The bear has advantage on Wisdom (Perception) checks that rely on smell.",
      multiattack: "The bear makes two attacks: one with its bite and one with its claws.",
      attacks: [hit("Bite", "str", 6, "1d8", 4, "piercing"), hit("Claws", "str", 6, "2d6", 4, "slashing")],
    },
    {
      name: "Bugbear", cr: "1", creatureType: "Medium humanoid (goblinoid)", alignment: "chaotic evil",
      ac: 16, hp: { max: 27 }, speed: "30 ft.", stats: stats(15, 14, 13, 8, 11, 9),
      skills: ["stealth", "survival"], expertise: ["stealth"], senses: "darkvision 60 ft.", languages: "Common, Goblin",
      traits: "Brute. A melee weapon deals one extra die of its damage when the bugbear hits with it (included in the attack).\n" +
        "Surprise Attack. If the bugbear surprises a creature and hits it with an attack during the first round of combat, the target takes an extra 7 (2d6) damage from the attack.",
      attacks: [
        hit("Morningstar", "str", 4, "2d8", 2, "piercing"),
        hit("Javelin", "str", 4, "2d6", 2, "piercing", "melee; 1d6 + 2 at range 30/120 ft."),
      ],
    },
    {
      name: "Dire Wolf", cr: "1", creatureType: "Large beast", alignment: "unaligned",
      ac: 14, hp: { max: 37 }, speed: "50 ft.", stats: stats(17, 15, 15, 3, 12, 7),
      skills: ["perception", "stealth"],
      traits: "Keen Hearing and Smell. The wolf has advantage on Wisdom (Perception) checks that rely on hearing or smell.\n" + PACK_TACTICS,
      attacks: [hit("Bite", "str", 5, "2d6", 3, "piercing", "target: DC 13 STR save or knocked prone")],
    },
    {
      name: "Ghoul", cr: "1", creatureType: "Medium undead", alignment: "chaotic evil",
      ac: 12, hp: { max: 22 }, speed: "30 ft.", stats: stats(13, 15, 10, 7, 10, 6),
      damageImmunities: ["poison"], conditionImmunities: ["Charmed", "Exhaustion", "Poisoned"],
      senses: "darkvision 60 ft.", languages: "Common",
      attacks: [
        hit("Bite", "str", 2, "2d6", 2, "piercing"),
        hit("Claws", "dex", 4, "2d4", 2, "slashing", "creature other than an elf or undead: DC 10 CON save or paralyzed for 1 minute (repeat at end of each turn)"),
      ],
    },
    {
      name: "Ogre", cr: "2", creatureType: "Large giant", alignment: "chaotic evil",
      ac: 11, hp: { max: 59 }, speed: "40 ft.", stats: stats(19, 8, 16, 5, 7, 7),
      senses: "darkvision 60 ft.", languages: "Common, Giant",
      attacks: [hit("Greatclub", "str", 6, "2d8", 4, "bludgeoning"), hit("Javelin", "str", 6, "2d6", 4, "piercing", "reach 5 ft. or range 30/120 ft.")],
    },
    {
      name: "Owlbear", cr: "3", creatureType: "Large monstrosity", alignment: "unaligned",
      ac: 13, hp: { max: 59 }, speed: "40 ft.", stats: stats(20, 12, 17, 3, 12, 7),
      skills: ["perception"], senses: "darkvision 60 ft.",
      traits: "Keen Sight and Smell. The owlbear has advantage on Wisdom (Perception) checks that rely on sight or smell.",
      multiattack: "The owlbear makes two attacks: one with its beak and one with its claws.",
      attacks: [hit("Beak", "str", 7, "1d10", 5, "piercing"), hit("Claws", "str", 7, "2d8", 5, "slashing")],
    },
    {
      name: "Young Green Dragon", cr: "8", creatureType: "Large dragon", alignment: "lawful evil",
      ac: 18, hp: { max: 136 }, speed: "40 ft., fly 80 ft., swim 40 ft.", stats: stats(19, 12, 17, 16, 13, 15),
      saves: ["dex", "con", "wis", "cha"], skills: ["deception", "perception", "stealth"], expertise: ["perception"],
      damageImmunities: ["poison"], conditionImmunities: ["Poisoned"],
      senses: "blindsight 30 ft., darkvision 120 ft.", languages: "Common, Draconic",
      traits: "Amphibious. The dragon can breathe air and water.",
      multiattack: "The dragon makes three attacks: one with its bite and two with its claws.",
      attacks: [
        hit("Bite", "str", 7, "2d10", 4, "piercing", "reach 10 ft.; plus 7 (2d6) poison"),
        hit("Claw", "str", 7, "2d6", 4, "slashing"),
        save("Poison Breath", "con", 14, "con", "12d6", "poison", true, "30-foot cone; recharge 5–6"),
      ],
      recharges: [{ name: "Poison Breath", min: 5 }],
    },
    {
      name: "Adult Red Dragon", cr: "17", creatureType: "Huge dragon", alignment: "chaotic evil",
      ac: 19, hp: { max: 256 }, speed: "40 ft., climb 40 ft., fly 80 ft.", stats: stats(27, 10, 25, 16, 13, 21),
      saves: ["dex", "con", "wis", "cha"], skills: ["perception", "stealth"], expertise: ["perception"],
      damageImmunities: ["fire"], senses: "blindsight 60 ft., darkvision 120 ft.", languages: "Common, Draconic",
      legendaryActions: 3, legendaryResistance: 3,
      traits: "Legendary Resistance (3/Day). If the dragon fails a saving throw, it can choose to succeed instead.",
      multiattack: "The dragon can use its Frightful Presence. It then makes three attacks: one with its bite and two with its claws.",
      attacks: [
        hit("Bite", "str", 14, "2d10", 8, "piercing", "reach 10 ft.; plus 7 (2d6) fire"),
        hit("Claw", "str", 14, "2d6", 8, "slashing"),
        hit("Tail", "str", 14, "2d8", 8, "bludgeoning", "reach 15 ft."),
        save("Frightful Presence", "cha", 19, "wis", "", "", false, "each chosen creature within 120 ft.: frightened for 1 minute; immune for 24 hours on a success"),
        save("Fire Breath", "con", 21, "dex", "18d6", "fire", true, "60-foot cone; recharge 5–6"),
      ],
      recharges: [{ name: "Fire Breath", min: 5 }],
      legendaryText:
        "Detect. The dragon makes a Wisdom (Perception) check.\n" +
        "Tail Attack. The dragon makes a tail attack.\n" +
        "Wing Attack (Costs 2 Actions). The dragon beats its wings. Each creature within 10 feet of the dragon must succeed on a DC 22 Dexterity saving throw or take 15 (2d6 + 8) bludgeoning damage and be knocked prone. The dragon can then fly up to half its flying speed.",
    },
  ];

  const api = { ATTRIBUTION, MONSTERS };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DM_SRD_STARTER = api;
})(typeof self !== "undefined" ? self : this);

export const MAP = [

  // -- scope completions + go to definition --
  // open sword.item.json and press Ctrl+Space inside any "::" string
  // Ctrl+Click on a variable to jump here
  {
    source: "sword.item.json",
    target: "BP/items/sword.item.json",
    jsonTemplate: true,
    scope: {
      id: "my_addon:iron_sword",
      displayName: "Iron Sword",
      damage: 5,
      durability: 200,
      cooldown: 1.5,
      repairItem: "minecraft:iron_ingot",
      tags: ["my_addon:sword", "my_addon:weapon"],
    },
  },

  // -- :autoFlat inlay hint + hover --
  // hover over :autoFlat to see the resolved path
  // inlay hint should appear at end of the target line
  {
    source: "**/*.particle.json",
    target: ":autoFlat",
  },

  // -- onConflict merge pre-selection --
  // place cursor inside the onConflict string and press Ctrl+Space
  // "merge" should be pre-selected
  {
    source: "sound_definitions.json",
    target: "RP/sounds/sound_definitions.json",
    onConflict: "merge",
  },

  // -- onConflict appendEnd pre-selection --
  // place cursor inside the onConflict string and press Ctrl+Space
  // "appendEnd" should be pre-selected
  {
    source: "items.lang",
    target: "RP/texts/en_US.lang",
    textTemplate: true,
    onConflict: "appendEnd",
  },

  // -- diagnostic error --
  // this file does not exist — should show a red underline
  {
    source: "missing_file.item.json",
    target: "BP/items/missing_file.item.json",
  },

  // -- diagnostic warning --
  // no files match this glob — should show a yellow underline
  {
    source: "**/*.doesnotexist.json",
    target: ":autoFlat",
  },

];
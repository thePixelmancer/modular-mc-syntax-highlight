export const AUTO_MAP = {
  // Behavior Pack
  ".behavior.json": "BP/entities",
  ".item.json": "BP/items",
  ".block.json": "BP/blocks",
  ".recipe.json": "BP/recipes",
  ".loot.json": "BP/loot_tables",
  ".spawn_rule.json": "BP/spawn_rules",

  // Resource Pack
  ".entity.json": "RP/entity",
  ".geo.json": "RP/models/entity",
  ".animation.json": "RP/animations",
  ".rp_ac.json": "RP/animation_controllers",
  ".attachable.json": "RP/attachables",
  ".particle.json": "RP/particles",
  ".lang": "RP/texts",

  // Textures — specific suffixes first, general .png last
  ".item.png": {
    path: "RP/textures/items",
    extension: ".png",
  },
  ".entity.png": {
    path: "RP/textures/entity",
    extension: ".png",
  },
  ".block.png": {
    path: "RP/textures/blocks",
    extension: ".png",
  },
  ".png": "RP/textures",

  // Sounds
  ".ogg": "RP/sounds",
  ".wav": "RP/sounds",
};

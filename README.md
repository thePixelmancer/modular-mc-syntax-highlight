# Modular MC Syntax

VS Code extension providing syntax highlighting and IntelliSense for [ModularMC](https://modular-mc-docs.readthedocs.io/en/stable/) — a Regolith filter for structured Minecraft Bedrock addon development.

---

## Features

### TypeScript Syntax Highlighting in JSON

Any JSON string value prefixed with `::` is highlighted as TypeScript:

```json
{
  "identifier": "::`my_addon:${weapon.id}`",
  "duration": "::weapon.cooldown",
  "repair_items": "::weapon.repairList"
}
```

### TypeScript Syntax Highlighting in Text Files

Any block wrapped in `{ts: :}` in `.lang` or `.txt` files is highlighted as TypeScript:

```
item.name={ts: `${capitalize(id)}` :}
item.desc={ts: buildDescription(weapon) :}
```

### Scope IntelliSense in Template Files

When editing a file that is mapped by a `_map.ts` file, pressing `Ctrl+Space` inside a `"::` or `{ts:` region suggests variables from the `scope` defined for that mapping entry.

Nested properties are fully supported — typing `weapon.` suggests all properties of the `weapon` object:

```json
"damage": "::weapon.",
//                ^ suggests: id, name, tier, damage, cooldown, durability ...
```

The extension walks up the directory tree to find the nearest `_map.ts`, matches the current file against the `source` glob of each MAP entry, and extracts the `scope` statically. Spread operators like `...weapon` are resolved using the first element of the source array as a representative shape.

### MAP Entry Field IntelliSense

Inside any `_map.ts` file, typing inside a MAP array entry object suggests all available fields. Fields already present in the entry are filtered out automatically:

| Field          | Type               | Description                                           |
| -------------- | ------------------ | ----------------------------------------------------- |
| `source`       | `string`           | Source file path relative to module directory         |
| `target`       | `string \| object` | Target path — supports `:auto` and `:autoFlat`        |
| `jsonTemplate` | `boolean`          | Enable `::` TypeScript expressions in JSON strings    |
| `textTemplate` | `boolean`          | Enable `{ts: :}` TypeScript expressions in text files |
| `onConflict`   | `string`           | Conflict resolution strategy                          |
| `fileType`     | `string`           | Override automatic file type detection                |
| `scope`        | `object`           | Variables available in templates for this entry       |

### :auto and :autoFlat Resolution

The extension reads the `auto-map.ts` file in your ModularMC root and resolves what `:auto` and `:autoFlat` will evaluate to for a given source file.

**Hover** over `:auto` or `:autoFlat` in any `target` field to see the resolved path:

```typescript
{
  source: "iron_sword.item.json",
  target: ":autoFlat",   // hover → BP/items/iron_sword.item.json
}
```

**Completion dropdown** for `target` also shows the resolved path in the detail column next to each option before you commit to it.

Resolution uses **longest suffix matching** against the `AUTO_MAP` keys — so `iron_sword.item.json` matches `.item.json` rather than `.json`.

The difference between the two keywords:

- `:autoFlat` — drops the file directly into the resolved directory, ignoring any subfolders in the source path
- `:auto` — preserves the subfolder structure relative to the module directory

### target and onConflict Value Suggestions

Typing inside a `target` or `onConflict` string value surfaces all valid options:

**target**

- `:autoFlat` — flatten matched files into their pack root
- `:auto` — automatically resolve target path

**onConflict**

- `stop` — (default) stop and report an error
- `skip` — skip this entry and continue
- `merge` — deep merge files (JSON only)
- `overwrite` — overwrite the existing file
- `appendEnd` — append to end of existing file (text only)
- `appendStart` — prepend to beginning of existing file (text only)

The extension also **pre-selects the most likely value** based on the `source` field in the same entry:

- `.lang` source → `appendEnd` pre-selected
- `item_texture.json`, `terrain_texture.json`, `sound_definitions.json` → `merge` pre-selected

### Snippets

The following snippets are available in TypeScript files:

| Prefix             | Inserts                               |
| ------------------ | ------------------------------------- |
| `map`              | `export const MAP = []`               |
| `scripts`          | `export const SCRIPTS = []`           |
| `mapscripts`       | Both MAP and SCRIPTS exports          |
| `mapentry`         | MAP entry with template and scope     |
| `mapentrysimple`   | MAP entry with source and target only |
| `mapentryconflict` | MAP entry with onConflict             |
| `mapentryfull`     | MAP entry with all fields             |
| `onConflict`       | `onConflict` field with value picker  |
| `fileType`         | `fileType` field with value picker    |

---

## Requirements

- VS Code `^1.74.0`
- [ModularMC Regolith filter](https://modular-mc-docs.readthedocs.io/en/stable/)
- A `.lang` language extension (e.g. Blockception's Minecraft Bedrock Development) for `.lang` file highlighting
- An `auto-map.ts` file in the ModularMC root for `:auto` / `:autoFlat` resolution

---

## How Scope Resolution Works

Given a `_map.ts` like:

```typescript
export const weapons = [
  { name: "iron_sword", tier: 1, damage: 5, durability: 200 },
  { name: "gold_sword", tier: 2, damage: 7, durability: 100 },
];

export const MAP = [
  ...weapons.map((weapon) => ({
    source: "items/weapon.item.json",
    target: `BP/items/${weapon.name}.item.json`,
    jsonTemplate: true,
    scope: {
      weapon: {
        ...weapon,
        id: `my_addon:${weapon.name}`,
        displayName: capitalize(weapon.name),
      },
    },
  })),
];
```

When editing `items/weapon.item.json`, the extension:

1. Walks up the directory tree to find `_map.ts`
2. Matches `items/weapon.item.json` against each entry's `source` glob
3. Finds the matching `.map()` call and extracts the arrow function body
4. Resolves `...weapon` by using the first element of `weapons` as a representative shape
5. Evaluates template literals like `` `my_addon:${weapon.name}` `` using those values
6. Offers the resulting scope as IntelliSense completions inside `"::` and `{ts:` regions

Dynamic values (function calls like `capitalize(weapon.name)`) are shown as `<dynamic: capitalize(...)>` — they still appear as completion suggestions so you know the key exists.

---

## Known Limitations

- Scope resolution is **static best-effort** — complex runtime expressions cannot be fully evaluated
- The JSON `"::` syntax only highlights single-line expressions (multiline TS inside a JSON string value is not supported by the TextMate grammar engine)
- Scope completions require the file to be reachable from a `_map.ts` via the source glob
- `:auto` / `:autoFlat` resolution requires an `auto-map.ts` file to be present in a parent directory;

---

## License

MIT — [Pixelmancer](https://github.com/thePixelmancer)

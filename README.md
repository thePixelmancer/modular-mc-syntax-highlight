# Modular MC

VS Code extension providing syntax highlighting and IntelliSense for [ModularMC](https://modular-mc-docs.readthedocs.io/en/stable/) — a Regolith filter for structured Minecraft Bedrock addon development.

---

## Features

### TypeScript Syntax Highlighting in JSON

Any JSON string value prefixed with `::` is highlighted as TypeScript:

```json
{
  "identifier": "::`my_addon:${weapon.id}`",
  "damage": "::weapon.damage",
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

When editing a file mapped by a `_map.ts`, pressing `Ctrl+Space` inside a `"::` or `{ts:` region suggests variables from the `scope` defined for that entry.

Nested properties are fully supported — typing `weapon.` suggests all properties of the `weapon` object:

```json
"damage": "::weapon.",
//                ^ suggests: id, name, tier, damage, cooldown, durability ...
```

The extension walks up the directory tree to find the nearest `_map.ts` that covers the current file, matches it against the `source` glob of each MAP entry, and extracts the `scope` statically. Spread operators like `...weapon` are resolved using the first element of the source array as a representative shape.

Dynamic values (function calls like `capitalize(weapon.name)`) appear as `<dynamic: capitalize(...)>` — they still show as suggestions so you know the key exists.

### Go to Definition from Template Files

`Ctrl+Click` on any scope variable inside a `"::` or `{ts:` region jumps directly to where that key is defined in the `_map.ts` scope object.

```json
"spell": "::weapon.spell"
//              ^ Ctrl+Click → jumps to `spell` key in _map.ts scope
```

Works for nested paths too — `weapon.id` navigates to the `id` key inside the `weapon` object.

### MAP Entry Field IntelliSense

Inside any `_map.ts` file, typing inside a MAP array entry object suggests all available fields. Fields already present in the entry are filtered out automatically:

| Field | Type | Description |
|---|---|---|
| `source` | `string` | Source file path relative to module directory |
| `target` | `string \| object` | Target path — supports `:auto` and `:autoFlat` |
| `jsonTemplate` | `boolean` | Enable `::` TypeScript expressions in JSON strings |
| `textTemplate` | `boolean` | Enable `{ts: :}` TypeScript expressions in text files |
| `onConflict` | `string` | Conflict resolution strategy |
| `fileType` | `string` | Override automatic file type detection |
| `scope` | `object` | Variables available in templates for this entry |

### :auto and :autoFlat Resolution

The extension reads your `auto-map.ts` file and resolves what `:auto` and `:autoFlat` evaluate to for any given source file.

**Hover** over `:auto` or `:autoFlat` in a `target` field to see the resolved path:

```typescript
{
  source: "iron_sword.item.json",
  target: ":autoFlat",   // hover → BP/items/@team/@proj/iron_sword.item.json
}
```

**Inlay hints** show the resolved path as ghost text directly on the line — no hover needed:

```typescript
  target: ":autoFlat",  → BP/items/@team/@proj/iron_sword.item.json
```

**Completion dropdown** for `target` also shows the resolved path in the detail column before you commit.

Resolution uses **first match wins** — entries in `AUTO_MAP` are matched top to bottom, so more specific suffixes should appear above general ones. For example `iron_sword.item.json` matches `.item.json` before `.json`.

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

### Diagnostics

The extension validates `source` values in `_map.ts` files and reports problems inline:

- **Error** — a specific (non-glob) source path that doesn't exist on disk
- **Warning** — a glob pattern that matches no files in the module folder

```typescript
{
  source: "items/sword.item.json",  // ← red error if file doesn't exist
  source: "**/*.missing.json",      // ← yellow warning if no files match
}
```

### Snippets

The following snippets are available in TypeScript files:

| Prefix | Inserts |
|---|---|
| `map` | `export const MAP = []` |
| `scripts` | `export const SCRIPTS = []` |
| `mapscripts` | Both MAP and SCRIPTS exports |
| `mapentry` | MAP entry with template and scope |
| `mapentrysimple` | MAP entry with source and target only |
| `mapentryconflict` | MAP entry with onConflict |
| `mapentryfull` | MAP entry with all fields |
| `onConflict` | `onConflict` field with value picker |
| `fileType` | `fileType` field with value picker |

---

## Requirements

- VS Code `^1.100.0`
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

1. Walks up the directory tree to find the nearest `_map.ts` that covers this file
2. Matches `items/weapon.item.json` against each entry's `source` glob
3. Finds the matching `.map()` call and extracts the arrow function body
4. Resolves `...weapon` using the first element of `weapons` as a representative shape
5. Evaluates template literals like `` `my_addon:${weapon.name}` `` using those values
6. Offers the resulting scope as completions inside `"::` and `{ts:` regions

---

## Known Limitations

- Scope resolution is **static best-effort** — complex runtime expressions cannot be fully evaluated
- The JSON `"::` syntax only highlights single-line expressions — multiline TS inside a JSON string is not supported by the TextMate grammar engine
- Scope completions require the file to be reachable from a `_map.ts` via the source glob
- `:auto` / `:autoFlat` resolution requires an `auto-map.ts` in a parent directory — `@team`, `@proj`, and `@namespace` placeholders are shown as-is since they are runtime values
- Diagnostics only check static (non-glob `.map()`) entries — dynamic entries using array `.map()` are skipped

---

## License

MIT — [Pixelmancer](https://github.com/thePixelmancer)
import * as fs from "fs";
import * as path from "path";

type AutoMapEntry = string | { path: string; extension: string };

// Ordered array to preserve definition order — first match wins
type AutoMap = Array<[string, AutoMapEntry]>;

/**
 * Resolves what a `:auto` or `:autoFlat` target keyword evaluates to
 * for a given source glob, by looking up the nearest `auto-map.ts` file.
 *
 * Returns the resolved output path, or null if no match is found.
 *
 * Examples:
 *   "sword.item.json" + ":autoFlat" → "BP/items/@team/@proj/sword.item.json"
 *   "entities/zombie.behavior.json" + ":auto" → "BP/entities/@team/@proj/entities/zombie.behavior.json"
 */
export function resolveAutoTarget(
  sourceGlob: string,
  targetKeyword: ":auto" | ":autoFlat",
  mapFilePath: string
): string | null {
  const autoMap = findAndParseAutoMap(mapFilePath);
  if (!autoMap) return null;

  // Use just the filename for suffix matching — ignore leading path/glob segments
  // e.g. "some/folder/**/*.rp_ac.json" → "*.rp_ac.json"
  const fileName = path.basename(sourceGlob);

  const match = firstMatchingSuffix(fileName, autoMap);
  if (!match) return null;

  const [suffix, entry] = match;
  const dirPath = typeof entry === "string" ? entry : entry.path;
  const customExt = typeof entry === "object" ? entry.extension : null;

  // Strip matched suffix from filename and apply the output extension
  // e.g. "sword.item.json" with suffix ".item.json" → base "sword", ext ".item.json"
  const baseName = fileName.startsWith("*") ? "*" : fileName.slice(0, fileName.length - suffix.length);
  const finalExt = customExt ?? suffix;
  const finalFileName = baseName + finalExt;

  if (targetKeyword === ":autoFlat") {
    // Drop file directly into the resolved directory, no subfolder structure
    return `${dirPath}/${finalFileName}`;
  } else {
    // :auto — preserve subfolder path from the source glob
    // e.g. source "entities/zombie.behavior.json" → keep "entities/" prefix
    const sourceDir = path.dirname(sourceGlob);
    const relativeDir = sourceDir !== "." ? sourceDir : "";

    return relativeDir
      ? `${dirPath}/${relativeDir}/${finalFileName}`
      : `${dirPath}/${finalFileName}`;
  }
}

/**
 * Returns the first [suffix, entry] pair whose suffix the filename ends with.
 * First match wins — AUTO_MAP entries should be ordered most-specific first.
 */
function firstMatchingSuffix(fileName: string, autoMap: AutoMap): [string, AutoMapEntry] | null {
  for (const [suffix, entry] of autoMap) {
    if (fileName.endsWith(suffix)) {
      return [suffix, entry];
    }
  }
  return null;
}

/**
 * Walks up the directory tree from the _map.ts location to find
 * the nearest `auto-map.ts` file.
 */
function findAndParseAutoMap(mapFilePath: string): AutoMap | null {
  let dir = path.dirname(mapFilePath);
  const root = path.parse(dir).root;

  while (dir !== root) {
    const candidate = path.join(dir, "auto-map.ts");
    if (fs.existsSync(candidate)) {
      return parseAutoMapFile(candidate);
    }
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * Parses an `auto-map.ts` file into an ordered [suffix, entry] array
 * using regex — no AST parser needed since AUTO_MAP is always a flat object literal.
 *
 * Handles three value forms:
 *   ".ext": "some/path"
 *   ".ext": `some/path/${expr}`   (template literal — kept as-is, expressions not evaluated)
 *   ".ext": { path: "some/path", extension: ".ext" }
 */
function parseAutoMapFile(filePath: string): AutoMap | null {
  const source = fs.readFileSync(filePath, "utf-8");
  const result: AutoMap = [];

  const entryPattern = /["']([^"']+)["']\s*:\s*(?:`([^`]*)`|"([^"]+)"|'([^']+)'|\{([^}]+)\})/g;

  let match: RegExpExecArray | null;
  while ((match = entryPattern.exec(source)) !== null) {
    const suffix = match[1];
    const templateValue = match[2]; // backtick — used as-is, ${...} kept literally
    const doubleValue   = match[3];
    const singleValue   = match[4];
    const objectValue   = match[5];

    const simpleValue = templateValue ?? doubleValue ?? singleValue;

    if (simpleValue !== undefined) {
      result.push([suffix, simpleValue]);
    } else if (objectValue !== undefined) {
      const pathMatch = objectValue.match(/path\s*:\s*(?:`([^`]*)`|"([^"]+)"|'([^']+)')/);
      const extMatch  = objectValue.match(/extension\s*:\s*["']([^"']+)["']/);
      if (pathMatch) {
        const entryPath = pathMatch[1] ?? pathMatch[2] ?? pathMatch[3];
        result.push([suffix, {
          path: entryPath,
          extension: extMatch ? extMatch[1] : suffix,
        }]);
      }
    }
  }

  return result.length > 0 ? result : null;
}
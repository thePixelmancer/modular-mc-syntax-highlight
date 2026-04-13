import * as fs from "fs";
import * as path from "path";
import * as acorn from "acorn";

// ---- Glob matching ----

/**
 * Tests whether a relative file path matches a glob pattern.
 * Supports * (single segment) and ** (zero or more segments).
 *
 * Examples:
 *   matchesGlob("items/sword.item.json", "items/*.item.json") → true
 *   matchesGlob("sword.item.json", "**\/*.item.json") → true
 *   matchesGlob("a/b/c.json", "**\/*.json") → true
 *   matchesGlob("a/b/c.json", "*.json") → false (single * doesn't cross /)
 */
export function matchesGlob(filePath: string, glob: string): boolean {
  const file = filePath.replace(/\\/g, "/");
  const pattern = glob.replace(/\\/g, "/");
  const parts = pattern.split("/");
  let regexStr = "";

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part === "**") {
      // (?:.*/)? already includes the trailing slash — don't add another
      regexStr += "(?:.*/)?";
    } else {
      const escaped = part
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, "[^/]+");
      regexStr += escaped;
      if (i < parts.length - 1) regexStr += "/";
    }
  }

  return new RegExp(`^${regexStr}$`).test(file);
}

// ---- Acorn AST helpers ----

/**
 * Parses a TypeScript/JavaScript file into an acorn AST.
 * Returns null if the file can't be read or parsed.
 */
export function parseAcornFile(filePath: string): acorn.Program | null {
  try {
    const source = fs.readFileSync(filePath, "utf-8");
    return acorn.parse(source, {
      ecmaVersion: 2020,
      sourceType: "module",
    }) as acorn.Program;
  } catch {
    return null;
  }
}

/**
 * Parses a source string into an acorn AST.
 * Returns null if parsing fails.
 */
export function parseAcornSource(source: string): acorn.Program | null {
  try {
    return acorn.parse(source, {
      ecmaVersion: 2020,
      sourceType: "module",
    }) as acorn.Program;
  } catch {
    return null;
  }
}

/**
 * Finds the `export const MAP = [...]` array in a parsed AST.
 * Returns null if not found.
 */
export function findMapArray(ast: acorn.Program): acorn.ArrayExpression | null {
  for (const node of ast.body) {
    const decl = node.type === "ExportNamedDeclaration" ? (node as acorn.ExportNamedDeclaration).declaration : node;

    if (!decl || decl.type !== "VariableDeclaration") continue;

    for (const d of (decl as acorn.VariableDeclaration).declarations) {
      if (d.id.type === "Identifier" && (d.id as acorn.Identifier).name === "MAP" && d.init?.type === "ArrayExpression") {
        return d.init as acorn.ArrayExpression;
      }
    }
  }
  return null;
}

/**
 * Gets the string value of a named property from an object literal.
 * Only works for simple string literals, not template literals or expressions.
 *
 * Example: getStringProp(obj, "source") → "items/sword.item.json"
 */
export function getStringProp(obj: acorn.ObjectExpression, key: string): string | null {
  for (const prop of obj.properties) {
    if (prop.type !== "Property") continue;
    const p = prop as acorn.Property;
    const k = p.key.type === "Identifier" ? (p.key as acorn.Identifier).name : null;
    if (k === key && p.value.type === "Literal") {
      return String((p.value as acorn.Literal).value);
    }
  }
  return null;
}

/**
 * Gets a nested object literal value of a named property.
 *
 * Example: getObjectProp(obj, "scope") → ObjectExpression node
 */
export function getObjectProp(obj: acorn.ObjectExpression, key: string): acorn.ObjectExpression | null {
  for (const prop of obj.properties) {
    if (prop.type !== "Property") continue;
    const p = prop as acorn.Property;
    const k = p.key.type === "Identifier" ? (p.key as acorn.Identifier).name : null;
    if (k === key && p.value.type === "ObjectExpression") {
      return p.value as acorn.ObjectExpression;
    }
  }
  return null;
}

// ---- Map entry helpers (text-based, used by hover/completion/inlay providers) ----

/**
 * Walks backwards from `currentLine` to find the opening `{` of the
 * nearest enclosing MAP entry, then scans forward to find the `source` value.
 *
 * Used by hover, inlay hints, and completion providers to know which
 * source file the current entry maps from.
 */
export function getSourceValueForEntry(document: { lineAt: (i: number) => { text: string }; lineCount: number }, currentLine: number): string | null {
  // Walk backwards to find the opening { of this entry
  let braceDepth = 0;
  let entryStart = currentLine;

  for (let i = currentLine; i >= 0; i--) {
    const line = document.lineAt(i).text;
    for (let c = line.length - 1; c >= 0; c--) {
      if (line[c] === "}") braceDepth++;
      if (line[c] === "{") {
        if (braceDepth === 0) {
          entryStart = i;
          break;
        }
        braceDepth--;
      }
    }
    if (entryStart !== currentLine) break;
  }

  // Scan forward from entry start to find source: "..."
  for (let i = entryStart; i <= currentLine + 5; i++) {
    if (i >= document.lineCount) break;
    const match = document.lineAt(i).text.match(/source\s*:\s*["']([^"']+)["']/);
    if (match) return match[1];
  }

  return null;
}

/**
 * Checks whether a MAP entry object contains a source glob that
 * matches the given relative file path. Handles both plain entries
 * and spread .map() entries.
 */
export function mapFileCoversFile(mapFilePath: string, targetFilePath: string): boolean {
  const ast = parseAcornFile(mapFilePath);
  if (!ast) return false;

  const mapDir = path.dirname(mapFilePath);
  const relativePath = path.relative(mapDir, targetFilePath).replace(/\\/g, "/");

  const mapArray = findMapArray(ast);
  if (!mapArray) return false;

  for (const element of mapArray.elements) {
    if (!element) continue;

    if (element.type === "SpreadElement") {
      if (spreadEntryCoversFile((element as acorn.SpreadElement).argument, relativePath)) {
        return true;
      }
      continue;
    }

    if (element.type !== "ObjectExpression") continue;
    const sourceVal = getStringProp(element as acorn.ObjectExpression, "source");
    if (sourceVal && matchesGlob(relativePath, sourceVal)) return true;
  }

  return false;
}

/**
 * Checks whether a spread .map() call entry covers the given relative path.
 * Handles both arrow body shorthand `=> ({...})` and block body `=> { return {...} }`.
 */
export function spreadEntryCoversFile(node: acorn.Node, relativePath: string): boolean {
  if (node.type !== "CallExpression") return false;
  const call = node as acorn.CallExpression;

  if (call.callee.type !== "MemberExpression" || ((call.callee as acorn.MemberExpression).property as acorn.Identifier).name !== "map") return false;

  const [cb] = call.arguments;
  if (!cb || cb.type !== "ArrowFunctionExpression") return false;

  const body = (cb as acorn.ArrowFunctionExpression).body;
  const bodyObj = extractArrowBody(body);
  if (!bodyObj) return false;

  const sourceVal = getStringProp(bodyObj, "source");
  return !!(sourceVal && matchesGlob(relativePath, sourceVal));
}

/**
 * Extracts the returned ObjectExpression from an arrow function body.
 * Handles both shorthand `=> ({...})` and block `=> { return {...}; }` forms.
 */
export function extractArrowBody(body: acorn.BlockStatement | acorn.Expression): acorn.ObjectExpression | null {
  if (body.type === "ObjectExpression") {
    return body as acorn.ObjectExpression;
  }

  if (body.type === "BlockStatement") {
    for (const stmt of (body as acorn.BlockStatement).body) {
      if (stmt.type === "ReturnStatement" && (stmt as acorn.ReturnStatement).argument?.type === "ObjectExpression") {
        return (stmt as acorn.ReturnStatement).argument as acorn.ObjectExpression;
      }
    }
  }

  return null;
}

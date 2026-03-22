import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

type AutoMapEntry = string | { path: string; extension: string };
type AutoMap = Record<string, AutoMapEntry>;

export function resolveAutoTarget(
  sourceFile: string,
  targetKeyword: ":auto" | ":autoFlat",
  mapFile: string
): string | null {
  const autoMap = findAndParseAutoMap(mapFile);
  if (!autoMap) return null;

  const fileName = path.basename(sourceFile);
  const suffix = longestMatchingSuffix(fileName, Object.keys(autoMap));
  if (!suffix) return null;

  const entry = autoMap[suffix];
  const dirPath = typeof entry === "string" ? entry : entry.path;
  const customExt = typeof entry === "object" ? entry.extension : null;

  // Build the final filename
  const baseName = fileName.slice(0, fileName.length - suffix.length);
  const finalExt = customExt ?? suffix;
  const finalFileName = baseName + finalExt;

  if (targetKeyword === ":autoFlat") {
    // Just drop the file into the resolved directory
    return `${dirPath}/${finalFileName}`;
  } else {
    // :auto — preserve subfolder structure relative to module dir
    const moduleDir = path.dirname(mapFile);
    const relativeDir = path.relative(
      moduleDir,
      path.dirname(path.resolve(moduleDir, sourceFile))
    ).replace(/\\/g, "/");

    if (relativeDir && relativeDir !== ".") {
      return `${dirPath}/${relativeDir}/${finalFileName}`;
    }
    return `${dirPath}/${finalFileName}`;
  }
}

function longestMatchingSuffix(fileName: string, suffixes: string[]): string | null {
  // Everything after the first dot is the suffix
  const firstDot = fileName.indexOf(".");
  if (firstDot === -1) return null;

  // Try progressively shorter suffixes from the first dot onward
  // e.g. zombie.behavior.json → try .behavior.json, then .json
  let best: string | null = null;
  for (const suffix of suffixes) {
    if (fileName.endsWith(suffix)) {
      if (!best || suffix.length > best.length) {
        best = suffix;
      }
    }
  }
  return best;
}

function findAndParseAutoMap(mapFile: string): AutoMap | null {
  // Walk up from _map.ts location to find auto-map.ts
  let dir = path.dirname(mapFile);
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

function parseAutoMapFile(filePath: string): AutoMap | null {
  const source = fs.readFileSync(filePath, "utf-8");
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);

  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (
        ts.isIdentifier(decl.name) &&
        decl.name.text === "AUTO_MAP" &&
        decl.initializer &&
        ts.isObjectLiteralExpression(decl.initializer)
      ) {
        return extractAutoMap(decl.initializer, sf);
      }
    }
  }
  return null;
}

function extractAutoMap(node: ts.ObjectLiteralExpression, sf: ts.SourceFile): AutoMap {
  const result: AutoMap = {};

  for (const prop of node.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;

    const key = ts.isStringLiteral(prop.name)
      ? prop.name.text
      : ts.isIdentifier(prop.name)
      ? prop.name.text
      : null;

    if (!key) continue;

    if (ts.isStringLiteral(prop.initializer)) {
      result[key] = prop.initializer.text;
    } else if (ts.isObjectLiteralExpression(prop.initializer)) {
      let entryPath = "";
      let extension = "";
      for (const p of prop.initializer.properties) {
        if (
          ts.isPropertyAssignment(p) &&
          ts.isIdentifier(p.name) &&
          ts.isStringLiteral(p.initializer)
        ) {
          if (p.name.text === "path") entryPath = p.initializer.text;
          if (p.name.text === "extension") extension = p.initializer.text;
        }
      }
      if (entryPath) result[key] = { path: entryPath, extension };
    }
  }

  return result;
}
import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as acorn from "acorn";
import { parseAcornSource, findMapArray, matchesGlob } from "./utils";

export class MapDiagnosticsProvider {
  private collection: vscode.DiagnosticCollection;

  constructor() {
    this.collection = vscode.languages.createDiagnosticCollection("modular-mc");
  }

  dispose() {
    this.collection.dispose();
  }

  async update(document: vscode.TextDocument) {
    if (!document.fileName.endsWith("_map.ts")) return;

    const diagnostics: vscode.Diagnostic[] = [];
    const mapDir = path.dirname(document.fileName);

    const ast = parseAcornSource(document.getText());
    if (!ast) return;

    const mapArray = findMapArray(ast);
    if (!mapArray) return;

    for (const element of mapArray.elements) {
      if (!element) continue;
      // Skip spread entries (.map() calls) — can't statically resolve their source paths
      if (element.type === "SpreadElement") continue;
      if (element.type !== "ObjectExpression") continue;

      const obj = element as acorn.ObjectExpression;
      const sourceProp = getStringPropWithNode(obj, "source");
      if (!sourceProp) continue;

      const { value: sourceValue, node: sourceNode } = sourceProp;
      const isGlob = sourceValue.includes("*");
      const range = nodeToRange(document, sourceNode);

      if (!isGlob) {
        // Specific file path — error if it doesn't exist on disk
        const fullPath = path.resolve(mapDir, sourceValue);
        if (!fs.existsSync(fullPath)) {
          const diag = new vscode.Diagnostic(
            range,
            `Source file not found: "${sourceValue}"`,
            vscode.DiagnosticSeverity.Error
          );
          diag.source = "modular-mc";
          diagnostics.push(diag);
        }
      } else {
        // Glob pattern — warning if no files currently match
        const matched = countGlobMatches(mapDir, sourceValue);
        if (matched === 0) {
          const diag = new vscode.Diagnostic(
            range,
            `No files match glob pattern: "${sourceValue}"`,
            vscode.DiagnosticSeverity.Warning
          );
          diag.source = "modular-mc";
          diagnostics.push(diag);
        }
      }
    }

    this.collection.set(document.uri, diagnostics);
  }

  clear(document: vscode.TextDocument) {
    this.collection.delete(document.uri);
  }
}

/** Counts how many files in baseDir match the given glob pattern. */
function countGlobMatches(baseDir: string, pattern: string): number {
  let count = 0;
  walkDir(baseDir, baseDir, (relPath) => {
    if (matchesGlob(relPath, pattern)) count++;
  });
  return count;
}

/** Recursively walks a directory, calling cb with each file's relative path. */
function walkDir(baseDir: string, currentDir: string, cb: (relPath: string) => void) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const fullPath = path.join(currentDir, entry.name);
    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      walkDir(baseDir, fullPath, cb);
    } else {
      cb(relPath);
    }
  }
}

/**
 * Like getStringProp but also returns the literal AST node so we can
 * compute a vscode.Range for the diagnostic underline.
 */
function getStringPropWithNode(
  obj: acorn.ObjectExpression,
  key: string
): { value: string; node: acorn.Literal } | null {
  for (const prop of obj.properties) {
    if (prop.type !== "Property") continue;
    const p = prop as acorn.Property;
    const k = p.key.type === "Identifier" ? (p.key as acorn.Identifier).name : null;
    if (k === key && p.value.type === "Literal") {
      const lit = p.value as acorn.Literal;
      return { value: String(lit.value), node: lit };
    }
  }
  return null;
}

/** Converts an acorn literal node to a vscode Range, excluding the surrounding quotes. */
function nodeToRange(document: vscode.TextDocument, node: acorn.Node): vscode.Range {
  const start = document.positionAt((node as any).start + 1); // +1 skips opening quote
  const end = document.positionAt((node as any).end - 1);     // -1 skips closing quote
  return new vscode.Range(start, end);
}
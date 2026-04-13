import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as acorn from "acorn";
import { matchesGlob } from "./utils";

export class TemplateDefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Location | null> {
    const mapFile = findMapFile(document.uri.fsPath);
    if (!mapFile) return null;

    const expr = getExpressionUnderCursor(document, position);
    if (!expr) return null;

    const segments = expr.split(".");

    const mapDoc = await vscode.workspace.openTextDocument(mapFile);
    const mapText = mapDoc.getText();

    let ast: acorn.Program;
    try {
      ast = acorn.parse(mapText, { ecmaVersion: 2020, sourceType: "module" }) as acorn.Program;
    } catch {
      return null;
    }

    const mapDir = path.dirname(mapFile);
    const relativePath = path.relative(mapDir, document.uri.fsPath).replace(/\\/g, "/");

    const targetNode = findScopeKeyNode(ast, relativePath, segments);
    if (!targetNode) return null;

    const pos = mapDoc.positionAt((targetNode as any).start);
    return new vscode.Location(vscode.Uri.file(mapFile), pos);
  }
}

function getExpressionUnderCursor(
  document: vscode.TextDocument,
  position: vscode.Position
): string | null {
  const lineText = document.lineAt(position).text;
  const charOffset = position.character;

  const jsonMarker = lineText.lastIndexOf('"::', charOffset);
  const tsOpen = lineText.lastIndexOf("{ts:", charOffset);
  const inJson = jsonMarker !== -1 && (lineText.indexOf('"', jsonMarker + 3) === -1 || charOffset <= lineText.indexOf('"', jsonMarker + 3));
  const inTs = tsOpen !== -1 && (lineText.indexOf(":}", charOffset) === -1 || charOffset <= lineText.indexOf(":}", charOffset));

  if (!inJson && !inTs) return null;

  const before = lineText.slice(0, charOffset).match(/[\w.]+$/)?.[0] ?? "";
  const after = lineText.slice(charOffset).match(/^[\w.]*/)?.[0] ?? "";
  const full = before + after;

  return full.replace(/^\.+|\.+$/g, "") || null;
}

function findMapFile(filePath: string): string | null {
  let dir = path.dirname(filePath);
  const root = path.parse(dir).root;

  while (dir !== root) {
    const candidate = path.join(dir, "_map.ts");
    if (fs.existsSync(candidate)) {
      const mapDir = path.dirname(candidate);
      const relativePath = path.relative(mapDir, filePath).replace(/\\/g, "/");

      // File must be inside the module folder AND map must cover this file
      if (!relativePath.startsWith("..") && mapFileCoversFile(candidate, filePath)) {
        return candidate;
      }
    }
    dir = path.dirname(dir);
  }
  return null;
}

function mapFileCoversFile(mapFilePath: string, targetFilePath: string): boolean {
  let source: string;
  try {
    source = fs.readFileSync(mapFilePath, "utf-8");
  } catch {
    return false;
  }

  let ast: acorn.Program;
  try {
    ast = acorn.parse(source, { ecmaVersion: 2020, sourceType: "module" }) as acorn.Program;
  } catch {
    return false;
  }

  const mapDir = path.dirname(mapFilePath);
  const relativePath = path.relative(mapDir, targetFilePath).replace(/\\/g, "/");

  const mapArray = findMapArray(ast);
  if (!mapArray) return false;

  for (const element of mapArray.elements) {
    if (!element) continue;

    if (element.type === "SpreadElement") {
      const arg = (element as acorn.SpreadElement).argument;
      if (arg.type !== "CallExpression") continue;
      const call = arg as acorn.CallExpression;
      if (
        call.callee.type !== "MemberExpression" ||
        ((call.callee as acorn.MemberExpression).property as acorn.Identifier).name !== "map"
      ) continue;

      const [cb] = call.arguments;
      if (!cb || cb.type !== "ArrowFunctionExpression") continue;

      const body = (cb as acorn.ArrowFunctionExpression).body;
      let bodyObj: acorn.ObjectExpression | null = null;

      if (body.type === "ObjectExpression") {
        bodyObj = body as acorn.ObjectExpression;
      } else if (body.type === "BlockStatement") {
        for (const stmt of (body as acorn.BlockStatement).body) {
          if (
            stmt.type === "ReturnStatement" &&
            (stmt as acorn.ReturnStatement).argument?.type === "ObjectExpression"
          ) {
            bodyObj = (stmt as acorn.ReturnStatement).argument as acorn.ObjectExpression;
            break;
          }
        }
      }

      if (!bodyObj) continue;
      const sourceVal = getStringProp(bodyObj, "source");
      if (sourceVal && matchesGlob(relativePath, sourceVal)) return true;
      continue;
    }

    if (element.type !== "ObjectExpression") continue;
    const sourceVal = getStringProp(element as acorn.ObjectExpression, "source");
    if (sourceVal && matchesGlob(relativePath, sourceVal)) return true;
  }

  return false;
}

function findScopeKeyNode(
  ast: acorn.Program,
  relativePath: string,
  segments: string[]
): acorn.Node | null {
  const mapArray = findMapArray(ast);
  if (!mapArray) return null;

  for (const element of mapArray.elements) {
    if (!element) continue;

    let scopeObj: acorn.ObjectExpression | null = null;

    if (element.type === "SpreadElement") {
      scopeObj = findScopeInMappedEntry(
        (element as acorn.SpreadElement).argument,
        relativePath
      );
    } else if (element.type === "ObjectExpression") {
      const obj = element as acorn.ObjectExpression;
      const sourceVal = getStringProp(obj, "source");
      if (sourceVal && matchesGlob(relativePath, sourceVal)) {
        scopeObj = getObjectProp(obj, "scope");
      }
    }

    if (!scopeObj) continue;

    return walkSegments(scopeObj, segments);
  }

  return null;
}

function walkSegments(
  obj: acorn.ObjectExpression,
  segments: string[]
): acorn.Node | null {
  if (segments.length === 0) return null;

  const [head, ...rest] = segments;

  for (const prop of obj.properties) {
    if (prop.type === "SpreadElement") continue;
    if (prop.type !== "Property") continue;
    const p = prop as acorn.Property;
    const key = p.key.type === "Identifier"
      ? (p.key as acorn.Identifier).name
      : null;

    if (key !== head) continue;

    if (rest.length === 0) {
      return p.key;
    }

    if (p.value.type === "ObjectExpression") {
      return walkSegments(p.value as acorn.ObjectExpression, rest);
    }

    return p.key;
  }

  return null;
}

function findScopeInMappedEntry(
  node: acorn.Node,
  relativePath: string
): acorn.ObjectExpression | null {
  if (node.type !== "CallExpression") return null;
  const call = node as acorn.CallExpression;

  if (
    call.callee.type !== "MemberExpression" ||
    ((call.callee as acorn.MemberExpression).property as acorn.Identifier).name !== "map"
  ) return null;

  const [callback] = call.arguments;
  if (!callback || callback.type !== "ArrowFunctionExpression") return null;

  const cb = callback as acorn.ArrowFunctionExpression;
  let body: acorn.ObjectExpression | null = null;

  if (cb.body.type === "ObjectExpression") {
    body = cb.body as acorn.ObjectExpression;
  } else if (cb.body.type === "BlockStatement") {
    for (const stmt of (cb.body as acorn.BlockStatement).body) {
      if (
        stmt.type === "ReturnStatement" &&
        (stmt as acorn.ReturnStatement).argument?.type === "ObjectExpression"
      ) {
        body = (stmt as acorn.ReturnStatement).argument as acorn.ObjectExpression;
        break;
      }
    }
  }

  if (!body) return null;

  const sourceVal = getStringProp(body, "source");
  if (!sourceVal || !matchesGlob(relativePath, sourceVal)) return null;

  return getObjectProp(body, "scope");
}

function findMapArray(ast: acorn.Program): acorn.ArrayExpression | null {
  for (const node of ast.body) {
    const decl = node.type === "ExportNamedDeclaration"
      ? (node as acorn.ExportNamedDeclaration).declaration
      : node;
    if (!decl || decl.type !== "VariableDeclaration") continue;
    for (const d of (decl as acorn.VariableDeclaration).declarations) {
      if (
        d.id.type === "Identifier" &&
        (d.id as acorn.Identifier).name === "MAP" &&
        d.init?.type === "ArrayExpression"
      ) {
        return d.init as acorn.ArrayExpression;
      }
    }
  }
  return null;
}

function getStringProp(obj: acorn.ObjectExpression, key: string): string | null {
  for (const prop of obj.properties) {
    if (prop.type !== "Property") continue;
    const p = prop as acorn.Property;
    const k = p.key.type === "Identifier" ? (p.key as acorn.Identifier).name : null;
    if (k === key && p.value.type === "Literal") return String((p.value as acorn.Literal).value);
  }
  return null;
}

function getObjectProp(obj: acorn.ObjectExpression, key: string): acorn.ObjectExpression | null {
  for (const prop of obj.properties) {
    if (prop.type !== "Property") continue;
    const p = prop as acorn.Property;
    const k = p.key.type === "Identifier" ? (p.key as acorn.Identifier).name : null;
    if (k === key && p.value.type === "ObjectExpression") return p.value as acorn.ObjectExpression;
  }
  return null;
}
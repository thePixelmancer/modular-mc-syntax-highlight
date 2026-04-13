import * as fs from "fs";
import * as path from "path";
import * as acorn from "acorn";
import { matchesGlob } from "./utils";

type Scope = Record<string, unknown>;

export async function findScopeForFile(
  filePath: string
): Promise<Scope | null> {
  const mapFile = findMapFile(filePath);
  if (!mapFile) return null;

  const mapDir = path.dirname(mapFile);
  const relativePath = path.relative(mapDir, filePath).replace(/\\/g, "/");

  return extractScopeForSource(mapFile, relativePath);
}

function findMapFile(filePath: string): string | null {
  let dir = path.dirname(filePath);
  const root = path.parse(dir).root;

  while (dir !== root) {
    const candidate = path.join(dir, "_map.ts");
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  return null;
}

function parseFile(filePath: string): acorn.Program | null {
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

function extractScopeForSource(
  mapFile: string,
  relativePath: string
): Scope | null {
  const ast = parseFile(mapFile);
  if (!ast) return null;

  const topLevelVars = extractTopLevelVars(ast);
  const mapArray = findMapArray(ast);
  if (!mapArray) return null;

  for (const element of mapArray.elements) {
    if (!element) continue;

    // Handle ...staves.map((staff) => ({...}))
    if (element.type === "SpreadElement") {
      const result = tryResolveMappedEntry(
        element.argument,
        relativePath,
        topLevelVars
      );
      if (result) return result;
      continue;
    }

    if (element.type !== "ObjectExpression") continue;

    const sourceVal = getStringProp(element as acorn.ObjectExpression, "source");
    if (!sourceVal || !matchesGlob(relativePath, sourceVal)) continue;

    const scopeProp = getObjectProp(element as acorn.ObjectExpression, "scope");
    if (!scopeProp) continue;

    return evaluateObject(scopeProp, topLevelVars);
  }

  return null;
}

// Handles: staves.map((staff) => ({ source, scope }))
function tryResolveMappedEntry(
  node: acorn.Node,
  relativePath: string,
  topLevelVars: Record<string, unknown>
): Scope | null {
  if (node.type !== "CallExpression") return null;
  const call = node as acorn.CallExpression;

  if (
    call.callee.type !== "MemberExpression" ||
    (call.callee as acorn.MemberExpression).property.type !== "Identifier" ||
    ((call.callee as acorn.MemberExpression).property as acorn.Identifier).name !== "map"
  ) return null;

  const [callback] = call.arguments;
  if (!callback || (callback.type !== "ArrowFunctionExpression" && callback.type !== "FunctionExpression")) return null;

  const cb = callback as acorn.ArrowFunctionExpression;
  const [param] = cb.params;
  if (!param || param.type !== "Identifier") return null;
  const paramName = (param as acorn.Identifier).name;

  // Get array name being mapped — e.g. "staves"
  const arrayExpr = (call.callee as acorn.MemberExpression).object;
  const arrayName = arrayExpr.type === "Identifier" ? (arrayExpr as acorn.Identifier).name : null;
  const firstElement = arrayName ? resolveFirstArrayElement(arrayName, topLevelVars) : null;

  const bindings: Record<string, unknown> = {
    ...topLevelVars,
    ...(firstElement ? { [paramName]: firstElement } : {}),
  };

  // Get returned object from arrow body
  let returnedObj: acorn.ObjectExpression | null = null;

  if (cb.body.type === "ObjectExpression") {
    returnedObj = cb.body as acorn.ObjectExpression;
  } else if (cb.body.type === "BlockStatement") {
    const block = cb.body as acorn.BlockStatement;
    for (const stmt of block.body) {
      if (stmt.type === "ReturnStatement" && (stmt as acorn.ReturnStatement).argument) {
        const arg = (stmt as acorn.ReturnStatement).argument!;
        returnedObj = arg.type === "ObjectExpression" ? arg as acorn.ObjectExpression : null;
        break;
      }
    }
  }

  if (!returnedObj) return null;

  const sourceVal = getStringProp(returnedObj, "source");
  if (!sourceVal || !matchesGlob(relativePath, sourceVal)) return null;

  const scopeProp = getObjectProp(returnedObj, "scope");
  if (!scopeProp) return null;

  return evaluateObject(scopeProp, bindings);
}

// ---- Top-level variable extraction ----

function extractTopLevelVars(ast: acorn.Program): Record<string, unknown> {
  const vars: Record<string, unknown> = {};

  for (const node of ast.body) {
    if (node.type !== "VariableDeclaration" && node.type !== "ExportNamedDeclaration") continue;

    const decl = node.type === "ExportNamedDeclaration"
      ? (node as acorn.ExportNamedDeclaration).declaration
      : node;

    if (!decl || decl.type !== "VariableDeclaration") continue;

    for (const d of (decl as acorn.VariableDeclaration).declarations) {
      if (d.id.type !== "Identifier" || !d.init) continue;
      const name = (d.id as acorn.Identifier).name;
      if (name === "MAP") continue;

      if (d.init.type === "ArrayExpression") {
        vars[name] = { __arrayNode: d.init as acorn.ArrayExpression };
      } else {
        vars[name] = evaluateExpr(d.init, {});
      }
    }
  }

  return vars;
}

function resolveFirstArrayElement(
  arrayName: string,
  topLevelVars: Record<string, unknown>
): Scope | null {
  const entry = topLevelVars[arrayName];
  if (!entry || typeof entry !== "object") return null;

  const { __arrayNode } = entry as { __arrayNode: acorn.ArrayExpression };
  if (!__arrayNode) return null;

  const first = __arrayNode.elements[0];
  if (!first || first.type !== "ObjectExpression") return null;

  return evaluateObject(first as acorn.ObjectExpression, {});
}

// ---- Evaluation ----

function evaluateObject(
  node: acorn.ObjectExpression,
  bindings: Record<string, unknown>
): Scope {
  const result: Scope = {};

  for (const prop of node.properties) {
    if (prop.type === "SpreadElement") {
      const spread = evaluateExpr((prop as acorn.SpreadElement).argument, bindings);
      if (spread && typeof spread === "object" && !("__arrayNode" in (spread as object))) {
        Object.assign(result, spread);
      }
      continue;
    }

    if (prop.type !== "Property") continue;
    const p = prop as acorn.Property;

    const key =
      p.key.type === "Identifier" ? (p.key as acorn.Identifier).name :
      p.key.type === "Literal" ? String((p.key as acorn.Literal).value) :
      null;

    if (!key) continue;
    result[key] = evaluateExpr(p.value as acorn.Expression, bindings);
  }

  return result;
}

function evaluateExpr(node: acorn.Expression | acorn.Node, bindings: Record<string, unknown>): unknown {
  switch (node.type) {
    case "Literal":
      return (node as acorn.Literal).value;

    case "ObjectExpression":
      return evaluateObject(node as acorn.ObjectExpression, bindings);

    case "ArrayExpression":
      return (node as acorn.ArrayExpression).elements.map((el) =>
        el ? evaluateExpr(el, bindings) : null
      );

    case "Identifier": {
      const name = (node as acorn.Identifier).name;
      if (name === "true") return true;
      if (name === "false") return false;
      if (name === "null") return null;
      if (name in bindings) return bindings[name];
      return `<dynamic: ${name}>`;
    }

    case "MemberExpression": {
      const mem = node as acorn.MemberExpression;
      const obj = evaluateExpr(mem.object, bindings);
      if (obj && typeof obj === "object" && !("__arrayNode" in (obj as object))) {
        const key = mem.property.type === "Identifier"
          ? (mem.property as acorn.Identifier).name
          : String((mem.property as acorn.Literal).value);
        return (obj as Record<string, unknown>)[key] ?? `<dynamic: ${key}>`;
      }
      return `<dynamic>`;
    }

    case "TemplateLiteral": {
      const tl = node as acorn.TemplateLiteral;
      let str = tl.quasis[0].value.cooked ?? "";
      for (let i = 0; i < tl.expressions.length; i++) {
        const val = evaluateExpr(tl.expressions[i], bindings);
        str += typeof val === "string" || typeof val === "number" ? val : "<dynamic>";
        str += tl.quasis[i + 1].value.cooked ?? "";
      }
      return str;
    }

    case "CallExpression": {
      const callee = (node as acorn.CallExpression).callee;
      const name = callee.type === "Identifier"
        ? (callee as acorn.Identifier).name
        : callee.type === "MemberExpression"
        ? (((callee as acorn.MemberExpression).property) as acorn.Identifier).name
        : "fn";
      return `<dynamic: ${name}(...)>`;
    }

    default:
      return `<dynamic>`;
  }
}

// ---- Helpers ----

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
    if (k === key && p.value.type === "Literal") {
      return String((p.value as acorn.Literal).value);
    }
  }
  return null;
}

function getObjectProp(obj: acorn.ObjectExpression, key: string): acorn.ObjectExpression | null {
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
import * as fs from "fs";
import * as path from "path";
import * as ts from "typescript";

export async function findScopeForFile(filePath: string): Promise<Record<string, unknown> | null> {
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

function extractScopeForSource(mapFile: string, relativePath: string): Record<string, unknown> | null {
  const source = fs.readFileSync(mapFile, "utf-8");
  const sf = ts.createSourceFile(mapFile, source, ts.ScriptTarget.Latest, true);

  const topLevelVars = extractTopLevelVars(sf, source);
  const mapArray = findMapArray(sf);
  if (!mapArray) return null;

  for (const element of mapArray.elements) {
    // Unwrap .map() calls — e.g. ...staves.map((staff) => ({ source, scope }))
    if (ts.isSpreadElement(element)) {
      const inner = element.expression;
      if (ts.isCallExpression(inner) && ts.isPropertyAccessExpression(inner.expression) && inner.expression.name.text === "map") {
        const result = tryResolveMappedEntry(inner, relativePath, sf, source, topLevelVars);
        if (result) return result;
      }
      continue;
    }

    if (!ts.isObjectLiteralExpression(element)) continue;

    const sourceVal = getStringProp(element, "source");
    if (!sourceVal) continue;

    if (matchesGlob(relativePath, sourceVal)) {
      const scopeProp = getObjectProp(element, "scope");
      if (!scopeProp) continue;
      return evaluateObjectLiteral(scopeProp, sf, source, topLevelVars);
    }
  }

  return null;
}

// Handles: ...staves.map((staff) => ({ source: "...", scope: { ...staff, ... } }))
function tryResolveMappedEntry(
  callExpr: ts.CallExpression,
  relativePath: string,
  sf: ts.SourceFile,
  source: string,
  topLevelVars: TopLevelVars,
): Record<string, unknown> | null {
  const [callbackArg] = callExpr.arguments;
  if (!callbackArg) return null;
  if (!ts.isArrowFunction(callbackArg) && !ts.isFunctionExpression(callbackArg)) return null;

  // Get the param name — e.g. "staff"
  const [param] = callbackArg.parameters;
  if (!param || !ts.isIdentifier(param.name)) return null;
  const paramName = param.name.text;

  // Get the array being mapped — e.g. "staves"
  const arrayExpr = (callExpr.expression as ts.PropertyAccessExpression).expression;
  const arrayName = ts.isIdentifier(arrayExpr) ? arrayExpr.text : null;

  // Resolve first element of that array as the representative shape
  const firstElement = arrayName ? resolveFirstArrayElement(arrayName, topLevelVars) : null;

  // Evaluate the arrow body with the param bound to the first element
  const body = callbackArg.body;
  let returnedObj: ts.ObjectLiteralExpression | null = null;

  if (ts.isObjectLiteralExpression(body)) {
    returnedObj = body;
  } else if (ts.isParenthesizedExpression(body) && ts.isObjectLiteralExpression(body.expression)) {
    returnedObj = body.expression;
  } else if (ts.isBlock(body)) {
    // Find return statement
    for (const stmt of body.statements) {
      if (ts.isReturnStatement(stmt) && stmt.expression) {
        const expr = ts.isParenthesizedExpression(stmt.expression) ? stmt.expression.expression : stmt.expression;
        if (ts.isObjectLiteralExpression(expr)) {
          returnedObj = expr;
          break;
        }
      }
    }
  }

  if (!returnedObj) return null;

  // Check source prop matches
  const sourceVal = getStringProp(returnedObj, "source");
  if (!sourceVal || !matchesGlob(relativePath, sourceVal)) return null;

  const scopeProp = getObjectProp(returnedObj, "scope");
  if (!scopeProp) return null;

  // Inject param binding so spreads like ...staff resolve to firstElement
  const bindings: TopLevelVars = {
    ...topLevelVars,
    ...(firstElement ? { [paramName]: firstElement } : {}),
  };

  return evaluateObjectLiteral(scopeProp, sf, source, bindings);
}

// ---- Top-level variable extraction ----

type TopLevelVars = Record<string, unknown>;

function extractTopLevelVars(sf: ts.SourceFile, source: string): TopLevelVars {
  const vars: TopLevelVars = {};

  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
      const name = decl.name.text;
      if (name === "MAP") continue; // skip MAP itself

      if (ts.isArrayLiteralExpression(decl.initializer)) {
        // Store the raw node for later first-element resolution
        vars[name] = { __arrayNode: decl.initializer, __sf: sf, __source: source };
      } else {
        vars[name] = evaluateExpression(decl.initializer, sf, source, {});
      }
    }
  }

  return vars;
}

function resolveFirstArrayElement(arrayName: string, topLevelVars: TopLevelVars): Record<string, unknown> | null {
  const entry = topLevelVars[arrayName];
  if (!entry || typeof entry !== "object") return null;

  const { __arrayNode, __sf, __source } = entry as {
    __arrayNode: ts.ArrayLiteralExpression;
    __sf: ts.SourceFile;
    __source: string;
  };

  if (!__arrayNode) return null;

  const first = __arrayNode.elements[0];
  if (!first || !ts.isObjectLiteralExpression(first)) return null;

  return evaluateObjectLiteral(first, __sf, __source, {});
}

// ---- Object/expression evaluation ----

function evaluateObjectLiteral(node: ts.ObjectLiteralExpression, sf: ts.SourceFile, source: string, bindings: TopLevelVars): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const prop of node.properties) {
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
      result[prop.name.text] = evaluateExpression(prop.initializer, sf, source, bindings);
    } else if (ts.isSpreadAssignment(prop)) {
      const spread = evaluateExpression(prop.expression, sf, source, bindings);
      if (spread && typeof spread === "object" && !("__arrayNode" in (spread as object))) {
        Object.assign(result, spread);
      }
    }
  }

  return result;
}

function evaluateExpression(node: ts.Expression, sf: ts.SourceFile, source: string, bindings: TopLevelVars): unknown {
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;

  if (ts.isObjectLiteralExpression(node)) {
    return evaluateObjectLiteral(node, sf, source, bindings);
  }

  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((el) => evaluateExpression(el, sf, source, bindings));
  }

  // Identifier — check bindings first, then top-level vars
  if (ts.isIdentifier(node)) {
    const name = node.text;
    if (name in bindings) return bindings[name];
    return `<dynamic: ${name}>`;
  }

  // Property access — e.g. staff.spell
  if (ts.isPropertyAccessExpression(node)) {
    const obj = evaluateExpression(node.expression, sf, source, bindings);
    if (obj && typeof obj === "object") {
      return (obj as Record<string, unknown>)[node.name.text] ?? `<dynamic: ${node.getText(sf)}>`;
    }
    return `<dynamic: ${node.getText(sf)}>`;
  }

  // Template literal — e.g. `${staff.prefix}_staff_of_${staff.spell}`
  if (ts.isTemplateExpression(node)) {
    let str = node.head.text;
    for (const span of node.templateSpans) {
      const val = evaluateExpression(span.expression, sf, source, bindings);
      str += typeof val === "string" || typeof val === "number" ? val : `<dynamic>`;
      str += span.literal.text;
    }
    return str;
  }

  // Call expression — can't evaluate, but label it
  if (ts.isCallExpression(node)) {
    return `<dynamic: ${node.expression.getText(sf)}(...)>`;
  }

  return `<dynamic: ${node.getText(sf)}>`;
}

// ---- Helpers ----

function findMapArray(sf: ts.SourceFile): ts.ArrayLiteralExpression | null {
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const decl of stmt.declarationList.declarations) {
      if (ts.isIdentifier(decl.name) && decl.name.text === "MAP" && decl.initializer && ts.isArrayLiteralExpression(decl.initializer)) {
        return decl.initializer;
      }
    }
  }
  return null;
}

function getStringProp(obj: ts.ObjectLiteralExpression, key: string): string | null {
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === key && ts.isStringLiteral(prop.initializer)) {
      return prop.initializer.text;
    }
  }
  return null;
}

function getObjectProp(obj: ts.ObjectLiteralExpression, key: string): ts.ObjectLiteralExpression | null {
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name) && prop.name.text === key && ts.isObjectLiteralExpression(prop.initializer)) {
      return prop.initializer;
    }
  }
  return null;
}

function matchesGlob(filePath: string, glob: string): boolean {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "(.+)")
    .replace(/\*/g, "([^/]+)");
  return new RegExp(`^${escaped}$`).test(filePath);
}

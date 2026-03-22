import * as vscode from "vscode";
import { findScopeForFile } from "./mapResolver";

export class ScopeCompletionProvider implements vscode.CompletionItemProvider {
  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    context: vscode.CompletionContext,
  ) {
    const region = getEmbeddedRegionPrefix(document, position);
    if (region === null) return;

    const scope = await findScopeForFile(document.uri.fsPath);
    if (!scope) return;

    return new vscode.CompletionList(resolveCompletions(region, scope), false);
  }
}

// Returns the expression typed so far inside the embedded region, or null if not in one
function getEmbeddedRegionPrefix(document: vscode.TextDocument, position: vscode.Position): string | null {
  const lineText = document.lineAt(position).text;
  const charOffset = position.character;

  let insideRegion = false;

  // JSON: anywhere inside a string that contains "::"
  const jsonMarker = lineText.lastIndexOf('"::', charOffset);
  if (jsonMarker !== -1) {
    const closeQuote = lineText.indexOf('"', jsonMarker + 3);
    if (closeQuote === -1 || charOffset <= closeQuote) {
      insideRegion = true;
    }
  }

  // Plain/lang: inside {ts: ... :}
  if (!insideRegion) {
    const tsOpen = lineText.lastIndexOf("{ts:", charOffset);
    if (tsOpen !== -1) {
      const tsClose = lineText.indexOf(":}", charOffset);
      if (tsClose === -1 || charOffset <= tsClose) {
        insideRegion = true;
      }
    }
  }

  if (!insideRegion) return null;

  // Extract the current identifier/property chain before the cursor
  // e.g. inside `textures/dungeons/${spell}_staff` cursor after "spell" → "spell"
  // e.g. inside `${staff.id}` cursor after "staff.id" → "staff.id"
  const textBeforeCursor = lineText.slice(0, charOffset);
  const tokenMatch = textBeforeCursor.match(/[\w.]+$/);
  return tokenMatch ? tokenMatch[0] : "";
}

function resolveCompletions(prefix: string, scope: Record<string, unknown>): vscode.CompletionItem[] {
  // Strip leading whitespace
  const expr = prefix.trimStart();

  // Split on dots to get path segments — e.g. "staff.spell" → ["staff", "spell"]
  const parts = expr.split(".");

  if (parts.length === 1) {
    // No dot yet — suggest top-level scope keys
    return objectToItems(scope);
  }

  // Has dot — walk down the scope tree along all but the last segment
  const pathToParent = parts.slice(0, -1);
  let current: unknown = scope;

  for (const segment of pathToParent) {
    if (!current || typeof current !== "object") return [];
    current = (current as Record<string, unknown>)[segment];
  }

  if (!current || typeof current !== "object") return [];

  // Filter out internal __arrayNode etc
  const obj = current as Record<string, unknown>;
  const filtered = Object.fromEntries(Object.entries(obj).filter(([k]) => !k.startsWith("__")));

  return objectToItems(filtered);
}

function objectToItems(obj: Record<string, unknown>): vscode.CompletionItem[] {
  return Object.entries(obj)
    .filter(([k]) => !k.startsWith("__"))
    .map(([key, value]) => {
      const item = new vscode.CompletionItem(key, getKind(value));
      item.detail = formatDetail(value);
      // If value is an object, inserting the key alone lets them keep dotting in
      item.insertText = key;
      return item;
    });
}

function formatDetail(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(formatDetail).join(", ")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value as object).filter((k) => !k.startsWith("__"));
    return `{ ${keys.join(", ")} }`;
  }
  return String(value);
}

function getKind(value: unknown): vscode.CompletionItemKind {
  if (typeof value === "function") return vscode.CompletionItemKind.Function;
  if (Array.isArray(value)) return vscode.CompletionItemKind.Enum;
  if (typeof value === "object" && value !== null) return vscode.CompletionItemKind.Module;
  if (typeof value === "string") return vscode.CompletionItemKind.Value;
  if (typeof value === "number") return vscode.CompletionItemKind.Value;
  return vscode.CompletionItemKind.Variable;
}

import * as vscode from "vscode";
import * as path from "path";
import { resolveAutoTarget } from "./autoMapResolver";
import { getSourceValueForEntry } from "./utils";

export class AutoTargetInlayHintsProvider implements vscode.InlayHintsProvider {
  provideInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range
  ): vscode.InlayHint[] {
    if (!document.fileName.endsWith("_map.ts")) return [];

    const hints: vscode.InlayHint[] = [];

    for (let i = range.start.line; i <= range.end.line; i++) {
      const lineText = document.lineAt(i).text;

      const targetMatch = lineText.match(/target\s*:\s*["'](:auto(?:Flat)?)["']/);
      if (!targetMatch) continue;

      const keyword = targetMatch[1] as ":auto" | ":autoFlat";
      const sourceFile = getSourceValueForEntry(document, i);
      if (!sourceFile) continue;

      let resolved: string | null = null;
      try {
        resolved = resolveAutoTarget(sourceFile, keyword, document.fileName);
      } catch {
        continue;
      }

      if (!resolved) continue;

      const endOfLine = lineText.trimEnd().length;
      const hint = new vscode.InlayHint(
        new vscode.Position(i, endOfLine),
        `  → ${resolved}`,
        vscode.InlayHintKind.Type
      );
      hint.paddingLeft = true;
      hints.push(hint);
    }

    return hints;
  }
}
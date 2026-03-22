import * as vscode from "vscode";
import { ScopeCompletionProvider } from "./completionProvider";
import { MapEntryCompletionProvider, AutoTargetHoverProvider } from "./mapEntryCompletionProvider";

export function activate(context: vscode.ExtensionContext) {
  const scopeProvider = new ScopeCompletionProvider();
  const mapEntryProvider = new MapEntryCompletionProvider();
  const autoHoverProvider = new AutoTargetHoverProvider();

  context.subscriptions.push(vscode.languages.registerCompletionItemProvider([{ language: "json" }, { language: "jsonc" }], scopeProvider, ".", ":"));

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider([{ language: "plaintext" }, { language: "lang" }], scopeProvider, ".", ":"),
  );

  context.subscriptions.push(vscode.languages.registerCompletionItemProvider([{ language: "typescript" }], mapEntryProvider, '"', "'", ":"));

  context.subscriptions.push(vscode.languages.registerHoverProvider([{ language: "typescript" }], autoHoverProvider));
}

export function deactivate() {}

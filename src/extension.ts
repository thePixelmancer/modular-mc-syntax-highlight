import * as vscode from "vscode";
import { ScopeCompletionProvider } from "./completionProvider";
import { MapEntryCompletionProvider, AutoTargetHoverProvider } from "./mapEntryCompletionProvider";
import { MapDiagnosticsProvider } from "./diagnosticsProvider";
import { TemplateDefinitionProvider } from "./definitionProvider";
import { AutoTargetInlayHintsProvider } from "./inlayHintsProvider";

export function activate(context: vscode.ExtensionContext) {
  const scopeProvider = new ScopeCompletionProvider();
  const mapEntryProvider = new MapEntryCompletionProvider();
  const autoHoverProvider = new AutoTargetHoverProvider();
  const diagnosticsProvider = new MapDiagnosticsProvider();
  const definitionProvider = new TemplateDefinitionProvider();
  const inlayHintsProvider = new AutoTargetInlayHintsProvider();

  // Scope completions in template files
  context.subscriptions.push(vscode.languages.registerCompletionItemProvider([{ language: "json" }, { language: "jsonc" }], scopeProvider, ".", ":"));

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider([{ language: "plaintext" }, { language: "lang" }], scopeProvider, ".", ":"),
  );

  // MAP entry field + value completions
  context.subscriptions.push(vscode.languages.registerCompletionItemProvider([{ language: "typescript" }], mapEntryProvider, '"', "'", ":"));

  // :auto hover
  context.subscriptions.push(vscode.languages.registerHoverProvider([{ language: "typescript" }], autoHoverProvider));

  // Diagnostics — run on open and save
  if (vscode.window.activeTextEditor) {
    diagnosticsProvider.update(vscode.window.activeTextEditor.document);
  }

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => diagnosticsProvider.update(doc)),
    vscode.workspace.onDidSaveTextDocument((doc) => diagnosticsProvider.update(doc)),
    vscode.workspace.onDidCloseTextDocument((doc) => diagnosticsProvider.clear(doc)),
    diagnosticsProvider,
  );

  // Go to definition from template files
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(
      [{ language: "json" }, { language: "jsonc" }, { language: "plaintext" }, { language: "lang" }],
      definitionProvider,
    ),
  );

  // Inlay hints for :auto / :autoFlat
  context.subscriptions.push(vscode.languages.registerInlayHintsProvider([{ language: "typescript" }], inlayHintsProvider));
}

export function deactivate() {}

import * as vscode from "vscode";
import { resolveAutoTarget } from "./autoMapResolver";

const TARGET_VALUES = [
  { label: ":autoFlat", detail: "Flatten matched files into their pack root" },
  { label: ":auto", detail: "Automatically resolve target path" },
];

const ON_CONFLICT_VALUES = [
  { label: "stop", detail: "(default) Stop and report an error" },
  { label: "skip", detail: "Skip this entry and continue" },
  { label: "merge", detail: "Deep merge files (JSON only)" },
  { label: "overwrite", detail: "Overwrite the existing file" },
  { label: "appendEnd", detail: "Append to end of existing file (text only)" },
  { label: "appendStart", detail: "Prepend to beginning of existing file (text only)" },
];

const FILE_TYPE_VALUES = [
  { label: "json", detail: "Treat file as JSON" },
  { label: "text", detail: "Treat file as plain text" },
];

const MAP_ENTRY_FIELDS = [
  {
    label: "source",
    detail: "string",
    description: "Source file path relative to module directory",
    snippet: 'source: "$0",',
  },
  {
    label: "target",
    detail: "string | object",
    description: "Target path or configuration object",
    snippet: 'target: "$0",',
  },
  {
    label: "jsonTemplate",
    detail: "boolean",
    description: "Enable JSON template processing with :: syntax",
    snippet: "jsonTemplate: true,",
  },
  {
    label: "textTemplate",
    detail: "boolean",
    description: "Enable text template processing with {ts: :} syntax",
    snippet: "textTemplate: true,",
  },
  {
    label: "onConflict",
    detail: "stop | skip | merge | overwrite | appendEnd | appendStart",
    description: "Conflict resolution strategy",
    snippet: 'onConflict: "$0",',
  },
  {
    label: "fileType",
    detail: "json | text",
    description: "Override automatic file type detection",
    snippet: 'fileType: "$0",',
  },
  {
    label: "scope",
    detail: "object",
    description: "Entry-specific scope variables for templates",
    snippet: "scope: {\n\t$0\n},",
  },
];

const MERGE_SOURCES = [
  "item_texture.json",
  "terrain_texture.json",
  "sound_definitions.json",
];

export class MapEntryCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ) {
    if (!document.fileName.endsWith("_map.ts")) return;

    const lineText = document.lineAt(position).text;
    const textBeforeCursor = lineText.slice(0, position.character);

    if (isInsideStringValue(textBeforeCursor)) {
      if (/target\s*:\s*["'][^"']*$/.test(textBeforeCursor)) {
        const sourceFile = getSourceValueForEntry(document, position.line);
        return TARGET_VALUES.map(({ label, detail }) => {
          const item = makeItem(label, detail);
          if (sourceFile) {
            const resolved = tryResolveAuto(
              label as ":auto" | ":autoFlat",
              sourceFile,
              document.fileName
            );
            if (resolved) {
              item.detail = resolved;
              item.documentation = new vscode.MarkdownString(
                `Resolves to \`${resolved}\``
              );
            }
          }
          return item;
        });
      }

      if (/onConflict\s*:\s*["'][^"']*$/.test(textBeforeCursor)) {
        const suggested = getSuggestedConflict(document, position.line);
        return ON_CONFLICT_VALUES.map(({ label, detail }) => {
          const item = makeItem(label, detail);
          if (label === suggested) {
            item.preselect = true;
            item.sortText = "0";
          }
          return item;
        });
      }

      if (/fileType\s*:\s*["'][^"']*$/.test(textBeforeCursor)) {
        return FILE_TYPE_VALUES.map(({ label, detail }) => makeItem(label, detail));
      }

      return;
    }

    if (isInsideMapEntry(document, position)) {
      const existingFields = getExistingFields(document, position.line);
      return MAP_ENTRY_FIELDS
        .filter(({ label }) => !existingFields.has(label))
        .map(({ label, detail, description, snippet }) => {
          const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.Field);
          item.detail = detail;
          item.documentation = new vscode.MarkdownString(description);
          item.insertText = new vscode.SnippetString(snippet);
          item.sortText = label === "source" ? "0" : label === "target" ? "1" : label;
          return item;
        });
    }
  }
}

export class AutoTargetHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.Hover | null {
    if (!document.fileName.endsWith("_map.ts")) return null;

    const lineText = document.lineAt(position).text;

    // Check if hovering over :auto or :autoFlat in a target line
    const targetMatch = lineText.match(/target\s*:\s*["'](:auto(?:Flat)?)["']/);
    if (!targetMatch) return null;

    const keyword = targetMatch[1] as ":auto" | ":autoFlat";
    const keywordStart = lineText.indexOf(keyword);
    const keywordEnd = keywordStart + keyword.length;
    const hoverRange = new vscode.Range(position.line, keywordStart, position.line, keywordEnd);

    if (position.character < keywordStart || position.character > keywordEnd) return null;

    const sourceFile = getSourceValueForEntry(document, position.line);
    if (!sourceFile) {
      return new vscode.Hover(
        new vscode.MarkdownString(`**${keyword}**\n\nNo \`source\` found in this entry.`),
        hoverRange
      );
    }

    const resolved = tryResolveAuto(keyword, sourceFile, document.fileName);
    if (!resolved) {
      return new vscode.Hover(
        new vscode.MarkdownString(
          `**${keyword}**\n\nCould not resolve — no matching suffix in \`auto-map.ts\` for \`${sourceFile}\`.`
        ),
        hoverRange
      );
    }

    return new vscode.Hover(
      new vscode.MarkdownString(
        `**${keyword}** → \`${resolved}\``
      ),
      hoverRange
    );
  }
}

function tryResolveAuto(
  keyword: ":auto" | ":autoFlat",
  sourceFile: string,
  mapFilePath: string
): string | null {
  try {
    return resolveAutoTarget(sourceFile, keyword, mapFilePath);
  } catch {
    return null;
  }
}

// Walk back from current line to find source value in the same entry
function getSourceValueForEntry(
  document: vscode.TextDocument,
  currentLine: number
): string | null {
  let braceDepth = 0;
  let entryStart = currentLine;

  for (let i = currentLine; i >= 0; i--) {
    const line = document.lineAt(i).text;
    for (let c = line.length - 1; c >= 0; c--) {
      if (line[c] === "}") braceDepth++;
      if (line[c] === "{") {
        if (braceDepth === 0) { entryStart = i; break; }
        braceDepth--;
      }
    }
    if (entryStart !== currentLine) break;
  }

  for (let i = entryStart; i <= currentLine + 5; i++) {
    if (i >= document.lineCount) break;
    const match = document.lineAt(i).text.match(/source\s*:\s*["']([^"']+)["']/);
    if (match) return match[1];
  }

  return null;
}

function isInsideMapEntry(
  document: vscode.TextDocument,
  position: vscode.Position
): boolean {
  let braceDepth = 0;
  let bracketDepth = 0;

  for (let i = position.line; i >= 0; i--) {
    const line = document.lineAt(i).text;
    const end = i === position.line ? position.character : line.length;

    for (let c = end - 1; c >= 0; c--) {
      const ch = line[c];
      if (ch === "}") braceDepth++;
      if (ch === "{") {
        if (braceDepth === 0) return bracketDepth === 0;
        braceDepth--;
      }
      if (ch === "]") bracketDepth++;
      if (ch === "[") bracketDepth--;
    }
  }
  return false;
}

function getExistingFields(
  document: vscode.TextDocument,
  currentLine: number
): Set<string> {
  const fields = new Set<string>();
  let braceDepth = 0;
  let entryStart = currentLine;

  for (let i = currentLine; i >= 0; i--) {
    const line = document.lineAt(i).text;
    for (let c = line.length - 1; c >= 0; c--) {
      if (line[c] === "}") braceDepth++;
      if (line[c] === "{") {
        if (braceDepth === 0) { entryStart = i; break; }
        braceDepth--;
      }
    }
    if (entryStart !== currentLine) break;
  }

  braceDepth = 0;
  let entryEnd = currentLine;
  for (let i = entryStart; i < document.lineCount; i++) {
    const line = document.lineAt(i).text;
    for (const ch of line) {
      if (ch === "{") braceDepth++;
      if (ch === "}") {
        braceDepth--;
        if (braceDepth === 0) { entryEnd = i; break; }
      }
    }
    if (entryEnd !== currentLine) break;
  }

  for (let i = entryStart; i <= entryEnd; i++) {
    const match = document.lineAt(i).text.match(
      /^\s*(source|target|jsonTemplate|textTemplate|onConflict|fileType|scope)\s*:/
    );
    if (match) fields.add(match[1]);
  }

  return fields;
}

function getSuggestedConflict(
  document: vscode.TextDocument,
  currentLine: number
): string | null {
  let braceDepth = 0;
  let entryStart = currentLine;

  for (let i = currentLine; i >= 0; i--) {
    const line = document.lineAt(i).text;
    for (let c = line.length - 1; c >= 0; c--) {
      if (line[c] === "}") braceDepth++;
      if (line[c] === "{") {
        if (braceDepth === 0) { entryStart = i; break; }
        braceDepth--;
      }
    }
    if (i === entryStart && i !== currentLine) break;
  }

  for (let i = entryStart; i <= currentLine + 5; i++) {
    if (i >= document.lineCount) break;
    const match = document.lineAt(i).text.match(/source\s*:\s*["']([^"']+)["']/);
    if (!match) continue;
    const source = match[1];
    if (source.endsWith(".lang")) return "appendEnd";
    if (MERGE_SOURCES.some((s) => source.endsWith(s))) return "merge";
  }

  return null;
}

function makeItem(label: string, detail: string): vscode.CompletionItem {
  const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.EnumMember);
  item.detail = detail;
  item.insertText = label;
  return item;
}

function isInsideStringValue(textBeforeCursor: string): boolean {
  const quotes = textBeforeCursor.match(/(?<!\\)["']/g) ?? [];
  return quotes.length % 2 === 1;
}
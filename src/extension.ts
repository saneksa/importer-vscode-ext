/* eslint-disable @typescript-eslint/naming-convention */
import {
  window,
  workspace,
  commands,
  Disposable,
  ExtensionContext,
  TextDocument,
  Position,
  Range,
  TextDocumentWillSaveEvent,
} from "vscode";

import { readdirSync, lstatSync } from "fs";

const isDirectory = (source: string) => lstatSync(source).isDirectory();

const getDirectories = (source: string) =>
  readdirSync(source)
    .map((name) => ({ source, name }))
    .filter((e) => isDirectory(e.source));

const isTypescript = (languageId: TextDocument["languageId"]) =>
  languageId === "typescript" || languageId === "typescriptreact";

const isJavascript = (languageId: TextDocument["languageId"]) =>
  languageId === "javascript" || languageId === "javascriptreact";

const isSupportedLanguage = ({ languageId }: TextDocument) =>
  isTypescript(languageId) || isJavascript(languageId);

const importRegex = new RegExp(
  /import(?:["'\s]*([\w*${}\n\r\t, ]+)from\s*)?["'\s]["'\s](.*[@\w_-]+)["'\s].*;$/,
  "mg"
);

export function activate(ctx: ExtensionContext) {
  console.log("Typescript MonoRepo Import Helper is now active");

  const importFixer = new ImportFixer();
  const controller = new ImportFixerController(importFixer);

  ctx.subscriptions.push(controller);
  ctx.subscriptions.push(importFixer);
}

export class ImportFixer {
  public checkForBrokenImports(doc: TextDocument) {
    const editor = window.activeTextEditor;
    if (!editor) {
      return;
    }

    if (doc !== editor.document) {
      return;
    }

    if (!isSupportedLanguage(doc)) {
      return;
    }

    const packagesDirectoryMatch = doc.fileName.match(
      /(.*\/packages)\/[^\/]*\//
    );

    if (!packagesDirectoryMatch) {
      return;
    }

    const packagesDirectory = packagesDirectoryMatch[1];

    const modules = getDirectories(packagesDirectory).map((e) => e.name);

    const match = doc.getText().matchAll(importRegex);

    editor.edit((builder) => {
      while (true) {
        const mathValue = match.next();

        if (mathValue.done) {
          break;
        }

        const importPath = mathValue.value[2];

        const name = "@im/";

        if (modules.some((m) => importPath.includes(m))) {
          if (!importPath.includes(name) && mathValue.value.index) {
            builder.insert(
              doc.positionAt(doc.getText().indexOf(importPath)),
              name
            );
          }
        }
      }
    });
  }

  public dispose() {}
}

class ImportFixerController {
  private _importFixer: ImportFixer;
  private _disposable: Disposable;

  constructor(ImportFixer: ImportFixer) {
    this._importFixer = ImportFixer;

    // subscribe to selection change and editor activation events
    let subscriptions: Disposable[] = [];
    workspace.onWillSaveTextDocument(this._onEvent, this, subscriptions);

    // create a combined disposable from both event subscriptions
    this._disposable = Disposable.from(...subscriptions);
  }

  private _onEvent(event: TextDocumentWillSaveEvent) {
    this._importFixer.checkForBrokenImports(event.document);
  }

  public dispose() {
    this._disposable.dispose();
  }
}

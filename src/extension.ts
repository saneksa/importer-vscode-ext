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
  TextEditorEdit,
} from "vscode";
import fs from "fs";
import path from "path";

type TCheckRelativeImportParams = {
  doc: TextDocument;
  importPath: string;
  packagesDirectory: string;
  builder: TextEditorEdit;
  value: RegExpMatchArray;
};

const isDirectory = (source: string) => fs.lstatSync(source).isDirectory();

const getDirectories = (source: string) =>
  fs
    .readdirSync(source)
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

const relativeImportRegex = /^[\/..]{4}.*$/;

export function activate(ctx: ExtensionContext) {
  console.log("Typescript MonoRepo with Submodules init");

  const importFixer = new ImportFixer();
  const controller = new ImportFixerController(importFixer);

  ctx.subscriptions.push(controller);
  ctx.subscriptions.push(importFixer);
}

export class ImportFixer {
  private checkRelativeImport({
    doc,
    importPath,
    packagesDirectory,
    builder,
    value,
  }: TCheckRelativeImportParams) {
    const prefix = workspace
      .getConfiguration()
      .get("importer.view.addingPrefixPath") as string;

    if (relativeImportRegex.test(importPath)) {
      const absoluteForPackagesPath = path.resolve(
        doc.fileName,
        "..",
        importPath
      );

      let isExists = false;

      try {
        isExists =
          fs
            .readdirSync(path.dirname(absoluteForPackagesPath))
            .filter((v) => v.includes(path.basename(absoluteForPackagesPath)))
            ?.length > 0;
      } catch (error) {
        console.log("importer-ms ", error);
        return;
      }

      const correctImportPath = absoluteForPackagesPath.substring(
        packagesDirectory.length + 1
      );

      if (
        isExists &&
        !importPath.includes(prefix) &&
        typeof value.index === "number"
      ) {
        builder.replace(
          new Range(
            doc.positionAt(value.index),
            doc.positionAt(value.index + value[0].length)
          ),
          `import ${value[1].trim()} from "${prefix}${correctImportPath}";`
        );
      }
    }
  }

  public checkForBrokenImports(doc: TextDocument) {
    const editor = window.activeTextEditor;

    const prefix = workspace
      .getConfiguration()
      .get("importer.view.addingPrefixPath") as string;

    if (!editor) {
      return;
    }

    if (doc !== editor.document) {
      return;
    }

    if (!isSupportedLanguage(doc)) {
      return;
    }

    if (!prefix) {
      return;
    }
    const packagesName = "packages";

    const packagesIndex = doc.fileName.indexOf(packagesName);

    if (packagesIndex === -1) {
      return;
    }

    const packagesDirectory = doc.fileName.slice(
      0,
      packagesIndex + packagesName.length
    );

    const modules = getDirectories(packagesDirectory).map((e) => e.name);

    const match = doc.getText().matchAll(importRegex);

    editor.edit((builder) => {
      while (true) {
        const iterator = match.next();
        const value: RegExpMatchArray = iterator.value;

        if (iterator.done) {
          break;
        }

        const importPath = value[2];

        try {
          this.checkRelativeImport({
            doc,
            importPath,
            packagesDirectory,
            builder,
            value,
          });
        } catch (error) {
          console.log("importer-ms ", error);
        }

        if (modules.some((m) => importPath.indexOf(`${m}/`) === 0)) {
          if (!importPath.includes(prefix) && typeof value.index === "number") {
            builder.replace(
              new Range(
                doc.positionAt(value.index),
                doc.positionAt(value.index + value[0].length)
              ),
              `import ${value[1].trim()} from "${prefix}${value[2]}";`
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

    let subscriptions: Disposable[] = [];
    workspace.onWillSaveTextDocument(this._onEvent, this, subscriptions);

    this._disposable = Disposable.from(...subscriptions);
  }

  private _onEvent(event: TextDocumentWillSaveEvent) {
    this._importFixer.checkForBrokenImports(event.document);
  }

  public dispose() {
    this._disposable.dispose();
  }
}

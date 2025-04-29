/* eslint-disable @typescript-eslint/naming-convention */
import {
  window,
  workspace,
  Disposable,
  ExtensionContext,
  TextDocument,
  Range,
  TextDocumentWillSaveEvent,
  TextEditorEdit,
} from "vscode";
import { lstatSync, readdirSync } from "fs";
import { resolve, basename, dirname, sep, posix } from "path";

type TCheckRelativeImportParams = {
  doc: TextDocument;
  importPath: string;
  packagesDirectory: string;
  builder: TextEditorEdit;
  value: RegExpMatchArray;
  prefix: string;
  absoluteForPackagesPath: string;
};

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

const getRelativeImportRegex = (depth: number) =>
  new RegExp(`^[\/..]{${depth * 2}}.*$`);

const replaceWinSep = (p: string) => p.replaceAll(posix.win32.sep, posix.sep);

export function activate(ctx: ExtensionContext) {
  const importFixer = new ImportFixer();
  const controller = new ImportFixerController(importFixer);

  ctx.subscriptions.push(controller);
  ctx.subscriptions.push(importFixer);
}

function findMatchingAlias(
  config: Record<string, string>,
  fullPath: string,
  projectRoot: string
) {
  let bestMatch = null;
  let longestMatchLength = 0;

  for (const [alias, relativePath] of Object.entries(config)) {
    const resolvedPath = resolve(projectRoot, relativePath.replace("/*", ""));

    if (
      fullPath.startsWith(resolvedPath) &&
      resolvedPath.length > longestMatchLength
    ) {
      bestMatch = alias;
      longestMatchLength = resolvedPath.length;
    }
  }

  return bestMatch;
}

export class ImportFixer {
  private checkRelativeImport({
    doc,
    importPath,
    packagesDirectory,
    builder,
    value,
    prefix,
    absoluteForPackagesPath,
  }: TCheckRelativeImportParams) {
    const excludePaths = workspace
      .getConfiguration()
      .get("importer.view.excludePathsAutoFix") as string[];

    const depth = workspace
      .getConfiguration()
      .get("importer.view.relativeImportDepth") as number;

    const isExclude = excludePaths.some((path) =>
      new RegExp(replaceWinSep(path)).test(replaceWinSep(doc.fileName))
    );

    if (!getRelativeImportRegex(depth).test(importPath) || isExclude) {
      return;
    }

    let isExists = false;

    try {
      const absPath = absoluteForPackagesPath.split("?")[0];

      isExists =
        readdirSync(dirname(absPath)).filter((v) =>
          v.includes(basename(absPath))
        )?.length > 0;
    } catch (error) {
      console.log("importer-ms ", error);
      return;
    }

    const correctImportPath = absoluteForPackagesPath
      .substring(packagesDirectory.length + 1)
      .replaceAll(sep, "/");

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
        value[1] === undefined
          ? `import "${prefix}/${correctImportPath}";`
          : `import ${value[1].trim()} from "${prefix}/${correctImportPath}";`
      );
    }
  }

  public checkForBrokenImports(doc: TextDocument) {
    const editor = window.activeTextEditor;

    const checkingDirNames = workspace
      .getConfiguration()
      .get("importer.view.checkingDirNames") as string[];

    const defaultPrefix = workspace
      .getConfiguration()
      .get("importer.view.defaultPrefixPath") as string;

    const matchingPrefixToPath = workspace
      .getConfiguration()
      .get("importer.view.matchingPrefixToPath") as Record<string, string>;

    if (!editor) {
      return;
    }

    if (doc !== editor.document) {
      return;
    }

    if (!isSupportedLanguage(doc)) {
      return;
    }

    if (!defaultPrefix) {
      return;
    }

    checkingDirNames.forEach((dirName) => {
      const packagesIndex = doc.fileName.indexOf(dirName);

      if (packagesIndex === -1) {
        return;
      }

      const packagesDirectory = doc.fileName.slice(
        0,
        packagesIndex + dirName.length
      );

      const rootProjectPath = resolve(packagesDirectory, "..");

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
          const absoluteForPackagesPath = resolve(
            doc.fileName,
            "..",
            importPath
          );

          const prefix =
            findMatchingAlias(
              matchingPrefixToPath,
              absoluteForPackagesPath,
              rootProjectPath
            ) || defaultPrefix;

          try {
            this.checkRelativeImport({
              doc,
              importPath,
              packagesDirectory,
              builder,
              value,
              prefix,
              absoluteForPackagesPath,
            });
          } catch (error) {
            console.log("importer-ms ", error);
          }

          if (modules.some((m) => importPath.indexOf(`${m}/`) === 0)) {
            if (
              !importPath.includes(prefix) &&
              typeof value.index === "number"
            ) {
              builder.replace(
                new Range(
                  doc.positionAt(value.index),
                  doc.positionAt(value.index + value[0].length)
                ),

                value[1] === undefined
                  ? `import "${prefix}/${value[2]}";`
                  : `import ${value[1].trim()} from "${prefix}/${value[2]}";`
              );
            }
          }
        }
      });
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

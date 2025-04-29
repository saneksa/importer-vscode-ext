# importer-monorep-submodules README

### Fixes the problem of adding a company prefix to the path

---

# Using

```json
// *.code-workspace
{
  "importer.view.defaultPrefixPath": "@test",
  "importer.view.matchingPrefixToPath": {
    "@testing": "libs/base",
    "@test": "packages"
  },
  "importer.view.checkingDirNames": ["packages", "libs"],
  "importer.view.excludePathsAutoFix": ["packages/test"],
  "importer.view.relativeImportDepth": 2
}
```

---

**Enjoy!**

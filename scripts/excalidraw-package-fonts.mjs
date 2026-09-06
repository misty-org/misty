import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import ts from "typescript";

/** Excalidraw's published JS leaves fonts as CDN paths. Keep downloaded Journal offline. */
export function excalidrawPackageFonts() {
  let fonts = 0, loaders = 0;
  return {
    name: "misty-excalidraw-package-fonts",
    async transform(code, id) {
      if (!/\/node_modules\/@excalidraw\/excalidraw\/dist\/(prod|dev)\/[^/]+\.js$/.test(id)) return;
      const literals = [...code.matchAll(/(["'])(\.\/fonts\/[A-Za-z0-9_./-]+\.woff2)\1/g)];
      if (!literals.length) return;
      const changes = await Promise.all(literals.map(async (match) => {
        const bytes = await readFile(resolve(dirname(id), match[2]));
        if (bytes.subarray(0, 4).toString() !== "wOF2") throw new Error(`Invalid packaged Excalidraw font: ${match[2]}`);
        return { start: match.index, end: match.index + match[0].length, replacement: JSON.stringify(`data:font/woff2;base64,${bytes.toString("base64")}`) };
      }));
      const source = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      let localLoaders = 0;
      const visit = (node) => {
        if (ts.isMethodDeclaration(node) && node.name.getText(source) === "fetchFont" && node.body) {
          if (node.parameters.length !== 1 || !ts.isIdentifier(node.parameters[0].name)) throw new Error("Excalidraw font loader changed; review its offline adapter.");
          const content = node.parent.members.find((member) => ts.isMethodDeclaration(member) && member.name.getText(source) === "getContent" && member.body);
          if (!content) throw new Error("Excalidraw font loader changed; review its offline adapter.");
          // Export the matching unicode font shard directly. Subsetting uses a worker/WASM
          // path that cannot run from the installed component under the host's CSP.
          changes.push({ start: content.body.getStart(source), end: content.body.end, replacement: `{
            return Promise.resolve(this.urls.length ? String(this.urls[0]) : "");
          }` });
          const parameter = node.parameters[0].name.text;
          // Keep the byte accessor local too, without a fetch, CDN or CSP exception.
          changes.push({ start: node.body.getStart(source), end: node.body.end, replacement: `{
            return Promise.resolve().then(() => {
              const value = String(${parameter});
              const prefix = "data:font/woff2;base64,";
              if (!value.startsWith(prefix)) throw new Error("This font is not in the downloaded Journal package.");
              return Uint8Array.from(atob(value.slice(prefix.length)), character => character.charCodeAt(0)).buffer;
            });
          }` });
          localLoaders++;
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      if (localLoaders !== 1) throw new Error("Excalidraw font loader changed; review its offline adapter.");
      for (const change of changes.sort((a, b) => b.start - a.start))
        code = code.slice(0, change.start) + change.replacement + code.slice(change.end);
      fonts += literals.length; loaders += localLoaders;
      return { code, map: null };
    },
    generateBundle() {
      if (!fonts || loaders !== 1) this.error("Journal fonts were not packaged with their offline loader.");
    },
  };
}

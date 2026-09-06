import { resolve } from "node:path";
import ts from "typescript";

const virtual = "misty:journal-sdk-interop";
const capabilities = ["probablySupportsClipboardReadText", "probablySupportsClipboardWriteText", "probablySupportsClipboardBlob"];
const methods = ["readSystemClipboard", "copyTextToSystemClipboard", "copyBlobToClipboardAsPng", "fileOpen", "fileSave"];

/** Route the dependency's own actions through the same instance SDK as the Journal UI. */
export function excalidrawSdkInterop() {
  let transformed = false;
  return {
    name: "misty-excalidraw-sdk-interop",
    enforce: "pre",
    resolveId(source) {
      // The readable, published dependency entry has stable adapter points. It is still compiled/minified for production.
      if (source === "@excalidraw/excalidraw") return resolve(import.meta.dirname, "../node_modules/@excalidraw/excalidraw/dist/dev/index.js");
      if (source === virtual) return `\0${virtual}`;
    },
    load(id) {
      if (id !== `\0${virtual}`) return;
      return `import { createSdkDrawingInterop } from ${JSON.stringify(resolve(import.meta.dirname, "../src/features/drawings/sdkDrawingInterop.ts"))};
        export const interop = createSdkDrawingInterop(MistyComponentRuntime.sdk, MistyComponentRuntime.signal);`;
    },
    transform(code, id) {
      if (!/\/node_modules\/@excalidraw\/excalidraw\/dist\/dev\/[^/]+\.js$/.test(id) || !code.includes("var readSystemClipboard")) return;
      const source = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      const replacements = [];
      const found = new Set();
      const visit = (node) => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && [...methods, ...capabilities].includes(node.name.text) && node.initializer) {
          if (found.has(node.name.text) || (methods.includes(node.name.text) && !ts.isArrowFunction(node.initializer))) throw new Error("Excalidraw's device actions changed; review the SDK adapter.");
          found.add(node.name.text);
          replacements.push({ start: node.initializer.getStart(source), end: node.initializer.end, code: capabilities.includes(node.name.text) ? "true" : `MistyDrawingInterop.${node.name.text}` });
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      if (found.size !== methods.length + capabilities.length || transformed) throw new Error("Excalidraw's device actions changed; review the SDK adapter.");
      for (const replacement of replacements.sort((a, b) => b.start - a.start))
        code = code.slice(0, replacement.start) + replacement.code + code.slice(replacement.end);
      transformed = true;
      return { code: `import { interop as MistyDrawingInterop } from ${JSON.stringify(virtual)};\n${code}`, map: null };
    },
    generateBundle() {
      if (!transformed) this.error("Journal's drawing-library device actions did not receive an SDK adapter.");
    },
  };
}

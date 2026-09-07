import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import ts from "typescript";

const virtual = "misty:journal-fonts";
const assetPrefix = "official-app-assets/journal/";
/** Keep common fonts bundled; fetch CJK shards through the SDK only when used. */
export function excalidrawPackageFonts({ assetDirectory } = {}) {
  let fonts = 0,
    loaders = 0;
  const assets = new Map();
  return {
    name: "misty-excalidraw-package-fonts",
    resolveId(id) {
      if (id === virtual) return `\0${virtual}`;
    },
    load(id) {
      if (id !== `\0${virtual}`) return;
      return `import {createSdkDrawingFonts} from ${JSON.stringify(resolve(import.meta.dirname, "../src/features/drawings/sdkDrawingFonts.ts"))};
        export const fonts = createSdkDrawingFonts(MistyComponentRuntime.sdk, MistyComponentRuntime.signal);`;
    },
    async transform(code, id) {
      if (!/\/node_modules\/@excalidraw\/excalidraw\/dist\/(prod|dev)\/[^/]+\.js$/.test(id)) return;
      const literals = [...code.matchAll(/(["'])(\.\/fonts\/[A-Za-z0-9_./-]+\.woff2)\1/g)];
      if (!literals.length) return;
      const changes = await Promise.all(
        literals.map(async (match) => {
          const bytes = await readFile(resolve(dirname(id), match[2]));
          if (bytes.subarray(0, 4).toString() !== "wOF2")
            throw new Error(`Invalid Excalidraw font: ${match[2]}`);
          let uri;
          if (match[2].startsWith("./fonts/Xiaolai/")) {
            if (bytes.length > 128 * 1024)
              throw new Error("Optional font exceeds the SDK network limit.");
            const hash = createHash("sha256").update(bytes).digest("hex");
            const key = `${assetPrefix}${hash}.woff2`;
            assets.set(key, bytes);
            uri = `https://apps.mistysys.com/${key}`;
          } else uri = `data:font/woff2;base64,${bytes.toString("base64")}`;
          return {
            start: match.index,
            end: match.index + match[0].length,
            replacement: JSON.stringify(uri),
          };
        }),
      );
      const source = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      let localLoaders = 0,
        constructors = 0,
        sceneLoaders = 0,
        exportGuards = 0,
        sceneObservers = 0;
      const replace = (node, replacement) =>
        changes.push({ start: node.getStart(source), end: node.end, replacement });
      const visit = (node) => {
        if (
          ts.isConstructorDeclaration(node) &&
          node.body?.getText(source).includes('"loadSceneFonts"')
        ) {
          const assignment = node.body.statements.find(
            (statement) => statement.getText(source) === "this.scene = scene;",
          );
          if (!assignment) throw new Error("Excalidraw font scene constructor changed.");
          replace(
            assignment,
            `this.scene = scene;
            MistyDrawingFonts.observeScene(scene, () => this.loadSceneFonts().then(faces => this.onLoaded(faces)));`,
          );
          sceneObservers++;
        }
        if (ts.isMethodDeclaration(node) && node.body) {
          const name = node.name.getText(source);
          if (name === "fetchFont") {
            if (node.parameters.length !== 1 || !ts.isIdentifier(node.parameters[0].name))
              throw new Error("Excalidraw font loader changed; review its SDK adapter.");
            const content = node.parent.members.find(
              (member) =>
                ts.isMethodDeclaration(member) &&
                member.name.getText(source) === "getContent" &&
                member.body,
            );
            if (!content)
              throw new Error("Excalidraw font loader changed; review its SDK adapter.");
            replace(
              content.body,
              '{ return MistyDrawingFonts.content(String(this.urls[0] || "")); }',
            );
            replace(
              node.body,
              `{ return MistyDrawingFonts.read(String(${node.parameters[0].name.text})); }`,
            );
            localLoaders++;
          }
          if (name === "loadFontFaces") {
            const original = node.body.getText(source);
            const guard = "if (!window.document.fonts.has(fontFace))";
            if (
              node.parameters.map((p) => p.name.getText(source)).join(",") !==
                "fontFamilies,charsPerFamily" ||
              !original.includes(guard)
            )
              throw new Error("Excalidraw scene font loading changed; review its SDK adapter.");
            replace(
              node.body,
              original
                .replace(
                  "{",
                  `{
              const mistyCharacters = fontFamilies.filter(family => getFontFamilyFallbacks(family).includes(CJK_HAND_DRAWN_FALLBACK_FONT))
                .map(family => _Fonts.getCharacters(charsPerFamily, family)).join("");
              const mistyLoaded = containsCJK(mistyCharacters) ? await MistyDrawingFonts.prepare(
                _Fonts.registered.get(FONT_FAMILY_FALLBACKS[CJK_HAND_DRAWN_FALLBACK_FONT])?.fontFaces || [], mistyCharacters) : [];
            `,
                )
                .replace(
                  guard,
                  "if (!MistyDrawingFonts.isPending(fontFace) && !window.document.fonts.has(fontFace))",
                )
                .replace(
                  "return fontFaces.flat().filter(Boolean);",
                  "return [...mistyLoaded, ...fontFaces.flat().filter(Boolean)];",
                ),
            );
            sceneLoaders++;
            return;
          }
          if (name === "fontFacesStylesGenerator") {
            const protect = (child) => {
              if (ts.isCatchClause(child)) {
                if (!child.variableDeclaration || !ts.isIdentifier(child.variableDeclaration.name))
                  throw new Error("Excalidraw font export handler changed.");
                replace(child.block, `{ throw ${child.variableDeclaration.name.text}; }`);
                exportGuards++;
                return;
              }
              ts.forEachChild(child, protect);
            };
            protect(node.body);
            return;
          }
        }
        if (ts.isNewExpression(node) && node.expression.getText(source) === "FontFace") {
          if (node.arguments?.length !== 3) throw new Error("Excalidraw font constructor changed.");
          replace(
            node,
            `MistyDrawingFonts.createFace(${node.arguments[0].getText(source)}, uri, ${node.arguments[1].getText(source)}, ${node.arguments[2].getText(source)})`,
          );
          constructors++;
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
      if (
        localLoaders !== 1 ||
        constructors !== 1 ||
        sceneLoaders !== 1 ||
        exportGuards !== 1 ||
        sceneObservers !== 1
      )
        throw new Error("Excalidraw font loader changed; review its SDK adapter.");
      for (const change of changes.sort((a, b) => b.start - a.start))
        code = code.slice(0, change.start) + change.replacement + code.slice(change.end);
      fonts += literals.length;
      loaders += localLoaders;
      return {
        code: `import {fonts as MistyDrawingFonts} from ${JSON.stringify(virtual)};\n${code}`,
        map: null,
      };
    },
    async generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "licenses/Xiaolai-OFL.txt",
        source: await readFile(resolve(import.meta.dirname, "licenses/Xiaolai-OFL.txt")),
      });
      if (!fonts || loaders !== 1 || !assets.size)
        this.error("Journal's optional font adapter was not applied.");
    },
    async writeBundle() {
      if (!assetDirectory) throw new Error("Journal optional asset output directory is required.");
      const records = [];
      for (const [key, bytes] of [...assets].sort(([a], [b]) => a.localeCompare(b))) {
        const file = resolve(assetDirectory, key);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, bytes);
        records.push({
          key,
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      }
      const license = await readFile(resolve(import.meta.dirname, "licenses/Xiaolai-OFL.txt"));
      const licenseRecord = {
        key: assetPrefix + "Xiaolai-OFL.txt",
        bytes: license.length,
        sha256: createHash("sha256").update(license).digest("hex"),
      };
      await writeFile(resolve(assetDirectory, licenseRecord.key), license);
      await writeFile(
        resolve(assetDirectory, "optional-assets.json"),
        JSON.stringify(
          {
            schemaVersion: 1,
            appId: "journal",
            origins: ["https://apps.mistysys.com"],
            assets: records,
            license: licenseRecord,
          },
          null,
          2,
        ) + "\n",
      );
    },
  };
}

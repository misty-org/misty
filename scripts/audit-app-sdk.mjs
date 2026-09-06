import { mistyServerMethods, mistyTerminalContracts, mistyAppUiContracts, mistyBrowserContracts, mistyCollaborationContracts, mistyJournalAssetContracts, mistyAiControlsContracts, mistyClipboardContracts, mistyMailCacheContracts, mistyDirectoryContracts, mistyTextFileContracts, mistyCodeLspContracts, mistyDirectoryMutationContracts, mistyFileObservationContracts, mistyFileTransferContracts, mistyFileEditingContracts, mistyFilePreviewContracts } from '@misty/contracts';
import ts from 'typescript';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const appsRoot = resolve(root, '../misty-apps');
const sdkRoot = resolve(root, '../misty-sdk/packages/sdk/src');
const catalogApps = JSON.parse(readFileSync(resolve(appsRoot, 'apps/catalog.json'), 'utf8')).apps;
const appIds = catalogApps.map(app => app.id);
const entries = appIds.map(id => resolve(root, `src/features/apps/package/entries/${id}.tsx`));
const extensions = { quick_convert: 'quickConvert/QuickConvertPlugin.tsx', themes: 'themes/ThemesPlugin.tsx', storage_report: 'storageReport/StorageReportPlugin.tsx', image_optimizer: 'imageOptimizer/ImageOptimizerPlugin.tsx', backups: 'backups/BackupsPlugin.tsx', ytdlp: 'ytdlp/YtdlpPlugin.tsx' };
for (const [id, file] of Object.entries(extensions)) { appIds.push(id); entries.push(resolve(appsRoot, 'src/plugins', file)); }
const config = ts.readConfigFile(resolve(root, 'tsconfig.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
// The Journal build injects this SDK adapter into the drawing dependency; include it explicitly.
const injectedSources = { journal: [resolve(root, 'src/features/drawings/sdkDrawingInterop.ts')] };
const program = ts.createProgram([...entries, ...Object.values(injectedSources).flat()], parsed.options);
const checker = program.getTypeChecker();
const projectSource = file => (file.startsWith(resolve(root, 'src') + '/') || file.startsWith(resolve(appsRoot, 'src') + '/') || file.startsWith(sdkRoot + '/')) && !/\.(test|spec)\./.test(file);
const inventories = {};

for (const [index, appId] of appIds.entries()) {
  const queue = [program.getSourceFile(entries[index]), ...(injectedSources[appId] ?? []).map(file => program.getSourceFile(file))];
  const seen = new Set();
  const calls = new Map();
  const files = new Set();
  function enqueueDeclaration(declaration) {
    if (!declaration || !projectSource(declaration.getSourceFile().fileName)) return;
    let node = declaration;
    while (node.parent && !ts.isSourceFile(node.parent)) node = node.parent;
    if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) queue.push(node);
  }
  function visit(node) {
    if (ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isImportDeclaration(node)) return;
    // Factory service objects often use { Component, store, readFile }. The
    // shorthand property's own symbol is not the runtime value it references.
    if (ts.isShorthandPropertyAssignment(node)) {
      let value = checker.getShorthandAssignmentValueSymbol(node);
      if (value?.flags & ts.SymbolFlags.Alias) value = checker.getAliasedSymbol(value);
      if (value?.valueDeclaration) enqueueDeclaration(value.valueDeclaration);
    }
    // Follow runtime values, not a property's structural type declaration.
    // An injected SDK adapter may satisfy Pick<typeof hostApi, ...>; following
    // its method symbol would falsely attribute the host transport to the app.
    if (ts.isIdentifier(node) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) {
      let symbol = checker.getSymbolAtLocation(node);
      if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      if (symbol?.valueDeclaration) enqueueDeclaration(symbol.valueDeclaration);
      else for (const declaration of symbol?.declarations ?? []) {
        if (ts.isFunctionDeclaration(declaration)) enqueueDeclaration(declaration);
      }
    }
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) {
        const resolved = ts.resolveModuleName(node.arguments[0].text, node.getSourceFile().fileName, parsed.options, ts.sys).resolvedModule;
        if (resolved && projectSource(resolved.resolvedFileName)) queue.push(program.getSourceFile(resolved.resolvedFileName));
      }
      const text = node.expression.getText();
      const leaf = text.split('.').at(-1);
      let kind;
      if (['invoke', 'tauriInvoke'].includes(leaf)) kind = 'native';
      else if (['listen', 'once', 'emit', 'emitTo'].includes(leaf)) kind = 'event';
      else if (['apiRequest', 'apiBlobRequest', 'httpRequest', 'httpBlob', 'fetch', 'appRequest', 'request'].includes(leaf)) kind = 'server-or-network';
      if (!kind && /(?:sdk|misty|client)(?:\.current[!?]?)?\??\.[a-z]+\??\.[a-zA-Z]+$/.test(text)) kind = 'sdk';
      if (kind) {
        const source = node.getSourceFile();
        const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const arg = node.arguments[0];
        const literal = arg && (ts.isStringLiteralLike(arg) || ts.isNoSubstitutionTemplateLiteral(arg));
        const first = literal ? arg.text : arg?.getText() ?? '';
        const type = arg && checker.getTypeAtLocation(arg);
        const variants = type?.isUnion() ? type.types : type ? [type] : [];
        const resolvedMethods = variants.length > 0 && variants.length <= 32 && variants.every(item => item.isStringLiteral())
          ? [...new Set(variants.map(item => item.value))] : [];
        const record = { kind, method: first, dynamic: !literal, resolvedMethods, callee: text, file: relative(root, source.fileName), line, arguments: node.arguments.slice(1).map(arg => arg.getText()) };
        calls.set(`${record.file}:${line}:${record.callee}`, record);
      }
    }
    ts.forEachChild(node, visit);
  }
  while (queue.length) {
    const node = queue.pop();
    if (!node || seen.has(node)) continue;
    seen.add(node);
    files.add(relative(root, node.getSourceFile().fileName));
    visit(node);
  }
  inventories[appId] = { entry: relative(root, entries[index]), files: [...files].sort(), calls: [...calls.values()].sort((a,b) => a.kind.localeCompare(b.kind) || a.file.localeCompare(b.file) || a.line-b.line) };
}
const nativeMethods = new Map();
for (const [appId, inventory] of Object.entries(inventories)) {
  for (const call of inventory.calls.filter(call => call.kind === 'native')) {
    for (const command of call.dynamic ? call.resolvedMethods : [call.method]) {
    let item = nativeMethods.get(command);
    if (!item) nativeMethods.set(command, item = { command, apps: [], sites: [] });
    if (!item.apps.includes(appId)) item.apps.push(appId);
    const site = `${call.file}:${call.line}`;
    if (!item.sites.includes(site)) item.sites.push(site);
    }
  }
}
const sdkSource = readdirSync(sdkRoot).filter(name => name.endsWith('.ts')).map(name => readFileSync(resolve(sdkRoot, name), 'utf8')).join('\n');
const existingSDKMethods = [...new Set([...Object.keys(mistyServerMethods), ...Object.keys(mistyTerminalContracts), ...Object.keys(mistyAppUiContracts), ...Object.keys(mistyBrowserContracts), ...Object.keys(mistyCollaborationContracts), ...Object.keys(mistyJournalAssetContracts), ...Object.keys(mistyAiControlsContracts), ...Object.keys(mistyClipboardContracts), ...Object.keys(mistyMailCacheContracts), ...Object.keys(mistyDirectoryContracts), ...Object.keys(mistyTextFileContracts), ...Object.keys(mistyCodeLspContracts), ...Object.keys(mistyDirectoryMutationContracts), ...Object.keys(mistyFileObservationContracts), ...Object.keys(mistyFileTransferContracts), ...Object.keys(mistyFileEditingContracts), ...Object.keys(mistyFilePreviewContracts), ...[...sdkSource.matchAll(/\bcall(?:<[^;]*?>)?\("([\w.]+)"/g)].map(match => match[1])])].sort();
const result = { schemaVersion: 1, analysis: 'Conservative symbol reachability from ten official app entries and six catalog extensions, including lazy imports. Referenced stores/objects include all of their methods. Dynamic calls are retained for manual classification; this is an inventory, not proof of runtime coverage.', apps: inventories, nativeMethods: [...nativeMethods.values()].sort((a,b) => a.command.localeCompare(b.command)), existingSDKMethods };
const output = resolve(root, 'docs/architecture/app-platform');
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'sdk-audit.json'), JSON.stringify(result, null, 2) + '\n');
const md = ['# App SDK dependency audit', '', result.analysis, '', 'Regenerate with `node scripts/audit-app-sdk.mjs`.', '', '| App | Catalog desktop runtime | Reachable source files | Native commands | Event call sites | Server/network call sites |', '| --- | --- | ---: | ---: | ---: | ---: |'];
for (const [appId, inventory] of Object.entries(inventories)) md.push(`| ${appId} | ${catalogApps.find(app => app.id === appId)?.desktop.runtime ?? "native extension"} | ${inventory.files.length} | ${new Set(inventory.calls.filter(c => c.kind === 'native').flatMap(c => c.dynamic ? c.resolvedMethods : [c.method])).size} | ${inventory.calls.filter(c=>c.kind==='event').length} | ${inventory.calls.filter(c=>c.kind==='server-or-network').length} |`);
md.push('', 'App entry sources can be candidates ahead of the normal catalog. A zero native-import count does not establish that the catalog has migrated or that shared host integration bridges have been verified.', '', `The audit found **${nativeMethods.size} distinct native commands (including finite string unions)**. The existing SDK has **${existingSDKMethods.length} named RPC methods**, plus generated storage/domain methods. Native command names and SDK method names are different contracts; matching counts do not demonstrate coverage.`, '', '## Native command inventory', '', '| Native command | Apps reaching it |', '| --- | --- |');
for (const method of result.nativeMethods) md.push(`| \`${method.command}\` | ${method.apps.join(', ')} |`);
md.push('', 'Exact source locations, argument expressions, dynamic requests, and reachable files are recorded in [sdk-audit.json](./sdk-audit.json).');
writeFileSync(resolve(output, 'sdk-audit.md'), md.join('\n') + '\n');
console.log(md.slice(0,19).join('\n'));

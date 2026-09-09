import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const directory = mkdtempSync(resolve(tmpdir(), 'misty-public-sdk-consumer-'));
const run = (args, cwd = directory) => execFileSync('npm', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
try {
  const packages = ['contracts', 'sdk'].map(name => {
    const dist = resolve(root, 'packages', name, 'dist');
    for (const file of readdirSync(dist).filter(file => file.endsWith('.js.map'))) {
      const map = JSON.parse(readFileSync(resolve(dist, file), 'utf8'));
      if (!Array.isArray(map.sourcesContent) || map.sourcesContent.length !== map.sources.length)
        throw new Error('Packed source maps must include their source content');
    }
    const packed = JSON.parse(run(['pack', '--json', '--pack-destination', directory], resolve(root, 'packages', name)))[0];
    if (packed.files.some(file => !file.path.startsWith('dist/') && file.path !== 'package.json' && !/^README|^LICENSE/.test(file.path))) throw new Error('Unexpected package contents');
    return resolve(directory, packed.filename);
  });
  writeFileSync(resolve(directory, 'package.json'), JSON.stringify({ name: 'public-sdk-consumer-check', private: true, type: 'module' }));
  run(['install', '--ignore-scripts', '--no-audit', '--no-fund', ...packages]);
  writeFileSync(resolve(directory, 'check.mjs'), `
    import assert from 'node:assert/strict';
    import { createMistyAppSDK, defineComponentApp } from '@misty/sdk';
    import { connectMistyYjs } from '@misty/sdk/yjs';
    import { parseAppRpcRequest } from '@misty/contracts';
    const sdk = createMistyAppSDK({ request: async ({ method }) => method === 'notes.list' ? { notes: [] } : undefined });
    assert.deepEqual(await sdk.notes.list(), []);
    assert.equal(typeof connectMistyYjs, 'function');
    assert.equal(parseAppRpcRequest({ protocol: 2, method: 'notes.list' }, 'space-a').params.path.spaceID, 'space-a');
    assert.equal(defineComponentApp({ appId: 'journal', protocol: 2, mount: () => ({ update() {}, unmount() {} }) }).appId, 'journal');
  `);
  execFileSync(process.execPath, ['check.mjs'], { cwd: directory, stdio: 'pipe' });
  const sample = resolve(directory, 'habit-tracker');
  mkdirSync(sample);
  for (const file of readdirSync(resolve(root, 'examples/habit-tracker')).filter(file => file.endsWith('.mjs'))) {
    copyFileSync(resolve(root, 'examples/habit-tracker', file), resolve(sample, file));
  }
  execFileSync(process.execPath, ['--test', 'adapter.node-test.mjs'], { cwd: sample, stdio: 'pipe' });
  const lock = readFileSync(resolve(directory, 'package-lock.json'), 'utf8');
  if (/misty-server|misty-apps|misty-org/.test(lock)) throw new Error('A packed consumer references private source');
  console.log('Packed SDK, contracts and independent habit adapter pass in an isolated consumer without private source or workspace links.');
} finally {
  rmSync(directory, { recursive: true, force: true });
}

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, readJSON, writeJSON, capture, sha256, version, checksums } from './lib.ts';

const releaseVersion = version(readJSON(resolve(root, 'package.json')).version);
const pins = readJSON(resolve(root, 'release/pins.json'));
const revision = capture('git', ['rev-parse', 'HEAD']);
const output = resolve(root, 'artifacts', `v${releaseVersion}`);
mkdirSync(output, { recursive: true });
const sdk = ['contracts', 'sdk'].map(name => {
  const packed = JSON.parse(capture('npm', ['pack', '--json', '--pack-destination', output], resolve(root, 'packages', name)))[0];
  return { name: packed.name, version: packed.version, filename: packed.filename, sha256: sha256(resolve(output, packed.filename)) };
});
writeJSON(resolve(output, 'release-manifest.json'), {
  schemaVersion: 2, version: releaseVersion, channel: 'beta', api: 'https://dev-api.mistysys.com/v1',
  source: { ...pins, host: revision, sdk: revision }, sdk,
});
checksums(output);
console.log(`Prepared SDK archives in ${output}. Built-in tools ship with Misty.`);

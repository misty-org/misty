import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, readJSON, writeJSON, version, checksums, run, capture, files } from './lib.mjs';
const releaseVersion = version(readJSON(resolve(root,'package.json')).version);
const output = resolve(root,'artifacts',`v${releaseVersion}`);
const manifest = readJSON(resolve(output,'release-manifest.json'));
const platforms = {};
for (const arch of ['aarch64','x86_64']) {
  const record = readJSON(resolve(output,`verification-${arch}.json`));
  if (record.version !== releaseVersion || !record.signatureVerified || !record.notarizationVerified || !record.gatekeeperAccepted) throw new Error(`macOS verification incomplete: ${arch}`);
  const name = `Misty-${releaseVersion}-${arch}.app.tar.gz`;
  platforms[`darwin-${arch}`] = {url:`https://github.com/misty-org/misty/releases/download/v${releaseVersion}/${name}`,signature:readFileSync(resolve(output,`${name}.sig`),'utf8').trim()};
}
writeJSON(resolve(output,'latest.json'),{version:releaseVersion,notes:`Misty ${releaseVersion} beta. Save work and close app tabs before installing.`,pub_date:new Date().toISOString(),platforms});
writeFileSync(resolve(output,'RELEASE-NOTES.md'),`Misty ${releaseVersion}\n\nApple Silicon and Intel installers, ten downloadable apps, and SDK 0.1.0 archives.\n\nUses https://dev-api.mistysys.com/v1. That development server must remain online.\n\nAutomated signing, notarization, package integrity and build gates passed. Interactive installation and a real two-version update remain explicit promotion gates in release/validation.json.\n`);
checksums(output);
const tag = `v${releaseVersion}`;
let existing;
try { existing = JSON.parse(capture('gh',['release','view',tag,'--repo','misty-org/misty','--json','isDraft,assets'])); } catch { /* First draft. */ }
if (existing && (!existing.isDraft || existing.assets.length)) throw new Error('This release already has assets. Use a new beta version; prepared assets are immutable.');
if (!existing) run('gh',['release','create',tag,'--repo','misty-org/misty','--target',manifest.source.host,'--draft','--prerelease','--title',`Misty ${releaseVersion}`,'--notes-file',resolve(output,'RELEASE-NOTES.md')]);
run('gh',['release','upload',tag,'--repo','misty-org/misty',...files(output).filter(f=>f.slice(output.length+1).indexOf('/')<0)]);

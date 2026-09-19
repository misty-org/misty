import { mkdirSync, copyFileSync, existsSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { createPublicKey, verify } from 'node:crypto';
import semver from 'semver';
import { root, readJSON, writeJSON, run, capture, sha256, version, checksums, verifyRepackedArchive } from './lib.ts';

const host = readJSON(resolve(root,'package.json'));
const releaseVersion = version(host.version);
const pins = readJSON(resolve(root,'release/pins.json'));
const trust = readJSON(resolve(root,'release/trust.json'));
const apps = resolve(root, 'apps');
const sdk = root;
const sourceRevision = capture('git', ['rev-parse', 'HEAD']);
run('npm', ['run', 'sdk:check']);
run('npm', ['run', 'sdk:packed']);
const output = resolve(root,'artifacts',`v${releaseVersion}`);
mkdirSync(output,{recursive:true});
const catalog = readJSON(resolve(apps,'catalog.json'));
if (!catalog.apps.some(app => app.desktop.runtime === 'downloaded')) throw new Error('No downloadable apps are configured.');
for (const app of catalog.apps) {
  if (!semver.valid(app.version)) throw new Error(`Invalid app version: ${app.id}`);
  app.minimum_host_protocol = 2;
  app.minimum_host_version = version(pins.minimumHostVersion);
}
const catalogPath = resolve(output,'official-app-catalog.json');
writeJSON(catalogPath,catalog);
const env = {MISTY_APPS_ROOT:apps,MISTY_OFFICIAL_APP_CATALOG_PATH:catalogPath,MISTY_OFFICIAL_APP_SIGNING_KEY_ID:trust.keyId,MISTY_OFFICIAL_APP_PUBLIC_DIR:resolve(output,"site-public")};
run('npm',['run','build:official-apps'],root,env);
run(process.execPath,[resolve(root, 'cli/tasks/apps/build-official-apps.ts'),'--release'],apps,env);
const signed = readJSON(catalogPath);
if (signed.signing?.key_id !== trust.keyId || signed.signing?.public_key !== trust.publicKey) throw new Error('Signing key does not match host trust.');
const publicKey = createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(trust.publicKey,'base64')]),format:'der',type:'spki'});
for (const app of signed.apps.filter(app => app.desktop.runtime === 'downloaded')) {
  const archive = resolve(output,`site-public/official-apps/${app.id}/${app.version}/desktop.zip`);
  if (sha256(archive) !== app.desktop.sha256 || !verify(null,readFileSync(archive),publicKey,Buffer.from(app.desktop.signature,'base64'))) throw new Error(`Package verification failed: ${app.id}`);
  copyFileSync(archive,resolve(output,`${app.id}-${app.version}-desktop.zip`));
}
const sdkPackages = ['contracts', 'sdk'].map(name => {
  const packed = JSON.parse(capture('npm', ['pack', '--json', '--pack-destination', output], resolve(root, 'packages', name)))[0];
  return { name: packed.name, version: packed.version, filename: packed.filename, sha256: sha256(resolve(output, packed.filename)) };
});
run(process.execPath, [resolve(root, 'cli/tasks/apps/sync-server-official-apps.ts'), resolve(output, 'catalog.go'), catalogPath], apps);
// Package the site now. Promotion uses these bytes, never a rebuild.
run('npm',['run','build:release'],apps);
copyFileSync(catalogPath,resolve(apps,'dist/official-app-catalog.json'));
const site = resolve(apps,'dist');
rmSync(resolve(site,'official-apps'),{recursive:true,force:true});
cpSync(resolve(output,'site-public/official-apps'),resolve(site,'official-apps'),{recursive:true});
if (existsSync(resolve(output,'site-public/official-app-assets'))) cpSync(resolve(output,'site-public/official-app-assets'),resolve(site,'official-app-assets'),{recursive:true});
rmSync(resolve(output,'site-public'),{recursive:true});
if (pins.previousRelease) {
  if (!/^v\d+\.\d+\.\d+-beta\.\d+$/.test(pins.previousRelease)) throw new Error('Invalid previous beta tag.');
  const previous = resolve(output,'previous'); mkdirSync(previous,{recursive:true});
  run('gh',['release','download',pins.previousRelease,'--repo','misty-org/misty','--pattern','beta-site.tar.gz','--dir',previous]);
  run('tar',['-xzf',resolve(previous,'beta-site.tar.gz'),'-C',previous]);
  const oldApps = resolve(previous,'official-apps');
  if (existsSync(oldApps)) {
    for (const app of signed.apps.filter(app => app.desktop.runtime === 'downloaded')) {
      const old = resolve(oldApps,app.id,app.version,'desktop.zip');
      if (existsSync(old) && sha256(old) !== app.desktop.sha256) throw new Error(`Published version ${app.id}/${app.version} cannot be overwritten.`);
    }
    cpSync(oldApps,resolve(site,'official-apps'),{recursive:true,force:false});
  }
  if (existsSync(resolve(previous,'official-app-assets'))) cpSync(resolve(previous,'official-app-assets'),resolve(site,'official-app-assets'),{recursive:true,force:false});
  rmSync(previous,{recursive:true});
}
run('tar',['-czf',resolve(output,'beta-site.tar.gz'),'-C',site,'.']);
writeJSON(resolve(output,'release-manifest.json'),{
  schemaVersion:1,version:releaseVersion,channel:'beta',api:'https://dev-api.mistysys.com/v1',
  source:{...pins,host:sourceRevision,apps:sourceRevision,sdk:sourceRevision},sdk:sdkPackages,
  apps:signed.apps.filter(app => app.desktop.runtime === 'downloaded').map(a => ({id:a.id,version:a.version,sha256:a.desktop.sha256,signature:a.desktop.signature,keyId:a.desktop.signature_key_id,minimumHostVersion:a.minimum_host_version,permissionVersion:a.permission_version})),
  signing:trust,siteSha256:sha256(resolve(output,'beta-site.tar.gz')),
});
checksums(output);
console.log(`Prepared signed apps and SDK archives in ${output}. Nothing was published.`);

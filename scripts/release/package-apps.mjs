import { mkdirSync, copyFileSync, existsSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { createPublicKey, verify } from 'node:crypto';
import { root, readJSON, writeJSON, run, capture, sha256, version, checksums } from './lib.mjs';

const host = readJSON(resolve(root,'package.json'));
const releaseVersion = version(host.version);
const pins = readJSON(resolve(root,'release/pins.json'));
const trust = readJSON(resolve(root,'release/trust.json'));
const apps = resolve(process.env.MISTY_APPS_ROOT || resolve(root,'../misty-apps'));
const sdk = resolve(process.env.MISTY_SDK_ROOT || resolve(root,'../misty-sdk'));
for (const [name,path] of [['apps',apps],['sdk',sdk]]) {
  if (capture('git',['rev-parse','HEAD'],path) !== pins[name]) throw new Error(`${name} checkout does not match release/pins.json.`);
}
const output = resolve(root,'artifacts',`v${releaseVersion}`);
mkdirSync(output,{recursive:true});
const catalog = readJSON(resolve(apps,'apps/catalog.json'));
if (catalog.apps.length !== 10 || catalog.apps.some(a => a.desktop.runtime !== 'downloaded')) throw new Error('All ten desktop apps must be downloadable.');
for (const app of catalog.apps) {
  app.version = pins.appVersions[app.id];
  version(app.version);
  app.minimum_host_protocol = 2;
  app.minimum_host_version = version(pins.minimumHostVersion);
}
const catalogPath = resolve(output,'official-app-catalog.json');
writeJSON(catalogPath,catalog);
const env = {MISTY_APPS_ROOT:apps,MISTY_OFFICIAL_APP_CATALOG_PATH:catalogPath,MISTY_OFFICIAL_APP_SIGNING_KEY_ID:trust.keyId,MISTY_OFFICIAL_APP_PUBLIC_DIR:resolve(output,"site-public")};
run('npm',['run','build:official-apps'],root,env);
run(process.execPath,['scripts/build-official-apps.mjs','--release'],apps,env);
const signed = readJSON(catalogPath);
if (signed.signing?.key_id !== trust.keyId || signed.signing?.public_key !== trust.publicKey) throw new Error('Signing key does not match host trust.');
const publicKey = createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(trust.publicKey,'base64')]),format:'der',type:'spki'});
for (const app of signed.apps) {
  const archive = resolve(output,`site-public/official-apps/${app.id}/${app.version}/desktop.zip`);
  if (sha256(archive) !== app.desktop.sha256 || !verify(null,readFileSync(archive),publicKey,Buffer.from(app.desktop.signature,'base64'))) throw new Error(`Package verification failed: ${app.id}`);
  copyFileSync(archive,resolve(output,`${app.id}-${app.version}-desktop.zip`));
}
const sdkPackages = readJSON(resolve(root,'vendor/misty-sdk/snapshot.json')).packages;
for (const pkg of sdkPackages) {
  const archive = resolve(root,'vendor/misty-sdk',pkg.filename);
  if (sha256(archive) !== pkg.sha256) throw new Error(`SDK snapshot mismatch: ${pkg.name}`);
  const packed = JSON.parse(capture('npm',['pack','--json','--pack-destination',output],resolve(sdk,'packages',pkg.name.split('/')[1])))[0];
  if (sha256(resolve(output,packed.filename)) !== pkg.sha256) throw new Error(`SDK source does not reproduce ${pkg.name}. Refresh the pinned archives.`);
}
run('node',['scripts/sync-server-official-apps.mjs',resolve(output,'catalog.go'),catalogPath],apps);
// Package the site now. Promotion uses these bytes, never a rebuild.
run('npm',['run','build:release'],apps);
copyFileSync(catalogPath,resolve(apps,'dist/official-app-catalog.json'));
const site = resolve(apps,'dist');
rmSync(resolve(site,'official-apps'),{recursive:true,force:true});
cpSync(resolve(output,'site-public/official-apps'),resolve(site,'official-apps'),{recursive:true});
rmSync(resolve(output,'site-public'),{recursive:true});
if (pins.previousRelease) {
  if (!/^v\d+\.\d+\.\d+-beta\.\d+$/.test(pins.previousRelease)) throw new Error('Invalid previous beta tag.');
  const previous = resolve(output,'previous'); mkdirSync(previous,{recursive:true});
  run('gh',['release','download',pins.previousRelease,'--repo','misty-org/misty','--pattern','beta-site.tar.gz','--dir',previous]);
  run('tar',['-xzf',resolve(previous,'beta-site.tar.gz'),'-C',previous]);
  const oldApps = resolve(previous,'official-apps');
  if (existsSync(oldApps)) {
    for (const app of signed.apps) {
      const old = resolve(oldApps,app.id,app.version,'desktop.zip');
      if (existsSync(old) && sha256(old) !== app.desktop.sha256) throw new Error(`Published version ${app.id}/${app.version} cannot be overwritten.`);
    }
    cpSync(oldApps,resolve(site,'official-apps'),{recursive:true,force:false});
  }
  rmSync(previous,{recursive:true});
}
run('tar',['-czf',resolve(output,'beta-site.tar.gz'),'-C',site,'.']);
writeJSON(resolve(output,'release-manifest.json'),{
  schemaVersion:1,version:releaseVersion,channel:'beta',api:'https://dev-api.mistysys.com/v1',
  source:{host:capture('git',['rev-parse','HEAD']),...pins},sdk:sdkPackages,
  apps:signed.apps.map(a => ({id:a.id,version:a.version,sha256:a.desktop.sha256,signature:a.desktop.signature,keyId:a.desktop.signature_key_id,minimumHostVersion:a.minimum_host_version,permissionVersion:a.permission_version})),
  signing:trust,siteSha256:sha256(resolve(output,'beta-site.tar.gz')),
});
checksums(output);
console.log(`Prepared ten signed apps and SDK archives in ${output}. Nothing was published.`);

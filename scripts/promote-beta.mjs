import { readFileSync, writeFileSync, mkdirSync, readdirSync, cpSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { preserveAppAssets } from './preserve-app-assets.mjs';
const tag = process.env.RELEASE_TAG, phase = process.env.RELEASE_PHASE;
if (!/^v\d+\.\d+\.\d+-beta\.\d+$/.test(tag ?? '') || !['assets','feeds'].includes(phase)) throw new Error('Invalid beta promotion.');
const directory = resolve('artifacts/promotion'); mkdirSync(directory,{recursive:true});
execFileSync('gh',['release','download',tag,'--repo','misty-org/misty','--dir',directory],{stdio:'inherit'});
for (const line of readFileSync(resolve(directory,'SHA256SUMS'),'utf8').trim().split('\n')) {
  const m = /^([a-f0-9]{64})  ([a-zA-Z0-9_.-]+)$/.exec(line);
  if (!m || createHash('sha256').update(readFileSync(resolve(directory,m[2]))).digest('hex') !== m[1]) throw new Error('Release checksum verification failed.');
}
const manifest = JSON.parse(readFileSync(resolve(directory,'release-manifest.json'),'utf8'));
if (`v${manifest.version}` !== tag) throw new Error('Release version mismatch.');
const output = resolve('dist'); mkdirSync(output,{recursive:true});
execFileSync('tar',['-xzf',resolve(directory,'beta-site.tar.gz'),'-C',output],{stdio:'inherit'});
// The first phase exposes immutable assets for installation checks. Existing feeds stay intact.
rmSync(resolve(output,'official-app-catalog.json'),{force:true});
// Preserve the actual live state, including when assets promotion is retried.
// Reject a candidate prepared before a different beta went live.
for (const relative of ['updates/beta/latest.json','official-app-catalog.json']) {
  const response = await fetch(`https://apps.mistysys.com/${relative}`,{signal:AbortSignal.timeout(30000),cache:'no-store'});
  if (response.status === 404) continue;
  if (!response.ok) throw new Error(`Cannot preserve the live ${relative}: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const data = JSON.parse(bytes.toString('utf8'));
  if (relative === 'official-app-catalog.json') await preserveAppAssets(data, output);
  if (relative.includes('latest.json') && data.version !== manifest.version && `v${data.version}` !== manifest.source.previousRelease)
    throw new Error('A different beta is already live. Prepare a successor from that release before promotion.');
  mkdirSync(resolve(output,'updates/beta'),{recursive:true});
  writeFileSync(resolve(output,relative),bytes);
}
if (phase === 'feeds') {
  const response = await fetch(`${manifest.api}/apps/release`,{signal:AbortSignal.timeout(30000)});
  const expected = createHash('sha256').update(readFileSync(resolve(directory,'official-app-catalog.json'),'utf8').trim()).digest('hex');
  if (!response.ok || (await response.json()).catalog_sha256 !== expected) throw new Error('Deploy the exact prepared Go catalog before publishing feeds.');
  for (const app of manifest.apps) {
    const url = `https://apps.mistysys.com/official-apps/${app.id}/${app.version}/desktop.zip`;
    const response = await fetch(url,{signal:AbortSignal.timeout(60000)});
    if (!response.ok || createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex') !== app.sha256) throw new Error(`Publish and verify app assets first: ${app.id}`);
  }
  mkdirSync(resolve(output,'updates/beta'),{recursive:true});
  cpSync(resolve(directory,'latest.json'),resolve(output,'updates/beta/latest.json'));
  cpSync(resolve(directory,'official-app-catalog.json'),resolve(output,'official-app-catalog.json'));
}
writeFileSync(resolve(output,'CNAME'),'apps.mistysys.com\n');
writeFileSync(resolve(output,'.nojekyll'),'');

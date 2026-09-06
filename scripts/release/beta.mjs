import { mkdtempSync, readFileSync, existsSync, copyFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { root, readJSON, run, capture, version, verifyChecksums } from './lib.mjs';
const command = process.argv[2];
const releaseVersion = version(readJSON(resolve(root,'package.json')).version);
const tag = `v${releaseVersion}`;
const pins = readJSON(resolve(root,'release/pins.json'));
const sdkVersion = pins.sdkVersion;
if (!/^\d+\.\d+\.\d+$/.test(sdkVersion)) throw new Error('Invalid pinned SDK version.');
const sdkTag = `v${sdkVersion}`;
if (!['prepare','promote'].includes(command)) throw new Error('Usage: npm run beta:prepare | npm run beta:promote -- assets|feeds');
if (command === 'prepare' && !process.argv.includes('--collect')) {
  if (capture('git',['status','--porcelain'])) throw new Error('Commit and push the verified release branch before preparing a draft.');
  const sha = capture('git',['rev-parse','HEAD']);
  const branch = capture('git',['branch','--show-current']);
  let runs = JSON.parse(capture('gh',['run','list','--repo','misty-org/misty','--workflow','macos-beta.yml','--commit',sha,'--json','databaseId,status,conclusion']));
  if (!runs.length) {
    run('gh',['workflow','run','macos-beta.yml','--repo','misty-org/misty','--ref',branch]);
    // workflow_dispatch is asynchronous; do not accidentally watch an older source revision.
    for (let attempt=0;attempt<12 && !runs.length;attempt++) {
      await new Promise(r=>setTimeout(r,5000));
      runs = JSON.parse(capture('gh',['run','list','--repo','misty-org/misty','--workflow','macos-beta.yml','--commit',sha,'--json','databaseId,status,conclusion']));
    }
  }
  if (!runs.length) throw new Error('The workflow has not appeared yet. Rerun prepare.');
  run('gh',['run','watch',String(runs[0].databaseId),'--repo','misty-org/misty','--exit-status']);
}
const directory = mkdtempSync(resolve(tmpdir(),`misty-${tag}-`));
run('gh',['release','download',tag,'--repo','misty-org/misty','--dir',directory]);
verifyChecksums(directory);
const manifest = readJSON(resolve(directory,'release-manifest.json'));
if (manifest.version !== releaseVersion || manifest.source.sdk !== pins.sdk || manifest.source.apps !== pins.apps) throw new Error('Draft source pins do not match this checkout.');
if (command === 'prepare') {
  if (manifest.source.host !== capture('git',['rev-parse','HEAD'])) throw new Error('The draft belongs to a different host revision. Check out its prepared revision before collecting.');
  let sdkRelease;
  try { sdkRelease = JSON.parse(capture('gh',['release','view',sdkTag,'--repo','misty-org/misty-sdk','--json','isDraft,assets,targetCommitish'])); } catch {}
  if (!sdkRelease) run('gh',['release','create',sdkTag,'--repo','misty-org/misty-sdk','--target',pins.sdk,'--draft','--title',`Misty SDK ${sdkVersion}`,'--notes','Typed contracts and SDK archives, verified in an isolated consumer. Install both archives together. npm publication is deferred.']);
  const sdkNames = [`misty-contracts-${sdkVersion}.tgz`,`misty-sdk-${sdkVersion}.tgz`];
  writeFileSync(resolve(directory,'SDK-SHA256SUMS'),sdkNames.map(name => `${createHash('sha256').update(readFileSync(resolve(directory,name))).digest('hex')}  ${name}`).join('\n')+'\n');
  for (const name of [...sdkNames,'SDK-SHA256SUMS']) {
    const asset = sdkRelease?.assets.find(a=>a.name===name);
    if (asset) {
      const existing = mkdtempSync(resolve(tmpdir(),'misty-sdk-asset-'));
      run('gh',['release','download',sdkTag,'--repo','misty-org/misty-sdk','--pattern',name,'--dir',existing]);
      if (!readFileSync(resolve(existing,name)).equals(readFileSync(resolve(directory,name)))) throw new Error('SDK v0.1.0 is already frozen with different bytes. Bump the SDK version.');
    } else {
      if (sdkRelease && !sdkRelease.isDraft) throw new Error('Do not add assets to a published SDK version.');
      run('gh',['release','upload',sdkTag,'--repo','misty-org/misty-sdk',resolve(directory,name)]);
    }
  }
  console.log(`Verified drafts are ready. Assets and the exact Go catalog overlay are in ${directory}. No catalog or update feed was published.`);
} else {
  const phase = process.argv[3];
  if (!['assets','feeds'].includes(phase)) throw new Error('Choose assets or feeds for explicit promotion.');
  if (phase === 'assets') {
    run('gh',['release','edit',sdkTag,'--repo','misty-org/misty-sdk','--draft=false']);
    run('gh',['release','edit',tag,'--repo','misty-org/misty','--draft=false','--prerelease']);
  } else {
    const validation = readJSON(resolve(root,'release/validation.json'));
    if (validation.version !== releaseVersion || !validation.appleSiliconInstall || !validation.intelInstall || !validation.twoVersionUpdate || !validation.appsSmokeCheck)
      throw new Error('Complete and record the real installation, two-version update, and app smoke checks in release/validation.json before publishing the feed.');
    const response = await fetch(`${manifest.api}/apps/release`,{signal:AbortSignal.timeout(30000)});
    if (!response.ok) throw new Error('The Go API release metadata is unavailable. Deploy the prepared catalog first.');
    const deployed = await response.json();
    const expected = createHash('sha256').update(readFileSync(resolve(directory,'official-app-catalog.json'),'utf8').trim()).digest('hex');
    if (deployed.catalog_sha256 !== expected) throw new Error('The Go API does not serve this exact prepared catalog yet.');
  }
  run('gh',['workflow','run','release.yml','--repo','misty-org/misty-apps','--ref',pins.appsBranch,'-f',`tag=${tag}`,'-f',`phase=${phase}`]);
  console.log(`Requested ${phase} promotion in Misty Apps. Check its deployment run before sharing the release.`);
}

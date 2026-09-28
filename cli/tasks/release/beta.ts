import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { root, readJSON, run, capture, version, verifyChecksums } from './lib.ts';
import { verifyPinnedServer } from './verify-server.ts';
const command = process.argv[2];
const releaseVersion = version(readJSON(resolve(root,'package.json')).version);
const tag = `v${releaseVersion}`;
const pins = readJSON(resolve(root,'release/pins.json'));
if (!['prepare','promote'].includes(command)) throw new Error('Usage: npm run beta:prepare | npm run beta:promote -- assets|feeds');
verifyPinnedServer(pins.server);
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
if (manifest.version !== releaseVersion || manifest.source.server !== pins.server) throw new Error('Draft source pins do not match this checkout.');
if (command === 'prepare') {
  if (manifest.source.host !== capture('git',['rev-parse','HEAD'])) throw new Error('The draft belongs to a different host revision. Check out its prepared revision before collecting.');
  console.log(`Verified drafts are ready. Assets are in ${directory}. No update feed was published.`);
} else {
  const phase = process.argv[3];
  if (!['assets','feeds'].includes(phase)) throw new Error('Choose assets or feeds for explicit promotion.');
  if (phase === 'assets') {
    run('gh',['release','edit',tag,'--repo','misty-org/misty','--draft=false','--prerelease']);
  } else {
    const validation = readJSON(resolve(root,'release/validation.json'));
    if (validation.version !== releaseVersion || !validation.appleSiliconInstall || !validation.intelInstall || !validation.twoVersionUpdate || !validation.builtinToolsSmokeCheck)
      throw new Error('Complete and record the real installation, two-version update, and built-in tool checks in release/validation.json before publishing the feed.');

  }
  run('gh',['workflow','run','updates-release.yml','--repo','misty-org/misty','--ref',capture('git',['branch','--show-current']),'-f',`tag=${tag}`,'-f',`phase=${phase}`]);
  console.log(`Requested ${phase} promotion of the Misty update feed. Check its deployment run before sharing the release.`);
}

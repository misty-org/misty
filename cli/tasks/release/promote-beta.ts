import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { verifyChecksums } from './lib.ts';
const tag = process.env.RELEASE_TAG, phase = process.env.RELEASE_PHASE;
if (!/^v\d+\.\d+\.\d+-beta\.\d+$/.test(tag ?? '') || !['assets', 'feeds'].includes(phase ?? '')) throw new Error('Invalid beta promotion.');
const directory = resolve('artifacts/promotion');
mkdirSync(directory, { recursive: true });
execFileSync('gh', ['release', 'download', tag!, '--repo', 'misty-org/misty', '--dir', directory], { stdio: 'inherit' });
verifyChecksums(directory);
const manifest = JSON.parse(readFileSync(resolve(directory, 'release-manifest.json'), 'utf8'));
if (`v${manifest.version}` !== tag) throw new Error('Release version mismatch.');
const output = resolve('artifacts/update-site');
mkdirSync(resolve(output, 'updates/beta'), { recursive: true });
// Publishing assets must preserve the currently live Misty update feed.
const response = await fetch('https://apps.mistysys.com/updates/beta/latest.json', { signal: AbortSignal.timeout(30000), cache: 'no-store' });
if (response.ok) {
  const bytes = Buffer.from(await response.arrayBuffer());
  const live = JSON.parse(bytes.toString('utf8'));
  if (live.version !== manifest.version && `v${live.version}` !== manifest.source.previousRelease) throw new Error('A different beta is live. Prepare a successor before promotion.');
  writeFileSync(resolve(output, 'updates/beta/latest.json'), bytes);
} else if (response.status !== 404) throw new Error(`Cannot preserve the live update feed: ${response.status}`);
if (phase === 'feeds') copyFileSync(resolve(directory, 'latest.json'), resolve(output, 'updates/beta/latest.json'));
writeFileSync(resolve(output, 'CNAME'), 'apps.mistysys.com\n');
writeFileSync(resolve(output, '.nojekyll'), '');

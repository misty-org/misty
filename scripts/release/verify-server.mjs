import { capture } from './lib.mjs';

export function verifyPinnedServer(revision) {
  if (!/^[a-f0-9]{40}$/.test(revision ?? '')) throw new Error('Pin the full Go server commit.');
  const repository = 'repos/misty-org/misty-server';
  if (capture('gh', ['api', `${repository}/commits/${revision}`, '--jq', '.sha']) !== revision)
    throw new Error('The pinned private Go revision could not be verified.');
  const checks = JSON.parse(capture('gh', ['api', `${repository}/commits/${revision}/check-runs?per_page=100`, '--jq', '.check_runs']));
  const latest = checks.filter(check => check.name === 'Verify' && check.head_sha === revision)
    .sort((a, b) => b.id - a.id)[0];
  if (latest?.status !== 'completed' || latest.conclusion !== 'success')
    throw new Error('The pinned Go revision must pass its required Verify CI before release preparation or promotion.');
  console.log(`Verified private Go source ${revision} and its required CI.`);
}
